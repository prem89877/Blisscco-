-- 0022: Automatic walk-in queue.
--   * Positions are NEVER stored. A customer's position is computed live from the waiting tokens ahead of them
--     (token order), so when someone is served, skipped or cancelled everybody behind moves up on its own.
--   * Owner gets 3 simple actions: Start Next, Complete, Skip.
--   * All transitions are serialised per business (row lock on business_booking_settings) and re-validated under the
--     booking row lock, so a double-click or two devices at once cannot serve the same token twice or exceed the
--     number of people the shop can serve at the same time (business_booking_settings.capacity, default 1).
-- Run after 0021. Safe to re-run. No table / column / RLS change.
--
-- New functions
--   owner_queue_start_next(business_id)  next waiting token -> in_service      (errors: queue_empty, already_serving)
--   owner_queue_complete(booking_id)     in_service -> completed
--   owner_queue_skip(booking_id)         waiting token -> no_show (customer did not turn up)
--   get_my_queue_positions()             live position of the caller's own walk-in tokens for today
-- Re-defined (from 0019): set_booking_status  (+ "already_serving" guard for walk-in tokens, same lock order)

-- ============ 1) set_booking_status: 0019 version + serving guard ============
-- Lock order is always  business_booking_settings  ->  bookings  (start_next does the same), so no deadlock.
create or replace function public.set_booking_status(p_booking_id uuid, p_new public.booking_status)
returns void language plpgsql security definer set search_path = '' as $$
declare bk public.bookings; st public.business_booking_settings; v_owner boolean; v_ok boolean; v_biz uuid; v_type public.booking_type;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  -- starting a walk-in token: take the business lock FIRST so only one start runs at a time
  select business_id, type into v_biz, v_type from public.bookings where id = p_booking_id;
  if found and v_type = 'walkin' and p_new = 'in_service' then
    select * into st from public.business_booking_settings where business_id = v_biz for update;
  end if;

  select * into bk from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_owner := public.owns_business(bk.business_id);
  if not (v_owner or bk.customer_id = auth.uid()) then raise exception 'not_found' using errcode = 'P0002'; end if;

  if bk.type = 'appointment' and bk.start_at is null and p_new in ('confirmed', 'checked_in', 'in_service', 'completed', 'no_show') then
    raise exception 'time_not_set';        -- send the time first (owner_set_appointment_time)
  end if;

  if v_owner then
    v_ok := case bk.status
      when 'pending' then p_new in ('confirmed', 'cancelled')
      when 'confirmed' then p_new in ('checked_in', 'in_service', 'cancelled', 'no_show')
      when 'checked_in' then p_new in ('in_service', 'cancelled', 'no_show')
      when 'in_service' then p_new = 'completed'
      else false end;
    if v_ok and p_new = 'no_show' and bk.type = 'appointment' and bk.start_at > now() then v_ok := false; end if;
  else
    v_ok := bk.status in ('pending', 'confirmed', 'checked_in') and p_new = 'cancelled';
  end if;
  if not v_ok then raise exception 'invalid_transition'; end if;

  -- never serve more people at once than the shop can (capacity, default 1)
  if bk.type = 'walkin' and p_new = 'in_service' then
    if (select count(*) from public.bookings x
         where x.business_id = bk.business_id and x.type = 'walkin' and x.queue_date = bk.queue_date
           and x.status = 'in_service') >= greatest(coalesce(st.capacity, 1), 1) then
      raise exception 'already_serving';
    end if;
  end if;

  update public.bookings set status = p_new,
         checked_in_at = case when p_new = 'checked_in' then now() else checked_in_at end,
         started_at = case when p_new = 'in_service' then now() else started_at end,
         completed_at = case when p_new = 'completed' then now() else completed_at end,
         cancelled_at = case when p_new = 'cancelled' then now() else cancelled_at end,
         cancelled_by = case when p_new = 'cancelled' then (case when v_owner then 'owner' else 'customer' end) else cancelled_by end,
         remind_me = case when p_new in ('cancelled', 'completed', 'no_show') then false else remind_me end
   where id = bk.id;
  insert into public.booking_status_history (booking_id, from_status, to_status, actor_id) values (bk.id, bk.status, p_new, auth.uid());
  if bk.type = 'walkin' then update public.business_booking_settings set queue_updated_at = now() where business_id = bk.business_id; end if;
  if p_new = 'completed' and bk.customer_id is not null then perform public.try_reward_referral(bk.customer_id); end if;
end $$;

-- ============ 2) OWNER: Start Next ============
-- Picks the lowest waiting token of TODAY and starts it. Two taps / two devices at the same moment: the second one
-- waits for the lock, then sees the shop is already serving (or the queue is empty) and gets a clear error.
create or replace function public.owner_queue_start_next(p_business_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  st public.business_booking_settings; bk public.bookings; v_serving int;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_business_id is null or not public.owns_business(p_business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;

  select * into st from public.business_booking_settings where business_id = p_business_id for update;   -- serialises the queue
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  select count(*)::int into v_serving from public.bookings
   where business_id = p_business_id and type = 'walkin' and queue_date = v_today and status = 'in_service';
  if v_serving >= greatest(st.capacity, 1) then raise exception 'already_serving'; end if;

  select * into bk from public.bookings
   where business_id = p_business_id and type = 'walkin' and queue_date = v_today and status in ('confirmed', 'checked_in')
   order by token_number limit 1 for update;
  if not found then raise exception 'queue_empty'; end if;

  perform public.set_booking_status(bk.id, 'in_service');   -- history, notification, queue_updated_at
  return jsonb_build_object('id', bk.id, 'token', bk.token_number);
end $$;

-- ============ 3) OWNER: Complete ============
create or replace function public.owner_queue_complete(p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare bk public.bookings;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id;
  if not found or bk.type <> 'walkin' or not public.owns_business(bk.business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if bk.status <> 'in_service' then raise exception 'invalid_transition'; end if;      -- already completed (double tap)
  perform public.set_booking_status(p_booking_id, 'completed');                      -- re-checks under the row lock
end $$;

-- ============ 4) OWNER: Skip (customer did not turn up) ============
-- Only a WAITING token can be skipped. It is marked 'no_show' (customer is notified by the existing trigger) and everyone
-- behind moves up automatically.
create or replace function public.owner_queue_skip(p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare bk public.bookings;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id;
  if not found or bk.type <> 'walkin' or not public.owns_business(bk.business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if bk.status not in ('confirmed', 'checked_in') then raise exception 'invalid_transition'; end if;
  perform public.set_booking_status(p_booking_id, 'no_show');                        -- re-checks under the row lock
end $$;

-- ============ 5) CUSTOMER: my live position ============
-- One call returns every active walk-in token of the caller for today:
--   position = 1 + number of waiting tokens ahead of mine  (null once I am being served)
create or replace function public.get_my_queue_positions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_out jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'business_id', b.business_id, 'status', b.status, 'token', b.token_number,
           'position', case when b.status in ('confirmed', 'checked_in') then 1 + (
                 select count(*)::int from public.bookings x
                  where x.business_id = b.business_id and x.type = 'walkin' and x.queue_date = b.queue_date
                    and x.status in ('confirmed', 'checked_in') and x.token_number < b.token_number) end,
           'serving_token', (select min(x.token_number) from public.bookings x
                  where x.business_id = b.business_id and x.type = 'walkin' and x.queue_date = b.queue_date and x.status = 'in_service'),
           'queue_status', s.queue_status, 'est_wait_minutes', s.est_wait_minutes, 'queue_updated_at', s.queue_updated_at
         ) order by b.created_at), '[]'::jsonb)
    into v_out
    from public.bookings b
    join public.business_booking_settings s on s.business_id = b.business_id
   where b.customer_id = auth.uid() and b.type = 'walkin' and b.queue_date = v_today
     and b.status in ('confirmed', 'checked_in', 'in_service');
  return v_out;
end $$;

-- ============ 6) Privileges ============
revoke execute on function public.set_booking_status(uuid, public.booking_status), public.owner_queue_start_next(uuid),
  public.owner_queue_complete(uuid), public.owner_queue_skip(uuid), public.get_my_queue_positions()
  from public, anon, authenticated;
grant execute on function public.set_booking_status(uuid, public.booking_status), public.owner_queue_start_next(uuid),
  public.owner_queue_complete(uuid), public.owner_queue_skip(uuid), public.get_my_queue_positions()
  to authenticated;

-- ============ 7) Realtime: customers get their own booking changes pushed instantly ============
-- RLS still applies (a customer only receives rows where customer_id = their id). Position of OTHER people is never sent;
-- the app re-asks get_my_queue_positions() on every change and every few seconds.
do $$ begin
  alter publication supabase_realtime add table public.bookings;
exception
  when duplicate_object then null;      -- already added
  when undefined_object then raise notice 'publication supabase_realtime not found: realtime skipped (the app still polls every 5 s).';
  when others then raise notice 'realtime publication skipped (%): the app still polls every 5 s.', sqlerrm;
end $$;
