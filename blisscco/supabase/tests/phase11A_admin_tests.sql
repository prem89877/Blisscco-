-- Phase 11 Part 1 tests (TEST project only; rolls back). Run after 0014.
-- NOT RUN by the assistant (no database available) - please run and send me any error text.
begin;
do $$
declare
  o uuid := gen_random_uuid(); c uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
  cat uuid; sh uuid; sv uuid; bk uuid; ds uuid; sb uuid; j jsonb; j0 jsonb; n int; s text; cp uuid;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (o, 'o@t11.dev', now(), '{"signup_role":"owner"}'), (c, 'c@t11.dev', now(), '{}'),
    (adm, 'adm@t11.dev', now(), '{}'), (stranger, 's@t11.dev', now(), '{}');
  update public.profiles set role = 'admin' where id = adm;
  select id into cat from public.business_categories limit 1;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, status) values (o, cat, 'Shop T11', 18.5, 73.8, 'approved') returning id into sh;
  insert into public.services (business_id, service_category, price_inr) values (sh, 'haircut', 200) returning id into sv;
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number)
  values (sh, 'Shop T11', c, 'C', sv, 'haircut', 200, 'walkin', 'no_show', current_date, 1) returning id into bk;

  -- T1: customer can raise a dispute once; stranger cannot; short reason refused
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.raise_booking_dispute(bk, 'I was there but marked absent'); raise exception 'TEST FAIL: stranger raised dispute';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.raise_booking_dispute(bk, 'short'); raise exception 'TEST FAIL: short reason accepted';
  exception when others then if sqlerrm <> 'reason_required' then raise; end if; end;
  ds := public.raise_booking_dispute(bk, 'I was there but marked absent');
  begin perform public.raise_booking_dispute(bk, 'I was there but marked absent again'); raise exception 'TEST FAIL: duplicate open dispute';
  exception when others then if sqlerrm <> 'already_open' then raise; end if; end;

  -- T2: non-admin cannot use any admin function
  begin perform public.admin_correct_booking(bk, 'completed', 'customer was present, verified', ds); raise exception 'TEST FAIL: customer corrected booking';
  exception when others then if sqlerrm <> 'admin only' then raise; end if; end;
  begin perform public.admin_list_users(null, 10, 0); raise exception 'TEST FAIL: customer listed users';
  exception when others then if sqlerrm <> 'admin only' then raise; end if; end;
  begin perform public.admin_earnings_report(current_date - 7, current_date); raise exception 'TEST FAIL: customer read earnings';
  exception when others then if sqlerrm <> 'admin only' then raise; end if; end;

  -- T3: admin correction needs a reason, only final states, writes history + audit, resolves the dispute
  reset role; perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.admin_correct_booking(bk, 'completed', 'too short', ds); raise exception 'TEST FAIL: short reason accepted';
  exception when others then if sqlerrm <> 'reason_required' then raise; end if; end;
  begin perform public.admin_correct_booking(bk, 'confirmed', 'trying to revive this booking', ds); raise exception 'TEST FAIL: revived booking';
  exception when others then if sqlerrm <> 'target_not_allowed' then raise; end if; end;
  perform public.admin_correct_booking(bk, 'completed', 'customer was present, verified with owner', ds);
  select status::text into s from public.bookings where id = bk;
  if s <> 'completed' then raise exception 'TEST FAIL: booking not corrected (%)', s; end if;
  select count(*) into n from public.admin_audit_logs where action = 'booking.correct' and entity_id = bk;
  if n <> 1 then raise exception 'TEST FAIL: correction not audited'; end if;
  select status into s from public.booking_disputes where id = ds;
  if s <> 'resolved' then raise exception 'TEST FAIL: dispute not resolved'; end if;

  -- T4: suspend user: reason needed, not self, not admin; owner suspension hides the shop; list works
  begin perform public.admin_set_user_suspended(adm, true, 'testing self'); raise exception 'TEST FAIL: suspended self';
  exception when others then if sqlerrm <> 'cannot_suspend_self' then raise; end if; end;
  begin perform public.admin_set_user_suspended(o, true, ''); raise exception 'TEST FAIL: no reason accepted';
  exception when others then if sqlerrm <> 'reason_required' then raise; end if; end;
  perform public.admin_set_user_suspended(o, true, 'fake shop reports');
  select status::text into s from public.businesses where id = sh;
  if s <> 'suspended' then raise exception 'TEST FAIL: shop of suspended owner still % ', s; end if;
  select count(*) into n from public.admin_list_users('t11.dev', 10, 0);
  if n <> 4 then raise exception 'TEST FAIL: user search returned % rows (expected 4)', n; end if;

  -- T5: grant subscription (free) -> entitlement works, report does not count it as earnings; cancel removes it
  reset role;   -- claims stay (admin), so is_admin() still works; lets us call the plain helper functions
  perform public.admin_set_business_status(sh, 'approved', null);
  j0 := public.admin_earnings_report(current_date - 1, current_date + 1);   -- baseline (the project may already hold real payments)
  sb := public.admin_grant_subscription(sh, 'pro', 30, 'launch partner');
  if public.business_tier_rank(sh) <> 1 then raise exception 'TEST FAIL: granted PRO not active'; end if;
  j := public.admin_earnings_report(current_date - 1, current_date + 1);
  if (j ->> 'gross_paise')::int <> (j0 ->> 'gross_paise')::int or (j ->> 'payments_count')::int <> (j0 ->> 'payments_count')::int
     or (j ->> 'free_grants')::int <> (j0 ->> 'free_grants')::int + 1 then raise exception 'TEST FAIL: grant counted as earnings: %', j; end if;
  perform public.admin_cancel_subscription(sb, 'granted by mistake');
  if public.business_tier_rank(sh) <> 0 then raise exception 'TEST FAIL: cancelled PRO still active'; end if;

  raise notice 'Phase 11 Part 1 tests: ALL PASSED';
end $$;
rollback;
