-- Phase 7 tests (TEST project only; rolls back). Covers Tests 4, 5, 9 plus coupon rules and write protection.
begin;
do $$
declare
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); r uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  cat uuid; ba uuid; bb uuid; sa uuid; j jsonb; rcode text; b_d1 uuid; b_d2 uuid; b_d3 uuid; b_r uuid; ref1 uuid;
  n int; s text; coup text; b bool;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (o1, 'o1@t7.dev', now(), '{"signup_role":"owner"}'), (o2, 'o2@t7.dev', now(), '{"signup_role":"owner"}'),
    (r, 'r@t7.dev', now(), '{}'), (d1, 'd1@t7.dev', now(), '{}'), (d2, 'd2@t7.dev', now(), '{}'),
    (d3, 'd3@t7.dev', now(), '{}'), (adm, 'adm@t7.dev', now(), '{}');
  update public.profiles set role = 'admin' where id = adm;
  select id into cat from public.business_categories limit 1;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status) values (o1, cat, 'Shop A', 18.5, 73.8, 'approved') returning id into ba;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status) values (o2, cat, 'Shop B', 18.6, 73.9, 'approved') returning id into bb;
  insert into public.services (business_id, service_category, price_inr) values (ba, 'Facial', 500) returning id into sa;
  insert into public.business_hours (business_id, day_of_week, opens_at, closes_at, is_closed)
    select b2, d, '00:00', '23:59', false from unnest(array[ba, bb]) b2, generate_series(0, 6) d;
  insert into public.referral_reward_options (discount_type, discount_value, max_discount_inr, min_spend_inr, weight) values ('percent', 10, 100, 0, 1);
  update public.referral_config set is_active = true, coupon_valid_days = 30 where id = 1;

  -- referral code + self-referral
  perform set_config('request.jwt.claims', json_build_object('sub', r, 'role', 'authenticated')::text, true); set local role authenticated;
  rcode := public.get_my_referral_code();
  if rcode <> public.get_my_referral_code() then raise exception 'TEST FAIL: referral code not stable'; end if;
  if public.claim_referral(rcode) then raise exception 'TEST FAIL: self-referral accepted'; end if;

  -- d1 joins through r's link (only once)
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true); set local role authenticated;
  if not public.claim_referral(rcode) then raise exception 'TEST FAIL: valid referral not accepted'; end if;
  if public.claim_referral(rcode) then raise exception 'TEST FAIL: referral attribution changed/duplicated'; end if;
  j := public.book_walkin(sa); b_d1 := (j ->> 'id')::uuid;

  -- shop completes the service; d1 phone NOT verified yet -> no reward (TEST 4)
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.set_booking_status(b_d1, 'in_service'); perform public.set_booking_status(b_d1, 'completed');
  reset role;
  select status into s from public.referrals where referred_id = d1;
  if s <> 'pending' then raise exception 'TEST FAIL: reward given without verified phone (status %)', s; end if;
  select count(*) into n from public.coupons where holder_id = r;
  if n <> 0 then raise exception 'TEST FAIL: coupon created without verified phone'; end if;

  -- phone gets verified by Auth -> reward is issued now (TEST 4, positive case)
  update auth.users set phone = '+919000000001', phone_confirmed_at = now() where id = d1;
  select status, id into s, ref1 from public.referrals where referred_id = d1;
  if s <> 'rewarded' then raise exception 'TEST FAIL: expected rewarded, got %', s; end if;
  select count(*) into n from public.coupons where holder_id = r and status = 'active';
  if n <> 1 then raise exception 'TEST FAIL: expected 1 active coupon, got %', n; end if;
  select c.code into coup from public.coupons c where c.holder_id = r;

  -- TEST 5: the same phone number cannot earn a second reward (d1 moves to another number, d2 reuses the old one)
  update auth.users set phone = '+919000000009', phone_confirmed_at = now() where id = d1;
  perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true); set local role authenticated;
  if not public.claim_referral(rcode) then raise exception 'TEST FAIL: d2 referral not accepted'; end if;
  j := public.book_walkin(sa); b_d2 := (j ->> 'id')::uuid;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.set_booking_status(b_d2, 'in_service'); perform public.set_booking_status(b_d2, 'completed');
  reset role;
  update auth.users set phone = '+919000000001', phone_confirmed_at = now() where id = d2;
  select status into s from public.referrals where referred_id = d2;
  if s <> 'rejected' then raise exception 'TEST FAIL: duplicate phone was rewarded (status %)', s; end if;
  select count(*) into n from public.coupons where holder_id = r;
  if n <> 1 then raise exception 'TEST FAIL: second coupon created for same phone, total %', n; end if;

  -- TEST 9: reviews only for the customer's own completed booking, once
  perform set_config('request.jwt.claims', json_build_object('sub', d3, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.submit_review(gen_random_uuid(), 5, 'x'); raise exception 'TEST FAIL: review without booking';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; if sqlerrm <> 'not_found' then raise exception 'TEST FAIL: wrong error %', sqlerrm; end if; end;
  begin perform public.submit_review(b_d2, 5, 'x'); raise exception 'TEST FAIL: reviewed someone else booking';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; if sqlerrm <> 'not_found' then raise exception 'TEST FAIL: wrong error %', sqlerrm; end if; end;
  j := public.book_walkin(sa); b_d3 := (j ->> 'id')::uuid;      -- booked but NOT completed
  perform public.submit_review(b_d3, 3, 'not completed yet');   -- reviews are now allowed on any own booking
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.submit_review(b_d2, 5, 'x'); raise exception 'TEST FAIL: owner reviewed own business';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; if sqlerrm <> 'not_found' then raise exception 'TEST FAIL: wrong error %', sqlerrm; end if; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', d2, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.submit_review(b_d2, 5, 'great');
  begin perform public.submit_review(b_d2, 4, 'again'); raise exception 'TEST FAIL: second review allowed';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; if sqlerrm <> 'already_reviewed' then raise exception 'TEST FAIL: wrong error %', sqlerrm; end if; end;
  reset role; set local role anon;
  select review_count into n from public.public_business_ratings where business_id = ba;
  if n <> 2 then raise exception 'TEST FAIL: expected 2 public reviews, got %', n; end if;

  -- write protection: no direct inserts/updates for ordinary users
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', r, 'role', 'authenticated')::text, true); set local role authenticated;
  begin insert into public.coupons (code, holder_id, discount_type, discount_value, max_discount_inr, expires_at) values ('BC-HACKHACK', r, 'flat', 999, null, now() + interval '9 days');
        raise exception 'TEST FAIL: user inserted a coupon';
  exception when insufficient_privilege then null; end;
  begin update public.referrals set status = 'rewarded'; raise exception 'TEST FAIL: user updated referrals';
  exception when insufficient_privilege then null; end;
  begin insert into public.reviews (booking_id, business_id, business_name, rating) values (b_d3, ba, 'x', 5); raise exception 'TEST FAIL: user inserted a review';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.referrals;
  if n <> 0 then raise exception 'TEST FAIL: customer can read referral rows'; end if;
  begin perform public.admin_revoke_referral(ref1, 'nope'); raise exception 'TEST FAIL: non-admin revoked';
  exception when insufficient_privilege then null; end;

  -- coupons: r gets a completed service at shop A, the shop redeems once
  j := public.book_walkin(sa); b_r := (j ->> 'id')::uuid;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.set_booking_status(b_r, 'in_service'); perform public.set_booking_status(b_r, 'completed');
  if not (public.check_coupon(coup, ba) ->> 'valid')::boolean then raise exception 'TEST FAIL: valid coupon rejected'; end if;
  select count(*) into n from public.coupon_eligible_bookings(coup, ba);
  if n <> 1 then raise exception 'TEST FAIL: expected 1 eligible booking, got %', n; end if;
  begin perform public.redeem_coupon(coup, b_d3); raise exception 'TEST FAIL: coupon used on someone else booking';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; if sqlerrm <> 'booking_mismatch' then raise exception 'TEST FAIL: wrong error %', sqlerrm; end if; end;
  j := public.redeem_coupon(coup, b_r);
  if (j ->> 'discount')::numeric <> 50 then raise exception 'TEST FAIL: expected discount 50, got %', j; end if;
  begin perform public.redeem_coupon(coup, b_r); raise exception 'TEST FAIL: coupon redeemed twice';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; if sqlerrm <> 'redeemed' then raise exception 'TEST FAIL: wrong error %', sqlerrm; end if; end;

  -- another shop's owner cannot probe or redeem coupons for shop A; expired coupons fail
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.check_coupon(coup, ba); raise exception 'TEST FAIL: other owner checked coupon for shop A';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; end;
  reset role;
  insert into public.coupons (code, holder_id, discount_type, discount_value, max_discount_inr, expires_at)
    values ('BC-OLDOLD11', r, 'percent', 10, 100, now() - interval '1 day');
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.redeem_coupon('BC-OLDOLD11', b_r); raise exception 'TEST FAIL: expired coupon redeemed';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; if sqlerrm <> 'expired' then raise exception 'TEST FAIL: wrong error %', sqlerrm; end if; end;

  -- admin can revoke a reward (audited)
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.admin_revoke_referral(ref1, 'test revoke');
  reset role;
  select status into s from public.referrals where id = ref1;
  if s <> 'revoked' then raise exception 'TEST FAIL: revoke did not apply'; end if;
  select count(*) into n from public.admin_audit_logs where action = 'referral.revoke' and entity_id = ref1;
  if n <> 1 then raise exception 'TEST FAIL: revoke not audited'; end if;

  raise notice 'ALL PHASE 7 TESTS PASSED';
end $$;
rollback;