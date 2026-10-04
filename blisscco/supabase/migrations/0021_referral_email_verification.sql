-- 0021: Refer & Earn now uses EMAIL verification instead of phone OTP.
-- * A referred customer qualifies when their e-mail is confirmed in Supabase Auth (never client-supplied).
-- * One reward per e-mail "identity": lower-case, "+tag" removed, and for Gmail the dots removed (a.b+x@gmail.com = ab@gmail.com).
-- * All phone-OTP leftovers are removed: profiles.phone / phone_verified, referrals.referred_phone / phone_verified,
--   the auth.users phone trigger and function, and the phone column in admin_list_users.
-- Run after 0020. Safe to re-run.

-- ---------- 1. e-mail normaliser ----------
create or replace function public.normalize_email(p_email text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := lower(trim(coalesce(p_email, ''))); l text; d text;
begin
  if position('@' in v) = 0 then return v; end if;
  l := split_part(split_part(v, '@', 1), '+', 1);
  d := split_part(v, '@', 2);
  if d in ('gmail.com', 'googlemail.com') then l := replace(l, '.', ''); d := 'gmail.com'; end if;
  return l || '@' || d;
end $$;

-- ---------- 2. profiles.email_verified ----------
alter table public.profiles add column if not exists email_verified boolean not null default false;

-- guard first (so the column swap below can never trip it): API users can never change role / suspension / email_verified
create or replace function public.guard_profile_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role
       or new.is_suspended is distinct from old.is_suspended
       or new.email_verified is distinct from old.email_verified
       or new.id is distinct from old.id then
      raise exception 'protected profile fields cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

update public.profiles p set email_verified = true
  from auth.users u
 where u.id = p.id and u.email_confirmed_at is not null and coalesce(u.email, '') <> '' and not p.email_verified;

-- new accounts: Google sign-in arrives already confirmed; e-mail sign-up is confirmed later (trigger in step 5)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role;
  v_lang text;
begin
  v_role := case new.raw_user_meta_data ->> 'signup_role'
              when 'owner' then 'owner'::public.user_role
              else 'customer'::public.user_role end;
  v_lang := case when new.raw_user_meta_data ->> 'language' in ('en', 'hi', 'mr')
                 then new.raw_user_meta_data ->> 'language' else 'en' end;
  insert into public.profiles (id, role, full_name, language, email_verified)
  values (new.id, v_role, nullif(left(new.raw_user_meta_data ->> 'full_name', 120), ''), v_lang,
          (new.email_confirmed_at is not null and coalesce(new.email, '') <> ''));
  return new;
end $$;

-- ---------- 3. referrals: phone columns -> e-mail columns ----------
alter table public.referrals add column if not exists referred_email text;
alter table public.referrals add column if not exists email_verified boolean not null default false;

-- keep the "one reward per person" rule for rewards that were already given (first row per e-mail identity only)
with x as (
  select r.id, public.normalize_email(u.email) as em,
         row_number() over (partition by public.normalize_email(u.email) order by r.rewarded_at nulls last, r.created_at) as rn
    from public.referrals r join auth.users u on u.id = r.referred_id
   where r.status in ('rewarded', 'revoked')
)
update public.referrals r set referred_email = x.em, email_verified = true
  from x where x.id = r.id and x.rn = 1 and r.referred_email is null;

update public.referrals set reject_reason = 'duplicate_email' where reject_reason = 'duplicate_phone';

drop index if exists public.referrals_phone_once;
create unique index if not exists referrals_email_once on public.referrals (referred_email) where status in ('rewarded', 'revoked');

-- ---------- 4. reward function (same rules as 0010, e-mail instead of phone) ----------
create or replace function public.try_reward_referral(p_referred uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.referrals; cfg public.referral_config; pr public.profiles; rr public.profiles; bk public.bookings;
  opt public.referral_reward_options; v_email text; v_confirmed timestamptz; v_total int; v_pick numeric; v_acc int := 0;
  v_coupon uuid; v_code text; v_bytes bytea;
begin
  select * into r from public.referrals where referred_id = p_referred and status = 'pending' for update;
  if not found then return; end if;
  select * into cfg from public.referral_config where id = 1;
  if not found or not cfg.is_active then return; end if;
  select * into pr from public.profiles where id = p_referred;
  if not found or pr.is_suspended or not pr.email_verified or pr.role <> 'customer' then return; end if;
  select public.normalize_email(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = p_referred;
  if coalesce(v_email, '') = '' or v_confirmed is null then return; end if;

  -- a genuinely completed service, at a shop owned by neither the referrer nor the referred person
  select b.* into bk from public.bookings b join public.businesses z on z.id = b.business_id
   where b.customer_id = p_referred and b.status = 'completed' and b.source = 'customer'
     and z.owner_id <> r.referrer_id and z.owner_id <> p_referred
   order by b.completed_at limit 1;
  if not found then return; end if;

  select * into rr from public.profiles where id = r.referrer_id;
  if not found or rr.is_suspended or rr.role <> 'customer' then
    update public.referrals set status = 'rejected', reject_reason = 'referrer_not_eligible' where id = r.id;
    return;
  end if;
  if exists (select 1 from public.referrals x where x.referred_email = v_email and x.status in ('rewarded', 'revoked')) then
    update public.referrals set status = 'rejected', reject_reason = 'duplicate_email', email_verified = true where id = r.id;
    insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
    values (null, 'referral.reject', 'referral', r.id, '{"reason":"duplicate_email"}');
    return;
  end if;

  select coalesce(sum(weight), 0) into v_total from public.referral_reward_options where is_active;
  if v_total = 0 then return; end if;
  v_bytes := extensions.gen_random_bytes(4);
  v_pick := ((get_byte(v_bytes, 0)::numeric * 16777216 + get_byte(v_bytes, 1) * 65536 + get_byte(v_bytes, 2) * 256 + get_byte(v_bytes, 3)) / 4294967296) * v_total;
  for opt in select * from public.referral_reward_options where is_active order by id loop
    v_acc := v_acc + opt.weight;
    exit when v_pick < v_acc;
  end loop;

  loop
    v_code := public.make_code('BC-', 8);
    exit when not exists (select 1 from public.coupons where code = v_code);
  end loop;

  begin
    insert into public.coupons (code, holder_id, referral_id, discount_type, discount_value, max_discount_inr, min_spend_inr, expires_at)
    values (v_code, r.referrer_id, r.id, opt.discount_type, opt.discount_value, opt.max_discount_inr, opt.min_spend_inr, now() + make_interval(days => cfg.coupon_valid_days))
    returning id into v_coupon;
    update public.referrals set status = 'rewarded', referred_email = v_email, email_verified = true, qualifying_booking_id = bk.id,
           completed_at = bk.completed_at, rewarded_at = now(), coupon_id = v_coupon where id = r.id;
  exception when unique_violation then
    update public.referrals set status = 'rejected', reject_reason = 'duplicate_email' where id = r.id;
    return;
  end;
  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
  values (null, 'referral.reward', 'referral', r.id, jsonb_build_object('coupon_id', v_coupon, 'booking_id', bk.id));
end $$;

-- ---------- 5. e-mail confirmation trigger (replaces the phone trigger) ----------
create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_verified boolean;
begin
  v_verified := (new.email_confirmed_at is not null and coalesce(new.email, '') <> '');
  update public.profiles set email_verified = v_verified where id = new.id;
  if v_verified then perform public.try_reward_referral(new.id); end if;   -- re-check a pending referral
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email, email_confirmed_at on auth.users
  for each row execute function public.sync_profile_email();

-- ---------- 6. admin_list_users without the phone column ----------
drop function if exists public.admin_list_users(text, int, int);
create function public.admin_list_users(p_search text default null, p_limit int default 30, p_offset int default 0)
returns table (id uuid, email text, full_name text, role public.user_role, is_suspended boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_pat text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  v_pat := '%' || replace(replace(replace(left(trim(coalesce(p_search, '')), 60), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, u.email::text, p.full_name, p.role, p.is_suspended, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
   where coalesce(trim(p_search), '') = '' or u.email ilike v_pat or p.full_name ilike v_pat
   order by p.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------- 7. remove every phone-OTP leftover ----------
drop trigger if exists on_auth_user_phone_changed on auth.users;
drop function if exists public.sync_profile_phone();
alter table public.referrals drop column if exists referred_phone;
alter table public.referrals drop column if exists phone_verified;
alter table public.profiles drop column if exists phone_verified;
alter table public.profiles drop column if exists phone;

-- ---------- 8. function privileges ----------
revoke execute on function public.sync_profile_email() from public, anon, authenticated;
revoke execute on function public.normalize_email(text) from public, anon, authenticated;
revoke execute on function public.admin_list_users(text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, int, int) to authenticated;
