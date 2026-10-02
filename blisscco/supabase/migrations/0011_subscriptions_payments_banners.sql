-- 0011 (Phase 8): plans, subscriptions, Razorpay payments, webhook idempotency, banners + credits,
-- blue-badge verification, entitlement function, search ranking (ELITE > PRO > FREE), daily expiry job.
-- Money is in PAISE (499 rupees = 49900). Clients can NEVER write to any table below; everything goes
-- through the functions in this file. Payment activation is done only by process_razorpay_event(),
-- which only the service_role (Vercel webhook) can execute.

-- ============ PLANS (prices live here, not in the client) ============
create table if not exists public.plans (
  code text primary key check (code ~ '^[a-z_]{3,30}$'),
  kind text not null check (kind in ('plan', 'badge', 'banner_pack')),
  name text not null,
  amount_paise integer not null check (amount_paise > 0),
  duration_days integer not null default 0 check (duration_days >= 0),
  banner_credits integer not null default 0 check (banner_credits >= 0),
  tier_rank smallint not null default 0 check (tier_rank between 0 and 2),
  features text[] not null default '{}',
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint plan_duration check (kind = 'banner_pack' or duration_days > 0)
);

-- ASSUMED mapping of your 4 prices (change here if wrong, e.g. UPDATE public.plans SET amount_paise = ... WHERE code = ...):
--   pro 499/month, elite 799/month, blue_badge 99 (365 days), banner_extra 599 (= 1 extra banner credit)
insert into public.plans (code, kind, name, amount_paise, duration_days, banner_credits, tier_rank, features, sort_order) values
  ('pro',          'plan',        'PRO',            49900, 30,  2, 1, array['analytics', 'banner', 'priority'], 1),
  ('elite',        'plan',        'ELITE',          79900, 30,  5, 2, array['analytics', 'banner', 'priority', 'top_priority'], 2),
  ('blue_badge',   'badge',       'Blue badge',      9900, 365, 0, 0, array['blue_badge'], 3),
  ('banner_extra', 'banner_pack', 'Extra banner',   59900, 0,   1, 0, array[]::text[], 4)
on conflict (code) do nothing;

-- ============ PAYMENTS ============
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references public.profiles(id),
  plan_code text not null references public.plans(code),
  amount_paise integer not null check (amount_paise > 0),     -- copied from plans at order time, never from the client
  currency text not null default 'INR' check (currency = 'INR'),
  receipt text not null unique,
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  status text not null default 'created'
    check (status in ('created', 'paid', 'amount_mismatch', 'partially_refunded', 'refunded', 'failed')),
  refunded_paise integer not null default 0 check (refunded_paise >= 0),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ptx_business_idx on public.payment_transactions (business_id, created_at desc);

create table if not exists public.payment_refunds (
  razorpay_refund_id text primary key,
  txn_id uuid not null references public.payment_transactions(id),
  amount_paise integer not null check (amount_paise > 0),
  created_at timestamptz not null default now()
);

-- Every Razorpay webhook event id can be processed exactly once (replay protection).
create table if not exists public.webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  result text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ============ SUBSCRIPTIONS ============
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  plan_code text not null references public.plans(code),
  status text not null default 'active' check (status in ('active', 'expired', 'refunded')),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  payment_transaction_id uuid not null unique references public.payment_transactions(id),  -- one payment = at most one activation
  created_at timestamptz not null default now(),
  constraint sub_window check (expires_at > starts_at)
);
create index if not exists subs_business_idx on public.subscriptions (business_id, status, expires_at);

-- ============ BANNERS ============
create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 80),
  image_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  rejection_reason text,
  starts_at timestamptz,
  ends_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint banner_path_in_folder check (image_path like business_id::text || '/%')
);
create index if not exists banners_live_idx on public.banners (status, ends_at);
create index if not exists banners_business_idx on public.banners (business_id, created_at desc);

-- Credit ledger: balance = sum(delta). Positive = granted, negative = spent / reversed.
create table if not exists public.banner_credits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('plan_grant', 'extra_purchase', 'banner_used', 'banner_refund', 'payment_refund')),
  payment_transaction_id uuid references public.payment_transactions(id),
  banner_id uuid references public.banners(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists credits_business_idx on public.banner_credits (business_id);
create unique index if not exists credits_once_per_payment on public.banner_credits (payment_transaction_id, reason) where payment_transaction_id is not null;
create unique index if not exists credits_once_per_banner on public.banner_credits (banner_id, reason) where banner_id is not null;

-- ============ BLUE BADGE VERIFICATION ============
create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  doc_type text not null check (doc_type in ('gst', 'shop_licence', 'udyam', 'other')),
  doc_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint vdoc_path_in_folder check (doc_path like business_id::text || '/%')
);
create unique index if not exists vr_one_pending on public.verification_requests (business_id) where status = 'pending';
create index if not exists vr_business_idx on public.verification_requests (business_id, created_at desc);

-- ============ ENTITLEMENTS ============
-- Always checks expiry in real time, so an expired PRO/ELITE stops counting even before the daily job runs.
create or replace function public.has_entitlement(p_business_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
      join public.plans p on p.code = s.plan_code
     where s.business_id = p_business_id and s.status = 'active'
       and s.starts_at <= now() and s.expires_at > now()
       and p_feature = any (p.features));
$$;

create or replace function public.business_tier_rank(p_business_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(max(p.tier_rank), 0)::int
    from public.subscriptions s join public.plans p on p.code = s.plan_code
   where s.business_id = p_business_id and s.status = 'active' and p.kind = 'plan'
     and s.starts_at <= now() and s.expires_at > now();
$$;

-- Public, read-only flags for approved shops (tier + blue badge). No payment data.
create or replace view public.public_business_flags with (security_invoker = false) as
select b.id as business_id, public.business_tier_rank(b.id) as tier_rank,
       public.has_entitlement(b.id, 'blue_badge') as is_verified
  from public.businesses b where b.status = 'approved';
grant select on public.public_business_flags to anon, authenticated;

-- Owner/admin dashboard summary in one call
create or replace function public.my_entitlements(p_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_plan text; v_plan_exp timestamptz; v_badge_exp timestamptz; v_credits int; v_ver text;
begin
  if not (public.owns_business(p_business_id) or public.is_admin()) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  select s.plan_code into v_plan
    from public.subscriptions s join public.plans p on p.code = s.plan_code
   where s.business_id = p_business_id and s.status = 'active' and p.kind = 'plan'
     and s.starts_at <= now() and s.expires_at > now()
   order by p.tier_rank desc, s.expires_at desc limit 1;
  if v_plan is not null then
    select max(s.expires_at) into v_plan_exp from public.subscriptions s
     where s.business_id = p_business_id and s.plan_code = v_plan and s.status = 'active';
  end if;
  select max(s.expires_at) into v_badge_exp from public.subscriptions s
   where s.business_id = p_business_id and s.plan_code = 'blue_badge' and s.status = 'active'
     and s.starts_at <= now() and s.expires_at > now();
  select coalesce(sum(delta), 0)::int into v_credits from public.banner_credits where business_id = p_business_id;
  select status into v_ver from public.verification_requests where business_id = p_business_id order by created_at desc limit 1;
  return jsonb_build_object('tier_rank', public.business_tier_rank(p_business_id), 'plan_code', v_plan,
    'plan_expires_at', v_plan_exp, 'verified', v_badge_exp is not null, 'verified_expires_at', v_badge_exp,
    'credits', v_credits, 'verification_status', v_ver);
end $$;

-- ============ PAYMENT FUNCTIONS (service_role only; called by the Vercel API routes) ============
-- Step 1 of /api/create-order. All checks + the AMOUNT come from the database.
create or replace function public.create_payment_txn(p_user_id uuid, p_business_id uuid, p_plan_code text, p_receipt text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl public.plans; v_owner uuid; v_status public.business_status; v_id uuid;
begin
  select * into pl from public.plans where code = p_plan_code and is_active;
  if not found then raise exception 'plan_not_found'; end if;
  select b.owner_id, b.status into v_owner, v_status from public.businesses b where b.id = p_business_id;
  if not found or v_owner is distinct from p_user_id then raise exception 'not_owner'; end if;
  if exists (select 1 from public.profiles where id = p_user_id and (is_suspended or role <> 'owner')) then
    raise exception 'not_owner';
  end if;
  if v_status <> 'approved' then raise exception 'business_not_approved'; end if;
  if pl.kind = 'banner_pack' and not public.has_entitlement(p_business_id, 'banner') then raise exception 'plan_required'; end if;
  if pl.kind = 'badge' and not exists (select 1 from public.verification_requests
        where business_id = p_business_id and status = 'approved') then
    raise exception 'verification_required';
  end if;
  if (select count(*) from public.payment_transactions
       where business_id = p_business_id and status = 'created' and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_orders';
  end if;
  insert into public.payment_transactions (business_id, user_id, plan_code, amount_paise, receipt)
  values (p_business_id, p_user_id, pl.code, pl.amount_paise, p_receipt) returning id into v_id;
  return jsonb_build_object('txn_id', v_id, 'amount_paise', pl.amount_paise, 'plan_name', pl.name);
end $$;

create or replace function public.attach_razorpay_order(p_txn_id uuid, p_order_id text)
returns void language sql security definer set search_path = '' as $$
  update public.payment_transactions set razorpay_order_id = p_order_id
   where id = p_txn_id and razorpay_order_id is null and status = 'created';
$$;

create or replace function public.mark_txn_failed(p_txn_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.payment_transactions set status = 'failed' where id = p_txn_id and status = 'created' and razorpay_order_id is null;
$$;

-- Step 2: the verified webhook. Runs in ONE transaction: if anything raises, the event row is rolled back too,
-- so Razorpay's retry can process it again. A repeated event id returns 'duplicate' and changes nothing.
create or replace function public.process_razorpay_event(p_event_id text, p_event_type text, p_payload jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_rows int; v_result text := 'ignored'; pay jsonb; ref jsonb;
  tx public.payment_transactions; pl public.plans; v_start timestamptz; v_total int; v_granted int;
begin
  if coalesce(p_event_id, '') = '' then raise exception 'missing_event_id'; end if;
  insert into public.webhook_events (event_id, event_type, payload) values (p_event_id, p_event_type, p_payload)
  on conflict (event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return 'duplicate'; end if;

  if p_event_type = 'payment.captured' then
    pay := p_payload #> '{payload,payment,entity}';
    select * into tx from public.payment_transactions where razorpay_order_id = pay ->> 'order_id' for update;
    if not found then
      v_result := 'unknown_order';
    elsif tx.status <> 'created' then
      v_result := 'already_processed';
    elsif (pay ->> 'amount')::int is distinct from tx.amount_paise
          or pay ->> 'currency' is distinct from 'INR' or pay ->> 'status' is distinct from 'captured' then
      update public.payment_transactions set status = 'amount_mismatch', razorpay_payment_id = pay ->> 'id' where id = tx.id;
      v_result := 'amount_mismatch';
    else
      select * into pl from public.plans where code = tx.plan_code;
      update public.payment_transactions set status = 'paid', razorpay_payment_id = pay ->> 'id', paid_at = now() where id = tx.id;
      if pl.kind in ('plan', 'badge') then
        -- renewal stacks after the current expiry of the same product
        select max(s.expires_at) into v_start from public.subscriptions s
         where s.business_id = tx.business_id and s.plan_code = pl.code and s.status = 'active' and s.expires_at > now();
        v_start := greatest(coalesce(v_start, now()), now());
        insert into public.subscriptions (business_id, plan_code, starts_at, expires_at, payment_transaction_id)
        values (tx.business_id, pl.code, v_start, v_start + make_interval(days => pl.duration_days), tx.id);
      end if;
      if pl.banner_credits > 0 then
        insert into public.banner_credits (business_id, delta, reason, payment_transaction_id)
        values (tx.business_id, pl.banner_credits, case when pl.kind = 'plan' then 'plan_grant' else 'extra_purchase' end, tx.id)
        on conflict do nothing;
      end if;
      v_result := 'activated';
    end if;

  elsif p_event_type = 'refund.processed' then
    ref := p_payload #> '{payload,refund,entity}';
    select * into tx from public.payment_transactions where razorpay_payment_id = ref ->> 'payment_id' for update;
    if not found then
      raise exception 'payment_not_ready';        -- roll back so Razorpay retries after the capture event was handled
    end if;
    insert into public.payment_refunds (razorpay_refund_id, txn_id, amount_paise)
    values (ref ->> 'id', tx.id, (ref ->> 'amount')::int) on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      v_result := 'duplicate_refund';
    else
      select coalesce(sum(amount_paise), 0)::int into v_total from public.payment_refunds where txn_id = tx.id;
      update public.payment_transactions
         set refunded_paise = v_total, status = case when v_total >= tx.amount_paise then 'refunded' else 'partially_refunded' end
       where id = tx.id;
      if v_total >= tx.amount_paise then
        update public.subscriptions set status = 'refunded' where payment_transaction_id = tx.id;
        select delta into v_granted from public.banner_credits where payment_transaction_id = tx.id and delta > 0 limit 1;
        if v_granted is not null then
          insert into public.banner_credits (business_id, delta, reason, payment_transaction_id)
          values (tx.business_id, -v_granted, 'payment_refund', tx.id) on conflict do nothing;
        end if;
        v_result := 'refunded';
      else
        v_result := 'partially_refunded';         -- entitlement stays; admin decides (see README)
      end if;
    end if;
  end if;

  update public.webhook_events set result = v_result, processed_at = now() where event_id = p_event_id;
  return v_result;
end $$;

-- ============ BANNERS ============
create or replace function public.banner_path_is_live(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.banners bn where bn.image_path = p_path and bn.status = 'approved'
                    and bn.ends_at > now());
$$;
grant execute on function public.banner_path_is_live(text) to anon, authenticated;

create or replace function public.create_banner(p_business_id uuid, p_title text, p_image_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_bal int;
begin
  if not public.owns_business(p_business_id) then raise exception 'not_owner'; end if;
  if not public.business_is_public(p_business_id) then raise exception 'business_not_approved'; end if;
  if not public.has_entitlement(p_business_id, 'banner') then raise exception 'plan_required'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 2 and 80 then raise exception 'invalid_title'; end if;
  if p_image_path is null or p_image_path not like p_business_id::text || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'banner-images' and o.name = p_image_path) then
    raise exception 'invalid_image';
  end if;
  perform pg_advisory_xact_lock(hashtext('banner_credits:' || p_business_id::text));
  select coalesce(sum(delta), 0)::int into v_bal from public.banner_credits where business_id = p_business_id;
  if v_bal < 1 then raise exception 'no_credits'; end if;
  insert into public.banners (business_id, title, image_path) values (p_business_id, trim(p_title), p_image_path) returning id into v_id;
  insert into public.banner_credits (business_id, delta, reason, banner_id) values (p_business_id, -1, 'banner_used', v_id);
  return v_id;
end $$;

create or replace function public.owner_cancel_banner(p_banner_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare bn public.banners;
begin
  select * into bn from public.banners where id = p_banner_id for update;
  if not found or not public.owns_business(bn.business_id) then raise exception 'not_found'; end if;
  if bn.status <> 'pending' then raise exception 'invalid_state'; end if;
  update public.banners set status = 'cancelled' where id = bn.id;
  insert into public.banner_credits (business_id, delta, reason, banner_id) values (bn.business_id, 1, 'banner_refund', bn.id) on conflict do nothing;
end $$;

-- Banner runs for 30 days from approval. A rejected banner returns the credit.
create or replace function public.admin_review_banner(p_banner_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare bn public.banners;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into bn from public.banners where id = p_banner_id for update;
  if not found then raise exception 'not_found'; end if;
  if bn.status <> 'pending' then raise exception 'invalid_state'; end if;
  if p_approve then
    update public.banners set status = 'approved', starts_at = now(), ends_at = now() + interval '30 days',
           reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = null where id = bn.id;
  else
    if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
    update public.banners set status = 'rejected', rejection_reason = left(trim(p_reason), 300),
           reviewed_by = auth.uid(), reviewed_at = now() where id = bn.id;
    insert into public.banner_credits (business_id, delta, reason, banner_id) values (bn.business_id, 1, 'banner_refund', bn.id) on conflict do nothing;
  end if;
  perform public.write_audit_log(case when p_approve then 'banner_approved' else 'banner_rejected' end, 'banner', bn.id,
                                 jsonb_build_object('reason', p_reason));
end $$;

-- Live banners near the visitor (5 km, same rule as search). Higher tier first. Needs an active plan at display time too.
create or replace function public.active_banners(p_lat double precision, p_lng double precision)
returns table (banner_id uuid, business_id uuid, business_name text, title text, image_path text, tier_rank int)
language sql stable security definer set search_path = '' as $$
  select bn.id, b.id, b.name, bn.title, bn.image_path, public.business_tier_rank(b.id)
    from public.banners bn
    join public.businesses b on b.id = bn.business_id
   where p_lat between -90 and 90 and p_lng between -180 and 180
     and bn.status = 'approved' and bn.ends_at > now() and bn.starts_at <= now()
     and b.status = 'approved' and b.location is not null
     and extensions.st_dwithin(b.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography, 5000)
     and public.has_entitlement(b.id, 'banner')
   order by public.business_tier_rank(b.id) desc, bn.starts_at desc
   limit 8;
$$;
grant execute on function public.active_banners(double precision, double precision) to anon, authenticated;

-- ============ VERIFICATION (blue badge) ============
create or replace function public.submit_verification(p_business_id uuid, p_doc_type text, p_doc_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.owns_business(p_business_id) then raise exception 'not_owner'; end if;
  if not public.business_is_public(p_business_id) then raise exception 'business_not_approved'; end if;
  if p_doc_type not in ('gst', 'shop_licence', 'udyam', 'other') then raise exception 'invalid_doc_type'; end if;
  if p_doc_path is null or p_doc_path not like p_business_id::text || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'verification-docs' and o.name = p_doc_path) then
    raise exception 'invalid_doc';
  end if;
  if exists (select 1 from public.verification_requests where business_id = p_business_id and status = 'pending') then
    raise exception 'already_pending';
  end if;
  insert into public.verification_requests (business_id, doc_type, doc_path) values (p_business_id, p_doc_type, p_doc_path) returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_review_verification(p_request_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare vr public.verification_requests;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into vr from public.verification_requests where id = p_request_id for update;
  if not found then raise exception 'not_found'; end if;
  if vr.status <> 'pending' then raise exception 'invalid_state'; end if;
  if not p_approve and char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  update public.verification_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         rejection_reason = case when p_approve then null else left(trim(p_reason), 300) end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = vr.id;
  perform public.write_audit_log(case when p_approve then 'verification_approved' else 'verification_rejected' end,
                                 'verification_request', vr.id, jsonb_build_object('business_id', vr.business_id, 'reason', p_reason));
end $$;

-- ============ DAILY EXPIRY (pg_cron) ============
create or replace function public.expire_subscriptions()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a int; b int;
begin
  update public.subscriptions set status = 'expired' where status = 'active' and expires_at <= now();
  get diagnostics a = row_count;
  update public.banners set status = 'expired' where status = 'approved' and ends_at <= now();
  get diagnostics b = row_count;
  return jsonb_build_object('subscriptions_expired', a, 'banners_expired', b);
end $$;

do $$ begin
  create extension if not exists pg_cron;
  -- 18:30 UTC = 00:00 India time, every day (same job name = updated, not duplicated)
  perform cron.schedule('blisscco-expire-subscriptions', '30 18 * * *', 'select public.expire_subscriptions()');
exception when others then
  raise notice 'pg_cron schedule skipped (%): enable pg_cron in Dashboard > Database > Extensions, then re-run this file.', sqlerrm;
end $$;

-- ============ SEARCH RANKING: ELITE > PRO > FREE (then the user's chosen sort) ============
drop function if exists public.nearby_businesses(double precision, double precision, uuid, numeric, boolean, text, int, int);
drop function if exists public.search_services(double precision, double precision, text, uuid, numeric, boolean, text, int, int);

create or replace function public.nearby_businesses(
  p_lat double precision, p_lng double precision,
  p_category uuid default null, p_max_price numeric default null,
  p_open_now boolean default false, p_sort text default 'distance',
  p_limit int default 20, p_offset int default 0)
returns table (business_id uuid, name text, category_id uuid, category_name_en text, category_name_hi text,
               category_name_mr text, city text, address_line text, distance_m double precision,
               min_price numeric, service_count int, cover_path text, is_open_now boolean,
               tier_rank int, is_verified boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_point extensions.geography;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid location' using errcode = '22023';
  end if;
  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  return query
  select x.id, x.name, x.category_id, x.name_en, x.name_hi, x.name_mr, x.city, x.address_line,
         x.distance_m, x.min_price, x.service_count, x.cover_path, x.is_open_now, x.tier_rank, x.is_verified
    from (
      select b.id, b.name, b.category_id, c.name_en, c.name_hi, c.name_mr, b.city, b.address_line,
             extensions.st_distance(b.location, v_point) as distance_m,
             (select min(s.price_inr) from public.services s where s.business_id = b.id and s.is_active) as min_price,
             (select count(*)::int from public.services s where s.business_id = b.id and s.is_active) as service_count,
             (select i.storage_path from public.business_images i where i.business_id = b.id
               order by i.sort_order, i.created_at limit 1) as cover_path,
             public.business_open_now(b.id) as is_open_now,
             public.business_tier_rank(b.id) as tier_rank,
             public.has_entitlement(b.id, 'blue_badge') as is_verified
        from public.businesses b
        join public.business_categories c on c.id = b.category_id
       where b.status = 'approved' and b.location is not null
         and extensions.st_dwithin(b.location, v_point, 5000)
         and (p_category is null or b.category_id = p_category)
    ) x
   where x.service_count > 0
     and (p_max_price is null or x.min_price <= p_max_price)
     and (not coalesce(p_open_now, false) or x.is_open_now)
   order by x.tier_rank desc,
            case when p_sort = 'price' then x.min_price end asc nulls last, x.distance_m asc, x.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.search_services(
  p_lat double precision, p_lng double precision, p_query text,
  p_category uuid default null, p_max_price numeric default null,
  p_open_now boolean default false, p_sort text default 'distance',
  p_limit int default 20, p_offset int default 0)
returns table (service_id uuid, service_label text, price_inr numeric, business_id uuid, business_name text,
               category_id uuid, category_name_en text, category_name_hi text, category_name_mr text,
               city text, distance_m double precision, cover_path text, is_open_now boolean,
               tier_rank int, is_verified boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_point extensions.geography; v_q text; v_pattern text;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid location' using errcode = '22023';
  end if;
  v_q := left(trim(coalesce(p_query, '')), 60);
  if v_q = '' then raise exception 'query required' using errcode = '22023'; end if;
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  return query
  select x.service_id, x.service_label, x.price_inr, x.business_id, x.business_name, x.category_id,
         x.name_en, x.name_hi, x.name_mr, x.city, x.distance_m, x.cover_path, x.is_open_now, x.tier_rank, x.is_verified
    from (
      select s.id as service_id, coalesce(s.name, s.service_category) as service_label, s.price_inr,
             b.id as business_id, b.name as business_name, b.category_id, c.name_en, c.name_hi, c.name_mr, b.city,
             extensions.st_distance(b.location, v_point) as distance_m,
             (select i.storage_path from public.business_images i where i.business_id = b.id
               order by i.sort_order, i.created_at limit 1) as cover_path,
             public.business_open_now(b.id) as is_open_now,
             public.business_tier_rank(b.id) as tier_rank,
             public.has_entitlement(b.id, 'blue_badge') as is_verified
        from public.services s
        join public.businesses b on b.id = s.business_id
        join public.business_categories c on c.id = b.category_id
       where s.is_active and b.status = 'approved' and b.location is not null
         and extensions.st_dwithin(b.location, v_point, 5000)
         and (p_category is null or b.category_id = p_category)
         and (s.service_category ilike v_pattern or s.name ilike v_pattern or b.name ilike v_pattern
              or c.name_en ilike v_pattern or c.name_hi ilike v_pattern or c.name_mr ilike v_pattern)
    ) x
   where (p_max_price is null or x.price_inr <= p_max_price)
     and (not coalesce(p_open_now, false) or x.is_open_now)
   order by x.tier_rank desc,
            case when p_sort = 'distance' then x.distance_m end asc nulls last,
            x.price_inr asc, x.distance_m asc, x.service_id
   limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ============ STORAGE: banner-images (private, signed URLs) and verification-docs (private, owner + admin only) ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banner-images', 'banner-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-docs', 'verification-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

drop policy if exists "banner_select" on storage.objects;
drop policy if exists "banner_insert" on storage.objects;
drop policy if exists "banner_delete" on storage.objects;
drop policy if exists "vdoc_select" on storage.objects;
drop policy if exists "vdoc_insert" on storage.objects;
drop policy if exists "vdoc_delete" on storage.objects;

create policy "banner_select" on storage.objects for select to anon, authenticated
using (bucket_id = 'banner-images' and (
  public.banner_path_is_live(name)
  or public.owns_business(public.safe_uuid((storage.foldername(name))[1]))
  or public.is_admin()));

create policy "banner_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'banner-images'
  and array_length(storage.foldername(name), 1) = 1
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  and public.owns_business(public.safe_uuid((storage.foldername(name))[1])));

create policy "banner_delete" on storage.objects for delete to authenticated
using (bucket_id = 'banner-images' and (
  public.is_admin()
  or (public.owns_business(public.safe_uuid((storage.foldername(name))[1]))
      and not exists (select 1 from public.banners x where x.image_path = name))));

create policy "vdoc_select" on storage.objects for select to authenticated
using (bucket_id = 'verification-docs' and (
  public.owns_business(public.safe_uuid((storage.foldername(name))[1])) or public.is_admin()));

create policy "vdoc_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'verification-docs'
  and array_length(storage.foldername(name), 1) = 1
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp', 'pdf')
  and public.owns_business(public.safe_uuid((storage.foldername(name))[1])));

create policy "vdoc_delete" on storage.objects for delete to authenticated
using (bucket_id = 'verification-docs' and public.is_admin());

-- ============ RLS + GRANTS (read-only for clients; owners see their own, admin sees all) ============
alter table public.plans enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.webhook_events enable row level security;
alter table public.subscriptions enable row level security;
alter table public.banners enable row level security;
alter table public.banner_credits enable row level security;
alter table public.verification_requests enable row level security;

drop policy if exists plans_select on public.plans;
drop policy if exists ptx_select on public.payment_transactions;
drop policy if exists refunds_select on public.payment_refunds;
drop policy if exists webhook_select on public.webhook_events;
drop policy if exists subs_select on public.subscriptions;
drop policy if exists banners_select on public.banners;
drop policy if exists credits_select on public.banner_credits;
drop policy if exists vr_select on public.verification_requests;

create policy plans_select on public.plans for select to anon, authenticated using (is_active or public.is_admin());
create policy ptx_select on public.payment_transactions for select to authenticated using (public.owns_business(business_id) or public.is_admin());
create policy refunds_select on public.payment_refunds for select to authenticated using (public.is_admin());
create policy webhook_select on public.webhook_events for select to authenticated using (public.is_admin());
create policy subs_select on public.subscriptions for select to authenticated using (public.owns_business(business_id) or public.is_admin());
create policy banners_select on public.banners for select to authenticated using (public.owns_business(business_id) or public.is_admin());
create policy credits_select on public.banner_credits for select to authenticated using (public.owns_business(business_id) or public.is_admin());
create policy vr_select on public.verification_requests for select to authenticated using (public.owns_business(business_id) or public.is_admin());

revoke all on public.plans, public.payment_transactions, public.payment_refunds, public.webhook_events, public.subscriptions,
  public.banners, public.banner_credits, public.verification_requests from anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.payment_transactions, public.payment_refunds, public.webhook_events, public.subscriptions,
  public.banners, public.banner_credits, public.verification_requests to authenticated;

-- ============ FUNCTION PRIVILEGES ============
revoke execute on function
  public.has_entitlement(uuid, text), public.business_tier_rank(uuid), public.my_entitlements(uuid),
  public.create_payment_txn(uuid, uuid, text, text), public.attach_razorpay_order(uuid, text), public.mark_txn_failed(uuid),
  public.process_razorpay_event(text, text, jsonb), public.create_banner(uuid, text, text), public.owner_cancel_banner(uuid),
  public.admin_review_banner(uuid, boolean, text), public.submit_verification(uuid, text, text),
  public.admin_review_verification(uuid, boolean, text), public.expire_subscriptions(),
  public.nearby_businesses(double precision, double precision, uuid, numeric, boolean, text, int, int),
  public.search_services(double precision, double precision, text, uuid, numeric, boolean, text, int, int)
  from public, anon, authenticated;

-- public (read-only, no secrets)
grant execute on function public.has_entitlement(uuid, text),
  public.nearby_businesses(double precision, double precision, uuid, numeric, boolean, text, int, int),
  public.search_services(double precision, double precision, text, uuid, numeric, boolean, text, int, int)
  to anon, authenticated;
-- signed-in owners / admin (each function re-checks ownership or admin itself)
grant execute on function public.my_entitlements(uuid), public.create_banner(uuid, text, text), public.owner_cancel_banner(uuid),
  public.admin_review_banner(uuid, boolean, text), public.submit_verification(uuid, text, text),
  public.admin_review_verification(uuid, boolean, text) to authenticated;
-- Vercel API routes only (service_role key). Never callable from the browser.
grant execute on function public.create_payment_txn(uuid, uuid, text, text), public.attach_razorpay_order(uuid, text),
  public.mark_txn_failed(uuid), public.process_razorpay_event(text, text, jsonb) to service_role;
