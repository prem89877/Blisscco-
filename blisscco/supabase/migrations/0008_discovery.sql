-- 0008: nearby discovery + service search (5 km enforced inside the database)
create extension if not exists pg_trgm with schema extensions;
create index if not exists services_category_trgm on public.services using gin (service_category extensions.gin_trgm_ops);
create index if not exists businesses_name_trgm on public.businesses using gin (name extensions.gin_trgm_ops);

-- Real "open now" from saved opening hours (India time). Internal helper.
create or replace function public.business_open_now(p_business_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (not h.is_closed)
       and (now() at time zone 'Asia/Kolkata')::time >= h.opens_at
       and (now() at time zone 'Asia/Kolkata')::time <  h.closes_at
      from public.business_hours h
     where h.business_id = p_business_id
       and h.day_of_week = extract(dow from (now() at time zone 'Asia/Kolkata'))::int
  ), false);
$$;
revoke execute on function public.business_open_now(uuid) from public, anon, authenticated;

-- Shops within 5 km of the given point (approved listings only). Radius is fixed here, not by the client.
create or replace function public.nearby_businesses(
  p_lat double precision, p_lng double precision,
  p_category uuid default null, p_max_price numeric default null,
  p_open_now boolean default false, p_sort text default 'distance',
  p_limit int default 20, p_offset int default 0)
returns table (business_id uuid, name text, category_id uuid, category_name_en text, category_name_hi text,
               category_name_mr text, city text, address_line text, distance_m double precision,
               min_price numeric, service_count int, cover_path text, is_open_now boolean)
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
         x.distance_m, x.min_price, x.service_count, x.cover_path, x.is_open_now
    from (
      select b.id, b.name, b.category_id, c.name_en, c.name_hi, c.name_mr, b.city, b.address_line,
             extensions.st_distance(b.location, v_point) as distance_m,
             (select min(s.price_inr) from public.services s where s.business_id = b.id and s.is_active) as min_price,
             (select count(*)::int from public.services s where s.business_id = b.id and s.is_active) as service_count,
             (select i.storage_path from public.business_images i where i.business_id = b.id
               order by i.sort_order, i.created_at limit 1) as cover_path,
             public.business_open_now(b.id) as is_open_now
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

-- Matching services from shops within 5 km, for price comparison.
create or replace function public.search_services(
  p_lat double precision, p_lng double precision, p_query text,
  p_category uuid default null, p_max_price numeric default null,
  p_open_now boolean default false, p_sort text default 'distance',
  p_limit int default 20, p_offset int default 0)
returns table (service_id uuid, service_label text, price_inr numeric, business_id uuid, business_name text,
               category_id uuid, category_name_en text, category_name_hi text, category_name_mr text,
               city text, distance_m double precision, cover_path text, is_open_now boolean)
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
         x.name_en, x.name_hi, x.name_mr, x.city, x.distance_m, x.cover_path, x.is_open_now
    from (
      select s.id as service_id, coalesce(s.name, s.service_category) as service_label, s.price_inr,
             b.id as business_id, b.name as business_name, b.category_id, c.name_en, c.name_hi, c.name_mr, b.city,
             extensions.st_distance(b.location, v_point) as distance_m,
             (select i.storage_path from public.business_images i where i.business_id = b.id
               order by i.sort_order, i.created_at limit 1) as cover_path,
             public.business_open_now(b.id) as is_open_now
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

revoke execute on function public.nearby_businesses(double precision, double precision, uuid, numeric, boolean, text, int, int) from public;
revoke execute on function public.search_services(double precision, double precision, text, uuid, numeric, boolean, text, int, int) from public;
grant execute on function public.nearby_businesses(double precision, double precision, uuid, numeric, boolean, text, int, int) to anon, authenticated;
grant execute on function public.search_services(double precision, double precision, text, uuid, numeric, boolean, text, int, int) to anon, authenticated;
