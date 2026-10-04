# Blisscco — Phases 1–3

## Status (honest)
- Written: migrations 0001–0005, admin bootstrap SQL, security test script.
- **NOT yet run against a real Supabase project.** I had no database/network in this environment,
  so nothing here is tested yet. Run the steps below and the test script, then tell me any error text.
- Frontend (Vite/React/TS) starts in Phase 3.

## Setup
1. Create a **new** Supabase project for Blisscco (not shared with Kissaan Saathi).
2. Dashboard > Authentication > Providers > Email: turn **Confirm email ON**.
3. Dashboard > Authentication > URL Configuration: set Site URL to your Vercel URL
   (add `http://localhost:5173` as a redirect URL for development).
4. Dashboard > SQL Editor: run in order
   `0001_extensions_types.sql`, `0002_profiles_roles.sql`, `0003_business_core.sql`,
   `0004_approval_workflow.sql`, `0005_storage.sql`.
   (Or use the Supabase CLI: `supabase db push`.)
5. On a **test** project, run `tests/phase2_rls_tests.sql`. Expect the notice
   `ALL PHASE 1-2 SECURITY TESTS PASSED`.
6. Sign up on the site with your own email, verify it, then run `manual/create_first_admin.sql`
   with your email. Log out and back in.

## How it works
- **Roles:** `customer`, `owner`, `admin`. Signup can choose customer or owner only. Admin can only be
  set from the SQL Editor. A trigger and column grants block any API attempt to change role.
- **Business states:** draft → pending_review → approved / rejected (with reason);
  approved ↔ suspended (admin) and approved ↔ inactive (owner).
  Owners cannot write `status`; only the functions in `0004` can.
- **Submission checks (server-side):** verified email, category, description, phone, email, address,
  coordinates, 3+ photos, opening hours, 1+ priced service, current terms accepted.
- **Public data:** anonymous users can only read the `public_businesses` view (approved only,
  no owner id, phone/email only if owner allows). Children (services, hours, images) are public
  only when the business is approved.
- **Images:** private bucket `business-images`, path `{business_id}/{uuid}.jpg|png|webp`, 5 MB max.
  Public gets signed URLs only after approval.
- **Audit:** admin approve/reject/suspend actions write to `admin_audit_logs` and status history.

## Frontend calls (for Phase 3+)
- `supabase.rpc('accept_business_terms', { p_business_id })`
- `supabase.rpc('submit_business_application', { p_business_id })`
- `supabase.rpc('admin_review_business', { p_business_id, p_approve, p_reason })`
- `supabase.rpc('admin_set_business_status', { p_business_id, p_target, p_reason })`
- `supabase.rpc('owner_set_business_active', { p_business_id, p_active })`

## Known decisions / limits
- Terms text is a **placeholder**; get lawyer-reviewed T&C before launch.
- Editing an approved listing's material fields (name, location, category) is blocked for now;
  the change-request review flow comes in Phase 4.
- Images use signed URLs (no CDN caching). If load becomes slow, Phase 4 can copy approved images to a public bucket.
- No India-only coordinate check, so testing from anywhere works.

## Next: Phase 3
Vite + React + TS + Tailwind scaffold, Blisscco design system/logo, routing, en/hi/mr i18n, auth screens.

---
# Phase 3 — App scaffold (Vite + React + TypeScript + Tailwind)

## Status (honest)
Code written, but **not installed, type-checked or built yet**: my environment has no internet for `npm install`.
Please run the steps below; if `npm run build` shows any error, send me the exact text and I will fix it.

## What is included
- Blisscco logo (`public/logo.svg`) and palette: #FDF8F5, #2D2A2E, #FF91A4 (Tailwind: cream / ink / blush)
- English / Hindi / Marathi (`src/i18n/messages.ts`), language selector in header, saved in browser and in your profile
- Supabase Auth: customer + business-owner register/login, admin login page (`/admin/login`), forgot/reset password
- Role-aware redirect after login, route guard (UX only; the database RLS is the real security)
- Placeholder owner/admin dashboards, home page shell (search is disabled until Phase 5; no fake results)

## Run locally
1. Install Node.js 20+.
2. `npm install`
3. Copy `.env.example` to `.env`; paste your Supabase Project URL and the **anon** key (Project Settings > API).
   Never use the service_role key here.
4. `npm run dev` -> open http://localhost:5173
5. `npm run build` to check the production build.

## Deploy (GitHub + Vercel)
1. Push this folder to a new GitHub repo (the `.env` file is git-ignored).
2. Vercel > Add New Project > import the repo (Framework: Vite is auto-detected).
3. Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then Deploy.
4. Copy the Vercel URL, then in Supabase > Authentication > URL Configuration set Site URL to it and add
   Redirect URLs: `https://YOUR-URL/login` and `https://YOUR-URL/reset-password`
   (also `http://localhost:5173/**` for local testing).

## Not in Phase 3 (coming)
Business onboarding form (Phase 4), GPS search (5), booking/queue (6), PWA icons/manifest/push (10).

---
# Phase 4 - Onboarding, admin approval, public business page
- Owner: /owner (dashboard) > /owner/business/new > /owner/business/:id (details, GPS location, photos, hours, services, terms, submit)
- Admin: /admin > /admin/applications (review photos, services, location; approve / reject with reason; suspend / reactivate), /admin/categories
- Public: /b/:id (approved businesses only) with services, prices, hours and Get Directions
- No new SQL in Phase 4.
- Known limits: material edits to an approved listing (name, location, category) are still locked (change-request flow is a later item);
  server error text on submit is shown as returned by the database (English).
- Not tested: I could not run npm/build here. Please run `npm run build` and send any error text.

---
# Phase 5 - Discovery
- `/` shows a welcome page (Browse shops near you / Login as a business + quotes) to visitors without an account; signed-in users go to discovery.
- `/explore` is public. It asks for GPS only after the user taps the button, keeps it in memory only, and shows shops within 5 km.
  The 5 km limit is enforced inside the database functions `nearby_businesses` and `search_services` (migration 0008), not in the UI.
- Search speed: indexes `services_search_cover_idx` and `business_images_cover_lookup_idx` (in 0020) on top of the existing `businesses_location_gix`; measure with `supabase/manual/benchmark_search.sql`.
- Search matches service, shop name and category (English/Hindi/Marathi). Filters: category, max price, open now. Sort: nearest or lowest price.
- "Open now" is computed from saved opening hours in India time. Ratings/reviews and PRO/ELITE badges arrive in later phases (cards say "No reviews yet").
- Opening hours: pick open days and one time; it applies to all open days (per-day override is optional).
- Services are now just "service + price" (no name/duration). Appointment length will be a shop-level setting in Phase 6.

---
# Phase 6 - Booking, walk-in tokens, queue (migration 0009)
- Customers (logged in) book from a shop page: appointment (date + slot) or walk-in token. Free, pay at the shop; free cancellation.
- Appointments: slots follow the shop's opening hours and the shop's "slot length" and "customers at the same time" settings. Double-booking is blocked in the database (per-shop lock + capacity check).
- Walk-in tokens: numbered per shop per day (unique in the database). One active token per customer per shop per day. Owners can also issue tokens for people standing in the shop (no account).
- Queue is maintained by hand by the owner (/owner/business/:id/queue). Customers see counts, next token, estimated wait and the last-updated time; a warning shows if it is older than 1 hour.
- Status flow (enforced): pending > confirmed > checked in > in service > completed; cancelled / no-show. Customers can only cancel their own booking. Only the shop owner can move other statuses. Every change is logged in booking_status_history.
- Not in this phase: booking notifications / reminders (Phase 10), admin booking tools (Phase 11), reviews and referral rewards that use "completed" (Phase 7).
- Time zone is fixed to India (Asia/Kolkata).

---
# Phase 7 - Reviews, Refer & Earn, business-funded coupons (migration 0010)
- Reviews: only the customer of a COMPLETED booking can review it, once (enforced in the database). Owners can reply and report; admin removes (audited). Ratings are averaged from real published reviews only. Review photos are NOT included yet.
- Refer & Earn (/refer): each customer gets a unique code/link (WhatsApp, share, copy). Reward flow, all checked in the database:
  new customer joins via link (attribution fixed once) > verifies e-mail (Supabase Auth, never client-supplied) > a shop that is not the referrer's/referred's
  marks a service completed > one random coupon is issued to the referrer. One reward per verified e-mail (Gmail dots and +tags are ignored); self-referral blocked.
- The campaign is OFF until an admin adds reward options and switches it on (/admin/referrals). No amount is advertised before that.
- Coupons: unique secure codes, expiry, min spend, discount cap, single use. The shop that redeems funds the discount (/owner/business/:id/coupons).
  Shops can opt out ("Accept referral coupons") in Booking settings. UPDATE your listing Terms & Conditions text to mention this.
- E-mail verification uses the normal Supabase sign-up confirmation mail (Google sign-in is already verified). No SMS provider is needed. Migration 0021 removed the old phone-OTP columns and trigger.
- Not in this phase: rating sort in search, review photos, campaigns beyond the single global one.

---

# Phase 8 - Plans, Razorpay payments, banners, blue badge (migration 0011 + Vercel API routes)

## Status (honest)
Written but **not run**: I had no database, npm or network here. A syntax-only TypeScript check passed; a real
`npm install && npm run build`, the SQL migration and `tests/phase8_payments_tests.sql` still need to be run by you.
The Razorpay raw-body signature check in particular must be proven with a Razorpay **test** webhook (see step 6).

## Prices (my assumption - please confirm)
Your four numbers were 499, 799, 99, 599. I mapped them as: **PRO 499/month, ELITE 799/month, Blue badge 99 (valid 365 days), Extra banner 599 (= +1 banner credit)**.
They live only in `public.plans` (paise). To change: `update public.plans set amount_paise = 59900 where code = 'banner_extra';`
(also `duration_days`, `banner_credits`). The browser never sends a price.

## How it works
- **Entitlements:** `has_entitlement(business, 'analytics' | 'banner' | 'priority' | 'blue_badge')` checks expiry live, so an expired plan stops
  counting at the exact second, even before the job runs. `pg_cron` job `blisscco-expire-subscriptions` runs daily at 00:00 India time and marks rows expired.
- **Credits:** each paid PRO month grants 2 banner credits, ELITE 5 (ledger table `banner_credits`). A banner uses 1 credit, runs 30 days after admin approval,
  and the credit comes back if the banner is rejected or cancelled while pending. Creating/showing a banner needs an active PRO/ELITE plan.
- **Ranking:** inside `nearby_businesses` / `search_services` (still only 5 km): ELITE first, then PRO, then FREE; your chosen sort (distance/price) applies inside each tier.
  Paid shops carry a PRO/ELITE chip and the blue tick shows next to the name. Banners appear above results, labelled "Sponsored".
- **Payment flow:** `/api/create-order` checks your login token, calls `create_payment_txn` (ownership, approved shop, amount from DB), creates the Razorpay order,
  returns it to Checkout. Nothing activates from the browser redirect. `/api/razorpay-webhook` verifies the HMAC-SHA256 signature of the raw body, then
  `process_razorpay_event` (service-role only) activates inside ONE transaction.
- **Replay safety (3 layers):** `webhook_events.event_id` is the primary key; a transaction can only be `created -> paid` once; `subscriptions.payment_transaction_id` is unique.
- **Amount check:** captured amount/currency must equal the amount stored at order time, else status `amount_mismatch` and nothing activates (visible in /admin/payments).
- **Refunds:** `refund.processed` is handled. Full refund = subscription marked `refunded` (benefit ends at once) and that payment's credits reversed. Partial refund = recorded only; entitlement stays (admin decides).
- **Blue badge:** owner uploads a GST / shop-licence / Udyam document (private bucket, only owner + admin) > admin approves at /admin/verifications > owner pays the badge fee > tick shows.
- **Renewals:** no auto-debit yet. Renewing a still-active plan stacks the new period after the current expiry. The plans page shows a reminder banner in the last 7 days.
  (Email/push reminder arrives with notifications in Phase 10.)

## Setup steps
1. Supabase > Database > Extensions: enable **pg_cron** (if the migration prints a notice that scheduling was skipped, enable it and re-run 0011).
2. Run `migrations/0011_subscriptions_payments_banners.sql`, then on a TEST project `tests/phase8_payments_tests.sql` (expect `ALL PHASE 8 TESTS PASSED`).
   Run 0010 first if you have not (RUN_LOG still shows it as not run).
3. `npm install` (adds `@vercel/node`), `npm run build`.
4. Razorpay Dashboard (Test mode): copy Key Id + Key Secret.
5. Vercel > Settings > Environment Variables: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (Sensitive), `RAZORPAY_WEBHOOK_SECRET` (Sensitive), `SUPABASE_SERVICE_ROLE_KEY` (Sensitive). Redeploy.
6. Razorpay > Webhooks > Add: URL `https://YOUR-SITE/api/razorpay-webhook`, your own secret (same as `RAZORPAY_WEBHOOK_SECRET`), events: `payment.captured`, `refund.processed` (others are harmless).
   Test: buy PRO with a Razorpay test card, check `/admin/payments` shows `activated`. Use the dashboard's "resend" to prove the replay shows `duplicate`.
7. Go live only after Razorpay KYC is approved: swap to live keys + a live-mode webhook.

## Known limits
- Search ranking puts paid tiers first even when sorting by price (this is what "ELITE > PRO > FREE" means); the chip makes it visible.
- Upgrading PRO > ELITE midway is not pro-rated: both periods run, the higher tier wins while both are active.
- Razorpay Subscriptions (auto-renewal), GST invoices, and the analytics screen itself (only the `analytics` entitlement exists) are not in this phase.
- Terms & Conditions / refund policy text must mention paid plans before you take live payments.

---

# Phase 9 - Analytics, QR code, ELITE AI insights (migration 0012 + `/api/ai-insights`)

## Status (honest)
Written but **not run**: no database, npm install or network here. A syntax-only TypeScript check passed for every new/edited file;
`npm install && npm run build`, migration 0012 and `tests/phase9_analytics_tests.sql` still need to be run by you.
Two things only a real run can prove: (1) that Supabase passes the browser's `User-Agent` to the database (the bot filter relies on it; step 6),
(2) your AI provider call (step 5).

## What it does
- **Tracking (anonymous):** `analytics_events` stores only shop id, event (profile view / search impression / booking), source (qr / search / referral / direct), time,
  an anonymous session hash and a de-duplication key. No user id, name, phone, email, IP or user-agent. The session hash is `sha256(random per-tab id + India date)`, so it changes daily.
- **Duplicate filter:** one view or impression per visitor per shop per 30 minutes; one booking event per real booking.
- **Estimated, not unique:** visitors are anonymous (random tab id, new every day), so the numbers are ESTIMATES. The screen and the AI insights say "estimated visitors" and never "unique visitors". Bookings are real counts.
- **Bot filter:** crawlers / scripts / link-preview fetchers (by user-agent) and automated browsers are dropped; one anonymous session cannot create more than 300 events per hour;
  the shop's own owner and admins never count; only approved shops count.
- **Bookings cannot be faked:** `track_event('booking')` only counts for a logged-in customer who really created a booking at that shop in the last 10 minutes.
- **Source:** `/b/:id?src=qr` (QR), `?src=search` (Explore results and banners), `?src=referral` or a visitor who still carries a Refer & Earn code, otherwise `direct`.
- **`get_analytics(business, from, to)`:** owner only AND an active PRO/ELITE plan (`has_entitlement(..., 'analytics')`). India-time days, 1-366 day range.
  Screen: `/owner/business/:id/analytics` (7 / 30 / 90 days, funnel, by source, per-day chart). FREE owners see an upgrade card.
- **QR:** `/owner/business/:id/qr` (all approved shops, no plan needed): QR of `https://YOUR-SITE/b/:id?src=qr`, made in the browser (library `qrcode`), PNG download, print, copy link.
- **AI insights (ELITE):** `/api/ai-insights`. Order: login token > key configured (else **503 configuration_required**, no fake answer) > database `claim_ai_insight`
  (owner + live ELITE + max 10 per 24 h) > `get_analytics` with the owner's own token > AI call with **aggregate numbers only** (no shop name, no ids, no customer data).
  The route uses only the anon key and the owner's token: no service-role key is needed here.
- **Retention:** raw events are deleted after 400 days (pg_cron weekly job `blisscco-purge-analytics`). Privacy Policy has a line about this.

## Setup steps
1. Run `migrations/0012_analytics_ai_qr.sql` in the Supabase SQL Editor (after 0010 and 0011). Then on a TEST project run `tests/phase9_analytics_tests.sql` (expect `ALL PHASE 9 TESTS PASSED`).
2. `npm install` (adds `qrcode` + `@types/qrcode`) and `npm run build`.
3. Push to GitHub; Vercel redeploys. `vercel.json` now gives `/api/ai-insights` up to 30 seconds.
4. QR: open Owner > your approved shop > "Shop QR code", download or print.
5. AI (only when you have the key): Vercel > Settings > Environment Variables: `AI_API_KEY` (Sensitive). Optional `AI_PROVIDER` (`anthropic` default or `openai`), `AI_MODEL`
   (required for `openai`), `AI_BASE_URL`. Redeploy. Until then the AI card says "Configuration required".
6. Check tracking: open a shop link `https://YOUR-SITE/b/<id>?src=qr` in a private window (not logged in as the owner), then in Supabase run
   `select event_type, source, count(*) from analytics_events group by 1, 2;`. If nothing appears, tell me: the user-agent header may need another route.

## Known limits
- Counts are approximate by design (anonymous, 30-minute de-duplication). A person using two devices counts twice.
- Visitors with JavaScript blocked are not counted. Referral attribution is a best effort (the stored referral code stays until signup).
- A provider failure after `claim_ai_insight` still uses one of the 10 daily tries.
- No data export, no per-service analytics, no push/email reports (Phase 10).

---

# Phase 10 - Notifications (in-app, web-push, email) + PWA (migration 0013, `/api/dispatch-notifications`)

## Status (honest)
Written but **not run**: no database, npm install or network here. Every TypeScript/JavaScript file passed a syntax-only check;
the SQL was reviewed by hand but never executed. You still need to: run `0013`, run `tests/phase10_notifications_tests.sql`,
`npm install && npm run build`, and prove push + email with the **test button** (step 8). Things only a real run can prove:
(1) `pg_net` can call your Vercel route, (2) your VAPID keys work, (3) Resend accepts your sender domain.

## What it does
- **In-app:** bell in the header (live unread count), `/notifications` list, `/notifications/settings`.
- **Events that create notifications (database triggers, so nothing can be skipped by a buggy screen):**
  - booking: new booking/token (owner + customer), cancelled by shop / by customer, "your turn" (in service), completed (review prompt), no-show
  - approval: shop approved / rejected (with reason) / suspended / reactivated, banner approved / rejected, blue-badge document approved / rejected; admins are told about new pending shops, banners and documents
  - review: new review (owner), owner reply (customer), review removed (owner)
  - payment: payment received, refund (full or partial), amount mismatch (payer + admins)
- **Reminders (pg_cron):** appointment ~24 h and ~2 h before (every 10 min job); coupon expiring (within 3 days) and plan / badge expiring (7 days, then 1 day) once a day at 10:00 India time. Each reminder has a dedupe key, so it can only be created once.
- **Push:** `web-push` + VAPID. **Email:** Resend API. Text is written once in `api/_lib/notificationText.ts` (en / hi / mr) and used by the app, push and email.
- **Preferences:** push on/off, email on/off, mute whole topics (booking, approval, review, payment, reminder). Muted topics stay in the in-app list but send no push/email.
- **PWA:** `manifest.webmanifest`, icons (192, 512, maskable, Apple touch), `sw.js`, `offline.html`, install banner (Chrome/Android button; iPhone shows "Share > Add to Home Screen").

## "Delivered" is never assumed (your rule)
Each push/email is a row in `notification_deliveries`: `pending > sending > sent | failed` (or `skipped` when there is nothing to send to).
- `sent` is written **only after** the provider accepted it (push service 2xx / Resend 2xx with an id). The screen shows exactly this status ("Email sent", "Push failed", "Email retrying", "Push queued").
- Provider error -> back to `pending`, retry after 2 / 4 / 8 / 16 minutes (5 tries) -> `failed`. A timeout or crash mid-send leaves the row `sending`; after 5 minutes it is picked up again. It is never silently marked sent.
- "Sent" means the provider accepted it. It does not prove the person read it or that the mail reached the inbox (that would need a Resend delivery webhook; not included).
- If one person has several devices and at least one accepts the push, the delivery counts as sent; the failing devices are not retried (avoids duplicates on the good ones). Dead subscriptions (404/410) are deleted automatically.
- **No notification problem can break a booking, review or payment:** every trigger catches its own errors (test T11 proves it with a deliberately broken table).

## Setup steps
1. Supabase > Database > Extensions: enable **pg_net** and **pg_cron** (pg_cron was already needed in Phase 8).
2. Run `migrations/0013_notifications.sql`. Then on a TEST project run `tests/phase10_notifications_tests.sql` (expect `ALL PHASE 10 TESTS PASSED`).
3. Make VAPID keys: `npx web-push generate-vapid-keys` (public key + private key).
4. Resend: create an account, **verify your sending domain** (Domains), create an API key. Until the domain is verified, Resend only lets you send test mail from `onboarding@resend.dev` to your own account email.
5. Generate a random secret: `openssl rand -hex 32` (this is `NOTIFY_CRON_SECRET`).
6. Vercel > Settings > Environment Variables (see `.env.example`): `VITE_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (Sensitive), `VAPID_SUBJECT`, `RESEND_API_KEY` (Sensitive), `RESEND_FROM`, `NOTIFY_CRON_SECRET` (Sensitive), `SITE_URL`. Redeploy (the `VITE_` key is baked in at build time).
7. Edit and run `supabase/manual/set_notification_config.sql` once (your Vercel URL + the same secret). Optional check query is inside the file (`200` = working, `401` = secret mismatch).
8. `npm install` (adds `web-push`), push to GitHub, let Vercel deploy. Open the site, log in, **Notifications > Settings > Turn on for this device**, then **Send a test notification**. Within a minute the Notifications list should show "Push sent" and "Email sent". If it shows "failed" or "retrying", Vercel > Logs for `/api/dispatch-notifications` shows the status code (no secrets are logged).

## Known limits
- iPhone / iPad: web push only works after "Add to Home Screen" (iOS 16.4+). The settings page explains this. Other browsers: Chrome, Edge, Firefox, Samsung Internet on Android and desktop work in the normal tab.
- The service worker is registered only in the production build (not `npm run dev`), so test push on the Vercel site.
- Offline: only the offline page and build files are cached. Shops, bookings and queues need internet (the app never stores signed-in data offline).
- The reminder times use the server clock; an appointment booked less than ~3 h ahead gets no "2 hours" reminder and one booked less than 24 h ahead gets no "24 hours" reminder (they just booked).
- Push/email text is not editable per shop. Language follows the profile language of the person receiving it.
- Privacy Policy / Terms text must mention push endpoints, Resend (email) and Supabase/Vercel as processors before launch; I did not rewrite the legal text.
- Notifications are deleted after 90 days (weekly job `blisscco-purge-notifications`).
