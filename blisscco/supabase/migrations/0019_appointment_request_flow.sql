-- 0019: Appointment REQUEST flow.
--   Customer picks only a DATE + SERVICE.  Owner then sends the TIME.  After the time is set the customer can tap
--   "Get notified" and gets a push + e-mail 20 minutes before the visit.
-- Run after 0018. Safe to re-run.
--
-- What changes in the database
--   * bookings: new columns requested_date, time_set_at, remind_me, remind_set_at. An appointment may now exist WITHOUT a
--     time (start_at / end_at null) until the owner sets it.
--   * new functions: book_appointment_request, owner_set_appointment_time, set_booking_reminder,
--                    send_appointment_remind_20 (cron, every minute), expire_unscheduled_requests (cron, daily)
--   * set_booking_status: an appointment whose time is not set yet cannot be checked-in / started / completed / no-show
--   * notification triggers: carry requested_date; a request closed without a time gets its own message
--   * old automatic 24 h / 2 h appointment reminders are switched OFF (reminders are now opt-in via "Get notified")
--   * the old timed functions (book_appointment, get_available_slots) are left in place so an old cached app keeps working.

-- ============ 1) COLUMNS ============
alter table public.bookings add column if not exists requested_date date;
alter table public.bookings add column if not exists time_set_at timestamptz;
alter table public.bookings add column if not exists remind_me boolean not null default false;
alter table public.bookings add column if not exists remind_set_at timestamptz;

update public.bookings
   set requested_date = (start_at at time zone 'Asia/Kolkata')::date
 where type = 'appointment' and requested_date is null and start_at is not null;
update public.bookings set time_set_at = coalesce(time_set_at, created_at)
 where type = 'appointment' and start_at is not null and time_set_at is null;

-- Appointment = date always known; time either fully set (start+end) or not set at all.
alter table public.bookings drop constraint if exists bookings_shape;
alter table public.bookings add constraint bookings_shape check (
  (type = 'appointment' and token_number is null and requested_date is not null and (
        (start_at is not null and end_at is not null and end_at > start_at)
     or (start_at is null and end_at is null)))
  or (type = 'walkin' and token_number is not null and queue_date is not null and start_at is null));

create index if not exists bookings_requested_idx on public.bookings (business_id, requested_date) where type = 'appointment';
create index if not exists bookings_remind_idx on public.bookings (start_at) where remind_me and type = 'appointment';

-- Old timed bookings (book_appointment) keep working: the date is filled in automatically.
create or replace function public.bookings_fill_requested_date() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.type = 'appointment' and new.requested_date is null and new.start_at is not null then
    new.requested_date := (new.start_at at time zone 'Asia/Kolkata')::date;
  end if;
  return new;
end $$;
drop trigger if exists bookings_fill_requested_date on public.bookings;
create trigger bookings_fill_requested_date before insert or update of start_at on public.bookings
  for each row execute function public.bookings_fill_requested_date();

-- ============ 2) CUSTOMER: request an appointment (date + service only) ============
create or replace function public.book_appointment_request(p_service_id uuid, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  sv public.services; b public.businesses; st public.business_booking_settings; h public.business_hours;
  v_today date := (now() at time zone 'Asia/Kolkata')::date; v_name text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_suspended) then raise exception 'not_available' using errcode = '42501'; end if;
  select * into sv from public.services where id = p_service_id and is_active;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into b from public.businesses where id = sv.business_id and status = 'approved';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if b.owner_id = auth.uid() then raise exception 'own_business' using errcode = '42501'; end if;

  select * into st from public.business_booking_settings where business_id = b.id for update;
  if not found or not st.appointments_enabled or st.temporarily_unavailable then raise exception 'not_available'; end if;
  if p_date is null or p_date < v_today or p_date > v_today + st.max_days_ahead then
    raise exception 'out_of_range' using errcode = '22023'; end if;
  select * into h from public.business_hours where business_id = b.id and day_of_week = extract(dow from p_date)::int;
  if not found or h.is_closed then raise exception 'closed_day'; end if;
  if p_date = v_today and (now() at time zone 'Asia/Kolkata')::time >= h.closes_at then raise exception 'slot_passed'; end if;

  if exists (select 1 from public.bookings x where x.customer_id = auth.uid() and x.business_id = b.id and x.type = 'appointment'
               and x.service_id = sv.id and x.requested_date = p_date and x.status in ('pending', 'confirmed', 'checked_in', 'in_service')) then
    raise exception 'duplicate'; end if;
  if (select count(*) from public.bookings x where x.customer_id = auth.uid() and x.business_id = b.id
        and x.status in ('pending', 'confirmed', 'checked_in', 'in_service')
        and ((x.type = 'appointment' and (x.start_at > now() or (x.start_at is null and x.requested_date >= v_today)))
          or (x.type = 'walkin' and x.queue_date >= v_today))) >= 3 then
    raise exception 'limit_reached'; end if;

  select left(coalesce(full_name, ''), 80) into v_name from public.profiles where id = auth.uid();
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, requested_date)
  values (b.id, b.name, auth.uid(), nullif(v_name, ''), sv.id, sv.service_category, sv.price_inr, 'appointment', 'pending', p_date)
  returning id into v_id;
  insert into public.booking_status_history (booking_id, from_status, to_status, actor_id) values (v_id, null, 'pending', auth.uid());
  return v_id;
end $$;

-- ============ 3) OWNER: send (or change) the time ============
create or replace function public.owner_set_appointment_time(p_booking_id uuid, p_time time)
returns void language plpgsql security definer set search_path = '' as $$
declare
  bk public.bookings; st public.business_booking_settings; h public.business_hours;
  v_start timestamptz; v_end timestamptz; m_start int; m_open int; m_close int; v_prev public.booking_status;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id for update;
  if not found or not public.owns_business(bk.business_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if bk.type <> 'appointment' or bk.status not in ('pending', 'confirmed') or bk.requested_date is null or p_time is null then
    raise exception 'invalid_transition'; end if;

  select * into st from public.business_booking_settings where business_id = bk.business_id for update;
  select * into h from public.business_hours where business_id = bk.business_id and day_of_week = extract(dow from bk.requested_date)::int;
  if not found or h.is_closed then raise exception 'closed_day'; end if;
  m_start := extract(hour from p_time)::int * 60 + extract(minute from p_time)::int;
  m_open := extract(hour from h.opens_at)::int * 60 + extract(minute from h.opens_at)::int;
  m_close := extract(hour from h.closes_at)::int * 60 + extract(minute from h.closes_at)::int;
  if m_start < m_open or m_start >= m_close then raise exception 'closed_day'; end if;

  v_start := (bk.requested_date + p_time) at time zone 'Asia/Kolkata';
  if v_start <= now() then raise exception 'slot_passed'; end if;
  v_end := v_start + make_interval(mins => st.slot_minutes);
  if (select count(*) from public.bookings x where x.business_id = bk.business_id and x.id <> bk.id and x.type = 'appointment'
        and x.status in ('pending', 'confirmed', 'checked_in', 'in_service') and x.start_at is not null
        and x.start_at < v_end and x.end_at > v_start) >= st.capacity then
    raise exception 'slot_full'; end if;

  v_prev := bk.status;
  update public.bookings set start_at = v_start, end_at = v_end, status = 'confirmed', time_set_at = now() where id = bk.id;
  if v_prev <> 'confirmed' then
    insert into public.booking_status_history (booking_id, from_status, to_status, actor_id) values (bk.id, v_prev, 'confirmed', auth.uid());
  end if;

  begin   -- a notification problem must never undo the time
    perform public._notify(bk.customer_id, 'appointment_time_set', 'booking',
      jsonb_build_object('booking_id', bk.id, 'business_name', bk.business_name, 'service', bk.service_label,
                         'start_at', v_start, 'requested_date', bk.requested_date, 'rescheduled', bk.start_at is not null),
      '/my-bookings', 'timeset:' || bk.id::text || ':' || (extract(epoch from v_start))::bigint::text, true);
  exception when others then
    raise warning 'notify time set failed: %', sqlerrm;
  end;
end $$;

-- ============ 4) CUSTOMER: "Get notified" button ============
create or replace function public.set_booking_reminder(p_booking_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare bk public.bookings;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id and customer_id = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if bk.type <> 'appointment' or bk.start_at is null or bk.status not in ('pending', 'confirmed') then
    raise exception 'reminder_not_allowed'; end if;
  if coalesce(p_on, false) and bk.start_at <= now() then raise exception 'slot_passed'; end if;
  update public.bookings
     set remind_me = coalesce(p_on, false), remind_set_at = case when coalesce(p_on, false) then now() else null end
   where id = bk.id;
end $$;

-- ============ 5) CRON: 20-minute reminder (push + e-mail through the normal notification pipeline) ============
-- Runs every minute. Fires once per (booking, start time): the dedupe key includes the start time, so if the owner
-- moves the visit, the customer gets a fresh reminder for the new time. Preferences (push off / e-mail off / muted
-- "reminder" category) are still respected by _notify().
create or replace function public.send_appointment_remind_20() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_made uuid; n int := 0;
begin
  for r in
    select b.id, b.customer_id, b.business_name, b.service_label, b.start_at
      from public.bookings b
     where b.type = 'appointment' and b.remind_me and b.customer_id is not null
       and b.status in ('pending', 'confirmed') and b.start_at is not null
       and b.start_at > now() and b.start_at <= now() + interval '20 minutes'
     order by b.start_at
     limit 500
  loop
    v_made := public._notify(r.customer_id, 'appointment_remind_20', 'reminder',
      jsonb_build_object('booking_id', r.id, 'business_name', r.business_name, 'service', r.service_label, 'start_at', r.start_at),
      '/my-bookings', 'appt20:' || r.id::text || ':' || (extract(epoch from r.start_at))::bigint::text, false);
    if v_made is not null then n := n + 1; end if;
  end loop;
  if n > 0 then perform public._kick_dispatcher(); end if;
  return jsonb_build_object('appointment_remind_20', n);
end $$;

-- Requests whose day has passed without the owner sending a time are closed (customer is told).
create or replace function public.expire_unscheduled_requests() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner'
   where type = 'appointment' and start_at is null and status = 'pending'
     and requested_date < (now() at time zone 'Asia/Kolkata')::date;
  get diagnostics n = row_count;
  return jsonb_build_object('expired_requests', n);
end $$;

-- ============ 6) set_booking_status: re-defined from 0010 (+ "time_not_set" guard) ============
create or replace function public.set_booking_status(p_booking_id uuid, p_new public.booking_status)
returns void language plpgsql security definer set search_path = '' as $$
declare bk public.bookings; v_owner boolean; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
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

-- ============ 7) Notification triggers: re-defined from 0013 (+ requested_date, + "request closed" message) ============
create or replace function public.trg_notify_booking_insert() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_data jsonb;
begin
  begin
    if new.source = 'customer' and new.customer_id is not null then
      select owner_id into v_owner from public.businesses where id = new.business_id;
      v_data := jsonb_build_object('booking_id', new.id, 'business_name', new.business_name, 'service', new.service_label,
                                   'booking_type', new.type, 'start_at', new.start_at, 'requested_date', new.requested_date,
                                   'token', new.token_number, 'customer_name', new.customer_name);
      perform public._notify(v_owner, 'booking_new', 'booking', v_data, '/owner/business/' || new.business_id::text || '/queue', null, true);
      perform public._notify(new.customer_id, 'booking_confirmed', 'booking', v_data, '/my-bookings', null, true);
    end if;
  exception when others then
    raise warning 'notify booking insert failed: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function public.trg_notify_booking_status() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_data jsonb;
begin
  begin
    v_data := jsonb_build_object('booking_id', new.id, 'business_name', new.business_name, 'service', new.service_label,
                                 'booking_type', new.type, 'start_at', new.start_at, 'requested_date', new.requested_date,
                                 'token', new.token_number, 'customer_name', new.customer_name);
    if new.status = 'cancelled' then
      if new.cancelled_by = 'owner' then
        perform public._notify(new.customer_id,
          case when new.type = 'appointment' and new.start_at is null then 'appointment_request_closed' else 'booking_cancelled_by_shop' end,
          'booking', v_data, '/my-bookings', null, true);
      elsif new.cancelled_by = 'customer' then
        select owner_id into v_owner from public.businesses where id = new.business_id;
        perform public._notify(v_owner, 'booking_cancelled_by_customer', 'booking', v_data, '/owner/business/' || new.business_id::text || '/queue', null, true);
      end if;
    elsif new.status = 'in_service' then
      perform public._notify(new.customer_id, 'booking_in_service', 'booking', v_data, '/my-bookings', null, true);
    elsif new.status = 'completed' then
      perform public._notify(new.customer_id, 'booking_completed', 'booking', v_data, '/my-bookings', null, true);
    elsif new.status = 'no_show' then
      perform public._notify(new.customer_id, 'booking_no_show', 'booking', v_data, '/my-bookings', null, true);
    end if;
  exception when others then
    raise warning 'notify booking status failed: %', sqlerrm;
  end;
  return null;
end $$;

-- ============ 8) Privileges ============
revoke execute on function
  public.book_appointment_request(uuid, date), public.owner_set_appointment_time(uuid, time), public.set_booking_reminder(uuid, boolean),
  public.send_appointment_remind_20(), public.expire_unscheduled_requests(), public.bookings_fill_requested_date()
  from public, anon, authenticated;
grant execute on function
  public.book_appointment_request(uuid, date), public.owner_set_appointment_time(uuid, time), public.set_booking_reminder(uuid, boolean)
  to authenticated;

-- ============ 9) pg_cron ============
do $$ begin
  create extension if not exists pg_cron;
  begin perform cron.unschedule('blisscco-appt-reminders'); exception when others then null; end;   -- old automatic 24 h / 2 h reminders: off
  perform cron.schedule('blisscco-appt-remind-20', '* * * * *', 'select public.send_appointment_remind_20()');
  -- 18:35 UTC = 00:05 India time
  perform cron.schedule('blisscco-expire-requests', '35 18 * * *', 'select public.expire_unscheduled_requests()');
exception when others then
  raise notice 'pg_cron schedule skipped (%): enable pg_cron in Dashboard > Database > Extensions, then re-run this file.', sqlerrm;
end $$;
