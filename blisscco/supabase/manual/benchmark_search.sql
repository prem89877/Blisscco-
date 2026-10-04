-- Search benchmark. READ-ONLY (changes nothing). Run in the Supabase SQL Editor of a TEST project with realistic data volume.
-- Order: (1) run STEP 1-3 now  (2) run 0020  (3) run STEP 1-3 again  (4) compare the numbers.
-- To get the "before" numbers after 0020 is already run, first run the two DROP lines in STEP 0, benchmark, then re-run 0020.

-- STEP 0 (optional, for a "before" run only)
-- drop index if exists public.services_search_cover_idx;
-- drop index if exists public.business_images_cover_lookup_idx;

-- STEP 1: how big is the data?
select (select count(*) from public.businesses where status = 'approved') as approved_shops,
       (select count(*) from public.services where is_active)             as active_services,
       (select count(*) from public.business_images)                      as images;

-- STEP 2: end-to-end time of the real function (average of 20 runs per search word, centre = first approved shop).
do $$
declare lat double precision; lng double precision; w text; i int; t0 timestamptz; ms numeric; n int;
begin
  select extensions.st_y(location::extensions.geometry), extensions.st_x(location::extensions.geometry)
    into lat, lng from public.businesses where status = 'approved' and location is not null limit 1;
  if lat is null then raise notice 'No approved shop with a location. Add test data first.'; return; end if;
  foreach w in array array['facial', 'pedicur', 'hairspa', 'salon', 'bridal makeup'] loop
    t0 := clock_timestamp();
    for i in 1..20 loop
      select count(*) into n from public.search_services(lat, lng, w, null, null, false, 'distance', 20, 0);
    end loop;
    ms := round((extract(epoch from clock_timestamp() - t0) * 1000 / 20)::numeric, 2);
    raise notice 'search "%": % ms per call, % rows', w, ms, n;
  end loop;
end $$;

-- STEP 3: query plan of the CANDIDATE set (same joins and filters as search_services, before the fuzzy score).
-- Look for: "Index Scan using businesses_location_gix", "Index Only Scan using services_search_cover_idx",
-- "Index Scan using business_images_cover_lookup_idx", and the Execution Time at the bottom.
explain (analyze, buffers)
with c as (select location from public.businesses where status = 'approved' and location is not null limit 1)
select s.id, s.price_inr, s.name, s.service_category, b.name,
       (select i.storage_path from public.business_images i where i.business_id = b.id
         order by i.sort_order, i.created_at limit 1) as cover_path
  from c, public.services s
  join public.businesses b on b.id = s.business_id
  join public.business_categories cat on cat.id = b.category_id
 where s.is_active and b.status = 'approved' and b.location is not null
   and extensions.st_dwithin(b.location, c.location, 5000);

-- STEP 4: are the indexes really used? (idx_scan should grow after STEP 2)
select indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) as size
  from pg_stat_user_indexes
 where relname in ('businesses', 'services', 'business_images')
 order by relname, indexrelname;
