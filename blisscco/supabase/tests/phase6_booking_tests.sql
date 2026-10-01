-- Phase 6 tests (TEST project only; rolls back). Covers Tests 2 and 3, double-booking, token numbers, transitions.
begin;
do $$
declare
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  cat uuid; ba uuid; bb uuid; sa uuid; id1 uuid; tmr date := (now() at time zone 'Asia/Kolkata')::date + 1;
  n int; j jsonb; msg text;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (o1, 'o1@t.dev', now(), '{"signup_role":"owner"}'), (o2, 'o2@t.dev', now(), '{"signup_role":"owner"}'),
    (c1, 'c1@t.dev', now(), '{}'), (c2, 'c2@t.dev', now(), '{}');
  select id into cat from public.business_categories limit 1;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status) values (o1, cat, 'Shop A', 18.5, 73.8, 'approved') returning id into ba;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status) values (o2, cat, 'Shop B', 18.6, 73.9, 'approved') returning id into bb;
  insert into public.services (business_id, service_category, price_inr) values (ba, 'Facial', 500) returning id into sa;
  insert into public.business_hours (business_id, day_of_week, opens_at, closes_at, is_closed)
    select b, d, '00:00', '23:59', false from unnest(array[ba, bb]) b, generate_series(0, 6) d;

  -- c1 books 10:00 tomorrow
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  id1 := public.book_appointment(sa, tmr, '10:00');

  -- c2: same slot is full (capacity 1)
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.book_appointment(sa, tmr, '10:00'); raise exception 'TEST FAIL: double booking allowed';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; if sqlerrm <> 'slot_full' then raise exception 'TEST FAIL: wrong error %', sqlerrm; end if; end;

  -- TEST 2: c2 cannot see or cancel c1's booking
  select count(*) into n from public.bookings where id = id1;
  if n <> 0 then raise exception 'TEST FAIL: c2 can read c1 booking'; end if;
  begin perform public.set_booking_status(id1, 'cancelled'); raise exception 'TEST FAIL: c2 cancelled c1 booking';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; end;

  -- direct writes are blocked
  begin insert into public.bookings (business_id, business_name, service_id, service_label, price_inr, type, queue_date, token_number)
        values (ba, 'x', sa, 'x', 1, 'walkin', current_date, 99);
        raise exception 'TEST FAIL: direct insert allowed';
  exception when insufficient_privilege then null; end;

  -- TEST 3: owner of another shop cannot touch the booking
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.set_booking_status(id1, 'checked_in'); raise exception 'TEST FAIL: other owner changed booking';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; end;

  -- customer cannot complete; owner follows valid transitions only
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.set_booking_status(id1, 'completed'); raise exception 'TEST FAIL: customer completed booking';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.set_booking_status(id1, 'completed'); raise exception 'TEST FAIL: confirmed -> completed allowed';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; end;
  perform public.set_booking_status(id1, 'in_service');
  perform public.set_booking_status(id1, 'completed');
  select count(*) into n from public.booking_status_history where booking_id = id1;
  if n <> 3 then raise exception 'TEST FAIL: expected 3 history rows, got %', n; end if;

  -- walk-in tokens: sequential, one active per customer
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.book_walkin(sa);
  if (j ->> 'token')::int <> 1 then raise exception 'TEST FAIL: first token should be 1'; end if;
  begin perform public.book_walkin(sa); raise exception 'TEST FAIL: second active token allowed';
  exception when others then if sqlerrm like 'TEST FAIL%' then raise; end if; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.book_walkin(sa);
  if (j ->> 'token')::int <> 2 then raise exception 'TEST FAIL: second token should be 2'; end if;

  -- c2 also books 11:00 tomorrow (stays confirmed, so it must hold the slot)
  perform public.book_appointment(sa, tmr, '11:00');

  -- anon cannot book; anon can see slot availability
  reset role; set local role anon;
  begin perform public.book_walkin(sa); raise exception 'TEST FAIL: anon booked';
  exception when insufficient_privilege then null; end;
  select remaining into n from public.get_available_slots(ba, tmr) where slot_time = '11:00';
  if n <> 0 then raise exception 'TEST FAIL: 11:00 should show 0 remaining, got %', n; end if;
  select remaining into n from public.get_available_slots(ba, tmr) where slot_time = '10:00';
  if n <> 1 then raise exception 'TEST FAIL: completed booking should free 10:00, got %', n; end if;

  reset role;
  raise notice 'ALL PHASE 6 BOOKING TESTS PASSED';
end $$;
rollback;
