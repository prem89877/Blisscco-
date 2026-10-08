-- 0033: Fraud protection for the Refer-a-Customer Competition (builds on 0032). Run after 0032. Safe to re-run.
--
-- What this adds
--   1. Stricter referral validation. A referral does NOT count when: the referrer refers themselves (same e-mail identity or phone);
--      the referred account / phone already existed before the competition or before the referral; the same person is referred again
--      (same e-mail identity or same phone); the account is suspended / fake / rejected / fraudulent; the genuine activity (booking) was not
--      done, or the booking was later cancelled / marked no-show / disputed / moved to a shop that is no longer valid.
--      One genuine customer counts only ONCE during the competition.
--   2. Risk detection: several weak signals are ADDED UP into a risk score (same browser, same browser pattern, same network (weak),
--      accounts created close together, booking right after sign-up, many accounts using only the same shop, unusual volume, similar
--      e-mail pattern, repeated cancelled bookings, made-up phone). Score >= 50 puts the referral on HOLD ("suspicious"): it is NOT counted
--      until an admin decides. One signal alone (for example the same IP / network) can never put a referral on hold, and NOTHING is
--      ever marked fraudulent by the system - only an admin can do that.
--   3. Admin review: start review / approve / reject / mark fraudulent / restore (+ re-check risk). Rejected and fraudulent referrals stop
--      counting immediately (the leaderboard is always computed live from the same single "what counts" function).
--   4. Audit log: append-only table (who, when, from -> to, note) for every referral decision, the freeze, the validation and the reward.
--   5. Reward protection. Ending a competition FREEZES the final leaderboard (a snapshot nobody can change), then the admin runs the
--      eligibility / fraud validation, then CONFIRMS the winner (the server recomputes the winner and refuses if it differs from what
--      the admin saw), then the Promotional Balance is issued exactly ONCE (competition row lock + unique index + database triggers).
--      Counts, winner and reward amount are always computed / read on the server - the browser sends only ids and the admin's decision.
--
-- Helper functions that 0031 / 0030 also define are re-declared below with "create or replace" (identical bodies), so this file does
-- not depend on whether 0031 was run.

-- ============ 0. SMALL HELPERS (same bodies as 0030 / 0031) ============
create or replace function public.forbid_row_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'append_only';
end $$;

create or replace function public.phone_key(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 10), '');
$$;

create or replace function public.shop_hash(p text) returns text
language sql immutable set search_path = '' as $$
  select case when nullif(trim(coalesce(p, '')), '') is null then null
              else encode(sha256(convert_to('blisscco-shop|' || trim(p), 'utf8')), 'hex') end;
$$;

-- hash of the caller's network address. Only a WEAK signal: shared Wi-Fi / mobile networks are normal. The raw IP is never stored.
create or replace function public.shop_request_ip_hash() returns text
language plpgsql stable set search_path = '' as $$
declare h text; ip text;
begin
  begin
    h := current_setting('request.headers', true);
    if h is null or h = '' then return null; end if;
    ip := trim(split_part(coalesce((h::jsonb) ->> 'x-forwarded-for', (h::jsonb) ->> 'cf-connecting-ip', ''), ',', 1));
  exception when others then
    return null;
  end;
  return public.shop_hash(ip);
end $$;

-- ============ 1. COLUMNS ============
alter table public.customer_comp_referrals add column if not exists risk_score int not null default 0;
alter table public.customer_comp_referrals add column if not exists risk_signals jsonb not null default '[]'::jsonb;
alter table public.customer_comp_referrals add column if not exists risk_evaluated_at timestamptz;
alter table public.customer_comp_referrals add column if not exists referred_phone_key text;

-- clear = nothing found | suspicious = ON HOLD, waiting for admin | in_review = admin is looking at it
-- approved = admin cleared it | rejected / fraudulent = admin decision (never counts; admin can restore)
alter table public.customer_comp_referrals drop constraint if exists customer_comp_referrals_review_status_check;
-- 0032 used 'in_review' for system holds: those become 'suspicious' (an admin-started review always has reviewed_by set, so re-running is safe)
update public.customer_comp_referrals set review_status = 'suspicious' where review_status = 'in_review' and reviewed_by is null;
alter table public.customer_comp_referrals add constraint customer_comp_referrals_review_status_check
  check (review_status in ('clear', 'suspicious', 'in_review', 'approved', 'rejected', 'fraudulent'));

-- 0032 stored plain flag names in risk_flags; copy them into the new weighted risk_signals (once)
update public.customer_comp_referrals x
   set risk_signals = (
         select coalesce(jsonb_agg(jsonb_build_object('code',
                  case f when 'same_shop_pattern' then 'same_shop_cluster' when 'burst' then 'unusual_volume' else f end, 'weight', 25)), '[]'::jsonb)
           from jsonb_array_elements_text(x.risk_flags) f)
 where jsonb_array_length(x.risk_flags) > 0 and x.risk_signals = '[]'::jsonb;

create index if not exists ccr_review_idx on public.customer_comp_referrals (competition_id, review_status) where status = 'qualified';
-- the same phone number can count only once (e-mail identity already has ccr_email_once from 0032)
create unique index if not exists ccr_phone_once on public.customer_comp_referrals (referred_phone_key) where status = 'qualified' and referred_phone_key is not null;

alter table public.customer_competitions add column if not exists frozen_at timestamptz;
alter table public.customer_competitions add column if not exists frozen_snapshot jsonb;      -- leaderboard exactly as it was when the competition ended
alter table public.customer_competitions add column if not exists validated_at timestamptz;   -- last time the admin ran the eligibility / fraud validation
alter table public.customer_competitions add column if not exists reward_grant_id uuid;

-- ============ 2. NEW TABLES ============
-- Append-only history of every important referral / reward status change (who, when, from -> to)
create table if not exists public.customer_comp_audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('referral', 'competition', 'reward')),
  entity_id uuid not null,                         -- deliberately no foreign key: the trail must survive even if a row is deleted
  competition_id uuid,
  action text not null,
  from_state text, to_state text,
  actor_id uuid references public.profiles(id) on delete set null,   -- null = the system
  note text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cc_audit_entity_idx on public.customer_comp_audit_log (entity_type, entity_id, created_at desc);
create index if not exists cc_audit_comp_idx on public.customer_comp_audit_log (competition_id, created_at desc);

-- Devices / networks seen for a customer (only hashes + a random browser id are stored - never the raw IP)
create table if not exists public.customer_device_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null default '',
  device_fp text not null default '',
  ip_hash text not null default '',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_id, ip_hash)
);
create index if not exists customer_device_dev_idx on public.customer_device_log (device_id) where device_id <> '';
create index if not exists customer_device_fp_idx on public.customer_device_log (device_fp) where device_fp <> '';
create index if not exists customer_device_ip_idx on public.customer_device_log (ip_hash) where ip_hash <> '';

-- Every attempt to claim a referral code, with the outcome (also the refused ones)
create table if not exists public.customer_referral_claim_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id) on delete cascade,
  referrer_id uuid references public.profiles(id) on delete set null,
  code text,
  outcome text not null,
  device_id text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists customer_claim_log_idx on public.customer_referral_claim_log (customer_id, created_at desc);

alter table public.customer_comp_audit_log enable row level security;
alter table public.customer_device_log enable row level security;
alter table public.customer_referral_claim_log enable row level security;
drop policy if exists cc_audit_select on public.customer_comp_audit_log;
create policy cc_audit_select on public.customer_comp_audit_log for select to authenticated using (public.is_admin());
drop policy if exists customer_claim_log_select on public.customer_referral_claim_log;
create policy customer_claim_log_select on public.customer_referral_claim_log for select to authenticated using (public.is_admin());
revoke all on public.customer_comp_audit_log, public.customer_device_log, public.customer_referral_claim_log from anon, authenticated;
grant select on public.customer_comp_audit_log, public.customer_referral_claim_log to authenticated;     -- RLS: admin only; device log: no API access at all

-- ============ 3. DATABASE GUARDS ============
drop trigger if exists cc_audit_append_only on public.customer_comp_audit_log;
create trigger cc_audit_append_only before update or delete on public.customer_comp_audit_log
  for each row execute function public.forbid_row_change();
drop trigger if exists customer_claim_log_append_only on public.customer_referral_claim_log;
create trigger customer_claim_log_append_only before update or delete on public.customer_referral_claim_log
  for each row execute function public.forbid_row_change();

create or replace function public.log_customer_comp_event(p_entity_type text, p_entity_id uuid, p_competition_id uuid, p_action text,
  p_from text, p_to text, p_actor uuid, p_note text, p_details jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.customer_comp_audit_log (entity_type, entity_id, competition_id, action, from_state, to_state, actor_id, note, details)
  values (p_entity_type, p_entity_id, p_competition_id, p_action, p_from, p_to, p_actor, left(p_note, 300), coalesce(p_details, '{}'::jsonb));
$$;

-- A referral row cannot be moved to another person / competition. A "qualified" row can only be created while the competition is ACTIVE
-- (so after the final leaderboard is frozen nothing new can enter it). Once a competition has ended its referrals are locked.
create or replace function public.customer_comp_referrals_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.customer_competitions where id = new.competition_id;
  if tg_op = 'INSERT' then
    if new.status = 'qualified' and coalesce(v_status, '') <> 'active' then raise exception 'competition_not_active'; end if;
  else
    if new.competition_id is distinct from old.competition_id or new.referral_id is distinct from old.referral_id
       or new.referrer_id is distinct from old.referrer_id or new.referred_id is distinct from old.referred_id then
      raise exception 'referral_locked';
    end if;
    if v_status = 'ended' and (new.status is distinct from old.status or new.review_status is distinct from old.review_status
                                or new.qualifying_booking_id is distinct from old.qualifying_booking_id) then
      raise exception 'competition_closed';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists customer_comp_referrals_guard on public.customer_comp_referrals;
create trigger customer_comp_referrals_guard before insert or update on public.customer_comp_referrals
  for each row execute function public.customer_comp_referrals_guard();

-- Once a competition waits for the winner / has ended: prize, dates, rules and title are frozen, a paid reward can never be undone,
-- and the frozen leaderboard can never be changed.
create or replace function public.customer_competitions_lock_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status in ('pending_verification', 'ended') then
    if new.reward_amount_inr is distinct from old.reward_amount_inr or new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at or new.title is distinct from old.title
       or new.eligibility_rule is distinct from old.eligibility_rule or new.min_booking_value_inr is distinct from old.min_booking_value_inr
       or new.sponsor_business_id is distinct from old.sponsor_business_id or new.reward_valid_days is distinct from old.reward_valid_days then
      raise exception 'competition_locked';
    end if;
  end if;
  if old.status = 'ended' and new.status <> 'ended' then raise exception 'competition_locked'; end if;
  if old.status = 'pending_verification' and new.status not in ('pending_verification', 'ended') then raise exception 'competition_locked'; end if;
  if old.frozen_snapshot is not null and (new.frozen_snapshot is distinct from old.frozen_snapshot or new.frozen_at is distinct from old.frozen_at) then
    raise exception 'competition_locked';
  end if;
  if old.reward_issued_at is not null and (new.reward_issued_at is distinct from old.reward_issued_at
       or new.winner_customer_id is distinct from old.winner_customer_id or new.reward_grant_id is distinct from old.reward_grant_id) then
    raise exception 'already_awarded';
  end if;
  return new;
end $$;
drop trigger if exists customer_competitions_lock_guard on public.customer_competitions;
create trigger customer_competitions_lock_guard before update on public.customer_competitions
  for each row execute function public.customer_competitions_lock_guard();

-- A reward row can only be inserted while the competition waits for the winner, for exactly the stored amount, for exactly the stored
-- winner, once. It can never be deleted or changed (only cancelled: status 'revoked'). Defence in depth: the award function checks the same.
create or replace function public.promo_grant_guard() returns trigger
language plpgsql set search_path = '' as $$
declare c public.customer_competitions;
begin
  if tg_op = 'DELETE' then raise exception 'append_only'; end if;
  if tg_op = 'INSERT' then
    select * into c from public.customer_competitions where id = new.competition_id;
    if not found or c.status <> 'pending_verification' or c.reward_issued_at is not null or c.frozen_at is null
       or c.winner_customer_id is distinct from new.customer_id or c.reward_amount_inr <> new.amount_inr then
      raise exception 'reward_not_allowed';
    end if;
  else
    if new.customer_id is distinct from old.customer_id or new.competition_id is distinct from old.competition_id
       or new.amount_inr is distinct from old.amount_inr or new.code is distinct from old.code or new.expires_at is distinct from old.expires_at
       or (old.status = 'revoked' and new.status <> 'revoked') then
      raise exception 'append_only';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists promo_grant_guard on public.promo_balance_grants;
create trigger promo_grant_guard before insert or update or delete on public.promo_balance_grants
  for each row execute function public.promo_grant_guard();

-- ============ 4. WHAT COUNTS (one place - used by the leaderboard, the winner, the customer screens and the admin screens) ============
-- A booking is "genuine activity" only if: made by the referred customer himself, at a shop owned by neither person, the shop is still live,
-- price >= admin minimum, inside the competition dates, in the status the competition asks for (a cancelled / no-show booking never is),
-- and not under an open dispute.
create or replace function public.customer_comp_booking_valid(p_booking uuid, p_competition uuid, p_referrer uuid, p_referred uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.bookings b
      join public.businesses z on z.id = b.business_id
      join public.customer_competitions c on c.id = p_competition
     where b.id = p_booking and b.customer_id = p_referred and b.source = 'customer'
       and z.owner_id <> p_referrer and z.owner_id <> p_referred and z.status in ('approved', 'inactive')
       and b.price_inr >= c.min_booking_value_inr
       and case when c.eligibility_rule = 'completed_booking'
                then b.status = 'completed' and b.completed_at >= c.starts_at and b.completed_at < c.ends_at
                else b.status in ('confirmed', 'checked_in', 'in_service', 'completed') and b.created_at >= c.starts_at and b.created_at < c.ends_at end
       and not exists (select 1 from public.booking_disputes d where d.booking_id = b.id and d.status = 'open')
  );
$$;

-- the earliest booking of the referred customer that is valid genuine activity (null = none yet)
create or replace function public.customer_comp_find_booking(p_competition uuid, p_referrer uuid, p_referred uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select b.id from public.bookings b
   where b.customer_id = p_referred and b.source = 'customer'
     and public.customer_comp_booking_valid(b.id, p_competition, p_referrer, p_referred)
   order by b.created_at limit 1;
$$;

-- The referral rows that COUNT. p_competition = all rows of a competition; p_id = just one row (pass null for the other).
-- Counts only if: qualified, not on hold / rejected / fraudulent, original referral still valid, both accounts still active and
-- e-mail verified, and the qualifying booking is STILL valid right now.
create or replace function public.customer_comp_countable(p_competition uuid, p_id uuid default null)
returns table (ccr_id uuid, referral_id uuid, referrer_id uuid, referred_id uuid, qualified_at timestamptz, booking_id uuid)
language sql stable security definer set search_path = '' as $$
  select x.id, x.referral_id, x.referrer_id, x.referred_id, x.qualified_at, x.qualifying_booking_id
    from public.customer_comp_referrals x
    join public.referrals r on r.id = x.referral_id and r.status in ('pending', 'rewarded')
    join public.profiles rp on rp.id = x.referrer_id and not rp.is_suspended and rp.role = 'customer' and rp.email_verified
    join public.profiles dp on dp.id = x.referred_id and not dp.is_suspended and dp.role = 'customer' and dp.email_verified
   where x.competition_id = coalesce(p_competition, x.competition_id) and (p_id is null or x.id = p_id)
     and x.status = 'qualified' and x.review_status in ('clear', 'approved')
     and x.qualifying_booking_id is not null
     and public.customer_comp_booking_valid(x.qualifying_booking_id, x.competition_id, x.referrer_id, x.referred_id);
$$;

create or replace function public.customer_comp_row_countable(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customer_comp_countable(null, p_id));
$$;

-- Ranking: most counted referrals first; tie = whoever reached that count EARLIER wins; then the older account. (Same output as 0032.)
create or replace function public.customer_comp_ranking(p_competition_id uuid)
returns table (pos int, referrer_id uuid, full_name text, display_name text, referrals int, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select (row_number() over (order by g.cnt desc, g.last_at asc, pr.created_at asc))::int,
         g.referrer_id, pr.full_name, public.customer_display_name(pr.full_name), g.cnt, g.last_at
    from (
      select cr.referrer_id, count(*)::int as cnt, max(cr.qualified_at) as last_at
        from public.customer_comp_countable(p_competition_id) cr
       group by cr.referrer_id
    ) g
    join public.profiles pr on pr.id = g.referrer_id;
$$;

-- ============ 5. RISK DETECTION ============
-- Adds up weak signals. Score >= 50 = "suspicious" (ON HOLD, admin decides). Nobody is rejected / marked fraudulent automatically.
--   device_same_as_referrer 40 | device_shared_between_referred 35 | device_many_accounts 30 | device_fp_shared 20 | network_shared 15
--   accounts_created_close 25 | fast_booking 25 | rapid_pattern 20 | same_shop_cluster 30 (40 if 4+) | single_shop_accounts 25
--   unusual_volume 20 (35 if very high) | similar_email_pattern 25 | booking_churn 20 | sequential_phone 30
-- No signal alone reaches 50 (the strongest are 40), and the network signal is worth only 15.
create or replace function public.evaluate_customer_referral_risk(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.customer_comp_referrals; r public.referrals; pr public.profiles; bk public.bookings; c public.customer_competitions;
  sig jsonb := '[]'::jsonb; score int := 0; n int; v_local text; v_pkey text;
begin
  select * into x from public.customer_comp_referrals where id = p_id for update;
  if not found or x.status <> 'qualified' then return; end if;
  if x.review_status not in ('clear', 'suspicious') then return; end if;          -- an admin decision is never overwritten by the system
  select * into c from public.customer_competitions where id = x.competition_id;
  if not found or c.status = 'ended' then return; end if;                           -- a closed competition is frozen
  select * into r from public.referrals where id = x.referral_id;
  if not found then return; end if;
  select * into pr from public.profiles where id = x.referred_id;
  if not found then return; end if;
  select * into bk from public.bookings where id = x.qualifying_booking_id;
  if not found then return; end if;

  -- same browser (random id kept on the device) used by the referrer and the referred customer
  select count(*) into n from public.customer_device_log a
    join public.customer_device_log b on b.device_id = a.device_id and b.user_id = x.referrer_id
   where a.user_id = x.referred_id and a.device_id <> '';
  if n > 0 then sig := sig || jsonb_build_object('code', 'device_same_as_referrer', 'weight', 40, 'count', n); score := score + 40; end if;

  -- same browser used by several customers referred by the same referrer
  select count(distinct b.user_id) into n from public.customer_device_log a
    join public.customer_device_log b on b.device_id = a.device_id and b.user_id <> a.user_id and b.user_id <> x.referrer_id
    join public.referrals o on o.referred_id = b.user_id and o.referrer_id = x.referrer_id
   where a.user_id = x.referred_id and a.device_id <> '';
  if n > 0 then sig := sig || jsonb_build_object('code', 'device_shared_between_referred', 'weight', 35, 'count', n); score := score + 35; end if;

  -- the same browser behind many different accounts
  select count(distinct b.user_id) into n from public.customer_device_log a
    join public.customer_device_log b on b.device_id = a.device_id and b.user_id <> a.user_id
   where a.user_id = x.referred_id and a.device_id <> '';
  if n >= 2 then sig := sig || jsonb_build_object('code', 'device_many_accounts', 'weight', 30, 'count', n + 1); score := score + 30; end if;

  -- same browser pattern (hash of browser attributes) as the referrer / other referred customers (common phone models can collide: weak)
  select count(*) into n from public.customer_device_log a
    join public.customer_device_log b on b.device_fp = a.device_fp and b.user_id <> a.user_id
   where a.user_id = x.referred_id and a.device_fp <> ''
     and (b.user_id = x.referrer_id or exists (select 1 from public.referrals o where o.referrer_id = x.referrer_id and o.referred_id = b.user_id));
  if n > 0 then sig := sig || jsonb_build_object('code', 'device_fp_shared', 'weight', 20, 'count', n); score := score + 20; end if;

  -- same network (weak on purpose: family / hostel Wi-Fi and mobile data are shared by many honest people)
  select count(*) into n from public.customer_device_log a
    join public.customer_device_log b on b.ip_hash = a.ip_hash and b.user_id <> a.user_id
   where a.user_id = x.referred_id and a.ip_hash <> ''
     and (b.user_id = x.referrer_id or exists (select 1 from public.referrals o where o.referrer_id = x.referrer_id and o.referred_id = b.user_id));
  if n > 0 then sig := sig || jsonb_build_object('code', 'network_shared', 'weight', 15, 'count', n); score := score + 15; end if;

  -- many new accounts of the same referrer created within 30 minutes of each other
  select count(*) into n from public.referrals o join public.profiles op on op.id = o.referred_id
   where o.referrer_id = x.referrer_id and o.referred_id <> x.referred_id and abs(extract(epoch from (op.created_at - pr.created_at))) <= 1800;
  if n >= 2 then sig := sig || jsonb_build_object('code', 'accounts_created_close', 'weight', 25, 'count', n + 1); score := score + 25; end if;

  -- rapid registration followed by an immediate qualifying booking (alone only a mild signal)
  if bk.created_at < pr.created_at + interval '30 minutes' then
    sig := sig || jsonb_build_object('code', 'fast_booking', 'weight', 25); score := score + 25;
    select count(*) into n from public.customer_comp_referrals o2
      join public.profiles op on op.id = o2.referred_id
      join public.bookings ob on ob.id = o2.qualifying_booking_id
     where o2.referrer_id = x.referrer_id and o2.id <> x.id and ob.created_at < op.created_at + interval '30 minutes';
    if n >= 2 then sig := sig || jsonb_build_object('code', 'rapid_pattern', 'weight', 20, 'count', n + 1); score := score + 20; end if;
  end if;

  -- several other customers of the same referrer also booked at the SAME shop
  select count(distinct ob.customer_id) into n from public.referrals o join public.bookings ob on ob.customer_id = o.referred_id
   where o.referrer_id = x.referrer_id and o.referred_id <> x.referred_id and ob.business_id = bk.business_id and ob.status <> 'cancelled';
  if n >= 4 then sig := sig || jsonb_build_object('code', 'same_shop_cluster', 'weight', 40, 'count', n + 1); score := score + 40;
  elsif n >= 2 then sig := sig || jsonb_build_object('code', 'same_shop_cluster', 'weight', 30, 'count', n + 1); score := score + 30; end if;

  -- several accounts of the same referrer that have used ONLY this one shop (this customer too)
  if not exists (select 1 from public.bookings ob where ob.customer_id = x.referred_id and ob.business_id <> bk.business_id) then
    select count(*) into n from public.referrals o
     where o.referrer_id = x.referrer_id and o.referred_id <> x.referred_id
       and exists (select 1 from public.bookings ob where ob.customer_id = o.referred_id and ob.business_id = bk.business_id and ob.status <> 'cancelled')
       and not exists (select 1 from public.bookings ob where ob.customer_id = o.referred_id and ob.business_id <> bk.business_id);
    if n >= 2 then sig := sig || jsonb_build_object('code', 'single_shop_accounts', 'weight', 25, 'count', n + 1); score := score + 25; end if;
  end if;

  -- unusual referral activity from one customer
  select count(*) into n from public.referrals o
   where o.referrer_id = x.referrer_id and o.created_at between r.created_at - interval '24 hours' and r.created_at;
  if n >= 12 then sig := sig || jsonb_build_object('code', 'unusual_volume', 'weight', 35, 'count', n); score := score + 35;
  elsif n >= 6 then sig := sig || jsonb_build_object('code', 'unusual_volume', 'weight', 20, 'count', n); score := score + 20; end if;

  -- artificially created accounts: similar e-mail names (user1@, user2@, user.3@ ...) for the same referrer
  select regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z]', '', 'g') into v_local from auth.users u where u.id = x.referred_id;
  if v_local is not null and char_length(v_local) >= 4 then
    select count(*) into n from public.referrals o join auth.users u2 on u2.id = o.referred_id
     where o.referrer_id = x.referrer_id and o.referred_id <> x.referred_id
       and regexp_replace(lower(split_part(u2.email, '@', 1)), '[^a-z]', '', 'g') = v_local;
    if n >= 2 then sig := sig || jsonb_build_object('code', 'similar_email_pattern', 'weight', 25, 'count', n + 1); score := score + 25; end if;
  end if;

  -- repeated cancelled / no-show bookings by the referred customer inside the competition
  select count(*) into n from public.bookings b
   where b.customer_id = x.referred_id and b.status in ('cancelled', 'no_show') and b.created_at >= c.starts_at;
  if n >= 2 then sig := sig || jsonb_build_object('code', 'booking_churn', 'weight', 20, 'count', n); score := score + 20; end if;

  -- made-up looking phone number
  v_pkey := public.phone_key(pr.phone);
  if v_pkey is not null and (v_pkey ~ '^(\d)\1{7,}$' or v_pkey in ('1234567890', '0123456789', '9876543210', '0987654321')) then
    sig := sig || jsonb_build_object('code', 'sequential_phone', 'weight', 30); score := score + 30;
  end if;

  -- keep an earlier hold signal that is not computed here (a booking dispute) - it is re-added only by the dispute trigger
  if exists (select 1 from jsonb_array_elements(x.risk_signals) e where e ->> 'code' = 'booking_disputed') then
    sig := sig || jsonb_build_object('code', 'booking_disputed', 'weight', 50); score := score + 50;
  end if;

  update public.customer_comp_referrals
     set risk_score = score, risk_signals = sig, risk_evaluated_at = now(),
         review_status = case when x.review_status = 'clear' and score >= 50 then 'suspicious' else x.review_status end
   where id = x.id;
  if x.review_status = 'clear' and score >= 50 then
    perform public.log_customer_comp_event('referral', x.id, x.competition_id, 'risk_flagged', 'clear', 'suspicious', null, 'risk score ' || score,
      jsonb_build_object('score', score, 'signals', sig));
  end if;
end $$;

-- new activity can make EARLIER referrals of the same referrer look suspicious (a burst of accounts): re-check them all
create or replace function public.reevaluate_referrer_customer_referrals(p_referrer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare x record;
begin
  for x in select id from public.customer_comp_referrals
            where referrer_id = p_referrer and status = 'qualified' and review_status in ('clear', 'suspicious') order by created_at loop
    perform public.evaluate_customer_referral_risk(x.id);
  end loop;
end $$;

-- ============ 6. DEVICE LOG + CLAIM (replaces the 0010 claim function) ============
create or replace function public.record_customer_device(p_device_id text, p_device_fp text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id text := lower(trim(coalesce(p_device_id, ''))); v_fp text := lower(trim(coalesce(p_device_fp, '')));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'customer') then return; end if;
  if v_id !~ '^[a-f0-9]{16,64}$' then return; end if;
  if v_fp !~ '^[a-f0-9]{16,64}$' then v_fp := ''; end if;
  insert into public.customer_device_log (user_id, device_id, device_fp, ip_hash)
  values (auth.uid(), v_id, v_fp, coalesce(public.shop_request_ip_hash(), ''))
  on conflict (user_id, device_id, ip_hash) do update
    set last_seen = now(), device_fp = case when excluded.device_fp <> '' then excluded.device_fp else public.customer_device_log.device_fp end;
end $$;

-- Called once by a NEW customer who arrived through a link. Cannot be changed afterwards (the FIRST attribution is the only one kept).
-- Same rules as before, plus: the referrer's own e-mail identity / phone is refused, every attempt is logged, the browser is recorded.
drop function if exists public.claim_referral(text);
create or replace function public.claim_referral(p_code text, p_device_id text default null, p_device_fp text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; rp public.profiles; v_ref uuid; v_code text := upper(trim(coalesce(p_code, ''))); v_out text; v_ok boolean := false;
  v_dev text := lower(trim(coalesce(p_device_id, ''))); v_me_mail text; v_ref_mail text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or me.role <> 'customer' or me.is_suspended then return false; end if;
  begin perform public.record_customer_device(p_device_id, p_device_fp); exception when others then null; end;
  select user_id into v_ref from public.referral_codes where code = v_code;

  if me.created_at < now() - interval '7 days' then v_out := 'account_too_old';
  elsif exists (select 1 from public.referrals where referred_id = me.id) then v_out := 'already_attributed';
  elsif exists (select 1 from public.bookings where customer_id = me.id) then v_out := 'has_bookings';
  elsif v_ref is null then v_out := 'invalid_code';
  elsif v_ref = me.id then v_out := 'self_referral';
  else
    select * into rp from public.profiles where id = v_ref;
    select public.normalize_email(u.email) into v_me_mail from auth.users u where u.id = me.id;
    select public.normalize_email(u.email) into v_ref_mail from auth.users u where u.id = v_ref;
    if v_me_mail is not null and v_me_mail = v_ref_mail then v_out := 'self_referral';
    elsif public.phone_key(me.phone) is not null and public.phone_key(me.phone) = public.phone_key(rp.phone) then v_out := 'self_referral';
    else
      begin
        insert into public.referrals (referrer_id, referred_id, code) values (v_ref, me.id, v_code);
        v_out := 'accepted'; v_ok := true;
      exception when unique_violation then
        v_out := 'already_attributed';
      end;
    end if;
  end if;

  insert into public.customer_referral_claim_log (customer_id, referrer_id, code, outcome, device_id, ip_hash)
  values (me.id, v_ref, left(v_code, 20), v_out, case when v_dev ~ '^[a-f0-9]{16,64}$' then v_dev else null end, public.shop_request_ip_hash());
  return v_ok;
end $$;

-- ============ 7. QUALIFICATION (replaces the 0032 function: stricter validation + risk check + audit) ============
-- internal: store a refused referral (never counts) and write the audit trail
create or replace function public.customer_comp_auto_reject(p_competition uuid, p_referral uuid, p_referrer uuid, p_referred uuid, p_reason text,
  p_email text default null, p_phone_key text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.customer_comp_referrals (competition_id, referral_id, referrer_id, referred_id, referred_email, referred_phone_key, status, review_status, reject_reason)
  values (p_competition, p_referral, p_referrer, p_referred, p_email, p_phone_key, 'rejected', 'rejected', p_reason)
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    perform public.log_customer_comp_event('referral', v_id, p_competition, 'auto_reject', null, 'rejected', null, p_reason, jsonb_build_object('referral_id', p_referral));
  end if;
end $$;

create or replace function public.try_qualify_customer_comp_referral(p_referred uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.referrals; c public.customer_competitions; pr public.profiles; rr public.profiles;
  v_email text; v_ref_email text; v_pkey text; v_bk uuid; v_id uuid;
begin
  select * into r from public.referrals where referred_id = p_referred and status in ('pending', 'rewarded');
  if not found then return; end if;
  if exists (select 1 from public.customer_comp_referrals where referred_id = p_referred) then return; end if;
  select * into c from public.customer_competitions where status = 'active' and now() >= starts_at and now() < ends_at limit 1;
  if not found then return; end if;

  select * into pr from public.profiles where id = p_referred;
  if not found or pr.is_suspended or pr.role <> 'customer' or not pr.email_verified then return; end if;   -- may be fixed later: wait
  select public.normalize_email(u.email) into v_email from auth.users u where u.id = p_referred and u.email_confirmed_at is not null;
  if coalesce(v_email, '') = '' then return; end if;
  v_pkey := public.phone_key(pr.phone);

  select * into rr from public.profiles where id = r.referrer_id;
  if not found or rr.is_suspended or rr.role <> 'customer' then
    perform public.customer_comp_auto_reject(c.id, r.id, r.referrer_id, p_referred, 'referrer_not_eligible');
    return;
  end if;
  if not rr.email_verified then return; end if;                                    -- may verify later: wait

  select public.normalize_email(u.email) into v_ref_email from auth.users u where u.id = r.referrer_id;

  -- 1. the referrer referring their own account (same e-mail identity, or same phone number)
  if (v_ref_email is not null and v_ref_email = v_email) or (v_pkey is not null and v_pkey = public.phone_key(rr.phone)) then
    perform public.customer_comp_auto_reject(c.id, r.id, r.referrer_id, p_referred, 'self_referral');
    return;
  end if;
  -- 2. the referred account already existed before the competition (it is not a NEW customer)
  if pr.created_at < c.starts_at then
    perform public.customer_comp_auto_reject(c.id, r.id, r.referrer_id, p_referred, 'existing_account');
    return;
  end if;
  -- 3. the referred phone number already belonged to another account that was created earlier
  if v_pkey is not null and exists (select 1 from public.profiles o where o.id <> p_referred and public.phone_key(o.phone) = v_pkey and o.created_at < pr.created_at) then
    perform public.customer_comp_auto_reject(c.id, r.id, r.referrer_id, p_referred, 'phone_already_registered', null, v_pkey);
    return;
  end if;
  -- 4. the same person again: same e-mail identity or same phone already counted (or marked fraudulent) in this competition
  if exists (select 1 from public.customer_comp_referrals x where x.competition_id = c.id and x.referred_email = v_email
                and (x.status = 'qualified' or x.review_status = 'fraudulent')) then
    perform public.customer_comp_auto_reject(c.id, r.id, r.referrer_id, p_referred, 'duplicate_email');
    return;
  end if;
  if v_pkey is not null and exists (select 1 from public.customer_comp_referrals x where x.competition_id = c.id and x.referred_phone_key = v_pkey
                and (x.status = 'qualified' or x.review_status = 'fraudulent')) then
    perform public.customer_comp_auto_reject(c.id, r.id, r.referrer_id, p_referred, 'duplicate_phone', null, v_pkey);
    return;
  end if;

  -- 5. the genuine activity: valid booking inside the competition dates, at a shop owned by neither person (none yet = keep waiting)
  v_bk := public.customer_comp_find_booking(c.id, r.referrer_id, p_referred);
  if v_bk is null then return; end if;

  begin
    insert into public.customer_comp_referrals (competition_id, referral_id, referrer_id, referred_id, referred_email, referred_phone_key,
                                                qualifying_booking_id, status, review_status)
    values (c.id, r.id, r.referrer_id, p_referred, v_email, v_pkey, v_bk, 'qualified', 'clear')
    returning id into v_id;
  exception when unique_violation then
    if not exists (select 1 from public.customer_comp_referrals where referred_id = p_referred) then
      perform public.customer_comp_auto_reject(c.id, r.id, r.referrer_id, p_referred, 'duplicate_identity');
    end if;
    return;
  end;
  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
  values (null, 'customer_referral.qualify', 'customer_referral', r.id, jsonb_build_object('competition_id', c.id, 'booking_id', v_bk));
  perform public.log_customer_comp_event('referral', v_id, c.id, 'qualify', null, 'clear', null, null,
    jsonb_build_object('referral_id', r.id, 'booking_id', v_bk));

  -- risk check of this referral and the other referrals of the same referrer
  perform public.reevaluate_referrer_customer_referrals(r.referrer_id);
end $$;

-- Triggers: errors are swallowed so a booking / profile update can NEVER fail because of the competition.
-- Booking trigger (replaces 0032): qualifies referrals, and when a booking that a referral relies on is cancelled / no-show it either
-- switches to another valid booking of that customer or records that the referral no longer counts (the leaderboard drops it at once).
create or replace function public.customer_comp_booking_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare x record; v_new uuid;
begin
  if new.customer_id is not null and new.source = 'customer' and new.status in ('confirmed', 'checked_in', 'in_service', 'completed') then
    begin perform public.try_qualify_customer_comp_referral(new.customer_id);
    exception when others then null; end;
  end if;
  if tg_op = 'UPDATE' then
    if new.status in ('cancelled', 'no_show') and old.status is distinct from new.status then
      begin
        for x in select x2.id, x2.competition_id, x2.referrer_id, x2.referred_id, x2.review_status from public.customer_comp_referrals x2
                  join public.customer_competitions cc on cc.id = x2.competition_id and cc.status <> 'ended'
                 where x2.qualifying_booking_id = new.id and x2.status = 'qualified' loop
          v_new := public.customer_comp_find_booking(x.competition_id, x.referrer_id, x.referred_id);
          if v_new is not null then
            update public.customer_comp_referrals set qualifying_booking_id = v_new where id = x.id;
            perform public.log_customer_comp_event('referral', x.id, x.competition_id, 'booking_replaced', x.review_status, x.review_status, null,
              new.status::text, jsonb_build_object('old_booking_id', new.id, 'new_booking_id', v_new));
          else
            perform public.log_customer_comp_event('referral', x.id, x.competition_id, 'booking_no_longer_valid', x.review_status, x.review_status, null,
              new.status::text, jsonb_build_object('booking_id', new.id));
          end if;
        end loop;
      exception when others then null; end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists customer_comp_booking_check on public.bookings;
create trigger customer_comp_booking_check after insert or update of status on public.bookings
  for each row execute function public.customer_comp_booking_check();

-- A dispute raised on a booking that a referral relies on puts that referral ON HOLD again (admin decides; nothing is rejected automatically)
create or replace function public.customer_comp_dispute_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare x record;
begin
  begin
    for x in select x2.id, x2.competition_id, x2.review_status, x2.risk_signals, x2.risk_score from public.customer_comp_referrals x2
              join public.customer_competitions cc on cc.id = x2.competition_id and cc.status <> 'ended'
             where x2.qualifying_booking_id = new.booking_id and x2.status = 'qualified' and x2.review_status in ('clear', 'approved') loop
      update public.customer_comp_referrals
         set review_status = 'suspicious', risk_score = greatest(x.risk_score, 50),
             risk_signals = x.risk_signals || jsonb_build_array(jsonb_build_object('code', 'booking_disputed', 'weight', 50)),
             reviewed_by = null, reviewed_at = null
       where id = x.id;
      perform public.log_customer_comp_event('referral', x.id, x.competition_id, 'risk_flagged', x.review_status, 'suspicious', null, 'booking disputed',
        jsonb_build_object('booking_id', new.booking_id, 'dispute_id', new.id));
    end loop;
  exception when others then null; end;
  return new;
end $$;
drop trigger if exists customer_comp_dispute_check on public.booking_disputes;
create trigger customer_comp_dispute_check after insert on public.booking_disputes
  for each row execute function public.customer_comp_dispute_check();

-- ============ 8. ENDING A COMPETITION = FREEZE (replaces 0032: no reward here either) ============
-- 1) the final leaderboard is frozen (snapshot nobody can change; no new referral can enter), 2) every open referral is risk-checked.
-- The Promotional Balance is issued only later, by admin_confirm_customer_winner().
create or replace function public.customer_competition_close(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customer_competitions; v_snap jsonb; x record;
begin
  select * into c from public.customer_competitions where id = p_id for update;
  if not found or c.status not in ('active', 'paused') then return; end if;
  select jsonb_build_object(
           'captured_at', now(),
           'held_total', (select count(*)::int from public.customer_comp_referrals where competition_id = p_id and status = 'qualified' and review_status in ('suspicious', 'in_review')),
           'ranking', coalesce((select jsonb_agg(jsonb_build_object('pos', k.pos, 'referrer_id', k.referrer_id, 'name', coalesce(k.full_name, k.display_name), 'referrals', k.referrals) order by k.pos)
                                  from public.customer_comp_ranking(p_id) k), '[]'::jsonb))
    into v_snap;
  update public.customer_competitions
     set status = 'pending_verification', ended_at = now(), frozen_at = now(), frozen_snapshot = v_snap
   where id = p_id;
  perform public.log_customer_comp_event('competition', p_id, p_id, 'freeze', c.status, 'pending_verification', auth.uid(), null,
    jsonb_build_object('snapshot', v_snap));
  for x in select id from public.customer_comp_referrals where competition_id = p_id and status = 'qualified' and review_status in ('clear', 'suspicious') loop
    perform public.evaluate_customer_referral_risk(x.id);
  end loop;
  perform public.write_audit_log('customer_competition.end', 'customer_competition', p_id, '{}');
end $$;

-- ============ 9. CUSTOMER FUNCTIONS (changed) ============
create or replace function public.get_customer_competition_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare c public.customer_competitions; me record; v_total int; v_wait int; v_review int; v_sponsor text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not (public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'customer')) then
    raise exception 'not_available' using errcode = '42501';
  end if;
  select * into c from public.customer_competitions where status in ('active', 'paused', 'pending_verification') limit 1;
  if not found then
    select * into c from public.customer_competitions where status = 'ended' order by ended_at desc nulls last limit 1;
  end if;
  if not found then return null; end if;
  select pos, referrals into me from public.customer_comp_ranking(c.id) where referrer_id = auth.uid();
  select count(*)::int into v_total from public.customer_comp_ranking(c.id);
  select count(*)::int into v_review from public.customer_comp_referrals where competition_id = c.id and referrer_id = auth.uid() and status = 'qualified' and review_status in ('suspicious', 'in_review');
  select count(*)::int into v_wait from public.referrals r
   where r.referrer_id = auth.uid() and r.status in ('pending', 'rewarded') and r.created_at >= c.starts_at
     and not exists (select 1 from public.customer_comp_referrals x where x.referral_id = r.id);
  select name into v_sponsor from public.businesses where id = c.sponsor_business_id;
  return jsonb_build_object(
    'id', c.id, 'title', c.title, 'description', c.description, 'status', c.status,
    'starts_at', c.starts_at, 'ends_at', c.ends_at, 'reward_amount_inr', c.reward_amount_inr, 'server_now', now(),
    'sponsor_business_name', v_sponsor, 'reward_valid_days', c.reward_valid_days,
    'eligibility_rule', c.eligibility_rule, 'min_booking_value_inr', c.min_booking_value_inr,
    'my_rank', me.pos, 'my_count', coalesce(me.referrals, 0), 'my_in_review', v_review, 'my_waiting', v_wait, 'participants', v_total,
    'winner_name', case when c.reward_issued_at is not null then c.winner_name end,                 -- the winner is public only after final confirmation + reward
    'winner_referral_count', case when c.reward_issued_at is not null then c.winner_referral_count end,
    'i_won', (c.reward_issued_at is not null and c.winner_customer_id is not null and c.winner_customer_id = auth.uid()));
end $$;

-- My own referrals: only a first name + initial of the referred person, and what is still missing. Never the risk signals.
create or replace function public.my_customer_comp_referrals()
returns table (id uuid, created_at timestamptz, display_name text, email_verified boolean, activity_done boolean, state text, reject_reason text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return query
  select r.id, r.created_at, public.customer_display_name(p.full_name), coalesce(p.email_verified, false),
         (x.qualifying_booking_id is not null and x.status = 'qualified' and public.customer_comp_booking_valid(x.qualifying_booking_id, x.competition_id, x.referrer_id, x.referred_id)),
         case when x.id is null then 'waiting'
              when x.status = 'rejected' or x.review_status in ('rejected', 'fraudulent') then 'rejected'
              when x.review_status in ('suspicious', 'in_review') then 'under_review'
              when public.customer_comp_row_countable(x.id) then 'counted'
              else 'waiting' end,
         case when x.review_status = 'fraudulent' then 'admin_rejected' else x.reject_reason end
    from public.referrals r
    left join public.profiles p on p.id = r.referred_id
    left join public.customer_comp_referrals x on x.referral_id = r.id
   where r.referrer_id = auth.uid() and r.status in ('pending', 'rewarded')
   order by r.created_at desc
   limit 100;
end $$;

-- ============ 10. ADMIN: FRAUD REVIEW ============
-- Everything the fraud-review screen shows. p_filter: all | needs_review | counted | not_counted | waiting  (old names review / rejected still work)
drop function if exists public.admin_customer_referral_overview(uuid, text);
create or replace function public.admin_customer_referral_overview(p_competition_id uuid, p_filter text default 'all', p_limit int default 100)
returns table (id uuid, referral_id uuid, referral_date timestamptz, qualified_at timestamptz, status text, review_status text, eligibility text,
               referrer_name text, referred_name text, business_name text, booking_id uuid, booking_status text, booking_price numeric, booking_date timestamptz,
               risk_score int, risk_signals jsonb, reject_reason text, review_note text, reviewed_by_name text, reviewed_at timestamptz, referrer_fraud_count int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare c public.customer_competitions;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.customer_competitions where id = p_competition_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return query
  select u.* from (
    select x.id as id, x.referral_id as referral_id, r.created_at as referral_date, x.qualified_at as qualified_at, x.status as status, x.review_status as review_status,
           (case when x.review_status = 'fraudulent' then 'fraudulent'
                 when x.status = 'rejected' then 'rejected'
                 when x.review_status in ('suspicious', 'in_review') then 'on_hold'
                 when public.customer_comp_row_countable(x.id) then 'counted'
                 when bk.id is null or not public.customer_comp_booking_valid(bk.id, x.competition_id, x.referrer_id, x.referred_id) then 'booking_invalid'
                 else 'account_invalid' end)::text as eligibility,
           coalesce(rp.full_name, '—') as referrer_name, coalesce(dp.full_name, '—') as referred_name, bz.name as business_name,
           bk.id as booking_id, bk.status::text as booking_status, bk.price_inr as booking_price, coalesce(bk.completed_at, bk.created_at) as booking_date,
           x.risk_score as risk_score, x.risk_signals as risk_signals, x.reject_reason as reject_reason, x.review_note as review_note,
           ap.full_name as reviewed_by_name, x.reviewed_at as reviewed_at,
           (select count(*)::int from public.customer_comp_referrals f where f.referrer_id = x.referrer_id and f.review_status = 'fraudulent') as referrer_fraud_count
      from public.customer_comp_referrals x
      join public.referrals r on r.id = x.referral_id
      join public.profiles rp on rp.id = x.referrer_id
      join public.profiles dp on dp.id = x.referred_id
      left join public.profiles ap on ap.id = x.reviewed_by
      left join public.bookings bk on bk.id = x.qualifying_booking_id
      left join public.businesses bz on bz.id = bk.business_id
     where x.competition_id = p_competition_id
    union all
    -- referred customers who joined with a link but have not finished the activity yet (nothing to decide, shown for transparency)
    select null::uuid, r.id, r.created_at, null::timestamptz, 'waiting'::text, null::text, 'waiting'::text,
           coalesce(rp.full_name, '—'), coalesce(dp.full_name, '—'), null::text, null::uuid, null::text, null::numeric, null::timestamptz,
           0, '[]'::jsonb, null::text, null::text, null::text, null::timestamptz, 0
      from public.referrals r
      join public.profiles rp on rp.id = r.referrer_id
      join public.profiles dp on dp.id = r.referred_id
     where r.status in ('pending', 'rewarded') and r.created_at >= c.starts_at
       and not exists (select 1 from public.customer_comp_referrals x where x.referral_id = r.id)
  ) u
  where case coalesce(p_filter, 'all')
          when 'needs_review' then u.review_status in ('suspicious', 'in_review') and u.status = 'qualified'
          when 'review' then u.review_status in ('suspicious', 'in_review') and u.status = 'qualified'
          when 'counted' then u.eligibility = 'counted'
          when 'not_counted' then u.eligibility in ('rejected', 'fraudulent', 'booking_invalid', 'account_invalid')
          when 'rejected' then u.eligibility in ('rejected', 'fraudulent', 'booking_invalid', 'account_invalid')
          when 'waiting' then u.eligibility = 'waiting'
          else true end
  order by (u.review_status in ('suspicious', 'in_review')) desc nulls last, u.risk_score desc, u.referral_date desc
  limit least(greatest(coalesce(p_limit, 100), 1), 300);
end $$;

-- the audit trail of ONE referral
create or replace function public.admin_customer_referral_history(p_id uuid)
returns table (id uuid, action text, from_state text, to_state text, note text, actor_name text, created_at timestamptz, details jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select v.id, v.action, v.from_state, v.to_state, v.note, p.full_name, v.created_at, v.details
    from public.customer_comp_audit_log v
    left join public.profiles p on p.id = v.actor_id
   where v.entity_type = 'referral' and v.entity_id = p_id
   order by v.created_at desc, v.id
   limit 100;
end $$;

-- the competition-level audit trail (freeze, validation, winner confirmation, reward, every referral decision)
create or replace function public.admin_customer_comp_audit(p_competition_id uuid, p_limit int default 50)
returns table (id uuid, entity_type text, entity_id uuid, action text, from_state text, to_state text, note text, actor_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select v.id, v.entity_type, v.entity_id, v.action, v.from_state, v.to_state, v.note, p.full_name, v.created_at
    from public.customer_comp_audit_log v
    left join public.profiles p on p.id = v.actor_id
   where v.competition_id = p_competition_id
   order by v.created_at desc, v.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- p_action: start_review | approve | reject | fraud | restore.  A note (3+ letters) is required for every decision except start_review.
-- Rejected / fraudulent referrals stop counting at once (the leaderboard is computed live). Restore puts an incorrectly rejected one back.
create or replace function public.admin_review_customer_referral(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.customer_comp_referrals; c public.customer_competitions; v_cid uuid;
  v_note text := left(trim(coalesce(p_note, '')), 300); v_to_status text; v_to_review text;
  v_bk uuid; v_email text; v_pkey text; v_pr public.profiles;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_action not in ('start_review', 'approve', 'reject', 'fraud', 'restore') then raise exception 'invalid_action'; end if;
  if p_action <> 'start_review' and char_length(v_note) < 3 then raise exception 'reason_required'; end if;

  -- lock order: competition first, then the referral row (same as the award function)
  select competition_id into v_cid from public.customer_comp_referrals where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.customer_competitions where id = v_cid for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status = 'ended' then raise exception 'competition_closed'; end if;
  select * into x from public.customer_comp_referrals where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_to_status := x.status; v_to_review := x.review_status;

  if p_action = 'start_review' then
    if x.status <> 'qualified' or x.review_status <> 'suspicious' then raise exception 'invalid_state'; end if;
    v_to_review := 'in_review';
  elsif p_action = 'approve' then
    if x.status <> 'qualified' or x.review_status not in ('suspicious', 'in_review') then raise exception 'invalid_state'; end if;
    v_to_review := 'approved';
  elsif p_action in ('reject', 'fraud') then
    if x.status <> 'qualified' or x.review_status not in ('clear', 'suspicious', 'in_review', 'approved') then raise exception 'invalid_state'; end if;
    v_to_status := 'rejected';
    v_to_review := case when p_action = 'fraud' then 'fraudulent' else 'rejected' end;
  else  -- restore
    if x.status <> 'rejected' then raise exception 'invalid_state'; end if;
    if x.reject_reason = 'self_referral' then raise exception 'cannot_restore'; end if;       -- a self-referral is never genuine
    select * into v_pr from public.profiles where id = x.referred_id;
    if not found or v_pr.is_suspended or v_pr.role <> 'customer' or not v_pr.email_verified then raise exception 'account_not_eligible'; end if;
    select public.normalize_email(u.email) into v_email from auth.users u where u.id = x.referred_id and u.email_confirmed_at is not null;
    if coalesce(v_email, '') = '' then raise exception 'account_not_eligible'; end if;
    v_pkey := public.phone_key(v_pr.phone);
    -- the genuine activity must exist (the old booking if still valid, else another valid one) - restoring never skips eligibility
    if x.qualifying_booking_id is not null and public.customer_comp_booking_valid(x.qualifying_booking_id, x.competition_id, x.referrer_id, x.referred_id) then
      v_bk := x.qualifying_booking_id;
    else
      v_bk := public.customer_comp_find_booking(x.competition_id, x.referrer_id, x.referred_id);
    end if;
    if v_bk is null then raise exception 'no_qualifying_activity'; end if;
    if exists (select 1 from public.customer_comp_referrals o where o.id <> x.id and o.competition_id = x.competition_id
                 and ((o.referred_email = v_email) or (v_pkey is not null and o.referred_phone_key = v_pkey))
                 and (o.status = 'qualified' or o.review_status = 'fraudulent')) then
      raise exception 'duplicate_identity';
    end if;
    v_to_status := 'qualified'; v_to_review := 'approved';
  end if;

  begin
    update public.customer_comp_referrals
       set status = v_to_status, review_status = v_to_review,
           reject_reason = case when p_action = 'reject' then 'admin_rejected' when p_action = 'fraud' then 'admin_fraud'
                                when p_action = 'restore' then null else reject_reason end,
           qualifying_booking_id = case when p_action = 'restore' then v_bk else qualifying_booking_id end,
           referred_email = case when p_action = 'restore' then v_email else referred_email end,
           referred_phone_key = case when p_action = 'restore' then v_pkey else referred_phone_key end,
           review_note = nullif(v_note, ''), reviewed_by = auth.uid(), reviewed_at = now()
     where id = x.id;
  exception when unique_violation then
    raise exception 'duplicate_identity';
  end;
  perform public.log_customer_comp_event('referral', x.id, x.competition_id, p_action, x.review_status, v_to_review, auth.uid(), v_note,
    jsonb_build_object('from_status', x.status, 'to_status', v_to_status, 'referral_id', x.referral_id));
  perform public.write_audit_log('customer_referral.' || p_action, 'customer_referral', x.id,
    jsonb_build_object('from_review', x.review_status, 'to_review', v_to_review, 'note', v_note));
end $$;

-- admin asks for a fresh risk check of one referral (for example after more devices were recorded)
create or replace function public.admin_recheck_customer_referral_risk(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_cid uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select competition_id into v_cid from public.customer_comp_referrals where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.evaluate_customer_referral_risk(p_id);
  perform public.log_customer_comp_event('referral', p_id, v_cid, 'recheck', null, null, auth.uid(), null, '{}'::jsonb);
end $$;

-- ============ 11. ADMIN: WINNER + REWARD PROTECTION ============
-- Step 2 of the reward process. Runs the eligibility / fraud validation on every open referral of the frozen competition.
-- Never touches the reward. Call it when the verification screen opens (and any time the admin wants a fresh check).
create or replace function public.admin_refresh_customer_winner(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customer_competitions; x record; v_n int := 0;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.customer_competitions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status <> 'pending_verification' then return; end if;
  for x in select id from public.customer_comp_referrals where competition_id = p_id and status = 'qualified' and review_status in ('clear', 'suspicious') loop
    perform public.evaluate_customer_referral_risk(x.id);
    v_n := v_n + 1;
  end loop;
  update public.customer_competitions set validated_at = now() where id = p_id;
  perform public.log_customer_comp_event('competition', p_id, p_id, 'validate', null, null, auth.uid(), null, jsonb_build_object('checked', v_n));
end $$;

-- Everything the winner screen shows. All numbers are computed here, none come from the browser.
create or replace function public.admin_customer_winner_check(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.customer_competitions; w record; v_has boolean; v_unres int; v_refs jsonb; v_top jsonb; v_rej int; v_fraud int; v_ok boolean := false;
  v_frozen_winner uuid; v_wprofile public.profiles;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.customer_competitions where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into w from public.customer_comp_ranking(p_id) where pos = 1;
  v_has := found;
  select count(*)::int into v_unres from public.customer_comp_referrals where competition_id = p_id and status = 'qualified' and review_status in ('suspicious', 'in_review');
  select count(*) filter (where review_status = 'rejected' or status = 'rejected')::int, count(*) filter (where review_status = 'fraudulent')::int
    into v_rej, v_fraud from public.customer_comp_referrals where competition_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('rank', t.pos, 'name', coalesce(t.full_name, t.display_name), 'referrals', t.referrals) order by t.pos), '[]'::jsonb)
    into v_top from (select * from public.customer_comp_ranking(p_id) where pos <= 3) t;
  v_frozen_winner := nullif(c.frozen_snapshot -> 'ranking' -> 0 ->> 'referrer_id', '')::uuid;
  if v_has then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', cr.ccr_id, 'referred_name', coalesce(dp.full_name, '—'), 'business_name', bz.name, 'price', bk.price_inr,
             'qualified_at', cr.qualified_at, 'risk_status', x.review_status, 'risk_score', x.risk_score) order by cr.qualified_at), '[]'::jsonb)
      into v_refs
      from public.customer_comp_countable(p_id) cr
      join public.customer_comp_referrals x on x.id = cr.ccr_id
      join public.profiles dp on dp.id = cr.referred_id
      left join public.bookings bk on bk.id = cr.booking_id
      left join public.businesses bz on bz.id = bk.business_id
     where cr.referrer_id = w.referrer_id;
    select * into v_wprofile from public.profiles where id = w.referrer_id;
    v_ok := c.status = 'pending_verification' and c.frozen_at is not null and c.reward_issued_at is null and v_unres = 0
            and v_wprofile.id is not null and not v_wprofile.is_suspended and v_wprofile.role = 'customer';
  end if;
  return jsonb_build_object(
    'status', c.status, 'reward_amount_inr', c.reward_amount_inr, 'already_issued', (c.reward_issued_at is not null),
    'frozen_at', c.frozen_at, 'validated_at', c.validated_at, 'frozen_ranking', coalesce(c.frozen_snapshot -> 'ranking', '[]'::jsonb),
    'has_winner', v_has, 'winner_id', case when v_has then w.referrer_id end, 'winner_name', case when v_has then coalesce(w.full_name, w.display_name) end,
    'winner_referrals', case when v_has then w.referrals end,
    'winner_changed_since_freeze', case when v_has then (v_frozen_winner is distinct from w.referrer_id) else false end,
    'winner_referral_list', coalesce(v_refs, '[]'::jsonb), 'top', v_top,
    'unresolved_review', v_unres, 'rejected_count', coalesce(v_rej, 0), 'fraud_count', coalesce(v_fraud, 0), 'can_issue', v_ok);
end $$;

-- Steps 2-5 in ONE call. The admin passes the winner he SAW (p_winner_id) only as a confirmation - the server recomputes the winner and the
-- count right now, runs the validation again, and refuses (returns a reason) if anything differs or is unresolved. The amount is read from
-- the competition row. Returns {awarded, reason}. Blocking reasons are returned (not raised) so the fresh validation stays saved; hard
-- errors (not admin, already awarded, wrong state) are raised.
drop function if exists public.admin_confirm_customer_winner(uuid, text);
create or replace function public.admin_confirm_customer_winner(p_id uuid, p_winner_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.customer_competitions; w record; x record; v_code text; v_grant uuid; v_unres int; v_note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.customer_competitions where id = p_id for update;           -- serialises two admins pressing the button together
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.reward_issued_at is not null or c.status = 'ended' or exists (select 1 from public.promo_balance_grants where competition_id = p_id) then
    raise exception 'already_awarded';
  end if;
  if c.status <> 'pending_verification' then raise exception 'invalid_state'; end if;
  if c.frozen_at is null then raise exception 'not_frozen'; end if;                         -- 1. the leaderboard must be frozen
  if p_winner_id is null then raise exception 'winner_required'; end if;

  for x in select id from public.customer_comp_referrals where competition_id = p_id and status = 'qualified' and review_status in ('clear', 'suspicious') loop
    perform public.evaluate_customer_referral_risk(x.id);                                   -- 2. eligibility / fraud validation, right now
  end loop;
  update public.customer_competitions set validated_at = now() where id = p_id;

  select count(*)::int into v_unres from public.customer_comp_referrals where competition_id = p_id and status = 'qualified' and review_status in ('suspicious', 'in_review');
  if v_unres > 0 then
    perform public.log_customer_comp_event('reward', p_id, p_id, 'award_blocked', null, null, auth.uid(), 'unresolved_review', jsonb_build_object('count', v_unres));
    return jsonb_build_object('awarded', false, 'reason', 'unresolved_review', 'count', v_unres);
  end if;
  select * into w from public.customer_comp_ranking(p_id) where pos = 1;                    -- winner and count recomputed on the server
  if not found then
    perform public.log_customer_comp_event('reward', p_id, p_id, 'award_blocked', null, null, auth.uid(), 'no_winner', '{}'::jsonb);
    return jsonb_build_object('awarded', false, 'reason', 'no_winner');
  end if;
  if w.referrer_id <> p_winner_id then                                                      -- 3. the admin must confirm the winner that is valid NOW
    perform public.log_customer_comp_event('reward', p_id, p_id, 'award_blocked', null, null, auth.uid(), 'winner_changed',
      jsonb_build_object('confirmed', p_winner_id, 'validated_winner', w.referrer_id));
    return jsonb_build_object('awarded', false, 'reason', 'winner_changed');
  end if;
  if not exists (select 1 from public.profiles pp where pp.id = w.referrer_id and not pp.is_suspended and pp.role = 'customer') then
    perform public.log_customer_comp_event('reward', p_id, p_id, 'award_blocked', null, null, auth.uid(), 'winner_not_eligible', '{}'::jsonb);
    return jsonb_build_object('awarded', false, 'reason', 'winner_not_eligible');
  end if;

  loop
    v_code := public.make_code('BP-', 8);
    exit when not exists (select 1 from public.promo_balance_grants where code = v_code);
  end loop;
  update public.customer_competitions
     set winner_customer_id = w.referrer_id, winner_name = w.display_name, winner_referral_count = w.referrals
   where id = p_id;
  begin                                                                                      -- 4. issue the reward - exactly once
    insert into public.promo_balance_grants (customer_id, competition_id, code, amount_inr, sponsor_business_id, expires_at, note, created_by)
    values (w.referrer_id, p_id, v_code, c.reward_amount_inr, c.sponsor_business_id, now() + make_interval(days => c.reward_valid_days), left(c.title, 100), auth.uid())
    returning id into v_grant;
  exception when unique_violation then
    raise exception 'already_awarded';                                                       -- 5. unique index on (competition_id) = last line of defence
  end;
  update public.customer_competitions
     set status = 'ended', reward_issued_at = now(), reward_issued_by = auth.uid(), reward_grant_id = v_grant, verification_note = v_note
   where id = p_id;
  perform public.log_customer_comp_event('reward', v_grant, p_id, 'award', 'pending_verification', 'ended', auth.uid(), v_note,
    jsonb_build_object('winner_id', w.referrer_id, 'referrals', w.referrals, 'reward_inr', c.reward_amount_inr, 'grant_id', v_grant));
  perform public.log_customer_comp_event('competition', p_id, p_id, 'winner_confirmed', 'pending_verification', 'ended', auth.uid(), v_note,
    jsonb_build_object('winner_id', w.referrer_id));
  perform public.write_audit_log('customer_competition.award', 'customer_competition', p_id,
    jsonb_build_object('winner_id', w.referrer_id, 'referrals', w.referrals, 'reward_inr', c.reward_amount_inr, 'grant_id', v_grant));
  return jsonb_build_object('awarded', true, 'grant_id', v_grant);
end $$;

-- when every referral of the leader was rejected: close the competition with no winner and no reward
create or replace function public.admin_close_customer_competition_no_winner(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customer_competitions; v_note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.customer_competitions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status <> 'pending_verification' or c.reward_issued_at is not null then raise exception 'invalid_state'; end if;
  if exists (select 1 from public.customer_comp_ranking(p_id) where pos = 1) then raise exception 'winner_exists'; end if;
  if exists (select 1 from public.customer_comp_referrals where competition_id = p_id and status = 'qualified' and review_status in ('suspicious', 'in_review')) then
    raise exception 'unresolved_review';
  end if;
  update public.customer_competitions set status = 'ended', winner_customer_id = null, winner_name = null, winner_referral_count = null, verification_note = v_note where id = p_id;
  perform public.log_customer_comp_event('competition', p_id, p_id, 'close_no_winner', 'pending_verification', 'ended', auth.uid(), v_note, '{}'::jsonb);
  perform public.write_audit_log('customer_competition.close_no_winner', 'customer_competition', p_id, '{}');
end $$;

-- ============ 11b. COMPETITIONS THAT ENDED / WAIT BEFORE THIS FILE: give them a frozen snapshot too ============
-- (one-off; a competition that is still waiting for its winner can then be confirmed with the new, safer flow)
update public.customer_competitions c
   set frozen_at = coalesce(c.ended_at, now()),
       frozen_snapshot = jsonb_build_object('captured_at', now(), 'legacy', true, 'held_total', 0,
         'ranking', coalesce((select jsonb_agg(jsonb_build_object('pos', k.pos, 'referrer_id', k.referrer_id, 'name', coalesce(k.full_name, k.display_name), 'referrals', k.referrals) order by k.pos)
                                from public.customer_comp_ranking(c.id) k), '[]'::jsonb))
 where c.status in ('pending_verification', 'ended') and c.frozen_at is null;

-- ============ 12. FUNCTION PRIVILEGES ============
revoke execute on function
  public.forbid_row_change(), public.shop_hash(text), public.shop_request_ip_hash(),
  public.log_customer_comp_event(text, uuid, uuid, text, text, text, uuid, text, jsonb),
  public.customer_comp_referrals_guard(), public.customer_competitions_lock_guard(), public.promo_grant_guard(),
  public.customer_comp_booking_valid(uuid, uuid, uuid, uuid), public.customer_comp_find_booking(uuid, uuid, uuid),
  public.customer_comp_countable(uuid, uuid), public.customer_comp_row_countable(uuid), public.customer_comp_ranking(uuid),
  public.evaluate_customer_referral_risk(uuid), public.reevaluate_referrer_customer_referrals(uuid),
  public.customer_comp_auto_reject(uuid, uuid, uuid, uuid, text, text, text), public.try_qualify_customer_comp_referral(uuid),
  public.customer_comp_booking_check(), public.customer_comp_dispute_check(), public.customer_competition_close(uuid),
  public.record_customer_device(text, text), public.claim_referral(text, text, text),
  public.get_customer_competition_overview(), public.my_customer_comp_referrals(),
  public.admin_customer_referral_overview(uuid, text, int), public.admin_customer_referral_history(uuid), public.admin_customer_comp_audit(uuid, int),
  public.admin_review_customer_referral(uuid, text, text), public.admin_recheck_customer_referral_risk(uuid),
  public.admin_refresh_customer_winner(uuid), public.admin_customer_winner_check(uuid),
  public.admin_confirm_customer_winner(uuid, uuid, text), public.admin_close_customer_competition_no_winner(uuid, text)
  from public, anon, authenticated;

grant execute on function
  public.record_customer_device(text, text), public.claim_referral(text, text, text),
  public.get_customer_competition_overview(), public.my_customer_comp_referrals(),
  public.admin_customer_referral_overview(uuid, text, int), public.admin_customer_referral_history(uuid), public.admin_customer_comp_audit(uuid, int),
  public.admin_review_customer_referral(uuid, text, text), public.admin_recheck_customer_referral_risk(uuid),
  public.admin_refresh_customer_winner(uuid), public.admin_customer_winner_check(uuid),
  public.admin_confirm_customer_winner(uuid, uuid, text), public.admin_close_customer_competition_no_winner(uuid, text)
  to authenticated;
