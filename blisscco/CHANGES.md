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

## New files
- None. No new package, no new environment variable, no database change.
