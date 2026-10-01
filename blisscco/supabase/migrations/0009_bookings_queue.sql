-- 0009: appointments, walk-in tokens, manual queue. ALL writes go through the functions below.
do $$ begin create type public.booking_type as enum ('appointment', 'walkin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.booking_status as enum
  ('pending', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show'); exception when duplicate_object then null; end $$;

-- ---------- Per-business booking & queue settings (one row per business) ----------
create table if not exists public.business_booking_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  appointments_enabled boolean not null default true,
  walkin_enabled boolean not null default true,
  slot_minutes int not null default 30 check (slot_minutes between 10 and 240),
  capacity int not null default 1 check (capacity between 1 and 50),
  max_days_ahead int not null default 14 check (max_days_ahead between 1 and 60),
  queue_status text not null default 'open' check (queue_status in ('open', 'paused', 'closed')),
  est_wait_minutes int check (est_wait_minutes between 0 and 600),
  temporarily_unavailable boolean not null default false,
  queue_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.settings_before_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.queue_status, new.est_wait_minutes, new.temporarily_unavailable)
     is distinct from (old.queue_status, old.est_wait_minutes, old.temporarily_unavailable) then
    new.queue_updated_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists settings_before_update on public.business_booking_settings;
create trigger settings_before_update before update on public.business_booking_settings
  for each row execute function public.settings_before_update();

create or replace function public.create_booking_settings() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_booking_settings (business_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke execute on function public.create_booking_settings() from public, anon, authenticated;
drop trigger if exists businesses_create_settings on public.businesses;
create trigger businesses_create_settings after insert on public.businesses
  for each row execute function public.create_booking_settings();
insert into public.business_booking_settings (business_id) select id from public.businesses on conflict do nothing;

alter table public.business_booking_settings enable row level security;
drop policy if exists bbs_select on public.business_booking_settings;
create policy bbs_select on public.business_booking_settings for select to authenticated
  using (public.owns_business(business_id) or public.is_admin());
drop policy if exists bbs_update on public.business_booking_settings;
create policy bbs_update on public.business_booking_settings for update to authenticated
  using (public.owns_business(business_id)) with check (public.owns_business(business_id));
revoke all on public.business_booking_settings from anon, authenticated;
grant select on public.business_booking_settings to authenticated;
grant update (appointments_enabled, walkin_enabled, slot_minutes, capacity, max_days_ahead, queue_status,
              est_wait_minutes, temporarily_unavailable) on public.business_booking_settings to authenticated;

-- ---------- Bookings ----------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  business_name text not null,
  customer_id uuid references public.profiles(id) on delete set null,
  customer_name text,
  guest_name text check (char_length(guest_name) <= 60),
  source text not null default 'customer' check (source in ('customer', 'owner')),
  service_id uuid not null references public.services(id) on delete restrict,
  service_label text not null,
  price_inr numeric(10, 2) not null check (price_inr > 0),
  type public.booking_type not null,
  status public.booking_status not null default 'confirmed',
  start_at timestamptz,
  end_at timestamptz,
  queue_date date,
  token_number int check (token_number > 0),
  checked_in_at timestamptz, started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('customer', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_shape check (
    (type = 'appointment' and start_at is not null and end_at is not null and end_at > start_at and token_number is null)
    or (type = 'walkin' and token_number is not null and queue_date is not null and start_at is null))
);
create unique index if not exists bookings_token_unique on public.bookings (business_id, queue_date, token_number) where type = 'walkin';
create index if not exists bookings_appt_idx on public.bookings (business_id, start_at) where type = 'appointment';
create index if not exists bookings_customer_idx on public.bookings (customer_id, created_at desc);
create index if not exists bookings_status_idx on public.bookings (business_id, status);
drop trigger if exists bookings_updated_at on public.bookings;
create trigger bookings_updated_at before update on public.bookings for each row execute function public.set_updated_at();

create table if not exists public.booking_status_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  from_status public.booking_status,
  to_status public.booking_status not null,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists bsh2_booking_idx on public.booking_status_history (booking_id, created_at);

alter table public.bookings enable row level security;
alter table public.booking_status_history enable row level security;
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings for select to authenticated
  using (customer_id = auth.uid() or public.owns_business(business_id) or public.is_admin());
drop policy if exists bsh2_select on public.booking_status_history;
create policy bsh2_select on public.booking_status_history for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id));
revoke all on public.bookings, public.booking_status_history from anon, authenticated;
grant select on public.bookings, public.booking_status_history to authenticated;   -- no direct writes

-- ---------- Public read helpers (no customer data) ----------
create or replace function public.get_available_slots(p_business_id uuid, p_date date)
returns table (slot_time time, remaining int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare st public.business_booking_settings; h public.business_hours;
        v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_date is null or not public.business_is_public(p_business_id) then return; end if;
  select * into st from public.business_booking_settings where business_id = p_business_id;
  if not found or not st.appointments_enabled or st.temporarily_unavailable then return; end if;
  if p_date < v_today or p_date > v_today + st.max_days_ahead then return; end if;
  select * into h from public.business_hours where business_id = p_business_id and day_of_week = extract(dow from p_date)::int;
  if not found or h.is_closed then return; end if;
  return query
  select g.t::time as slot_time,
         greatest(st.capacity - (
           select count(*)::int from public.bookings b
            where b.business_id = p_business_id and b.type = 'appointment'
              and b.status in ('pending', 'confirmed', 'checked_in', 'in_service')
              and b.start_at < ((p_date + g.t::time) at time zone 'Asia/Kolkata') + make_interval(mins => st.slot_minutes)
              and b.end_at > ((p_date + g.t::time) at time zone 'Asia/Kolkata')), 0) as remaining
    from generate_series((p_date + h.opens_at)::timestamp, (p_date + h.closes_at - make_interval(mins => st.slot_minutes))::timestamp,
                         make_interval(mins => st.slot_minutes)) as g(t)
   where ((p_date + g.t::time) at time zone 'Asia/Kolkata') > now() + interval '10 minutes'
   order by 1;
end $$;

create or replace function public.get_queue_info(p_business_id uuid)
returns table (queue_status text, temporarily_unavailable boolean, est_wait_minutes int, queue_updated_at timestamptz,
               waiting_count int, serving_count int, serving_token int, next_token int,
               walkin_enabled boolean, appointments_enabled boolean, slot_minutes int, max_days_ahead int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.business_is_public(p_business_id) then return; end if;
  return query
  select s.queue_status, s.temporarily_unavailable, s.est_wait_minutes, s.queue_updated_at,
         (select count(*)::int from public.bookings b where b.business_id = s.business_id and b.type = 'walkin' and b.queue_date = v_today and b.status in ('confirmed', 'checked_in')),
         (select count(*)::int from public.bookings b where b.business_id = s.business_id and b.type = 'walkin' and b.queue_date = v_today and b.status = 'in_service'),
         (select min(b.token_number) from public.bookings b where b.business_id = s.business_id and b.type = 'walkin' and b.queue_date = v_today and b.status = 'in_service'),
         (select min(b.token_number) from public.bookings b where b.business_id = s.business_id and b.type = 'walkin' and b.queue_date = v_today and b.status in ('confirmed', 'checked_in')),
         s.walkin_enabled, s.appointments_enabled, s.slot_minutes, s.max_days_ahead
    from public.business_booking_settings s where s.business_id = p_business_id;
end $$;

-- ---------- Booking functions (error messages are stable codes the UI translates) ----------
create or replace function public.book_appointment(p_service_id uuid, p_date date, p_time time)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  sv public.services; b public.businesses; st public.business_booking_settings; h public.business_hours;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_start timestamptz; v_end timestamptz; v_name text; v_id uuid; m_start int; m_open int; m_close int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_suspended) then raise exception 'not_available' using errcode = '42501'; end if;
  select * into sv from public.services where id = p_service_id and is_active;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into b from public.businesses where id = sv.business_id and status = 'approved';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if b.owner_id = auth.uid() then raise exception 'own_business' using errcode = '42501'; end if;

  select * into st from public.business_booking_settings where business_id = b.id for update;   -- serialises bookings per business
  if not found or not st.appointments_enabled or st.temporarily_unavailable then raise exception 'not_available'; end if;
  if p_date is null or p_time is null or p_date < v_today or p_date > v_today + st.max_days_ahead then
    raise exception 'out_of_range' using errcode = '22023'; end if;
  select * into h from public.business_hours where business_id = b.id and day_of_week = extract(dow from p_date)::int;
  if not found or h.is_closed then raise exception 'closed_day'; end if;
  m_start := extract(hour from p_time)::int * 60 + extract(minute from p_time)::int;
  m_open := extract(hour from h.opens_at)::int * 60 + extract(minute from h.opens_at)::int;
  m_close := extract(hour from h.closes_at)::int * 60 + extract(minute from h.closes_at)::int;
  if m_start < m_open or m_start + st.slot_minutes > m_close or (m_start - m_open) % st.slot_minutes <> 0 then
    raise exception 'closed_day'; end if;

  v_start := (p_date + p_time) at time zone 'Asia/Kolkata';
  if v_start <= now() + interval '10 minutes' then raise exception 'slot_passed'; end if;
  v_end := v_start + make_interval(mins => st.slot_minutes);

  if exists (select 1 from public.bookings x where x.customer_id = auth.uid() and x.business_id = b.id and x.type = 'appointment'
               and x.start_at = v_start and x.status in ('pending', 'confirmed', 'checked_in', 'in_service')) then
    raise exception 'duplicate'; end if;
  if (select count(*) from public.bookings x where x.customer_id = auth.uid() and x.business_id = b.id
        and x.status in ('pending', 'confirmed', 'checked_in', 'in_service')
        and ((x.type = 'appointment' and x.start_at > now()) or (x.type = 'walkin' and x.queue_date >= v_today))) >= 3 then
    raise exception 'limit_reached'; end if;
  if (select count(*) from public.bookings x where x.business_id = b.id and x.type = 'appointment'
        and x.status in ('pending', 'confirmed', 'checked_in', 'in_service') and x.start_at < v_end and x.end_at > v_start) >= st.capacity then
    raise exception 'slot_full'; end if;

  select left(coalesce(full_name, ''), 80) into v_name from public.profiles where id = auth.uid();
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, start_at, end_at)
  values (b.id, b.name, auth.uid(), nullif(v_name, ''), sv.id, sv.service_category, sv.price_inr, 'appointment', 'confirmed', v_start, v_end)
  returning id into v_id;
  insert into public.booking_status_history (booking_id, from_status, to_status, actor_id) values (v_id, null, 'confirmed', auth.uid());
  return v_id;
end $$;

create or replace function public.book_walkin(p_service_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sv public.services; b public.businesses; st public.business_booking_settings; h public.business_hours;
  v_today date := (now() at time zone 'Asia/Kolkata')::date; v_name text; v_id uuid; v_token int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_suspended) then raise exception 'not_available' using errcode = '42501'; end if;
  select * into sv from public.services where id = p_service_id and is_active;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into b from public.businesses where id = sv.business_id and status = 'approved';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if b.owner_id = auth.uid() then raise exception 'own_business' using errcode = '42501'; end if;

  select * into st from public.business_booking_settings where business_id = b.id for update;
  if not found or not st.walkin_enabled or st.temporarily_unavailable then raise exception 'not_available'; end if;
  if st.queue_status <> 'open' then raise exception 'queue_closed'; end if;
  select * into h from public.business_hours where business_id = b.id and day_of_week = extract(dow from v_today)::int;
  if not found or h.is_closed or (now() at time zone 'Asia/Kolkata')::time >= h.closes_at then raise exception 'closed_day'; end if;

  if exists (select 1 from public.bookings x where x.customer_id = auth.uid() and x.business_id = b.id and x.type = 'walkin'
               and x.queue_date = v_today and x.status in ('pending', 'confirmed', 'checked_in', 'in_service')) then
    raise exception 'already_has_token'; end if;
  if (select count(*) from public.bookings x where x.customer_id = auth.uid() and x.business_id = b.id
        and x.status in ('pending', 'confirmed', 'checked_in', 'in_service')
        and ((x.type = 'appointment' and x.start_at > now()) or (x.type = 'walkin' and x.queue_date >= v_today))) >= 3 then
    raise exception 'limit_reached'; end if;

  select coalesce(max(token_number), 0) + 1 into v_token from public.bookings where business_id = b.id and type = 'walkin' and queue_date = v_today;
  select left(coalesce(full_name, ''), 80) into v_name from public.profiles where id = auth.uid();
  insert into public.bookings (business_id, business_name, customer_id, customer_name, service_id, service_label, price_inr, type, status, queue_date, token_number)
  values (b.id, b.name, auth.uid(), nullif(v_name, ''), sv.id, sv.service_category, sv.price_inr, 'walkin', 'confirmed', v_today, v_token)
  returning id into v_id;
  insert into public.booking_status_history (booking_id, from_status, to_status, actor_id) values (v_id, null, 'confirmed', auth.uid());
  update public.business_booking_settings set queue_updated_at = now() where business_id = b.id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- Owner issues a token for a customer standing in the shop (no account needed)
create or replace function public.owner_issue_token(p_service_id uuid, p_guest_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sv public.services; b public.businesses; st public.business_booking_settings;
  v_today date := (now() at time zone 'Asia/Kolkata')::date; v_id uuid; v_token int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into sv from public.services where id = p_service_id and is_active;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into b from public.businesses where id = sv.business_id and status = 'approved';
  if not found or not public.owns_business(b.id) then raise exception 'not_found' using errcode = 'P0002'; end if;

  select * into st from public.business_booking_settings where business_id = b.id for update;
  select coalesce(max(token_number), 0) + 1 into v_token from public.bookings where business_id = b.id and type = 'walkin' and queue_date = v_today;
  insert into public.bookings (business_id, business_name, customer_id, guest_name, source, service_id, service_label, price_inr, type, status, queue_date, token_number, checked_in_at)
  values (b.id, b.name, null, nullif(left(trim(coalesce(p_guest_name, '')), 60), ''), 'owner', sv.id, sv.service_category, sv.price_inr, 'walkin', 'checked_in', v_today, v_token, now())
  returning id into v_id;
  insert into public.booking_status_history (booking_id, from_status, to_status, actor_id) values (v_id, null, 'checked_in', auth.uid());
  update public.business_booking_settings set queue_updated_at = now() where business_id = b.id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- Status changes with enforced transitions
create or replace function public.set_booking_status(p_booking_id uuid, p_new public.booking_status)
returns void language plpgsql security definer set search_path = '' as $$
declare bk public.bookings; v_owner boolean; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_owner := public.owns_business(bk.business_id);
  if not (v_owner or bk.customer_id = auth.uid()) then raise exception 'not_found' using errcode = 'P0002'; end if;

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
         cancelled_by = case when p_new = 'cancelled' then (case when v_owner then 'owner' else 'customer' end) else cancelled_by end
   where id = bk.id;
  insert into public.booking_status_history (booking_id, from_status, to_status, actor_id) values (bk.id, bk.status, p_new, auth.uid());
  if bk.type = 'walkin' then update public.business_booking_settings set queue_updated_at = now() where business_id = bk.business_id; end if;
end $$;

-- ---------- Function privileges ----------
revoke execute on function public.get_available_slots(uuid, date), public.get_queue_info(uuid),
  public.book_appointment(uuid, date, time), public.book_walkin(uuid), public.owner_issue_token(uuid, text),
  public.set_booking_status(uuid, public.booking_status) from public, anon, authenticated;
grant execute on function public.get_available_slots(uuid, date), public.get_queue_info(uuid) to anon, authenticated;
grant execute on function public.book_appointment(uuid, date, time), public.book_walkin(uuid), public.owner_issue_token(uuid, text),
  public.set_booking_status(uuid, public.booking_status) to authenticated;
