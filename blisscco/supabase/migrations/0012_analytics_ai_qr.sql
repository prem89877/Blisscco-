-- Phase 9: anonymous analytics, get_analytics (PRO/ELITE), ELITE AI-insight quota, retention job.
-- Re-runnable. Needs 0003 (owns_business), 0002 (is_admin), 0009 (bookings), 0011 (plans, has_entitlement, business_tier_rank).
--
-- PRIVACY: analytics_events has NO user id, phone, name, email, IP or user-agent.
-- session_hash = sha256(random per-tab id + India date): anonymous and changes every day, so it cannot follow a person across days.

-- ============ TABLE ============
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  event_type text not null check (event_type in ('profile_view', 'search_impression', 'booking')),
  source text not null check (source in ('qr', 'search', 'referral', 'direct')),
  session_hash text not null,
  dedupe_key text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists analytics_dedupe_uq on public.analytics_events (dedupe_key);
create index if not exists analytics_biz_time_idx on public.analytics_events (business_id, created_at);
create index if not exists analytics_session_idx on public.analytics_events (session_hash, created_at);

alter table public.analytics_events enable row level security;   -- no policies: nobody reads/writes directly
revoke all on public.analytics_events from anon, authenticated;

-- ============ INTERNAL RECORDER (not callable from the browser) ============
-- Returns true only when a row was really stored. Every filter just returns false (no error, nothing to probe).
-- p_unique: when set, the event is stored at most ONCE for that value (used for bookings).
-- When null: at most once per session + shop + event per 30 minutes (page refresh / scrolling does not inflate).
create or replace function public._analytics_record(p_business_id uuid, p_event text, p_source text, p_session text, p_unique text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ua text; v_hash text; v_key text; v_n int; v_rows int;
begin
  if p_event not in ('profile_view', 'search_impression', 'booking') then return false; end if;
  if p_source not in ('qr', 'search', 'referral', 'direct') then return false; end if;
  if p_business_id is null or p_session is null or p_session !~ '^[A-Za-z0-9-]{16,64}$' then return false; end if;

  -- BOT FILTER 1: user-agent (sent by every real browser; crawlers / scripts / link-preview fetchers are dropped)
  begin
    v_ua := lower(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', ''));
  exception when others then v_ua := '';
  end;
  if length(v_ua) < 10
     or v_ua ~ '(bot|crawl|spider|slurp|headless|phantom|lighthouse|preview|facebookexternalhit|whatsapp|curl|wget|python|java/|go-http|okhttp|axios|node-fetch|httpclient|scrapy|monitor|uptime)' then
    return false;
  end if;

  -- Only live shops; the shop's own owner and admins (previewing) never count
  if not exists (select 1 from public.businesses where id = p_business_id and status = 'approved') then return false; end if;
  if public.owns_business(p_business_id) or public.is_admin() then return false; end if;

  v_hash := encode(sha256(convert_to(p_session || ':' || ((now() at time zone 'Asia/Kolkata')::date)::text, 'utf8')), 'hex');

  -- BOT FILTER 2: a single anonymous session cannot create more than 300 events per hour
  select count(*) into v_n from public.analytics_events where session_hash = v_hash and created_at > now() - interval '1 hour';
  if v_n >= 300 then return false; end if;

  -- DUPLICATE FILTER
  if p_unique is not null then
    v_key := encode(sha256(convert_to(p_event || ':' || p_unique, 'utf8')), 'hex');
  else
    v_key := encode(sha256(convert_to(p_event || ':' || p_business_id::text || ':' || v_hash || ':' ||
                      floor(extract(epoch from now()) / 1800)::bigint::text, 'utf8')), 'hex');
  end if;

  insert into public.analytics_events (business_id, event_type, source, session_hash, dedupe_key)
  values (p_business_id, p_event, p_source, v_hash, v_key)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- ============ PUBLIC TRACKING FUNCTIONS ============
-- profile_view: anyone. booking: only a logged-in customer who really created a booking at that shop in the last 10 minutes
-- (so nobody can fake bookings); each booking counts once. Never raises: a tracking problem must not break the page.
create or replace function public.track_event(p_business_id uuid, p_event text, p_source text, p_session text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_booking uuid;
begin
  if p_event = 'profile_view' then
    return public._analytics_record(p_business_id, 'profile_view', p_source, p_session, null);
  elsif p_event = 'booking' then
    if auth.uid() is null then return false; end if;
    select id into v_booking from public.bookings
     where customer_id = auth.uid() and business_id = p_business_id and source = 'customer'
       and created_at > now() - interval '10 minutes'
     order by created_at desc limit 1;
    if v_booking is null then return false; end if;
    return public._analytics_record(p_business_id, 'booking', p_source, p_session, v_booking::text);
  end if;
  return false;   -- search impressions use track_impressions()
end $$;

-- Search results shown on screen (up to 50 shops per call)
create or replace function public.track_impressions(p_business_ids uuid[], p_session text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_n int := 0;
begin
  if p_business_ids is null then return 0; end if;
  for v_id in select distinct x from unnest(p_business_ids[1:50]) as x loop
    if public._analytics_record(v_id, 'search_impression', 'search', p_session, null) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- ============ get_analytics: PRO / ELITE owners only ============
-- Day buckets are India time. Range 1..366 days. Counts only, no personal data exists in the table.
create or replace function public.get_analytics(p_business_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz; v_to timestamptz; v_totals jsonb; v_src jsonb; v_daily jsonb;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then raise exception 'not_owner' using errcode = '42501'; end if;
  if not public.has_entitlement(p_business_id, 'analytics') then raise exception 'plan_required' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then raise exception 'invalid_range' using errcode = '22023'; end if;

  v_from := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';

  select jsonb_build_object(
           'profile_view', count(*) filter (where event_type = 'profile_view'),
           'search_impression', count(*) filter (where event_type = 'search_impression'),
           'booking', count(*) filter (where event_type = 'booking'))
    into v_totals
    from public.analytics_events
   where business_id = p_business_id and created_at >= v_from and created_at < v_to;

  select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'profile_view', coalesce(c.pv, 0),
           'search_impression', coalesce(c.si, 0), 'booking', coalesce(c.bk, 0)) order by s.ord), '[]'::jsonb)
    into v_src
    from (values ('qr', 1), ('search', 2), ('referral', 3), ('direct', 4)) as s(source, ord)
    left join (
      select source,
             count(*) filter (where event_type = 'profile_view') as pv,
             count(*) filter (where event_type = 'search_impression') as si,
             count(*) filter (where event_type = 'booking') as bk
        from public.analytics_events
       where business_id = p_business_id and created_at >= v_from and created_at < v_to
       group by source) c on c.source = s.source;

  select coalesce(jsonb_agg(jsonb_build_object('day', d.dy, 'profile_view', coalesce(c.pv, 0),
           'search_impression', coalesce(c.si, 0), 'booking', coalesce(c.bk, 0)) order by d.dy), '[]'::jsonb)
    into v_daily
    from (select g::date as dy from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g) d
    left join (
      select (created_at at time zone 'Asia/Kolkata')::date as dy,
             count(*) filter (where event_type = 'profile_view') as pv,
             count(*) filter (where event_type = 'search_impression') as si,
             count(*) filter (where event_type = 'booking') as bk
        from public.analytics_events
       where business_id = p_business_id and created_at >= v_from and created_at < v_to
       group by 1) c on c.dy = d.dy;

  return jsonb_build_object('from', p_from, 'to', p_to, 'totals', v_totals, 'by_source', v_src, 'daily', v_daily);
end $$;

-- ============ ELITE gate + daily quota for AI insights ============
-- The Vercel route calls this with the owner's own login token BEFORE contacting the AI provider.
-- ELITE is checked here, in the database (tier_rank 2 = a live ELITE subscription), not in the browser.
create table if not exists public.ai_insight_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists ai_insight_log_idx on public.ai_insight_log (business_id, created_at desc);
alter table public.ai_insight_log enable row level security;
revoke all on public.ai_insight_log from anon, authenticated;

create or replace function public.claim_ai_insight(p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then raise exception 'not_owner' using errcode = '42501'; end if;
  if public.business_tier_rank(p_business_id) < 2 then raise exception 'elite_required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));   -- two parallel clicks cannot both pass the limit
  select count(*) into v_n from public.ai_insight_log where business_id = p_business_id and created_at > now() - interval '24 hours';
  if v_n >= 10 then raise exception 'rate_limited' using errcode = '53400'; end if;
  insert into public.ai_insight_log (business_id) values (p_business_id);
end $$;

-- ============ RETENTION: raw events kept 400 days (weekly job) ============
create or replace function public.purge_old_analytics()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a int; b int;
begin
  delete from public.analytics_events where created_at < now() - interval '400 days';
  get diagnostics a = row_count;
  delete from public.ai_insight_log where created_at < now() - interval '30 days';
  get diagnostics b = row_count;
  return jsonb_build_object('events_deleted', a, 'ai_log_deleted', b);
end $$;

do $$ begin
  create extension if not exists pg_cron;
  -- Sunday 18:45 UTC = Monday 00:15 India time (same job name = updated, not duplicated)
  perform cron.schedule('blisscco-purge-analytics', '45 18 * * 0', 'select public.purge_old_analytics()');
exception when others then
  raise notice 'pg_cron schedule skipped (%): enable pg_cron in Dashboard > Database > Extensions, then re-run this file.', sqlerrm;
end $$;

-- ============ FUNCTION PRIVILEGES ============
revoke execute on function
  public._analytics_record(uuid, text, text, text, text), public.track_event(uuid, text, text, text),
  public.track_impressions(uuid[], text), public.get_analytics(uuid, date, date),
  public.claim_ai_insight(uuid), public.purge_old_analytics()
  from public, anon, authenticated;

-- tracking: anyone (anonymous visitors too). Each function filters bots / duplicates / fake bookings itself.
grant execute on function public.track_event(uuid, text, text, text), public.track_impressions(uuid[], text) to anon, authenticated;
-- owners only (each function re-checks ownership; get_analytics also checks the PRO/ELITE plan)
grant execute on function public.get_analytics(uuid, date, date), public.claim_ai_insight(uuid) to authenticated;
-- _analytics_record and purge_old_analytics: nobody calls them from the API (the pg_cron job runs as the database owner).
