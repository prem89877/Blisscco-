-- Mega Store database foundation tests (0038 + 0039). TEST project only; everything rolls back at the end.
-- Run after 0039. NOT RUN by the assistant (no database available) - please run and send me any error text.
-- Any failed check raises 'TEST FAIL: ...'. If it ends with "ROLLBACK" and no error, every check passed.
begin;
do $$
declare
  adm uuid := gen_random_uuid(); ost uuid := gen_random_uuid(); ost2 uuid := gen_random_uuid(); mgr uuid := gen_random_uuid();
  osa uuid := gen_random_uuid(); osb uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  cat uuid; ms uuid; ms2 uuid; v_code text; camp uuid; camp2 uuid; sa uuid; sb uuid; svc_a uuid; svc_b uuid;
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; b5 uuid; b6 uuid; b7 uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; code1 text; code2 text; code3 text; terms1 uuid; terms2 uuid; flag5 uuid;
  n int; n2 int; amt numeric; st text; j jsonb; ts timestamptz; exp1 timestamptz;
begin
  -- ---------- SETUP (as the table owner) ----------
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (adm, 'adm@t14.dev', now(), '{}'),
    (ost, 'ost@t14.dev', now(), '{"signup_role":"owner"}'), (ost2, 'ost2@t14.dev', now(), '{"signup_role":"owner"}'),
    (mgr, 'mgr@t14.dev', now(), '{"signup_role":"owner"}'),
    (osa, 'osa@t14.dev', now(), '{"signup_role":"owner"}'), (osb, 'osb@t14.dev', now(), '{"signup_role":"owner"}'),
    (c1, 'c1@t14.dev', now(), '{"signup_role":"customer"}'), (c2, 'c2@t14.dev', now(), '{"signup_role":"customer"}'),
    (c3, 'c3@t14.dev', now(), '{"signup_role":"customer"}');
  update public.profiles set role = 'admin' where id = adm;
  update public.profiles set email_verified = true where id in (c1, c2, c3);

  select id into cat from public.business_categories limit 1;
  insert into public.businesses (owner_id, category_id, name, phone, latitude, longitude, status)
    values (osa, cat, 'T14 Shop A', '9876514001', 18.5, 73.8, 'approved') returning id into sa;
  insert into public.businesses (owner_id, category_id, name, phone, latitude, longitude, status)
    values (osb, cat, 'T14 Shop B', '9876514002', 18.6, 73.9, 'approved') returning id into sb;
  insert into public.services (business_id, service_category, price_inr) values (sa, 'Facial', 500) returning id into svc_a;
  insert into public.services (business_id, service_category, price_inr) values (sb, 'Facial', 500) returning id into svc_b;

  insert into public.mega_stores (owner_id, name, status) values (ost, 'T14 Mega Store', 'approved') returning id, code into ms, v_code;
  insert into public.mega_stores (owner_id, name, status) values (ost2, 'T14 Other Mega', 'approved') returning id into ms2;
  -- active campaign: 10 percent reward, total discount budget Rs 100, several rewards may come from the same shop (test uses one shop)
  insert into public.mega_campaigns (mega_store_id, title, status, starts_at, ends_at, reward_type, reward_value, one_reward_per_shop, budget_inr)
    values (ms, 'T14 campaign', 'active', now() - interval '1 hour', now() + interval '30 days', 'percent', 10, false, 100) returning id into camp;
  insert into public.mega_campaigns (mega_store_id, title, status, starts_at, ends_at, reward_type, reward_value)
    values (ms2, 'T14 other campaign', 'draft', now(), now() + interval '30 days', 'flat', 50) returning id into camp2;
  insert into public.mega_campaign_shops (campaign_id, business_id) values (camp, sa), (camp, sb);

  -- T1: the primary owner is a member automatically; partner selection created participation records
  select count(*) into n from public.mega_store_members where mega_store_id = ms and user_id = ost and member_role = 'owner' and status = 'active';
  if n <> 1 then raise exception 'TEST FAIL: primary owner is not an active member'; end if;
  select count(*) into n from public.mega_partner_participation where campaign_id = camp and status = 'invited';
  if n <> 2 then raise exception 'TEST FAIL: participation records not created (%)', n; end if;

  -- ---------- T2: authorised owners ----------
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.mega_campaigns where id = camp;
  if n <> 0 then raise exception 'TEST FAIL: a stranger owner can see another store campaign'; end if;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.megastore_add_member('MGR@t14.dev');
  begin
    perform public.megastore_add_member('c1@t14.dev');
    raise exception 'TEST FAIL: a customer was added as authorised owner';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%user_not_eligible%' then raise exception 'TEST FAIL: wrong error for customer member: %', sqlerrm; end if;
  end;
  begin
    perform public.megastore_revoke_member(ost);
    raise exception 'TEST FAIL: primary owner was revoked';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%primary_owner_locked%' then raise exception 'TEST FAIL: wrong error for primary owner revoke: %', sqlerrm; end if;
  end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.mega_campaigns where id = camp;
  select count(*) into n2 from public.mega_stores where id = ms;
  if n <> 1 or n2 <> 1 then raise exception 'TEST FAIL: authorised member cannot see the store / campaign (% / %)', n, n2; end if;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.megastore_revoke_member(mgr);
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.mega_campaigns where id = camp;
  if n <> 0 then raise exception 'TEST FAIL: a revoked member still sees the campaign'; end if;

  -- ---------- T3: enrolment (authenticated customer, once per campaign) ----------
  reset role; set local role anon;
  begin
    perform public.join_mega_campaign(v_code, true);
    raise exception 'TEST FAIL: anonymous visitor joined a campaign';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%permission denied%' then raise exception 'TEST FAIL: wrong error for anonymous join: %', sqlerrm; end if;
  end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.join_mega_campaign(v_code, true);
  perform public.join_mega_campaign(v_code, true);                       -- second join: no error, no second row
  begin
    perform public.join_mega_campaign(v_code, false);
    raise exception 'TEST FAIL: joined without the declaration';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
  end;
  reset role;
  select count(*) into n from public.mega_enrollments where campaign_id = camp and customer_id = c1;
  if n <> 1 then raise exception 'TEST FAIL: customer enrolled % times', n; end if;
  begin
    insert into public.mega_enrollments (campaign_id, customer_id, declared_female) values (camp, c1, true);
    raise exception 'TEST FAIL: duplicate enrolment accepted';
  exception when unique_violation then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.join_mega_campaign(v_code, true);
    raise exception 'TEST FAIL: an owner account joined as a customer';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%customer_only%' then raise exception 'TEST FAIL: wrong error for owner join: %', sqlerrm; end if;
  end;
  reset role;

  -- ---------- T4: terms acceptance + partner participation ----------
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  terms1 := public.admin_publish_mega_terms('customer', 'Customer terms v1', 'These are the campaign terms for customers, version one.', camp);
  terms2 := public.admin_publish_mega_terms('customer', 'Customer terms v2', 'These are the campaign terms for customers, version two.', camp);
  reset role;
  select count(*) into n from public.mega_terms where campaign_id = camp and scope = 'customer' and version in (1, 2);
  if n <> 2 then raise exception 'TEST FAIL: terms versions not created'; end if;
  begin
    update public.mega_terms set body_md = 'changed after publishing, this must not be allowed' where id = terms1;
    raise exception 'TEST FAIL: published terms were edited';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%record_immutable%' then raise exception 'TEST FAIL: wrong error for terms edit: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.join_mega_campaign(v_code, true);
    raise exception 'TEST FAIL: joined without accepting the terms';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%terms_not_accepted%' then raise exception 'TEST FAIL: wrong error for missing terms: %', sqlerrm; end if;
  end;
  perform public.accept_mega_terms(camp, 'customer');
  perform public.join_mega_campaign(v_code, true);
  reset role;
  if (select terms_id from public.mega_enrollments where campaign_id = camp and customer_id = c2) is distinct from terms2 then
    raise exception 'TEST FAIL: enrolment does not point at the CURRENT terms version';
  end if;
  -- partner shop B declines: it leaves the campaign and cannot be forced back; shop A accepts; shop A cannot answer for shop B
  perform set_config('request.jwt.claims', json_build_object('sub', osa, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.partner_respond_mega_campaign(camp, sb, false);
    raise exception 'TEST FAIL: shop A answered for shop B';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%not_authorized%' then raise exception 'TEST FAIL: wrong error for foreign shop answer: %', sqlerrm; end if;
  end;
  perform public.partner_respond_mega_campaign(camp, sa, true);
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', osb, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.partner_respond_mega_campaign(camp, sb, false);
  reset role;
  select count(*) into n from public.mega_partner_participation where campaign_id = camp and business_id = sb and status = 'declined';
  select count(*) into n2 from public.mega_campaign_shops where campaign_id = camp and business_id = sb;
  if n <> 1 or n2 <> 0 then raise exception 'TEST FAIL: decline not recorded / shop not removed (% / %)', n, n2; end if;
  select count(*) into n from public.mega_partner_participation where campaign_id = camp and business_id = sa and status = 'accepted';
  if n <> 1 then raise exception 'TEST FAIL: acceptance not recorded'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.megastore_add_shop(sb);
    raise exception 'TEST FAIL: a shop that declined was added again';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%partner_declined%' then raise exception 'TEST FAIL: wrong error for re-adding a declined shop: %', sqlerrm; end if;
  end;
  reset role;

  -- ---------- T5: rewards (all at shop A, customer c1) ----------
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, started_at, completed_at)
  values (sa, 'T14 Shop A', c1, 'C One', svc_a, 'Facial', 500, 'walkin', 'completed', current_date, 1, now() + interval '30 minutes', now() + interval '1 hour') returning id into b1;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, started_at, completed_at)
  values (sa, 'T14 Shop A', c1, 'C One', svc_a, 'Facial', 500, 'walkin', 'completed', current_date, 2, now() + interval '30 minutes', now() + interval '1 hour') returning id into b2;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, started_at, completed_at)
  values (sa, 'T14 Shop A', c1, 'C One', svc_a, 'Facial', 500, 'walkin', 'completed', current_date, 3, now() + interval '30 minutes', now() + interval '1 hour') returning id into b3;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, started_at, completed_at)
  values (sa, 'T14 Shop A', c1, 'C One', svc_a, 'Facial', 500, 'walkin', 'completed', current_date, 4, now() + interval '30 minutes', now() + interval '1 hour') returning id into b4;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, started_at, completed_at)
  values (sa, 'T14 Shop A', c1, 'C One', svc_a, 'Facial', 500, 'walkin', 'completed', current_date, 5, now() + interval '30 minutes', now() + interval '1 hour') returning id into b5;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, started_at, completed_at)
  values (sa, 'T14 Shop A', c1, 'C One', svc_a, 'Facial', 500, 'walkin', 'completed', current_date, 6, now() + interval '30 minutes', now() + interval '1 hour') returning id into b6;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, started_at, completed_at)
  values (sa, 'T14 Shop A', c3, 'C Three', svc_a, 'Facial', 500, 'walkin', 'completed', current_date, 7, now() + interval '30 minutes', now() + interval '1 hour') returning id into b7;

  r1 := public.mega_try_issue_reward(b1);
  if r1 is null then raise exception 'TEST FAIL: first reward not issued'; end if;
  select code, status, issued_at, expires_at, reward_seq, (service_verification_id is not null)::text::jsonb, reward_value
    into code1, st, ts, exp1, n, j, amt from public.mega_rewards where id = r1;
  if st <> 'active' then raise exception 'TEST FAIL: clean reward is not active (%)', st; end if;
  if code1 !~ '^MS-[0-9A-F]{4}(-[0-9A-F]{4}){3}$' then raise exception 'TEST FAIL: reward code format (%)', code1; end if;
  if exp1 <> ((ts at time zone 'UTC') + interval '1 month') at time zone 'UTC' then raise exception 'TEST FAIL: expiry is not issue + 1 month'; end if;
  if n <> 1 or j <> 'true'::jsonb then raise exception 'TEST FAIL: reward not linked to a verified service / sequence (% / %)', n, j; end if;

  -- a forged direct insert: the server ignores the code, amount, dates and keeps its own
  insert into public.mega_rewards (campaign_id, mega_store_id, customer_id, booking_id, business_id, business_name, code, reward_type, reward_value, status, issued_at, expires_at)
  values (camp, ms, c1, b2, sa, 'forged', 'MS-AAAA', 'flat', 99999, 'active', now() - interval '10 days', now() + interval '10 years') returning id into r2;
  select code, reward_type, reward_value, expires_at, issued_at into code2, st, amt, exp1, ts from public.mega_rewards where id = r2;
  if code2 = 'MS-AAAA' or st <> 'percent' or amt <> 10 then raise exception 'TEST FAIL: forged code / amount was kept (% % %)', code2, st, amt; end if;
  if exp1 <> ((ts at time zone 'UTC') + interval '1 month') at time zone 'UTC' or ts < now() - interval '1 minute' then raise exception 'TEST FAIL: forged dates were kept'; end if;
  begin
    insert into public.mega_rewards (campaign_id, mega_store_id, customer_id, booking_id, business_id, business_name, code, reward_type, reward_value, status)
    values (camp, ms, c3, b7, sa, 'x', 'MS-BBBB', 'percent', 10, 'active');
    raise exception 'TEST FAIL: reward issued to a customer who never joined';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%not_enrolled%' then raise exception 'TEST FAIL: wrong error for not enrolled: %', sqlerrm; end if;
  end;

  r3 := public.mega_try_issue_reward(b3);
  r4 := public.mega_try_issue_reward(b4);
  r5 := public.mega_try_issue_reward(b5);
  if r3 is null or r4 is null or r5 is null then raise exception 'TEST FAIL: rewards 3-5 not issued'; end if;
  select count(*) into n from public.mega_rewards where id in (r3, r4, r5) and status = 'on_hold';
  if n <> 3 then raise exception 'TEST FAIL: rapid repeats not put on hold (%)', n; end if;
  select count(*) into n from public.mega_fraud_flags where reward_id in (r3, r4, r5) and flag_type = 'rapid_repeat' and status = 'open';
  if n <> 3 then raise exception 'TEST FAIL: fraud flags not created (%)', n; end if;

  -- the cap: 5 rewards counted, a 6th is refused by the function AND by the database itself
  select count(*), count(distinct reward_seq), count(distinct code) into n, n2, amt from public.mega_rewards
   where campaign_id = camp and customer_id = c1 and status in ('active', 'on_hold', 'redeemed');
  if n <> 5 or n2 <> 5 or amt <> 5 then raise exception 'TEST FAIL: expected 5 rewards with 5 different sequence numbers and codes (% / % / %)', n, n2, amt; end if;
  if public.mega_try_issue_reward(b6) is not null then raise exception 'TEST FAIL: 6th reward was issued by the function'; end if;
  begin
    insert into public.mega_rewards (campaign_id, mega_store_id, customer_id, booking_id, business_id, business_name, code, reward_type, reward_value, status)
    values (camp, ms, c1, b6, sa, 'x', 'MS-CCCC', 'percent', 10, 'active');
    raise exception 'TEST FAIL: 6th reward accepted by the database';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%reward_limit_reached%' then raise exception 'TEST FAIL: wrong error for the 6th reward: %', sqlerrm; end if;
  end;
  select count(*) into n from public.mega_service_verifications where campaign_id = camp and status = 'verified';
  if n <> 5 then raise exception 'TEST FAIL: expected 5 service verifications (%)', n; end if;
  if exists (select 1 from public.mega_rewards where campaign_id = camp and service_verification_id is null) then
    raise exception 'TEST FAIL: a reward without a verified service exists';
  end if;

  -- ---------- T6: redemption (once, separate record, budget Rs 100) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', ost2, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.megastore_redeem_reward(code1, 500);
    raise exception 'TEST FAIL: another Mega Store redeemed this reward';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%not_found%' then raise exception 'TEST FAIL: wrong error for foreign redemption: %', sqlerrm; end if;
  end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.megastore_redeem_reward(code1, 500);
  if (j->>'discount_inr')::numeric <> 50 then raise exception 'TEST FAIL: discount should be 50 (%)', j; end if;
  begin
    perform public.megastore_redeem_reward(code1, 500);
    raise exception 'TEST FAIL: reward redeemed twice';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%already_redeemed%' then raise exception 'TEST FAIL: wrong error for second redemption: %', sqlerrm; end if;
  end;
  reset role;
  select count(*), coalesce(sum(discount_inr), 0) into n, amt from public.mega_reward_redemptions where campaign_id = camp;
  if n <> 1 or amt <> 50 then raise exception 'TEST FAIL: redemption record missing (% / %)', n, amt; end if;
  select count(*) into n from public.mega_enrollments where campaign_id = camp and customer_id = c1;
  if n <> 1 then raise exception 'TEST FAIL: participation record changed by a redemption'; end if;
  begin
    update public.mega_rewards set status = 'active' where id = r1;
    raise exception 'TEST FAIL: a redeemed reward was re-activated';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%invalid_transition%' then raise exception 'TEST FAIL: wrong error for re-activation: %', sqlerrm; end if;
  end;
  begin
    update public.mega_rewards set discount_given_inr = 1 where id = r1;
    raise exception 'TEST FAIL: a redeemed reward was edited';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%reward_final%' then raise exception 'TEST FAIL: wrong error for editing a redeemed reward: %', sqlerrm; end if;
  end;
  begin
    update public.mega_rewards set reward_value = 100 where id = r2;
    raise exception 'TEST FAIL: reward amount was changed';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%reward_immutable%' then raise exception 'TEST FAIL: wrong error for amount change: %', sqlerrm; end if;
  end;
  begin
    update public.mega_rewards set status = 'redeemed', redeemed_bill_inr = 500, discount_given_inr = 499 where id = r2;
    raise exception 'TEST FAIL: a forged discount amount was accepted';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%discount_mismatch%' then raise exception 'TEST FAIL: wrong error for forged discount: %', sqlerrm; end if;
  end;
  -- budget: 50 spent of 100. A Rs 1000 bill would give 100 -> over budget -> refused and the reward stays usable
  perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.megastore_redeem_reward(code2, 1000);
    raise exception 'TEST FAIL: redemption went over the campaign budget';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%budget_exhausted%' then raise exception 'TEST FAIL: wrong error for budget: %', sqlerrm; end if;
  end;
  perform public.megastore_redeem_reward(code2, 500);                         -- 50 more: exactly the budget
  j := public.get_mega_campaign_budget(camp);
  if (j->>'spent_inr')::numeric <> 100 or (j->>'remaining_inr')::numeric <> 0 then raise exception 'TEST FAIL: budget numbers wrong (%)', j; end if;
  begin
    perform public.megastore_set_campaign_budget(camp, 80);
    raise exception 'TEST FAIL: budget lowered below the amount already spent';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%budget_below_spent%' then raise exception 'TEST FAIL: wrong error for budget cut: %', sqlerrm; end if;
  end;
  reset role;
  select status into st from public.mega_rewards where id = r2;
  select count(*) into n from public.mega_reward_redemptions where campaign_id = camp;
  if st <> 'redeemed' or n <> 2 then raise exception 'TEST FAIL: second redemption not recorded (% / %)', st, n; end if;

  -- ---------- T7: hold review, expiry, slot freed by a rejected reward ----------
  perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.megastore_review_reward(r3, true, 'ok');
  perform public.megastore_review_reward(r4, false, 'not genuine');
  reset role;
  select status, issued_at, expires_at into st, ts, exp1 from public.mega_rewards where id = r3;
  if st <> 'active' or exp1 <> ((ts at time zone 'UTC') + interval '1 month') at time zone 'UTC' then raise exception 'TEST FAIL: approved reward expiry / status wrong'; end if;
  select count(*) into n from public.mega_fraud_flags where reward_id = r3 and status = 'cleared';
  select count(*) into n2 from public.mega_fraud_flags where reward_id = r4 and status = 'confirmed';
  if n <> 1 or n2 <> 1 then raise exception 'TEST FAIL: flags not closed by the owner decision (% / %)', n, n2; end if;
  insert into public.mega_rewards (campaign_id, mega_store_id, customer_id, booking_id, business_id, business_name, code, reward_type, reward_value, status)
  values (camp, ms, c1, b6, sa, 'x', 'MS-DDDD', 'percent', 10, 'on_hold') returning id into r6;        -- rejected reward freed one slot
  select count(*) into n from public.mega_rewards where campaign_id = camp and customer_id = c1 and status in ('active', 'on_hold', 'redeemed');
  if n <> 5 then raise exception 'TEST FAIL: cap should be exactly 5 again (%)', n; end if;
  -- an expired reward cannot be redeemed (the test switches the guard off ONLY to move the expiry date into the past)
  alter table public.mega_rewards disable trigger mega_rewards_guard;
  update public.mega_rewards set expires_at = now() - interval '1 day' where id = r3;
  alter table public.mega_rewards enable trigger mega_rewards_guard;
  select code into code3 from public.mega_rewards where id = r3;
  perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  begin
    perform public.megastore_redeem_reward(code3, 500);
    raise exception 'TEST FAIL: an expired reward was redeemed';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%expired%' then raise exception 'TEST FAIL: wrong error for expired reward: %', sqlerrm; end if;
  end;
  reset role;

  -- ---------- T8: RLS ----------
  -- customer c1: only own rows, no flags, no audit, no direct writes
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.mega_rewards;
  select count(*) into n2 from public.mega_rewards where customer_id <> c1;
  if n = 0 or n2 <> 0 then raise exception 'TEST FAIL: customer sees wrong reward rows (% / %)', n, n2; end if;
  select count(*) into n from public.mega_reward_redemptions where customer_id <> c1;
  select count(*) into n2 from public.mega_service_verifications where customer_id <> c1;
  if n <> 0 or n2 <> 0 then raise exception 'TEST FAIL: customer sees other customers redemptions / verifications'; end if;
  select count(*) into n from public.mega_fraud_flags;
  select count(*) into n2 from public.mega_audit_log;
  if n <> 0 or n2 <> 0 then raise exception 'TEST FAIL: customer can read fraud flags / audit log (% / %)', n, n2; end if;
  begin
    update public.mega_rewards set status = 'redeemed' where customer_id = c1;
    raise exception 'TEST FAIL: customer updated a reward';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%permission denied%' then raise exception 'TEST FAIL: wrong error for customer update: %', sqlerrm; end if;
  end;
  begin
    insert into public.mega_enrollments (campaign_id, customer_id, declared_female) values (camp, c1, true);
    raise exception 'TEST FAIL: customer inserted an enrolment directly';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%permission denied%' then raise exception 'TEST FAIL: wrong error for direct enrolment: %', sqlerrm; end if;
  end;
  begin
    insert into public.mega_reward_redemptions (reward_id, campaign_id, mega_store_id, customer_id, bill_inr, discount_inr) values (r6, camp, ms, c1, 100, 10);
    raise exception 'TEST FAIL: customer inserted a redemption';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%permission denied%' then raise exception 'TEST FAIL: wrong error for direct redemption: %', sqlerrm; end if;
  end;
  -- customer c2 (joined, no reward): sees nothing of c1
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.mega_rewards;
  select count(*) into n2 from public.mega_reward_redemptions;
  if n <> 0 or n2 <> 0 then raise exception 'TEST FAIL: customer c2 sees c1 rewards / redemptions (% / %)', n, n2; end if;
  select count(*) into n from public.mega_terms_acceptances where user_id <> c2;
  if n <> 0 then raise exception 'TEST FAIL: customer sees other people terms acceptances'; end if;
  -- partner shop A: no direct table access, only the limited function
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', osa, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.mega_rewards;
  select count(*) into n2 from public.mega_service_verifications;
  if n <> 0 or n2 <> 0 then raise exception 'TEST FAIL: partner shop reads reward / verification tables directly (% / %)', n, n2; end if;
  select count(*) into n from public.mega_fraud_flags;
  if n <> 0 then raise exception 'TEST FAIL: partner shop reads fraud flags'; end if;
  j := public.partner_list_mega_services(sa);
  if jsonb_array_length(j) < 5 then raise exception 'TEST FAIL: partner shop does not see its verified services (%)', jsonb_array_length(j); end if;
  if (j->0) ? 'code' or (j->0) ? 'customer_id' or (j->0) ? 'discount_inr' then raise exception 'TEST FAIL: partner shop sees more than it needs (%)', j->0; end if;
  begin
    perform public.partner_list_mega_services(sb);
    raise exception 'TEST FAIL: partner shop A listed services of shop B';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%not_authorized%' then raise exception 'TEST FAIL: wrong error for foreign shop list: %', sqlerrm; end if;
  end;
  -- Mega Store owner of ANOTHER store: nothing
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', ost2, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.mega_rewards;
  select count(*) into n2 from public.mega_campaigns where id = camp;
  if n <> 0 or n2 <> 0 then raise exception 'TEST FAIL: another Mega Store sees this store (% / %)', n, n2; end if;
  select count(*) into n from public.mega_reward_redemptions;
  select count(*) into n2 from public.mega_audit_log where mega_store_id = ms;
  if n <> 0 or n2 <> 0 then raise exception 'TEST FAIL: another Mega Store sees redemptions / audit (% / %)', n, n2; end if;
  -- the Mega Store owner: own data incl. flags + audit
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', ost, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.mega_rewards where mega_store_id = ms;
  select count(*) into n2 from public.mega_fraud_flags where mega_store_id = ms;
  if n < 6 or n2 < 3 then raise exception 'TEST FAIL: Mega Store owner cannot see own rewards / flags (% / %)', n, n2; end if;
  select count(*) into n from public.mega_audit_log where mega_store_id = ms;
  if n = 0 then raise exception 'TEST FAIL: Mega Store owner cannot see own audit log'; end if;
  select count(*) into n from public.mega_audit_log where mega_store_id = ms2;
  if n <> 0 then raise exception 'TEST FAIL: Mega Store owner sees another store audit log'; end if;
  begin
    perform public.admin_mega_review_flag(gen_random_uuid(), 'confirmed', null);
    raise exception 'TEST FAIL: a Mega Store owner used an admin function';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%admin only%' then raise exception 'TEST FAIL: wrong error for admin function: %', sqlerrm; end if;
  end;
  -- anonymous: no private table, public terms only
  reset role; set local role anon;
  begin
    perform count(*) from public.mega_rewards;
    raise exception 'TEST FAIL: anonymous visitor can query rewards';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%permission denied%' then raise exception 'TEST FAIL: wrong error for anonymous select: %', sqlerrm; end if;
  end;
  select count(*) into n from public.mega_terms where campaign_id = camp;
  if n <> 2 then raise exception 'TEST FAIL: anonymous visitor cannot read public terms (%)', n; end if;
  reset role;

  -- ---------- T9: admin review of flags and services ----------
  select id into flag5 from public.mega_fraud_flags where reward_id = r5 and status = 'open';
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.mega_audit_log;
  if n < 10 then raise exception 'TEST FAIL: admin cannot see the audit log (%)', n; end if;
  perform public.admin_mega_review_flag(flag5, 'confirmed', 'looks like a repeat');
  begin
    perform public.admin_mega_review_flag(flag5, 'cleared', null);
    raise exception 'TEST FAIL: a decided flag was decided again';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%invalid_transition%' then raise exception 'TEST FAIL: wrong error for second decision: %', sqlerrm; end if;
  end;
  perform public.admin_mega_set_service_status(b6, 'revoked', 'service not genuine');
  reset role;
  select status into st from public.mega_rewards where id = r5;
  if st <> 'revoked' then raise exception 'TEST FAIL: confirmed fraud did not cancel the reward (%)', st; end if;
  select status into st from public.mega_rewards where id = r6;
  if st <> 'revoked' then raise exception 'TEST FAIL: unverified service did not cancel the reward (%)', st; end if;
  select status into st from public.mega_rewards where id = r1;
  if st <> 'redeemed' then raise exception 'TEST FAIL: a redeemed reward changed (%)', st; end if;

  -- ---------- T10: audit trail is append-only; campaign terms are frozen ----------
  select count(*) into n from public.mega_audit_log where campaign_id = camp and action = 'reward.issue';
  if n < 5 then raise exception 'TEST FAIL: reward issuing not audited (%)', n; end if;
  select count(*) into n from public.mega_audit_log where campaign_id = camp and action = 'redemption.record';
  if n <> 2 then raise exception 'TEST FAIL: redemptions not audited (%)', n; end if;
  begin
    update public.mega_audit_log set action = 'x';
    raise exception 'TEST FAIL: audit log edited';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%record_immutable%' then raise exception 'TEST FAIL: wrong error for audit edit: %', sqlerrm; end if;
  end;
  begin
    delete from public.mega_audit_log;
    raise exception 'TEST FAIL: audit log deleted';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%record_immutable%' then raise exception 'TEST FAIL: wrong error for audit delete: %', sqlerrm; end if;
  end;
  begin
    truncate public.mega_audit_log;
    raise exception 'TEST FAIL: audit log truncated';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%record_immutable%' then raise exception 'TEST FAIL: wrong error for audit truncate: %', sqlerrm; end if;
  end;
  begin
    update public.mega_campaigns set reward_value = 99 where id = camp;
    raise exception 'TEST FAIL: reward terms changed on a live campaign';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%campaign_locked%' then raise exception 'TEST FAIL: wrong error for terms change: %', sqlerrm; end if;
  end;
  update public.mega_campaigns set status = 'ended' where id = camp;
  begin
    update public.mega_campaigns set status = 'active' where id = camp;
    raise exception 'TEST FAIL: an ended campaign was re-opened';
  exception when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    if sqlerrm not like '%invalid_transition%' then raise exception 'TEST FAIL: wrong error for re-opening: %', sqlerrm; end if;
  end;

  raise notice 'ALL MEGA STORE FOUNDATION TESTS PASSED';
end $$;
rollback;
