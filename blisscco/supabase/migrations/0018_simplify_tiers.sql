-- 0018: Simple database. No PLAN tiers left anywhere. Re-runnable. Run once in Supabase SQL Editor (after 0017).
-- What changes:
--   * has_entitlement  -> only the Blue badge is a paid feature; everything else is open (one small query, no plans join)
--   * business_tier_rank + tier_rank columns/ordering -> removed. Search order = chosen sort (distance / price), nothing else
--   * public_business_flags, nearby_businesses, search_services, active_banners, my_entitlements -> no tier / plan fields
--   * get_analytics, create_banner -> no plan gate any more (they only check that you own the shop)
-- Old payments / subscriptions / plans rows are KEPT (history and refunds still work).

-- 1) Blue badge is the only entitlement
create or replace function public.has_entitlement(p_business_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_feature <> 'blue_badge'
      or exists (select 1 from public.subscriptions s
                  where s.business_id = p_business_id and s.plan_code = 'blue_badge' and s.status = 'active'
                    and s.starts_at <= now() and s.expires_at > now());
$$;

-- 2) Public flags: only the blue tick
drop view if exists public.public_business_flags;
create view public.public_business_flags with (security_invoker = false) as
select b.id as business_id, public.has_entitlement(b.id, 'blue_badge') as is_verified
  from public.businesses b where b.status = 'approved';
grant select on public.public_business_flags to anon, authenticated;

-- 3) Owner summary: no plan / tier fields
create or replace function public.my_entitlements(p_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_badge_exp timestamptz; v_credits int; v_ver text;
begin
  if not (public.owns_business(p_business_id) or public.is_admin()) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  select max(s.expires_at) into v_badge_exp from public.subscriptions s
   where s.business_id = p_business_id and s.plan_code = 'blue_badge' and s.status = 'active'
     and s.starts_at <= now() and s.expires_at > now();
  select coalesce(sum(delta), 0)::int into v_credits from public.banner_credits where business_id = p_business_id;
  select status into v_ver from public.verification_requests where business_id = p_business_id order by created_at desc limit 1;
  return jsonb_build_object('verified', v_badge_exp is not null, 'verified_expires_at', v_badge_exp,
    'credits', v_credits, 'verification_status', v_ver);
end $$;

-- 4) Search: no tier ranking (return type changes, so drop first)
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
               is_verified boolean)
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
         x.distance_m, x.min_price, x.service_count, x.cover_path, x.is_open_now, x.is_verified
    from (
      select b.id, b.name, b.category_id, c.name_en, c.name_hi, c.name_mr, b.city, b.address_line,
             extensions.st_distance(b.location, v_point) as distance_m,
             (select min(s.price_inr) from public.services s where s.business_id = b.id and s.is_active) as min_price,
             (select count(*)::int from public.services s where s.business_id = b.id and s.is_active) as service_count,
             (select i.storage_path from public.business_images i where i.business_id = b.id
               order by i.sort_order, i.created_at limit 1) as cover_path,
             public.business_open_now(b.id) as is_open_now,
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
   order by case when p_sort = 'price' then x.min_price end asc nulls last, x.distance_m asc, x.id
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
               is_verified boolean)
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
         x.name_en, x.name_hi, x.name_mr, x.city, x.distance_m, x.cover_path, x.is_open_now, x.is_verified
    from (
      select s.id as service_id, coalesce(s.name, s.service_category) as service_label, s.price_inr,
             b.id as business_id, b.name as business_name, b.category_id, c.name_en, c.name_hi, c.name_mr, b.city,
             extensions.st_distance(b.location, v_point) as distance_m,
             (select i.storage_path from public.business_images i where i.business_id = b.id
               order by i.sort_order, i.created_at limit 1) as cover_path,
             public.business_open_now(b.id) as is_open_now,
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
   order by case when p_sort = 'distance' then x.distance_m end asc nulls last,
            x.price_inr asc, x.distance_m asc, x.service_id
   limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end $$;

revoke execute on function
  public.nearby_businesses(double precision, double precision, uuid, numeric, boolean, text, int, int),
  public.search_services(double precision, double precision, text, uuid, numeric, boolean, text, int, int)
  from public, anon, authenticated;
grant execute on function
  public.nearby_businesses(double precision, double precision, uuid, numeric, boolean, text, int, int),
  public.search_services(double precision, double precision, text, uuid, numeric, boolean, text, int, int)
  to anon, authenticated;

-- 5) Live banners near the visitor (5 km). Newest first, no tier order, no plan needed at display time
drop function if exists public.active_banners(double precision, double precision);
create function public.active_banners(p_lat double precision, p_lng double precision)
returns table (banner_id uuid, business_id uuid, business_name text, title text, image_path text)
language sql stable security definer set search_path = '' as $$
  select bn.id, b.id, b.name, bn.title, bn.image_path
    from public.banners bn
    join public.businesses b on b.id = bn.business_id
   where p_lat between -90 and 90 and p_lng between -180 and 180
     and bn.status = 'approved' and bn.ends_at > now() and bn.starts_at <= now()
     and b.status = 'approved' and b.location is not null
     and extensions.st_dwithin(b.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography, 5000)
   order by bn.starts_at desc
   limit 8;
$$;
revoke execute on function public.active_banners(double precision, double precision) from public;
grant execute on function public.active_banners(double precision, double precision) to anon, authenticated;

-- 6) Analytics and banners: owner check only (no plan gate)
create or replace function public.get_analytics(p_business_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz; v_to timestamptz; v_totals jsonb; v_src jsonb; v_daily jsonb;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then raise exception 'not_owner' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then raise exception 'invalid_range' using errcode = '22023'; end if;

  v_from := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';

  select jsonb_build_object(
           'profile_view', count(*) filter (where event_type = 'profile_view'),
           'search_impression', count(*) filter (where event_type = 'search_impression'),
           'booking', count(*) filter (where event_type = 'booking'))
    into v_totals
    from public.analytics_events
   where business_id = p_business_id and created_at >= v_from and created_at < v_to;

  select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'profile_view', coalesce(c.pv, 0),
           'search_impression', coalesce(c.si, 0), 'booking', coalesce(c.bk, 0)) order by s.ord), '[]'::jsonb)
    into v_src
    from (values ('qr', 1), ('search', 2), ('referral', 3), ('direct', 4)) as s(source, ord)
    left join (
      select source,
             count(*) filter (where event_type = 'profile_view') as pv,
             count(*) filter (where event_type = 'search_impression') as si,
             count(*) filter (where event_type = 'booking') as bk
        from public.analytics_events
       where business_id = p_business_id and created_at >= v_from and created_at < v_to
       group by source) c on c.source = s.source;

  select coalesce(jsonb_agg(jsonb_build_object('day', d.dy, 'profile_view', coalesce(c.pv, 0),
           'search_impression', coalesce(c.si, 0), 'booking', coalesce(c.bk, 0)) order by d.dy), '[]'::jsonb)
    into v_daily
    from (select g::date as dy from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g) d
    left join (
      select (created_at at time zone 'Asia/Kolkata')::date as dy,
             count(*) filter (where event_type = 'profile_view') as pv,
             count(*) filter (where event_type = 'search_impression') as si,
             count(*) filter (where event_type = 'booking') as bk
        from public.analytics_events
       where business_id = p_business_id and created_at >= v_from and created_at < v_to
       group by 1) c on c.dy = d.dy;

  return jsonb_build_object('from', p_from, 'to', p_to, 'totals', v_totals, 'by_source', v_src, 'daily', v_daily);
end $$;

create or replace function public.create_banner(p_business_id uuid, p_title text, p_image_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_bal int;
begin
  if not public.owns_business(p_business_id) then raise exception 'not_owner'; end if;
  if not public.business_is_public(p_business_id) then raise exception 'business_not_approved'; end if;
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

-- 7) Tier function is no longer used anywhere
drop function if exists public.business_tier_rank(uuid);
