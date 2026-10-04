-- India validation tests (TEST project only; rolls back). Run after 0023.
-- NOT RUN by the assistant (no database available) - please run and send me any error text.
begin;
do $$
declare
  o uuid := gen_random_uuid(); cat uuid; sh uuid;
begin
  -- T1: points inside / outside India
  if not public.is_in_india(28.61, 77.21) then raise exception 'TEST FAIL: Delhi should be inside'; end if;
  if not public.is_in_india(11.62, 92.73) then raise exception 'TEST FAIL: Port Blair should be inside'; end if;
  if not public.is_in_india(10.57, 72.64) then raise exception 'TEST FAIL: Kavaratti should be inside'; end if;
  if not public.is_in_india(34.16, 77.58) then raise exception 'TEST FAIL: Leh should be inside'; end if;
  if public.is_in_india(27.71, 85.32) then raise exception 'TEST FAIL: Kathmandu accepted'; end if;
  if public.is_in_india(23.81, 90.41) then raise exception 'TEST FAIL: Dhaka accepted'; end if;
  if public.is_in_india(31.55, 74.34) then raise exception 'TEST FAIL: Lahore accepted'; end if;
  if public.is_in_india(0, 0) then raise exception 'TEST FAIL: 0,0 accepted'; end if;
  if public.is_in_india(77.21, 28.61) then raise exception 'TEST FAIL: swapped lat/lng accepted'; end if;
  if public.is_in_india(null, 77) then raise exception 'TEST FAIL: null latitude accepted'; end if;
  if public.is_in_india(95, 77) then raise exception 'TEST FAIL: latitude 95 accepted'; end if;

  -- T2: PIN codes
  if not public.is_valid_in_pincode('411001') then raise exception 'TEST FAIL: 411001 refused'; end if;
  if public.is_valid_in_pincode('011001') then raise exception 'TEST FAIL: leading 0 accepted'; end if;
  if public.is_valid_in_pincode('41100') then raise exception 'TEST FAIL: 5 digits accepted'; end if;
  if public.is_valid_in_pincode('4110011') then raise exception 'TEST FAIL: 7 digits accepted'; end if;
  if public.is_valid_in_pincode('900001') then raise exception 'TEST FAIL: army PIN accepted'; end if;
  if public.is_valid_in_pincode('55abc1') then raise exception 'TEST FAIL: letters accepted'; end if;

  -- T3: businesses table refuses bad data, accepts good data
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (o, 'o@t11c.dev', now(), '{"signup_role":"owner"}');
  select id into cat from public.business_categories limit 1;
  begin
    insert into public.businesses (owner_id, category_id, name, latitude, longitude) values (o, cat, 'Shop Out', 27.71, 85.32);
    raise exception 'TEST FAIL: Kathmandu shop accepted';
  exception when others then if sqlerrm <> 'location_outside_india' then raise; end if; end;
  begin
    insert into public.businesses (owner_id, category_id, name, pincode) values (o, cat, 'Shop Bad PIN', '011001');
    raise exception 'TEST FAIL: bad PIN accepted';
  exception when others then if sqlerrm <> 'invalid_pincode' then raise; end if; end;
  insert into public.businesses (owner_id, category_id, name, latitude, longitude, pincode)
  values (o, cat, 'Shop Pune', 18.52, 73.86, '411001') returning id into sh;

  -- T4: editing later is checked too
  begin
    update public.businesses set latitude = 27.71, longitude = 85.32 where id = sh;
    raise exception 'TEST FAIL: moving shop outside India accepted';
  exception when others then if sqlerrm <> 'location_outside_india' then raise; end if; end;
  begin
    update public.businesses set pincode = '900001' where id = sh;
    raise exception 'TEST FAIL: army PIN accepted on update';
  exception when others then if sqlerrm <> 'invalid_pincode' then raise; end if; end;
  update public.businesses set latitude = 19.07, longitude = 72.88, pincode = '400001' where id = sh;   -- Mumbai: fine

  -- T5: cannot be sent for review without a PIN code
  update public.businesses set pincode = null where id = sh;
  begin
    update public.businesses set status = 'pending_review' where id = sh;
    raise exception 'TEST FAIL: sent for review without PIN';
  exception when others then if sqlerrm <> 'application incomplete: valid PIN code' then raise; end if; end;

  raise notice 'India validation tests passed';
end $$;
rollback;
