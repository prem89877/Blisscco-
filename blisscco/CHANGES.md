# Blisscco update: subscriptions removed + nicer shop profile

## Run this in Supabase (SQL Editor), once
`supabase/migrations/0017_remove_subscriptions.sql`

## New files
- supabase/migrations/0017_remove_subscriptions.sql
- src/i18n/messages12.ts
- CHANGES.md

## Changed files
- src/pages/BusinessProfile.tsx  (new look)
- src/pages/owner/OwnerPlans.tsx  (PRO/ELITE cards removed; only Blue badge + Banner)
- src/pages/owner/OwnerBanners.tsx  (no plan needed, only banner credits)
- src/pages/owner/OwnerAnalytics.tsx  (open for everyone, AI insights too)
- src/pages/Explore.tsx  (PRO/ELITE chip removed)
- src/components/TierBadge.tsx  (TierChip removed, blue tick stays)
- src/pages/admin/AdminHome.tsx  (Subscriptions link removed)
- src/pages/admin/AdminReports.tsx  (text only)
- src/pages/Privacy.tsx  (text only)
- src/App.tsx  (admin subscriptions route removed)
- src/i18n/messages.ts  (messages12 added)

## Deleted files
- src/pages/admin/AdminSubscriptions.tsx
