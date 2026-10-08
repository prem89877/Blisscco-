-- Refer-a-Customer fraud protection tests (TEST project only; everything rolls back). Run after 0033.
-- NOT RUN by the assistant (no database available) - please run and send me any error text.
begin;
do $$
declare
  adm uuid := gen_random_uuid(); stranger uuid := gen_random_uuid(); ref uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid();
  c5 uuid := gen_random_uuid(); c6 uuid := gen_random_uuid(); c7 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid();
  cat uuid; sa uuid; sb uuid; sc uuid; svc_a uuid; svc_b uuid; svc_c uuid; comp uuid; bk1 uuid; bk6 uuid;
  x1 uuid; x6 uuid; x7 uuid; j jsonb; n int; ok boolean; rs text; st text; rsn text; v_amt numeric;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (adm, 'adm@t33.dev', now(), '{}'), (stranger, 's@t33.dev', now(), '{}'),
    (ref, 'refer.t33@gmail.com', now(), '{"signup_role":"customer"}'),
    (c1, 'ca1@t33.dev', now(), '{"signup_role":"customer"}'), (c2, 'refert33+2@gmail.com', now(), '{"signup_role":"customer"}'),
    (c3, 'cb3@t33.dev', now(), '{"signup_role":"customer"}'), (c4, 'cc4@t33.dev', now(), '{"signup_role":"customer"}'),
    (c5, 'cd5@t33.dev', now(), '{"signup_role":"customer"}'), (c6, 'ce6@t33.dev', now(), '{"signup_role":"customer"}'),
    (c7, 'cf7@t33.dev', now(), '{"signup_role":"customer"}'),
    (o1, 'o1@t33.dev', now(), '{"signup_role":"owner"}'), (o2, 'o2@t33.dev', now(), '{"signup_role":"owner"}'), (o3, 'o3@t33.dev', now(), '{"signup_role":"owner"}');
  update public.profiles set role = 'admin' where id = adm;
  update public.profiles set email_verified = true where id in (ref, c1, c2, c3, c4, c5, c6, c7);
  -- accounts created at least 2 hours apart (so "created close together" is not triggered by the test data itself); c3 is older than the competition
  update public.profiles set created_at = now() - interval '2 hours'  where id = c1;
  update public.profiles set created_at = now() - interval '4 hours'  where id = c2;
  update public.profiles set created_at = now() - interval '12 days' where id = c3;
  update public.profiles set created_at = now() - interval '3 days'  where id = c4;     -- the OLDER account that owns the phone used by c5
  update public.profiles set created_at = now() - interval '8 hours'  where id = c5;
  update public.profiles set created_at = now() - interval '10 hours' where id in (c6, c7);   -- same moment: the duplicate-phone rule (not the older-phone rule) must refuse c7
  update public.profiles set phone = '9123456780' where id in (c4, c5);
  update public.profiles set phone = '9988776655' where id in (c6, c7);

  select id into cat from public.business_categories limit 1;
  insert into public.businesses (owner_id, category_id, name, phone, latitude, longitude, status) values (o1, cat, 'T33 Shop A', '9876500001', 18.5, 73.8, 'approved') returning id into sa;
  insert into public.businesses (owner_id, category_id, name, phone, latitude, longitude, status) values (o2, cat, 'T33 Shop B', '9876500002', 18.6, 73.9, 'approved') returning id into sb;
  insert into public.businesses (owner_id, category_id, name, phone, latitude, longitude, status) values (o3, cat, 'T33 Shop C', '9876500003', 18.7, 74.0, 'approved') returning id into sc;
  insert into public.services (business_id, service_category, price_inr) values (sa, 'Facial', 500) returning id into svc_a;
  insert into public.services (business_id, service_category, price_inr) values (sb, 'Facial', 500) returning id into svc_b;
  insert into public.services (business_id, service_category, price_inr) values (sc, 'Facial', 500) returning id into svc_c;

  -- a live competition (inserted directly: ON, started 10 days ago, ends in 30 days, reward Rs 1000)
  insert into public.customer_competitions (title, starts_at, ends_at, status, reward_amount_inr)
  values ('T33 competition', now() - interval '10 days', now() + interval '30 days', 'active', 1000) returning id into comp;
  insert into public.referral_codes (user_id, code) values (ref, 'T33REFA');

  -- T1: claim keeps the FIRST attribution, refuses a self referral (also the same e-mail identity), and logs every attempt
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := public.claim_referral('t33refa', repeat('e', 32), repeat('f', 32));
  if not ok then raise exception 'TEST FAIL: first claim refused'; end if;
  ok := public.claim_referral('T33REFA', repeat('e', 32), repeat('f', 32));
  if ok then raise exception 'TEST FAIL: second claim accepted'; end if;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', ref, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := public.claim_referral('T33REFA');
  if ok then raise exception 'TEST FAIL: self referral accepted'; end if;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := public.claim_referral('T33REFA');                         -- refert33+2@gmail.com = refer.t33@gmail.com (same person)
  if ok then raise exception 'TEST FAIL: same e-mail identity accepted as a referral'; end if;
  reset role;
  select count(*) into n from public.customer_referral_claim_log where customer_id = c1 and outcome = 'accepted';
  if n <> 1 then raise exception 'TEST FAIL: accepted claim not logged'; end if;
  select count(*) into n from public.customer_referral_claim_log where customer_id = c1 and outcome = 'already_attributed';
  if n <> 1 then raise exception 'TEST FAIL: duplicate claim not logged'; end if;
  select count(*) into n from public.customer_referral_claim_log where customer_id in (ref, c2) and outcome = 'self_referral';
  if n <> 2 then raise exception 'TEST FAIL: self referrals not logged (%)', n; end if;

  -- T2: a genuine referral counts only after the genuine activity (completed booking at a shop owned by somebody else)
  select count(*) into n from public.customer_comp_ranking(comp);
  if n <> 0 then raise exception 'TEST FAIL: a referral counted before any booking'; end if;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, completed_at)
  values (sa, 'T33 Shop A', c1, 'C One', svc_a, 'Facial', 500, 'walkin', 'completed', current_date, 1, now()) returning id into bk1;
  select id, review_status into x1, rs from public.customer_comp_referrals where referred_id = c1;
  if x1 is null or rs <> 'clear' then raise exception 'TEST FAIL: genuine referral not qualified clean (%)', rs; end if;

  -- T3: invalid referrals never count: existing account, phone that already existed, the same person twice, self (same identity)
  insert into public.referrals (referrer_id, referred_id, code, created_at) values
    (ref, c2, 'T33REFA', now() - interval '5 days'), (ref, c3, 'T33REFA', now() - interval '6 days'), (ref, c5, 'T33REFA', now() - interval '7 days'),
    (ref, c6, 'T33REFA', now() - interval '3 days'), (ref, c7, 'T33REFA', now() - interval '8 days');
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, completed_at)
  values (sa, 'T33 Shop A', c2, 'C Two', svc_a, 'Facial', 500, 'walkin', 'completed', current_date, 2, now()),
         (sc, 'T33 Shop C', c3, 'C Three', svc_c, 'Facial', 500, 'walkin', 'completed', current_date, 3, now()),
         (sb, 'T33 Shop B', c5, 'C Five', svc_b, 'Facial', 500, 'walkin', 'completed', current_date, 4, now());
  select reject_reason into rsn from public.customer_comp_referrals where referred_id = c2; if rsn is distinct from 'self_referral' then raise exception 'TEST FAIL: self referral reason %', rsn; end if;
  select reject_reason into rsn from public.customer_comp_referrals where referred_id = c3; if rsn is distinct from 'existing_account' then raise exception 'TEST FAIL: old account reason %', rsn; end if;
  select reject_reason into rsn from public.customer_comp_referrals where referred_id = c5; if rsn is distinct from 'phone_already_registered' then raise exception 'TEST FAIL: old phone reason %', rsn; end if;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, completed_at)
  values (sb, 'T33 Shop B', c6, 'C Six', svc_b, 'Facial', 500, 'walkin', 'completed', current_date, 5, now()) returning id into bk6;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number, completed_at)
  values (sc, 'T33 Shop C', c7, 'C Seven', svc_c, 'Facial', 500, 'walkin', 'completed', current_date, 6, now());
  select id into x6 from public.customer_comp_referrals where referred_id = c6 and status = 'qualified';
  if x6 is null then raise exception 'TEST FAIL: second genuine referral not counted'; end if;
  select id, reject_reason into x7, rsn from public.customer_comp_referrals where referred_id = c7;
  if rsn is distinct from 'duplicate_phone' then raise exception 'TEST FAIL: same person (same phone) counted twice (%)', rsn; end if;
  select referrals into n from public.customer_comp_ranking(comp) where referrer_id = ref;
  if n <> 2 then raise exception 'TEST FAIL: leaderboard should count 2 (got %)', n; end if;
  select count(*) into n from public.customer_comp_audit_log where entity_type = 'referral' and action = 'auto_reject' and competition_id = comp;
  if n <> 4 then raise exception 'TEST FAIL: automatic refusals not audited (%)', n; end if;

  -- T4: a cancelled booking stops counting at once (and is audited); a replacement is not invented
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'customer' where id = bk1;
  select referrals into n from public.customer_comp_ranking(comp) where referrer_id = ref;
  if n <> 1 then raise exception 'TEST FAIL: cancelled booking still counts (%)', n; end if;
  select count(*) into n from public.customer_comp_audit_log where entity_id = x1 and action = 'booking_no_longer_valid';
  if n <> 1 then raise exception 'TEST FAIL: cancelled booking not audited'; end if;
  update public.bookings set status = 'completed', cancelled_at = null, cancelled_by = null, completed_at = now() where id = bk1;
  select referrals into n from public.customer_comp_ranking(comp) where referrer_id = ref;
  if n <> 2 then raise exception 'TEST FAIL: valid booking does not count again (%)', n; end if;

  -- T5: risk - the network alone NEVER holds a referral; several signals together do; the system never rejects / marks fraud by itself
  insert into public.customer_device_log (user_id, device_id, device_fp, ip_hash) values
    (ref, repeat('c', 32), '', repeat('b', 64)), (c6, repeat('d', 32), '', repeat('b', 64));
  perform public.evaluate_customer_referral_risk(x6);
  select review_status, risk_score into rs, n from public.customer_comp_referrals where id = x6;
  if rs <> 'clear' or n <> 15 then raise exception 'TEST FAIL: network alone changed status (% / %)', rs, n; end if;
  insert into public.customer_device_log (user_id, device_id, device_fp, ip_hash) values
    (ref, repeat('a', 32), '', repeat('b', 64)), (c6, repeat('a', 32), '', repeat('b', 64));
  perform public.evaluate_customer_referral_risk(x6);
  select review_status, risk_score into rs, n from public.customer_comp_referrals where id = x6;
  if rs <> 'suspicious' or n < 50 then raise exception 'TEST FAIL: several signals did not hold the referral (% / %)', rs, n; end if;
  select referrals into n from public.customer_comp_ranking(comp) where referrer_id = ref;
  if n <> 1 then raise exception 'TEST FAIL: a held referral still counts (%)', n; end if;
  select count(*) into n from public.customer_comp_audit_log where entity_id = x6 and action = 'risk_flagged';
  if n <> 1 then raise exception 'TEST FAIL: flag not audited'; end if;

  -- T6: only an admin can review; a note is required; every decision is audited; rejected / fraudulent stop counting, restore brings it back
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.admin_review_customer_referral(x6, 'approve', 'trying to approve'); raise exception 'TEST FAIL: non-admin reviewed';
  exception when others then if sqlerrm <> 'admin only' then raise; end if; end;
  begin perform public.admin_customer_winner_check(comp); raise exception 'TEST FAIL: non-admin saw the winner check';
  exception when others then if sqlerrm <> 'admin only' then raise; end if; end;
  select count(*) into n from public.customer_comp_audit_log;      -- RLS: customers cannot read the audit log
  if n <> 0 then raise exception 'TEST FAIL: audit log readable by a non-admin'; end if;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.admin_review_customer_referral(x6, 'approve', ''); raise exception 'TEST FAIL: decision without a reason';
  exception when others then if sqlerrm <> 'reason_required' then raise; end if; end;
  perform public.admin_review_customer_referral(x6, 'start_review', null);
  select review_status into rs from public.customer_comp_referrals where id = x6; if rs <> 'in_review' then raise exception 'TEST FAIL: start_review'; end if;
  perform public.admin_review_customer_referral(x6, 'fraud', 'same device and network as the referrer');
  select status, review_status into st, rs from public.customer_comp_referrals where id = x6;
  if st <> 'rejected' or rs <> 'fraudulent' then raise exception 'TEST FAIL: fraud decision (% / %)', st, rs; end if;
  select referrals into n from public.customer_comp_ranking(comp) where referrer_id = ref;
  if n <> 1 then raise exception 'TEST FAIL: fraudulent referral still counts (%)', n; end if;
  perform public.admin_review_customer_referral(x6, 'restore', 'checked by phone: genuine customer');
  select status, review_status into st, rs from public.customer_comp_referrals where id = x6;
  if st <> 'qualified' or rs <> 'approved' then raise exception 'TEST FAIL: restore (% / %)', st, rs; end if;
  select referrals into n from public.customer_comp_ranking(comp) where referrer_id = ref;
  if n <> 2 then raise exception 'TEST FAIL: restored referral does not count (%)', n; end if;
  reset role;
  perform public.evaluate_customer_referral_risk(x6);               -- the system never overwrites an admin decision
  select review_status into rs from public.customer_comp_referrals where id = x6;
  if rs <> 'approved' then raise exception 'TEST FAIL: system overwrote an admin decision'; end if;
  select count(*) into n from public.customer_comp_audit_log where entity_id = x6 and actor_id = adm and action in ('start_review', 'fraud', 'restore');
  if n <> 3 then raise exception 'TEST FAIL: admin decisions not audited (%)', n; end if;
  -- a duplicate identity can never be restored (same phone as a counted customer)
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.admin_review_customer_referral(x7, 'restore', 'trying to restore a duplicate'); raise exception 'TEST FAIL: duplicate identity restored';
  exception when others then if sqlerrm <> 'duplicate_identity' then raise; end if; end;
  reset role;
  begin update public.customer_comp_audit_log set note = 'edited' where entity_id = x6; raise exception 'TEST FAIL: audit log edited';
  exception when others then if sqlerrm <> 'append_only' then raise; end if; end;

  -- T7: reward protection. Nobody can insert a reward around the confirmation function
  begin insert into public.promo_balance_grants (customer_id, competition_id, code, amount_inr, expires_at) values (ref, comp, 'BP-TEST0001', 1000, now() + interval '30 days');
    raise exception 'TEST FAIL: reward inserted while the competition is live';
  exception when others then if sqlerrm <> 'reward_not_allowed' then raise; end if; end;

  -- T8: ending the competition FREEZES the leaderboard; nothing new can enter; prize / dates are locked
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.admin_set_customer_competition_status(comp, 'end');
  reset role;
  select (frozen_snapshot -> 'ranking' -> 0 ->> 'referrals')::int into n from public.customer_competitions where id = comp and frozen_at is not null and status = 'pending_verification';
  if n is distinct from 2 then raise exception 'TEST FAIL: leaderboard not frozen correctly (%)', n; end if;
  begin update public.customer_competitions set frozen_snapshot = '{}'::jsonb where id = comp; raise exception 'TEST FAIL: frozen leaderboard changed';
  exception when others then if sqlerrm <> 'competition_locked' then raise; end if; end;
  begin update public.customer_competitions set reward_amount_inr = 5000 where id = comp; raise exception 'TEST FAIL: prize changed while verifying';
  exception when others then if sqlerrm <> 'competition_locked' then raise; end if; end;
  insert into public.referrals (referrer_id, referred_id, code) values (ref, c4, 'T33REFA');
  begin insert into public.customer_comp_referrals (competition_id, referral_id, referrer_id, referred_id, status)
          select comp, id, referrer_id, referred_id, 'qualified' from public.referrals where referred_id = c4;
    raise exception 'TEST FAIL: a referral entered a frozen leaderboard';
  exception when others then if sqlerrm <> 'competition_not_active' then raise; end if; end;

  -- T9: confirmation - the server recomputes the winner; wrong winner / unresolved holds block; the reward is issued exactly once
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.admin_refresh_customer_winner(comp);
  j := public.admin_customer_winner_check(comp);
  if not (j ->> 'can_issue')::boolean or (j ->> 'winner_id')::uuid <> ref or (j ->> 'winner_referrals')::int <> 2 or (j ->> 'reward_amount_inr')::numeric <> 1000 then
    raise exception 'TEST FAIL: winner check wrong: %', j; end if;
  begin perform public.admin_confirm_customer_winner(comp, null, null); raise exception 'TEST FAIL: confirmed without naming the winner';
  exception when others then if sqlerrm <> 'winner_required' then raise; end if; end;
  j := public.admin_confirm_customer_winner(comp, c1, null);                   -- the admin "saw" somebody else
  if (j ->> 'awarded')::boolean or j ->> 'reason' <> 'winner_changed' then raise exception 'TEST FAIL: wrong winner accepted: %', j; end if;
  reset role;
  update public.customer_comp_referrals set review_status = 'suspicious' where id = x1;     -- simulate a late hold
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.admin_confirm_customer_winner(comp, ref, null);
  if (j ->> 'awarded')::boolean or j ->> 'reason' <> 'unresolved_review' then raise exception 'TEST FAIL: reward issued with an unresolved hold: %', j; end if;
  perform public.admin_review_customer_referral(x1, 'approve', 'checked, genuine');
  select count(*) into n from public.promo_balance_grants where competition_id = comp;
  if n <> 0 then raise exception 'TEST FAIL: a reward exists before confirmation'; end if;
  j := public.admin_confirm_customer_winner(comp, ref, 'confirmed by test');
  if not (j ->> 'awarded')::boolean then raise exception 'TEST FAIL: confirmation failed: %', j; end if;
  begin perform public.admin_confirm_customer_winner(comp, ref, null); raise exception 'TEST FAIL: second confirmation accepted';
  exception when others then if sqlerrm <> 'already_awarded' then raise; end if; end;
  reset role;
  select count(*), max(amount_inr) into n, v_amt from public.promo_balance_grants where competition_id = comp and customer_id = ref;
  if n <> 1 or v_amt <> 1000 then raise exception 'TEST FAIL: reward count % / amount %', n, v_amt; end if;
  begin insert into public.promo_balance_grants (customer_id, competition_id, code, amount_inr, expires_at) values (ref, comp, 'BP-TEST0002', 1000, now() + interval '30 days');
    raise exception 'TEST FAIL: a second reward was inserted';
  exception when others then if sqlerrm <> 'reward_not_allowed' then raise; end if; end;
  begin update public.promo_balance_grants set amount_inr = 9999 where competition_id = comp; raise exception 'TEST FAIL: reward amount edited';
  exception when others then if sqlerrm <> 'append_only' then raise; end if; end;
  begin delete from public.promo_balance_grants where competition_id = comp; raise exception 'TEST FAIL: reward deleted';
  exception when others then if sqlerrm <> 'append_only' then raise; end if; end;
  begin update public.customer_competitions set status = 'active' where id = comp; raise exception 'TEST FAIL: ended competition reopened';
  exception when others then if sqlerrm <> 'competition_locked' then raise; end if; end;
  select count(*) into n from public.customer_comp_audit_log where competition_id = comp and action in ('freeze', 'award', 'winner_confirmed', 'award_blocked');
  if n < 5 then raise exception 'TEST FAIL: freeze / reward events not audited (%)', n; end if;
  raise notice 'phase13 customer fraud tests: all passed';
end $$;
rollback;
