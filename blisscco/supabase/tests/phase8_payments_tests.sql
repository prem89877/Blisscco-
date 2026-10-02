-- Phase 8 tests (TEST project only; rolls back). Run after 0011.
-- NOT RUN yet by the assistant (no database available) - please run and send me any error text.
begin;
do $$
declare
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  cat uuid; ba uuid; bb uuid; n int; s text; r text; j jsonb; tx jsonb; b bool; v_id uuid;
  ev_cap jsonb; ev_ref jsonb; bn uuid;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (o1, 'o1@t8.dev', now(), '{"signup_role":"owner"}'), (o2, 'o2@t8.dev', now(), '{"signup_role":"owner"}'), (adm, 'adm@t8.dev', now(), '{}');
  update public.profiles set role = 'admin' where id = adm;
  select id into cat from public.business_categories limit 1;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status) values (o1, cat, 'Shop A', 18.5, 73.8, 'approved') returning id into ba;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status) values (o2, cat, 'Shop B', 18.5, 73.8, 'approved') returning id into bb;

  -- T1: amount comes from the DB, other owner's business is refused
  tx := public.create_payment_txn(o1, ba, 'pro', 'rcpt-1');
  if (tx ->> 'amount_paise')::int <> 49900 then raise exception 'TEST FAIL: PRO amount not from DB'; end if;
  begin perform public.create_payment_txn(o1, bb, 'pro', 'rcpt-x'); raise exception 'TEST FAIL: ordered for someone else''s shop';
  exception when others then if sqlerrm <> 'not_owner' then raise; end if; end;
  begin perform public.create_payment_txn(o1, ba, 'blue_badge', 'rcpt-y'); raise exception 'TEST FAIL: badge ordered without verification';
  exception when others then if sqlerrm <> 'verification_required' then raise; end if; end;
  begin perform public.create_payment_txn(o1, ba, 'banner_extra', 'rcpt-z'); raise exception 'TEST FAIL: extra banner without plan';
  exception when others then if sqlerrm <> 'plan_required' then raise; end if; end;
  perform public.attach_razorpay_order((tx ->> 'txn_id')::uuid, 'order_T1');

  -- T2: wrong amount does not activate
  ev_cap := '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_T1","order_id":"order_T1","amount":100,"currency":"INR","status":"captured"}}}}'::jsonb;
  r := public.process_razorpay_event('evt_bad_amount', 'payment.captured', ev_cap);
  if r <> 'amount_mismatch' then raise exception 'TEST FAIL: amount mismatch result %', r; end if;
  if public.has_entitlement(ba, 'analytics') then raise exception 'TEST FAIL: activated on wrong amount'; end if;

  -- T3: correct capture activates PRO + 2 credits; replay of the same event id is a no-op
  tx := public.create_payment_txn(o1, ba, 'pro', 'rcpt-2');
  perform public.attach_razorpay_order((tx ->> 'txn_id')::uuid, 'order_T3');
  ev_cap := '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_T3","order_id":"order_T3","amount":49900,"currency":"INR","status":"captured"}}}}'::jsonb;
  r := public.process_razorpay_event('evt_ok_1', 'payment.captured', ev_cap);
  if r <> 'activated' then raise exception 'TEST FAIL: not activated (%)', r; end if;
  if not public.has_entitlement(ba, 'analytics') or public.business_tier_rank(ba) <> 1 then raise exception 'TEST FAIL: PRO entitlement missing'; end if;
  select coalesce(sum(delta), 0) into n from public.banner_credits where business_id = ba;
  if n <> 2 then raise exception 'TEST FAIL: expected 2 credits, got %', n; end if;
  r := public.process_razorpay_event('evt_ok_1', 'payment.captured', ev_cap);
  if r <> 'duplicate' then raise exception 'TEST FAIL: replay not detected (%)', r; end if;
  -- same payment under a NEW event id must also not double-activate
  r := public.process_razorpay_event('evt_ok_1_again', 'payment.captured', ev_cap);
  if r <> 'already_processed' then raise exception 'TEST FAIL: second event activated again (%)', r; end if;
  select count(*) into n from public.subscriptions where business_id = ba;
  if n <> 1 then raise exception 'TEST FAIL: % subscriptions after replay', n; end if;

  -- T4: ranking ELITE > PRO > FREE
  tx := public.create_payment_txn(o2, bb, 'elite', 'rcpt-3');
  perform public.attach_razorpay_order((tx ->> 'txn_id')::uuid, 'order_T4');
  perform public.process_razorpay_event('evt_ok_2', 'payment.captured',
    '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_T4","order_id":"order_T4","amount":79900,"currency":"INR","status":"captured"}}}}'::jsonb);
  if public.business_tier_rank(bb) <> 2 then raise exception 'TEST FAIL: ELITE rank'; end if;
  select business_id into v_id from public.nearby_businesses(18.5, 73.8) limit 0;  -- function must still run

  -- T5: expiry removes entitlement immediately, and the daily job marks it expired
  update public.subscriptions set starts_at = now() - interval '40 days', expires_at = now() - interval '10 days' where business_id = ba;
  if public.has_entitlement(ba, 'analytics') then raise exception 'TEST FAIL: expired plan still has entitlement'; end if;
  perform public.expire_subscriptions();
  select status into s from public.subscriptions where business_id = ba;
  if s <> 'expired' then raise exception 'TEST FAIL: job did not expire (%)', s; end if;

  -- T6: full refund revokes ELITE and reverses credits; replay of refund event does nothing
  ev_ref := '{"event":"refund.processed","payload":{"refund":{"entity":{"id":"rfnd_1","payment_id":"pay_T4","amount":79900}}}}'::jsonb;
  r := public.process_razorpay_event('evt_ref_1', 'refund.processed', ev_ref);
  if r <> 'refunded' then raise exception 'TEST FAIL: refund result %', r; end if;
  if public.has_entitlement(bb, 'analytics') then raise exception 'TEST FAIL: entitlement survived refund'; end if;
  select coalesce(sum(delta), 0) into n from public.banner_credits where business_id = bb;
  if n <> 0 then raise exception 'TEST FAIL: credits not reversed (%)', n; end if;
  if public.process_razorpay_event('evt_ref_1', 'refund.processed', ev_ref) <> 'duplicate' then raise exception 'TEST FAIL: refund replay'; end if;

  -- T7: a failure inside the function rolls the event row back (so Razorpay can retry)
  begin
    perform public.process_razorpay_event('evt_early_refund', 'refund.processed',
      '{"event":"refund.processed","payload":{"refund":{"entity":{"id":"rfnd_9","payment_id":"pay_NOT_YET","amount":100}}}}'::jsonb);
    raise exception 'TEST FAIL: early refund accepted';
  exception when others then if sqlerrm <> 'payment_not_ready' then raise; end if; end;
  select count(*) into n from public.webhook_events where event_id = 'evt_early_refund';
  if n <> 0 then raise exception 'TEST FAIL: failed event was stored'; end if;

  -- T8: clients cannot call payment functions or write tables
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.process_razorpay_event('evt_hack', 'payment.captured', '{}'::jsonb); raise exception 'TEST FAIL: client ran webhook function';
  exception when insufficient_privilege then null; end;
  begin insert into public.subscriptions (business_id, plan_code, starts_at, expires_at, payment_transaction_id)
        values (ba, 'elite', now(), now() + interval '30 days', gen_random_uuid()); raise exception 'TEST FAIL: client inserted subscription';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.webhook_events limit 1; if found then raise exception 'TEST FAIL: owner can read webhook_events'; end if; exception when insufficient_privilege then null; end;
  reset role;

  raise notice 'ALL PHASE 8 TESTS PASSED';
end $$;
rollback;
