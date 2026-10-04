# Blisscco update: search speed indexes + "estimated" analytics

## Supabase (SQL Editor)
Re-run `supabase/migrations/0020_fuzzy_search.sql` (safe to re-run; it now also creates 2 indexes). No new migration file.
Optional: measure with `supabase/manual/benchmark_search.sql` before and after (test project).

## Changed files
- supabase/migrations/0020_fuzzy_search.sql   (2 `create index if not exists`, function untouched)
- supabase/RUN_LOG.md, README.md, CHANGES.md
- src/i18n/messages.ts   (p9.* texts EN / HI / MR: "Estimated visitors"; new ps.disclaimer EN / HI / MR)
- src/components/editor/ServicesSection.tsx   (AI price suggestion disclaimer shown under the 3 prices)
- api/ai-insights.ts   (AI says "estimated visitors", never "unique visitors"; answer is now 5-6 action lines telling the owner how to bring customers to Blisscco)

## New files
- supabase/manual/benchmark_search.sql
