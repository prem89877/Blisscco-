-- Phase 9 tests (TEST project only; rolls back). Run after 0012 (and 0009-0011).
-- NOT RUN yet by the assistant (no database available) - please run and send me any error text.
begin;
-- Test helper: buys a plan through the real payment functions (so the subscription rows are real and valid)
create function pg_temp.activate(p_owner uuid, p_biz uuid, p_plan text, p_amount int, p_tag text) returns void language plpgsql as $f$
declare tx jsonb; r text;
begin
  tx := public.create_payment_txn(p_owner, p_biz, p_plan, 'rc-' || p_tag);
  perform public.attach_razorpay_order((tx ->> 'txn_id')::uuid, 'order_' || p_tag);
  r := public.process_razorpay_event('evt_' || p_tag, 'payment.captured', jsonb_build_object('event', 'payment.captured', 'payload',
         jsonb_build_object('payment', jsonb_build_object('entity', jsonb_build_object('id', 'pay_' || p_tag, 'order_id', 'order_' || p_tag,
           'amount', p_amount, 'currency', 'INR', 'status', 'captured')))));
  if r <> 'activated' then raise exception 'TEST SETUP: plan not activated (%)', r; end if;
end $f$;
do $$
declare
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid();
  cat uuid; ba uuid; bb uuid; sv uuid; n int; ok bool; j jsonb; bk uuid;
  s1 text := 'aaaaaaaa-1111-2222-3333-444444444444'; s2 text := 'bbbbbbbb-1111-2222-3333-444444444444';
  ua text := '{"user-agent":"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36"}';
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (o1, 'o1@t9.dev', now(), '{"signup_role":"owner"}'), (o2, 'o2@t9.dev', now(), '{"signup_role":"owner"}'), (c1, 'c1@t9.dev', now(), '{}');
  select id into cat from public.business_categories limit 1;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status) values (o1, cat, 'Shop A', 18.5, 73.8, 'approved') returning id into ba;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status) values (o2, cat, 'Shop B', 18.5, 73.8, 'approved') returning id into bb;
  insert into public.services (business_id, service_category, price_inr) values (ba, 'Haircut', 200) returning id into sv;

  -- anonymous visitor with a normal browser user-agent
  perform set_config('request.headers', ua, true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;

  -- T1: a view is stored; the same visitor refreshing is a duplicate (not stored)
  if not public.track_event(ba, 'profile_view', 'qr', s1) then raise exception 'TEST FAIL: first view not stored'; end if;
  if public.track_event(ba, 'profile_view', 'qr', s1) then raise exception 'TEST FAIL: duplicate view stored'; end if;
  if not public.track_event(ba, 'profile_view', 'search', s2) then raise exception 'TEST FAIL: second visitor not stored'; end if;

  -- T2: bot user-agents and missing user-agent are dropped
  perform set_config('request.headers', '{"user-agent":"Googlebot/2.1 (+http://www.google.com/bot.html)"}', true);
  if public.track_event(ba, 'profile_view', 'direct', 'cccccccc-1111-2222-3333-444444444444') then raise exception 'TEST FAIL: bot counted'; end if;
  perform set_config('request.headers', '{}', true);
  if public.track_event(ba, 'profile_view', 'direct', 'dddddddd-1111-2222-3333-444444444444') then raise exception 'TEST FAIL: no user-agent counted'; end if;
  perform set_config('request.headers', ua, true);

  -- T3: bad input is dropped silently (unknown source / event, bad session id, unknown shop)
  if public.track_event(ba, 'profile_view', 'hacker', 'eeeeeeee-1111-2222-3333-444444444444') then raise exception 'TEST FAIL: bad source stored'; end if;
  if public.track_event(ba, 'delete_everything', 'qr', 'eeeeeeee-1111-2222-3333-444444444444') then raise exception 'TEST FAIL: bad event stored'; end if;
  if public.track_event(ba, 'profile_view', 'qr', 'short') then raise exception 'TEST FAIL: bad session stored'; end if;
  if public.track_event(gen_random_uuid(), 'profile_view', 'qr', 'ffffffff-1111-2222-3333-444444444444') then raise exception 'TEST FAIL: unknown shop stored'; end if;

  -- T4: anonymous people cannot fake a booking event
  if public.track_event(ba, 'booking', 'qr', s1) then raise exception 'TEST FAIL: anonymous booking event stored'; end if;

  -- T5: impressions are stored once per visitor per shop
  n := public.track_impressions(array[ba, bb, ba], s1);
  if n <> 2 then raise exception 'TEST FAIL: impressions stored % (expected 2)', n; end if;
  if public.track_impressions(array[ba, bb], s1) <> 0 then raise exception 'TEST FAIL: impressions duplicated'; end if;

  -- T6: the table has no personal columns and cannot be read or written directly
  begin perform 1 from public.analytics_events limit 1; raise exception 'TEST FAIL: anon read analytics_events';
  exception when insufficient_privilege then null; end;
  begin insert into public.analytics_events (business_id, event_type, source, session_hash, dedupe_key) values (ba, 'booking', 'qr', 'x', 'x');
        raise exception 'TEST FAIL: anon wrote analytics_events';
  exception when insufficient_privilege then null; end;
  begin perform public._analytics_record(ba, 'profile_view', 'qr', s1, null); raise exception 'TEST FAIL: anon ran internal recorder';
  exception when insufficient_privilege then null; end;
  begin perform public.get_analytics(ba, current_date - 7, current_date); raise exception 'TEST FAIL: anon ran get_analytics';
  exception when insufficient_privilege then null; end;
  reset role;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'analytics_events'
              and column_name in ('user_id', 'customer_id', 'phone', 'email', 'name', 'ip', 'user_agent')) then
    raise exception 'TEST FAIL: personal column found in analytics_events';
  end if;

  -- T7: the shop owner's own visits do not count
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.track_event(ba, 'profile_view', 'direct', 'a0a0a0a0-1111-2222-3333-444444444444') then raise exception 'TEST FAIL: owner own view counted'; end if;

  -- T8: get_analytics needs a paid plan (FREE is refused), only for the owner
  begin perform public.get_analytics(ba, current_date - 7, current_date); raise exception 'TEST FAIL: FREE plan got analytics';
  exception when others then if sqlerrm <> 'plan_required' then raise; end if; end;
  reset role;
  perform pg_temp.activate(o1, ba, 'pro', 49900, 'a_pro');
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_analytics(ba, (now() at time zone 'Asia/Kolkata')::date - 6, (now() at time zone 'Asia/Kolkata')::date);
  if (j -> 'totals' ->> 'profile_view')::int <> 2 then raise exception 'TEST FAIL: views total % (expected 2)', j -> 'totals'; end if;
  if (j -> 'totals' ->> 'search_impression')::int <> 1 then raise exception 'TEST FAIL: impressions total %', j -> 'totals'; end if;
  if jsonb_array_length(j -> 'daily') <> 7 or jsonb_array_length(j -> 'by_source') <> 4 then raise exception 'TEST FAIL: shape %', j; end if;
  if (j -> 'by_source' -> 0 ->> 'source') <> 'qr' or (j -> 'by_source' -> 0 ->> 'profile_view')::int <> 1 then raise exception 'TEST FAIL: qr source %', j -> 'by_source'; end if;
  begin perform public.get_analytics(ba, current_date, current_date - 1); raise exception 'TEST FAIL: reversed range accepted';
  exception when others then if sqlerrm <> 'invalid_range' then raise; end if; end;
  begin perform public.get_analytics(ba, current_date - 400, current_date); raise exception 'TEST FAIL: 400-day range accepted';
  exception when others then if sqlerrm <> 'invalid_range' then raise; end if; end;

  -- T9: another owner cannot read this shop's numbers (even with a PRO plan of their own)
  reset role;
  perform pg_temp.activate(o2, bb, 'pro', 49900, 'b_pro');
  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.get_analytics(ba, current_date - 7, current_date); raise exception 'TEST FAIL: other owner read analytics';
  exception when others then if sqlerrm <> 'not_owner' then raise; end if; end;
  reset role;

  -- T10: a booking event only works for a real, fresh booking by that customer; counted once
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.track_event(ba, 'booking', 'qr', s2) then raise exception 'TEST FAIL: booking event without a booking'; end if;
  reset role;
  insert into public.bookings (business_id, business_name, customer_id, service_id, service_label, price_inr, type, status, queue_date, token_number)
  values (ba, 'Shop A', c1, sv, 'Haircut', 200, 'walkin', 'confirmed', (now() at time zone 'Asia/Kolkata')::date, 1) returning id into bk;
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.track_event(ba, 'booking', 'qr', s2) then raise exception 'TEST FAIL: real booking event not stored'; end if;
  if public.track_event(ba, 'booking', 'qr', 'a1a1a1a1-1111-2222-3333-444444444444') then raise exception 'TEST FAIL: same booking counted twice'; end if;
  if public.track_event(bb, 'booking', 'qr', s2) then raise exception 'TEST FAIL: booking event for a shop without booking'; end if;
  reset role;
  select count(*) into n from public.analytics_events where business_id = ba and event_type = 'booking';
  if n <> 1 then raise exception 'TEST FAIL: booking rows % (expected 1)', n; end if;

  -- T11: AI quota: FREE/PRO refused, ELITE allowed, 10 per 24 h, other owner refused
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.claim_ai_insight(ba); raise exception 'TEST FAIL: PRO got AI insights';
  exception when others then if sqlerrm <> 'elite_required' then raise; end if; end;
  reset role;
  perform pg_temp.activate(o1, ba, 'elite', 79900, 'a_elite');
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for n in 1..10 loop perform public.claim_ai_insight(ba); end loop;
  begin perform public.claim_ai_insight(ba); raise exception 'TEST FAIL: 11th AI request allowed';
  exception when others then if sqlerrm <> 'rate_limited' then raise; end if; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.claim_ai_insight(ba); raise exception 'TEST FAIL: other owner claimed AI insight';
  exception when others then if sqlerrm <> 'not_owner' then raise; end if; end;
  begin perform 1 from public.ai_insight_log limit 1; raise exception 'TEST FAIL: owner read ai_insight_log';
  exception when insufficient_privilege then null; end;
  reset role;

  -- T12: retention removes only old rows
  update public.analytics_events set created_at = now() - interval '401 days' where id = (select min(id) from public.analytics_events);
  j := public.purge_old_analytics();
  if (j ->> 'events_deleted')::int <> 1 then raise exception 'TEST FAIL: purge result %', j; end if;

  raise notice 'ALL PHASE 9 TESTS PASSED';
end $$;
rollback;
