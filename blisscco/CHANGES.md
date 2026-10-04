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
