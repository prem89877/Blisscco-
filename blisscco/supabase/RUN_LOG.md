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
| 0006 | migrations/0006_owner_role_switch.sql | become_owner() for Google owner signup | NOT YET - run this | Safe to re-run |
| 0007 | migrations/0007_services_simplify.sql | services: name and duration become optional | Yes | Safe to re-run |
| 0008 | migrations/0008_discovery.sql | 5 km nearby_businesses + search_services | Yes | Safe to re-run |
| 0009 | migrations/0009_bookings_queue.sql | bookings, tokens, queue settings, booking functions | Yes | Safe to re-run |
| 0010 | migrations/0010_reviews_referrals.sql | reviews, referrals, coupons, redemption | NOT YET - run this | Safe to re-run |
| 0011 | migrations/0011_subscriptions_payments_banners.sql | plans, payments, webhook idempotency, banners, credits, verification, ranking, pg_cron | NOT YET - run this | Needs pg_cron enabled; drops and recreates nearby_businesses / search_services (2 new columns); safe to re-run |
| 0012 | migrations/0012_analytics_ai_qr.sql | analytics_events, track_event / track_impressions, get_analytics, claim_ai_insight, weekly purge job | NOT YET - run this | Run after 0011; needs pg_cron for the purge job (optional); safe to re-run |
| - | tests/phase9_analytics_tests.sql | Analytics / bot filter / ELITE quota tests (test project only) | Run after 0012 | Rolls back |
| - | tests/phase8_payments_tests.sql | Payment/entitlement/refund tests (test project only) | Run after 0011 | Rolls back |
| - | manual/create_first_admin.sql | Promote YOUR account to admin | Run once by hand | Not a migration |
| - | tests/phase7_reviews_referrals_tests.sql | Reviews/referral/coupon tests (test project only) | Run after 0010 | Rolls back |
| - | tests/phase6_booking_tests.sql | Booking tests (test project only) | Run after 0009 | Rolls back |
| - | tests/phase5_discovery_tests.sql | Discovery tests (test project only) | Run after 0008 | Rolls back |
| - | tests/phase2_rls_tests.sql | Security tests (test project only) | Run by owner | Rolls back; run only on a test project |

## Phase 4
No new SQL was needed for Phase 4 (the Phase 2 tables, functions and policies cover it).

## Next migrations (planned)
- Phase 10: notifications / renewal emails / PWA push
- Phase 11: admin booking tools
