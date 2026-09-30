# Blisscco — Phases 1–3

## Status (honest)
- Written: migrations 0001–0005, admin bootstrap SQL, security test script.
- **NOT yet run against a real Supabase project.** I had no database/network in this environment,
  so nothing here is tested yet. Run the steps below and the test script, then tell me any error text.
- Frontend (Vite/React/TS) starts in Phase 3.

## Setup
1. Create a **new** Supabase project for Blisscco (not shared with Kissaan Saathi).
2. Dashboard > Authentication > Providers > Email: turn **Confirm email ON**.
3. Dashboard > Authentication > URL Configuration: set Site URL to your Vercel URL
   (add `http://localhost:5173` as a redirect URL for development).
4. Dashboard > SQL Editor: run in order
   `0001_extensions_types.sql`, `0002_profiles_roles.sql`, `0003_business_core.sql`,
   `0004_approval_workflow.sql`, `0005_storage.sql`.
   (Or use the Supabase CLI: `supabase db push`.)
5. On a **test** project, run `tests/phase2_rls_tests.sql`. Expect the notice
   `ALL PHASE 1-2 SECURITY TESTS PASSED`.
6. Sign up on the site with your own email, verify it, then run `manual/create_first_admin.sql`
   with your email. Log out and back in.

## How it works
- **Roles:** `customer`, `owner`, `admin`. Signup can choose customer or owner only. Admin can only be
  set from the SQL Editor. A trigger and column grants block any API attempt to change role.
- **Business states:** draft → pending_review → approved / rejected (with reason);
  approved ↔ suspended (admin) and approved ↔ inactive (owner).
  Owners cannot write `status`; only the functions in `0004` can.
- **Submission checks (server-side):** verified email, category, description, phone, email, address,
  coordinates, 3+ photos, opening hours, 1+ priced service, current terms accepted.
- **Public data:** anonymous users can only read the `public_businesses` view (approved only,
  no owner id, phone/email only if owner allows). Children (services, hours, images) are public
  only when the business is approved.
- **Images:** private bucket `business-images`, path `{business_id}/{uuid}.jpg|png|webp`, 5 MB max.
  Public gets signed URLs only after approval.
- **Audit:** admin approve/reject/suspend actions write to `admin_audit_logs` and status history.

## Frontend calls (for Phase 3+)
- `supabase.rpc('accept_business_terms', { p_business_id })`
- `supabase.rpc('submit_business_application', { p_business_id })`
- `supabase.rpc('admin_review_business', { p_business_id, p_approve, p_reason })`
- `supabase.rpc('admin_set_business_status', { p_business_id, p_target, p_reason })`
- `supabase.rpc('owner_set_business_active', { p_business_id, p_active })`

## Known decisions / limits
- Terms text is a **placeholder**; get lawyer-reviewed T&C before launch.
- Editing an approved listing's material fields (name, location, category) is blocked for now;
  the change-request review flow comes in Phase 4.
- Images use signed URLs (no CDN caching). If load becomes slow, Phase 4 can copy approved images to a public bucket.
- No India-only coordinate check, so testing from anywhere works.

## Next: Phase 3
Vite + React + TS + Tailwind scaffold, Blisscco design system/logo, routing, en/hi/mr i18n, auth screens.

---
# Phase 3 — App scaffold (Vite + React + TypeScript + Tailwind)

## Status (honest)
Code written, but **not installed, type-checked or built yet**: my environment has no internet for `npm install`.
Please run the steps below; if `npm run build` shows any error, send me the exact text and I will fix it.

## What is included
- Blisscco logo (`public/logo.svg`) and palette: #FDF8F5, #2D2A2E, #FF91A4 (Tailwind: cream / ink / blush)
- English / Hindi / Marathi (`src/i18n/messages.ts`), language selector in header, saved in browser and in your profile
- Supabase Auth: customer + business-owner register/login, admin login page (`/admin/login`), forgot/reset password
- Role-aware redirect after login, route guard (UX only; the database RLS is the real security)
- Placeholder owner/admin dashboards, home page shell (search is disabled until Phase 5; no fake results)

## Run locally
1. Install Node.js 20+.
2. `npm install`
3. Copy `.env.example` to `.env`; paste your Supabase Project URL and the **anon** key (Project Settings > API).
   Never use the service_role key here.
4. `npm run dev` -> open http://localhost:5173
5. `npm run build` to check the production build.

## Deploy (GitHub + Vercel)
1. Push this folder to a new GitHub repo (the `.env` file is git-ignored).
2. Vercel > Add New Project > import the repo (Framework: Vite is auto-detected).
3. Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then Deploy.
4. Copy the Vercel URL, then in Supabase > Authentication > URL Configuration set Site URL to it and add
   Redirect URLs: `https://YOUR-URL/login` and `https://YOUR-URL/reset-password`
   (also `http://localhost:5173/**` for local testing).

## Not in Phase 3 (coming)
Business onboarding form (Phase 4), GPS search (5), booking/queue (6), PWA icons/manifest/push (10).

---
# Phase 4 - Onboarding, admin approval, public business page
- Owner: /owner (dashboard) > /owner/business/new > /owner/business/:id (details, GPS location, photos, hours, services, terms, submit)
- Admin: /admin > /admin/applications (review photos, services, location; approve / reject with reason; suspend / reactivate), /admin/categories
- Public: /b/:id (approved businesses only) with services, prices, hours and Get Directions
- No new SQL in Phase 4.
- Known limits: material edits to an approved listing (name, location, category) are still locked (change-request flow is a later item);
  server error text on submit is shown as returned by the database (English).
- Not tested: I could not run npm/build here. Please run `npm run build` and send any error text.
