-- 0030: Refer-a-Shop Competition (admin-controlled) + Business Growth Credit wallet.
-- Run after 0029. Safe to re-run. Nothing existing is changed except 2 new columns on businesses and 2 new triggers.
--
-- A referral COUNTS only when ALL four are true:
--   1. the referred business owner signed up through the referrer's own shop-referral link / code
--   2. the referred business profile is complete
--   3. the referred business phone number is verified   (businesses.phone_verified_at, set by admin - see admin_set_business_phone_verified)
--   4. the referred business is approved by Blisscco admin
-- Referrals are counted for the competition that is ACTIVE (and inside its dates) at the moment the 4th condition is met.
-- Reward = promotional "Business Growth Credit" (never cash, not withdrawable), stored in growth_credit_ledger.

-- ============ 1. PHONE VERIFICATION ON A BUSINESS ============
alter table public.businesses add column if not exists phone_verified_at timestamptz;
alter table public.businesses add column if not exists phone_verified_by uuid references public.profiles(id) on delete set null;
-- (owners have column-level UPDATE grants only on the application columns, so they can never set these two)

-- changing the phone number removes the verification
create or replace function public.businesses_reset_phone_verification()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.phone is distinct from old.phone then
    new.phone_verified_at := null;
    new.phone_verified_by := null;
  end if;
  return new;
end $$;
drop trigger if exists businesses_reset_phone_verification on public.businesses;
create trigger businesses_reset_phone_verification before update of phone on public.businesses
  for each row execute function public.businesses_reset_phone_verification();

-- last 10 digits of a phone number (so +91 98765 43210 = 9876543210)
create or replace function public.phone_key(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 10), '');
$$;

-- same completeness rules as submit_business_application (0004), without the terms / e-mail steps
create or replace function public.business_profile_complete(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.businesses b
     where b.id = p_business_id
       and b.category_id is not null
       and exists (select 1 from public.business_categories c where c.id = b.category_id and c.is_active)
       and coalesce(trim(b.description), '') <> ''
       and b.phone is not null and b.email is not null
       and coalesce(trim(b.address_line), '') <> '' and coalesce(trim(b.city), '') <> '' and coalesce(trim(b.state), '') <> ''
       and b.latitude is not null and b.longitude is not null
       and (select count(*) from public.business_images i where i.business_id = b.id) >= 3
       and exists (select 1 from public.business_hours h where h.business_id = b.id and not h.is_closed)
       and exists (select 1 from public.services s where s.business_id = b.id and s.is_active)
  );
$$;

-- ============ 2. TABLES ============
create table if not exists public.shop_competitions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 100),
  description text check (char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reward_amount_inr numeric(10, 2) not null check (reward_amount_inr > 0 and reward_amount_inr <= 1000000),
  reward_type text not null default 'business_growth_credit' check (reward_type = 'business_growth_credit'),
  winner_owner_id uuid references public.profiles(id) on delete set null,
  winner_business_id uuid references public.businesses(id) on delete set null,
  winner_business_name text,
  winner_referral_count int,
  ended_at timestamptz,
  reward_credited_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_comp_dates check (ends_at > starts_at)
);
-- only ONE competition can be live (active or paused) at a time; any number of drafts / ended ones
create unique index if not exists shop_competitions_one_live on public.shop_competitions ((true)) where status in ('active', 'paused');
drop trigger if exists shop_competitions_updated_at on public.shop_competitions;
create trigger shop_competitions_updated_at before update on public.shop_competitions
  for each row execute function public.set_updated_at();

create table if not exists public.shop_referral_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id),
  referred_owner_id uuid not null unique references public.profiles(id) on delete cascade,   -- one attribution per owner, never changeable
  code text not null,
  status text not null default 'pending' check (status in ('pending', 'qualified', 'rejected', 'revoked')),
  qualified_business_id uuid references public.businesses(id) on delete set null,
  qualified_phone_key text,
  qualified_at timestamptz,
  competition_id uuid references public.shop_competitions(id) on delete set null,            -- the competition this referral counts for (null = none was running)
  reject_reason text,
  revoked_reason text,
  created_at timestamptz not null default now(),
  constraint shop_no_self_referral check (referred_owner_id <> referrer_id)
);
create index if not exists shop_referrals_referrer_idx on public.shop_referrals (referrer_id);
create index if not exists shop_referrals_comp_idx on public.shop_referrals (competition_id) where status = 'qualified';
-- one counted referral per phone number (a revoked one still burns the number)
create unique index if not exists shop_referrals_phone_once on public.shop_referrals (qualified_phone_key) where status in ('qualified', 'revoked');

-- Promotional wallet. Balance = sum(delta_inr). Not cash: there is no withdraw function and no cash-out column.
create table if not exists public.growth_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  delta_inr numeric(10, 2) not null check (delta_inr <> 0),
  reason text not null check (reason in ('competition_reward', 'promo_spend', 'admin_adjustment', 'reversal')),
  kind text not null default 'promotional' check (kind = 'promotional'),
  competition_id uuid references public.shop_competitions(id),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists growth_ledger_owner_idx on public.growth_credit_ledger (owner_id, created_at desc);
create unique index if not exists growth_reward_once on public.growth_credit_ledger (competition_id) where reason = 'competition_reward';

-- ============ 3. RLS (all writes go through the functions below) ============
alter table public.shop_competitions enable row level security;
alter table public.shop_referral_codes enable row level security;
alter table public.shop_referrals enable row level security;
alter table public.growth_credit_ledger enable row level security;

drop policy if exists shop_comp_select on public.shop_competitions;
create policy shop_comp_select on public.shop_competitions for select to authenticated
  using (public.is_admin() or (public.is_owner() and status <> 'draft'));
drop policy if exists shop_codes_select on public.shop_referral_codes;
create policy shop_codes_select on public.shop_referral_codes for select to authenticated using (user_id = auth.uid());
drop policy if exists shop_referrals_select on public.shop_referrals;
create policy shop_referrals_select on public.shop_referrals for select to authenticated using (public.is_admin());
drop policy if exists growth_ledger_select on public.growth_credit_ledger;
create policy growth_ledger_select on public.growth_credit_ledger for select to authenticated using (owner_id = auth.uid() or public.is_admin());

revoke all on public.shop_competitions, public.shop_referral_codes, public.shop_referrals, public.growth_credit_ledger from anon, authenticated;
grant select on public.shop_competitions, public.shop_referral_codes, public.shop_referrals, public.growth_credit_ledger to authenticated;

-- ============ 4. INTERNAL: ranking, qualification, finalising ============
-- Ranking of one competition. Highest count first; tie = whoever reached that count EARLIER wins; then older shop.
-- Only referrals whose business is STILL approved/hidden count (a suspended / rejected business drops off).
create or replace function public.shop_competition_ranking(p_competition_id uuid)
returns table (pos int, owner_id uuid, business_id uuid, business_name text, referrals int, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select (row_number() over (order by g.cnt desc, g.last_at asc, bz.created_at asc))::int,
         g.referrer_id, bz.id, bz.name, g.cnt, g.last_at
    from (
      select sr.referrer_id, count(*)::int as cnt, max(sr.qualified_at) as last_at
        from public.shop_referrals sr
        join public.businesses qb on qb.id = sr.qualified_business_id and qb.status in ('approved', 'inactive')
       where sr.competition_id = p_competition_id and sr.status = 'qualified'
       group by sr.referrer_id
    ) g
    cross join lateral (
      select z.id, z.name, z.created_at from public.businesses z
       where z.owner_id = g.referrer_id and z.status in ('approved', 'inactive')
       order by z.created_at limit 1
    ) bz;
$$;

-- Checks the 4 conditions for one referred owner; called by triggers whenever a business is approved / its phone is verified.
create or replace function public.try_qualify_shop_referral(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_referrals; op public.profiles; rp public.profiles; b public.businesses; c public.shop_competitions; v_key text;
begin
  select * into r from public.shop_referrals where referred_owner_id = p_owner and status = 'pending' for update;
  if not found then return; end if;
  select * into op from public.profiles where id = p_owner;
  if not found or op.is_suspended or op.role <> 'owner' then return; end if;

  -- a business of the referred owner that is approved + phone verified + complete
  select x.* into b from public.businesses x
   where x.owner_id = p_owner and x.status = 'approved' and x.phone_verified_at is not null
     and public.business_profile_complete(x.id)
   order by x.reviewed_at nulls last, x.created_at limit 1;
  if not found then return; end if;

  select * into rp from public.profiles where id = r.referrer_id;
  if not found or rp.is_suspended or rp.role <> 'owner'
     or not exists (select 1 from public.businesses z where z.owner_id = r.referrer_id and z.status in ('approved', 'inactive')) then
    update public.shop_referrals set status = 'rejected', reject_reason = 'referrer_not_eligible' where id = r.id;
    return;
  end if;

  v_key := public.phone_key(b.phone);
  if v_key is null then return; end if;
  if exists (select 1 from public.businesses z where z.owner_id = r.referrer_id and public.phone_key(z.phone) = v_key) then
    update public.shop_referrals set status = 'rejected', reject_reason = 'same_phone_as_referrer' where id = r.id;
    return;
  end if;
  if exists (select 1 from public.shop_referrals x where x.qualified_phone_key = v_key and x.status in ('qualified', 'revoked')) then
    update public.shop_referrals set status = 'rejected', reject_reason = 'duplicate_phone' where id = r.id;
    return;
  end if;

  select * into c from public.shop_competitions where status = 'active' and now() >= starts_at and now() < ends_at limit 1;

  begin
    update public.shop_referrals
       set status = 'qualified', qualified_business_id = b.id, qualified_phone_key = v_key, qualified_at = now(),
           competition_id = c.id                      -- null when no competition is running right now
     where id = r.id;
  exception when unique_violation then
    update public.shop_referrals set status = 'rejected', reject_reason = 'duplicate_phone' where id = r.id;
    return;
  end;
  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
  values (null, 'shop_referral.qualify', 'shop_referral', r.id, jsonb_build_object('business_id', b.id, 'competition_id', c.id));
end $$;

create or replace function public.businesses_shop_referral_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and new.phone_verified_at is not null then
    perform public.try_qualify_shop_referral(new.owner_id);
  end if;
  return new;
end $$;
drop trigger if exists businesses_shop_referral_check on public.businesses;
create trigger businesses_shop_referral_check after insert or update of status, phone_verified_at on public.businesses
  for each row execute function public.businesses_shop_referral_check();

-- Ends a competition: picks the winner, stores it, and credits the Business Growth Credit exactly once.
create or replace function public.finalize_shop_competition(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.shop_competitions; w record;
begin
  select * into c from public.shop_competitions where id = p_id for update;
  if not found or c.status not in ('active', 'paused') then return; end if;
  select * into w from public.shop_competition_ranking(p_id) where pos = 1;
  if found then
    update public.shop_competitions
       set status = 'ended', ended_at = now(), winner_owner_id = w.owner_id, winner_business_id = w.business_id,
           winner_business_name = w.business_name, winner_referral_count = w.referrals, reward_credited_at = now()
     where id = p_id;
    insert into public.growth_credit_ledger (owner_id, delta_inr, reason, competition_id, note)
    values (w.owner_id, c.reward_amount_inr, 'competition_reward', p_id, left(c.title, 100))
    on conflict do nothing;
    perform public.write_audit_log('shop_competition.end', 'shop_competition', p_id,
      jsonb_build_object('winner_owner_id', w.owner_id, 'referrals', w.referrals, 'reward_inr', c.reward_amount_inr));
  else
    update public.shop_competitions set status = 'ended', ended_at = now() where id = p_id;   -- nobody qualified: no winner, no credit
    perform public.write_audit_log('shop_competition.end', 'shop_competition', p_id, jsonb_build_object('winner', null));
  end if;
end $$;

-- cron: competitions whose end time has passed are finalised automatically
create or replace function public.finalize_due_shop_competitions() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.shop_competitions where status in ('active', 'paused') and ends_at <= now() loop
    perform public.finalize_shop_competition(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('blisscco-finalize-shop-competitions', '*/5 * * * *', 'select public.finalize_due_shop_competitions()');
exception when others then
  raise notice 'pg_cron schedule skipped (%): enable pg_cron in Dashboard > Database > Extensions, then re-run this file. (Admin can still press End by hand.)', sqlerrm;
end $$;

-- ============ 5. OWNER FUNCTIONS ============
create or replace function public.get_my_shop_referral_code() returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_owner() or not exists (select 1 from public.businesses where owner_id = auth.uid() and status in ('approved', 'inactive')) then
    raise exception 'not_available' using errcode = '42501';
  end if;
  loop
    v_code := public.make_code('S', 7);
    begin
      insert into public.shop_referral_codes (user_id, code) values (auth.uid(), v_code) on conflict (user_id) do nothing;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  select code into v_code from public.shop_referral_codes where user_id = auth.uid();
  return v_code;
end $$;

-- Called once by a NEW owner who arrived through a shop-referral link. Cannot be changed afterwards.
create or replace function public.claim_shop_referral(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v_ref uuid; v_code text := upper(trim(coalesce(p_code, '')));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or me.role <> 'owner' or me.is_suspended or me.created_at < now() - interval '7 days' then return false; end if;
  if exists (select 1 from public.shop_referrals where referred_owner_id = me.id) then return false; end if;
  if exists (select 1 from public.businesses where owner_id = me.id and status in ('approved', 'inactive', 'suspended')) then return false; end if;
  select user_id into v_ref from public.shop_referral_codes where code = v_code;
  if v_ref is null or v_ref = me.id then return false; end if;
  insert into public.shop_referrals (referrer_id, referred_owner_id, code) values (v_ref, me.id, v_code);
  return true;
exception when unique_violation then return false;
end $$;

-- The competition to show: the live one (active / paused), else the most recently ended one, else null.
create or replace function public.get_shop_competition_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare c public.shop_competitions; me record; v_total int; v_can boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not (public.is_owner() or public.is_admin()) then raise exception 'not_available' using errcode = '42501'; end if;
  select * into c from public.shop_competitions where status in ('active', 'paused') limit 1;
  if not found then
    select * into c from public.shop_competitions where status = 'ended' order by ended_at desc nulls last limit 1;
  end if;
  if not found then return null; end if;
  select pos, referrals into me from public.shop_competition_ranking(c.id) where owner_id = auth.uid();
  select count(*)::int into v_total from public.shop_competition_ranking(c.id);
  v_can := exists (select 1 from public.businesses where owner_id = auth.uid() and status in ('approved', 'inactive'));
  return jsonb_build_object(
    'id', c.id, 'title', c.title, 'description', c.description, 'status', c.status,
    'starts_at', c.starts_at, 'ends_at', c.ends_at, 'reward_amount_inr', c.reward_amount_inr,
    'server_now', now(), 'my_rank', me.pos, 'my_count', coalesce(me.referrals, 0), 'participants', v_total,
    'can_participate', v_can,
    'winner_business_name', c.winner_business_name, 'winner_referral_count', c.winner_referral_count,
    'i_won', (c.winner_owner_id is not null and c.winner_owner_id = auth.uid()));
end $$;

create or replace function public.get_shop_competition_leaderboard(p_competition_id uuid, p_limit int default 20)
returns table (rank int, business_name text, referrals int, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not (public.is_owner() or public.is_admin()) then raise exception 'not_available' using errcode = '42501'; end if;
  if not exists (select 1 from public.shop_competitions c where c.id = p_competition_id and (c.status <> 'draft' or public.is_admin())) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return query
  select r.pos, r.business_name, r.referrals, (r.owner_id = auth.uid())
    from public.shop_competition_ranking(p_competition_id) r
   order by r.pos
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

-- The owner's own referrals with the 4 steps (so they can see what is still missing)
create or replace function public.my_shop_referrals()
returns table (id uuid, status text, created_at timestamptz, business_name text, profile_complete boolean, phone_verified boolean,
               approved boolean, counted boolean, reject_reason text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return query
  select sr.id, sr.status, sr.created_at, bz.name,
         coalesce(public.business_profile_complete(bz.id), false),
         (bz.phone_verified_at is not null),
         coalesce(bz.status = 'approved', false),
         (sr.status = 'qualified' and sr.competition_id is not null),
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

create or replace function public.get_my_growth_credit() returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta_inr), 0)::numeric from public.growth_credit_ledger where owner_id = auth.uid();
$$;

-- Spending the promotional credit. Server-side only (service_role): called by the promotion / campaign checkout code,
-- never by the browser. Cannot go below zero. There is NO cash-out function.
create or replace function public.spend_growth_credit(p_owner uuid, p_amount numeric, p_note text) returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_bal numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  perform pg_advisory_xact_lock(hashtext('growth_credit:' || p_owner::text));
  select coalesce(sum(delta_inr), 0) into v_bal from public.growth_credit_ledger where owner_id = p_owner;
  if v_bal < p_amount then raise exception 'insufficient_credit'; end if;
  insert into public.growth_credit_ledger (owner_id, delta_inr, reason, note) values (p_owner, -p_amount, 'promo_spend', left(p_note, 200));
  return v_bal - p_amount;
end $$;

-- ============ 6. ADMIN FUNCTIONS ============
-- Create (p_id null) or edit a competition. Title, dates and prize are all stored here - nothing is hard-coded.
create or replace function public.admin_save_shop_competition(p_id uuid, p_title text, p_description text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_reward_inr numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; c public.shop_competitions;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then raise exception 'invalid_dates'; end if;
  if p_reward_inr is null or p_reward_inr <= 0 then raise exception 'invalid_reward'; end if;
  if p_id is null then
    insert into public.shop_competitions (title, description, starts_at, ends_at, reward_amount_inr, created_by)
    values (trim(p_title), nullif(trim(coalesce(p_description, '')), ''), p_starts_at, p_ends_at, p_reward_inr, auth.uid())
    returning id into v_id;
    perform public.write_audit_log('shop_competition.create', 'shop_competition', v_id,
      jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at, 'reward_inr', p_reward_inr));
  else
    select * into c from public.shop_competitions where id = p_id for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if c.status = 'ended' then raise exception 'already_ended'; end if;
    if c.status in ('active', 'paused') and p_ends_at <= now() then raise exception 'ends_in_past'; end if;
    update public.shop_competitions
       set title = trim(p_title), description = nullif(trim(coalesce(p_description, '')), ''),
           starts_at = p_starts_at, ends_at = p_ends_at, reward_amount_inr = p_reward_inr
     where id = p_id;
    v_id := p_id;
    perform public.write_audit_log('shop_competition.update', 'shop_competition', v_id,
      jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at, 'reward_inr', p_reward_inr));
  end if;
  return v_id;
end $$;

-- p_action: start | pause | resume | end | delete (delete = draft only)
create or replace function public.admin_set_shop_competition_status(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.shop_competitions;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.shop_competitions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  if p_action = 'start' then
    if c.status <> 'draft' then raise exception 'invalid_state'; end if;
    if c.ends_at <= now() then raise exception 'ends_in_past'; end if;
    if exists (select 1 from public.shop_competitions where status in ('active', 'paused') and id <> c.id) then raise exception 'another_live'; end if;
    update public.shop_competitions set status = 'active', starts_at = case when starts_at < now() then now() else starts_at end where id = c.id;
  elsif p_action = 'pause' then
    if c.status <> 'active' then raise exception 'invalid_state'; end if;
    update public.shop_competitions set status = 'paused' where id = c.id;
  elsif p_action = 'resume' then
    if c.status <> 'paused' then raise exception 'invalid_state'; end if;
    if c.ends_at <= now() then raise exception 'ends_in_past'; end if;
    update public.shop_competitions set status = 'active' where id = c.id;
  elsif p_action = 'end' then
    if c.status not in ('active', 'paused') then raise exception 'invalid_state'; end if;
    perform public.finalize_shop_competition(c.id);
    return;                                              -- finalize writes its own audit entry
  elsif p_action = 'delete' then
    if c.status <> 'draft' then raise exception 'invalid_state'; end if;
    delete from public.shop_competitions where id = c.id;
  else
    raise exception 'invalid_action';
  end if;
  perform public.write_audit_log('shop_competition.' || p_action, 'shop_competition', c.id, '{}');
end $$;

-- Admin confirms that a business phone number is genuine (e.g. by calling it). Re-checks any waiting referral.
create or replace function public.admin_set_business_phone_verified(p_business_id uuid, p_verified boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.businesses;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into b from public.businesses where id = p_business_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_verified and b.phone is null then raise exception 'no_phone'; end if;
  update public.businesses
     set phone_verified_at = case when p_verified then now() else null end,
         phone_verified_by = case when p_verified then auth.uid() else null end
   where id = b.id;
  perform public.write_audit_log('business.phone_verified', 'business', b.id, jsonb_build_object('verified', p_verified));
end $$;

create or replace function public.admin_revoke_shop_referral(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.shop_referrals;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  select * into r from public.shop_referrals where id = p_id for update;
  if not found or r.status <> 'qualified' then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.shop_referrals set status = 'revoked', revoked_reason = left(trim(p_reason), 300) where id = r.id;
  perform public.write_audit_log('shop_referral.revoke', 'shop_referral', r.id, jsonb_build_object('reason', p_reason));
end $$;

-- Admin list: every shop referral with its 4 conditions, so admin can see exactly what is missing
create or replace function public.admin_shop_referral_overview(p_limit int default 100)
returns table (id uuid, status text, created_at timestamptz, qualified_at timestamptz, competition_id uuid,
               referrer_business text, referred_owner_name text, business_id uuid, business_name text, business_phone text,
               profile_complete boolean, phone_verified boolean, approved boolean, reject_reason text, revoked_reason text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select sr.id, sr.status, sr.created_at, sr.qualified_at, sr.competition_id,
         (select z.name from public.businesses z where z.owner_id = sr.referrer_id and z.status in ('approved', 'inactive') order by z.created_at limit 1),
         p.full_name, bz.id, bz.name, bz.phone,
         coalesce(public.business_profile_complete(bz.id), false), (bz.phone_verified_at is not null),
         coalesce(bz.status = 'approved', false), sr.reject_reason, sr.revoked_reason
    from public.shop_referrals sr
    join public.profiles p on p.id = sr.referred_owner_id
    left join lateral (
      select z.* from public.businesses z where z.owner_id = sr.referred_owner_id
       order by (z.status = 'approved') desc, z.created_at limit 1
    ) bz on true
   order by sr.created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- List of competitions for the admin screen (newest first)
create or replace function public.admin_list_shop_competitions() returns setof public.shop_competitions
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query select * from public.shop_competitions order by created_at desc limit 50;
end $$;

-- ============ 7. FUNCTION PRIVILEGES ============
revoke execute on function
  public.businesses_reset_phone_verification(), public.phone_key(text), public.business_profile_complete(uuid),
  public.shop_competition_ranking(uuid), public.try_qualify_shop_referral(uuid), public.businesses_shop_referral_check(),
  public.finalize_shop_competition(uuid), public.finalize_due_shop_competitions(),
  public.get_my_shop_referral_code(), public.claim_shop_referral(text), public.get_shop_competition_overview(),
  public.get_shop_competition_leaderboard(uuid, int), public.my_shop_referrals(), public.get_my_growth_credit(),
  public.spend_growth_credit(uuid, numeric, text),
  public.admin_save_shop_competition(uuid, text, text, timestamptz, timestamptz, numeric),
  public.admin_set_shop_competition_status(uuid, text), public.admin_set_business_phone_verified(uuid, boolean),
  public.admin_revoke_shop_referral(uuid, text), public.admin_shop_referral_overview(int), public.admin_list_shop_competitions()
  from public, anon, authenticated;

grant execute on function
  public.get_my_shop_referral_code(), public.claim_shop_referral(text), public.get_shop_competition_overview(),
  public.get_shop_competition_leaderboard(uuid, int), public.my_shop_referrals(), public.get_my_growth_credit(),
  public.admin_save_shop_competition(uuid, text, text, timestamptz, timestamptz, numeric),
  public.admin_set_shop_competition_status(uuid, text), public.admin_set_business_phone_verified(uuid, boolean),
  public.admin_revoke_shop_referral(uuid, text), public.admin_shop_referral_overview(int), public.admin_list_shop_competitions()
  to authenticated;

-- only the server (service_role) may spend the promotional credit
grant execute on function public.spend_growth_credit(uuid, numeric, text) to service_role;
