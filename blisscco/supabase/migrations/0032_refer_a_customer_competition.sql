-- 0032: Refer-a-Customer Competition (admin-controlled) + Blisscco Promotional Balance for customers.
-- Run after 0031. Safe to re-run. NOTHING existing is changed (no existing table/function is altered).
-- Only NEW tables, NEW functions and 2 NEW triggers (they can never block a booking / profile update: errors inside are swallowed).
-- NO competition is created or started by this file - the admin creates and switches it ON from Admin > Refer-a-Customer Competition.
--
-- Reuses the existing customer referral link / code (referral_codes + referrals + claim_referral, link  /?ref=CODE).
-- A referral COUNTS only when ALL of these are true (checked on the server, never on the phone):
--   1. the new customer signed up through the referrer's own link / code (public.referrals row, attributed once)
--   2. the new customer's e-mail is verified (profiles.email_verified, set only from Supabase Auth)
--   3. the new customer did the genuine activity set by admin (default: a COMPLETED booking made by the customer at a shop that is
--      owned by neither of them, price >= admin minimum, inside the competition dates)
--   4. not self-referred, not a duplicate e-mail identity (a.b+x@gmail.com = ab@gmail.com), not suspended, not rejected by admin
-- Suspicious ones (booking minutes after sign-up, same shop again and again, burst) are put "in_review": they do NOT count until admin approves.
-- Reward = Blisscco Promotional Balance (never cash, not withdrawable), issued ONCE per competition after admin confirms the winner.

-- ============ 1. TABLES ============
create table if not exists public.customer_competitions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 100),
  description text check (char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'pending_verification', 'ended')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reward_amount_inr numeric(10, 2) not null default 1000 check (reward_amount_inr > 0 and reward_amount_inr <= 1000000),
  sponsor_business_id uuid references public.businesses(id) on delete set null,     -- null = reward usable at any participating shop
  reward_valid_days int not null default 90 check (reward_valid_days between 1 and 730),
  eligibility_rule text not null default 'completed_booking' check (eligibility_rule in ('completed_booking', 'confirmed_booking')),
  min_booking_value_inr numeric(10, 2) not null default 0 check (min_booking_value_inr >= 0),
  winner_customer_id uuid references public.profiles(id) on delete set null,
  winner_name text,                                                                  -- public display name (first name + initial)
  winner_referral_count int,
  ended_at timestamptz,
  reward_issued_at timestamptz,
  reward_issued_by uuid references public.profiles(id) on delete set null,
  verification_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_comp_dates check (ends_at > starts_at)
);
-- only ONE competition can be live (active / paused / waiting for winner confirmation) at a time
create unique index if not exists customer_competitions_one_live on public.customer_competitions ((true))
  where status in ('active', 'paused', 'pending_verification');
drop trigger if exists customer_competitions_updated_at on public.customer_competitions;
create trigger customer_competitions_updated_at before update on public.customer_competitions
  for each row execute function public.set_updated_at();

-- One row per referred customer once the server has judged them (counted / rejected). Attribution itself stays in public.referrals.
create table if not exists public.customer_comp_referrals (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.customer_competitions(id) on delete cascade,
  referral_id uuid not null unique references public.referrals(id) on delete cascade,
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_id uuid not null unique references public.profiles(id) on delete cascade,
  referred_email text,                                   -- normalised e-mail identity (only kept for counted rows)
  qualifying_booking_id uuid references public.bookings(id) on delete set null,
  status text not null default 'qualified' check (status in ('qualified', 'rejected')),
  review_status text not null default 'clear' check (review_status in ('clear', 'in_review', 'approved', 'rejected')),
  risk_flags jsonb not null default '[]'::jsonb,
  reject_reason text,
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  qualified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists ccr_comp_idx on public.customer_comp_referrals (competition_id, referrer_id) where status = 'qualified';
create unique index if not exists ccr_email_once on public.customer_comp_referrals (referred_email) where status = 'qualified';

-- The reward. ONE grant per competition (unique index) = issued only once.
create table if not exists public.promo_balance_grants (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  competition_id uuid not null unique references public.customer_competitions(id),
  code text not null unique,                             -- the customer shows this code at the shop (like a coupon code)
  amount_inr numeric(10, 2) not null check (amount_inr > 0),
  sponsor_business_id uuid references public.businesses(id) on delete set null,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists promo_grants_customer_idx on public.promo_balance_grants (customer_id);

create table if not exists public.promo_balance_redemptions (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.promo_balance_grants(id),
  business_id uuid not null references public.businesses(id),
  booking_id uuid not null unique references public.bookings(id),   -- a booking can use the balance only once
  amount_inr numeric(10, 2) not null check (amount_inr > 0),
  redeemed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists promo_redeem_grant_idx on public.promo_balance_redemptions (grant_id, created_at desc);

-- ============ 2. RLS (every write goes through the functions below) ============
alter table public.customer_competitions enable row level security;
alter table public.customer_comp_referrals enable row level security;
alter table public.promo_balance_grants enable row level security;
alter table public.promo_balance_redemptions enable row level security;

drop policy if exists customer_comp_select on public.customer_competitions;
create policy customer_comp_select on public.customer_competitions for select to authenticated using (public.is_admin() or status <> 'draft');
drop policy if exists ccr_select on public.customer_comp_referrals;
create policy ccr_select on public.customer_comp_referrals for select to authenticated using (public.is_admin());
drop policy if exists promo_grants_select on public.promo_balance_grants;
create policy promo_grants_select on public.promo_balance_grants for select to authenticated using (customer_id = auth.uid() or public.is_admin());
drop policy if exists promo_redeem_select on public.promo_balance_redemptions;
create policy promo_redeem_select on public.promo_balance_redemptions for select to authenticated
  using (public.is_admin() or exists (select 1 from public.promo_balance_grants g where g.id = grant_id and g.customer_id = auth.uid()));

revoke all on public.customer_competitions, public.customer_comp_referrals, public.promo_balance_grants, public.promo_balance_redemptions from anon, authenticated;
grant select on public.customer_competitions, public.customer_comp_referrals, public.promo_balance_grants, public.promo_balance_redemptions to authenticated;

-- ============ 3. INTERNAL HELPERS ============
-- Public display name: "Priya S." - never the full name, never e-mail / phone.
create or replace function public.customer_display_name(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when trim(coalesce(p_name, '')) = '' then 'Customer'
    when position(' ' in trim(p_name)) = 0 then left(trim(p_name), 20)
    else left(split_part(trim(p_name), ' ', 1), 20) || ' ' || upper(left(regexp_replace(trim(p_name), '^.*\s', ''), 1)) || '.'
  end;
$$;

-- Ranking: most counted referrals first; tie = whoever reached that count EARLIER wins; then the older account.
create or replace function public.customer_comp_ranking(p_competition_id uuid)
returns table (pos int, referrer_id uuid, full_name text, display_name text, referrals int, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select (row_number() over (order by g.cnt desc, g.last_at asc, pr.created_at asc))::int,
         g.referrer_id, pr.full_name, public.customer_display_name(pr.full_name), g.cnt, g.last_at
    from (
      select x.referrer_id, count(*)::int as cnt, max(x.qualified_at) as last_at
        from public.customer_comp_referrals x
        join public.profiles rp on rp.id = x.referrer_id and not rp.is_suspended
        join public.profiles dp on dp.id = x.referred_id and not dp.is_suspended
       where x.competition_id = p_competition_id and x.status = 'qualified' and x.review_status in ('clear', 'approved')
       group by x.referrer_id
    ) g
    join public.profiles pr on pr.id = g.referrer_id;
$$;

-- Checks the conditions for ONE referred customer. Called by triggers (booking made / completed, e-mail verified).
create or replace function public.try_qualify_customer_comp_referral(p_referred uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.referrals; c public.customer_competitions; pr public.profiles; rr public.profiles; bk public.bookings;
  v_email text; v_ref_email text; v_flags jsonb := '[]'::jsonb; v_review text := 'clear'; v_n int;
begin
  select * into r from public.referrals where referred_id = p_referred and status in ('pending', 'rewarded');
  if not found then return; end if;
  if exists (select 1 from public.customer_comp_referrals where referred_id = p_referred) then return; end if;
  select * into c from public.customer_competitions where status = 'active' and now() >= starts_at and now() < ends_at limit 1;
  if not found then return; end if;

  select * into pr from public.profiles where id = p_referred;
  if not found or pr.is_suspended or pr.role <> 'customer' or not pr.email_verified then return; end if;
  select public.normalize_email(u.email) into v_email from auth.users u where u.id = p_referred and u.email_confirmed_at is not null;
  if coalesce(v_email, '') = '' then return; end if;

  select * into rr from public.profiles where id = r.referrer_id;
  if not found or rr.is_suspended or rr.role <> 'customer' then
    insert into public.customer_comp_referrals (competition_id, referral_id, referrer_id, referred_id, status, review_status, reject_reason)
    values (c.id, r.id, r.referrer_id, p_referred, 'rejected', 'rejected', 'referrer_not_eligible') on conflict do nothing;
    return;
  end if;
  if not rr.email_verified then return; end if;                       -- may verify later: wait

  select public.normalize_email(u.email) into v_ref_email from auth.users u where u.id = r.referrer_id;
  if v_ref_email is not null and v_ref_email = v_email then
    insert into public.customer_comp_referrals (competition_id, referral_id, referrer_id, referred_id, status, review_status, reject_reason)
    values (c.id, r.id, r.referrer_id, p_referred, 'rejected', 'rejected', 'self_referral') on conflict do nothing;
    return;
  end if;
  if exists (select 1 from public.customer_comp_referrals x where x.referred_email = v_email and x.status = 'qualified') then
    insert into public.customer_comp_referrals (competition_id, referral_id, referrer_id, referred_id, status, review_status, reject_reason)
    values (c.id, r.id, r.referrer_id, p_referred, 'rejected', 'rejected', 'duplicate_email') on conflict do nothing;
    return;
  end if;

  -- the genuine activity, inside the competition window, at a shop owned by neither person
  select b.* into bk from public.bookings b join public.businesses z on z.id = b.business_id
   where b.customer_id = p_referred and b.source = 'customer'
     and z.owner_id <> r.referrer_id and z.owner_id <> p_referred
     and b.price_inr >= c.min_booking_value_inr
     and case when c.eligibility_rule = 'completed_booking'
              then b.status = 'completed' and b.completed_at >= c.starts_at and b.completed_at < c.ends_at
              else b.status in ('confirmed', 'checked_in', 'in_service', 'completed') and b.created_at >= c.starts_at and b.created_at < c.ends_at end
   order by b.created_at limit 1;
  if not found then return; end if;

  -- suspicious patterns -> in_review (does NOT count until admin approves)
  if bk.created_at < pr.created_at + interval '30 minutes' then v_flags := v_flags || '"fast_booking"'::jsonb; end if;
  select count(*) into v_n from public.customer_comp_referrals x join public.bookings xb on xb.id = x.qualifying_booking_id
   where x.referrer_id = r.referrer_id and x.competition_id = c.id and x.status = 'qualified' and xb.business_id = bk.business_id;
  if v_n >= 2 then v_flags := v_flags || '"same_shop_pattern"'::jsonb; end if;
  select count(*) into v_n from public.customer_comp_referrals x
   where x.referrer_id = r.referrer_id and x.status = 'qualified' and x.qualified_at > now() - interval '1 hour';
  if v_n >= 3 then v_flags := v_flags || '"burst"'::jsonb; end if;
  if jsonb_array_length(v_flags) > 0 then v_review := 'in_review'; end if;

  begin
    insert into public.customer_comp_referrals (competition_id, referral_id, referrer_id, referred_id, referred_email, qualifying_booking_id, status, review_status, risk_flags)
    values (c.id, r.id, r.referrer_id, p_referred, v_email, bk.id, 'qualified', v_review, v_flags);
  exception when unique_violation then
    return;
  end;
  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
  values (null, 'customer_referral.qualify', 'customer_referral', r.id, jsonb_build_object('competition_id', c.id, 'booking_id', bk.id, 'review', v_review, 'flags', v_flags));
end $$;

-- Triggers: errors are swallowed so a booking / profile update can NEVER fail because of the competition.
create or replace function public.customer_comp_booking_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is not null and new.source = 'customer' and new.status in ('confirmed', 'checked_in', 'in_service', 'completed') then
    begin perform public.try_qualify_customer_comp_referral(new.customer_id);
    exception when others then null; end;
  end if;
  return new;
end $$;
drop trigger if exists customer_comp_booking_check on public.bookings;
create trigger customer_comp_booking_check after insert or update of status on public.bookings
  for each row execute function public.customer_comp_booking_check();

create or replace function public.customer_comp_profile_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_verified and not old.email_verified then
    begin perform public.try_qualify_customer_comp_referral(new.id);
    exception when others then null; end;
  end if;
  return new;
end $$;
drop trigger if exists customer_comp_profile_check on public.profiles;
create trigger customer_comp_profile_check after update of email_verified on public.profiles
  for each row execute function public.customer_comp_profile_check();

-- Competition time is over -> waits for the admin to review referrals and confirm the winner. NO reward is given here.
create or replace function public.customer_competition_close(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customer_competitions;
begin
  select * into c from public.customer_competitions where id = p_id for update;
  if not found or c.status not in ('active', 'paused') then return; end if;
  update public.customer_competitions set status = 'pending_verification', ended_at = now() where id = p_id;
  perform public.write_audit_log('customer_competition.end', 'customer_competition', p_id, '{}');
end $$;

create or replace function public.close_due_customer_competitions() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.customer_competitions where status in ('active', 'paused') and ends_at <= now() loop
    perform public.customer_competition_close(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('blisscco-close-customer-competitions', '*/5 * * * *', 'select public.close_due_customer_competitions()');
exception when others then
  raise notice 'pg_cron schedule skipped (%): enable pg_cron in Dashboard > Database > Extensions, then re-run this file. (Admin can still press End by hand.)', sqlerrm;
end $$;

-- ============ 4. CUSTOMER FUNCTIONS ============
-- The competition to show: the live one, else the most recently ended one, else null. Draft is never shown.
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
  select count(*)::int into v_review from public.customer_comp_referrals where competition_id = c.id and referrer_id = auth.uid() and status = 'qualified' and review_status = 'in_review';
  select count(*)::int into v_wait from public.referrals r
   where r.referrer_id = auth.uid() and r.status in ('pending', 'rewarded') and not exists (select 1 from public.customer_comp_referrals x where x.referral_id = r.id);
  select name into v_sponsor from public.businesses where id = c.sponsor_business_id;
  return jsonb_build_object(
    'id', c.id, 'title', c.title, 'description', c.description, 'status', c.status,
    'starts_at', c.starts_at, 'ends_at', c.ends_at, 'reward_amount_inr', c.reward_amount_inr, 'server_now', now(),
    'sponsor_business_name', v_sponsor, 'reward_valid_days', c.reward_valid_days,
    'eligibility_rule', c.eligibility_rule, 'min_booking_value_inr', c.min_booking_value_inr,
    'my_rank', me.pos, 'my_count', coalesce(me.referrals, 0), 'my_in_review', v_review, 'my_waiting', v_wait, 'participants', v_total,
    'winner_name', c.winner_name, 'winner_referral_count', c.winner_referral_count,
    'i_won', (c.winner_customer_id is not null and c.winner_customer_id = auth.uid()));
end $$;

create or replace function public.get_customer_competition_leaderboard(p_competition_id uuid, p_limit int default 20)
returns table (rank int, display_name text, referrals int, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not (public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'customer')) then
    raise exception 'not_available' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customer_competitions c where c.id = p_competition_id and (c.status <> 'draft' or public.is_admin())) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return query
  select r.pos, r.display_name, r.referrals, (r.referrer_id = auth.uid())
    from public.customer_comp_ranking(p_competition_id) r
   order by r.pos
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

-- My own referrals: only a first name + initial of the referred person, and what is still missing
create or replace function public.my_customer_comp_referrals()
returns table (id uuid, created_at timestamptz, display_name text, email_verified boolean, activity_done boolean, state text, reject_reason text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return query
  select r.id, r.created_at, public.customer_display_name(p.full_name), coalesce(p.email_verified, false),
         (x.qualifying_booking_id is not null),
         case when x.id is null then 'waiting'
              when x.status = 'rejected' or x.review_status = 'rejected' then 'rejected'
              when x.review_status = 'in_review' then 'under_review'
              else 'counted' end,
         x.reject_reason
    from public.referrals r
    left join public.profiles p on p.id = r.referred_id
    left join public.customer_comp_referrals x on x.referral_id = r.id
   where r.referrer_id = auth.uid() and r.status in ('pending', 'rewarded')
   order by r.created_at desc
   limit 100;
end $$;

create or replace function public.my_promo_balances()
returns table (id uuid, code text, amount_inr numeric, used_inr numeric, remaining_inr numeric, expires_at timestamptz, state text,
               sponsor_business_name text, competition_title text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return query
  select g.id, g.code, g.amount_inr, u.used, (g.amount_inr - u.used),
         g.expires_at,
         case when g.status = 'revoked' then 'revoked' when g.expires_at <= now() then 'expired' when g.amount_inr - u.used <= 0 then 'used' else 'active' end,
         b.name, c.title, g.created_at
    from public.promo_balance_grants g
    cross join lateral (select coalesce(sum(r.amount_inr), 0)::numeric as used from public.promo_balance_redemptions r where r.grant_id = g.id) u
    left join public.businesses b on b.id = g.sponsor_business_id
    left join public.customer_competitions c on c.id = g.competition_id
   where g.customer_id = auth.uid()
   order by g.created_at desc;
end $$;

create or replace function public.my_promo_history()
returns table (id uuid, grant_code text, business_name text, amount_inr numeric, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return query
  select r.id, g.code, b.name, r.amount_inr, r.created_at
    from public.promo_balance_redemptions r
    join public.promo_balance_grants g on g.id = r.grant_id
    join public.businesses b on b.id = r.business_id
   where g.customer_id = auth.uid()
   order by r.created_at desc limit 100;
end $$;

-- ============ 5. SHOP-OWNER FUNCTIONS (use the customer's promotional balance on a completed booking) ============
create or replace function public.check_promo_balance(p_code text, p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g public.promo_balance_grants; acc boolean; v_used numeric; v_reason text;
begin
  if not public.owns_business(p_business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into g from public.promo_balance_grants where code = upper(trim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('valid', false, 'reason', 'promo_not_found'); end if;
  select coalesce(sum(amount_inr), 0) into v_used from public.promo_balance_redemptions where grant_id = g.id;
  select accept_coupons into acc from public.business_booking_settings where business_id = p_business_id;
  v_reason := case when g.status = 'revoked' then 'promo_revoked' when g.expires_at <= now() then 'promo_expired' when g.amount_inr - v_used <= 0 then 'promo_used'
                   when not coalesce(acc, false) then 'not_accepting'
                   when g.sponsor_business_id is not null and g.sponsor_business_id <> p_business_id then 'wrong_business' end;
  return jsonb_build_object('valid', v_reason is null, 'reason', v_reason, 'remaining_inr', g.amount_inr - v_used, 'expires_at', g.expires_at);
end $$;

create or replace function public.promo_eligible_bookings(p_code text, p_business_id uuid)
returns table (booking_id uuid, service_label text, price_inr numeric, completed_at timestamptz, customer_name text)
language plpgsql stable security definer set search_path = '' as $$
declare g public.promo_balance_grants;
begin
  if not public.owns_business(p_business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into g from public.promo_balance_grants where code = upper(trim(coalesce(p_code, ''))) and status = 'active' and expires_at > now();
  if not found then return; end if;
  if g.sponsor_business_id is not null and g.sponsor_business_id <> p_business_id then return; end if;
  return query
  select b.id, b.service_label, b.price_inr, b.completed_at, b.customer_name
    from public.bookings b
   where b.business_id = p_business_id and b.customer_id = g.customer_id and b.status = 'completed'
     and b.completed_at > now() - interval '7 days'
     and not exists (select 1 from public.promo_balance_redemptions r where r.booking_id = b.id)
     and not exists (select 1 from public.coupon_redemptions r where r.booking_id = b.id)
   order by b.completed_at desc;
end $$;

create or replace function public.redeem_promo_balance(p_code text, p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.promo_balance_grants; bk public.bookings; acc boolean; v_used numeric; v_disc numeric;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id;
  if not found or not public.owns_business(bk.business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into g from public.promo_balance_grants where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'promo_not_found'; end if;
  if g.status = 'revoked' then raise exception 'promo_revoked'; end if;
  if g.expires_at <= now() then raise exception 'promo_expired'; end if;
  select accept_coupons into acc from public.business_booking_settings where business_id = bk.business_id;
  if not coalesce(acc, false) then raise exception 'not_accepting'; end if;
  if g.sponsor_business_id is not null and g.sponsor_business_id <> bk.business_id then raise exception 'wrong_business'; end if;
  if bk.status <> 'completed' or bk.customer_id is distinct from g.customer_id or bk.completed_at < now() - interval '7 days' then raise exception 'booking_mismatch'; end if;
  if exists (select 1 from public.coupon_redemptions where booking_id = bk.id) then raise exception 'already_redeemed'; end if;
  select coalesce(sum(amount_inr), 0) into v_used from public.promo_balance_redemptions where grant_id = g.id;
  if g.amount_inr - v_used <= 0 then raise exception 'promo_used'; end if;
  v_disc := round(least(g.amount_inr - v_used, bk.price_inr), 2);
  begin
    insert into public.promo_balance_redemptions (grant_id, business_id, booking_id, amount_inr, redeemed_by) values (g.id, bk.business_id, bk.id, v_disc, auth.uid());
  exception when unique_violation then raise exception 'already_redeemed';
  end;
  return jsonb_build_object('discount', v_disc, 'remaining', g.amount_inr - v_used - v_disc);
end $$;

-- ============ 6. ADMIN FUNCTIONS ============
create or replace function public.admin_save_customer_competition(p_id uuid, p_title text, p_description text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_reward_inr numeric, p_sponsor_business_id uuid, p_rule text, p_min_booking_inr numeric, p_valid_days int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; c public.customer_competitions;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then raise exception 'invalid_dates'; end if;
  if p_reward_inr is null or p_reward_inr <= 0 then raise exception 'invalid_reward'; end if;
  if coalesce(p_rule, 'completed_booking') not in ('completed_booking', 'confirmed_booking') then raise exception 'invalid_rule'; end if;
  if p_sponsor_business_id is not null and not exists (select 1 from public.businesses where id = p_sponsor_business_id and status = 'approved') then raise exception 'invalid_sponsor'; end if;
  if p_id is null then
    insert into public.customer_competitions (title, description, starts_at, ends_at, reward_amount_inr, sponsor_business_id, eligibility_rule, min_booking_value_inr, reward_valid_days, created_by)
    values (trim(p_title), nullif(trim(coalesce(p_description, '')), ''), p_starts_at, p_ends_at, p_reward_inr, p_sponsor_business_id,
            coalesce(p_rule, 'completed_booking'), greatest(coalesce(p_min_booking_inr, 0), 0), coalesce(p_valid_days, 90), auth.uid())
    returning id into v_id;       -- always created as DRAFT (OFF). Admin switches it ON with Start.
    perform public.write_audit_log('customer_competition.create', 'customer_competition', v_id, jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at, 'reward_inr', p_reward_inr));
  else
    select * into c from public.customer_competitions where id = p_id for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if c.status in ('ended', 'pending_verification') then raise exception 'already_ended'; end if;
    if c.status in ('active', 'paused') and p_ends_at <= now() then raise exception 'ends_in_past'; end if;
    update public.customer_competitions
       set title = trim(p_title), description = nullif(trim(coalesce(p_description, '')), ''), starts_at = p_starts_at, ends_at = p_ends_at,
           reward_amount_inr = p_reward_inr, sponsor_business_id = p_sponsor_business_id, eligibility_rule = coalesce(p_rule, 'completed_booking'),
           min_booking_value_inr = greatest(coalesce(p_min_booking_inr, 0), 0), reward_valid_days = coalesce(p_valid_days, 90)
     where id = p_id;
    v_id := p_id;
    perform public.write_audit_log('customer_competition.update', 'customer_competition', v_id, jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at, 'reward_inr', p_reward_inr));
  end if;
  return v_id;
end $$;

-- p_action: start (ON) | pause (OFF) | resume (ON) | end | delete (draft only)
create or replace function public.admin_set_customer_competition_status(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customer_competitions;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.customer_competitions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_action = 'start' then
    if c.status <> 'draft' then raise exception 'invalid_state'; end if;
    if c.ends_at <= now() then raise exception 'ends_in_past'; end if;
    if exists (select 1 from public.customer_competitions where status in ('active', 'paused', 'pending_verification') and id <> c.id) then raise exception 'another_live'; end if;
    update public.customer_competitions set status = 'active', starts_at = case when starts_at < now() then now() else starts_at end where id = c.id;
  elsif p_action = 'pause' then
    if c.status <> 'active' then raise exception 'invalid_state'; end if;
    update public.customer_competitions set status = 'paused' where id = c.id;
  elsif p_action = 'resume' then
    if c.status <> 'paused' then raise exception 'invalid_state'; end if;
    if c.ends_at <= now() then raise exception 'ends_in_past'; end if;
    update public.customer_competitions set status = 'active' where id = c.id;
  elsif p_action = 'end' then
    if c.status not in ('active', 'paused') then raise exception 'invalid_state'; end if;
    perform public.customer_competition_close(c.id);
    return;
  elsif p_action = 'delete' then
    if c.status <> 'draft' then raise exception 'invalid_state'; end if;
    delete from public.customer_competitions where id = c.id;
  else
    raise exception 'invalid_action';
  end if;
  perform public.write_audit_log('customer_competition.' || p_action, 'customer_competition', c.id, '{}');
end $$;

create or replace function public.admin_list_customer_competitions()
returns table (id uuid, title text, description text, status text, starts_at timestamptz, ends_at timestamptz, reward_amount_inr numeric,
               sponsor_business_id uuid, sponsor_business_name text, reward_valid_days int, eligibility_rule text, min_booking_value_inr numeric,
               winner_name text, winner_referral_count int, reward_issued_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select c.id, c.title, c.description, c.status, c.starts_at, c.ends_at, c.reward_amount_inr, c.sponsor_business_id, b.name, c.reward_valid_days,
         c.eligibility_rule, c.min_booking_value_inr, c.winner_name, c.winner_referral_count, c.reward_issued_at
    from public.customer_competitions c left join public.businesses b on b.id = c.sponsor_business_id
   order by c.created_at desc limit 50;
end $$;

-- Admin standings with real names (customers only ever see "Priya S.")
create or replace function public.admin_customer_standings(p_competition_id uuid)
returns table (rank int, full_name text, referrals int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query select r.pos, coalesce(r.full_name, r.display_name), r.referrals from public.customer_comp_ranking(p_competition_id) r order by r.pos limit 50;
end $$;

-- p_filter: all | review | counted | rejected
create or replace function public.admin_customer_referral_overview(p_competition_id uuid, p_filter text default 'all')
returns table (id uuid, status text, review_status text, qualified_at timestamptz, referrer_name text, referred_name text, business_name text,
               booking_price numeric, risk_flags jsonb, reject_reason text, review_note text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select x.id, x.status, x.review_status, x.qualified_at, coalesce(rp.full_name, '—'), coalesce(dp.full_name, '—'), bz.name, bk.price_inr,
         x.risk_flags, x.reject_reason, x.review_note
    from public.customer_comp_referrals x
    join public.profiles rp on rp.id = x.referrer_id
    join public.profiles dp on dp.id = x.referred_id
    left join public.bookings bk on bk.id = x.qualifying_booking_id
    left join public.businesses bz on bz.id = bk.business_id
   where x.competition_id = p_competition_id
     and case coalesce(p_filter, 'all')
           when 'review' then x.review_status = 'in_review'
           when 'counted' then x.status = 'qualified' and x.review_status in ('clear', 'approved')
           when 'rejected' then x.status = 'rejected' or x.review_status = 'rejected'
           else true end
   order by (x.review_status = 'in_review') desc, x.qualified_at desc
   limit 200;
end $$;

-- p_action: approve | reject  (suspicious referral decision)
create or replace function public.admin_review_customer_referral(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.customer_comp_referrals; c public.customer_competitions;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into x from public.customer_comp_referrals where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.customer_competitions where id = x.competition_id;
  if c.status = 'ended' then raise exception 'competition_closed'; end if;
  if p_action = 'approve' then
    if x.status <> 'qualified' then raise exception 'invalid_state'; end if;
    update public.customer_comp_referrals set review_status = 'approved', review_note = left(trim(coalesce(p_note, '')), 300), reviewed_by = auth.uid(), reviewed_at = now() where id = x.id;
  elsif p_action = 'reject' then
    if char_length(trim(coalesce(p_note, ''))) < 3 then raise exception 'reason_required'; end if;
    update public.customer_comp_referrals
       set status = 'rejected', review_status = 'rejected', reject_reason = 'admin_rejected', referred_email = null,
           review_note = left(trim(p_note), 300), reviewed_by = auth.uid(), reviewed_at = now()
     where id = x.id;
  else
    raise exception 'invalid_action';
  end if;
  perform public.write_audit_log('customer_referral.' || p_action, 'customer_referral', x.id, jsonb_build_object('note', p_note));
end $$;

-- Final check before confirming the winner
create or replace function public.admin_customer_winner_check(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.customer_competitions; w record; v_review int; v_top jsonb; v_has boolean;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.customer_competitions where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into w from public.customer_comp_ranking(p_id) where pos = 1;
  v_has := found;
  select count(*)::int into v_review from public.customer_comp_referrals where competition_id = p_id and status = 'qualified' and review_status = 'in_review';
  select coalesce(jsonb_agg(jsonb_build_object('rank', t.pos, 'name', coalesce(t.full_name, t.display_name), 'referrals', t.referrals) order by t.pos), '[]'::jsonb)
    into v_top from (select * from public.customer_comp_ranking(p_id) where pos <= 3) t;
  return jsonb_build_object(
    'status', c.status, 'reward_amount_inr', c.reward_amount_inr, 'has_winner', v_has, 'winner_name', coalesce(w.full_name, w.display_name),
    'winner_referrals', w.referrals, 'unresolved_review', v_review, 'top', v_top,
    'already_issued', (c.reward_issued_at is not null),
    'can_issue', (c.status = 'pending_verification' and w.referrer_id is not null and v_review = 0 and c.reward_issued_at is null));
end $$;

-- Confirms the final winner and issues the Promotional Balance - exactly once.
create or replace function public.admin_confirm_customer_winner(p_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.customer_competitions; w record; v_code text; v_grant uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.customer_competitions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.reward_issued_at is not null or exists (select 1 from public.promo_balance_grants where competition_id = p_id) then raise exception 'already_awarded'; end if;
  if c.status <> 'pending_verification' then raise exception 'invalid_state'; end if;
  if exists (select 1 from public.customer_comp_referrals where competition_id = p_id and status = 'qualified' and review_status = 'in_review') then raise exception 'unresolved_review'; end if;
  select * into w from public.customer_comp_ranking(p_id) where pos = 1;
  if not found then raise exception 'no_winner'; end if;
  loop
    v_code := public.make_code('BP-', 8);
    exit when not exists (select 1 from public.promo_balance_grants where code = v_code);
  end loop;
  insert into public.promo_balance_grants (customer_id, competition_id, code, amount_inr, sponsor_business_id, expires_at, note, created_by)
  values (w.referrer_id, p_id, v_code, c.reward_amount_inr, c.sponsor_business_id, now() + make_interval(days => c.reward_valid_days), left(c.title, 100), auth.uid())
  returning id into v_grant;
  update public.customer_competitions
     set status = 'ended', winner_customer_id = w.referrer_id, winner_name = w.display_name, winner_referral_count = w.referrals,
         reward_issued_at = now(), reward_issued_by = auth.uid(), verification_note = left(trim(coalesce(p_note, '')), 300)
   where id = p_id;
  perform public.write_audit_log('customer_competition.award', 'customer_competition', p_id,
    jsonb_build_object('winner_id', w.referrer_id, 'referrals', w.referrals, 'reward_inr', c.reward_amount_inr, 'grant_id', v_grant));
  return jsonb_build_object('awarded', true, 'grant_id', v_grant);
end $$;

create or replace function public.admin_close_customer_competition_no_winner(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customer_competitions;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.customer_competitions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status <> 'pending_verification' or c.reward_issued_at is not null then raise exception 'invalid_state'; end if;
  if exists (select 1 from public.customer_comp_referrals where competition_id = p_id and status = 'qualified' and review_status = 'in_review') then raise exception 'unresolved_review'; end if;
  update public.customer_competitions set status = 'ended', verification_note = left(trim(coalesce(p_note, '')), 300) where id = p_id;
  perform public.write_audit_log('customer_competition.close_no_winner', 'customer_competition', p_id, '{}');
end $$;

-- Admin: see every promo balance + how much was used (redemption history is in promo_balance_redemptions)
create or replace function public.admin_promo_balances()
returns table (id uuid, code text, customer_name text, amount_inr numeric, used_inr numeric, remaining_inr numeric, expires_at timestamptz, state text, sponsor_business_name text, competition_title text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select g.id, g.code, coalesce(p.full_name, '—'), g.amount_inr, u.used, (g.amount_inr - u.used), g.expires_at,
         case when g.status = 'revoked' then 'revoked' when g.expires_at <= now() then 'expired' when g.amount_inr - u.used <= 0 then 'used' else 'active' end,
         b.name, c.title
    from public.promo_balance_grants g
    join public.profiles p on p.id = g.customer_id
    cross join lateral (select coalesce(sum(r.amount_inr), 0)::numeric as used from public.promo_balance_redemptions r where r.grant_id = g.id) u
    left join public.businesses b on b.id = g.sponsor_business_id
    left join public.customer_competitions c on c.id = g.competition_id
   order by g.created_at desc limit 50;
end $$;

-- ============ 7. FUNCTION PRIVILEGES ============
revoke execute on function
  public.customer_display_name(text), public.customer_comp_ranking(uuid), public.try_qualify_customer_comp_referral(uuid),
  public.customer_comp_booking_check(), public.customer_comp_profile_check(), public.customer_competition_close(uuid), public.close_due_customer_competitions(),
  public.get_customer_competition_overview(), public.get_customer_competition_leaderboard(uuid, int), public.my_customer_comp_referrals(),
  public.my_promo_balances(), public.my_promo_history(), public.check_promo_balance(text, uuid), public.promo_eligible_bookings(text, uuid),
  public.redeem_promo_balance(text, uuid),
  public.admin_save_customer_competition(uuid, text, text, timestamptz, timestamptz, numeric, uuid, text, numeric, int),
  public.admin_set_customer_competition_status(uuid, text), public.admin_list_customer_competitions(), public.admin_customer_standings(uuid),
  public.admin_customer_referral_overview(uuid, text), public.admin_review_customer_referral(uuid, text, text), public.admin_customer_winner_check(uuid),
  public.admin_confirm_customer_winner(uuid, text), public.admin_close_customer_competition_no_winner(uuid, text), public.admin_promo_balances()
  from public, anon, authenticated;

grant execute on function
  public.get_customer_competition_overview(), public.get_customer_competition_leaderboard(uuid, int), public.my_customer_comp_referrals(),
  public.my_promo_balances(), public.my_promo_history(), public.check_promo_balance(text, uuid), public.promo_eligible_bookings(text, uuid),
  public.redeem_promo_balance(text, uuid),
  public.admin_save_customer_competition(uuid, text, text, timestamptz, timestamptz, numeric, uuid, text, numeric, int),
  public.admin_set_customer_competition_status(uuid, text), public.admin_list_customer_competitions(), public.admin_customer_standings(uuid),
  public.admin_customer_referral_overview(uuid, text), public.admin_review_customer_referral(uuid, text, text), public.admin_customer_winner_check(uuid),
  public.admin_confirm_customer_winner(uuid, text), public.admin_close_customer_competition_no_winner(uuid, text), public.admin_promo_balances()
  to authenticated;
