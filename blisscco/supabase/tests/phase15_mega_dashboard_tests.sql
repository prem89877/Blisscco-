-- Mega Store dashboard tests (0040). TEST project only; everything rolls back at the end.
-- Run after 0040 (still valid after 0041). NOT RUN by the assistant (no database available) - please run and send me any error text.
-- Any failed check raises 'TEST FAIL: ...'. If it ends with "ROLLBACK" and no error, every check passed.
begin;
do $$
declare
  adm uuid := gen_random_uuid(); ost uuid := gen_random_uuid(); mgr uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
  osa uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  cat uuid; ms uuid; camp uuid; sa uuid; shop_ids uuid[] := '{}'; v_id uuid; n int; j jsonb; st text; i int;
begin
  -- ---------- SETUP (as the table owner) ----------
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (adm, 'adm@t15.dev', now(), '{}'),
    (ost, 'ost@t15.dev', now(), '{"signup_role":"owner"}'), (mgr, 'mgr@t15.dev', now(), '{"signup_role":"owner"}'),
    (stranger, 'str@t15.dev', now(), '{"signup_role":"owner"}'), (osa, 'osa@t15.dev', now(), '{"signup_role":"owner"}'),
    (c1, 'c1@t15.dev', now(), '{"signup_role":"customer"}'), (c2, 'c2@t15.dev', now(), '{"signup_role":"customer"}'),
    (c3, 'c3@t15.dev', now(), '{"signup_role":"customer"}');                          -- c3: has NOT joined (used for the paused sign-up check)
  update public.profiles set role = 'admin' where id = adm;
  update public.profiles set email_verified = true where id in (c1, c2, c3);
  select id into cat from public.business_categories limit 1;

  -- 12 approved shops owned by osa, so the 10-shop cap can be tested
  for i in 1..12 loop
    insert into public.businesses (owner_id, category_id, name, phone, latitude, longitude, status)
      values (osa, cat, 'T15 Shop ' || i, '98765150' || lpad(i::text, 2, '0'), 18.5, 73.8, 'approved') returning id into v_id;
    shop_ids := shop_ids || v_id;
  end loop;
  sa := shop_ids[1];

  insert into public.mega_stores (owner_id, name, status) values (ost, 'T15 Mega Store', 'approved') returning id into ms;
  insert into public.mega_store_members (mega_store_id, user_id, member_role, added_by) values (ms, mgr, 'manager', ost);

  -- ---------- T1: default limits exist ----------
  select count(*) into n from public.mega_platform_limits where min_discount_pct = 5 and max_discount_pct = 30 and max_partner_shops = 10;
  if n <> 1 then raise exception 'TEST FAIL: default limits row missing or wrong'; end if;

  -- ---------- T2: save campaign enforces the discount and budget limits ----------
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.megastore_save_campaign('T15 campaign', null, now(), now() + interval '30 days', 'percent', 90);
    raise exception 'TEST FAIL: a 90 percent discount was accepted';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%discount_out_of_range%' then raise exception 'TEST FAIL: wrong error for 90 percent: %', sqlerrm; end if;
  end;
  begin
    perform public.megastore_save_campaign('T15 campaign', null, now(), now() + interval '30 days', 'percent', 10, null, null, null, true, 5, true);
    raise exception 'TEST FAIL: a budget of 5 rupees was accepted';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%budget_out_of_range%' then raise exception 'TEST FAIL: wrong error for tiny budget: %', sqlerrm; end if;
  end;
  camp := public.megastore_save_campaign('T15 campaign', null, now(), now() + interval '30 days', 'percent', 10, 200, 0, 0, false, null, true);

  -- ---------- T3: a campaign cannot start without a budget, nor without shops ----------
  begin
    perform public.megastore_set_campaign_status('active');
    raise exception 'TEST FAIL: campaign started without budget';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%budget_required%' then raise exception 'TEST FAIL: wrong error for no budget: %', sqlerrm; end if;
  end;
  perform public.megastore_save_campaign('T15 campaign', null, now(), now() + interval '30 days', 'percent', 10, 200, 0, 0, false, 5000, true);
  begin
    perform public.megastore_set_campaign_status('active');
    raise exception 'TEST FAIL: campaign started without shops';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%no_shops%' then raise exception 'TEST FAIL: wrong error for no shops: %', sqlerrm; end if;
  end;

  -- ---------- T4: at most 10 partner shops ----------
  for i in 1..10 loop perform public.megastore_add_shop(shop_ids[i]); end loop;
  begin
    perform public.megastore_add_shop(shop_ids[11]);
    raise exception 'TEST FAIL: an 11th partner shop was accepted';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%too_many_shops%' then raise exception 'TEST FAIL: wrong error for 11th shop: %', sqlerrm; end if;
  end;
  perform public.megastore_add_shop(shop_ids[1]);                                   -- adding a shop that is already selected is not an error

  perform public.megastore_set_campaign_status('active');
  select status into st from public.mega_campaigns where id = camp;
  if st <> 'active' then raise exception 'TEST FAIL: campaign did not start (%)', st; end if;

  -- ---------- T5: budget can only go up; only the primary owner can raise it ----------
  begin
    perform public.megastore_set_campaign_budget(camp, 2000);
    raise exception 'TEST FAIL: budget was lowered on a running campaign';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%budget_decrease_blocked%' then raise exception 'TEST FAIL: wrong error for budget decrease: %', sqlerrm; end if;
  end;
  j := public.megastore_increase_budget(1000);
  if (j->>'budget_inr')::numeric <> 6000 then raise exception 'TEST FAIL: budget not increased to 6000 (%)', j; end if;
  begin
    perform public.megastore_increase_budget(0);
    raise exception 'TEST FAIL: zero increase accepted';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%invalid_budget%' then raise exception 'TEST FAIL: wrong error for zero increase: %', sqlerrm; end if;
  end;
  begin
    perform public.megastore_increase_budget(99999999);
    raise exception 'TEST FAIL: budget above the platform maximum accepted';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%budget_out_of_range%' then raise exception 'TEST FAIL: wrong error for huge budget: %', sqlerrm; end if;
  end;

  reset role; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.megastore_increase_budget(100);
    raise exception 'TEST FAIL: a manager raised the budget';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%not_found%' then raise exception 'TEST FAIL: wrong error for manager budget: %', sqlerrm; end if;
  end;
  begin
    perform public.megastore_set_campaign_status('paused');
    raise exception 'TEST FAIL: a manager paused the campaign';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%not_found%' then raise exception 'TEST FAIL: wrong error for manager pause: %', sqlerrm; end if;
  end;

  -- ---------- T6: dashboard access ----------
  j := public.get_my_megastore();
  if j->>'my_role' <> 'manager' or (j->>'can_manage')::boolean then raise exception 'TEST FAIL: manager role not reported (%)', j->>'my_role'; end if;
  if j->'store'->>'name' <> 'T15 Mega Store' then raise exception 'TEST FAIL: manager cannot read the dashboard'; end if;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.get_my_megastore();
  if j->'store' <> 'null'::jsonb then raise exception 'TEST FAIL: a stranger owner can see another Mega Store'; end if;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.get_my_megastore();
    raise exception 'TEST FAIL: a customer opened the Mega Store dashboard';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%owner_only%' then raise exception 'TEST FAIL: wrong error for customer: %', sqlerrm; end if;
  end;

  -- ---------- T7: an unapproved store gets no campaign data ----------
  reset role;
  update public.mega_stores set status = 'suspended' where id = ms;
  perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.get_my_megastore();
  if j->'campaign' <> 'null'::jsonb or j->'store'->>'status' <> 'suspended' then raise exception 'TEST FAIL: suspended store still gets campaign data'; end if;
  reset role;
  update public.mega_stores set status = 'approved' where id = ms;
  update public.mega_campaigns set status = 'active' where id = camp;               -- the suspend step in the test did not go through the admin function

  -- ---------- T8: counts keep registrations, issued and redeemed apart ----------
  insert into public.mega_enrollments (campaign_id, customer_id, declared_female) values (camp, c1, true), (camp, c2, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.get_my_megastore();
  if (j->'stats'->>'enrolled')::int <> 2 then raise exception 'TEST FAIL: registrations count wrong (%)', j->'stats'; end if;
  if (j->'stats'->>'issued')::int <> 0 or (j->'stats'->>'redeemed')::int <> 0 or (j->'stats'->>'verified_services')::int <> 0 then
    raise exception 'TEST FAIL: registrations leaked into issued / redeemed / services (%)', j->'stats';
  end if;
  if (j->'stats'->>'discount_cost_inr')::numeric <> 0 then raise exception 'TEST FAIL: cost is not zero before any redemption'; end if;
  if (j->'budget'->>'remaining_inr')::numeric <> 6000 then raise exception 'TEST FAIL: remaining budget wrong (%)', j->'budget'; end if;
  if jsonb_array_length(j->'shops') <> 10 or j->'shops'->0->>'partner_status' <> 'invited' then raise exception 'TEST FAIL: per-shop status missing (%)', j->'shops'->0; end if;

  -- ---------- T9: pause rules ----------
  perform public.megastore_set_campaign_status('paused');
  j := public.get_my_megastore();
  if (j->>'issuance_open')::boolean then raise exception 'TEST FAIL: issuance still open while paused'; end if;
  if (j->>'registrations_open')::boolean then raise exception 'TEST FAIL: registrations still open while paused (default blocks them)'; end if;
  reset role;
  begin                                                                              -- the database itself refuses a NEW reward on a paused campaign
    insert into public.mega_rewards (campaign_id, mega_store_id, customer_id, booking_id, business_id, business_name, code, reward_type, reward_value, status)
      values (camp, ms, c1, gen_random_uuid(), sa, 'x', 'MS-TEST', 'percent', 10, 'active');
    raise exception 'TEST FAIL: a reward was inserted on a paused campaign';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%campaign_not_active%' then raise exception 'TEST FAIL: wrong error for paused insert: %', sqlerrm; end if;
  end;
  -- a NEW customer (c3) cannot register while paused. (c1 / c2 already joined: since 0041 they just get 'already_joined'.)
  perform set_config('request.jwt.claims', json_build_object('sub', c3, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.join_mega_campaign((select code from public.mega_stores where id = ms), true);
    raise exception 'TEST FAIL: a customer could register while the campaign is paused';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%registrations_paused%' then raise exception 'TEST FAIL: wrong error for paused registration: %', sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.megastore_set_campaign_status('active');                            -- resume works
  select status into st from public.mega_campaigns where id = camp;
  if st <> 'active' then raise exception 'TEST FAIL: resume did not work (%)', st; end if;

  -- ---------- T10: public limits are readable by an owner ----------
  j := public.get_mega_limits();
  if (j->>'max_partner_shops')::int <> 10 then raise exception 'TEST FAIL: limits not readable'; end if;

  -- ---------- T11: only admin can change the limits ----------
  begin
    perform public.admin_set_mega_limits(1, 99, 1, 9999, 10, 100, 9999999);
    raise exception 'TEST FAIL: an owner changed the platform limits';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%admin only%' then raise exception 'TEST FAIL: wrong error for owner limits change: %', sqlerrm; end if;
  end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.admin_set_mega_limits(5, 40, 50, 1000, 10, 1000, 1000000);
  j := public.get_mega_limits();
  if (j->>'max_discount_pct')::numeric <> 40 then raise exception 'TEST FAIL: admin limit change did not stick'; end if;
  begin
    perform public.admin_set_mega_limits(50, 10, 50, 1000, 10, 1000, 1000000);
    raise exception 'TEST FAIL: min above max accepted';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%invalid_limits%' then raise exception 'TEST FAIL: wrong error for bad limits: %', sqlerrm; end if;
  end;

  reset role;
  raise notice 'ALL MEGA STORE DASHBOARD TESTS PASSED';
end $$;
rollback;
