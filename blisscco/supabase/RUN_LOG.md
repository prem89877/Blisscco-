# Supabase SQL run log

Rule: every SQL you run in Supabase must exist as a numbered file in `supabase/migrations/`
(next number = 0006, 0007, ...). After running it, update the table below. Never edit an
already-run file; add a new numbered file instead (exception: bug-fixed re-runnable files noted below).

| # | File | What it does | Run on Supabase? | Notes |
|---|------|--------------|------------------|-------|
| 0001 | migrations/0001_extensions_types.sql | PostGIS, enums, helper functions | Yes (reported by owner) | |
| 0002 | migrations/0002_profiles_roles.sql | profiles, roles, admin guard, RLS | Yes (reported by owner) | |
| 0003 | migrations/0003_business_core.sql | categories, businesses, services, hours, terms, audit, public view, seed | Yes (reported by owner) | |
| 0004 | migrations/0004_approval_workflow.sql | submit / approve / reject / suspend functions | Yes, fixed version re-run | array_append bug fixed; safe to re-run |
| 0005 | migrations/0005_storage.sql | business-images bucket + policies | Yes | Now safe to re-run (drops policies first) |
| - | manual/create_first_admin.sql | Promote YOUR account to admin | Run once by hand | Not a migration |
| - | tests/phase2_rls_tests.sql | Security tests (test project only) | Run by owner | Rolls back; run only on a test project |

## Phase 4
No new SQL was needed for Phase 4 (the Phase 2 tables, functions and policies cover it).

## Next migrations (planned)
- 0006 PostGIS discovery + search functions (Phase 5)
- 0007 bookings, tokens, queue (Phase 6)
