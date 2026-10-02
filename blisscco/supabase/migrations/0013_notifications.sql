-- 0013 (Phase 10): notifications, preferences, push subscriptions, delivery tracking, event triggers, pg_cron reminders.
-- Run after 0012. Safe to re-run.
--
-- HOW IT FITS TOGETHER
--   1. A trigger (booking / approval / review / payment) calls _notify(): it saves the in-app notification and,
--      if the user's preferences allow, queues one 'push' and/or one 'email' row in notification_deliveries (status 'pending').
--   2. The database pings the Vercel route /api/dispatch-notifications (pg_net). pg_cron also pings it every minute while
--      anything is pending, so retries happen even if a ping is lost.
--   3. The route sends web-push (VAPID) and email (Resend). A delivery becomes 'sent' ONLY after the provider accepts it.
--      A provider error -> 'pending' again (retry with back-off, max 5 tries) -> finally 'failed'. Nothing is ever marked
--      sent/delivered by default, and the UI shows exactly what is stored here.
--   4. EVERY trigger swallows its own errors: a notification problem can never roll back a booking, review or payment.

-- ============ TABLES ============
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type ~ '^[a-z_0-9]{3,40}$'),
  category text not null check (category in ('booking', 'approval', 'review', 'payment', 'reminder', 'system')),
  data jsonb not null default '{}'::jsonb,                  -- only the facts the text needs (shop name, time, rating...). No secrets.
  link text check (link is null or (link like '/%' and link not like '//%' and char_length(link) <= 200)),
  dedupe_key text check (char_length(dedupe_key) <= 200),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_dedupe_idx on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  muted_categories text[] not null default '{}',            -- muted categories stop push + email; the in-app list still shows them
  updated_at timestamptz not null default now(),
  constraint muted_valid check (muted_categories <@ array['booking', 'approval', 'review', 'payment', 'reminder']::text[])
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and char_length(endpoint) between 20 and 1000),
  p256dh_key text not null check (char_length(p256dh_key) between 20 and 200),
  auth_key text not null check (char_length(auth_key) between 8 and 100),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error_at timestamptz,
  failure_count int not null default 0
);
create index if not exists push_subs_user_idx on public.push_subscriptions (user_id);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('push', 'email')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  provider_id text,                                          -- Resend email id (push has none)
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (notification_id, channel)
);
create index if not exists deliveries_work_idx on public.notification_deliveries (next_attempt_at) where status in ('pending', 'sending');

-- Server-only settings (dispatcher URL + shared secret). No policies and no grants = only postgres / service_role can read it.
create table if not exists public.notification_config (
  key text primary key check (key in ('dispatch_url', 'cron_secret')),
  value text not null
);

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_config enable row level security;

drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifprefs_select on public.notification_preferences;
create policy notifprefs_select on public.notification_preferences for select to authenticated using (user_id = auth.uid());
drop policy if exists pushsubs_select on public.push_subscriptions;
create policy pushsubs_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists deliveries_select on public.notification_deliveries;
create policy deliveries_select on public.notification_deliveries for select to authenticated
  using (exists (select 1 from public.notifications n where n.id = notification_id and n.user_id = auth.uid()));

revoke all on public.notifications, public.notification_preferences, public.push_subscriptions,
              public.notification_deliveries, public.notification_config from anon, authenticated;
grant select on public.notifications, public.notification_preferences to authenticated;
grant select on public.notification_deliveries to authenticated;
grant select (id, endpoint, user_agent, created_at, last_success_at) on public.push_subscriptions to authenticated;   -- never the keys

-- Live bell updates in the browser (RLS still applies: a user only receives their own rows)
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when others then
  raise notice 'realtime publication not changed (%): the bell falls back to polling.', sqlerrm;
end $$;

-- ============ INTERNAL: ping the Vercel dispatcher ============
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not enabled (%): enable it in Dashboard > Database > Extensions, then re-run this file.', sqlerrm;
end $$;

create or replace function public._kick_dispatcher() returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select value into v_url from public.notification_config where key = 'dispatch_url';
  select value into v_secret from public.notification_config where key = 'cron_secret';
  if v_url is null or v_secret is null then return; end if;    -- not configured yet: rows simply stay 'pending'
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000);
exception when others then
  raise warning 'notification dispatcher ping failed: %', sqlerrm;
end $$;

-- Minute sweep: ping only when something is due (so an idle system makes no calls)
create or replace function public.kick_dispatcher_if_due() returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.notification_deliveries
              where (status = 'pending' and next_attempt_at <= now())
                 or (status = 'sending' and locked_at < now() - interval '5 minutes')) then
    perform public._kick_dispatcher();
  end if;
end $$;

-- ============ INTERNAL: create one notification (+ queue deliveries) ============
create or replace function public._notify(
  p_user uuid, p_type text, p_category text, p_data jsonb, p_link text,
  p_dedupe text default null, p_kick boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; pr public.notification_preferences; v_has_pref boolean; v_muted boolean; v_push boolean; v_email boolean;
begin
  if p_user is null then return null; end if;
  if not exists (select 1 from public.profiles where id = p_user and not is_suspended) then return null; end if;

  insert into public.notifications (user_id, type, category, data, link, dedupe_key)
  values (p_user, p_type, p_category, coalesce(p_data, '{}'::jsonb), p_link, p_dedupe)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then return null; end if;                    -- same reminder already created

  select * into pr from public.notification_preferences where user_id = p_user;
  v_has_pref := found;
  v_muted := v_has_pref and p_category = any (pr.muted_categories);
  v_push := not v_muted and (not v_has_pref or pr.push_enabled)
            and exists (select 1 from public.push_subscriptions where user_id = p_user);
  v_email := not v_muted and (not v_has_pref or pr.email_enabled);

  if v_push then insert into public.notification_deliveries (notification_id, channel) values (v_id, 'push'); end if;
  if v_email then insert into public.notification_deliveries (notification_id, channel) values (v_id, 'email'); end if;
  if p_kick and (v_push or v_email) then perform public._kick_dispatcher(); end if;
  return v_id;
end $$;

create or replace function public._notify_admins(p_type text, p_category text, p_data jsonb, p_link text)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  for a in select id from public.profiles where role = 'admin' and not is_suspended limit 20 loop
    perform public._notify(a.id, p_type, p_category, p_data, p_link, null, true);
  end loop;
end $$;

-- ============ TRIGGERS: booking ============
create or replace function public.trg_notify_booking_insert() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_data jsonb;
begin
  begin
    if new.source = 'customer' and new.customer_id is not null then
      select owner_id into v_owner from public.businesses where id = new.business_id;
      v_data := jsonb_build_object('booking_id', new.id, 'business_name', new.business_name, 'service', new.service_label,
                                   'booking_type', new.type, 'start_at', new.start_at, 'token', new.token_number,
                                   'customer_name', new.customer_name);
      perform public._notify(v_owner, 'booking_new', 'booking', v_data, '/owner/business/' || new.business_id::text || '/queue', null, true);
      perform public._notify(new.customer_id, 'booking_confirmed', 'booking', v_data, '/my-bookings', null, true);
    end if;
  exception when others then
    raise warning 'notify booking insert failed: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists notify_booking_insert on public.bookings;
create trigger notify_booking_insert after insert on public.bookings
  for each row execute function public.trg_notify_booking_insert();

create or replace function public.trg_notify_booking_status() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_data jsonb;
begin
  begin
    v_data := jsonb_build_object('booking_id', new.id, 'business_name', new.business_name, 'service', new.service_label,
                                 'booking_type', new.type, 'start_at', new.start_at, 'token', new.token_number,
                                 'customer_name', new.customer_name);
    if new.status = 'cancelled' then
      if new.cancelled_by = 'owner' then
        perform public._notify(new.customer_id, 'booking_cancelled_by_shop', 'booking', v_data, '/my-bookings', null, true);
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
drop trigger if exists notify_booking_status on public.bookings;
create trigger notify_booking_status after update of status on public.bookings
  for each row when (old.status is distinct from new.status) execute function public.trg_notify_booking_status();

-- ============ TRIGGERS: approval (shop, banner, blue-badge document) ============
create or replace function public.trg_notify_business_status() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_data jsonb := jsonb_build_object('business_name', new.name);
begin
  begin
    if new.status = 'pending_review' then
      perform public._notify_admins('business_pending', 'approval', v_data, '/admin/applications');
    elsif new.status = 'approved' and old.status = 'pending_review' then
      perform public._notify(new.owner_id, 'business_approved', 'approval', v_data, '/owner/business/' || new.id::text, null, true);
    elsif new.status = 'approved' and old.status = 'suspended' then
      perform public._notify(new.owner_id, 'business_reactivated', 'approval', v_data, '/owner/business/' || new.id::text, null, true);
    elsif new.status = 'rejected' then
      perform public._notify(new.owner_id, 'business_rejected', 'approval',
        v_data || jsonb_build_object('reason', left(coalesce(new.rejection_reason, ''), 300)), '/owner/business/' || new.id::text, null, true);
    elsif new.status = 'suspended' then
      perform public._notify(new.owner_id, 'business_suspended', 'approval', v_data, '/owner/business/' || new.id::text, null, true);
    end if;
  exception when others then
    raise warning 'notify business status failed: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists notify_business_status on public.businesses;
create trigger notify_business_status after update of status on public.businesses
  for each row when (old.status is distinct from new.status) execute function public.trg_notify_business_status();

create or replace function public.trg_notify_banner_insert() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public._notify_admins('banner_pending', 'approval',
      jsonb_build_object('business_name', (select name from public.businesses where id = new.business_id), 'title', new.title), '/admin/banners');
  exception when others then
    raise warning 'notify banner insert failed: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists notify_banner_insert on public.banners;
create trigger notify_banner_insert after insert on public.banners
  for each row execute function public.trg_notify_banner_insert();

create or replace function public.trg_notify_banner_status() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_name text;
begin
  begin
    if new.status in ('approved', 'rejected') and old.status = 'pending' then
      select owner_id, name into v_owner, v_name from public.businesses where id = new.business_id;
      perform public._notify(v_owner, case when new.status = 'approved' then 'banner_approved' else 'banner_rejected' end, 'approval',
        jsonb_build_object('business_name', v_name, 'title', new.title, 'reason', left(coalesce(new.rejection_reason, ''), 300)),
        '/owner/business/' || new.business_id::text || '/banners', null, true);
    end if;
  exception when others then
    raise warning 'notify banner status failed: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists notify_banner_status on public.banners;
create trigger notify_banner_status after update of status on public.banners
  for each row when (old.status is distinct from new.status) execute function public.trg_notify_banner_status();

create or replace function public.trg_notify_verification_insert() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public._notify_admins('verification_pending', 'approval',
      jsonb_build_object('business_name', (select name from public.businesses where id = new.business_id)), '/admin/verifications');
  exception when others then
    raise warning 'notify verification insert failed: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists notify_verification_insert on public.verification_requests;
create trigger notify_verification_insert after insert on public.verification_requests
  for each row execute function public.trg_notify_verification_insert();

create or replace function public.trg_notify_verification_status() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_name text;
begin
  begin
    if new.status in ('approved', 'rejected') and old.status = 'pending' then
      select owner_id, name into v_owner, v_name from public.businesses where id = new.business_id;
      perform public._notify(v_owner, case when new.status = 'approved' then 'verification_approved' else 'verification_rejected' end, 'approval',
        jsonb_build_object('business_name', v_name, 'reason', left(coalesce(new.rejection_reason, ''), 300)),
        '/owner/business/' || new.business_id::text || '/verify', null, true);
    end if;
  exception when others then
    raise warning 'notify verification status failed: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists notify_verification_status on public.verification_requests;
create trigger notify_verification_status after update of status on public.verification_requests
  for each row when (old.status is distinct from new.status) execute function public.trg_notify_verification_status();

-- ============ TRIGGERS: review ============
create or replace function public.trg_notify_review_insert() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  begin
    select owner_id into v_owner from public.businesses where id = new.business_id;
    perform public._notify(v_owner, 'review_new', 'review',
      jsonb_build_object('business_name', new.business_name, 'rating', new.rating, 'reviewer_name', new.reviewer_name),
      '/owner/business/' || new.business_id::text || '/reviews', null, true);
  exception when others then
    raise warning 'notify review insert failed: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists notify_review_insert on public.reviews;
create trigger notify_review_insert after insert on public.reviews
  for each row execute function public.trg_notify_review_insert();

create or replace function public.trg_notify_review_update() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  begin
    if new.owner_response is not null and old.owner_response is distinct from new.owner_response and new.status = 'published' then
      perform public._notify(new.customer_id, 'review_reply', 'review',
        jsonb_build_object('business_name', new.business_name), '/b/' || new.business_id::text, null, true);
    end if;
    if new.status = 'removed' and old.status = 'published' then
      select owner_id into v_owner from public.businesses where id = new.business_id;
      perform public._notify(v_owner, 'review_removed', 'review',
        jsonb_build_object('business_name', new.business_name), '/owner/business/' || new.business_id::text || '/reviews', null, true);
    end if;
  exception when others then
    raise warning 'notify review update failed: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists notify_review_update on public.reviews;
create trigger notify_review_update after update of owner_response, status on public.reviews
  for each row when (old.owner_response is distinct from new.owner_response or old.status is distinct from new.status)
  execute function public.trg_notify_review_update();

-- ============ TRIGGERS: payment ============
-- Runs inside the same transaction as process_razorpay_event(). The exception block makes sure a notification
-- problem can never roll back a payment activation.
create or replace function public.trg_notify_payment() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan text; v_biz text; v_data jsonb; v_link text;
begin
  begin
    select name into v_plan from public.plans where code = new.plan_code;
    select name into v_biz from public.businesses where id = new.business_id;
    v_link := '/owner/business/' || new.business_id::text || '/plans';
    v_data := jsonb_build_object('plan_name', v_plan, 'business_name', v_biz, 'amount_paise', new.amount_paise,
                                 'refunded_paise', new.refunded_paise);
    if new.status = 'paid' and old.status is distinct from 'paid' then
      perform public._notify(new.user_id, 'payment_success', 'payment', v_data, v_link, 'pay:' || new.id::text || ':paid', true);
    elsif new.status in ('refunded', 'partially_refunded') then
      perform public._notify(new.user_id, 'payment_refunded', 'payment',
        v_data || jsonb_build_object('partial', new.status = 'partially_refunded'), v_link,
        'pay:' || new.id::text || ':refund:' || new.refunded_paise::text, true);
    elsif new.status = 'amount_mismatch' and old.status is distinct from 'amount_mismatch' then
      perform public._notify(new.user_id, 'payment_issue', 'payment', v_data, v_link, 'pay:' || new.id::text || ':issue', true);
      perform public._notify_admins('payment_issue_admin', 'payment', v_data, '/admin/payments');
    end if;
  exception when others then
    raise warning 'notify payment failed: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists notify_payment on public.payment_transactions;
create trigger notify_payment after update of status, refunded_paise on public.payment_transactions
  for each row when (old.status is distinct from new.status or old.refunded_paise is distinct from new.refunded_paise)
  execute function public.trg_notify_payment();

-- ============ REMINDERS (called by pg_cron) ============
-- Appointment: ~24 h and ~2 h before. Each (booking, window) can only ever create one notification (dedupe key).
-- Bookings made too close to the start get no reminder for a window that already passed when they were created.
create or replace function public.send_appointment_reminders() returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_made uuid; n int := 0;
begin
  for r in
    select b.id, b.customer_id, b.business_id, b.business_name, b.service_label, b.start_at,
           case when b.start_at <= now() + interval '2 hours' then '2h' else '24h' end as win
      from public.bookings b
     where b.type = 'appointment' and b.customer_id is not null and b.status in ('pending', 'confirmed')
       and b.start_at > now() and b.start_at <= now() + interval '24 hours'
       and ((b.start_at <= now() + interval '2 hours' and b.created_at < b.start_at - interval '3 hours')
         or (b.start_at >  now() + interval '2 hours' and b.created_at <= b.start_at - interval '24 hours'))
     order by b.start_at
     limit 500
  loop
    v_made := public._notify(r.customer_id, 'appointment_reminder', 'reminder',
      jsonb_build_object('booking_id', r.id, 'business_name', r.business_name, 'service', r.service_label, 'start_at', r.start_at, 'window', r.win),
      '/my-bookings', 'appt:' || r.id::text || ':' || r.win, false);
    if v_made is not null then n := n + 1; end if;
  end loop;
  if n > 0 then perform public._kick_dispatcher(); end if;
  return jsonb_build_object('appointment_reminders', n);
end $$;

-- Coupon expiry (within 3 days) and subscription / badge expiry (7 days, then 1 day). Daily job.
create or replace function public.send_daily_reminders() returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_made uuid; c int := 0; s int := 0;
begin
  for r in
    select cp.id, cp.holder_id, cp.expires_at, cp.discount_type, cp.discount_value
      from public.coupons cp
     where cp.status = 'active' and cp.expires_at > now() and cp.expires_at <= now() + interval '3 days'
     limit 1000
  loop
    v_made := public._notify(r.holder_id, 'coupon_expiring', 'reminder',
      jsonb_build_object('expires_at', r.expires_at, 'discount_type', r.discount_type, 'discount_value', r.discount_value),
      '/refer', 'coupon:' || r.id::text || ':3d', false);
    if v_made is not null then c := c + 1; end if;
  end loop;

  for r in
    select sb.id, sb.business_id, sb.expires_at, pl.name as plan_name, bz.owner_id, bz.name as business_name,
           case when sb.expires_at <= now() + interval '1 day' then '1d' else '7d' end as win
      from public.subscriptions sb
      join public.plans pl on pl.code = sb.plan_code
      join public.businesses bz on bz.id = sb.business_id
     where sb.status = 'active' and sb.expires_at > now() and sb.expires_at <= now() + interval '7 days'
       and bz.status = 'approved'
       and not exists (select 1 from public.subscriptions s2     -- already renewed: the same product runs longer
                        where s2.business_id = sb.business_id and s2.plan_code = sb.plan_code
                          and s2.status = 'active' and s2.expires_at > sb.expires_at)
     limit 1000
  loop
    v_made := public._notify(r.owner_id, 'subscription_expiring', 'reminder',
      jsonb_build_object('plan_name', r.plan_name, 'business_name', r.business_name, 'expires_at', r.expires_at, 'window', r.win),
      '/owner/business/' || r.business_id::text || '/plans', 'sub:' || r.id::text || ':' || r.win, false);
    if v_made is not null then s := s + 1; end if;
  end loop;

  if c + s > 0 then perform public._kick_dispatcher(); end if;
  return jsonb_build_object('coupon_reminders', c, 'subscription_reminders', s);
end $$;

create or replace function public.purge_old_notifications() returns jsonb language plpgsql security definer set search_path = '' as $$
declare a int;
begin
  delete from public.notifications where created_at < now() - interval '90 days';   -- deliveries go with them (cascade)
  get diagnostics a = row_count;
  return jsonb_build_object('notifications_deleted', a);
end $$;

-- ============ USER FUNCTIONS (browser, logged in) ============
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.save_notification_preferences(p_push boolean, p_email boolean, p_muted text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_muted text[] := coalesce(p_muted, '{}');
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not (v_muted <@ array['booking', 'approval', 'review', 'payment', 'reminder']::text[]) then raise exception 'invalid_category'; end if;
  insert into public.notification_preferences (user_id, push_enabled, email_enabled, muted_categories)
  values (auth.uid(), coalesce(p_push, true), coalesce(p_email, true), v_muted)
  on conflict (user_id) do update
    set push_enabled = excluded.push_enabled, email_enabled = excluded.email_enabled,
        muted_categories = excluded.muted_categories, updated_at = now();
end $$;

-- One browser = one endpoint. If the same browser is used by another account later, the endpoint moves to that account.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh_key, auth_key, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh_key = excluded.p256dh_key, auth_key = excluded.auth_key,
        user_agent = excluded.user_agent, failure_count = 0, last_error_at = null;
  delete from public.push_subscriptions                      -- keep at most 10 browsers per account
   where user_id = auth.uid()
     and id not in (select id from public.push_subscriptions where user_id = auth.uid() order by created_at desc limit 10);
end $$;

create or replace function public.remove_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

-- "Send me a test": the quickest way to prove VAPID + Resend work. Max 3 per hour.
create or replace function public.send_test_notification() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if (select count(*) from public.notifications where user_id = auth.uid() and type = 'test' and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'rate_limited' using errcode = '53400';
  end if;
  v_id := public._notify(auth.uid(), 'test', 'system', '{}'::jsonb, '/notifications/settings', null, true);
  return v_id;
end $$;

-- ============ DISPATCHER FUNCTIONS (Vercel route, service_role only) ============
create or replace function public.claim_deliveries(p_limit int default 25) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  update public.notification_deliveries set status = 'failed', locked_at = null, last_error = coalesce(last_error, 'timed_out')
   where status = 'sending' and locked_at < now() - interval '5 minutes' and attempts >= 5;

  with picked as (
    select d.id from public.notification_deliveries d
     where (d.status = 'pending' and d.next_attempt_at <= now())
        or (d.status = 'sending' and d.locked_at < now() - interval '5 minutes')
     order by d.created_at
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
     for update skip locked),
  upd as (
    update public.notification_deliveries d
       set status = 'sending', locked_at = now(), attempts = d.attempts + 1
      from picked where d.id = picked.id
    returning d.id, d.notification_id, d.channel, d.attempts)
  select coalesce(jsonb_agg(jsonb_build_object(
           'delivery_id', u.id, 'channel', u.channel, 'attempt', u.attempts,
           'user_id', n.user_id, 'language', p.language,
           'notification', jsonb_build_object('id', n.id, 'type', n.type, 'category', n.category, 'data', n.data,
                                              'link', n.link, 'created_at', n.created_at),
           'email', case when u.channel = 'email' then (select au.email from auth.users au where au.id = n.user_id) end,
           'subscriptions', case when u.channel = 'push' then
              (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh_key, 'auth', s.auth_key)), '[]'::jsonb)
                 from public.push_subscriptions s where s.user_id = n.user_id)
              else '[]'::jsonb end
         )), '[]'::jsonb)
    into v
    from upd u
    join public.notifications n on n.id = u.notification_id
    join public.profiles p on p.id = n.user_id;
  return v;
end $$;

-- p_result: 'sent' (provider accepted) | 'retry' (provider error, try again later) | 'failed' (give up) | 'skipped' (nothing to send to)
create or replace function public.finish_delivery(p_id uuid, p_result text, p_error text default null, p_provider_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.notification_deliveries;
begin
  select * into d from public.notification_deliveries where id = p_id for update;
  if not found then return; end if;
  if p_result = 'sent' then
    update public.notification_deliveries
       set status = 'sent', sent_at = now(), provider_id = left(p_provider_id, 100), last_error = null, locked_at = null where id = d.id;
  elsif p_result = 'skipped' then
    update public.notification_deliveries set status = 'skipped', last_error = left(p_error, 300), locked_at = null where id = d.id;
  elsif p_result = 'retry' and d.attempts < 5 then
    update public.notification_deliveries
       set status = 'pending', last_error = left(p_error, 300), locked_at = null,
           next_attempt_at = now() + power(2, d.attempts) * interval '1 minute'     -- 2, 4, 8, 16 minutes
     where id = d.id;
  else
    update public.notification_deliveries set status = 'failed', last_error = left(p_error, 300), locked_at = null where id = d.id;
  end if;
end $$;

-- p_outcome: 'ok' | 'gone' (browser says the subscription no longer exists: remove it) | 'error'
create or replace function public.record_push_result(p_endpoint text, p_outcome text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_outcome = 'gone' then
    delete from public.push_subscriptions where endpoint = p_endpoint;
  elsif p_outcome = 'ok' then
    update public.push_subscriptions set last_success_at = now(), failure_count = 0 where endpoint = p_endpoint;
  else
    update public.push_subscriptions set last_error_at = now(), failure_count = failure_count + 1 where endpoint = p_endpoint;
  end if;
end $$;

-- ============ FUNCTION PRIVILEGES ============
revoke execute on function
  public._kick_dispatcher(), public.kick_dispatcher_if_due(),
  public._notify(uuid, text, text, jsonb, text, text, boolean), public._notify_admins(text, text, jsonb, text),
  public.trg_notify_booking_insert(), public.trg_notify_booking_status(), public.trg_notify_business_status(),
  public.trg_notify_banner_insert(), public.trg_notify_banner_status(),
  public.trg_notify_verification_insert(), public.trg_notify_verification_status(),
  public.trg_notify_review_insert(), public.trg_notify_review_update(), public.trg_notify_payment(),
  public.send_appointment_reminders(), public.send_daily_reminders(), public.purge_old_notifications(),
  public.mark_notifications_read(uuid[]), public.save_notification_preferences(boolean, boolean, text[]),
  public.save_push_subscription(text, text, text, text), public.remove_push_subscription(text), public.send_test_notification(),
  public.claim_deliveries(int), public.finish_delivery(uuid, text, text, text), public.record_push_result(text, text)
  from public, anon, authenticated;

grant execute on function
  public.mark_notifications_read(uuid[]), public.save_notification_preferences(boolean, boolean, text[]),
  public.save_push_subscription(text, text, text, text), public.remove_push_subscription(text), public.send_test_notification()
  to authenticated;
grant execute on function
  public.claim_deliveries(int), public.finish_delivery(uuid, text, text, text), public.record_push_result(text, text)
  to service_role;

-- ============ pg_cron JOBS (same job name = updated, not duplicated) ============
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('blisscco-notify-sweep',        '* * * * *',   'select public.kick_dispatcher_if_due()');
  perform cron.schedule('blisscco-appt-reminders',      '*/10 * * * *', 'select public.send_appointment_reminders()');
  -- 04:30 UTC = 10:00 India time
  perform cron.schedule('blisscco-daily-reminders',     '30 4 * * *',  'select public.send_daily_reminders()');
  -- Sunday 19:15 UTC = Monday 00:45 India time
  perform cron.schedule('blisscco-purge-notifications', '15 19 * * 0', 'select public.purge_old_notifications()');
exception when others then
  raise notice 'pg_cron schedule skipped (%): enable pg_cron in Dashboard > Database > Extensions, then re-run this file.', sqlerrm;
end $$;
