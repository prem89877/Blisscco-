-- 0038: Mega Store Customer Reward Cycle. Re-runnable. Run AFTER 0037, BEFORE deploying the new frontend.
--
-- WHAT IT ADDS (nothing existing is altered; only NEW tables / functions / 1 NEW trigger on bookings):
--   * Mega Store = a new business type. It is owned by an account with the existing 'owner' role (no enum / role change),
--     needs admin approval, and runs ONE campaign at a time with a selected set of partner shops.
--   * Female customers scan the Mega Store campaign QR  (/mega/<store code>), log in / sign up and join the campaign.
--   * A customer's COMPLETED service (booked by the customer AFTER joining) at a partner shop issues ONE shopping reward
--     (percent or flat discount) for the Mega Store. Maximum 5 rewards per customer account per campaign.
--   * Every reward expires exactly ONE MONTH after it was issued (issued_at + interval '1 month').
--   * The customer shows the reward QR / code at the Mega Store; the Mega Store owner redeems it (bill amount -> discount).
--
-- FINANCIAL RULE: the Mega Store funds 100% of the shopping discount. Blisscco NEVER pays or reimburses it.
--   * mega_rewards.funded_by is fixed to 'mega_store' by a CHECK constraint.
--   * No function in this file writes to growth_credit_ledger, promo_balance_grants, payment tables, coupons or any other
--     Blisscco-funded balance. The discount is only recorded on mega_rewards (discount_given_inr) for the Mega Store's own reports.
--
-- SAFETY: the reward trigger swallows every error, so completing a booking can NEVER fail because of this feature.

-- ============ 1. TABLES ============
create table if not exists public.mega_stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,      -- one Mega Store per owner account
  name text not null check (char_length(trim(name)) between 2 and 80),
  description text check (char_length(description) <= 500),
  phone text check (phone is null or char_length(phone) <= 20),
  address_line text check (address_line is null or char_length(address_line) <= 200),
  city text check (city is null or char_length(city) <= 80),
  code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),   -- goes into the campaign QR link
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'suspended')),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists mega_stores_updated_at on public.mega_stores;
create trigger mega_stores_updated_at before update on public.mega_stores
  for each row execute function public.set_updated_at();

create table if not exists public.mega_campaigns (
  id uuid primary key default gen_random_uuid(),
  mega_store_id uuid not null references public.mega_stores(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 100),
  description text check (char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reward_type text not null check (reward_type in ('percent', 'flat')),
  reward_value numeric(10, 2) not null check (reward_value > 0),
  max_discount_inr numeric(10, 2) check (max_discount_inr is null or max_discount_inr > 0),     -- cap, percent rewards only
  min_purchase_inr numeric(10, 2) not null default 0 check (min_purchase_inr >= 0),             -- minimum bill at the Mega Store
  min_service_price_inr numeric(10, 2) not null default 0 check (min_service_price_inr >= 0),   -- minimum price of the partner-shop service
  max_rewards_per_customer int not null default 5 check (max_rewards_per_customer between 1 and 5),
  one_reward_per_shop boolean not null default true,                                            -- 5 rewards = 5 different partner shops
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mega_campaign_dates check (ends_at > starts_at),
  constraint mega_campaign_percent_ok check (reward_type <> 'percent' or reward_value <= 100),
  constraint mega_campaign_cap_ok check (reward_type = 'percent' or max_discount_inr is null)
);
-- a Mega Store has at most ONE unfinished campaign (draft / active / paused) at a time
create unique index if not exists mega_campaigns_one_open on public.mega_campaigns (mega_store_id)
  where status in ('draft', 'active', 'paused');
drop trigger if exists mega_campaigns_updated_at on public.mega_campaigns;
create trigger mega_campaigns_updated_at before update on public.mega_campaigns
  for each row execute function public.set_updated_at();

-- the partner shops the Mega Store selected for a campaign
create table if not exists public.mega_campaign_shops (
  campaign_id uuid not null references public.mega_campaigns(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (campaign_id, business_id)
);
create index if not exists mega_campaign_shops_business_idx on public.mega_campaign_shops (business_id);

-- a customer joining a campaign (through the QR)
create table if not exists public.mega_enrollments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.mega_campaigns(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  declared_female boolean not null check (declared_female),       -- the campaign is for women: self-declaration (cannot be verified by the app)
  enrolled_at timestamptz not null default now(),
  unique (campaign_id, customer_id)
);
create index if not exists mega_enrollments_customer_idx on public.mega_enrollments (customer_id);

-- the shopping reward. Terms are copied (snapshot) so later campaign changes never alter an issued reward.
create table if not exists public.mega_rewards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.mega_campaigns(id) on delete cascade,
  mega_store_id uuid not null references public.mega_stores(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete restrict,   -- ONE reward per verified service
  business_id uuid not null references public.businesses(id) on delete restrict,
  business_name text not null,
  code text not null unique,                                     -- shown as text + QR; redeemed only by the Mega Store owner
  reward_type text not null check (reward_type in ('percent', 'flat')),
  reward_value numeric(10, 2) not null check (reward_value > 0),
  max_discount_inr numeric(10, 2),
  min_purchase_inr numeric(10, 2) not null default 0,
  -- on_hold = the server saw a risk signal; Mega Store owner (or admin) must approve first. Not yet "issued": the 1-month clock has not started.
  status text not null default 'active' check (status in ('active', 'on_hold', 'redeemed', 'revoked', 'rejected')),
  risk_flags jsonb not null default '[]'::jsonb,
  issued_at timestamptz,
  expires_at timestamptz,                                        -- always issued_at + 1 month
  redeemed_at timestamptz,
  redeemed_bill_inr numeric(10, 2),
  discount_given_inr numeric(10, 2),
  funded_by text not null default 'mega_store' check (funded_by = 'mega_store'),   -- Blisscco never funds this discount
  review_note text check (review_note is null or char_length(review_note) <= 300),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mega_reward_issued_ok check (status not in ('active', 'redeemed') or (issued_at is not null and expires_at is not null))
);   -- expires_at is always set by the functions below as issued_at + interval '1 month'
create index if not exists mega_rewards_customer_idx on public.mega_rewards (customer_id, created_at desc);
create index if not exists mega_rewards_campaign_customer_idx on public.mega_rewards (campaign_id, customer_id);
create index if not exists mega_rewards_store_idx on public.mega_rewards (mega_store_id, status);

-- ============ 2. ACCESS HELPERS ============
create or replace function public.owns_mega_store(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mega_stores m
                   join public.profiles p on p.id = m.owner_id
                  where m.id = p_id and m.owner_id = auth.uid() and not p.is_suspended);
$$;

-- ============ 3. RLS (read only; every write goes through the functions below) ============
alter table public.mega_stores enable row level security;
alter table public.mega_campaigns enable row level security;
alter table public.mega_campaign_shops enable row level security;
alter table public.mega_enrollments enable row level security;
alter table public.mega_rewards enable row level security;

drop policy if exists mega_stores_select on public.mega_stores;
create policy mega_stores_select on public.mega_stores for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
drop policy if exists mega_campaigns_select on public.mega_campaigns;
create policy mega_campaigns_select on public.mega_campaigns for select to authenticated
  using (public.owns_mega_store(mega_store_id) or public.is_admin());
drop policy if exists mega_campaign_shops_select on public.mega_campaign_shops;
create policy mega_campaign_shops_select on public.mega_campaign_shops for select to authenticated
  using (public.owns_business(business_id) or public.is_admin()
         or exists (select 1 from public.mega_campaigns c where c.id = campaign_id and public.owns_mega_store(c.mega_store_id)));
drop policy if exists mega_enrollments_select on public.mega_enrollments;
create policy mega_enrollments_select on public.mega_enrollments for select to authenticated
  using (customer_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.mega_campaigns c where c.id = campaign_id and public.owns_mega_store(c.mega_store_id)));
drop policy if exists mega_rewards_select on public.mega_rewards;
create policy mega_rewards_select on public.mega_rewards for select to authenticated
  using (customer_id = auth.uid() or public.owns_mega_store(mega_store_id) or public.is_admin());

revoke all on public.mega_stores, public.mega_campaigns, public.mega_campaign_shops, public.mega_enrollments, public.mega_rewards
  from anon, authenticated;
grant select on public.mega_stores, public.mega_campaigns, public.mega_campaign_shops, public.mega_enrollments, public.mega_rewards
  to authenticated;

-- ============ 4. MEGA STORE OWNER: store profile ============
create or replace function public.megastore_create(p_name text, p_description text default null, p_phone text default null,
                                                  p_city text default null, p_address text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'invalid_name'; end if;
  if exists (select 1 from public.mega_stores where owner_id = auth.uid()) then raise exception 'already_exists'; end if;
  insert into public.mega_stores (owner_id, name, description, phone, city, address_line)
  values (auth.uid(), v_name, nullif(left(trim(coalesce(p_description, '')), 500), ''), nullif(left(trim(coalesce(p_phone, '')), 20), ''),
          nullif(left(trim(coalesce(p_city, '')), 80), ''), nullif(left(trim(coalesce(p_address, '')), 200), ''))
  returning id into v_id;
  begin perform public._notify_admins('mega_store_new', 'system', jsonb_build_object('business_name', v_name), '/admin/mega-stores');
  exception when others then null; end;
  return v_id;
end $$;

create or replace function public.megastore_update(p_name text, p_description text default null, p_phone text default null,
                                                  p_city text default null, p_address text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'invalid_name'; end if;
  if m.status = 'approved' and v_name <> m.name then raise exception 'name_locked'; end if;     -- name is fixed once approved
  update public.mega_stores set name = v_name,
         description = nullif(left(trim(coalesce(p_description, '')), 500), ''),
         phone = nullif(left(trim(coalesce(p_phone, '')), 20), ''),
         city = nullif(left(trim(coalesce(p_city, '')), 80), ''),
         address_line = nullif(left(trim(coalesce(p_address, '')), 200), ''),
         status = case when status = 'rejected' then 'pending_review' else status end,        -- re-submit after a rejection
         rejection_reason = case when status = 'rejected' then null else rejection_reason end
   where id = m.id;
end $$;

-- ============ 5. MEGA STORE OWNER: campaign (one open campaign at a time) ============
-- Creates the draft campaign or updates it. Once the campaign is live its reward terms are locked.
create or replace function public.megastore_save_campaign(
  p_title text, p_description text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_type text, p_value numeric, p_max_discount numeric default null, p_min_purchase numeric default null,
  p_min_service numeric default null, p_one_per_shop boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; v_id uuid;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.status <> 'approved' then raise exception 'store_not_approved'; end if;
  if char_length(trim(coalesce(p_title, ''))) < 3 or char_length(trim(p_title)) > 100 then raise exception 'invalid_title'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at <= now() then raise exception 'invalid_dates'; end if;
  if p_type is null or p_type not in ('percent', 'flat') then raise exception 'invalid_value'; end if;
  if p_value is null or p_value <= 0 or (p_type = 'percent' and p_value > 100) or p_value > 1000000 then raise exception 'invalid_value'; end if;
  if p_type = 'percent' and p_max_discount is not null and p_max_discount <= 0 then raise exception 'invalid_value'; end if;
  if coalesce(p_min_purchase, 0) < 0 or coalesce(p_min_service, 0) < 0 then raise exception 'invalid_value'; end if;

  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('draft', 'active', 'paused') for update;
  if found and c.status <> 'draft' then raise exception 'campaign_locked'; end if;
  if found then
    update public.mega_campaigns set title = trim(p_title), description = nullif(left(trim(coalesce(p_description, '')), 500), ''),
           starts_at = p_starts_at, ends_at = p_ends_at, reward_type = p_type, reward_value = p_value,
           max_discount_inr = case when p_type = 'percent' then p_max_discount else null end,
           min_purchase_inr = coalesce(p_min_purchase, 0), min_service_price_inr = coalesce(p_min_service, 0),
           one_reward_per_shop = coalesce(p_one_per_shop, true)
     where id = c.id;
    return c.id;
  end if;
  insert into public.mega_campaigns (mega_store_id, title, description, starts_at, ends_at, reward_type, reward_value,
                                     max_discount_inr, min_purchase_inr, min_service_price_inr, one_reward_per_shop)
  values (m.id, trim(p_title), nullif(left(trim(coalesce(p_description, '')), 500), ''), p_starts_at, p_ends_at, p_type, p_value,
          case when p_type = 'percent' then p_max_discount else null end, coalesce(p_min_purchase, 0), coalesce(p_min_service, 0),
          coalesce(p_one_per_shop, true))
  returning id into v_id;
  return v_id;
end $$;

-- draft -> active, active <-> paused, any open state -> ended
create or replace function public.megastore_set_campaign_status(p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('draft', 'active', 'paused') for update;
  if not found then raise exception 'no_campaign'; end if;
  if p_status = 'active' then
    if m.status <> 'approved' then raise exception 'store_not_approved'; end if;
    if c.status not in ('draft', 'paused') then raise exception 'invalid_transition'; end if;
    if c.ends_at <= now() then raise exception 'invalid_dates'; end if;
    if not exists (select 1 from public.mega_campaign_shops where campaign_id = c.id) then raise exception 'no_shops'; end if;
  elsif p_status = 'paused' then
    if c.status <> 'active' then raise exception 'invalid_transition'; end if;
  elsif p_status = 'ended' then
    null;
  else
    raise exception 'invalid_transition';
  end if;
  update public.mega_campaigns set status = p_status where id = c.id;
end $$;

-- ============ 6. MEGA STORE OWNER: partner shops ============
-- Approved Blisscco shops the Mega Store can pick from (public shop facts only). The Mega Store's own shops are excluded.
create or replace function public.megastore_search_shops(p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat text; v_out jsonb;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  v_pat := '%' || replace(replace(replace(left(trim(coalesce(p_q, '')), 60), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'city', x.city) order by x.name), '[]'::jsonb) into v_out
    from (select b.id, b.name, b.city from public.businesses b
           where b.status = 'approved' and b.owner_id <> auth.uid()
             and (coalesce(trim(p_q), '') = '' or b.name ilike v_pat or b.city ilike v_pat)
           order by b.name limit 25) x;
  return v_out;
end $$;

create or replace function public.megastore_add_shop(p_business_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; b public.businesses;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.status <> 'approved' then raise exception 'store_not_approved'; end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('draft', 'active', 'paused') for update;
  if not found then raise exception 'no_campaign'; end if;
  select * into b from public.businesses where id = p_business_id and status = 'approved';
  if not found then raise exception 'shop_not_found'; end if;
  if b.owner_id = auth.uid() then raise exception 'own_shop'; end if;
  if (select count(*) from public.mega_campaign_shops where campaign_id = c.id) >= 50 then raise exception 'too_many_shops'; end if;
  insert into public.mega_campaign_shops (campaign_id, business_id) values (c.id, b.id) on conflict do nothing;
  begin
    perform public._notify(b.owner_id, 'mega_shop_added', 'system',
      jsonb_build_object('business_name', b.name, 'title', m.name), '/owner', null, true);
  exception when others then null; end;
end $$;

create or replace function public.megastore_remove_shop(p_business_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('draft', 'active', 'paused') for update;
  if not found then raise exception 'no_campaign'; end if;
  if c.status = 'active' and (select count(*) from public.mega_campaign_shops where campaign_id = c.id) <= 1 then
    raise exception 'last_shop';                       -- pause or end the campaign instead of leaving it with no shop
  end if;
  delete from public.mega_campaign_shops where campaign_id = c.id and business_id = p_business_id;
end $$;

-- ============ 7. MEGA STORE OWNER: dashboard, held rewards, redeem ============
create or replace function public.get_my_megastore() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; v_shops jsonb; v_stats jsonb; v_held jsonb; v_recent jsonb;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid();
  if not found then return jsonb_build_object('store', null); end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('draft', 'active', 'paused');
  if not found then   -- show the most recent finished campaign (if any) so the owner still sees the results
    select * into c from public.mega_campaigns where mega_store_id = m.id order by created_at desc limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'city', b.city, 'status', b.status) order by b.name), '[]'::jsonb)
    into v_shops from public.mega_campaign_shops s join public.businesses b on b.id = s.business_id
   where c.id is not null and s.campaign_id = c.id;

  select jsonb_build_object(
      'enrolled', (select count(*) from public.mega_enrollments e where e.campaign_id = c.id),
      'issued', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.issued_at is not null and r.status <> 'revoked'),
      'on_hold', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.status = 'on_hold'),
      'redeemed', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.status = 'redeemed'),
      'expired', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.status = 'active' and r.expires_at <= now()),
      'active', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.status = 'active' and r.expires_at > now()),
      'discount_given_inr', (select coalesce(sum(r.discount_given_inr), 0) from public.mega_rewards r where r.campaign_id = c.id and r.status = 'redeemed'),
      'bills_inr', (select coalesce(sum(r.redeemed_bill_inr), 0) from public.mega_rewards r where r.campaign_id = c.id and r.status = 'redeemed'))
    into v_stats where c.id is not null;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'business_name', r.business_name,
           'customer_name', coalesce(split_part(p.full_name, ' ', 1), ''), 'risk_flags', r.risk_flags, 'created_at', r.created_at)
           order by r.created_at), '[]'::jsonb)
    into v_held from public.mega_rewards r join public.profiles p on p.id = r.customer_id
   where c.id is not null and r.campaign_id = c.id and r.status = 'on_hold';

  select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) into v_recent
    from (select r.redeemed_at as at, jsonb_build_object('code', r.code, 'customer_name', coalesce(split_part(p.full_name, ' ', 1), ''),
                   'business_name', r.business_name, 'bill_inr', r.redeemed_bill_inr, 'discount_inr', r.discount_given_inr,
                   'redeemed_at', r.redeemed_at) as j
            from public.mega_rewards r join public.profiles p on p.id = r.customer_id
           where c.id is not null and r.campaign_id = c.id and r.status = 'redeemed'
           order by r.redeemed_at desc limit 15) x;

  return jsonb_build_object(
    'store', jsonb_build_object('id', m.id, 'name', m.name, 'description', m.description, 'phone', m.phone, 'city', m.city,
                                'address_line', m.address_line, 'code', m.code, 'status', m.status, 'rejection_reason', m.rejection_reason),
    'campaign', case when c.id is null then null else to_jsonb(c) - 'mega_store_id' end,
    'shops', coalesce(v_shops, '[]'::jsonb), 'stats', coalesce(v_stats, '{}'::jsonb),
    'held', v_held, 'recent', v_recent);
end $$;

-- Approve / reject a reward the server put on hold. Approving starts the one-month clock.
create or replace function public.megastore_review_reward(p_reward_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.mega_rewards; ms public.mega_stores; v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into r from public.mega_rewards where id = p_reward_id for update;
  if not found or not public.owns_mega_store(r.mega_store_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'on_hold' then raise exception 'invalid_transition'; end if;
  select * into ms from public.mega_stores where id = r.mega_store_id;
  if ms.status <> 'approved' then raise exception 'store_not_approved'; end if;
  if p_approve then
    update public.mega_rewards set status = 'active', issued_at = v_now, expires_at = v_now + interval '1 month',
           review_note = left(p_note, 300), reviewed_by = auth.uid(), reviewed_at = v_now where id = r.id;
    begin
      perform public._notify(r.customer_id, 'mega_reward_issued', 'system',
        jsonb_build_object('business_name', ms.name, 'discount_type', r.reward_type, 'discount_value', r.reward_value,
                           'expires_at', v_now + interval '1 month'), '/my-rewards', 'mega_reward_' || r.id::text, true);
    exception when others then null; end;
  else
    update public.mega_rewards set status = 'rejected', review_note = left(p_note, 300), reviewed_by = auth.uid(), reviewed_at = v_now where id = r.id;
  end if;
end $$;

-- Mega Store owner scans / types a reward code: shows what the reward is worth BEFORE it is used.
create or replace function public.megastore_lookup_reward(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.mega_rewards; p public.profiles;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into r from public.mega_rewards where code = upper(trim(coalesce(p_code, '')));
  if not found or not public.owns_mega_store(r.mega_store_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into p from public.profiles where id = r.customer_id;
  return jsonb_build_object('id', r.id, 'code', r.code, 'customer_name', coalesce(split_part(p.full_name, ' ', 1), ''),
    'business_name', r.business_name, 'reward_type', r.reward_type, 'reward_value', r.reward_value,
    'max_discount_inr', r.max_discount_inr, 'min_purchase_inr', r.min_purchase_inr,
    'state', case when r.status = 'active' and r.expires_at <= now() then 'expired' else r.status end,
    'issued_at', r.issued_at, 'expires_at', r.expires_at, 'redeemed_at', r.redeemed_at,
    'redeemed_bill_inr', r.redeemed_bill_inr, 'discount_given_inr', r.discount_given_inr);
end $$;

-- Redeem: the Mega Store owner enters the bill amount; the discount is computed on the server. 100% Mega Store funded.
create or replace function public.megastore_redeem_reward(p_code text, p_bill_inr numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.mega_rewards; ms public.mega_stores; v_disc numeric(10, 2); v_now timestamptz := now();
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into r from public.mega_rewards where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or not public.owns_mega_store(r.mega_store_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into ms from public.mega_stores where id = r.mega_store_id;
  if ms.status <> 'approved' then raise exception 'store_not_approved'; end if;
  if r.status = 'redeemed' then raise exception 'already_redeemed'; end if;
  if r.status <> 'active' then raise exception 'not_usable'; end if;                 -- on hold / rejected / revoked
  if r.expires_at <= v_now then raise exception 'expired'; end if;
  if p_bill_inr is null or p_bill_inr <= 0 or p_bill_inr > 10000000 then raise exception 'invalid_bill'; end if;
  if p_bill_inr < r.min_purchase_inr then raise exception 'below_min_purchase'; end if;

  if r.reward_type = 'percent' then
    v_disc := round(p_bill_inr * r.reward_value / 100, 2);
    if r.max_discount_inr is not null then v_disc := least(v_disc, r.max_discount_inr); end if;
  else
    v_disc := r.reward_value;
  end if;
  v_disc := least(v_disc, p_bill_inr);
  update public.mega_rewards set status = 'redeemed', redeemed_at = v_now, redeemed_bill_inr = p_bill_inr, discount_given_inr = v_disc
   where id = r.id;
  begin
    perform public._notify(r.customer_id, 'mega_reward_redeemed', 'system',
      jsonb_build_object('business_name', ms.name), '/my-rewards', null, true);
  exception when others then null; end;
  return jsonb_build_object('discount_inr', v_disc, 'payable_inr', p_bill_inr - v_disc, 'bill_inr', p_bill_inr);
end $$;

-- ============ 8. CUSTOMER: campaign page (public), join, my rewards ============
-- Public: what the QR opens. Shows only approved shops. If signed in, also tells whether I joined and how many rewards I earned.
create or replace function public.get_mega_campaign_public(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; v_shops jsonb; v_me jsonb := null; v_enrolled boolean; v_earned int; v_role public.user_role;
begin
  select * into m from public.mega_stores where code = lower(trim(coalesce(p_code, ''))) and status = 'approved';
  if not found then return jsonb_build_object('found', false); end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('active', 'paused');
  if not found then
    return jsonb_build_object('found', true, 'store', jsonb_build_object('name', m.name, 'description', m.description, 'city', m.city), 'campaign', null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'city', b.city) order by b.name), '[]'::jsonb) into v_shops
    from public.mega_campaign_shops s join public.businesses b on b.id = s.business_id
   where s.campaign_id = c.id and b.status = 'approved';
  if auth.uid() is not null then
    select role into v_role from public.profiles where id = auth.uid();
    select exists (select 1 from public.mega_enrollments where campaign_id = c.id and customer_id = auth.uid()) into v_enrolled;
    select count(*)::int into v_earned from public.mega_rewards
     where campaign_id = c.id and customer_id = auth.uid() and status in ('active', 'on_hold', 'redeemed');
    v_me := jsonb_build_object('role', v_role, 'enrolled', v_enrolled, 'earned', v_earned);
  end if;
  return jsonb_build_object('found', true,
    'store', jsonb_build_object('name', m.name, 'description', m.description, 'city', m.city),
    'campaign', jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description, 'status', c.status,
        'starts_at', c.starts_at, 'ends_at', c.ends_at, 'reward_type', c.reward_type, 'reward_value', c.reward_value,
        'max_discount_inr', c.max_discount_inr, 'min_purchase_inr', c.min_purchase_inr, 'min_service_price_inr', c.min_service_price_inr,
        'max_rewards', c.max_rewards_per_customer, 'one_reward_per_shop', c.one_reward_per_shop),
    'shops', v_shops, 'me', v_me, 'server_now', now());
end $$;

create or replace function public.join_mega_campaign(p_code text, p_declared_female boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; pr public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into pr from public.profiles where id = auth.uid();
  if not found or pr.is_suspended then raise exception 'not_available' using errcode = '42501'; end if;
  if pr.role <> 'customer' then raise exception 'customer_only'; end if;
  if not pr.email_verified then raise exception 'email_not_verified'; end if;
  if p_declared_female is distinct from true then raise exception 'declare_required'; end if;
  select * into m from public.mega_stores where code = lower(trim(coalesce(p_code, ''))) and status = 'approved';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status = 'active' and ends_at > now();
  if not found then raise exception 'not_active'; end if;
  if m.owner_id = auth.uid() then raise exception 'own_store'; end if;
  insert into public.mega_enrollments (campaign_id, customer_id, declared_female) values (c.id, auth.uid(), true)
  on conflict (campaign_id, customer_id) do nothing;
end $$;

create or replace function public.get_my_mega_rewards() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'code', r.code, 'store_name', m.name, 'store_city', m.city, 'campaign_title', c.title, 'business_name', r.business_name,
      'reward_type', r.reward_type, 'reward_value', r.reward_value, 'max_discount_inr', r.max_discount_inr, 'min_purchase_inr', r.min_purchase_inr,
      'state', case when r.status = 'active' and r.expires_at <= now() then 'expired' else r.status end,
      'issued_at', r.issued_at, 'expires_at', r.expires_at, 'redeemed_at', r.redeemed_at, 'discount_given_inr', r.discount_given_inr,
      'max_rewards', c.max_rewards_per_customer) order by r.created_at desc), '[]'::jsonb) into v_out
    from public.mega_rewards r
    join public.mega_stores m on m.id = r.mega_store_id
    join public.mega_campaigns c on c.id = r.campaign_id
   where r.customer_id = auth.uid() and r.status <> 'revoked';
  return v_out;
end $$;

-- ============ 9. REWARD ISSUING (server only: trigger on a COMPLETED booking) ============
-- Conditions (all checked here, never on the phone):
--   booking made by the customer (not an owner-issued token), COMPLETED, shop is a partner shop of a live campaign,
--   customer joined BEFORE booking, service price >= campaign minimum, completed inside the campaign dates,
--   customer / shop owner / Mega Store owner are three different accounts, Mega Store approved,
--   fewer than 5 rewards already (counted under a row lock, so two bookings completing at once cannot exceed 5),
--   not already rewarded at this shop (when one_reward_per_shop).
-- Risk signals (very short service, booked and completed within minutes, two rewards within 6 hours) put the reward ON HOLD for the
-- Mega Store owner to approve; it counts towards the 5 but cannot be used until approved.
create or replace function public.mega_try_issue_reward(p_booking_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  bk public.bookings; biz public.businesses; ms public.mega_stores; c public.mega_campaigns; en public.mega_enrollments;
  v_flags jsonb; v_status text; v_code text; v_id uuid; v_now timestamptz := now(); v_try int; v_done timestamptz;
begin
  select * into bk from public.bookings where id = p_booking_id;
  if not found or bk.status <> 'completed' or bk.customer_id is null or bk.source <> 'customer' then return null; end if;
  if exists (select 1 from public.mega_rewards where booking_id = bk.id) then return null; end if;     -- one reward per service
  select * into biz from public.businesses where id = bk.business_id and status = 'approved';
  if not found then return null; end if;
  if not exists (select 1 from public.profiles where id = bk.customer_id and not is_suspended and role = 'customer') then return null; end if;
  v_done := coalesce(bk.completed_at, v_now);

  for c in
    select mc.* from public.mega_campaigns mc
      join public.mega_campaign_shops s on s.campaign_id = mc.id and s.business_id = bk.business_id
      join public.mega_enrollments e on e.campaign_id = mc.id and e.customer_id = bk.customer_id
     where mc.status = 'active' and mc.starts_at <= v_done and mc.ends_at > v_done
       and bk.created_at >= e.enrolled_at and bk.price_inr >= mc.min_service_price_inr
     order by e.enrolled_at
  loop
    select * into ms from public.mega_stores where id = c.mega_store_id and status = 'approved';
    if not found then continue; end if;
    if ms.owner_id = bk.customer_id or ms.owner_id = biz.owner_id or biz.owner_id = bk.customer_id then continue; end if;

    select * into en from public.mega_enrollments where campaign_id = c.id and customer_id = bk.customer_id for update;   -- serialises the 5-reward cap
    if (select count(*) from public.mega_rewards x where x.campaign_id = c.id and x.customer_id = bk.customer_id
          and x.status in ('active', 'on_hold', 'redeemed')) >= c.max_rewards_per_customer then continue; end if;
    if c.one_reward_per_shop and exists (select 1 from public.mega_rewards x where x.campaign_id = c.id and x.customer_id = bk.customer_id
          and x.business_id = bk.business_id and x.status in ('active', 'on_hold', 'redeemed')) then continue; end if;

    v_flags := '[]'::jsonb;
    if bk.started_at is null or bk.completed_at is null or bk.completed_at - bk.started_at < interval '10 minutes' then
      v_flags := v_flags || '["short_service"]'::jsonb; end if;
    if v_done - bk.created_at < interval '15 minutes' then v_flags := v_flags || '["instant_booking"]'::jsonb; end if;
    if exists (select 1 from public.mega_rewards x where x.campaign_id = c.id and x.customer_id = bk.customer_id
                 and x.created_at > v_now - interval '6 hours') then v_flags := v_flags || '["rapid_repeat"]'::jsonb; end if;
    v_status := case when jsonb_array_length(v_flags) = 0 then 'active' else 'on_hold' end;

    v_try := 0;
    loop
      v_try := v_try + 1;
      v_code := 'MS-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
      begin
        insert into public.mega_rewards (campaign_id, mega_store_id, customer_id, booking_id, business_id, business_name, code,
                 reward_type, reward_value, max_discount_inr, min_purchase_inr, status, risk_flags, issued_at, expires_at)
        values (c.id, ms.id, bk.customer_id, bk.id, bk.business_id, biz.name, v_code,
                c.reward_type, c.reward_value, c.max_discount_inr, c.min_purchase_inr, v_status, v_flags,
                case when v_status = 'active' then v_now end, case when v_status = 'active' then v_now + interval '1 month' end)
        returning id into v_id;
        exit;
      exception when unique_violation then
        if v_try >= 5 then return null; end if;       -- code clash (retry) or booking already rewarded (give up)
        if exists (select 1 from public.mega_rewards where booking_id = bk.id) then return null; end if;
      end;
    end loop;

    insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
    values (null, 'mega_reward.issue', 'mega_reward', v_id, jsonb_build_object('campaign_id', c.id, 'booking_id', bk.id, 'status', v_status, 'flags', v_flags));
    begin
      if v_status = 'active' then
        perform public._notify(bk.customer_id, 'mega_reward_issued', 'system',
          jsonb_build_object('business_name', ms.name, 'discount_type', c.reward_type, 'discount_value', c.reward_value,
                             'expires_at', v_now + interval '1 month'), '/my-rewards', 'mega_reward_' || v_id::text, true);
      else
        perform public._notify(ms.owner_id, 'mega_reward_review', 'system',
          jsonb_build_object('customer_name', coalesce((select split_part(full_name, ' ', 1) from public.profiles where id = bk.customer_id), '')),
          '/owner/megastore', null, true);
      end if;
    exception when others then null; end;
    return v_id;
  end loop;
  return null;
end $$;

-- Trigger: errors are swallowed, so completing a booking can NEVER fail because of the reward cycle.
create or replace function public.mega_booking_completed_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    begin perform public.mega_try_issue_reward(new.id);
    exception when others then null; end;
  end if;
  return new;
end $$;
drop trigger if exists mega_booking_completed_check on public.bookings;
create trigger mega_booking_completed_check after update of status on public.bookings
  for each row execute function public.mega_booking_completed_check();

-- ============ 10. ADMIN ============
create or replace function public.admin_list_megastores() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'city', m.city, 'status', m.status, 'rejection_reason', m.rejection_reason, 'created_at', m.created_at,
      'owner_name', p.full_name, 'owner_email', u.email::text,
      'campaign_title', c.title, 'campaign_status', c.status, 'campaign_ends_at', c.ends_at,
      'shops', (select count(*) from public.mega_campaign_shops s where s.campaign_id = c.id),
      'enrolled', (select count(*) from public.mega_enrollments e where e.campaign_id = c.id),
      'issued', (select count(*) from public.mega_rewards r where r.mega_store_id = m.id and r.issued_at is not null and r.status <> 'revoked'),
      'redeemed', (select count(*) from public.mega_rewards r where r.mega_store_id = m.id and r.status = 'redeemed'),
      'discount_given_inr', (select coalesce(sum(r.discount_given_inr), 0) from public.mega_rewards r where r.mega_store_id = m.id and r.status = 'redeemed')
    ) order by (m.status = 'pending_review') desc, m.created_at desc), '[]'::jsonb) into v_out
    from public.mega_stores m
    join public.profiles p on p.id = m.owner_id
    join auth.users u on u.id = m.owner_id
    left join lateral (select * from public.mega_campaigns x where x.mega_store_id = m.id order by (x.status in ('draft', 'active', 'paused')) desc, x.created_at desc limit 1) c on true;
  return v_out;
end $$;

create or replace function public.admin_megastore_set_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected', 'suspended') then raise exception 'invalid_status'; end if;
  select * into m from public.mega_stores where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.mega_stores set status = p_status,
         rejection_reason = case when p_status = 'approved' then null else left(nullif(trim(coalesce(p_reason, '')), ''), 300) end
   where id = m.id;
  if p_status = 'suspended' then   -- a suspended Mega Store stops issuing rewards at once
    update public.mega_campaigns set status = 'paused' where mega_store_id = m.id and status = 'active';
  end if;
  perform public.write_audit_log('mega_store.' || p_status, 'mega_store', m.id, jsonb_build_object('reason', p_reason));
  begin
    perform public._notify(m.owner_id, 'mega_store_' || p_status, 'system',
      jsonb_build_object('business_name', m.name, 'reason', p_reason), '/owner/megastore', null, true);
  exception when others then null; end;
end $$;

-- Admin can cancel a reward that is not redeemed yet (fraud). A redeemed reward cannot be undone here.
create or replace function public.admin_megastore_revoke_reward(p_code text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.mega_rewards;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into r from public.mega_rewards where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status = 'redeemed' then raise exception 'already_redeemed'; end if;
  if r.status = 'revoked' then raise exception 'invalid_transition'; end if;
  update public.mega_rewards set status = 'revoked', review_note = left(p_note, 300), reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
  perform public.write_audit_log('mega_reward.revoke', 'mega_reward', r.id, jsonb_build_object('note', p_note));
end $$;

-- ============ 11. FUNCTION PRIVILEGES ============
revoke execute on function public.owns_mega_store(uuid), public.mega_try_issue_reward(uuid), public.mega_booking_completed_check(),
  public.megastore_create(text, text, text, text, text), public.megastore_update(text, text, text, text, text),
  public.megastore_save_campaign(text, text, timestamptz, timestamptz, text, numeric, numeric, numeric, numeric, boolean),
  public.megastore_set_campaign_status(text), public.megastore_search_shops(text), public.megastore_add_shop(uuid),
  public.megastore_remove_shop(uuid), public.get_my_megastore(), public.megastore_review_reward(uuid, boolean, text),
  public.megastore_lookup_reward(text), public.megastore_redeem_reward(text, numeric), public.get_mega_campaign_public(text),
  public.join_mega_campaign(text, boolean), public.get_my_mega_rewards(), public.admin_list_megastores(),
  public.admin_megastore_set_status(uuid, text, text), public.admin_megastore_revoke_reward(text, text)
  from public, anon, authenticated;

grant execute on function public.owns_mega_store(uuid) to authenticated;
grant execute on function public.megastore_create(text, text, text, text, text), public.megastore_update(text, text, text, text, text),
  public.megastore_save_campaign(text, text, timestamptz, timestamptz, text, numeric, numeric, numeric, numeric, boolean),
  public.megastore_set_campaign_status(text), public.megastore_search_shops(text), public.megastore_add_shop(uuid),
  public.megastore_remove_shop(uuid), public.get_my_megastore(), public.megastore_review_reward(uuid, boolean, text),
  public.megastore_lookup_reward(text), public.megastore_redeem_reward(text, numeric),
  public.join_mega_campaign(text, boolean), public.get_my_mega_rewards(), public.admin_list_megastores(),
  public.admin_megastore_set_status(uuid, text, text), public.admin_megastore_revoke_reward(text, text) to authenticated;
grant execute on function public.get_mega_campaign_public(text) to anon, authenticated;     -- the QR page works before login
