# Blisscco update: search speed indexes + "estimated" analytics

## Supabase (SQL Editor)
Re-run `supabase/migrations/0019_appointment_request_flow.sql` (changed: 1-hour auto-expiry) AND `0020_fuzzy_search.sql` (2 indexes). Both safe to re-run. No new migration file. pg_cron must be enabled.
Optional: measure with `supabase/manual/benchmark_search.sql` before and after (test project).

## Changed files
- supabase/migrations/0019_appointment_request_flow.sql   (cancelled_by 'system', expire_unscheduled_requests after 1 hour, cron every minute, notify trigger)
- api/_lib/notificationText.ts   (new text appointment_request_expired EN / HI / MR)
- src/pages/MyBookings.tsx   (Expired badge + Visit other shops / View shop profile buttons)
- src/pages/owner/OwnerQueue.tsx   (Expired label)
- src/lib/types.ts   (cancelled_by)
- supabase/migrations/0020_fuzzy_search.sql   (2 `create index if not exists`, function untouched)
- supabase/RUN_LOG.md, README.md, CHANGES.md
- src/i18n/messages.ts   (p9.* texts EN / HI / MR: "Estimated visitors"; new ps.disclaimer EN / HI / MR)
- src/components/editor/ServicesSection.tsx   (AI price suggestion disclaimer shown under the 3 prices)
- api/ai-insights.ts   (AI says "estimated visitors", never "unique visitors"; answer is now EXACTLY 6 action lines telling the owner how to bring customers to Blisscco)

## New files
- supabase/manual/benchmark_search.sql
