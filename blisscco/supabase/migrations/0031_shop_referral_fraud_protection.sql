-- 0031: Fraud protection for the Refer-a-Shop Competition (builds on 0030). Run after 0030. Safe to re-run.
--
-- What this adds
--   1. Stricter referral validation (self referral, business/phone already on Blisscco, duplicate business, incomplete / rejected profile).
--   2. Risk detection: several weak signals are added up into a risk score. Score >= 50 puts the referral on HOLD ("suspicious").
--      A held referral is NOT counted on the leaderboard, but it is NEVER rejected automatically - an admin decides.
--      One signal alone (for example the same IP / network) can never put a referral on hold: the network signal is worth only 15.
--   3. Admin fraud review: start review / approve / reject / mark fraudulent / reopen / re-check. Every decision is stored in an
--      append-only audit table (who, when, from -> to, note).
--   4. Winner protection: when a competition ends it moves to "pending_verification". The Business Growth Credit is added only after
--      an admin verified every qualifying referral of the winner, no suspicious referral is waiting, and only ONCE (database locks +
--      unique index + trigger). Winner, counts and amount are always recomputed / read on the server - the browser sends none of them.

-- ============ 1. COLUMNS ============
alter table public.shop_referrals add column if not exists risk_status text not null default 'clear';
alter table public.shop_referrals add column if not exists risk_score int not null default 0;
alter table public.shop_referrals add column if not exists risk_signals jsonb not null default '[]'::jsonb;
alter table public.shop_referrals add column if not exists risk_evaluated_at timestamptz;
alter table public.shop_referrals add column if not exists risk_decided_by uuid references public.profiles(id) on delete set null;
alter table public.shop_referrals add column if not exists risk_decided_at timestamptz;
alter table public.shop_referrals add column if not exists risk_decision_note text;
alter table public.shop_referrals add column if not exists winner_verified_at timestamptz;
alter table public.shop_referrals add column if not exists winner_verified_by uuid references public.profiles(id) on delete set null;

-- clear = no problem found | suspicious = on hold, waiting for admin | in_review = admin is looking at it
-- cleared = admin approved | rejected / fraudulent = admin decision, never counts
alter table public.shop_referrals drop constraint if exists shop_referrals_risk_status_check;
alter table public.shop_referrals add constraint shop_referrals_risk_status_check
  check (risk_status in ('clear', 'suspicious', 'in_review', 'cleared', 'rejected', 'fraudulent'));
create index if not exists shop_referrals_risk_idx on public.shop_referrals (risk_status) where status = 'qualified';

alter table public.shop_competitions add column if not exists reward_credited_by uuid references public.profiles(id) on delete set null;
alter table public.shop_competitions add column if not exists reward_ledger_id uuid;
alter table public.shop_competitions add column if not exists verification_note text;
alter table public.shop_competitions drop constraint if exists shop_competitions_status_check;
alter table public.shop_competitions add constraint shop_competitions_status_check
  check (status in ('draft', 'active', 'paused', 'pending_verification', 'ended'));

-- ============ 2. NEW TABLES ============
-- Append-only history of every referral decision / system event (who, when, from -> to)
create table if not exists public.shop_referral_reviews (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null,                       -- deliberately no foreign key: the trail must survive even if a referral is deleted
  action text not null,
  from_risk text, to_risk text, from_status text, to_status text,
  actor_id uuid references public.profiles(id) on delete set null,   -- null = the system
  note text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists shop_referral_reviews_ref_idx on public.shop_referral_reviews (referral_id, created_at desc);

-- Devices / networks seen for an owner (only hashes are stored - never the raw IP)
create table if not exists public.shop_device_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null default '',              -- random id kept in the browser
  device_fp text not null default '',              -- hash of browser attributes
  ip_hash text not null default '',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_id, ip_hash)
);
create index if not exists shop_device_log_device_idx on public.shop_device_log (device_id) where device_id <> '';
create index if not exists shop_device_log_fp_idx on public.shop_device_log (device_fp) where device_fp <> '';
create index if not exists shop_device_log_ip_idx on public.shop_device_log (ip_hash) where ip_hash <> '';

-- Every attempt to claim a referral code, with the outcome (also the refused ones)
create table if not exists public.shop_referral_claim_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  referrer_id uuid references public.profiles(id) on delete set null,
  code text,
  outcome text not null,
  device_id text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists shop_claim_log_owner_idx on public.shop_referral_claim_log (owner_id, created_at desc);

alter table public.shop_referral_reviews enable row level security;
alter table public.shop_device_log enable row level security;
alter table public.shop_referral_claim_log enable row level security;
drop policy if exists shop_reviews_select on public.shop_referral_reviews;
create policy shop_reviews_select on public.shop_referral_reviews for select to authenticated using (public.is_admin());
drop policy if exists shop_claim_log_select on public.shop_referral_claim_log;
create policy shop_claim_log_select on public.shop_referral_claim_log for select to authenticated using (public.is_admin());
revoke all on public.shop_referral_reviews, public.shop_device_log, public.shop_referral_claim_log from anon, authenticated;
grant select on public.shop_referral_reviews, public.shop_referral_claim_log to authenticated;   -- RLS: admin only; device log: no API access at all

-- ============ 3. DATABASE GUARDS ============
create or replace function public.forbid_row_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'append_only';
end $$;

drop trigger if exists shop_referral_reviews_append_only on public.shop_referral_reviews;
create trigger shop_referral_reviews_append_only before update or delete on public.shop_referral_reviews
  for each row execute function public.forbid_row_change();

-- the credit wallet is a ledger: rows are never edited or removed (a correction is a new 'reversal' row)
drop trigger if exists growth_ledger_append_only on public.growth_credit_ledger;
create trigger growth_ledger_append_only before update or delete on public.growth_credit_ledger
  for each row execute function public.forbid_row_change();

-- A competition reward row can only be inserted while the competition waits for verification, for exactly the stored amount,
-- for exactly the stored winner. (Defence in depth: the award function already checks all of this.)
create or replace function public.growth_ledger_reward_guard() returns trigger
language plpgsql set search_path = '' as $$
declare c public.shop_competitions;
begin
  if new.reason = 'competition_reward' then
    select * into c from public.shop_competitions where id = new.competition_id;
    if not found or c.status <> 'pending_verification' or c.reward_credited_at is not null
       or c.winner_owner_id is distinct from new.owner_id or c.reward_amount_inr <> new.delta_inr then
      raise exception 'reward_not_allowed';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists growth_ledger_reward_guard on public.growth_credit_ledger;
create trigger growth_ledger_reward_guard before insert on public.growth_credit_ledger
  for each row execute function public.growth_ledger_reward_guard();

-- Once a competition is waiting for verification / ended, prize, dates and title are frozen and a paid reward can never be undone
create or replace function public.shop_competitions_lock_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status in ('pending_verification', 'ended') then
    if new.reward_amount_inr is distinct from old.reward_amount_inr or new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at or new.title is distinct from old.title then
      raise exception 'competition_locked';
    end if;
  end if;
  if old.status = 'ended' and new.status <> 'ended' then raise exception 'competition_locked'; end if;
  if old.status = 'pending_verification' and new.status not in ('pending_verification', 'ended') then raise exception 'competition_locked'; end if;
  if old.reward_credited_at is not null and new.reward_credited_at is distinct from old.reward_credited_at then raise exception 'already_awarded'; end if;
  if old.winner_owner_id is not null and new.winner_owner_id is not null and new.winner_owner_id <> old.winner_owner_id
     and old.reward_credited_at is not null then
    raise exception 'already_awarded';
  end if;
  return new;
end $$;
drop trigger if exists shop_competitions_lock_guard on public.shop_competitions;
create trigger shop_competitions_lock_guard before update on public.shop_competitions
  for each row execute function public.shop_competitions_lock_guard();

-- ============ 4. SMALL HELPERS ============
-- lower-case, no spaces / punctuation (works for Devanagari too) - used to compare names, addresses, descriptions
create or replace function public.norm_text(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(lower(coalesce(p, '')), '[[:space:][:punct:]]+', '', 'g'), '');
$$;

create or replace function public.shop_hash(p text) returns text
language sql immutable set search_path = '' as $$
  select case when nullif(trim(coalesce(p, '')), '') is null then null
              else encode(sha256(convert_to('blisscco-shop|' || trim(p), 'utf8')), 'hex') end;
$$;

-- hash of the caller's network address (from the API gateway header). Only a WEAK signal: shared Wi-Fi / mobile networks are normal.
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

create or replace function public.log_shop_referral_event(p_referral uuid, p_action text, p_from_risk text, p_to_risk text,
  p_from_status text, p_to_status text, p_actor uuid, p_note text, p_details jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.shop_referral_reviews (referral_id, action, from_risk, to_risk, from_status, to_status, actor_id, note, details)
  values (p_referral, p_action, p_from_risk, p_to_risk, p_from_status, p_to_status, p_actor, left(p_note, 300), coalesce(p_details, '{}'::jsonb));
$$;

-- ============ 5. WHAT COUNTS (one place, used by the leaderboard, the winner and the verification) ============
-- A referral counts only if: qualified, not held / rejected / fraudulent, the business is still approved (or temporarily inactive),
-- its profile is still complete, its phone is verified, and neither owner is suspended.
create or replace function public.shop_countable_referrals(p_competition_id uuid)
returns table (referral_id uuid, referrer_id uuid, business_id uuid, qualified_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select sr.id, sr.referrer_id, qb.id, sr.qualified_at
    from public.shop_referrals sr
    join public.businesses qb on qb.id = sr.qualified_business_id and qb.status in ('approved', 'inactive') and qb.phone_verified_at is not null
    join public.profiles op on op.id = sr.referred_owner_id and not op.is_suspended
    join public.profiles rp on rp.id = sr.referrer_id and not rp.is_suspended
   where sr.competition_id = p_competition_id and sr.status = 'qualified' and sr.risk_status in ('clear', 'cleared')
     and public.business_profile_complete(qb.id);
$$;

create or replace function public.shop_competition_ranking(p_competition_id uuid)
returns table (pos int, owner_id uuid, business_id uuid, business_name text, referrals int, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select (row_number() over (order by g.cnt desc, g.last_at asc, bz.created_at asc))::int,
         g.referrer_id, bz.id, bz.name, g.cnt, g.last_at
    from (
      select cr.referrer_id, count(*)::int as cnt, max(cr.qualified_at) as last_at
        from public.shop_countable_referrals(p_competition_id) cr
       group by cr.referrer_id
    ) g
    cross join lateral (
      select z.id, z.name, z.created_at from public.businesses z
       where z.owner_id = g.referrer_id and z.status in ('approved', 'inactive')
       order by z.created_at limit 1
    ) bz;
$$;

-- ============ 6. RISK DETECTION ============
-- Adds up weak signals. Score >= 50 = "suspicious" (held, admin decides). Nobody is rejected automatically.
--   device_same_as_referrer 40 | device_shared_between_referred 35 | device_many_accounts 30 | device_fp_shared 20 | network_shared 15
--   accounts_created_close 25 | unusual_volume 20 (35 if very high) | sequential_phone 30
--   identical_name_pincode 50 | identical_email 40 | identical_address 35 | identical_description 30 | identical_location 25
-- No weak signal (network 15, browser pattern 20) can reach 50 alone.
create or replace function public.evaluate_shop_referral_risk(p_referral_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_referrals; b public.businesses; o public.profiles;
  sig jsonb := '[]'::jsonb; score int := 0; n int; v_key text; v_new text;
begin
  select * into r from public.shop_referrals where id = p_referral_id for update;
  if not found or r.status <> 'qualified' then return; end if;
  if r.risk_status not in ('clear', 'suspicious') then return; end if;      -- an admin decision is never overwritten by the system
  if r.competition_id is not null and exists (select 1 from public.shop_competitions c where c.id = r.competition_id and c.status = 'ended') then
    return;                                                                  -- a closed competition is frozen
  end if;
  select * into b from public.businesses where id = r.qualified_business_id;
  if not found then return; end if;
  select * into o from public.profiles where id = r.referred_owner_id;
  if not found then return; end if;

  -- same browser (random id kept on the device) used by the referrer and the referred owner
  select count(*) into n from public.shop_device_log a
    join public.shop_device_log c on c.device_id = a.device_id and c.user_id = r.referrer_id
   where a.user_id = r.referred_owner_id and a.device_id <> '';
  if n > 0 then sig := sig || jsonb_build_object('code', 'device_same_as_referrer', 'weight', 40, 'count', n); score := score + 40; end if;

  -- same browser used by several owners referred by the same referrer
  select count(distinct c.user_id) into n from public.shop_device_log a
    join public.shop_device_log c on c.device_id = a.device_id and c.user_id <> a.user_id
    join public.shop_referrals x on x.referred_owner_id = c.user_id and x.referrer_id = r.referrer_id
   where a.user_id = r.referred_owner_id and a.device_id <> '';
  if n > 0 then sig := sig || jsonb_build_object('code', 'device_shared_between_referred', 'weight', 35, 'count', n); score := score + 35; end if;

  -- the same browser behind many different accounts
  select count(distinct c.user_id) into n from public.shop_device_log a
    join public.shop_device_log c on c.device_id = a.device_id and c.user_id <> a.user_id
   where a.user_id = r.referred_owner_id and a.device_id <> '';
  if n >= 2 then sig := sig || jsonb_build_object('code', 'device_many_accounts', 'weight', 30, 'count', n + 1); score := score + 30; end if;

  -- same browser pattern (hash of browser attributes) as the referrer / other referred owners (common phone models can collide: weak)
  select count(*) into n from public.shop_device_log a
    join public.shop_device_log c on c.device_fp = a.device_fp and c.user_id <> a.user_id
   where a.user_id = r.referred_owner_id and a.device_fp <> ''
     and (c.user_id = r.referrer_id or exists (select 1 from public.shop_referrals x where x.referrer_id = r.referrer_id and x.referred_owner_id = c.user_id));
  if n > 0 then sig := sig || jsonb_build_object('code', 'device_fp_shared', 'weight', 20, 'count', n); score := score + 20; end if;

  -- same network (weak on purpose: family / shop Wi-Fi and mobile data are shared by many honest people)
  select count(*) into n from public.shop_device_log a
    join public.shop_device_log c on c.ip_hash = a.ip_hash and c.user_id <> a.user_id
   where a.user_id = r.referred_owner_id and a.ip_hash <> ''
     and (c.user_id = r.referrer_id or exists (select 1 from public.shop_referrals x where x.referrer_id = r.referrer_id and x.referred_owner_id = c.user_id));
  if n > 0 then sig := sig || jsonb_build_object('code', 'network_shared', 'weight', 15, 'count', n); score := score + 15; end if;

  -- several accounts of the same referrer created within 30 minutes of each other
  select count(*) into n from public.shop_referrals x join public.profiles xp on xp.id = x.referred_owner_id
   where x.referrer_id = r.referrer_id and x.id <> r.id and abs(extract(epoch from (xp.created_at - o.created_at))) <= 1800;
  if n >= 2 then sig := sig || jsonb_build_object('code', 'accounts_created_close', 'weight', 25, 'count', n + 1); score := score + 25; end if;

  -- unusual referral activity from one account
  select count(*) into n from public.shop_referrals x
   where x.referrer_id = r.referrer_id and x.created_at between r.created_at - interval '24 hours' and r.created_at;
  if n >= 12 then sig := sig || jsonb_build_object('code', 'unusual_volume', 'weight', 35, 'count', n); score := score + 35;
  elsif n >= 6 then sig := sig || jsonb_build_object('code', 'unusual_volume', 'weight', 20, 'count', n); score := score + 20; end if;

  -- made-up looking phone number
  v_key := coalesce(r.qualified_phone_key, public.phone_key(b.phone));
  if v_key is not null and (v_key ~ '^(\d)\1{7,}$' or v_key in ('1234567890', '0123456789', '9876543210', '0987654321')) then
    sig := sig || jsonb_build_object('code', 'sequential_phone', 'weight', 30); score := score + 30;
  end if;

  -- identical business information shared with a business of ANOTHER owner
  v_new := public.norm_text(b.name);
  if v_new is not null and b.pincode is not null then
    select count(*) into n from public.businesses z
     where z.owner_id <> b.owner_id and z.status in ('pending_review', 'approved', 'inactive', 'suspended')
       and public.norm_text(z.name) = v_new and z.pincode = b.pincode;
    if n > 0 then sig := sig || jsonb_build_object('code', 'identical_name_pincode', 'weight', 50, 'count', n); score := score + 50; end if;
  end if;
  if b.email is not null then
    select count(*) into n from public.businesses z
     where z.owner_id <> b.owner_id and z.status in ('pending_review', 'approved', 'inactive', 'suspended') and lower(z.email) = lower(b.email);
    if n > 0 then sig := sig || jsonb_build_object('code', 'identical_email', 'weight', 40, 'count', n); score := score + 40; end if;
  end if;
  v_new := public.norm_text(b.address_line);
  if v_new is not null and char_length(v_new) >= 8 and b.pincode is not null then
    select count(*) into n from public.businesses z
     where z.owner_id <> b.owner_id and z.status in ('pending_review', 'approved', 'inactive', 'suspended')
       and public.norm_text(z.address_line) = v_new and z.pincode = b.pincode;
    if n > 0 then sig := sig || jsonb_build_object('code', 'identical_address', 'weight', 35, 'count', n); score := score + 35; end if;
  end if;
  v_new := public.norm_text(b.description);
  if v_new is not null and char_length(v_new) >= 40 then
    select count(*) into n from public.businesses z
     where z.owner_id <> b.owner_id and z.status in ('pending_review', 'approved', 'inactive', 'suspended')
       and md5(coalesce(public.norm_text(z.description), '')) = md5(v_new);
    if n > 0 then sig := sig || jsonb_build_object('code', 'identical_description', 'weight', 30, 'count', n); score := score + 30; end if;
  end if;
  if b.latitude is not null and b.longitude is not null then
    select count(*) into n from public.businesses z
     where z.owner_id <> b.owner_id and z.status in ('pending_review', 'approved', 'inactive', 'suspended')
       and round(z.latitude::numeric, 4) = round(b.latitude::numeric, 4) and round(z.longitude::numeric, 4) = round(b.longitude::numeric, 4);
    if n > 0 then sig := sig || jsonb_build_object('code', 'identical_location', 'weight', 25, 'count', n); score := score + 25; end if;
  end if;

  update public.shop_referrals
     set risk_score = score, risk_signals = sig, risk_evaluated_at = now(),
         risk_status = case when r.risk_status = 'clear' and score >= 50 then 'suspicious' else r.risk_status end
   where id = r.id;
  if r.risk_status = 'clear' and score >= 50 then
    perform public.log_shop_referral_event(r.id, 'risk_flagged', 'clear', 'suspicious', 'qualified', 'qualified', null,
      'risk score ' || score, jsonb_build_object('score', score, 'signals', sig));
  end if;
end $$;

-- new activity can make EARLIER referrals of the same referrer look suspicious (e.g. a burst of accounts): re-check them all
create or replace function public.reevaluate_referrer_shop_referrals(p_referrer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare x record;
begin
  for x in select id from public.shop_referrals
            where referrer_id = p_referrer and status = 'qualified' and risk_status in ('clear', 'suspicious') order by created_at loop
    perform public.evaluate_shop_referral_risk(x.id);
  end loop;
end $$;

-- ============ 7. DEVICE LOG + CLAIM (replaces the 0030 claim function) ============
create or replace function public.record_shop_device(p_device_id text, p_device_fp text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id text := lower(trim(coalesce(p_device_id, ''))); v_fp text := lower(trim(coalesce(p_device_fp, '')));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_owner() then return; end if;
  if v_id !~ '^[a-f0-9]{16,64}$' then return; end if;
  if v_fp !~ '^[a-f0-9]{16,64}$' then v_fp := ''; end if;
  insert into public.shop_device_log (user_id, device_id, device_fp, ip_hash)
  values (auth.uid(), v_id, v_fp, coalesce(public.shop_request_ip_hash(), ''))
  on conflict (user_id, device_id, ip_hash) do update
    set last_seen = now(), device_fp = case when excluded.device_fp <> '' then excluded.device_fp else public.shop_device_log.device_fp end;
end $$;

drop function if exists public.claim_shop_referral(text);
create or replace function public.claim_shop_referral(p_code text, p_device_id text default null, p_device_fp text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; v_ref uuid; v_code text := upper(trim(coalesce(p_code, ''))); v_out text; v_ok boolean := false;
  v_dev text := lower(trim(coalesce(p_device_id, '')));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or me.role <> 'owner' or me.is_suspended then return false; end if;
  perform public.record_shop_device(p_device_id, p_device_fp);
  select user_id into v_ref from public.shop_referral_codes where code = v_code;

  if me.created_at < now() - interval '7 days' then v_out := 'account_too_old';
  elsif exists (select 1 from public.shop_referrals where referred_owner_id = me.id) then v_out := 'already_attributed';   -- the FIRST attribution is the only one kept
  elsif exists (select 1 from public.businesses where owner_id = me.id and status in ('approved', 'inactive', 'suspended')) then v_out := 'already_has_business';
  elsif v_ref is null then v_out := 'invalid_code';
  elsif v_ref = me.id then v_out := 'self_referral';
  else
    begin
      insert into public.shop_referrals (referrer_id, referred_owner_id, code) values (v_ref, me.id, v_code);
      v_out := 'accepted'; v_ok := true;
    exception when unique_violation then
      v_out := 'already_attributed';
    end;
  end if;

  insert into public.shop_referral_claim_log (owner_id, referrer_id, code, outcome, device_id, ip_hash)
  values (me.id, v_ref, left(v_code, 20), v_out, case when v_dev ~ '^[a-f0-9]{16,64}$' then v_dev else null end, public.shop_request_ip_hash());
  return v_ok;
end $$;

-- ============ 8. QUALIFICATION (replaces the 0030 function: stricter validation + risk check + audit) ============
create or replace function public.try_qualify_shop_referral(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_referrals; op public.profiles; rp public.profiles; b public.businesses; c public.shop_competitions;
  v_key text; v_reason text;
begin
  select * into r from public.shop_referrals where referred_owner_id = p_owner and status = 'pending' for update;
  if not found then return; end if;
  select * into op from public.profiles where id = p_owner;
  if not found or op.is_suspended or op.role <> 'owner' then return; end if;

  -- a business of the referred owner that is approved by admin + phone verified + profile complete (an incomplete / rejected one just keeps waiting)
  select x.* into b from public.businesses x
   where x.owner_id = p_owner and x.status = 'approved' and x.phone_verified_at is not null
     and public.business_profile_complete(x.id)
   order by x.reviewed_at nulls last, x.created_at limit 1;
  if not found then return; end if;

  select * into rp from public.profiles where id = r.referrer_id;
  if not found or rp.is_suspended or rp.role <> 'owner'
     or not exists (select 1 from public.businesses z where z.owner_id = r.referrer_id and z.status in ('approved', 'inactive')) then
    v_reason := 'referrer_not_eligible';
  end if;

  v_key := public.phone_key(b.phone);
  if v_key is null then return; end if;

  if v_reason is null then
    if exists (select 1 from public.businesses z where z.owner_id = r.referrer_id and public.phone_key(z.phone) = v_key)
       or v_key = public.phone_key(rp.phone) then
      v_reason := 'same_phone_as_referrer';                                  -- the referrer's own number
    elsif exists (select 1 from public.businesses z where z.owner_id = r.referrer_id
                   and ((z.email is not null and b.email is not null and lower(z.email) = lower(b.email))
                        or (public.norm_text(z.name) is not null and public.norm_text(z.name) = public.norm_text(b.name)
                            and z.pincode is not null and z.pincode = b.pincode)))
       or (public.phone_key(op.phone) is not null
           and (public.phone_key(op.phone) = public.phone_key(rp.phone)
                or exists (select 1 from public.businesses z where z.owner_id = r.referrer_id and public.phone_key(z.phone) = public.phone_key(op.phone)))) then
      v_reason := 'self_referral';                                           -- the referrer's own shop under a second account
    elsif exists (select 1 from public.businesses z
                   where z.owner_id <> p_owner and public.phone_key(z.phone) = v_key and z.created_at < r.created_at
                     and z.status in ('pending_review', 'approved', 'inactive', 'suspended')) then
      v_reason := 'already_on_blisscco';                                     -- this number already belonged to a Blisscco business before the referral
    elsif exists (select 1 from public.shop_referrals x where x.qualified_phone_key = v_key and x.status in ('qualified', 'revoked')) then
      v_reason := 'duplicate_phone';                                         -- same business referred again: the first valid attribution stays
    end if;
  end if;

  if v_reason is not null then
    update public.shop_referrals set status = 'rejected', reject_reason = v_reason where id = r.id;
    perform public.log_shop_referral_event(r.id, 'auto_reject', r.risk_status, r.risk_status, 'pending', 'rejected', null, v_reason,
      jsonb_build_object('business_id', b.id));
    return;
  end if;

  select * into c from public.shop_competitions where status = 'active' and now() >= starts_at and now() < ends_at limit 1;

  begin
    update public.shop_referrals
       set status = 'qualified', qualified_business_id = b.id, qualified_phone_key = v_key, qualified_at = now(),
           competition_id = c.id, risk_status = 'clear', risk_score = 0, risk_signals = '[]'::jsonb
     where id = r.id;
  exception when unique_violation then
    update public.shop_referrals set status = 'rejected', reject_reason = 'duplicate_phone' where id = r.id;
    perform public.log_shop_referral_event(r.id, 'auto_reject', 'clear', 'clear', 'pending', 'rejected', null, 'duplicate_phone',
      jsonb_build_object('business_id', b.id));
    return;
  end;
  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
  values (null, 'shop_referral.qualify', 'shop_referral', r.id, jsonb_build_object('business_id', b.id, 'competition_id', c.id));
  perform public.log_shop_referral_event(r.id, 'qualify', 'clear', 'clear', 'pending', 'qualified', null, null,
    jsonb_build_object('business_id', b.id, 'competition_id', c.id));

  -- risk check of this referral and the other referrals of the same referrer
  perform public.reevaluate_referrer_shop_referrals(r.referrer_id);
end $$;

-- also records when an already counted referral's business is later rejected / suspended (it stops counting automatically)
create or replace function public.businesses_shop_referral_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare x record;
begin
  if new.status = 'approved' and new.phone_verified_at is not null then
    perform public.try_qualify_shop_referral(new.owner_id);
  end if;
  if tg_op = 'UPDATE' then
    if old.status in ('approved', 'inactive') and new.status in ('rejected', 'suspended') then
      for x in select id, risk_status from public.shop_referrals
                where referred_owner_id = new.owner_id and status = 'qualified' and qualified_business_id = new.id loop
        perform public.log_shop_referral_event(x.id, 'business_no_longer_valid', x.risk_status, x.risk_status, 'qualified', 'qualified', auth.uid(),
          new.status, jsonb_build_object('business_id', new.id));
      end loop;
    end if;
  end if;
  return new;
end $$;

-- ============ 9. FINALISING A COMPETITION (replaces 0030: NO automatic reward any more) ============
-- Picks a PROVISIONAL winner and moves the competition to 'pending_verification'. The credit is added only by admin_award_competition_reward().
create or replace function public.finalize_shop_competition(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.shop_competitions; w record; x record;
begin
  select * into c from public.shop_competitions where id = p_id for update;
  if not found or c.status not in ('active', 'paused') then return; end if;
  for x in select id from public.shop_referrals where competition_id = p_id and status = 'qualified' and risk_status in ('clear', 'suspicious') loop
    perform public.evaluate_shop_referral_risk(x.id);
  end loop;
  select * into w from public.shop_competition_ranking(p_id) where pos = 1;
  if found then
    update public.shop_competitions
       set status = 'pending_verification', ended_at = now(), winner_owner_id = w.owner_id, winner_business_id = w.business_id,
           winner_business_name = w.business_name, winner_referral_count = w.referrals
     where id = p_id;
    perform public.write_audit_log('shop_competition.end', 'shop_competition', p_id,
      jsonb_build_object('provisional_winner_owner_id', w.owner_id, 'referrals', w.referrals, 'next', 'pending_verification'));
  else
    update public.shop_competitions set status = 'ended', ended_at = now() where id = p_id;       -- nobody qualified: no winner, no credit
    perform public.write_audit_log('shop_competition.end', 'shop_competition', p_id, jsonb_build_object('winner', null));
  end if;
end $$;

-- ============ 10. OWNER FUNCTIONS (changed) ============
create or replace function public.get_shop_competition_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare c public.shop_competitions; me record; v_total int; v_can boolean; v_paid boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not (public.is_owner() or public.is_admin()) then raise exception 'not_available' using errcode = '42501'; end if;
  select * into c from public.shop_competitions where status in ('active', 'paused') limit 1;
  if not found then
    select * into c from public.shop_competitions where status in ('pending_verification', 'ended') order by ended_at desc nulls last limit 1;
  end if;
  if not found then return null; end if;
  v_paid := c.reward_credited_at is not null;
  select pos, referrals into me from public.shop_competition_ranking(c.id) where owner_id = auth.uid();
  select count(*)::int into v_total from public.shop_competition_ranking(c.id);
  v_can := exists (select 1 from public.businesses where owner_id = auth.uid() and status in ('approved', 'inactive'));
  return jsonb_build_object(
    'id', c.id, 'title', c.title, 'description', c.description, 'status', c.status,
    'starts_at', c.starts_at, 'ends_at', c.ends_at, 'reward_amount_inr', c.reward_amount_inr,
    'server_now', now(), 'my_rank', me.pos, 'my_count', coalesce(me.referrals, 0), 'participants', v_total,
    'can_participate', v_can,
    'verification_pending', c.status = 'pending_verification',
    'winner_business_name', case when v_paid then c.winner_business_name end,       -- the winner is public only after final verification + credit
    'winner_referral_count', case when v_paid then c.winner_referral_count end,
    'i_won', (v_paid and c.winner_owner_id is not null and c.winner_owner_id = auth.uid()));
end $$;

drop function if exists public.my_shop_referrals();
create or replace function public.my_shop_referrals()
returns table (id uuid, status text, created_at timestamptz, business_name text, profile_complete boolean, phone_verified boolean,
               approved boolean, counted boolean, under_review boolean, reject_reason text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return query
  select sr.id, sr.status, sr.created_at, bz.name,
         coalesce(public.business_profile_complete(bz.id), false),
         (bz.phone_verified_at is not null),
         coalesce(bz.status = 'approved', false),
         (sr.status = 'qualified' and sr.competition_id is not null and sr.risk_status in ('clear', 'cleared') and coalesce(bz.status in ('approved', 'inactive'), false)),
         (sr.status = 'qualified' and sr.risk_status in ('suspicious', 'in_review')),      -- owners only see "under review", never the signals
         sr.reject_reason
    from public.shop_referrals sr
    left join lateral (
      select z.* from public.businesses z where z.owner_id = sr.referred_owner_id
       order by (z.status = 'approved') desc, z.created_at limit 1
    ) bz on true
   where sr.referrer_id = auth.uid()
   order by sr.created_at desc
   limit 100;
end $$;

-- ============ 11. ADMIN: FRAUD REVIEW ============
drop function if exists public.admin_shop_referral_overview(int);
create or replace function public.admin_shop_referral_overview(p_limit int default 100, p_filter text default 'all')
returns table (id uuid, status text, created_at timestamptz, qualified_at timestamptz, competition_id uuid,
               referrer_business text, referred_owner_name text, business_id uuid, business_name text, business_phone text,
               profile_complete boolean, phone_verified boolean, approved boolean, reject_reason text, revoked_reason text,
               risk_status text, risk_score int, risk_signals jsonb, risk_decided_at timestamptz, risk_decision_note text,
               risk_decided_by_name text, referrer_fraud_count int, winner_verified boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select sr.id, sr.status, sr.created_at, sr.qualified_at, sr.competition_id,
         (select z.name from public.businesses z where z.owner_id = sr.referrer_id and z.status in ('approved', 'inactive') order by z.created_at limit 1),
         p.full_name, bz.id, bz.name, bz.phone,
         coalesce(public.business_profile_complete(bz.id), false), (bz.phone_verified_at is not null),
         coalesce(bz.status = 'approved', false), sr.reject_reason, sr.revoked_reason,
         sr.risk_status, sr.risk_score, sr.risk_signals, sr.risk_decided_at, sr.risk_decision_note, dp.full_name,
         (select count(*)::int from public.shop_referrals f where f.referrer_id = sr.referrer_id and f.risk_status = 'fraudulent'),
         (sr.winner_verified_at is not null)
    from public.shop_referrals sr
    join public.profiles p on p.id = sr.referred_owner_id
    left join public.profiles dp on dp.id = sr.risk_decided_by
    left join lateral (
      select z.* from public.businesses z where z.owner_id = sr.referred_owner_id
       order by (z.status = 'approved') desc, z.created_at limit 1
    ) bz on true
   where case coalesce(p_filter, 'all')
           when 'needs_review' then sr.risk_status in ('suspicious', 'in_review') and sr.status = 'qualified'
           when 'decided' then sr.risk_status in ('cleared', 'rejected', 'fraudulent')
           else true end
   order by case when p_filter = 'needs_review' then sr.risk_score end desc nulls last, sr.created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_shop_referral_history(p_referral_id uuid)
returns table (id uuid, action text, from_risk text, to_risk text, from_status text, to_status text, note text,
               actor_name text, created_at timestamptz, details jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select v.id, v.action, v.from_risk, v.to_risk, v.from_status, v.to_status, v.note, p.full_name, v.created_at, v.details
    from public.shop_referral_reviews v
    left join public.profiles p on p.id = v.actor_id
   where v.referral_id = p_referral_id
   order by v.created_at desc, v.id
   limit 100;
end $$;

-- p_action: start_review | approve | reject | fraud | reopen
create or replace function public.admin_review_shop_referral(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_referrals; v_cid uuid; c public.shop_competitions;
  v_note text := left(trim(coalesce(p_note, '')), 300); v_to_risk text; v_to_status text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_action not in ('start_review', 'approve', 'reject', 'fraud', 'reopen') then raise exception 'invalid_action'; end if;
  if p_action <> 'start_review' and char_length(v_note) < 3 then raise exception 'reason_required'; end if;

  -- lock order: competition first, then referral (same as the award function)
  select competition_id into v_cid from public.shop_referrals where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_cid is not null then
    select * into c from public.shop_competitions where id = v_cid for update;
    if found and c.status = 'ended' then raise exception 'competition_closed'; end if;
  end if;
  select * into r from public.shop_referrals where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_to_status := r.status;

  if p_action = 'start_review' then
    if r.status <> 'qualified' or r.risk_status <> 'suspicious' then raise exception 'invalid_state'; end if;
    v_to_risk := 'in_review';
  elsif p_action = 'approve' then
    if r.status <> 'qualified' or r.risk_status not in ('suspicious', 'in_review') then raise exception 'invalid_state'; end if;
    v_to_risk := 'cleared';
  elsif p_action in ('reject', 'fraud') then
    if r.status <> 'qualified' or r.risk_status not in ('clear', 'suspicious', 'in_review', 'cleared') then raise exception 'invalid_state'; end if;
    v_to_risk := case when p_action = 'fraud' then 'fraudulent' else 'rejected' end;
    v_to_status := 'revoked';                                -- a revoked referral still burns the phone number
  else  -- reopen
    if r.status <> 'revoked' or r.risk_status not in ('rejected', 'fraudulent') then raise exception 'invalid_state'; end if;
    v_to_risk := 'in_review';
    v_to_status := 'qualified';
  end if;

  update public.shop_referrals
     set risk_status = v_to_risk, status = v_to_status,
         risk_decided_by = auth.uid(), risk_decided_at = now(), risk_decision_note = nullif(v_note, ''),
         revoked_reason = case when v_to_status = 'revoked' then v_note when v_to_status = 'qualified' then null else revoked_reason end,
         winner_verified_at = null, winner_verified_by = null            -- any change cancels an earlier winner verification
   where id = r.id;
  perform public.log_shop_referral_event(r.id, p_action, r.risk_status, v_to_risk, r.status, v_to_status, auth.uid(), v_note, '{}'::jsonb);
  perform public.write_audit_log('shop_referral.' || p_action, 'shop_referral', r.id,
    jsonb_build_object('from_risk', r.risk_status, 'to_risk', v_to_risk, 'note', v_note));
end $$;

-- the old "Remove referral" button now goes through the same audited path (it is a rejection)
create or replace function public.admin_revoke_shop_referral(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_review_shop_referral(p_id, 'reject', p_reason);
end $$;

-- admin asks for a fresh risk check (e.g. after the referrer's device was recorded later)
create or replace function public.admin_recheck_shop_referral_risk(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  perform public.evaluate_shop_referral_risk(p_id);
  perform public.write_audit_log('shop_referral.recheck', 'shop_referral', p_id, '{}');
end $$;

-- ============ 12. ADMIN: WINNER PROTECTION ============
-- Fresh provisional winner + fresh risk check (call this when the verification screen opens). Never touches the reward.
create or replace function public.admin_refresh_competition_winner(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.shop_competitions; w record; x record;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.shop_competitions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status <> 'pending_verification' then return; end if;
  for x in select id from public.shop_referrals where competition_id = p_id and status = 'qualified' and risk_status in ('clear', 'suspicious') loop
    perform public.evaluate_shop_referral_risk(x.id);
  end loop;
  select * into w from public.shop_competition_ranking(p_id) where pos = 1;
  if found then
    if c.winner_owner_id is distinct from w.owner_id then
      update public.shop_referrals set winner_verified_at = null, winner_verified_by = null where competition_id = p_id;
    end if;
    update public.shop_competitions
       set winner_owner_id = w.owner_id, winner_business_id = w.business_id, winner_business_name = w.business_name, winner_referral_count = w.referrals
     where id = p_id;
  else
    update public.shop_competitions set winner_owner_id = null, winner_business_id = null, winner_business_name = null, winner_referral_count = null where id = p_id;
  end if;
end $$;

-- Everything the verification screen shows. All numbers are computed here, none come from the browser.
create or replace function public.admin_competition_winner_check(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.shop_competitions; w record; v_has boolean; v_refs jsonb; v_unres int; v_unver int := 0; v_ok boolean := false;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.shop_competitions where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into w from public.shop_competition_ranking(p_id) where pos = 1;
  v_has := found;
  select count(*)::int into v_unres from public.shop_referrals
   where competition_id = p_id and status = 'qualified' and risk_status in ('suspicious', 'in_review');
  if v_has then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', sr.id, 'business_name', qb.name, 'phone', qb.phone, 'qualified_at', sr.qualified_at,
             'verified', sr.winner_verified_at is not null, 'risk_status', sr.risk_status, 'risk_score', sr.risk_score) order by sr.qualified_at), '[]'::jsonb),
           count(*) filter (where sr.winner_verified_at is null)::int
      into v_refs, v_unver
      from public.shop_countable_referrals(p_id) cr
      join public.shop_referrals sr on sr.id = cr.referral_id
      join public.businesses qb on qb.id = cr.business_id
     where cr.referrer_id = w.owner_id;
    v_ok := c.status = 'pending_verification' and c.reward_credited_at is null and v_unres = 0 and v_unver = 0
            and c.winner_owner_id is not distinct from w.owner_id
            and exists (select 1 from public.profiles pp where pp.id = w.owner_id and not pp.is_suspended);
  end if;
  return jsonb_build_object(
    'status', c.status, 'reward_amount_inr', c.reward_amount_inr, 'already_awarded', c.reward_credited_at is not null,
    'has_winner', v_has, 'winner_business_name', case when v_has then w.business_name end,
    'winner_referrals', case when v_has then w.referrals end,
    'winner_matches_provisional', v_has and c.winner_owner_id is not distinct from w.owner_id,
    'referrals', coalesce(v_refs, '[]'::jsonb), 'unverified', v_unver, 'unresolved_risk', v_unres, 'can_award', v_ok);
end $$;

-- Admin ticks one qualifying referral of the winner as verified (or removes the tick)
create or replace function public.admin_verify_winner_referral(p_referral_id uuid, p_verified boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.shop_referrals; c public.shop_competitions; v_cid uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select competition_id into v_cid from public.shop_referrals where id = p_referral_id;
  if not found or v_cid is null then raise exception 'not_countable'; end if;
  select * into c from public.shop_competitions where id = v_cid for update;
  if not found or c.status <> 'pending_verification' then raise exception 'invalid_state'; end if;
  select * into r from public.shop_referrals where id = p_referral_id for update;
  if not exists (select 1 from public.shop_countable_referrals(c.id) x where x.referral_id = r.id) then raise exception 'not_countable'; end if;
  update public.shop_referrals
     set winner_verified_at = case when p_verified then now() else null end,
         winner_verified_by = case when p_verified then auth.uid() else null end
   where id = r.id;
  perform public.log_shop_referral_event(r.id, case when p_verified then 'winner_verify' else 'winner_unverify' end,
    r.risk_status, r.risk_status, r.status, r.status, auth.uid(), null, jsonb_build_object('competition_id', c.id));
  perform public.write_audit_log(case when p_verified then 'shop_referral.winner_verify' else 'shop_referral.winner_unverify' end,
    'shop_referral', r.id, jsonb_build_object('competition_id', c.id));
end $$;

-- THE ONLY WAY the competition reward is paid. Returns {awarded, reason}. Blocking reasons are returned (not raised) so that the
-- fresh risk check stays saved. Hard errors (not admin, already awarded, wrong state) are raised.
create or replace function public.admin_award_competition_reward(p_competition_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.shop_competitions; w record; x record; v_unres int; v_unver int; v_ledger uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.shop_competitions where id = p_competition_id for update;     -- serialises two admins pressing the button together
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.reward_credited_at is not null or c.status = 'ended' then raise exception 'already_awarded'; end if;
  if c.status <> 'pending_verification' then raise exception 'invalid_state'; end if;

  for x in select id from public.shop_referrals where competition_id = c.id and status = 'qualified' and risk_status in ('clear', 'suspicious') loop
    perform public.evaluate_shop_referral_risk(x.id);
  end loop;

  select * into w from public.shop_competition_ranking(c.id) where pos = 1;     -- winner and count recomputed on the server, right now
  if not found then return jsonb_build_object('awarded', false, 'reason', 'no_winner'); end if;

  select count(*)::int into v_unres from public.shop_referrals
   where competition_id = c.id and status = 'qualified' and risk_status in ('suspicious', 'in_review');
  if v_unres > 0 then return jsonb_build_object('awarded', false, 'reason', 'unresolved_risk', 'count', v_unres); end if;

  if c.winner_owner_id is distinct from w.owner_id then      -- the ranking changed since the admin looked: they must verify the new winner
    update public.shop_referrals set winner_verified_at = null, winner_verified_by = null where competition_id = c.id;
    update public.shop_competitions
       set winner_owner_id = w.owner_id, winner_business_id = w.business_id, winner_business_name = w.business_name, winner_referral_count = w.referrals
     where id = c.id;
    return jsonb_build_object('awarded', false, 'reason', 'winner_changed');
  end if;

  select count(*)::int into v_unver
    from public.shop_countable_referrals(c.id) cr join public.shop_referrals sr on sr.id = cr.referral_id
   where cr.referrer_id = w.owner_id and sr.winner_verified_at is null;
  if v_unver > 0 then return jsonb_build_object('awarded', false, 'reason', 'verification_incomplete', 'count', v_unver); end if;

  if not exists (select 1 from public.profiles pp where pp.id = w.owner_id and not pp.is_suspended and pp.role = 'owner') then
    return jsonb_build_object('awarded', false, 'reason', 'winner_not_eligible');
  end if;

  begin
    insert into public.growth_credit_ledger (owner_id, delta_inr, reason, competition_id, note)
    values (w.owner_id, c.reward_amount_inr, 'competition_reward', c.id, left(c.title, 100))
    returning id into v_ledger;
  exception when unique_violation then
    raise exception 'already_awarded';                       -- the unique index on (competition_id) is the last line of defence
  end;

  update public.shop_competitions
     set status = 'ended', reward_credited_at = now(), reward_credited_by = auth.uid(), reward_ledger_id = v_ledger,
         winner_business_id = w.business_id, winner_business_name = w.business_name, winner_referral_count = w.referrals,
         verification_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where id = c.id;
  perform public.write_audit_log('shop_competition.reward', 'shop_competition', c.id,
    jsonb_build_object('winner_owner_id', w.owner_id, 'referrals', w.referrals, 'reward_inr', c.reward_amount_inr, 'ledger_id', v_ledger));
  return jsonb_build_object('awarded', true, 'amount', c.reward_amount_inr);
end $$;

-- when every referral of the leader was rejected: close the competition with no winner and no credit
create or replace function public.admin_close_competition_without_winner(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.shop_competitions;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.shop_competitions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status <> 'pending_verification' or c.reward_credited_at is not null then raise exception 'invalid_state'; end if;
  if exists (select 1 from public.shop_competition_ranking(p_id) where pos = 1) then raise exception 'winner_exists'; end if;
  if exists (select 1 from public.shop_referrals where competition_id = p_id and status = 'qualified' and risk_status in ('suspicious', 'in_review')) then
    raise exception 'unresolved_risk';
  end if;
  update public.shop_competitions
     set status = 'ended', winner_owner_id = null, winner_business_id = null, winner_business_name = null, winner_referral_count = null,
         verification_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where id = p_id;
  perform public.write_audit_log('shop_competition.close_no_winner', 'shop_competition', p_id, '{}');
end $$;

-- ============ 13. FUNCTION PRIVILEGES ============
revoke execute on function
  public.forbid_row_change(), public.growth_ledger_reward_guard(), public.shop_competitions_lock_guard(),
  public.norm_text(text), public.shop_hash(text), public.shop_request_ip_hash(),
  public.log_shop_referral_event(uuid, text, text, text, text, text, uuid, text, jsonb),
  public.shop_countable_referrals(uuid), public.shop_competition_ranking(uuid),
  public.evaluate_shop_referral_risk(uuid), public.reevaluate_referrer_shop_referrals(uuid),
  public.try_qualify_shop_referral(uuid), public.businesses_shop_referral_check(), public.finalize_shop_competition(uuid),
  public.record_shop_device(text, text), public.claim_shop_referral(text, text, text),
  public.get_shop_competition_overview(), public.my_shop_referrals(),
  public.admin_shop_referral_overview(int, text), public.admin_shop_referral_history(uuid),
  public.admin_review_shop_referral(uuid, text, text), public.admin_revoke_shop_referral(uuid, text),
  public.admin_recheck_shop_referral_risk(uuid), public.admin_refresh_competition_winner(uuid),
  public.admin_competition_winner_check(uuid), public.admin_verify_winner_referral(uuid, boolean),
  public.admin_award_competition_reward(uuid, text), public.admin_close_competition_without_winner(uuid, text)
  from public, anon, authenticated;

grant execute on function
  public.record_shop_device(text, text), public.claim_shop_referral(text, text, text),
  public.get_shop_competition_overview(), public.my_shop_referrals(),
  public.admin_shop_referral_overview(int, text), public.admin_shop_referral_history(uuid),
  public.admin_review_shop_referral(uuid, text, text), public.admin_revoke_shop_referral(uuid, text),
  public.admin_recheck_shop_referral_risk(uuid), public.admin_refresh_competition_winner(uuid),
  public.admin_competition_winner_check(uuid), public.admin_verify_winner_referral(uuid, boolean),
  public.admin_award_competition_reward(uuid, text), public.admin_close_competition_without_winner(uuid, text)
  to authenticated;
