# Blisscco update: Mega Store campaign-entry QR (migration 0041)

Builds on 0038 / 0039 / 0040. The login, sign-up, Google sign-in and e-mail verification screens are **not changed**.

## What was already in place (checked, kept)
- **One entry per account, in the database:** `mega_enrollments` has `unique (campaign_id, customer_id)`. Identity is the stable Supabase user id (`auth.uid()`), never an e-mail typed in the browser.
- **The QR holds only a random store code** (`/mega/<code>`). No customer data, no keys, no reward credential.
- **Server checks** in the database: approved store, running campaign, customer account, verified e-mail, account not suspended, not the store owner.
- **Scanning never gives a reward.** Rewards are made only by the booking trigger after a partner-shop service is completed.

## What changed
1. **"You have already joined this campaign."** `join_mega_campaign()` now answers `joined` or `already_joined`. A second scan, a double tap or two tabs never create a second row and never show an error. The unique key settles any race.
2. **Terms fixed.** If a campaign (or Blisscco) has published customer terms, the join used to fail (the database wanted an acceptance that no screen recorded). The page now shows the terms, asks for a tick, and `join_mega_campaign(..., p_accept_terms)` stores the acceptance and the entry in one transaction.
3. **Clear messages for every state** on the QR page:
   - not logged in: log in / sign up buttons; the page comes back here afterwards
   - joined just now: green "You're in! You have entered the reward cycle" + next step + partner shops first
   - scanned again: "You have already joined this campaign."
   - paused: "new entries are closed for now" (an existing entry stays safe)
   - ended or past the end date: "This campaign has ended. New entries are closed."
   - e-mail not verified, owner/admin account: a short explanation instead of a join button
4. **Return after sign-up.** Before, the "come back to the campaign" memory lived only in the browser tab, so it was lost when the verification e-mail link opened in a new tab. It is now also kept for 24 hours in `localStorage` (`src/lib/returnTo.ts`) and used by `/post-login`. Existing booking/review return links keep working.
5. The page says in plain words: scanning or joining does not give a reward; a reward comes only after a completed service at a partner shop.

## Not changed (please know)
- The QR identifies the **store** (one running campaign per store), so a new campaign of the same store reuses the same printed QR.
- "Female customer" is still a self-declaration tick box (the app has no gender field to verify).
- A campaign that is `active` but whose start date is still in the future accepts entries (rewards are issued only after the start date, as before).
- Not run or compiled here (no database, no `node_modules`): only a syntax check was done. Please run `npm run build` and the SQL test.

## Run this
1. Supabase SQL editor: run `supabase/migrations/0041_mega_entry_qr.sql` (after 0040; safe to re-run). It drops the old 2-argument `join_mega_campaign` and creates the 3-argument one.
2. TEST project only: run `supabase/tests/phase16_mega_entry_qr_tests.sql`. It ends with a rollback and prints "ALL MEGA STORE ENTRY QR TESTS PASSED". NOT RUN by the assistant - please run it and send me any error text.
3. Deploy the frontend **after** step 1 (the new page calls the 3-argument function).

## Changed files
- supabase/migrations/0041_mega_entry_qr.sql  (NEW)
- supabase/tests/phase16_mega_entry_qr_tests.sql  (NEW)
- src/lib/returnTo.ts  (NEW)
- src/pages/MegaCampaign.tsx  (rewritten)
- src/pages/PostLogin.tsx
- src/lib/megaStore.ts  (types + two new error codes)
- src/i18n/messages.ts  (new block p35, English / Hindi / Marathi)
- supabase/RUN_LOG.md
- CHANGES.md
