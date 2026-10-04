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
| 0013 | migrations/0013_notifications.sql | notifications, notification_preferences, push_subscriptions, notification_deliveries, event triggers, reminders, pg_cron jobs | NOT YET - run this | Run after 0012; needs pg_net + pg_cron enabled; safe to re-run |
| 0014 | migrations/0014_admin_tools.sql | Phase 11 Part 1: booking disputes + audited correction, user suspend, free/cancel subscriptions, coupon revoke, earnings report | NOT YET - run this | Run after 0013; safe to re-run |
| 0019 | migrations/0019_appointment_request_flow.sql | Appointment REQUEST flow: customer picks date only, owner sends the time, "Get notified" 20-minute push + e-mail reminder (pg_cron every minute); requests unanswered for 1 hour auto-expire (pg_cron every minute) | NOT YET - run this | Run after 0018; needs pg_cron + pg_net (already used by 0013); safe to re-run. Switches OFF the old automatic 24 h / 2 h appointment reminders |
| 0020 | migrations/0020_fuzzy_search.sql | Typo-tolerant search (similar spelling / sound / missing space) in search_services + 2 speed indexes (services_search_cover_idx, business_images_cover_lookup_idx) | NOT YET - run this | Run after 0018; enables fuzzystrmatch extension; drops and recreates search_services (1 new column is_exact); safe to re-run |
| 0021 | migrations/0021_referral_email_verification.sql | Refer & Earn: e-mail verification instead of phone OTP; removes profiles.phone / phone_verified, referrals phone columns, phone trigger; admin_list_users without phone | NOT YET - run this | Run after 0020; safe to re-run. Run it BEFORE deploying the new frontend |
| 0023 | migrations/0023_india_validation.sql | India-only locations: simplified India polygon (india_boundary), is_in_india(), is_valid_in_pincode(), businesses_before_write now refuses non-India location / bad PIN / review without PIN | NOT YET - run this | Run after 0022; needs PostGIS (already enabled); safe to re-run. Run it BEFORE deploying the new frontend |
| 0024 | migrations/0024_physical_qr.sql | Physical QR poster product: new plan kind `physical_qr`, plan row `physical_qr` = Rs 50 (5000 paise), plan_duration check updated | NOT YET - run this | Run after 0023, BEFORE deploying the new frontend; safe to re-run. Re-uses Razorpay create-order + webhook (no API change) |
| 0022 | migrations/0022_auto_queue.sql | Automatic walk-in queue: owner_queue_start_next / owner_queue_complete / owner_queue_skip, get_my_queue_positions (live position), set_booking_status re-defined with a serving guard, realtime on bookings | NOT YET - run this | Run after 0021; safe to re-run; no table/column/RLS change. Run it BEFORE deploying the new frontend |
| 0025 | migrations/0025_business_listing_terms_v2.sql | Replaces the PLACEHOLDER business listing terms (v1) with real text (v2) and makes v2 the current version (data only, no schema change) | NOT YET - run this | Run before onboarding shops; safe to re-run. Must match src/pages/Terms.tsx |
| - | tests/phase11c_india_tests.sql | India polygon / PIN code / businesses trigger tests (test project only) | Run after 0023 | Rolls back |
| - | manual/benchmark_search.sql | Search benchmark (time + EXPLAIN) to run before and after the 0020 indexes | Run by hand on a test project | Read-only, changes nothing |
| - | tests/phase11a_admin_tests.sql | Phase 11 Part 1 admin tests (test project only) | Run after 0014 | Rolls back |
| - | manual/set_notification_config.sql | Stores dispatcher URL + shared secret (notification_config) | Run once by hand, after 0013 | Contains a secret: edit before running, never commit the edited copy |
| - | tests/phase10_notifications_tests.sql | Notification triggers / prefs / reminders / retry tests (test project only) | Run after 0013 | Rolls back |
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
- (Phase 10 done: 0013)
- (Phase 11 Part 1 done: 0014)
- (0021 done: referral e-mail verification)
- (0022 done: automatic walk-in queue)
- (0023 done: India-only location + PIN validation)
- (0024 done: physical QR poster, Rs 50 via UPI)
- Phase 11 Part 2: rating sort, review photos, listing edit review (0015)
