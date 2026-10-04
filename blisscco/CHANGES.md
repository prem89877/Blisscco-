# Blisscco update: Refer & Earn uses EMAIL verification (phone OTP removed)

## Supabase (SQL Editor): run this 1 file FIRST
1. `supabase/migrations/0021_referral_email_verification.sql`
Then push the code to GitHub (Vercel deploys). Do the SQL before the deploy, because the new code reads `profiles.email_verified`.

## Vercel / Resend / Razorpay
Nothing new. No new env vars. No SMS provider is needed any more.

## How it works now
- A referred customer qualifies when their e-mail is confirmed in Supabase Auth (the normal sign-up confirmation mail; Google sign-in is already confirmed).
- One reward per e-mail identity: lower-case, `+tag` ignored, Gmail dots ignored.
- /refer shows a "Verify your email" card (resend button) only if the e-mail is not confirmed yet.
- Removed: phone OTP form, profiles.phone, profiles.phone_verified, referrals.referred_phone, referrals.phone_verified, the auth phone trigger/function, phone in admin Users list/search.
- Shop contact phone (businesses.phone) is NOT touched.

## New files
- supabase/migrations/0021_referral_email_verification.sql

## Changed files
- src/pages/Refer.tsx   (PhoneVerify -> EmailVerify)
- src/context/AuthContext.tsx   (phone_verified -> email_verified)
- src/pages/admin/AdminReferrals.tsx   (email_verified)
- src/pages/admin/AdminUsers.tsx   (no phone)
- src/pages/Privacy.tsx   (phone-number line removed)
- src/i18n/messages.ts   (ref.* texts EN / HI / MR)
- supabase/tests/phase7_reviews_referrals_tests.sql   (tests now use e-mail)
- supabase/RUN_LOG.md, README.md, CHANGES.md
