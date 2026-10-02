-- 0010: reviews, refer & earn, business-funded coupons. ALL writes go through the functions below.
alter table public.business_booking_settings add column if not exists accept_coupons boolean not null default true;
grant update (accept_coupons) on public.business_booking_settings to authenticated;

-- ============ REVIEWS ============
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete cascade,
  business_name text not null,
  customer_id uuid references public.profiles(id) on delete set null,
  reviewer_name text,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  status text not null default 'published' check (status in ('published', 'removed')),
  owner_response text check (char_length(owner_response) <= 500),
  owner_response_at timestamptz,
  removed_reason text,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reviews_business_idx on public.reviews (business_id, created_at desc) where status = 'published';

create table if not exists public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id),
  reason text not null check (char_length(reason) between 3 and 300),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (review_id, reporter_id)
);

create or replace view public.public_business_ratings with (security_invoker = false) as
select r.business_id, round(avg(r.rating)::numeric, 1) as avg_rating, count(*)::int as review_count
  from public.reviews r join public.businesses b on b.id = r.business_id
 where r.status = 'published' and b.status = 'approved'
 group by r.business_id;
grant select on public.public_business_ratings to anon, authenticated;

-- ============ REFERRALS & COUPONS ============
create table if not exists public.referral_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_config (
  id int primary key check (id = 1),
  is_active boolean not null default false,          -- OFF until admin configures rewards
  coupon_valid_days int not null default 30 check (coupon_valid_days between 1 and 365),
  updated_at timestamptz not null default now()
);
insert into public.referral_config (id) values (1) on conflict do nothing;

create table if not exists public.referral_reward_options (
  id uuid primary key default gen_random_uuid(),
  discount_type text not null check (discount_type in ('percent', 'flat')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  max_discount_inr numeric(10, 2) check (max_discount_inr > 0),
  min_spend_inr numeric(10, 2) not null default 0 check (min_spend_inr >= 0),
  weight int not null default 1 check (weight between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint option_valid check ((discount_type = 'percent' and discount_value <= 100 and max_discount_inr is not null) or discount_type = 'flat')
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id),
  referred_id uuid unique references public.profiles(id) on delete set null,   -- one attribution per person, never changeable
  code text not null,
  status text not null default 'pending' check (status in ('pending', 'rewarded', 'rejected', 'revoked')),
  referred_phone text,
  phone_verified boolean not null default false,
  qualifying_booking_id uuid references public.bookings(id),
  completed_at timestamptz,
  rewarded_at timestamptz,
  coupon_id uuid,
  reject_reason text,
  revoked_reason text,
  created_at timestamptz not null default now(),
  constraint no_self_referral check (referred_id is distinct from referrer_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);
-- one reward per verified phone number (revoked rewards still burn the number)
create unique index if not exists referrals_phone_once on public.referrals (referred_phone) where status in ('rewarded', 'revoked');

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  holder_id uuid not null references public.profiles(id),
  source text not null default 'referral',
  referral_id uuid references public.referrals(id),
  discount_type text not null check (discount_type in ('percent', 'flat')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  max_discount_inr numeric(10, 2),
  min_spend_inr numeric(10, 2) not null default 0,
  business_id uuid references public.businesses(id),          -- null = valid at any participating shop
  status text not null default 'active' check (status in ('active', 'redeemed', 'revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint coupon_cap check (discount_type = 'flat' or max_discount_inr is not null)
);
create index if not exists coupons_holder_idx on public.coupons (holder_id, created_at desc);
alter table public.referrals drop constraint if exists referrals_coupon_fk;
alter table public.referrals add constraint referrals_coupon_fk foreign key (coupon_id) references public.coupons(id);

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null unique references public.coupons(id),
  business_id uuid not null references public.businesses(id),
  booking_id uuid not null unique references public.bookings(id),
  discount_applied_inr numeric(10, 2) not null check (discount_applied_inr >= 0),
  redeemed_by uuid references public.profiles(id),
  redeemed_at timestamptz not null default now()
);

-- ============ INTERNAL HELPERS ============
create or replace function public.make_code(p_prefix text, p_len int) returns text
language plpgsql volatile set search_path = '' as $$
declare alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; b bytea := extensions.gen_random_bytes(p_len); o text := ''; i int;
begin
  for i in 0 .. p_len - 1 loop o := o || substr(alphabet, (get_byte(b, i) % 31) + 1, 1); end loop;
  return p_prefix || o;
end $$;

create or replace function public.try_reward_referral(p_referred uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.referrals; cfg public.referral_config; pr public.profiles; rr public.profiles; bk public.bookings;
  opt public.referral_reward_options; v_phone text; v_total int; v_pick numeric; v_acc int := 0;
  v_coupon uuid; v_code text; v_bytes bytea;
begin
  select * into r from public.referrals where referred_id = p_referred and status = 'pending' for update;
  if not found then return; end if;
  select * into cfg from public.referral_config where id = 1;
  if not found or not cfg.is_active then return; end if;
  select * into pr from public.profiles where id = p_referred;
  if not found or pr.is_suspended or not pr.phone_verified or pr.role <> 'customer' then return; end if;
  select u.phone into v_phone from auth.users u where u.id = p_referred;
  if coalesce(v_phone, '') = '' then return; end if;

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
  if exists (select 1 from public.referrals x where x.referred_phone = v_phone and x.status in ('rewarded', 'revoked')) then
    update public.referrals set status = 'rejected', reject_reason = 'duplicate_phone', referred_phone = v_phone, phone_verified = true where id = r.id;
    insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
    values (null, 'referral.reject', 'referral', r.id, '{"reason":"duplicate_phone"}');
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
    update public.referrals set status = 'rewarded', referred_phone = v_phone, phone_verified = true, qualifying_booking_id = bk.id,
           completed_at = bk.completed_at, rewarded_at = now(), coupon_id = v_coupon where id = r.id;
  exception when unique_violation then
    update public.referrals set status = 'rejected', reject_reason = 'duplicate_phone' where id = r.id;
    return;
  end;
  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
  values (null, 'referral.reward', 'referral', r.id, jsonb_build_object('coupon_id', v_coupon, 'booking_id', bk.id));
end $$;

-- Phone verification status still comes ONLY from Supabase Auth. When it turns true, re-check any pending referral.
create or replace function public.sync_profile_phone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_verified boolean;
begin
  v_verified := (new.phone_confirmed_at is not null and coalesce(new.phone, '') <> '');
  update public.profiles set phone = nullif(new.phone, ''), phone_verified = v_verified where id = new.id;
  if v_verified then perform public.try_reward_referral(new.id); end if;
  return new;
end $$;

-- Re-defined from 0009: after a booking is completed, check referral eligibility (trusted workflow only)
create or replace function public.set_booking_status(p_booking_id uuid, p_new public.booking_status)
returns void language plpgsql security definer set search_path = '' as $$
declare bk public.bookings; v_owner boolean; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_owner := public.owns_business(bk.business_id);
  if not (v_owner or bk.customer_id = auth.uid()) then raise exception 'not_found' using errcode = 'P0002'; end if;

  if v_owner then
    v_ok := case bk.status
      when 'pending' then p_new in ('confirmed', 'cancelled')
      when 'confirmed' then p_new in ('checked_in', 'in_service', 'cancelled', 'no_show')
      when 'checked_in' then p_new in ('in_service', 'cancelled', 'no_show')
      when 'in_service' then p_new = 'completed'
      else false end;
    if v_ok and p_new = 'no_show' and bk.type = 'appointment' and bk.start_at > now() then v_ok := false; end if;
  else
    v_ok := bk.status in ('pending', 'confirmed', 'checked_in') and p_new = 'cancelled';
  end if;
  if not v_ok then raise exception 'invalid_transition'; end if;

  update public.bookings set status = p_new,
         checked_in_at = case when p_new = 'checked_in' then now() else checked_in_at end,
         started_at = case when p_new = 'in_service' then now() else started_at end,
         completed_at = case when p_new = 'completed' then now() else completed_at end,
         cancelled_at = case when p_new = 'cancelled' then now() else cancelled_at end,
         cancelled_by = case when p_new = 'cancelled' then (case when v_owner then 'owner' else 'customer' end) else cancelled_by end
   where id = bk.id;
  insert into public.booking_status_history (booking_id, from_status, to_status, actor_id) values (bk.id, bk.status, p_new, auth.uid());
  if bk.type = 'walkin' then update public.business_booking_settings set queue_updated_at = now() where business_id = bk.business_id; end if;
  if p_new = 'completed' and bk.customer_id is not null then perform public.try_reward_referral(bk.customer_id); end if;
end $$;

-- ============ REVIEW FUNCTIONS ============
create or replace function public.submit_review(p_booking_id uuid, p_rating int, p_comment text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare bk public.bookings; v_name text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id;
  if not found or bk.customer_id is distinct from auth.uid() then raise exception 'not_found' using errcode = 'P0002'; end if;
  if bk.status <> 'completed' then raise exception 'not_completed'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_suspended) then raise exception 'not_found'; end if;
  select nullif(left(split_part(trim(coalesce(full_name, '')), ' ', 1), 30), '') into v_name from public.profiles where id = auth.uid();
  begin
    insert into public.reviews (booking_id, business_id, business_name, customer_id, reviewer_name, rating, comment)
    values (bk.id, bk.business_id, bk.business_name, auth.uid(), v_name, p_rating, nullif(left(trim(coalesce(p_comment, '')), 1000), ''))
    returning id into v_id;
  exception when unique_violation then raise exception 'already_reviewed';
  end;
  return v_id;
end $$;

create or replace function public.owner_respond_review(p_review_id uuid, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare rv public.reviews; v_text text := nullif(left(trim(coalesce(p_response, '')), 500), '');
begin
  select * into rv from public.reviews where id = p_review_id;
  if not found or not public.owns_business(rv.business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.reviews set owner_response = v_text, owner_response_at = case when v_text is null then null else now() end where id = rv.id;
end $$;

create or replace function public.report_review(p_review_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare rv public.reviews;
begin
  select * into rv from public.reviews where id = p_review_id;
  if not found or not public.owns_business(rv.business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  insert into public.review_reports (review_id, reporter_id, reason) values (rv.id, auth.uid(), left(trim(p_reason), 300)) on conflict do nothing;
end $$;

create or replace function public.admin_remove_review(p_review_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  update public.reviews set status = 'removed', removed_reason = left(trim(p_reason), 300), removed_at = now() where id = p_review_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.write_audit_log('review.remove', 'review', p_review_id, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.admin_resolve_report(p_report_id uuid, p_remove boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare rp public.review_reports;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into rp from public.review_reports where id = p_report_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_remove then perform public.admin_remove_review(rp.review_id, coalesce(p_reason, rp.reason)); end if;
  update public.review_reports set status = case when p_remove then 'resolved' else 'dismissed' end where id = rp.id;
  perform public.write_audit_log('review_report.' || case when p_remove then 'resolve' else 'dismiss' end, 'review_report', rp.id, '{}');
end $$;

-- ============ REFERRAL FUNCTIONS ============
create or replace function public.referral_campaign_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.is_active from public.referral_config c where c.id = 1), false)
     and exists (select 1 from public.referral_reward_options where is_active);
$$;

create or replace function public.get_my_referral_code() returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'customer' and not is_suspended) then
    raise exception 'not_available' using errcode = '42501'; end if;
  loop
    v_code := public.make_code('', 8);
    begin
      insert into public.referral_codes (user_id, code) values (auth.uid(), v_code) on conflict (user_id) do nothing;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  select code into v_code from public.referral_codes where user_id = auth.uid();
  return v_code;
end $$;

create or replace function public.my_referral_stats() returns table (pending int, rewarded int)
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where status = 'pending')::int, count(*) filter (where status = 'rewarded')::int
    from public.referrals where referrer_id = auth.uid();
$$;

-- Called once by a NEW customer who arrived through a link. Cannot be changed afterwards.
create or replace function public.claim_referral(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v_ref uuid; v_code text := upper(trim(coalesce(p_code, '')));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or me.role <> 'customer' or me.is_suspended or me.created_at < now() - interval '7 days' then return false; end if;
  if exists (select 1 from public.referrals where referred_id = me.id) or exists (select 1 from public.bookings where customer_id = me.id) then return false; end if;
  select user_id into v_ref from public.referral_codes where code = v_code;
  if v_ref is null or v_ref = me.id then return false; end if;
  insert into public.referrals (referrer_id, referred_id, code) values (v_ref, me.id, v_code);
  return true;
exception when unique_violation then return false;
end $$;

-- ============ COUPON FUNCTIONS (owner side) ============
create or replace function public.check_coupon(p_code text, p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.coupons; acc boolean; v_reason text;
begin
  if not public.owns_business(p_business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.coupons where code = upper(trim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  select accept_coupons into acc from public.business_booking_settings where business_id = p_business_id;
  v_reason := case when c.status = 'redeemed' then 'redeemed' when c.status = 'revoked' then 'revoked' when c.expires_at <= now() then 'expired'
                   when not coalesce(acc, false) then 'not_accepting' when c.business_id is not null and c.business_id <> p_business_id then 'wrong_business' end;
  return jsonb_build_object('valid', v_reason is null, 'reason', v_reason, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
                            'max_discount_inr', c.max_discount_inr, 'min_spend_inr', c.min_spend_inr, 'expires_at', c.expires_at);
end $$;

create or replace function public.coupon_eligible_bookings(p_code text, p_business_id uuid)
returns table (booking_id uuid, service_label text, price_inr numeric, completed_at timestamptz, customer_name text)
language plpgsql stable security definer set search_path = '' as $$
declare c public.coupons;
begin
  if not public.owns_business(p_business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.coupons where code = upper(trim(coalesce(p_code, ''))) and status = 'active' and expires_at > now();
  if not found then return; end if;
  return query
  select b.id, b.service_label, b.price_inr, b.completed_at, b.customer_name
    from public.bookings b
   where b.business_id = p_business_id and b.customer_id = c.holder_id and b.status = 'completed'
     and b.completed_at > now() - interval '7 days'
     and not exists (select 1 from public.coupon_redemptions r where r.booking_id = b.id)
   order by b.completed_at desc;
end $$;

create or replace function public.redeem_coupon(p_code text, p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.coupons; bk public.bookings; acc boolean; v_disc numeric;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id;
  if not found or not public.owns_business(bk.business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.coupons where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'coupon_not_found'; end if;
  if c.status = 'redeemed' then raise exception 'redeemed'; end if;
  if c.status = 'revoked' then raise exception 'revoked'; end if;
  if c.expires_at <= now() then raise exception 'expired'; end if;
  select accept_coupons into acc from public.business_booking_settings where business_id = bk.business_id;
  if not coalesce(acc, false) then raise exception 'not_accepting'; end if;
  if c.business_id is not null and c.business_id <> bk.business_id then raise exception 'wrong_business'; end if;
  if bk.status <> 'completed' or bk.customer_id is distinct from c.holder_id or bk.completed_at < now() - interval '7 days' then raise exception 'booking_mismatch'; end if;
  if bk.price_inr < c.min_spend_inr then raise exception 'min_spend'; end if;

  v_disc := case when c.discount_type = 'percent' then least(bk.price_inr * c.discount_value / 100, coalesce(c.max_discount_inr, bk.price_inr))
                 else least(c.discount_value, bk.price_inr) end;
  v_disc := round(v_disc, 2);
  begin
    insert into public.coupon_redemptions (coupon_id, business_id, booking_id, discount_applied_inr, redeemed_by) values (c.id, bk.business_id, bk.id, v_disc, auth.uid());
  exception when unique_violation then raise exception 'redeemed';
  end;
  update public.coupons set status = 'redeemed' where id = c.id;
  return jsonb_build_object('discount', v_disc);
end $$;

-- ============ ADMIN: referral campaign ============
create or replace function public.admin_save_referral_config(p_active boolean, p_valid_days int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_valid_days is null or p_valid_days not between 1 and 365 then raise exception 'invalid_value' using errcode = '22023'; end if;
  if p_active and not exists (select 1 from public.referral_reward_options where is_active) then raise exception 'no_options'; end if;
  update public.referral_config set is_active = coalesce(p_active, false), coupon_valid_days = p_valid_days, updated_at = now() where id = 1;
  perform public.write_audit_log('referral.config', 'referral_config', null, jsonb_build_object('active', p_active, 'valid_days', p_valid_days));
end $$;

create or replace function public.admin_add_reward_option(p_type text, p_value numeric, p_max numeric, p_min_spend numeric, p_weight int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  insert into public.referral_reward_options (discount_type, discount_value, max_discount_inr, min_spend_inr, weight)
  values (p_type, p_value, p_max, coalesce(p_min_spend, 0), coalesce(p_weight, 1)) returning id into v_id;   -- table checks validate the values
  perform public.write_audit_log('referral.option_add', 'referral_option', v_id, jsonb_build_object('type', p_type, 'value', p_value, 'max', p_max, 'min_spend', p_min_spend, 'weight', p_weight));
  return v_id;
end $$;

create or replace function public.admin_toggle_reward_option(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.referral_reward_options set is_active = p_active where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.write_audit_log('referral.option_toggle', 'referral_option', p_id, jsonb_build_object('active', p_active));
end $$;

create or replace function public.admin_revoke_referral(p_referral_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.referrals;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  select * into r from public.referrals where id = p_referral_id for update;
  if not found or r.status <> 'rewarded' then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.referrals set status = 'revoked', revoked_reason = left(trim(p_reason), 300) where id = r.id;
  update public.coupons set status = 'revoked' where id = r.coupon_id and status = 'active';
  perform public.write_audit_log('referral.revoke', 'referral', r.id, jsonb_build_object('reason', p_reason));
end $$;

-- ============ RLS ============
alter table public.reviews enable row level security;
alter table public.review_reports enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referral_config enable row level security;
alter table public.referral_reward_options enable row level security;
alter table public.referrals enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select to anon, authenticated using (
  (status = 'published' and public.business_is_public(business_id)) or customer_id = auth.uid() or public.owns_business(business_id) or public.is_admin());
drop policy if exists reports_select on public.review_reports;
create policy reports_select on public.review_reports for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
drop policy if exists rcodes_select on public.referral_codes;
create policy rcodes_select on public.referral_codes for select to authenticated using (user_id = auth.uid());
drop policy if exists rconfig_select on public.referral_config;
create policy rconfig_select on public.referral_config for select to authenticated using (public.is_admin());
drop policy if exists ropts_select on public.referral_reward_options;
create policy ropts_select on public.referral_reward_options for select to authenticated using (public.is_admin());
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals for select to authenticated using (public.is_admin());
drop policy if exists coupons_select on public.coupons;
create policy coupons_select on public.coupons for select to authenticated using (holder_id = auth.uid() or public.is_admin());
drop policy if exists redemptions_select on public.coupon_redemptions;
create policy redemptions_select on public.coupon_redemptions for select to authenticated using (public.owns_business(business_id) or public.is_admin());

revoke all on public.reviews, public.review_reports, public.referral_codes, public.referral_config, public.referral_reward_options,
  public.referrals, public.coupons, public.coupon_redemptions from anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant select on public.review_reports, public.referral_codes, public.referral_config, public.referral_reward_options,
  public.referrals, public.coupons, public.coupon_redemptions to authenticated;

-- ============ FUNCTION PRIVILEGES ============
revoke execute on function public.make_code(text, int), public.try_reward_referral(uuid) from public, anon, authenticated;
revoke execute on function public.submit_review(uuid, int, text), public.owner_respond_review(uuid, text), public.report_review(uuid, text),
  public.admin_remove_review(uuid, text), public.admin_resolve_report(uuid, boolean, text), public.referral_campaign_active(),
  public.get_my_referral_code(), public.my_referral_stats(), public.claim_referral(text), public.check_coupon(text, uuid),
  public.coupon_eligible_bookings(text, uuid), public.redeem_coupon(text, uuid), public.admin_save_referral_config(boolean, int),
  public.admin_add_reward_option(text, numeric, numeric, numeric, int), public.admin_toggle_reward_option(uuid, boolean),
  public.admin_revoke_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.referral_campaign_active() to anon, authenticated;
grant execute on function public.submit_review(uuid, int, text), public.owner_respond_review(uuid, text), public.report_review(uuid, text),
  public.admin_remove_review(uuid, text), public.admin_resolve_report(uuid, boolean, text), public.get_my_referral_code(),
  public.my_referral_stats(), public.claim_referral(text), public.check_coupon(text, uuid), public.coupon_eligible_bookings(text, uuid),
  public.redeem_coupon(text, uuid), public.admin_save_referral_config(boolean, int),
  public.admin_add_reward_option(text, numeric, numeric, numeric, int), public.admin_toggle_reward_option(uuid, boolean),
  public.admin_revoke_referral(uuid, text) to authenticated;
