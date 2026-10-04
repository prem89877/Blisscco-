# Blisscco: Legal-readiness and accuracy audit

Date of audit: 4 October 2026. Scope: the whole project in `blisscco.zip` (React app, `api/` routes, `supabase/migrations` 0001 to 0024).
This is a legal-readiness review of how truthfully the Terms and Privacy Policy describe the product. It is **not legal advice** and it does not replace a qualified Indian lawyer. Anything legally uncertain is marked **Needs lawyer confirmation**.

---

## 0. Short answer

| Question | Answer |
|---|---|
| Overall risk (before my changes) | **High** |
| Overall risk (after my changes, with the `[ACTION REQUIRED]` items still open) | **Medium** |
| Old Terms safe to publish as-is? | **No** |
| Old Privacy Policy safe to publish as-is? | **No** |
| New Terms / Privacy safe to publish? | **Not yet.** First fill the `[ACTION REQUIRED]` items (section 9), run migration 0025, and get a lawyer to review. |

Biggest problems found:
1. The business-listing terms that shop owners actually tick in the app were still the database text **"PLACEHOLDER - replace with reviewed Terms & Conditions before going live."**
2. Terms said **"Reviews must reflect a real, completed service."** The code allows reviews on any own booking (even cancelled) and direct reviews with no booking at all.
3. Privacy Policy promised that you can **"ask us to delete your account data"**, but there is no deletion mechanism, and the database blocks deleting many accounts (section 3, item 9).
4. No notice or link to Terms / Privacy on sign-up, Google sign-in or login.
5. Paid services (blue badge, banners, physical QR), coupons, referrals, notifications, third-party providers and local storage were missing from the documents, and there is no operator identity, grievance contact or refund policy anywhere.

---

## 1. What I inspected

Documents and consent text: `Terms.tsx`, `Privacy.tsx`, `LegalPage.tsx`, footer links, sign-up / login / Google screens, listing-submit screen and its database terms (`terms_versions`), booking, review, payment and QR screens, `README.md`, `CHANGES.md`, `i18n/messages.ts` (EN/HI/MR).
Code and schema: all migrations, `api/*` routes, auth and location context, analytics, offline cache, service worker, push, notification dispatcher, Razorpay order and webhook code, AI routes.
Not found (do not exist in the project): cookie policy, refund / cancellation policy, a separate onboarding agreement, any account-deletion screen, any SMS sending.

## 2. Actual data flow (what the app really does)

| Topic | What the code does |
|---|---|
| Customer data | Name, email, password (held by Supabase Auth, not in our tables), language, role, `email_verified`, `is_suspended`. **No phone number** (phone columns were dropped in 0021). No address. |
| Owner data | Same account data, plus business name, category, description, phone, email, full address, PIN, lat/lng, photos, services and prices, hours, booking settings, terms acceptance (user, shop, version, time). |
| Google login | Standard OAuth redirect. Google passes name and verified email to Supabase (and normally a picture link, which the app never uses). Password never reaches Blisscco. |
| Precise location | One `getCurrentPosition` call when the customer taps to search nearby. **No `watchPosition`, no background tracking.** Kept in React memory only, never put in browser storage or in any table. It is sent to the server as parameters of `nearby_businesses`, `search_services` and `active_banners` (5 km radius). Provider logs may still hold request metadata. Outside India it is refused. |
| Bookings | `bookings`: shop, service, price at booking, type, date or token, status and history, timestamps, **`customer_name` copied from profile**, reminder flag, owner-typed `guest_name` for walk-ins. Visible to the customer, the shop and admins. Shops do not get the customer's email. |
| Queue / token | Token number per shop per day, position computed live (not stored), shop can start / skip / cancel. Appointment requests without a time expire after 1 hour (pg_cron). |
| Reviews | Rating, comment (max 1000), first word of the name (`reviewer_name`), owner reply, status `published` / `removed`. Published immediately. |
| Referrals | `referral_codes`, `referrals` (referrer, referred, code, status, **normalised referred email**), `coupons`, `coupon_redemptions`. Referral code in browser `localStorage` until sign-up. |
| QR scan | QR = `/b/<shop id>?src=qr`, generated in the browser. Scan = opens the page; the visit is counted (source `qr`). No name or location. |
| Analytics | Table `analytics_events`: shop, event type, source, `session_hash` (sha256 of a random per-tab id plus the Indian date), `dedupe_key`, time. No user id / name / email / IP / user-agent stored. Booking events use `sha256('booking:' + booking_id)` as dedupe key. Owners only see counts. Purged after **400 days** by a weekly pg_cron job. |
| Payments | Owners only. Razorpay Checkout (UPI-only), orders created server-side, amount read from DB. Blisscco stores order id, payment id, amount, status, refunds, plus the **full raw Razorpay webhook JSON** (`webhook_events.payload`), which can contain payer email, phone and UPI id. Customers never pay Blisscco and Blisscco never holds customer money. |
| Paid products | Blue badge (365 days, needs an admin-approved document first), extra banner (1 credit, runs 30 days after approval), physical QR poster (one time, sent to the shop address). Prices live in `plans`. PRO / ELITE plans were removed (0017/0018). |
| Notifications | In-app + web-push (VAPID) + email via **Resend**. Defaults ON (opt-out). Push needs browser permission; stores endpoint, keys, user-agent. Status is "sent" only when the provider accepts. Purged after 90 days. No SMS. |
| Third parties | Supabase (DB, auth, storage), Vercel (hosting, API routes), Google (sign-in, **Google Fonts loaded from fonts.googleapis.com**), Razorpay, Resend, browser push services, an AI provider (owner tools only; provider is configured by env var: Anthropic by default, or any OpenAI-compatible API). AI sees only aggregate counts, a service name, city/state and the shop's other prices. |
| Public listing data | Name, category, description, address, PIN, lat/lng, photos, services, prices, hours, phone (**shown by default**, owner can hide), email (hidden by default), ratings, reviews with first name, owner replies, blue tick, live banners. |
| Browser storage | No cookies set by Blisscco. `localStorage`: Supabase session, language, referral code, install-prompt snooze, OAuth intent, per-user offline cache (cleared on log out). `sessionStorage`: tab id, source per shop, return path. Service worker caches only app files. |
| Account deletion | **No UI, no function.** See section 3, item 9. |
| Business deactivation | Owner can set a shop `inactive` (hidden); nothing is deleted. No "delete business". |
| Retention | Automated only for: notifications 90 days, analytics 400 days, AI usage log 30 days. Everything else (profiles, bookings, reviews, payments, webhook payloads, documents, referrals) is kept indefinitely. |

## 3. Every statement in the old Privacy Policy, checked

| # | Old statement | Verdict | What I did |
|---|---|---|---|
| 1 | "We never see your Google password." | **True** (OAuth redirect). | Kept. Added that Google may share more basic profile data. |
| 2 | "We do not sell your personal data." | **Consistent with the code** (nothing sells or shares for money). | Kept. |
| 3 | "We do not track your location in the background." | **True.** Only a single `getCurrentPosition` call. But "location is not stored" was not said, and coordinates do reach the server. | Kept and explained exactly what happens (memory only, sent to find nearby shops/banners, provider logs possible). |
| 4 | "Anonymous visit counts ... linked to the shop only, not to your name, email or account." | **Mostly true, but "anonymous" is too strong.** It is a pseudonymous daily hash. The booking dedupe key is a hash of the booking id, so someone with database access could match a counted booking to its booking. | Rewrote as "does not store your name, email, phone or account ID", and disclosed the booking-hash limit. |
| 5 | "... deleted after about 13 months." | **True only if the weekly pg_cron job exists.** Code says 400 days (about 13.1 months). `RUN_LOG.md` still shows 0011-0014 as "NOT YET - run this", so I cannot tell whether pg_cron is enabled. | Stated "400 days (about 13 months)". **You must verify the job** (checklist). |
| 6 | "Account data: name, email address and language preference." | **Incomplete.** Also role, email-verified flag, suspension flag, notification settings, push subscriptions, referral data, coupons, terms acceptance. | Rewritten in full. |
| 7 | "payments for paid services such as banners and the blue badge" | **Incomplete / unclear.** Physical QR omitted. What is stored was not said. Raw webhook payload (possible payer contact data) not disclosed. | Rewritten (Payments section). |
| 8 | "We use service providers ... (hosting and database, sign-in, email, and payments)" | **Too vague and incomplete.** Vercel, Supabase, Google (incl. Fonts), Razorpay, Resend, push services, AI provider were not named. | Listed. |
| 9 | "ask us to correct or delete your account data by emailing us." | **Not backed by any mechanism.** No delete function. Deleting an auth user is blocked by foreign keys without `ON DELETE` rules: `businesses.owner_id`, `payment_transactions.user_id`, `terms_acceptances.user_id`, `referrals.referrer_id`, `coupons.holder_id`, `review_reports.reporter_id`, `booking_disputes.raised_by`, `coupon_redemptions.redeemed_by`, `reviewed_by` / `actor_id` columns. Even when it succeeds, personal data stays in `bookings.customer_name`, `reviews.reviewer_name` and `comment`, `referrals.referred_email`, `webhook_events.payload`. | Rewrote to describe a **manual** process and what may be kept. You must actually be able to do it (section 8, item 1). |
| 10 | "We keep data while your account is active and as required by law." | **Inaccurate / vague.** | Replaced with a real retention list (90 d, 400 d, 30 d, rest indefinite, with `[ACTION REQUIRED]` for periods you must decide). |
| 11 | "Access to data is restricted by role and database security rules." | **True** (RLS on all tables, private buckets, service-role only payment functions). | Kept, without exaggeration ("no online service can promise perfect security"). |
| 12 | Cookies / local storage / device identifiers | **Missing.** | Added. |
| 13 | Children | **Missing.** There is no age gate. | Added 18+ (see Needs confirmation). |
| 14 | "Business owners see only what they need to serve your booking." | **True** (name + booking details, no email, no phone). | Kept, stated precisely. |

## 4. DPDP and Indian privacy review

Status of the law (checked online on 4 Oct 2026): the DPDP Rules, 2025 were notified on 13/14 November 2025. The Data Protection Board provisions started then; consent-manager rules start after 12 months; the main duties for data fiduciaries (notice, consent, security safeguards, breach reporting, retention and erasure, children, grievance, cross-border) start **18 months after publication, about 13 May 2027**. So the DPDP duties are not yet enforceable, but the policy should be written to meet them, and other Indian rules may apply today. **Needs lawyer confirmation:** the IT Act and SPDI Rules 2011 (passwords and payment data), the IT (Intermediary Guidelines) Rules 2021 (published rules, grievance officer, content rules), and the Consumer Protection (E-Commerce) Rules 2020.

I did **not** state that Blisscco is compliant.

| Point | Status now |
|---|---|
| Who processes data | Done, but operator name and address are `[ACTION REQUIRED]`. |
| Categories of data / purposes | Done. |
| Third parties | Done. AI provider and sign-in email service names are `[ACTION REQUIRED]`. |
| Rights (access, correct, erase, withdraw) | Described. Delete is manual (see item 9 above). |
| Consent / withdrawal | Notice at sign-up added (links to both documents). Location and push use browser permission; email notifications can be switched off in the app. **Needs lawyer confirmation:** whether the sign-up notice must be itemised per purpose under Rule 3 once in force, and whether consent or another lawful basis fits each use. |
| Grievance contact | Placeholder. **Required before launch.** |
| Retention | Partly real, partly `[ACTION REQUIRED]`. |
| Security | Stated without exaggeration. |
| Children | 18+ rule added; no age gate exists. **Needs lawyer confirmation** (verifiable parental consent rules). |
| Cross-border | Disclosed in general terms; Supabase region unknown, `[ACTION REQUIRED]`. |
| Shops as separate fiduciaries | Terms tell shops to keep customer names private. **Needs lawyer confirmation.** |
| Other-language notice | Terms and Privacy exist in English only (app is EN/HI/MR). **Needs lawyer confirmation.** |

## 5. Terms audit (against the real code)

| Area | Finding |
|---|---|
| Platform role | Old Terms said businesses are independent (good). Strengthened: Blisscco is not a party to the service. |
| Bookings | Appointment = date request, shop sends time, auto-closes after 1 hour; walk-in token with live position; customers can cancel before service; **no cancellation or no-show fee exists in code**. Now stated. |
| Disputes | Customer or owner can report a finished booking within 30 days; admin can correct status. No refund mechanism. Now stated. |
| Reviews | **Not limited to completed services** (0015: any own booking; 0016: direct review, one per shop, not own shop). Customers cannot report reviews (only owners can, `report_review` checks ownership). Now stated truthfully, with "not proof of purchase". |
| Business listings | Accuracy, genuine photos, licences, review-before-live, reject/suspend. Added content licence and customer-data duties. |
| Payments | Customers pay shops directly and never pay Blisscco. Owners pay Blisscco via Razorpay UPI for badge / banner / QR. Old Terms had no mention. No refund policy in code, so `[ACTION REQUIRED]`. Full refund via Razorpay removes the badge or credit (webhook). |
| Banners | Labelled "Sponsored" (good). 30 days, 5 km radius, admin-approved, credit returned on reject/cancel. Now stated. Banners order by newest start. |
| Blue badge | Meaning now stated: a document was reviewed. Not an endorsement. **Does not affect ranking** (search is by distance or price only). UI label changed to "Documents verified". |
| Referral / coupons | One reward per email identity, needs verified email and a completed service at a shop owned by neither person; weighted random reward; admin can revoke. Coupon discount is recorded, **nothing in code pays the shop**, so the shop bears it (Terms say so; confirm). `accept_coupons` defaults to ON. |
| QR | Opens the shop page and counts a visit. Stated. |
| Suspension / removal | Admin can suspend users, suspend shops, remove reviews, reject banners, revoke coupons. Wording now matches. |
| Liability | Reasonable "as is" and non-responsibility for third-party services, without absurd "never liable" language. Liability cap left as **Needs lawyer confirmation**. |

## 6. Risky wording list

| # | Current wording | Why risky | What the code does | New wording (summary) |
|---|---|---|---|---|
| 1 | Terms: "Reviews must reflect a real, completed service." | False. Misleads readers about review authenticity. | Any own booking, even cancelled, or a direct review with no booking. | "Blisscco does not check whether a service was received, so a review is not proof of a purchase." |
| 2 | Terms: "Booking through Blisscco is free." | Incomplete: Blisscco sells paid services to owners. | Customers pay nothing to Blisscco. | "Blisscco does not charge customers for bookings." + paid-services section. |
| 3 | DB listing terms: "PLACEHOLDER - replace ..." | Owners "accept" a placeholder. | Shown in the submit screen. | Migration 0025 (v2 text). |
| 4 | Privacy: "ask us to ... delete your account data" | No mechanism, FK-blocked. | See section 3, item 9. | Manual process described honestly. |
| 5 | Privacy: "Anonymous visit counts" | Too absolute. | Pseudonymous hash; booking key matchable. | "does not store your name, email, phone or account ID" + limit disclosed. |
| 6 | Privacy: "deleted after about 13 months" | Depends on pg_cron. | 400 days, weekly job. | "400 days (about 13 months)"; verify the job. |
| 7 | Privacy: "We keep data while your account is active..." | Vague and wrong for several tables. | Mixed retention. | Real retention list. |
| 8 | Privacy: provider list | Vague, incomplete. | Vercel, Supabase, Google, Razorpay, Resend, push services, AI. | Named list. |
| 9 | Landing page: "Find **trusted** salons..." | Blisscco cannot vouch for shops. | Shops are only reviewed for completeness. | "Find salons, spas, tattoo studios and more." |
| 10 | Blue tick tooltip: "Verified business" | Reads like an endorsement. | A document was checked and the badge is paid. | "Documents verified" + Terms explanation. |
| 11 | No sign-up notice | No notice or link at collection. | Sign-up, Google and login had none. | `LegalConsent` line on sign-up and login. |
| 12 | Terms: no refund / cancellation wording | Owners pay money. | No policy in code. | `[ACTION REQUIRED]` in Terms. |
| 13 | Public page banner "Draft for launch. Have a lawyer review..." | Honest, but looks unfinished. | n/a | **Kept** (true). Remove only after a lawyer has reviewed. |
| 14 | Contact is `premtalekar09@gmail.com` | Personal address on a public legal page. | Existing value. | Kept; consider a business email. |

## 7. Consistency check

- Terms vs Privacy: both now say customers pay shops directly, owners pay Blisscco by Razorpay, reviews show first name, banners are "Sponsored", the badge is a document check.
- In-app text vs documents: `bk.free` ("Booking is free. You pay the shop directly.") agrees. `p9.srcHint` (estimates, not exact people, no personal details) agrees. Fixed `landing.sub` and `p8.verified`.
- DB listing terms (0025) vs Terms page: written to match; keep them in sync.
- Stale: `p8.feat.pro/elite` and `p8.bannerLocked` still mention PRO / ELITE in `messages.ts`. I checked: not displayed (OwnerPlans only lists the badge). Harmless; clean up later.
- Hindi and Marathi consent strings and tooltips were written by me. Please have a native speaker check them.

## 8. Code or functionality that should change (not changed by me)

1. **Account deletion / anonymisation (high priority).** Build an admin-run SQL function or an in-app "Delete my account". It must null `bookings.customer_name`, `reviews.reviewer_name` (and decide on `comment`), `referrals.referred_email`, strip personal fields from `webhook_events.payload`, delete push and notification rows, and handle the FK-blocked tables. Until then the policy is only true if you do it by hand each time.
2. **Verify scheduled jobs.** In Supabase run `select jobname, schedule from cron.job;` You need at least `blisscco-purge-analytics`, `blisscco-purge-notifications`, `blisscco-expire-requests`. Also confirm migrations 0006 to 0014 and 0019 to 0024 are really applied (RUN_LOG says "NOT YET" for many).
3. **Webhook payload retention.** Redact payer contact fields in `webhook_events.payload` or purge after a set time.
4. **Review authenticity.** Decide: keep reviews open to anyone (current), or limit to completed bookings and show a "visited" label. The Terms match the current behaviour, not a stricter one.
5. **Customers cannot report reviews.** Optional: add a customer "Report review" action.
6. **Coupons default ON.** Shops pay the discount unless they switch it off. Consider defaulting OFF, or make sure onboarding explains it (the v2 listing terms now do).
7. **Public phone number is ON by default** (`show_phone_publicly`). Consider asking owners clearly at onboarding.
8. **Google Fonts** sends visitors' IP addresses to Google. Optional: self-host the fonts.
9. **Age gate.** Terms say 18+; nothing checks it. Optional: add an "I am 18 or older" checkbox.

I made only these code changes, all needed so the statements are true: the legal pages, the sign-up notice, links on the listing-submit screen, three UI strings, and the 0025 data migration.

## 9. Open items

### `[ACTION REQUIRED]` (shown on the pages until you replace them)
- Operator name, address, Grievance Officer name, response time, courts' city: edit `src/lib/site.ts`.
- GST treatment and invoices for paid services (Terms).
- Refund and cancellation policy per paid service; refund if a badge is removed for false documents (Terms).
- Name of the AI provider; which service sends sign-in emails (Privacy).
- Region of Supabase and Vercel functions (Privacy).
- Retention periods for account, bookings, reviews, payments, webhook payloads, badge documents (Privacy).

### Statements that need your confirmation
- You really can and will do manual account deletion / anonymisation as described.
- Blisscco does not pay coupon discounts; shops bear them.
- Blisscco does not charge cancellation or no-show fees.
- Account holders must be 18 or older.
- Content licence for shop photos and banners.
- "We aim not to remove honest reviews only because they are critical." Keep only if you are happy to be held to it.
- You are happy to remove the public draft banner only after lawyer review.

### Needs lawyer confirmation
Intermediary status and duties (IT Rules 2021, grievance timelines); E-Commerce Rules 2020; SPDI Rules until DPDP commences; DPDP roles of Blisscco and shops; itemised consent notice; children; cross-border; liability cap; exclusive jurisdiction; content licence; refund rules for owners; GST; review removal and defamation handling; Hindi / Marathi versions of the documents.

## 10. Final checklist before you publish

- [ ] Fill every `[ACTION REQUIRED]` in `src/lib/site.ts`, `Terms.tsx` and `Privacy.tsx`.
- [ ] Run `0025_business_listing_terms_v2.sql` in Supabase and open the listing-submit screen to see the new text.
- [ ] `npm install` and `npm run build` (I could only syntax-check here).
- [ ] Confirm every migration is applied on production and the pg_cron jobs exist.
- [ ] Switch Razorpay from test to live only after the refund policy is written and GST is decided.
- [ ] Decide how you will handle deletion requests and write the procedure (or build item 8.1).
- [ ] Send the Terms, the Privacy Policy and the 0025 text to a lawyer. Remove the "Draft for launch" banner only after that.
- [ ] Check Hindi / Marathi strings with a native speaker.
- [ ] Use a business email for contact if possible.
- [ ] Test: sign up (email and Google) shows the notice with working links; the listing-submit screen shows v2 and links; owners can hide their phone number; a test booking, review and payment behave as the Terms say.
