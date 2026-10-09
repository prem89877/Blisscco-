# Blisscco update: Home icon in bottom bar + shop owner UPI ID

## What it does
- **Bottom bar:** the Settings icon (3rd, middle) is replaced by a **Home** icon (pink outline, filled when selected). Tapping it opens the **Browse shops** page (`/explore`). Language is still in the 3-line menu; notification settings are still reachable from Notifications > Settings. The `/settings` page itself is unchanged and still works if opened by link.
- **Shop owners can add a UPI ID** (Owner dashboard, and also under the Business Growth Credit balance on the Refer-a-Shop page). Used so Blisscco can pay the owner after the promotional balance is fully used. Owner can add, update and remove it. Format is checked in the app and in the database (for example `name@okhdfcbank`).
- **Admin > Owner UPI IDs** (new page): every shop owner with UPI ID, current promotional balance, total earned, a "Balance used up" tag, search and a Copy button.
- Only the owner and admins can read a UPI ID (own table + RLS, writes only through `set_my_upi_id`). Privacy page has one new sentence about it.

## Setup
- Run `supabase/migrations/0035_owner_upi_id.sql` BEFORE deploying (needs 0030; safe to re-run). No new package, no new environment variable.

## Changed files
- src/components/BottomNav.tsx
- src/App.tsx
- src/pages/owner/OwnerDashboard.tsx, src/pages/owner/OwnerCompetition.tsx
- src/pages/admin/AdminHome.tsx
- src/pages/Privacy.tsx
- src/i18n/messages.ts (new phase 27 block, EN / HI / MR)
- supabase/RUN_LOG.md, CHANGES.md

## New files
- public/icons/nav/home.png, public/icons/nav/home-filled.png
- src/components/UpiIdCard.tsx, src/lib/upi.ts
- src/pages/admin/AdminOwnerUpi.tsx
- supabase/migrations/0035_owner_upi_id.sql

---

# Blisscco update: 3 photos per service (Add business + Edit business)

## What it does
- Every service can now have **up to 3 optional photos**.
- **Add business** (Services step) and **Edit business** (live shop page) use the same Services section: while adding a new service you can pick up to 3 photos, and for any saved service you can **Add photo / Change / Remove** (max 3, enforced in the database too).
- The public shop page shows the service photos as small thumbnails inside each service card.
- Photos are optional; the "at least 3 shop photos" rule is unchanged.

## Setup
- Run `supabase/migrations/0034_service_images.sql` BEFORE deploying (safe to re-run). No new package, no new environment variable. Photos use the existing private `business-images` bucket.

## Changed files
- src/components/editor/ServicesSection.tsx
- src/pages/owner/BusinessEditor.tsx
- src/pages/BusinessProfile.tsx
- src/lib/types.ts
- src/i18n/messages.ts (new ed.svcPhoto* keys, EN / HI / MR)
- supabase/RUN_LOG.md, CHANGES.md

## New files
- supabase/migrations/0034_service_images.sql

---

# Blisscco update: Refer-a-Shop Competition

## What it does
- **Admin controls everything** (Admin dashboard > Refer-a-Shop Competition): create a competition with title, description, **start / end date-time (India time)** and **prize amount in Rs**; quick buttons 7 / 15 / 30 days; then **Start, Pause, Resume, End and declare winner**, Edit, Delete draft. Only one competition can be live at a time. Nothing is hard-coded: dates, prize, counts, winner and reward are all stored in Supabase, so any number of future competitions can be created.
- **Owners** (Business dashboard > Refer-a-Shop Competition, also a footer link): see the prize, start / end date, a live **countdown**, the **leaderboard** (rank, shop name, successful referrals), **their own rank**, their referral code / link (WhatsApp, Share, Copy), each referral with its 3 progress steps, and their **Business Growth Credit** balance.
- A referral **counts only when all 4 are true**: (1) the business owner signed up through the referrer's link, (2) the business profile is complete, (3) its phone number is verified, (4) Blisscco admin approved the business. Only approved, eligible referrals are on the leaderboard. A business that is later suspended / rejected drops off the board.
- Extra safety: a phone number can count only once; the referred phone cannot be the referrer's own; only owners with an approved shop get a referral link; the referral is attributed once and cannot be changed (account must be less than 7 days old).
- **Winner** = most valid referrals (tie: whoever reached that count first). When admin presses End (or the end time passes: automatic check every 5 minutes) the winner is stored and **Rs prize is added as "Business Growth Credit"** (promotional wallet ledger, once only). It is NOT cash: there is no withdraw option.
- Pause: while paused, referrals that become valid are not counted for the competition.
- A referral counts for the competition that is active at the moment its 4th step is completed.

## Phone verification (important)
Phone OTP was removed from the project in migration 0021, so there is no SMS provider. The phone check is therefore done by admin: in **Referral checks** (admin competition page) press **Mark phone verified** after confirming the number (for example by calling it). Changing a business phone number removes the verification automatically. If you add an SMS-OTP provider later, set `businesses.phone_verified_at` from your server after a successful OTP and nothing else needs to change.

## Credit usage
The wallet balance, ledger and a server-side function `spend_growth_credit(owner, amount, note)` (service role only, never below zero) are in place. Using the credit at the checkout of a banner / plan / campaign is a separate step and is not wired yet.

## Setup
- Run `supabase/migrations/0030_refer_a_shop_competition.sql` BEFORE deploying (safe to re-run). No new package, no new environment variable. pg_cron is optional (only for automatic ending).
- Share link format: `https://YOUR-SITE/owner/register?sref=CODE` (separate from the customer `?ref=` link).

## Changed files
- src/App.tsx, src/main.tsx, src/components/Layout.tsx
- src/pages/admin/AdminHome.tsx, src/pages/owner/OwnerDashboard.tsx
- src/i18n/messages.ts (new p23 block, EN / HI / MR)
- supabase/RUN_LOG.md, CHANGES.md

## New files
- supabase/migrations/0030_refer_a_shop_competition.sql
- src/lib/shopReferral.ts
- src/pages/owner/OwnerCompetition.tsx, src/pages/admin/AdminCompetition.tsx

---

# Blisscco update: QR Rs 100, simple add-business steps, Edit profile, tutorial

## What changes
- **Physical QR poster price is now Rs 100** (was Rs 50). The price is stored only in the database (`plans.physical_qr`), so run migration 0027; no code change is needed for the price itself.
- **Add / edit business is now step by step** (draft or rejected shop): About > Contact > Photos > Timings > Services > Submit, with a progress bar, "Save & next" and Back. Nothing typed is lost when going back and forth. The first page (name + category) got short helper texts.
- **New "Edit profile" tile** (pencil icon) on every approved / hidden shop in My businesses, next to Manage (Manage now has a sliders icon). A live shop can now change description, phone, e-mail and the two "show publicly" switches. Name, category, address and map location stay locked (they need admin review).
- **Tutorial** (3-4 short cards, English / Hindi / Marathi) shows on its own the first time on the Add business page and on the Edit business page (separate one for a live shop). A **"How it works"** button on both pages opens it again any time. "Seen" is remembered in the browser (localStorage).

- **Photos can be edited on a live shop**: each photo has **Change** and **Remove**, plus **Upload**. At least 3 photos must stay while live. A changed photo is saved first, the old one is removed after.

## Setup
- Run `supabase/migrations/0027_qr_price_100_live_edit.sql` and then `0028_live_photos_edit.sql` BEFORE deploying (both safe to re-run). No new package, no new environment variable.

## Changed files
- src/pages/owner/BusinessEditor.tsx, src/pages/owner/NewBusiness.tsx, src/pages/owner/OwnerDashboard.tsx
- src/components/editor/DetailsSection.tsx, src/components/editor/HoursSection.tsx, src/components/editor/PhotosSection.tsx
- src/i18n/messages.ts (new p22 block, EN / HI / MR)
- supabase/RUN_LOG.md, CHANGES.md

## New files
- src/components/Tutorial.tsx
- supabase/migrations/0027_qr_price_100_live_edit.sql, supabase/migrations/0028_live_photos_edit.sql

---

# Blisscco update: live navigation (Part 2)

## What the customer gets
- Shop page > Navigate > location permission > route > **Start navigation** > live tracking > turn-by-turn > **You're here**. The customer never leaves Blisscco (no Google / Apple Maps).
- Compact bottom card: remaining distance and time, next instruction in plain words ("Turn right in 150 m"), a progress bar and an End button.
- Wrong turn: after 3 fixes in a row far from the route a quiet "Recalculating route..." message shows and ONE new route is requested; the last good route stays on the map if that fails.
- Weak signal / offline messages ("Weak GPS signal...", "Connection lost. Trying again...") never stop navigation; progress is calculated on the phone, so it keeps working offline.
- Map follows the customer gently; moving or zooming the map by hand stops following; the **Recenter** button (large, labelled) turns it back on.
- Arrival (within ~30 m of the shop): "You're here" card with the shop name and a View shop button; GPS tracking stops.
- Texts in English, Hindi and Marathi. No coordinates are shown anywhere.

## Setup
- No SQL, no new environment variable, no new package. Optional server variable `ROUTE_MAX_KM` (default 400).
- `/api/route` now reads the shop's saved location from the database when the page sends `shopId`.

## Changed files
- api/route.ts, api/_lib/routing.ts, .env.example, CHANGES.md, package.json (only a `test` script)
- src/i18n/messages.ts (new p21 block, EN / HI / MR)
- src/pages/Navigate.tsx
- src/components/navigation/NavInfoCard.tsx, src/components/navigation/NavMap.tsx
- src/lib/navigation/types.ts, NavigationService.ts, LocationService.ts, RoutingProvider.ts, MapProvider.ts, leafletMapProvider.ts, navigation.css, config.ts

## New files
- api/_lib/shopLocation.ts
- src/lib/navigation/geo.ts, instructions.ts, DeviceServices.ts
- src/components/navigation/NavLiveCard.tsx, NavArrivedCard.tsx, DirectionIcon.tsx
- tests/navigation/helpers.ts, navigation.test.ts, units.test.ts   (run with `npm test`)

---

# Blisscco update: test-notification button removed, operator name

- Removed the "Send a test notification" box from Notifications > Settings (`src/pages/NotificationSettings.tsx`). The database function `send_test_notification` and the unused text keys are left in place (harmless).
- Privacy Policy and Terms now say Blisscco is run by **Janvi** (`OPERATOR_NAME` in `src/lib/site.ts`). The Grievance Officer is Prem Talekar, listed as Customer Care Employee (`GRIEVANCE_OFFICER`). `CONTACT_EMAIL` is unchanged.

---

# Blisscco update: Phase 1 Technical SEO

## Vercel environment variables (set once, then redeploy)
- `SITE_URL=https://YOUR-REAL-DOMAIN` and `VITE_SITE_URL=` (same value). Used for canonical / Open Graph URLs, sitemap.xml, robots.txt and the link-preview image. Without them the site falls back to the Vercel production domain / the address the page is opened on.

## What changed
- **Per-page metadata** (title, description, canonical, robots, Open Graph, Twitter) through one new component `src/components/Seo.tsx`. Every route renders one, so a noindex can never leak to another page.
- **Indexable pages:** home, /explore, /privacy, /terms, every approved shop page /b/:id (title = "Shop - Category in City | Blisscco", description from the shop's own description).
- **noindex:** login / register / forgot / reset / callback pages, all owner / admin / customer account pages, 404, and "shop not found".
- **sitemap.xml** (`api/sitemap.ts`): home, explore, privacy, terms + all approved shops read from `public_businesses`. **robots.txt** (`api/robots.ts`): blocks admin, owner dashboard, my-bookings, notifications, refer, auth routes and /api/; points to the sitemap.
- **Structured data (JSON-LD):** Organization + WebSite on home; LocalBusiness on shop pages (name, address, geo, phone only if the owner shows it, opening hours, rating only if reviews exist). No SearchAction / price / image schema because the data is not available as stable public values.
- **404 page** (`src/pages/NotFound.tsx`): unknown URLs no longer show the home page.
- **Image alt:** shop photos now have descriptive alt text (EN / HI / MR). Logo and decorative card images stay `alt=""`.
- **index.html:** better default title / description, Open Graph + Twitter tags, `<noscript>` fallback text.
- **vercel.json:** rewrites for robots / sitemap, immutable cache for hashed /assets, HSTS and basic security headers.

## Changed files
- index.html, vite.config.ts, vercel.json, .env.example, CHANGES.md
- src/App.tsx, src/pages/Landing.tsx, src/pages/Explore.tsx, src/pages/BusinessProfile.tsx
- src/pages/LegalPage.tsx, src/pages/Privacy.tsx, src/pages/Terms.tsx
- src/i18n/messages.ts   (new p19 block: EN / HI / MR)

## New files
- src/components/Seo.tsx, src/pages/NotFound.tsx
- api/robots.ts, api/sitemap.ts, api/_lib/siteUrl.ts

## Known limits
- The site is a client-rendered React app (Vite). Google runs the JavaScript and reads the per-page tags, but WhatsApp / Facebook previews do not, so a shared shop link shows the generic Blisscco preview. Real fix = prerender / server-render shop pages (a later phase).
- Unknown URLs return HTTP 200 (SPA rewrite) with a noindex 404 page, not a real 404 status.
- Not built / tested here (no network for `npm install`). Run `npm install && npm run build` once.

---

# Blisscco update: Legal-readiness audit (Terms, Privacy Policy, sign-up notice)

Full audit with every finding, risky-wording table and the pre-launch checklist: `LEGAL_AUDIT_REPORT.md`.

## Supabase (SQL Editor)
Run `supabase/migrations/0025_business_listing_terms_v2.sql` BEFORE onboarding shops. Safe to re-run. It only changes DATA: the business listing terms that owners accept were still the text "PLACEHOLDER - replace with reviewed Terms..."; v2 now holds real text and becomes the current version. No table, column or policy change.

## What changed
- **Privacy Policy** rewritten to match what the code really does (data collected, location, analytics, payments, notifications, third parties, retention, deletion, children, grievance contact). Removed or corrected claims that the code could not support (see audit report, section 6).
- **Terms of Service** rewritten: platform role, bookings and queue, reviews (they are NOT limited to completed services in the code), listings, paid services (blue badge, banners, physical QR), coupons and referrals, QR, suspension, liability. Removed the claim "Reviews must reflect a real, completed service".
- **Sign-up / login screens** now show "By continuing you agree to our Terms and Privacy Policy" (Google sign-in can create an account too). The listing-terms box now links to Terms and Privacy.
- **Wording fixes in the app:** home page text no longer says "trusted salons"; the blue tick tooltip says "Documents verified" (was "Verified business"). To undo either, delete the key from the `p18` block in `src/i18n/messages.ts`.
- Operator name, address, grievance officer, response time and court city are NOT in the project. They are placeholders marked `[ACTION REQUIRED ...]` in `src/lib/site.ts` and must be filled before launch.

## Changed files
- src/pages/Privacy.tsx, src/pages/Terms.tsx, src/pages/LegalPage.tsx
- src/lib/site.ts
- src/pages/Register.tsx, src/pages/Login.tsx
- src/components/editor/SubmitSection.tsx
- src/i18n/messages.ts   (new p18 block: EN / HI / MR)
- supabase/RUN_LOG.md, CHANGES.md

## New files
- src/components/LegalConsent.tsx
- supabase/migrations/0025_business_listing_terms_v2.sql
- LEGAL_AUDIT_REPORT.md

## Not tested
No `npm install` / build was possible here (no network). Files were only syntax-checked. Run `npm run build` once.

---

# Blisscco update: Physical QR poster (Rs 50, UPI)

## Supabase (SQL Editor)
Run `supabase/migrations/0024_physical_qr.sql` BEFORE deploying the new frontend. Safe to re-run. It only adds the plan kind `physical_qr` and one plan row (Rs 50 = 5000 paise). To change the price later: `update public.plans set amount_paise = 7500 where code = 'physical_qr';`

## What changed
- Owner **Shop QR code** page: the **Print** button is replaced by **"Get your personalized physical QR"** (Download PNG and Copy link stay).
- Tapping it opens a preview with the Blisscco poster: the shop name is printed under "blisscco" and the shop's own QR code sits in the white box.
- **Pay Rs 50 via UPI** opens Razorpay checkout showing only UPI (Google Pay, PhonePe, Paytm, BHIM, UPI ID). The price comes from the database; the browser never sends an amount. Booking is confirmed only after the Razorpay webhook marks the payment paid (same safe flow as the blue badge / banners).
- After booking, the page shows "Booked n time(s) already". Admin sees the payment in Admin > Payments as `physical_qr`; deliver to the shop address.
- Texts added in English, Hindi and Marathi. Only approved shops can book.
- The Plans page does not list the physical QR (it is sold only on the QR page).

## Changed files
- src/pages/owner/OwnerQR.tsx
- src/pages/owner/OwnerPlans.tsx
- src/lib/razorpay.ts
- src/lib/types.ts
- src/i18n/messages.ts
- supabase/RUN_LOG.md, CHANGES.md

## New files
- src/components/PhysicalQrOrder.tsx
- public/qr-poster-template.jpg
- supabase/migrations/0024_physical_qr.sql

---

# Blisscco update: India-only location + address / PIN code validation

## Supabase (SQL Editor)
Run `supabase/migrations/0023_india_validation.sql` BEFORE deploying the new frontend. Safe to re-run. No new column, no RLS change on existing tables (one new locked table `india_boundary` that only the database functions read). Old shops are not touched until their location / PIN / status is edited again.

## What changed
- **India polygon check.** A point is accepted only if: (1) latitude is a real latitude, (2) longitude is a real longitude, (3) the point is inside the India polygon (mainland + Andaman & Nicobar + Lakshadweep). Swapped lat/lng, 0,0, Nepal, Pakistan, Bangladesh, Sri Lanka etc. are refused.
- **Owner GPS button (Business editor > Details):** a location outside India is not saved; the owner sees a clear message. Saving the form checks again.
- **Customer Explore:** if the phone's location is outside India, nearby search is not run and a message is shown (retry button stays).
- **Address + PIN code:** street address (at least 5 characters, must contain letters), city (letters only), state (must be a real Indian state / UT; short forms like MH, UP, TN are fixed to the full name on save) and a 6-digit PIN code (cannot start with 0, first two digits must be a PIN series India Post uses). The PIN must belong to the state typed (for example 411001 with Karnataka is refused). When the owner types a PIN that has only one possible state, an empty State box is filled automatically.
- **Submit for review:** checklist now has a separate "Valid PIN code" line (PIN is now compulsory), and the location line only turns green when the point is inside India. Wrong values are explained in red under the list.
- **Server side (0023):** the same India polygon and PIN rules run in the database (`is_in_india`, `is_valid_in_pincode`, trigger `businesses_before_write`), so they cannot be skipped from the browser. Errors: `location_outside_india`, `invalid_pincode`, `application incomplete: valid PIN code`, `application incomplete: location inside India`.
- Texts added in English, Hindi and Marathi.

## Good to know
- The polygon is a simplified outline (about 10-20 km accuracy, coast padded offshore). Points right on the border can go either way; it is a sanity check, not a survey map. It covers India-administered territory.
- State vs PIN check is client side only (the database checks the PIN format and series, not the state).
- The nearby-search SQL functions were not changed.

## Changed files
- src/components/editor/DetailsSection.tsx   (GPS + save validation, PIN digits only, state fix / prefill, database error messages)
- src/components/editor/SubmitSection.tsx   (address, PIN and India location checks in the checklist)
- src/context/LocationContext.tsx   (new status `outside` for customers outside India)
- src/pages/Explore.tsx   (message + retry when outside India)
- src/i18n/messages.ts   (new p16 block, EN / HI / MR)
- supabase/RUN_LOG.md, CHANGES.md

## New files
- src/lib/indiaGeo.ts   (India GeoJSON polygon)
- src/lib/india.ts   (coordinate check, state list, PIN rules, address validation)
- supabase/migrations/0023_india_validation.sql
- supabase/tests/phase11c_india_tests.sql   (test project only; rolls back; not run by the assistant)

---

# Blisscco update: Razorpay replaced by Cashfree Payments

## Vercel environment variables
- Add: `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` (Sensitive). Optional `CASHFREE_ENV` = `sandbox` (default) or `production`.
- Remove (no longer used): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Redeploy after changing variables.

## Setup steps
1. Supabase SQL editor: run `supabase/migrations/0026_cashfree_gateway.sql` BEFORE deploying the new code (it renames the razorpay_* columns to gateway_* and replaces the two payment functions). Do not re-run 0011 afterwards.
2. Cashfree Dashboard > Developers > Webhooks > Add endpoint: `https://YOUR-SITE/api/cashfree-webhook`, events: Payment Success, Refund Status. (create-order also sends this URL as `notify_url` on https sites.)
3. Test in sandbox: buy a plan, `/admin/payments` should show `activated`. Resend the webhook from the Cashfree dashboard to see `duplicate`.
4. Go live: complete Cashfree KYC, put the LIVE App ID / Secret Key in Vercel and set `CASHFREE_ENV=production`, add the webhook in the live dashboard.

## How it works now
- `/api/create-order` creates a Cashfree order (order id = our receipt id, amount converted paise > rupees) and returns a `payment_session_id`; the browser opens Cashfree checkout (JS SDK v3) as a popup. Physical QR poster orders are limited to UPI (`order_meta.payment_methods = upi`).
- `/api/cashfree-webhook` verifies `base64(HMAC-SHA256(x-webhook-timestamp + rawBody, CASHFREE_SECRET_KEY))`, then `process_cashfree_event` (service-role only) activates / refunds inside ONE transaction. Event ids are built from the payload (`payment:<cf_payment_id>:<status>` / `refund:<cf_refund_id>:<status>`) so replays stay harmless. Only `PAYMENT_SUCCESS_WEBHOOK` and `REFUND_STATUS_WEBHOOK` (status SUCCESS) change anything; other events are stored and ignored.
- Nothing activates from the browser callback; the page waits for the webhook exactly like before.
- Customer phone sent to Cashfree = the shop's phone (last 10 digits); if the shop has none, a placeholder 9999999999 is used.

## Changed files
- api/create-order.ts, .env.example, README.md, CHANGES.md
- src/pages/owner/OwnerPlans.tsx, src/components/PhysicalQrOrder.tsx
- src/pages/Privacy.tsx, src/pages/Terms.tsx, src/pages/admin/AdminReports.tsx (text only), public/sw.js (comment only)
- supabase/RUN_LOG.md, supabase/tests/phase8_payments_tests.sql, phase9_analytics_tests.sql, phase10_notifications_tests.sql

## New files
- api/cashfree-webhook.ts, src/lib/cashfree.ts, supabase/migrations/0026_cashfree_gateway.sql

## Removed files
- api/razorpay-webhook.ts, src/lib/razorpay.ts

## Known limits
- Not run against a live database or the Cashfree sandbox here (no network). Test one sandbox payment end to end before going live.
- The business listing terms stored in the database (migration 0025) still say "Razorpay"; update them with a new terms version if you want that text changed.

---

# Blisscco update: Navigation page UI refresh

## What changes
- Navigation page background is now blush pink **#FF91A4** (page, loading screen and map background while tiles load).
- Cleaner UI: rounded bottom card with a small grab handle, white ring around floating buttons, shop name pill with a small round photo, shop photo thumbnail in the info card, pink time chip, dark direction badge and pink progress bar in the live card.
- Map shows small lanes (galiyan) better: default zoom 15 -> 17, route fit and follow zoom up to 18, retina tiles and a little extra contrast. (Which lanes are drawn finally depends on the tile provider; to get even more detail set `VITE_MAP_TILE_URL` to a more detailed tile server.)
- The "B" in the shop pin on the map is replaced by the **owner's first business photo** (small, round). If a shop has no photo, or it fails to load, the "B" stays.

## Changed files
- src/pages/Navigate.tsx
- src/components/navigation/NavMap.tsx
- src/components/navigation/NavInfoCard.tsx
- src/components/navigation/NavLiveCard.tsx
- src/components/navigation/NavArrivedCard.tsx
- src/lib/navigation/leafletMapProvider.ts
- src/lib/navigation/MapProvider.ts
- src/lib/navigation/navigation.css
- CHANGES.md
- supabase/RUN_LOG.md

## New files
- None. No new package, no new environment variable, no database change.

---

# Blisscco update: satellite map

## What changes
- The navigation map now uses **satellite imagery** (Esri World Imagery) instead of the plain street map.
- Streets, small lanes (galiyan) and place names are drawn on top of the satellite picture (Esri transportation + places overlay).
- The route line is now white-edged blush pink so it stays visible on dark satellite images.
- Where satellite pictures are not available at the deepest zoom, the last available picture is stretched instead of showing a blank tile.
- Optional env variables (all have defaults): `VITE_MAP_LABELS_URL` (overlay, `none` to hide), `VITE_MAP_TILE_NATIVE_ZOOM`. To go back to the street map set `VITE_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png`, `VITE_MAP_LABELS_URL=none` and the OSM attribution.

## Changed files
- src/lib/navigation/config.ts
- src/lib/navigation/MapProvider.ts
- src/lib/navigation/leafletMapProvider.ts
- src/lib/navigation/navigation.css
- .env.example (comments only)
- CHANGES.md
- supabase/RUN_LOG.md

## New files
- None.

---

# Blisscco fix: "Map data not yet available" on the satellite map

## What was wrong
At some places (small towns / rural areas) the satellite provider has no pictures at the deepest zoom and answers with a grey "Map data not yet available" tile instead. Also the map credit text ran under the back button / shop name bar.

## What changes
- The map now checks, around the shop, how deep **real** satellite pictures go (it looks at the pixels of a test tile) and requests tiles only down to that zoom. Deeper zoom stretches the last real picture, so the grey placeholder is never shown. The same check runs for the streets / names overlay.
- If the check cannot be done (offline / provider blocks it) the configured zoom is used; after 3.5 s the map is shown anyway.
- Map credit shortened to "© Esri, Maxar" and moved below the top bar so it no longer overlaps the buttons.
- `VITE_MAP_TILE_NATIVE_ZOOM` default is now 19 (the starting point of the check).

## Changed files
- src/lib/navigation/leafletMapProvider.ts
- src/lib/navigation/config.ts
- src/lib/navigation/navigation.css
- CHANGES.md
- supabase/RUN_LOG.md

## New files
- None.

---

# Blisscco update: live moving dot with direction arrow

## What was wrong
- The arrow on the "you" dot only appeared when the phone's GPS reported a heading, which most phones do not (it is empty while standing or walking slowly).
- The dot moved only after "Start navigation", and only with the readings the navigation service accepted for guidance (small moves and weak-accuracy readings were skipped).

## What changes
- **Dot moves in real time**: every GPS reading moves the dot straight away (smooth glide), already in the route preview and during navigation. Guidance (turns, off-route, arrival) still uses its own filtered readings, so nothing there changed.
- **Arrow always shows the way you face**: uses the GPS heading when the phone gives one, otherwise the direction you are moving (worked out from your last positions, ignoring GPS jitter under 5 m). When you stand still it follows the phone compass where the browser allows it (Android Chrome; iOS Safari when available). No extra permission is asked.
- The arrow turns the short way round and is now blush pink with a dark edge so it is visible on the satellite map.

## Changed files
- src/lib/navigation/leafletMapProvider.ts
- src/components/navigation/NavMap.tsx
- src/pages/Navigate.tsx
- src/lib/navigation/navigation.css
- CHANGES.md
- supabase/RUN_LOG.md

## New files
- None.

---

# Blisscco fix: shop photo stays inside the map pin

## What was wrong
A wide (landscape) shop photo was drawn at its own shape on the map pin and spilled outside the round window of the pin.

## What changes
- The photo is now drawn in a fixed 20 px round box (photo as "cover" background, centred), clipped to a circle with size set inline, so any photo shape (wide, tall, square, logo) is cropped inside the pin's round window and can never come out of it.
- The "B" is hidden only after the photo has really loaded; if the photo fails, the "B" stays.

## Changed files
- src/lib/navigation/leafletMapProvider.ts
- src/lib/navigation/navigation.css
- CHANGES.md
- supabase/RUN_LOG.md

## New files
- None.

---

# Blisscco fix: "Payment gateway is not reachable" now shows the real reason

## What was wrong
That message appears when the server could not create the order at Cashfree (or the Cashfree checkout script could not load). The real reason (wrong keys, sandbox/live mismatch, IP not allowed, bad return address...) was hidden, so it could not be fixed.

## What changes
- `/api/create-order` now reads Cashfree's own error (status, code, message) and returns it as a short `gateway_detail`; it is also written to the Vercel function logs together with the mode (sandbox / production). Keys are never included.
- The payment screens (Plans, Physical QR order) show it in brackets after the message, e.g. "Payment gateway is not reachable. Try again. (401 authentication_error authentication Failed)". If the Cashfree checkout script itself is blocked, it says "(checkout script blocked)".
- `return_url` and `notify_url` are now sent only for https addresses (Cashfree live mode rejects http and fails the whole order).

## Changed files
- api/create-order.ts
- src/pages/owner/OwnerPlans.tsx
- src/components/PhysicalQrOrder.tsx
- CHANGES.md
- supabase/RUN_LOG.md

## New files
- None.

---

# Blisscco update: Refer-a-Shop Competition - fraud protection

## What it does
- **Stricter referral rules.** A referral does NOT count when: the referred business is the referrer's own (same phone, e-mail, or same shop name + PIN under a second account); its phone already belonged to another Blisscco business before the referral; the same business / phone is referred again (only the **first valid attribution** is kept); its profile is incomplete, not approved by admin, or later rejected / suspended (it simply drops off the board); or admin marks it rejected / fraudulent.
- **Risk detection (never automatic rejection).** Several weak signals are added into a risk score: same browser as the referrer, same browser behind many accounts, same browser pattern, same network (weak, worth only 15), several accounts created within 30 minutes, unusual number of referrals from one account, made-up looking phone number, and identical shop name + PIN / e-mail / address / description / map location with another owner's business. A score of **50 or more puts the referral on hold** ("suspicious"): it is not counted on the leaderboard until an admin decides. One signal alone, like the same network, can never hold a referral. Owners only see "Under review", never the signals.
- **Admin > Referral fraud review** (new page): filter *Needs review / Decided / All*, see the reasons, and **Start review, Approve, Reject, Mark fraudulent, Reopen, Re-check risk** (note required). Rejected / fraudulent referrals never count. Every change is saved in an **append-only audit trail** (who, when, from -> to, note), shown per referral under *History*, and also written to the Audit log.
- **Winner protection.** Ending a competition now only picks a *provisional* winner (status "Verifying winner"). The admin ticks each qualifying referral of the winner as verified, and only then **Issue Business Growth Credit** works. It is blocked while suspicious referrals are waiting or if the ranking changed. The credit is issued **only once** (competition row lock, unique ledger index, database triggers). Prize, dates and title are frozen after the end. The wallet ledger can no longer be edited or deleted.
- **Server-side only.** Leaderboard counts, the winner and the reward amount are always computed / read in the database; the browser sends only ids and the admin's decision. Device ids are random / hashed; the IP is stored only as a hash.
- **Winner badges.** Your three badge images (1st / 2nd / 3rd) are used for the top 3 on the leaderboard (owner + admin) and for the winner.

## Run this
1. Supabase SQL editor: run `supabase/migrations/0031_shop_referral_fraud_protection.sql` (after 0030; do not re-run 0030 afterwards).
2. Optional (test project only): `supabase/tests/phase12_shop_fraud_tests.sql`. NOT RUN by the assistant (no database available) - please run and send me any error text.
3. Deploy the front end. Referrals that already counted stay counted unless they now fail a rule (for example an incomplete profile).

## Changed files
- src/components/Layout.tsx
- src/lib/shopReferral.ts
- src/pages/owner/OwnerCompetition.tsx
- src/pages/admin/AdminCompetition.tsx
- src/pages/admin/AdminHome.tsx
- src/App.tsx
- src/i18n/messages.ts
- CHANGES.md
- supabase/RUN_LOG.md

## New files
- supabase/migrations/0031_shop_referral_fraud_protection.sql
- supabase/tests/phase12_shop_fraud_tests.sql
- src/pages/admin/AdminFraudReview.tsx
- src/components/RankBadge.tsx
- public/badges/rank-1.png
- public/badges/rank-2.png
- public/badges/rank-3.png

---

# Blisscco update: Refer-a-Customer Competition - fraud protection (Part 2)

## What it does
- **Stricter referral rules.** A referral does NOT count when: the referrer refers themselves (same e-mail identity such as `a.b+x@gmail.com`, or same phone); the referred account was created before the competition started, or its phone number already belonged to an older account; the same person is referred again (same e-mail identity or same phone - one genuine customer counts once); the account is suspended / rejected / fraudulent; the genuine activity (booking) was not done; or the booking was later **cancelled / no-show / disputed** or its shop is no longer live. All of this is checked on the server, live, by one single "what counts" function - so a cancelled booking or a rejected referral drops off the leaderboard immediately.
- **Risk status (never automatic rejection).** Several weak signals are added into a score: same browser as the referrer, same browser behind many accounts, same browser pattern, same network (weak, only 15), accounts created within 30 minutes, booking within 30 minutes of sign-up, many referred customers using only the same shop, unusual number of referrals in 24 hours, similar machine-like e-mail names, repeated cancelled bookings, made-up phone. **Score 50 or more puts the referral ON HOLD ("suspicious")** - it does not count until an admin decides. One signal alone (for example the same IP) can never hold a referral, and the system never marks anybody fraudulent by itself.
- **Admin > Customer referral fraud review** (new page): for each referral shows referrer, referred customer, referral date, eligibility status, risk status + reasons, related booking. Admin can **Start review, Approve, Reject, Mark fraudulent, Restore** (note required) and re-check risk. Restore never skips eligibility (a valid booking must exist; self-referral and duplicate identities cannot be restored). Per-referral **History** is shown.
- **Audit log** (append-only table, nobody can edit or delete): every qualify / automatic refusal / risk hold / admin decision / booking change / freeze / validation / reward event. Shown per referral and as a competition feed on the competition page.
- **Reward protection.** When a competition ends: (1) the **final leaderboard is frozen** (snapshot that can never change; no new referral can enter), (2) the **eligibility / fraud validation runs** again, (3) the **admin confirms the winner** (the server recomputes the winner and refuses if it differs from what the admin saw, or if any suspicious referral is undecided), (4) the **Promotional Balance is issued once** with the amount stored in the competition (normally Rs 1,000), (5) duplicates are impossible: competition row lock + unique index + database triggers (reward rows cannot be inserted around the function, edited or deleted; prize / dates / rules are locked after the end).
- **Server-side only.** Counts, leaderboard, eligibility, winner and amount come from the database. The browser sends only ids, the admin's decision and which winner the admin saw. Device ids are random / hashed; the IP is stored only as a hash.
- **Customer screens** see only "Counted / Under review / Not counted" - never the risk signals. The winner is shown publicly only after confirmation and reward.

## Run this
1. Supabase SQL editor: run `supabase/migrations/0033_customer_referral_fraud_protection.sql` (after 0032). Safe to re-run. It replaces `claim_referral(text)` with `claim_referral(text, text, text)` - deploy the new front end right after.
2. Optional (test project only): `supabase/tests/phase13_customer_fraud_tests.sql`. NOT RUN by the assistant (no database available) - please run and send me any error text.
3. Deploy the front end.

## Good to know
- A referral that already counted stays counted unless it now fails a rule (for example the referred account is older than the competition start). A 0032 hold ("in review") becomes "suspicious".
- A competition already waiting for its winner gets a frozen snapshot of its current ranking when 0033 runs.
- Phone checks only work for customers who have a phone number on their account (profiles.phone); e-mail identity, device and booking checks work for everyone. Customer bookings are not paid online in Blisscco, so there is no refund state: cancelled / no-show / disputed bookings are what makes a booking ineligible.

## Changed files
- src/components/Layout.tsx
- src/lib/customerCompetition.ts
- src/pages/admin/AdminCustomerCompetition.tsx
- src/pages/admin/AdminHome.tsx
- src/App.tsx
- src/i18n/messages.ts
- CHANGES.md
- supabase/RUN_LOG.md

## New files
- supabase/migrations/0033_customer_referral_fraud_protection.sql
- supabase/tests/phase13_customer_fraud_tests.sql
- src/pages/admin/AdminCustomerFraudReview.tsx
