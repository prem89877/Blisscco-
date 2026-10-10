# Blisscco update: Mega Store DASHBOARD (migration 0040 + new screens)

Builds on 0038 / 0039. Nothing from them is dropped (only the old 10-argument `megastore_save_campaign` is replaced by a 12-argument version). No new environment variable, no service-role key in the browser.

## What the owner gets (all on one mobile-first page: `/owner/megastore`)
1. **Registration as a business type.** `Add business` now asks for the *Business type*: "Salon / shop" or "Mega Store (reward campaign)". Mega Store registration uses the existing admin approval (`/admin/mega-stores`).
2. **Access only after approval.** Before approval the owner sees only the status (waiting / not approved / suspended). The database function `get_my_megastore` returns no campaign data for an unapproved store, and every write function already checks `approved`. Strangers and customers get nothing.
3. **Campaign:** title, start and end dates, reward (percent or flat), eligibility (minimum partner-service price, one reward per shop), minimum bill at the Mega Store, **budget**, and "when paused also stop new sign-ups".
4. **Limits set by Blisscco** (table `mega_platform_limits`, admin edits them at `/admin/mega-stores`): min/max discount %, min/max flat ₹, partner shops per campaign (**default 10**), min/max budget. The database enforces them; the form only shows them. Defaults are placeholders: 5-30 %, ₹50-1000, 10 shops, ₹1,000-10,00,000 - please set your real numbers.
5. **Partner shops:** pick up to 10 approved Blisscco shops. Each selected shop shows its status (invited / accepted / declined / withdrawn / removed) and, for this campaign, verified services, rewards issued and rewards redeemed.
6. **Campaign-entry QR:** unchanged (download PNG / copy link), shown while the campaign is open.
7. **Pause / resume / end** (primary owner only; big buttons for a phone). A campaign cannot start without a budget and at least one shop.
8. **Budget card:** budget, spent, remaining, progress bar, what the usable rewards could still cost, a warning when the budget is short. **Increase budget** (`megastore_increase_budget`): primary owner only, can only go up once the campaign has started, never above the platform maximum.
9. **Suspicious transactions / requests to verify:** rewards the server put on hold (approve or reject) plus open/confirmed fraud flags.
10. **Quick redeem box** at the top for checkout; recent redemptions list at the bottom.

## Numbers that are never mixed (one screen block, five different sources)
| Shown as | Counts |
|---|---|
| Registrations | customers who joined (`mega_enrollments`) |
| Verified services | partner-shop services linked to a reward (`mega_service_verifications`, status verified) |
| Rewards issued | rewards ever issued (`issued_at` set). Redeemed rewards are a part of these |
| Rewards redeemed | rows in `mega_reward_redemptions` |
| Total discount you funded | sum of redemptions only - an issued reward costs nothing until it is redeemed |

"Where the issued rewards stand" splits issued into usable now / redeemed / expired / cancelled / waiting for approval.
**Behaviour change:** "issued" now counts every reward that was ever issued (before, cancelled ones were left out); cancelled ones are shown separately.

## Pause rules
- **Paused = no new rewards.** Enforced three times: `mega_try_issue_reward` (only active campaigns), the new trigger `mega_rewards_a_issue_gate` (database refuses a new reward on a non-running campaign), and approving a held reward is refused (`campaign_not_active`). Rejecting a held reward is still possible.
- **Paused = no new registrations** by default. The campaign setting "also stop new sign-ups" can be switched off, then only reward issuing stops. The QR page, `join_mega_campaign`, the enrolment trigger and `accept_mega_terms` all use the one helper `mega_registration_open()`.
- **Already-issued, unexpired rewards are never touched** by pause or end: they stay valid and can be redeemed.

## Who may do what
- **Primary owner:** everything above.
- **Authorised manager** (`mega_store_members`, added with `megastore_add_member`): can open the dashboard, redeem rewards and approve/reject held rewards. Cannot pause, change the campaign, shops or budget (button hidden, and the database answers `not_found`). There is still no screen to add managers - use the SQL function for now.
- **Admin:** approves stores, edits platform limits, can still raise a store's budget via `megastore_set_campaign_budget`.

## Known limits (please read)
- The budget is enforced when a reward is **redeemed** (0039). If the budget runs out, rewards that are already issued cannot be redeemed until the owner increases the budget. The budget card warns about this ("short by ₹X"), but it does not reserve money at issue time.
- Percent rewards without a "maximum discount" have unknown cost; they are counted separately on the budget card.
- Partner shops have no screen yet to accept/decline an invitation (the database function `partner_respond_mega_campaign` exists). Rewards are issued to every selected shop whatever its invitation status, as before.
- Not run or compiled here (no database, no `node_modules` in the zip): only a syntax check of the TypeScript files was done. Please run `npm run build` and the SQL tests.

## Run this
1. Supabase SQL editor: run `supabase/migrations/0040_mega_store_dashboard.sql` (after 0039; safe to re-run).
2. TEST project only: run `supabase/tests/phase15_mega_dashboard_tests.sql`. It ends with a rollback and prints "ALL MEGA STORE DASHBOARD TESTS PASSED". NOT RUN by the assistant - please run it and send me any error text.
3. Admin: open `/admin/mega-stores` -> "Campaign limits" and set Blisscco's real minimum / maximum.
4. Deploy the frontend (after step 1).

## Changed files
- supabase/migrations/0040_mega_store_dashboard.sql  (NEW)
- supabase/tests/phase15_mega_dashboard_tests.sql  (NEW)
- supabase/RUN_LOG.md
- CHANGES.md
- src/lib/megaStore.ts
- src/i18n/messages.ts  (new block p34, English / Hindi / Marathi)
- src/pages/owner/MegaStoreDashboard.tsx  (rewritten)
- src/pages/owner/NewBusiness.tsx  (business type)
- src/pages/admin/AdminMegaStores.tsx  (limits section)
- src/pages/MegaCampaign.tsx  (join button follows `registrations_open`)
- src/components/MegaCampaignForm.tsx
- src/components/MegaPartnerShops.tsx
- src/components/MegaStoreForm.tsx  (NEW, extracted from the dashboard)
- src/components/MegaMetrics.tsx  (NEW)
- src/components/MegaBudgetCard.tsx  (NEW)
- src/components/MegaAlerts.tsx  (NEW)
- src/components/AdminMegaLimits.tsx  (NEW)
