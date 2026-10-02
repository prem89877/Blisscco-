-- Phase 10 tests (TEST project only; rolls back). Run after 0013 (and 0009-0012).
-- NOT RUN yet by the assistant (no database available) - please run and send me any error text.
-- Checks: triggers create notifications, preferences / muting, dedupe, reminders, retry/failed logic, RLS, and that a
-- failing notification can never break a booking.
begin;
do $$
declare
  o1 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); adm uuid := gen_random_uuid();
  cat uuid; biz uuid; sv uuid; bk uuid; rv uuid; n int; j jsonb; d uuid; did uuid; items jsonb; r record;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (o1, 'o1@t10.dev', now(), '{"signup_role":"owner"}'), (c1, 'c1@t10.dev', now(), '{}'), (c2, 'c2@t10.dev', now(), '{}'),
    (adm, 'adm@t10.dev', now(), '{}');
  update public.profiles set role = 'admin' where id = adm;      -- test setup runs as the SQL-editor role (allowed)
  select id into cat from public.business_categories limit 1;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status) values (o1, cat, 'Shop T10', 18.5, 73.8, 'approved') returning id into biz;
  insert into public.services (business_id, service_category, price_inr) values (biz, 'Haircut', 200) returning id into sv;
  insert into public.business_hours (business_id, day_of_week, opens_at, closes_at, is_closed)
    select biz, g, '00:00', '23:59', false from generate_series(0, 6) g on conflict do nothing;

  -- T1: a booking made by c1 notifies the owner and the customer (in-app rows), email deliveries queued (default prefs)
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  bk := public.book_walkin(sv) ->> 'id';
  reset role;
  select count(*) into n from public.notifications where user_id = o1 and type = 'booking_new';
  if n <> 1 then raise exception 'TEST FAIL T1: owner not notified (%)', n; end if;
  select count(*) into n from public.notifications where user_id = c1 and type = 'booking_confirmed';
  if n <> 1 then raise exception 'TEST FAIL T1: customer not notified (%)', n; end if;
  select count(*) into n from public.notification_deliveries dl join public.notifications nt on nt.id = dl.notification_id
    where nt.user_id = c1 and dl.channel = 'email' and dl.status = 'pending';
  if n <> 1 then raise exception 'TEST FAIL T1: email delivery not queued'; end if;
  select count(*) into n from public.notification_deliveries dl join public.notifications nt on nt.id = dl.notification_id
    where nt.user_id = c1 and dl.channel = 'push';
  if n <> 0 then raise exception 'TEST FAIL T1: push queued without a subscription'; end if;

  -- T2: owner moves the booking along; customer is told; then completion + review notifies the owner
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_booking_status(bk, 'in_service');
  perform public.set_booking_status(bk, 'completed');
  reset role;
  select count(*) into n from public.notifications where user_id = c1 and type in ('booking_in_service', 'booking_completed');
  if n <> 2 then raise exception 'TEST FAIL T2: customer status notifications (%)', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rv := public.submit_review(bk, 5, 'great');
  reset role;
  select count(*) into n from public.notifications where user_id = o1 and type = 'review_new';
  if n <> 1 then raise exception 'TEST FAIL T2: owner not told about review'; end if;

  -- T3: approval: suspending the shop notifies the owner; a new pending shop notifies admins
  update public.businesses set status = 'suspended' where id = biz;
  select count(*) into n from public.notifications where user_id = o1 and type = 'business_suspended';
  if n <> 1 then raise exception 'TEST FAIL T3: suspension not notified'; end if;
  update public.businesses set status = 'approved' where id = biz;
  select count(*) into n from public.notifications where user_id = o1 and type = 'business_reactivated';
  if n <> 1 then raise exception 'TEST FAIL T3: reactivation not notified'; end if;

  -- T4: payment: paid -> payment_success exactly once (replaying the same status is a no-op)
  declare tx jsonb; res text;
  begin
    tx := public.create_payment_txn(o1, biz, 'pro', 'rc-t10');
    perform public.attach_razorpay_order((tx ->> 'txn_id')::uuid, 'order_t10');
    res := public.process_razorpay_event('evt_t10', 'payment.captured', jsonb_build_object('event', 'payment.captured', 'payload',
      jsonb_build_object('payment', jsonb_build_object('entity', jsonb_build_object('id', 'pay_t10', 'order_id', 'order_t10',
        'amount', 49900, 'currency', 'INR', 'status', 'captured')))));
    if res <> 'activated' then raise exception 'TEST SETUP: payment not activated (%)', res; end if;
    res := public.process_razorpay_event('evt_t10', 'payment.captured', '{}'::jsonb);   -- replay
  end;
  select count(*) into n from public.notifications where user_id = o1 and type = 'payment_success';
  if n <> 1 then raise exception 'TEST FAIL T4: payment_success count %', n; end if;

  -- T5: muting a category stops push/email but keeps the in-app row
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.save_notification_preferences(true, true, array['reminder']);
  reset role;
  d := public._notify(c2, 'coupon_expiring', 'reminder', '{}'::jsonb, '/refer', 'dedupe-a', false);
  if d is null then raise exception 'TEST FAIL T5: muted notification must still be stored'; end if;
  select count(*) into n from public.notification_deliveries where notification_id = d;
  if n <> 0 then raise exception 'TEST FAIL T5: muted category queued deliveries (%)', n; end if;

  -- T6: dedupe key: the same reminder cannot be created twice
  if public._notify(c2, 'coupon_expiring', 'reminder', '{}'::jsonb, '/refer', 'dedupe-a', false) is not null then
    raise exception 'TEST FAIL T6: duplicate created'; end if;

  -- T7: dispatcher flow: claim -> retry back-off -> failed after 5 attempts; 'sent' only when reported
  d := public._notify(c1, 'test', 'system', '{}'::jsonb, null, 'dedupe-b', false);
  select id into did from public.notification_deliveries where notification_id = d and channel = 'email';
  if did is null then raise exception 'TEST FAIL T7: no email delivery'; end if;
  items := public.claim_deliveries(100);
  if not exists (select 1 from jsonb_array_elements(items) e where (e ->> 'delivery_id')::uuid = did) then raise exception 'TEST FAIL T7: not claimed'; end if;
  if (select email from (select (e ->> 'email') as email from jsonb_array_elements(items) e where (e ->> 'delivery_id')::uuid = did) q) <> 'c1@t10.dev' then
    raise exception 'TEST FAIL T7: wrong email address in claim'; end if;
  perform public.finish_delivery(did, 'retry', 'resend_500', null);
  if (select status from public.notification_deliveries where id = did) <> 'pending' then raise exception 'TEST FAIL T7: retry should be pending'; end if;
  if (select next_attempt_at from public.notification_deliveries where id = did) <= now() then raise exception 'TEST FAIL T7: no back-off'; end if;
  -- not due yet: must not be claimed again
  items := public.claim_deliveries(100);
  if exists (select 1 from jsonb_array_elements(items) e where (e ->> 'delivery_id')::uuid = did) then raise exception 'TEST FAIL T7: claimed before back-off'; end if;
  update public.notification_deliveries set next_attempt_at = now(), attempts = 5 where id = did;
  perform public.finish_delivery(did, 'retry', 'resend_500', null);
  if (select status from public.notification_deliveries where id = did) <> 'failed' then raise exception 'TEST FAIL T7: should be failed after 5 tries'; end if;
  if (select sent_at from public.notification_deliveries where id = did) is not null then raise exception 'TEST FAIL T7: failed row has sent_at'; end if;
  perform public.finish_delivery(did, 'sent', null, 're_123');
  if (select status from public.notification_deliveries where id = did) <> 'sent' then raise exception 'TEST FAIL T7: sent not recorded'; end if;

  -- T8: appointment reminder: one per window, never twice, not for bookings made too late
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, start_at, end_at, created_at)
  values (biz, 'Shop T10', c2, 'C2', sv, 'Haircut', 200, 'appointment', 'confirmed', now() + interval '1 hour 30 minutes', now() + interval '2 hours', now() - interval '2 days')
  returning id into bk;
  perform public.send_appointment_reminders();
  perform public.send_appointment_reminders();
  select count(*) into n from public.notifications where user_id = c2 and type = 'appointment_reminder' and dedupe_key = 'appt:' || bk::text || ':2h';
  if n <> 1 then raise exception 'TEST FAIL T8: reminder count %', n; end if;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, start_at, end_at)
  values (biz, 'Shop T10', c2, 'C2', sv, 'Haircut', 200, 'appointment', 'confirmed', now() + interval '1 hour', now() + interval '90 minutes')
  returning id into bk;
  perform public.send_appointment_reminders();
  select count(*) into n from public.notifications where dedupe_key = 'appt:' || bk::text || ':2h';
  if n <> 0 then raise exception 'TEST FAIL T8: reminder sent for a booking made 0 minutes ago'; end if;

  -- T9: RLS: a user sees only their own notifications and cannot write directly
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.notifications where user_id <> c2;
  if n <> 0 then raise exception 'TEST FAIL T9: saw another user''s notifications'; end if;
  begin
    insert into public.notifications (user_id, type, category) values (c2, 'test', 'system');
    raise exception 'TEST FAIL T9: direct insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public._notify(c2, 'test', 'system', '{}'::jsonb, null);
    raise exception 'TEST FAIL T9: _notify callable by users';
  exception when insufficient_privilege then null; end;
  begin
    perform public.claim_deliveries(10);
    raise exception 'TEST FAIL T9: claim_deliveries callable by users';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_push_subscription('http://insecure.example/x', repeat('a', 30), repeat('b', 12), 'ua');
    raise exception 'TEST FAIL T9: non-https endpoint accepted';
  exception when check_violation then null; end;
  perform public.save_push_subscription('https://push.example.com/abcdefghij', repeat('a', 30), repeat('b', 12), 'ua');
  select count(*) into n from public.push_subscriptions where user_id = c2;
  if n <> 1 then raise exception 'TEST FAIL T9: subscription not saved'; end if;
  begin
    perform p256dh_key from public.push_subscriptions;
    raise exception 'TEST FAIL T9: keys readable';
  exception when insufficient_privilege then null; end;
  reset role;

  -- T10: with a push subscription and push enabled, a new notification queues a push delivery too
  d := public._notify(c2, 'booking_confirmed', 'booking', '{}'::jsonb, '/my-bookings', 'dedupe-c', false);
  select count(*) into n from public.notification_deliveries where notification_id = d and channel = 'push';
  if n <> 1 then raise exception 'TEST FAIL T10: push not queued'; end if;

  -- T11: a broken notification path must never break the business action (trigger swallows errors)
  alter table public.notifications add constraint t10_break check (false) not valid;
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  bk := public.book_walkin(sv) ->> 'id';
  reset role;
  if bk is null then raise exception 'TEST FAIL T11: booking failed because notifications failed'; end if;
  alter table public.notifications drop constraint t10_break;

  raise notice 'ALL PHASE 10 TESTS PASSED';
end $$;
rollback;
