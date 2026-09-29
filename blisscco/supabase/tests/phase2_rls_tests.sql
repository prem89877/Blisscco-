-- Phase 1-2 security tests. Run in the SQL Editor of a TEST Supabase project (never production).
-- Everything is rolled back at the end. Any failed check raises 'TEST FAIL: ...'.
-- Covers: Test 1 (no public listing before approval), Test 3 (cross-owner access), Test 11 (admin ops blocked).

begin;

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  biz uuid; cat uuid; n int; v_ok boolean;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (a, 'a@test.dev', now(), '{"signup_role":"owner"}'),
    (b, 'b@test.dev', now(), '{"signup_role":"owner"}'),
    (c, 'c@test.dev', now(), '{"signup_role":"admin"}'),   -- attempt to self-assign admin at signup
    (adm, 'adm@test.dev', now(), '{}');
  update public.profiles set role = 'admin' where id = adm;
  select id into cat from public.business_categories limit 1;

  -- Signup can never yield admin
  if (select role from public.profiles where id = c) <> 'customer' then
    raise exception 'TEST FAIL: signup metadata produced non-customer role'; end if;

  -- Owner A creates a draft business
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.businesses (owner_id, category_id, name) values (a, cat, 'Test Salon') returning id into biz;

  -- Owner cannot self-approve
  begin
    update public.businesses set status = 'approved' where id = biz;
    raise exception 'TEST FAIL: owner changed status directly';
  exception when insufficient_privilege then null; end;

  -- Owner cannot self-promote
  begin
    update public.profiles set role = 'admin' where id = a;
    raise exception 'TEST FAIL: user promoted self to admin';
  exception when insufficient_privilege then null; end;

  -- Incomplete application is rejected
  begin
    perform public.submit_business_application(biz);
    raise exception 'TEST FAIL: incomplete application submitted';
  exception when check_violation then null; end;

  -- TEST 1: draft business is invisible to the public
  reset role; set local role anon;
  select count(*) into n from public.public_businesses where id = biz;
  if n <> 0 then raise exception 'TEST FAIL: draft business visible publicly'; end if;
  begin
    perform 1 from public.businesses limit 1;
    raise exception 'TEST FAIL: anon can read base businesses table';
  exception when insufficient_privilege then null; end;

  -- TEST 3: owner B cannot touch owner A's business or services
  reset role;
  insert into public.services (business_id, name, service_category, price_inr, duration_minutes)
  values (biz, 'Facial', 'facial', 500, 45);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.businesses where id = biz;
  if n <> 0 then raise exception 'TEST FAIL: B can read A''s draft business'; end if;
  begin
    insert into public.services (business_id, name, service_category, price_inr, duration_minutes)
    values (biz, 'Hack', 'x', 1, 30);
    raise exception 'TEST FAIL: B inserted a service into A''s business';
  exception when insufficient_privilege then null; end;
  update public.services set price_inr = 1 where business_id = biz;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST FAIL: B updated A''s service'; end if;

  -- TEST 11: non-admin cannot run admin operations
  begin
    perform public.admin_review_business(biz, true, null);
    raise exception 'TEST FAIL: non-admin approved a business';
  exception when insufficient_privilege then null; end;
  reset role; set local role anon;
  begin
    perform public.admin_review_business(biz, true, null);
    raise exception 'TEST FAIL: anon could execute admin function';
  exception when insufficient_privilege then null; end;

  -- Admin: cannot approve a draft (must be pending), so state machine holds
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_review_business(biz, true, null);
    raise exception 'TEST FAIL: admin approved a draft that was never submitted';
  exception when raise_exception then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
  end;

  reset role;
  raise notice 'ALL PHASE 1-2 SECURITY TESTS PASSED';
end $$;

rollback;
