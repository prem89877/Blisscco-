-- Mega Store campaign-entry QR tests (0041). TEST project only; everything rolls back at the end.
-- Run after 0041. NOT RUN by the assistant (no database available) - please run and send me any error text.
-- Any failed check raises 'TEST FAIL: ...'. If it ends with "ROLLBACK" and no error, every check passed.
begin;
do $$
declare
  ost uuid := gen_random_uuid(); osa uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid();
  cat uuid; ms uuid; camp uuid; sa uuid; v_code text; v_res text; n int; j jsonb; v_terms uuid;
begin
  -- ---------- SETUP (as the table owner) ----------
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (ost, 'ost@t16.dev', now(), '{"signup_role":"owner"}'), (osa, 'osa@t16.dev', now(), '{"signup_role":"owner"}'),
    (c1, 'c1@t16.dev', now(), '{"signup_role":"customer"}'), (c2, 'c2@t16.dev', now(), '{"signup_role":"customer"}'),
    (c3, 'c3@t16.dev', null, '{"signup_role":"customer"}'),                                  -- c3: e-mail NOT verified
    (c4, 'c4@t16.dev', now(), '{"signup_role":"customer"}');                                 -- c4: only used for the duplicate-key check
  update public.profiles set email_verified = true where id in (c1, c2, c4);
  update public.profiles set email_verified = false where id = c3;
  select id into cat from public.business_categories limit 1;
  insert into public.businesses (owner_id, category_id, name, phone, latitude, longitude, status)
    values (osa, cat, 'T16 Shop', '9876516001', 18.5, 73.8, 'approved') returning id into sa;
  insert into public.mega_stores (owner_id, name, status) values (ost, 'T16 Mega Store', 'approved') returning id, code into ms, v_code;

  reset role; perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  camp := public.megastore_save_campaign('T16 campaign', null, now(), now() + interval '30 days', 'percent', 10, 200, 0, 0, false, 5000, true);
  perform public.megastore_add_shop(sa);
  perform public.megastore_set_campaign_status('active');

  -- ---------- T1: the database itself refuses a second entry for the same account ----------
  reset role;
  insert into public.mega_enrollments (campaign_id, customer_id, declared_female) values (camp, c4, true);
  begin
    insert into public.mega_enrollments (campaign_id, customer_id, declared_female) values (camp, c4, true);
    raise exception 'TEST FAIL: the database accepted a duplicate enrolment';
  exception when unique_violation then null;
  end;

  -- ---------- T2: before login the QR page loads, but joining needs an account ----------
  reset role; perform set_config('request.jwt.claims', '{}', true); set local role anon;
  j := public.get_mega_campaign_public(v_code);
  if not (j->>'found')::boolean or j->'campaign'->>'state' <> 'active' or j->'me' <> 'null'::jsonb then
    raise exception 'TEST FAIL: public QR page data wrong before login (%)', j;
  end if;
  begin
    perform public.join_mega_campaign(v_code, true, true);
    raise exception 'TEST FAIL: an anonymous visitor joined';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
  end;

  -- ---------- T3: first join works, returns 'joined', and issues NO reward ----------
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); set local role authenticated;
  v_res := public.join_mega_campaign(v_code, true, false);
  if v_res <> 'joined' then raise exception 'TEST FAIL: first join returned % instead of joined', v_res; end if;
  reset role;
  select count(*) into n from public.mega_enrollments where campaign_id = camp and customer_id = c1;
  if n <> 1 then raise exception 'TEST FAIL: expected 1 enrolment, found %', n; end if;
  select count(*) into n from public.mega_rewards where customer_id = c1;
  if n <> 0 then raise exception 'TEST FAIL: scanning / joining created % reward(s)', n; end if;

  -- ---------- T4: scanning again: friendly answer, still ONE row ----------
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); set local role authenticated;
  v_res := public.join_mega_campaign(v_code, true, false);
  if v_res <> 'already_joined' then raise exception 'TEST FAIL: second join returned % instead of already_joined', v_res; end if;
  begin v_res := public.join_mega_campaign(v_code, false, false); exception when others then v_res := sqlerrm; end;   -- the woman confirmation is still required
  if v_res not like '%declare_required%' then raise exception 'TEST FAIL: repeat join without the confirmation returned %', v_res; end if;
  reset role;
  select count(*) into n from public.mega_enrollments where campaign_id = camp and customer_id = c1;
  if n <> 1 then raise exception 'TEST FAIL: duplicate scan made % enrolments', n; end if;

  -- ---------- T5: the QR page tells the joined customer so ----------
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.get_mega_campaign_public(v_code);
  if not (j->'me'->>'enrolled')::boolean or (j->'me'->>'earned')::int <> 0 then raise exception 'TEST FAIL: page does not show the entry (%)', j->'me'; end if;

  -- ---------- T6: not eligible: owner account, unverified e-mail, missing woman confirmation ----------
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', osa, 'role', 'authenticated')::text, true); set local role authenticated;
  begin v_res := public.join_mega_campaign(v_code, true, true); exception when others then v_res := sqlerrm; end;
  if v_res not like '%customer_only%' then raise exception 'TEST FAIL: owner account was not refused (%)', v_res; end if;

  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c3, 'role', 'authenticated')::text, true); set local role authenticated;
  begin v_res := public.join_mega_campaign(v_code, true, true); exception when others then v_res := sqlerrm; end;
  if v_res not like '%email_not_verified%' then raise exception 'TEST FAIL: unverified e-mail was not refused (%)', v_res; end if;

  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); set local role authenticated;
  begin v_res := public.join_mega_campaign(v_code, false, true); exception when others then v_res := sqlerrm; end;
  if v_res not like '%declare_required%' then raise exception 'TEST FAIL: missing confirmation was not refused (%)', v_res; end if;
  begin v_res := public.join_mega_campaign('does-not-exist', true, true); exception when others then v_res := sqlerrm; end;
  if v_res not like '%not_found%' then raise exception 'TEST FAIL: a wrong QR code was not refused (%)', v_res; end if;

  -- ---------- T7: paused campaign: no NEW entries, the existing entry still says "already joined" ----------
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.megastore_set_campaign_status('paused');
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.get_mega_campaign_public(v_code);
  if j->'campaign'->>'state' <> 'paused' or (j->'campaign'->>'registrations_open')::boolean then raise exception 'TEST FAIL: paused state wrong (%)', j->'campaign'; end if;
  begin v_res := public.join_mega_campaign(v_code, true, true); exception when others then v_res := sqlerrm; end;
  if v_res not like '%registrations_paused%' then raise exception 'TEST FAIL: a paused campaign accepted a new entry (%)', v_res; end if;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); set local role authenticated;
  v_res := public.join_mega_campaign(v_code, true, true);
  if v_res <> 'already_joined' then raise exception 'TEST FAIL: joined customer on a paused campaign got %', v_res; end if;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.megastore_set_campaign_status('active');

  -- ---------- T8: published customer terms must be accepted, and the acceptance is stored with the entry ----------
  reset role;
  insert into public.mega_terms (campaign_id, scope, version, title, body_md)
    values (camp, 'customer', 1, 'T16 customer terms', 'These are the test terms for the campaign entry.') returning id into v_terms;
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); set local role authenticated;
  begin v_res := public.join_mega_campaign(v_code, true, false); exception when others then v_res := sqlerrm; end;
  if v_res not like '%terms_required%' then raise exception 'TEST FAIL: joined without accepting the terms (%)', v_res; end if;
  reset role;
  select count(*) into n from public.mega_enrollments where campaign_id = camp and customer_id = c2;
  if n <> 0 then raise exception 'TEST FAIL: an entry exists although the terms were not accepted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); set local role authenticated;
  v_res := public.join_mega_campaign(v_code, true, true);
  if v_res <> 'joined' then raise exception 'TEST FAIL: join with accepted terms returned %', v_res; end if;
  reset role;
  select count(*) into n from public.mega_terms_acceptances where terms_id = v_terms and user_id = c2 and campaign_id = camp;
  if n <> 1 then raise exception 'TEST FAIL: terms acceptance not recorded (%)', n; end if;
  select count(*) into n from public.mega_rewards where customer_id in (c1, c2);
  if n <> 0 then raise exception 'TEST FAIL: entries created % reward(s)', n; end if;

  -- ---------- T9: ended campaign: nobody can join, the page says it is closed ----------
  perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.megastore_set_campaign_status('ended');
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c3, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.get_mega_campaign_public(v_code);
  if j->'campaign' <> 'null'::jsonb or not (j->>'closed')::boolean then raise exception 'TEST FAIL: ended campaign page data wrong (%)', j; end if;
  begin v_res := public.join_mega_campaign(v_code, true, true); exception when others then v_res := sqlerrm; end;
  if v_res not like '%not_active%' then raise exception 'TEST FAIL: an ended campaign accepted an entry (%)', v_res; end if;

  reset role;
  raise notice 'ALL MEGA STORE ENTRY QR TESTS PASSED';
end $$;
rollback;
