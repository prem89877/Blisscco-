-- 0023: India-only locations + PIN code check (server side, cannot be bypassed from the browser)
-- Run AFTER 0022. Safe to re-run. No new column; existing rows are NOT changed or blocked until their
-- latitude / longitude / pincode / status is edited again.
--
-- The polygon below is a SIMPLIFIED outline of India (about 10-20 km accuracy, coast padded offshore),
-- the same one used in src/lib/indiaGeo.ts. It is a sanity check, not an official survey boundary.

-- 1) boundary table (one row, nobody can read it directly; the functions below use it)
create table if not exists public.india_boundary (
  id int primary key default 1 check (id = 1),
  geom extensions.geometry(MultiPolygon, 4326) not null
);
alter table public.india_boundary enable row level security;
revoke all on public.india_boundary from anon, authenticated;

insert into public.india_boundary (id, geom)
values (1, extensions.st_setsrid(extensions.st_geomfromgeojson('{"type":"MultiPolygon","coordinates":[[[[68.1,23.85],[68.65,24.25],[69.6,24.28],[70.55,24.35],[71.1,24.65],[70.6,25.1],[70.25,25.75],[70.0,26.3],[70.1,27.0],[70.15,27.75],[70.9,27.95],[71.9,28.55],[72.9,29.05],[73.4,29.65],[73.9,30.0],[74.0,30.4],[74.55,30.95],[74.55,31.15],[74.57,31.6],[75.0,32.05],[75.2,32.35],[75.1,32.55],[74.55,32.75],[74.35,33.1],[74.3,33.45],[74.1,33.8],[74.05,34.1],[73.8,34.4],[74.1,34.75],[74.55,34.85],[75.2,34.85],[75.7,34.95],[76.1,35.05],[76.5,35.15],[76.9,35.45],[77.1,35.55],[77.8,35.55],[78.05,35.35],[78.25,34.65],[78.75,34.0],[79.05,33.2],[79.45,32.75],[79.05,32.45],[78.75,32.0],[78.75,31.8],[78.8,31.5],[78.8,31.15],[79.3,31.0],[79.9,30.95],[80.5,30.55],[81.03,30.25],[80.95,30.12],[80.6,29.9],[80.35,29.7],[80.3,29.4],[80.1,28.95],[80.55,28.65],[81.0,28.4],[81.45,28.1],[81.62,27.98],[82.2,27.55],[83.0,27.4],[83.45,27.45],[83.8,27.35],[84.0,27.3],[84.85,27.0],[85.5,26.85],[86.0,26.7],[87.0,26.5],[87.25,26.38],[88.0,26.4],[88.15,26.6],[88.15,26.9],[88.05,27.15],[88.0,27.45],[88.1,27.9],[88.6,28.1],[88.85,28.1],[88.85,27.4],[88.9,27.2],[89.0,26.8],[89.5,26.75],[90.4,26.85],[91.0,26.8],[91.65,26.85],[91.75,27.1],[91.65,27.55],[91.75,27.9],[92.0,27.95],[92.8,28.15],[93.5,28.6],[94.2,29.1],[94.9,29.45],[95.7,29.3],[96.2,29.05],[96.5,28.5],[97.0,28.3],[97.4,28.25],[97.35,27.9],[96.9,27.35],[96.15,27.25],[95.3,26.6],[95.0,26.0],[94.6,25.3],[94.3,24.3],[94.4,23.95],[94.0,23.85],[93.55,23.95],[93.42,23.4],[93.35,23.0],[93.1,22.0],[92.65,22.0],[92.35,22.55],[92.25,23.15],[91.95,23.65],[91.65,23.0],[91.3,23.0],[91.15,23.5],[91.25,23.85],[91.3,24.1],[91.7,24.15],[92.1,24.45],[92.25,24.75],[92.28,24.88],[92.15,25.05],[92.0,25.15],[91.5,25.18],[91.0,25.15],[90.1,25.15],[89.85,25.3],[89.9,25.6],[89.9,26.0],[89.45,25.95],[89.0,26.2],[88.75,26.35],[88.4,26.45],[88.3,26.1],[88.1,25.75],[88.35,25.4],[88.4,24.85],[88.3,24.4],[88.55,24.2],[88.65,23.95],[88.8,23.65],[88.95,23.3],[88.93,23.0],[89.0,22.6],[89.05,22.1],[88.95,21.7],[88.85,21.45],[88.2,21.45],[87.45,21.4],[86.95,21.15],[86.9,20.7],[86.85,20.15],[86.2,19.7],[85.95,19.6],[85.0,19.1],[84.2,18.1],[83.5,17.5],[82.4,16.8],[81.3,15.95],[80.55,15.75],[80.25,15.4],[80.25,14.35],[80.4,13.4],[80.45,13.0],[80.35,12.5],[80.0,11.85],[80.0,10.7],[79.97,10.25],[79.55,10.0],[79.55,9.1],[79.0,9.1],[78.25,8.7],[77.55,7.95],[77.1,8.2],[76.8,8.35],[76.4,8.85],[76.1,9.9],[75.6,11.2],[75.15,11.9],[74.7,12.85],[74.6,13.5],[73.95,14.8],[73.65,15.5],[73.5,15.9],[73.1,17.0],[72.7,18.0],[72.7,18.95],[72.65,19.9],[72.65,20.4],[72.6,21.05],[72.5,21.7],[71.5,21.3],[70.95,20.6],[70.3,20.8],[69.5,21.4],[68.9,22.0],[68.8,22.3],[68.55,23.1],[68.35,23.65],[68.1,23.85]]],[[[92.3,10.4],[92.9,10.4],[93.3,11.8],[93.2,13.0],[93.15,13.75],[92.5,13.75],[92.4,12.0],[92.3,10.4]]],[[[92.55,8.95],[93.05,8.95],[93.05,9.45],[92.55,9.45],[92.55,8.95]]],[[[93.3,6.65],[94.05,6.65],[94.05,8.35],[93.3,8.35],[93.3,6.65]]],[[[72.0,10.0],[73.85,10.0],[73.85,11.75],[72.0,11.75],[72.0,10.0]]],[[[72.9,8.15],[73.2,8.15],[73.2,8.45],[72.9,8.45],[72.9,8.15]]]]}'), 4326))
on conflict (id) do update set geom = excluded.geom;

-- 2) is this point inside India? (latitude valid? longitude valid? inside the polygon?)
create or replace function public.is_in_india(p_lat double precision, p_lng double precision)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_lat between -90 and 90 and p_lng between -180 and 180
    and exists (select 1 from public.india_boundary b
                 where extensions.st_covers(b.geom, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326))),
    false);
$$;
revoke execute on function public.is_in_india(double precision, double precision) from public;
grant execute on function public.is_in_india(double precision, double precision) to anon, authenticated;

-- 3) is this a possible Indian PIN code? 6 digits, not starting with 0, first two digits used by India Post
--    (90-99 are army post offices and 10, 29, 35, 54, 55, 65, 66, 86-89 are not used, so they are refused)
create or replace function public.is_valid_in_pincode(p text)
returns boolean language sql immutable set search_path = '' as $$
  select case when p ~ '^[1-9][0-9]{5}$' then
    substr(p, 1, 2)::int between 11 and 19 or substr(p, 1, 2)::int between 20 and 28
    or substr(p, 1, 2)::int between 30 and 34 or substr(p, 1, 2)::int between 36 and 49
    or substr(p, 1, 2)::int between 50 and 53 or substr(p, 1, 2)::int between 56 and 64
    or substr(p, 1, 2)::int between 67 and 85
  else false end;
$$;
grant execute on function public.is_valid_in_pincode(text) to anon, authenticated;

-- 4) enforce on every write to businesses (same trigger as before, with the checks added on top)
create or replace function public.businesses_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- location must be inside India (checked only when it is new or changed)
  if new.latitude is not null and new.longitude is not null
     and (tg_op = 'INSERT' or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude) then
    if not public.is_in_india(new.latitude, new.longitude) then
      raise exception 'location_outside_india' using errcode = '23514';
    end if;
  end if;

  -- PIN code must be a possible Indian PIN (checked only when it is new or changed)
  if new.pincode is not null and (tg_op = 'INSERT' or new.pincode is distinct from old.pincode) then
    if not public.is_valid_in_pincode(new.pincode) then
      raise exception 'invalid_pincode' using errcode = '23514';
    end if;
  end if;

  -- sending the shop for review needs a valid PIN code and a location inside India
  if new.status = 'pending_review' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if new.pincode is null or not public.is_valid_in_pincode(new.pincode) then
      raise exception 'application incomplete: valid PIN code' using errcode = '23514';
    end if;
    if new.latitude is null or new.longitude is null or not public.is_in_india(new.latitude, new.longitude) then
      raise exception 'application incomplete: location inside India' using errcode = '23514';
    end if;
  end if;

  -- (unchanged from 0003) location is derived from lat/lng only; clients cannot write it
  if new.latitude is not null and new.longitude is not null then
    new.location := extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)::extensions.geography;
  else
    new.location := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
