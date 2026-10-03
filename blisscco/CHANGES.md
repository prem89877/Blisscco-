# Blisscco update: appointment request flow + "Get notified" + 12-hour time + search-bar style boxes + typo-tolerant search

## Supabase (SQL Editor): run these 2 files, in this order
1. `supabase/migrations/0019_appointment_request_flow.sql`
2. `supabase/migrations/0020_fuzzy_search.sql`
(0020 needs the `fuzzystrmatch` extension. The file enables it by itself; if Supabase refuses, enable it in Dashboard > Database > Extensions and run the file again.)

## Vercel
Nothing new to set. Push to GitHub and Vercel deploys. No new env vars (VAPID keys, Resend, NOTIFY_CRON_SECRET stay as they are).

## How the new booking works
1. Customer picks a SERVICE + DATE (day and month) and taps "Request appointment". No time on the customer side.
2. Owner opens Queue > "Appointment requests", picks a time (hour / minute / AM-PM) and taps "Send time".
3. Customer gets a notification ("Your time is set!") and in My bookings sees the time with a "Get notified" button.
4. After "Get notified" the customer gets a push + an e-mail 20 minutes before the visit ("Glow time in 20 minutes!").
5. If the owner never sends a time and the day passes, the request is closed automatically at 00:05 and the customer is told.

## New files
- supabase/migrations/0019_appointment_request_flow.sql
- supabase/migrations/0020_fuzzy_search.sql
- src/components/TimePicker12.tsx   (hour / minute / AM-PM picker)

## Changed files
- api/_lib/notificationText.ts   (new texts EN/HI/MR, 12-hour times)
- api/dispatch-notifications.ts   (20-minute reminder: high priority, expires after 15 min)
- src/components/BookingPanel.tsx   (date + service only)
- src/pages/MyBookings.tsx   (waiting-for-time, time in 12 h, Get notified button)
- src/pages/owner/OwnerQueue.tsx   (requests list, send / update time)
- src/components/editor/HoursSection.tsx   (shop opening hours picker in 12 h)
- src/pages/BusinessProfile.tsx, src/pages/admin/Applications.tsx   (hours shown in 12 h)
- src/pages/Explore.tsx   ("showing closest results" note)
- src/lib/format.ts, src/lib/types.ts, src/lib/bookingErrors.ts
- src/i18n/messages.ts   (new texts EN / HI / MR)
- src/index.css   (search-bar look for inputs, dropdowns, cards, boxes)
- Box styling only (class names): src/components/{HeaderMenu,LanguageSelect,QueueCard,ReviewForm,ReviewsSection}.tsx,
  src/components/editor/{DetailsSection,ServicesSection,SubmitSection}.tsx, src/pages/{Refer,LegalPage}.tsx,
  src/pages/admin/{AdminDisputes,AdminReviews}.tsx, src/pages/owner/{BusinessEditor,OwnerAnalytics,OwnerBanners,OwnerCoupons,OwnerDashboard,OwnerPlans,OwnerQR,OwnerReviews,OwnerVerify}.tsx
- supabase/RUN_LOG.md, CHANGES.md
