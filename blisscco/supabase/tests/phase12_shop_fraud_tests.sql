-- Refer-a-Shop fraud protection tests (TEST project only; rolls back). Run after 0031.
-- NOT RUN by the assistant (no database available) - please run and send me any error text.
begin;
do $$
declare
  r uuid := gen_random_uuid(); o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid();
  adm uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
  cat uuid; b1 uuid; ref uuid; comp uuid; j jsonb; s text; rs text; n int; ok boolean;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (r, 'r@t31.dev', now(), '{"signup_role":"owner"}'), (o1, 'o1@t31.dev', now(), '{"signup_role":"owner"}'),
    (o2, 'o2@t31.dev', now(), '{"signup_role":"owner"}'), (adm, 'adm@t31.dev', now(), '{}'), (stranger, 's@t31.dev', now(), '{}');
  update public.profiles set role = 'admin' where id = adm;
  select id into cat from public.business_categories limit 1;

  -- T1: helpers
  if public.norm_text('  Ram''s  Salon! ') <> 'ramssalon' then raise exception 'TEST FAIL: norm_text'; end if;
  if public.shop_hash(null) is not null or public.shop_hash('1.2.3.4') = public.shop_hash('1.2.3.5') then raise exception 'TEST FAIL: shop_hash'; end if;

  -- T2: the claim function keeps the FIRST attribution, refuses self referral, and logs every attempt
  insert into public.shop_referral_codes (user_id, code) values (r, 'S9TESTA');
  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := public.claim_shop_referral('s9testa', repeat('e', 32), repeat('f', 32));
  if not ok then raise exception 'TEST FAIL: first claim refused'; end if;
  ok := public.claim_shop_referral('S9TESTA', repeat('e', 32), repeat('f', 32));
  if ok then raise exception 'TEST FAIL: second claim accepted'; end if;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', r, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := public.claim_shop_referral('S9TESTA');
  if ok then raise exception 'TEST FAIL: self referral accepted'; end if;
  reset role;
  select count(*) into n from public.shop_referral_claim_log where outcome = 'accepted' and owner_id = o2;
  if n <> 1 then raise exception 'TEST FAIL: accepted claim not logged'; end if;
  select count(*) into n from public.shop_referral_claim_log where outcome = 'already_attributed' and owner_id = o2;
  if n <> 1 then raise exception 'TEST FAIL: duplicate claim not logged'; end if;
  select count(*) into n from public.shop_referral_claim_log where outcome = 'self_referral' and owner_id = r;
  if n <> 1 then raise exception 'TEST FAIL: self referral not logged'; end if;

  -- T3: risk - the network alone NEVER puts a referral on hold; several signals together do
  insert into public.businesses (owner_id, category_id, name, phone, latitude, longitude, status)
  values (o1, cat, 'Risk Shop One', '9876501234', 18.5, 73.8, 'approved') returning id into b1;
  insert into public.shop_referrals (referrer_id, referred_owner_id, code, status, qualified_business_id, qualified_phone_key, qualified_at)
  values (r, o1, 'S9TESTA', 'qualified', b1, '9876501234', now()) returning id into ref;
  insert into public.shop_device_log (user_id, device_id, device_fp, ip_hash) values
    (r, repeat('c', 32), '', repeat('b', 64)), (o1, repeat('d', 32), '', repeat('b', 64));
  perform public.evaluate_shop_referral_risk(ref);
  select risk_status, risk_score into rs, n from public.shop_referrals where id = ref;
  if rs <> 'clear' or n <> 15 then raise exception 'TEST FAIL: network alone changed status (% / %)', rs, n; end if;
  insert into public.shop_device_log (user_id, device_id, device_fp, ip_hash) values
    (r, repeat('a', 32), '', repeat('b', 64)), (o1, repeat('a', 32), '', repeat('b', 64));
  perform public.evaluate_shop_referral_risk(ref);
  select risk_status, risk_score into rs, n from public.shop_referrals where id = ref;
  if rs <> 'suspicious' or n < 50 then raise exception 'TEST FAIL: two signals did not hold the referral (% / %)', rs, n; end if;
  select count(*) into n from public.shop_referral_reviews where referral_id = ref and action = 'risk_flagged';
  if n <> 1 then raise exception 'TEST FAIL: flag not written to the audit trail'; end if;

  -- T4: only an admin can review; a note is required; decisions are audited
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.admin_review_shop_referral(ref, 'approve', 'trying to approve'); raise exception 'TEST FAIL: non-admin reviewed';
  exception when others then if sqlerrm <> 'admin only' then raise; end if; end;
  begin perform public.admin_award_competition_reward(gen_random_uuid(), null); raise exception 'TEST FAIL: non-admin awarded';
  exception when others then if sqlerrm <> 'admin only' then raise; end if; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.admin_review_shop_referral(ref, 'reject', 'x'); raise exception 'TEST FAIL: short note accepted';
  exception when others then if sqlerrm <> 'reason_required' then raise; end if; end;
  perform public.admin_review_shop_referral(ref, 'start_review', null);
  perform public.admin_review_shop_referral(ref, 'fraud', 'same browser as referrer, fake shop');
  begin perform public.admin_review_shop_referral(ref, 'approve', 'changed my mind'); raise exception 'TEST FAIL: approved a fraudulent referral';
  exception when others then if sqlerrm <> 'invalid_state' then raise; end if; end;
  reset role;
  select status, risk_status into s, rs from public.shop_referrals where id = ref;
  if s <> 'revoked' or rs <> 'fraudulent' then raise exception 'TEST FAIL: fraud decision not stored (% / %)', s, rs; end if;
  select count(*) into n from public.shop_referral_reviews where referral_id = ref and actor_id = adm;
  if n <> 2 then raise exception 'TEST FAIL: expected 2 admin entries in the trail, got %', n; end if;
  begin update public.shop_referral_reviews set note = 'edited' where referral_id = ref; raise exception 'TEST FAIL: audit row edited';
  exception when others then if sqlerrm <> 'append_only' then raise; end if; end;
  begin delete from public.shop_referral_reviews where referral_id = ref; raise exception 'TEST FAIL: audit row deleted';
  exception when others then if sqlerrm <> 'append_only' then raise; end if; end;

  -- T5: winner protection - reward only through the award function, only once, ledger is append-only
  insert into public.shop_competitions (title, starts_at, ends_at, reward_amount_inr, status)
  values ('T31 competition', now() - interval '2 days', now() - interval '1 day', 1000, 'pending_verification') returning id into comp;
  begin
    insert into public.growth_credit_ledger (owner_id, delta_inr, reason, competition_id) values (r, 1000, 'competition_reward', comp);
    raise exception 'TEST FAIL: reward inserted around the award function';
  exception when others then if sqlerrm <> 'reward_not_allowed' then raise; end if; end;
  begin update public.shop_competitions set reward_amount_inr = 5000 where id = comp; raise exception 'TEST FAIL: prize changed while verifying';
  exception when others then if sqlerrm <> 'competition_locked' then raise; end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.admin_award_competition_reward(comp, null);
  if (j ->> 'awarded')::boolean or j ->> 'reason' <> 'no_winner' then raise exception 'TEST FAIL: award without a winner: %', j; end if;
  perform public.admin_close_competition_without_winner(comp, 'nobody valid');
  begin perform public.admin_award_competition_reward(comp, null); raise exception 'TEST FAIL: award after close';
  exception when others then if sqlerrm <> 'already_awarded' then raise; end if; end;
  reset role;
  begin update public.shop_competitions set status = 'pending_verification' where id = comp; raise exception 'TEST FAIL: ended competition reopened';
  exception when others then if sqlerrm <> 'competition_locked' then raise; end if; end;
  select count(*) into n from public.growth_credit_ledger where competition_id = comp;
  if n <> 0 then raise exception 'TEST FAIL: credit exists for a competition without winner'; end if;
  raise notice 'phase12 shop fraud tests: all passed';
end $$;
rollback;
