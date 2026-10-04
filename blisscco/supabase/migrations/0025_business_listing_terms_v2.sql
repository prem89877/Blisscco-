-- 0025: replaces the PLACEHOLDER business listing terms (v1) with real text (v2).
-- WHY: owners tick "I have read and accept the terms" in the listing form (SubmitSection) and that screen shows
-- terms_versions.body_md of the CURRENT version. v1 only said "PLACEHOLDER - replace with reviewed Terms...".
-- Safe to re-run (v2 is updated in place; v1 stays in the table because old acceptances point to it).
-- Run BEFORE you start onboarding shops. Data change only: no table, column, policy or function changes.
-- The text below must match src/pages/Terms.tsx. If you change one, change the other (and use a new version v3
-- if any owner has already accepted v2, so their acceptance still records what they actually saw).

update public.terms_versions set is_current = false where is_current and version <> 'v2';

insert into public.terms_versions (version, title, body_md, is_current)
values ('v2', 'Blisscco Business Listing Terms', $terms$
BLISSCCO BUSINESS LISTING TERMS

1. Your listing. You confirm that you own this business or are authorised to list it, and that everything you submit is true and up to date: name, category, description, photos, address, map location, phone, services, prices, opening hours, queue status and waiting times. Photos must be genuine and you must have the right to use them. One real business should have one listing.

2. Review by Blisscco. Blisscco reviews each listing before it goes live and may approve, reject, suspend or hide it, or ask for changes. Approval is not an endorsement and is not a check of your licences, hygiene or service quality. You are responsible for your own licences, permits, taxes, safety and the services you provide.

3. Blisscco is a platform. Blisscco does not provide your services and is not a party to the service between you and your customers. Price, quality, delays, cancellations and disputes with customers are your responsibility. Please honour the bookings and prices you show.

4. Customer data. You will receive customers' names and booking details. Use them only to serve the booking, keep them private, and handle them as the law requires.

5. Reviews. Customers can post reviews. Blisscco does not guarantee they are true. You may reply publicly and report a review to Blisscco. You must not write reviews for your own business, ask others to, or offer rewards for good reviews.

6. Coupons. If coupon acceptance is on for your shop (you can turn it off in booking settings), you give the coupon discount on the final bill for a valid coupon. You enter the coupon within 7 days of the booking being completed. Blisscco does not pay the discount.

7. Paid services. The blue badge, extra banners and physical QR poster are optional and paid through Razorpay. A blue tick only means a Blisscco admin reviewed a business document you submitted; it is not a guarantee or endorsement of your business. Banners are marked "Sponsored". Refund and cancellation terms for paid services are in the Terms of Service.

8. Content permission. You keep ownership of what you upload. You allow Blisscco to show and store it on Blisscco, and in promotional material for Blisscco, while your listing is on Blisscco.

9. Misuse. Fake, misleading, duplicate or unauthorised listings, fraud, fake reviews, and abuse of coupons or referrals are not allowed. Blisscco may reject or remove content or listings and suspend or close accounts for these reasons or where the law requires.

10. Full terms. The Blisscco Terms of Service and Privacy Policy (links under this box) also apply to you.
$terms$, true)
on conflict (version) do update
  set title = excluded.title, body_md = excluded.body_md, is_current = true;
