-- 0037: Shop-funded offers / coupon codes (owner creates them; Blisscco does NOT fund these). Re-runnable.
-- Run BEFORE deploying the new frontend.
-- * Owner creates a code with a discount in percent or rupees. Tenure (start / end) is optional.
-- * Active offers are shown on the customer browse page (Explore) through get_shop_offers().
-- * The old referral-coupon / promo-balance functions (check_coupon, redeem_coupon, ...) are NOT touched.

create table if not exists public.shop_offers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{3,20}$'),
  discount_type text not null check (discount_type in ('percent', 'flat')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  max_discount_inr numeric(10, 2) check (max_discount_inr is null or max_discount_inr > 0),   -- cap, only for percent offers
  min_spend_inr numeric(10, 2) not null default 0 check (min_spend_inr >= 0),
  starts_at timestamptz,                                                                       -- null = starts immediately
  ends_at timestamptz,                                                                         -- null = no end date
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_offers_percent_ok check (discount_type <> 'percent' or discount_value <= 100),
  constraint shop_offers_cap_ok check (discount_type = 'percent' or max_discount_inr is null),
  constraint shop_offers_range_ok check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint shop_offers_code_unique unique (business_id, code)
);
create index if not exists shop_offers_business_idx on public.shop_offers (business_id, created_at desc);

drop trigger if exists shop_offers_updated_at on public.shop_offers;
create trigger shop_offers_updated_at before update on public.shop_offers
  for each row execute function public.set_updated_at();

-- Owner (own shops) and admin can read; nobody writes directly, only through the functions below.
alter table public.shop_offers enable row level security;
drop policy if exists shop_offers_select on public.shop_offers;
create policy shop_offers_select on public.shop_offers for select to authenticated
  using (public.owns_business(business_id) or public.is_admin());
revoke all on public.shop_offers from anon, authenticated;
grant select on public.shop_offers to authenticated;

-- Owner: create an offer
create or replace function public.owner_create_offer(
  p_business_id uuid, p_code text, p_type text, p_value numeric,
  p_max_discount numeric default null, p_min_spend numeric default null,
  p_starts_at timestamptz default null, p_ends_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_code text := upper(trim(coalesce(p_code, ''))); v_id uuid;
begin
  if not public.owns_business(p_business_id) then raise exception 'not_owner' using errcode = '42501'; end if;
  if v_code !~ '^[A-Z0-9]{3,20}$' then raise exception 'invalid_code'; end if;
  if p_type is null or p_type not in ('percent', 'flat') then raise exception 'invalid_value'; end if;
  if p_value is null or p_value <= 0 or (p_type = 'percent' and p_value > 100) then raise exception 'invalid_value'; end if;
  if p_type = 'percent' and p_max_discount is not null and p_max_discount <= 0 then raise exception 'invalid_value'; end if;
  if coalesce(p_min_spend, 0) < 0 then raise exception 'invalid_value'; end if;
  if p_ends_at is not null and p_ends_at <= now() then raise exception 'invalid_dates'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then raise exception 'invalid_dates'; end if;
  if (select count(*) from public.shop_offers where business_id = p_business_id) >= 25 then raise exception 'too_many_offers'; end if;
  begin
    insert into public.shop_offers (business_id, code, discount_type, discount_value, max_discount_inr, min_spend_inr, starts_at, ends_at)
    values (p_business_id, v_code, p_type, p_value, case when p_type = 'percent' then p_max_discount else null end,
            coalesce(p_min_spend, 0), p_starts_at, p_ends_at)
    returning id into v_id;
  exception when unique_violation then raise exception 'code_taken';
  end;
  return v_id;
end $$;

-- Owner: pause / resume an offer
create or replace function public.owner_set_offer_active(p_offer_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_biz uuid;
begin
  select business_id into v_biz from public.shop_offers where id = p_offer_id;
  if v_biz is null or not public.owns_business(v_biz) then raise exception 'not_owner' using errcode = '42501'; end if;
  update public.shop_offers set is_active = coalesce(p_active, false) where id = p_offer_id;
end $$;

-- Owner: delete an offer
create or replace function public.owner_delete_offer(p_offer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_biz uuid;
begin
  select business_id into v_biz from public.shop_offers where id = p_offer_id;
  if v_biz is null or not public.owns_business(v_biz) then raise exception 'not_owner' using errcode = '42501'; end if;
  delete from public.shop_offers where id = p_offer_id;
end $$;

-- Public: offers that are live right now (active, inside tenure) for approved shops. Used by the browse page.
create or replace function public.get_shop_offers(p_business_ids uuid[])
returns table (business_id uuid, offer_id uuid, code text, discount_type text, discount_value numeric,
               max_discount_inr numeric, min_spend_inr numeric, ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.business_id, o.id, o.code, o.discount_type, o.discount_value, o.max_discount_inr, o.min_spend_inr, o.ends_at
    from public.shop_offers o
    join public.businesses b on b.id = o.business_id
   where o.business_id = any (p_business_ids[1:60])
     and b.status = 'approved'
     and o.is_active
     and (o.starts_at is null or o.starts_at <= now())
     and (o.ends_at is null or o.ends_at > now())
   order by o.business_id, (o.discount_type = 'percent') desc, o.discount_value desc, o.created_at desc;
$$;

revoke execute on function public.owner_create_offer(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz),
  public.owner_set_offer_active(uuid, boolean), public.owner_delete_offer(uuid), public.get_shop_offers(uuid[]) from public, anon, authenticated;
grant execute on function public.owner_create_offer(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz),
  public.owner_set_offer_active(uuid, boolean), public.owner_delete_offer(uuid) to authenticated;
grant execute on function public.get_shop_offers(uuid[]) to anon, authenticated;
