-- 0014 (Phase 11, Part 1): admin tools.
-- Users + suspend, booking disputes with audited correction, subscription grant/cancel, coupon revoke,
-- earnings report (ONLY Blisscco's own income = Razorpay payments minus refunds; owners' booking prices are never counted).
-- Every admin function: checks is_admin() itself, requires a reason, and writes admin_audit_logs. Safe to re-run.

-- ============ SUBSCRIPTIONS: allow admin-granted (free) subscriptions + 'cancelled' status ============
alter table public.subscriptions add column if not exists source text not null default 'payment';
alter table public.subscriptions drop constraint if exists subscriptions_source_check;
alter table public.subscriptions add constraint subscriptions_source_check check (source in ('payment', 'admin_grant'));
alter table public.subscriptions alter column payment_transaction_id drop not null;
alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check check (status in ('active', 'expired', 'refunded', 'cancelled'));
alter table public.subscriptions drop constraint if exists sub_source_matches_payment;
alter table public.subscriptions add constraint sub_source_matches_payment check ((source = 'payment') = (payment_transaction_id is not null));

-- ============ BOOKING DISPUTES ============
create table if not exists public.booking_disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  raised_by uuid not null references public.profiles(id),
  raised_by_role text not null check (raised_by_role in ('customer', 'owner')),
  reason text not null check (char_length(reason) between 10 and 500),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution text,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists disputes_one_open on public.booking_disputes (booking_id, raised_by) where status = 'open';
create index if not exists disputes_status_idx on public.booking_disputes (status, created_at desc);

alter table public.booking_disputes enable row level security;
drop policy if exists disputes_select on public.booking_disputes;
create policy disputes_select on public.booking_disputes for select to authenticated
  using (raised_by = auth.uid() or public.is_admin());
revoke all on public.booking_disputes from anon, authenticated;
grant select on public.booking_disputes to authenticated;   -- no direct writes

create or replace function public.raise_booking_dispute(p_booking_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare bk public.bookings; v_role text; v_id uuid; v_reason text := trim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into bk from public.bookings where id = p_booking_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if bk.customer_id = auth.uid() then v_role := 'customer';
  elsif public.owns_business(bk.business_id) then v_role := 'owner';
  else raise exception 'not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_suspended) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if bk.status not in ('completed', 'cancelled', 'no_show') then raise exception 'not_finished'; end if;
  if bk.updated_at < now() - interval '30 days' then raise exception 'too_old'; end if;
  if char_length(v_reason) < 10 then raise exception 'reason_required'; end if;
  begin
    insert into public.booking_disputes (booking_id, raised_by, raised_by_role, reason)
    values (bk.id, auth.uid(), v_role, left(v_reason, 500)) returning id into v_id;
  exception when unique_violation then raise exception 'already_open';
  end;
  return v_id;
end $$;

-- Audited correction. Only FINAL states are allowed (no reviving a slot / token), and it never triggers referral rewards.
create or replace function public.admin_correct_booking(p_booking_id uuid, p_new public.booking_status, p_reason text, p_dispute_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare bk public.bookings; v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_reason) < 10 then raise exception 'reason_required' using errcode = '23514'; end if;
  if p_new not in ('completed', 'cancelled', 'no_show') then raise exception 'target_not_allowed'; end if;
  select * into bk from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if bk.status = p_new then raise exception 'no_change'; end if;

  update public.bookings set status = p_new,
         completed_at = case when p_new = 'completed' then coalesce(completed_at, now()) else null end,
         cancelled_at = case when p_new = 'cancelled' then now() else null end,
         cancelled_by = null
   where id = bk.id;
  insert into public.booking_status_history (booking_id, from_status, to_status, actor_id) values (bk.id, bk.status, p_new, auth.uid());
  perform public.write_audit_log('booking.correct', 'booking', bk.id,
    jsonb_build_object('from', bk.status, 'to', p_new, 'reason', v_reason, 'dispute_id', p_dispute_id));

  if p_dispute_id is not null then
    update public.booking_disputes set status = 'resolved', resolution = left(v_reason, 500), resolved_by = auth.uid(), resolved_at = now()
     where id = p_dispute_id and booking_id = bk.id and status = 'open';
  end if;
end $$;

create or replace function public.admin_dismiss_dispute(p_dispute_id uuid, p_resolution text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_res text := trim(coalesce(p_resolution, ''));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_res) < 3 then raise exception 'reason_required' using errcode = '23514'; end if;
  update public.booking_disputes set status = 'dismissed', resolution = left(v_res, 500), resolved_by = auth.uid(), resolved_at = now()
   where id = p_dispute_id and status = 'open';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.write_audit_log('dispute.dismiss', 'booking_dispute', p_dispute_id, jsonb_build_object('resolution', v_res));
end $$;

-- ============ USERS ============
create or replace function public.admin_list_users(p_search text default null, p_limit int default 30, p_offset int default 0)
returns table (id uuid, email text, full_name text, phone text, role public.user_role, is_suspended boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_pat text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  v_pat := '%' || replace(replace(replace(left(trim(coalesce(p_search, '')), 60), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, u.email::text, p.full_name, p.phone, p.role, p.is_suspended, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
   where coalesce(trim(p_search), '') = '' or u.email ilike v_pat or p.full_name ilike v_pat or p.phone ilike v_pat
   order by p.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Suspending an OWNER also suspends their approved shops (they disappear from search). Un-suspending does NOT auto-restore shops:
-- reactivate each one deliberately from the Applications page.
create or replace function public.admin_set_user_suspended(p_user_id uuid, p_suspend boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare pr public.profiles; v_reason text := trim(coalesce(p_reason, '')); b record; v_shops int := 0;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'reason_required' using errcode = '23514'; end if;
  select * into pr from public.profiles where id = p_user_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if pr.id = auth.uid() then raise exception 'cannot_suspend_self'; end if;
  if pr.role = 'admin' then raise exception 'cannot_suspend_admin'; end if;
  if pr.is_suspended = p_suspend then raise exception 'no_change'; end if;

  update public.profiles set is_suspended = p_suspend where id = pr.id;
  if p_suspend and pr.role = 'owner' then
    for b in select id from public.businesses where owner_id = pr.id and status = 'approved' for update loop
      update public.businesses set status = 'suspended', rejection_reason = 'Owner account suspended' where id = b.id;
      insert into public.business_status_history (business_id, from_status, to_status, reason, actor_id)
      values (b.id, 'approved', 'suspended', 'owner account suspended: ' || v_reason, auth.uid());
      v_shops := v_shops + 1;
    end loop;
  end if;
  perform public.write_audit_log(case when p_suspend then 'user.suspend' else 'user.unsuspend' end, 'user', pr.id,
    jsonb_build_object('reason', v_reason, 'role', pr.role, 'shops_suspended', v_shops));
end $$;

-- ============ SUBSCRIPTIONS ============
create or replace function public.admin_grant_subscription(p_business_id uuid, p_plan_code text, p_days int, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pl public.plans; v_start timestamptz; v_id uuid; v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'reason_required' using errcode = '23514'; end if;
  if p_days is null or p_days not between 1 and 365 then raise exception 'invalid_days'; end if;
  select * into pl from public.plans where code = p_plan_code;
  if not found or pl.kind not in ('plan', 'badge') then raise exception 'invalid_plan'; end if;
  if not exists (select 1 from public.businesses where id = p_business_id and status = 'approved') then raise exception 'business_not_approved'; end if;
  select max(s.expires_at) into v_start from public.subscriptions s
   where s.business_id = p_business_id and s.plan_code = pl.code and s.status = 'active' and s.expires_at > now();
  v_start := greatest(coalesce(v_start, now()), now());
  insert into public.subscriptions (business_id, plan_code, status, starts_at, expires_at, source, payment_transaction_id)
  values (p_business_id, pl.code, 'active', v_start, v_start + make_interval(days => p_days), 'admin_grant', null) returning id into v_id;
  perform public.write_audit_log('subscription.grant', 'subscription', v_id,
    jsonb_build_object('business_id', p_business_id, 'plan', pl.code, 'days', p_days, 'reason', v_reason));
  return v_id;
end $$;

-- Cancels access only. For PAID subscriptions the money is refunded by you in the Razorpay dashboard (the webhook then records it).
create or replace function public.admin_cancel_subscription(p_subscription_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare sb public.subscriptions; v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'reason_required' using errcode = '23514'; end if;
  select * into sb from public.subscriptions where id = p_subscription_id for update;
  if not found or sb.status <> 'active' then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.subscriptions set status = 'cancelled' where id = sb.id;
  perform public.write_audit_log('subscription.cancel', 'subscription', sb.id,
    jsonb_build_object('business_id', sb.business_id, 'plan', sb.plan_code, 'source', sb.source, 'reason', v_reason));
end $$;

-- ============ PROMOTIONS (coupons) ============
create or replace function public.admin_revoke_coupon(p_coupon_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'reason_required' using errcode = '23514'; end if;
  update public.coupons set status = 'revoked' where id = p_coupon_id and status = 'active';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.write_audit_log('coupon.revoke', 'coupon', p_coupon_id, jsonb_build_object('reason', v_reason));
end $$;

-- ============ REPORT: Blisscco's real earnings (IST days) ============
-- gross = captured Razorpay payments (status paid / partially_refunded / refunded) by paid_at;
-- refunds = payment_refunds by refund date; net = gross - refunds. Not included: failed / created / amount_mismatch payments,
-- admin-granted free subscriptions (shown only as a count), Razorpay fees and GST (see your Razorpay settlement report for those).
create or replace function public.admin_earnings_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_s timestamptz; v_e timestamptz; v jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'invalid_range'; end if;
  v_s := p_from::timestamp at time zone 'Asia/Kolkata';
  v_e := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
  v := (
    with pay as (
      select plan_code, amount_paise, (paid_at at time zone 'Asia/Kolkata')::date as d
        from public.payment_transactions
       where paid_at >= v_s and paid_at < v_e and status in ('paid', 'partially_refunded', 'refunded')),
    ref as (
      select t.plan_code, r.amount_paise, (r.created_at at time zone 'Asia/Kolkata')::date as d
        from public.payment_refunds r join public.payment_transactions t on t.id = r.txn_id
       where r.created_at >= v_s and r.created_at < v_e)
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'gross_paise', coalesce((select sum(amount_paise) from pay), 0),
      'refunds_paise', coalesce((select sum(amount_paise) from ref), 0),
      'payments_count', (select count(*) from pay),
      'free_grants', (select count(*) from public.subscriptions where source = 'admin_grant' and created_at >= v_s and created_at < v_e),
      'by_plan', coalesce((select jsonb_agg(x order by x.plan_code) from (
          select coalesce(a.plan_code, b.plan_code) as plan_code, coalesce(a.cnt, 0) as payments,
                 coalesce(a.g, 0) as gross_paise, coalesce(b.r, 0) as refunds_paise
            from (select plan_code, count(*) as cnt, sum(amount_paise) as g from pay group by plan_code) a
            full join (select plan_code, sum(amount_paise) as r from ref group by plan_code) b on a.plan_code = b.plan_code) x), '[]'::jsonb),
      'by_day', coalesce((select jsonb_agg(y order by y.day) from (
          select coalesce(a.d, b.d) as day, coalesce(a.g, 0) as gross_paise, coalesce(b.r, 0) as refunds_paise
            from (select d, sum(amount_paise) as g from pay group by d) a
            full join (select d, sum(amount_paise) as r from ref group by d) b on a.d = b.d) y), '[]'::jsonb)));
  return v;
end $$;

-- ============ FUNCTION PRIVILEGES ============
revoke execute on function
  public.raise_booking_dispute(uuid, text), public.admin_correct_booking(uuid, public.booking_status, text, uuid),
  public.admin_dismiss_dispute(uuid, text), public.admin_list_users(text, int, int),
  public.admin_set_user_suspended(uuid, boolean, text), public.admin_grant_subscription(uuid, text, int, text),
  public.admin_cancel_subscription(uuid, text), public.admin_revoke_coupon(uuid, text), public.admin_earnings_report(date, date)
  from public, anon, authenticated;
grant execute on function
  public.raise_booking_dispute(uuid, text), public.admin_correct_booking(uuid, public.booking_status, text, uuid),
  public.admin_dismiss_dispute(uuid, text), public.admin_list_users(text, int, int),
  public.admin_set_user_suspended(uuid, boolean, text), public.admin_grant_subscription(uuid, text, int, text),
  public.admin_cancel_subscription(uuid, text), public.admin_revoke_coupon(uuid, text), public.admin_earnings_report(date, date)
  to authenticated;
