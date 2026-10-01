-- Phase 5 tests (TEST project only). Rolls back at the end. Covers Test 10 (real coordinates, prices, status).
begin;
do $$
declare
  o uuid := gen_random_uuid(); cat uuid; a uuid; b uuid; c uuid; n int;
  lat constant double precision := 18.5204; lng constant double precision := 73.8567;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (o, 'own5@test.dev', now(), '{"signup_role":"owner"}');
  select id into cat from public.business_categories limit 1;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status)
    values (o, cat, 'Near Salon', lat + 0.009, lng, 'approved') returning id into a;   -- ~1 km
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status)
    values (o, cat, 'Far Salon', lat + 0.06, lng, 'approved') returning id into b;     -- ~6.7 km
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status)
    values (o, cat, 'Draft Salon', lat + 0.004, lng, 'draft') returning id into c;     -- near but not approved
  insert into public.services (business_id, service_category, price_inr)
    select x, 'Facial', 500 from unnest(array[a, b, c]) x;

  set local role anon;
  select count(*) into n from public.nearby_businesses(lat, lng);
  if n <> 1 then raise exception 'TEST FAIL: expected 1 nearby shop, got %', n; end if;
  select count(*) into n from public.search_services(lat, lng, 'facial');
  if n <> 1 then raise exception 'TEST FAIL: expected 1 facial result, got %', n; end if;
  select count(*) into n from public.search_services(lat, lng, '%');
  if n <> 0 then raise exception 'TEST FAIL: wildcard % matched %', '%', n; end if;
  begin
    perform 1 from public.nearby_businesses(999, 0);
    raise exception 'TEST FAIL: invalid latitude accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform 1 from public.businesses limit 1;
    raise exception 'TEST FAIL: anon can read base table';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'ALL PHASE 5 DISCOVERY TESTS PASSED';
end $$;
rollback;
