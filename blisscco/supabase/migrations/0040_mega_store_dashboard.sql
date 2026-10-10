-- 0040: Mega Store DASHBOARD (limits, budget, pause rules, richer reporting). Re-runnable.
-- Run AFTER 0039. Deploy the new frontend AFTER this migration.
--
-- Reuses every table from 0038 / 0039. Nothing is dropped except the OLD 10-argument megastore_save_campaign(), which is replaced by
-- a version with two extra optional arguments (budget, pause behaviour). No RLS policy is weakened.
--
-- NEW in this file
--   1. mega_platform_limits           Blisscco's min / max discount, partner-shop cap, min / max campaign budget (admin editable)
--   2. megastore_save_campaign        now enforces the limits and stores the budget + "pause also blocks registrations" setting
--   3. megastore_set_campaign_status  a campaign cannot go live without a budget
--   4. megastore_add_shop             partner-shop cap comes from the limits table (default 10)
--   5. megastore_increase_budget      budget can only be INCREASED after launch, by the primary owner (or admin via set_campaign_budget)
--   6. Pause rules                    paused = no new rewards (also a DB trigger), no approval of held rewards, no new registrations
--                                     (configurable per campaign). Rewards that were already issued stay valid and redeemable.
--   7. get_my_megastore               richer dashboard: registrations / verified services / issued / redeemed are separate numbers,
--                                     budget + remaining + outstanding exposure, per-shop status, suspicious items. Managers can read it.
--   8. get_mega_limits / admin_set_mega_limits
--
-- FINANCIAL RULE (unchanged): the Mega Store funds 100% of every discount. Nothing here touches any Blisscco credit / payment table.

-- ============ 1. PLATFORM LIMITS ============
create table if not exists public.mega_platform_limits (
  id boolean primary key default true check (id),                                  -- exactly one row
  min_discount_pct numeric(5, 2) not null default 5 check (min_discount_pct > 0 and min_discount_pct <= 100),
  max_discount_pct numeric(5, 2) not null default 30 check (max_discount_pct > 0 and max_discount_pct <= 100),
  min_flat_inr numeric(10, 2) not null default 50 check (min_flat_inr > 0),
  max_flat_inr numeric(10, 2) not null default 1000 check (max_flat_inr > 0),
  max_partner_shops int not null default 10 check (max_partner_shops between 1 and 50),
  min_budget_inr numeric(12, 2) not null default 1000 check (min_budget_inr > 0),
  max_budget_inr numeric(12, 2) not null default 1000000 check (max_budget_inr > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint mega_limits_pct_order check (min_discount_pct <= max_discount_pct),
  constraint mega_limits_flat_order check (min_flat_inr <= max_flat_inr),
  constraint mega_limits_budget_order check (min_budget_inr <= max_budget_inr)
);
insert into public.mega_platform_limits (id) values (true) on conflict do nothing;

alter table public.mega_platform_limits enable row level security;
drop policy if exists mega_limits_select on public.mega_platform_limits;
create policy mega_limits_select on public.mega_platform_limits for select to authenticated using (true);   -- not secret; owners must see them
revoke all on public.mega_platform_limits from anon, authenticated;
grant select on public.mega_platform_limits to authenticated;

create or replace function public.get_mega_limits() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(l) - 'id' - 'updated_by' from public.mega_platform_limits l where l.id;
$$;

create or replace function public.admin_set_mega_limits(
  p_min_pct numeric, p_max_pct numeric, p_min_flat numeric, p_max_flat numeric,
  p_max_shops int, p_min_budget numeric, p_max_budget numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_min_pct is null or p_max_pct is null or p_min_pct <= 0 or p_max_pct > 100 or p_min_pct > p_max_pct
     or p_min_flat is null or p_max_flat is null or p_min_flat <= 0 or p_min_flat > p_max_flat
     or p_max_shops is null or p_max_shops < 1 or p_max_shops > 50
     or p_min_budget is null or p_max_budget is null or p_min_budget <= 0 or p_min_budget > p_max_budget then
    raise exception 'invalid_limits';
  end if;
  update public.mega_platform_limits set min_discount_pct = p_min_pct, max_discount_pct = p_max_pct, min_flat_inr = p_min_flat,
         max_flat_inr = p_max_flat, max_partner_shops = p_max_shops, min_budget_inr = p_min_budget, max_budget_inr = p_max_budget,
         updated_at = now(), updated_by = auth.uid()
   where id;
  perform public.write_audit_log('mega_limits.update', 'mega_limits', null,
    jsonb_build_object('min_pct', p_min_pct, 'max_pct', p_max_pct, 'min_flat', p_min_flat, 'max_flat', p_max_flat,
                       'max_shops', p_max_shops, 'min_budget', p_min_budget, 'max_budget', p_max_budget));
end $$;

-- ============ 2. REGISTRATION RULE (one place) ============
-- Registration is open while the campaign is active. While PAUSED it stays closed unless the campaign was configured with
-- config.pause_blocks_registrations = false. An ended or expired campaign is never open.
create or replace function public.mega_registration_open(p_campaign_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mega_campaigns c
                  where c.id = p_campaign_id and c.ends_at > now()
                    and (c.status = 'active'
                         or (c.status = 'paused' and coalesce(c.config->>'pause_blocks_registrations', 'true') = 'false')));
$$;

-- ============ 3. SAVE CAMPAIGN (limits + budget + pause setting) ============
drop function if exists public.megastore_save_campaign(text, text, timestamptz, timestamptz, text, numeric, numeric, numeric, numeric, boolean);

create or replace function public.megastore_save_campaign(
  p_title text, p_description text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_type text, p_value numeric, p_max_discount numeric default null, p_min_purchase numeric default null,
  p_min_service numeric default null, p_one_per_shop boolean default true,
  p_budget numeric default null, p_pause_blocks_registrations boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; v_id uuid; l public.mega_platform_limits; v_cfg jsonb;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.status <> 'approved' then raise exception 'store_not_approved'; end if;
  select * into l from public.mega_platform_limits where id;
  if char_length(trim(coalesce(p_title, ''))) < 3 or char_length(trim(p_title)) > 100 then raise exception 'invalid_title'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at <= now() then raise exception 'invalid_dates'; end if;
  if p_type is null or p_type not in ('percent', 'flat') then raise exception 'invalid_value'; end if;
  if p_value is null or p_value <= 0 or (p_type = 'percent' and p_value > 100) or p_value > 1000000 then raise exception 'invalid_value'; end if;
  if p_type = 'percent' and (p_value < l.min_discount_pct or p_value > l.max_discount_pct) then raise exception 'discount_out_of_range'; end if;
  if p_type = 'flat' and (p_value < l.min_flat_inr or p_value > l.max_flat_inr) then raise exception 'discount_out_of_range'; end if;
  if p_type = 'percent' and p_max_discount is not null and p_max_discount <= 0 then raise exception 'invalid_value'; end if;
  if coalesce(p_min_purchase, 0) < 0 or coalesce(p_min_service, 0) < 0 then raise exception 'invalid_value'; end if;
  if p_budget is not null and (p_budget < l.min_budget_inr or p_budget > l.max_budget_inr) then raise exception 'budget_out_of_range'; end if;

  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('draft', 'active', 'paused') for update;
  if found and c.status <> 'draft' then raise exception 'campaign_locked'; end if;
  if found then
    update public.mega_campaigns set title = trim(p_title), description = nullif(left(trim(coalesce(p_description, '')), 500), ''),
           starts_at = p_starts_at, ends_at = p_ends_at, reward_type = p_type, reward_value = p_value,
           max_discount_inr = case when p_type = 'percent' then p_max_discount else null end,
           min_purchase_inr = coalesce(p_min_purchase, 0), min_service_price_inr = coalesce(p_min_service, 0),
           one_reward_per_shop = coalesce(p_one_per_shop, true), budget_inr = p_budget,
           config = coalesce(config, '{}'::jsonb) || jsonb_build_object('pause_blocks_registrations', coalesce(p_pause_blocks_registrations, true))
     where id = c.id;
    return c.id;
  end if;
  insert into public.mega_campaigns (mega_store_id, title, description, starts_at, ends_at, reward_type, reward_value,
                                     max_discount_inr, min_purchase_inr, min_service_price_inr, one_reward_per_shop, budget_inr, config)
  values (m.id, trim(p_title), nullif(left(trim(coalesce(p_description, '')), 500), ''), p_starts_at, p_ends_at, p_type, p_value,
          case when p_type = 'percent' then p_max_discount else null end, coalesce(p_min_purchase, 0), coalesce(p_min_service, 0),
          coalesce(p_one_per_shop, true), p_budget,
          jsonb_build_object('pause_blocks_registrations', coalesce(p_pause_blocks_registrations, true)))
  returning id into v_id;
  return v_id;
end $$;

-- ============ 4. CAMPAIGN STATUS (a budget is required to go live) ============
create or replace function public.megastore_set_campaign_status(p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid();                  -- only the PRIMARY owner starts / pauses / ends
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('draft', 'active', 'paused') for update;
  if not found then raise exception 'no_campaign'; end if;
  if p_status = 'active' then
    if m.status <> 'approved' then raise exception 'store_not_approved'; end if;
    if c.status not in ('draft', 'paused') then raise exception 'invalid_transition'; end if;
    if c.ends_at <= now() then raise exception 'invalid_dates'; end if;
    if c.budget_inr is null then raise exception 'budget_required'; end if;
    if not exists (select 1 from public.mega_campaign_shops where campaign_id = c.id) then raise exception 'no_shops'; end if;
  elsif p_status = 'paused' then
    if c.status <> 'active' then raise exception 'invalid_transition'; end if;
  elsif p_status = 'ended' then
    null;
  else
    raise exception 'invalid_transition';
  end if;
  update public.mega_campaigns set status = p_status where id = c.id;
end $$;

-- ============ 5. PARTNER SHOPS (cap from the limits table, default 10) ============
create or replace function public.megastore_add_shop(p_business_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; b public.businesses; l public.mega_platform_limits;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.status <> 'approved' then raise exception 'store_not_approved'; end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('draft', 'active', 'paused') for update;
  if not found then raise exception 'no_campaign'; end if;
  select * into b from public.businesses where id = p_business_id and status = 'approved';
  if not found then raise exception 'shop_not_found'; end if;
  if b.owner_id = auth.uid() then raise exception 'own_shop'; end if;
  select * into l from public.mega_platform_limits where id;
  if not exists (select 1 from public.mega_campaign_shops where campaign_id = c.id and business_id = b.id)
     and (select count(*) from public.mega_campaign_shops where campaign_id = c.id) >= l.max_partner_shops then
    raise exception 'too_many_shops';
  end if;
  insert into public.mega_campaign_shops (campaign_id, business_id) values (c.id, b.id) on conflict do nothing;
  begin
    perform public._notify(b.owner_id, 'mega_shop_added', 'system',
      jsonb_build_object('business_name', b.name, 'title', m.name), '/owner', null, true);
  exception when others then null; end;
end $$;

-- ============ 6. BUDGET ============
-- After launch the budget can only go UP. Only the primary owner may do it (managers and strangers get not_found).
create or replace function public.megastore_increase_budget(p_add numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; l public.mega_platform_limits; v_new numeric; v_spent numeric;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.status <> 'approved' then raise exception 'store_not_approved'; end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('draft', 'active', 'paused') for update;
  if not found then raise exception 'no_campaign'; end if;
  select * into l from public.mega_platform_limits where id;
  if p_add is null or p_add <= 0 then raise exception 'invalid_budget'; end if;
  v_new := coalesce(c.budget_inr, 0) + p_add;
  if v_new > l.max_budget_inr or (c.budget_inr is null and v_new < l.min_budget_inr) then raise exception 'budget_out_of_range'; end if;
  update public.mega_campaigns set budget_inr = v_new where id = c.id;                  -- audit trigger records campaign.budget (from / to)
  select coalesce(sum(discount_inr), 0) into v_spent from public.mega_reward_redemptions where campaign_id = c.id;
  return jsonb_build_object('budget_inr', v_new, 'spent_inr', v_spent, 'remaining_inr', greatest(v_new - v_spent, 0));
end $$;

-- Replaces the 0039 version: non-admins can no longer LOWER the budget once the campaign has left draft, and the platform limits apply.
create or replace function public.megastore_set_campaign_budget(p_campaign_id uuid, p_budget numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.mega_campaigns; v_status text; l public.mega_platform_limits; v_admin boolean := public.is_admin();
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into c from public.mega_campaigns where id = p_campaign_id for update;
  if not found or not (public.owns_mega_store(c.mega_store_id) or v_admin) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select status into v_status from public.mega_stores where id = c.mega_store_id;
  if v_status <> 'approved' and not v_admin then raise exception 'store_not_approved'; end if;
  if c.status = 'ended' then raise exception 'campaign_locked'; end if;
  if p_budget is not null and (p_budget <= 0 or p_budget > 1000000000) then raise exception 'invalid_budget'; end if;
  if not v_admin then
    select * into l from public.mega_platform_limits where id;
    if p_budget is null then raise exception 'budget_required'; end if;
    if p_budget < l.min_budget_inr or p_budget > l.max_budget_inr then raise exception 'budget_out_of_range'; end if;
    if c.status <> 'draft' and p_budget < coalesce(c.budget_inr, 0) then raise exception 'budget_decrease_blocked'; end if;
  end if;
  update public.mega_campaigns set budget_inr = p_budget where id = c.id;               -- trigger refuses a budget below what was spent
end $$;

-- ============ 7. PAUSE RULES ============
-- Approving a held reward ISSUES it, so it is blocked while the campaign is not running. Rejecting is always allowed.
create or replace function public.megastore_review_reward(p_reward_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.mega_rewards; ms public.mega_stores; c public.mega_campaigns; v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into r from public.mega_rewards where id = p_reward_id for update;
  if not found or not public.owns_mega_store(r.mega_store_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'on_hold' then raise exception 'invalid_transition'; end if;
  select * into ms from public.mega_stores where id = r.mega_store_id;
  if ms.status <> 'approved' then raise exception 'store_not_approved'; end if;
  if p_approve then
    select * into c from public.mega_campaigns where id = r.campaign_id;
    if not found or c.status <> 'active' or c.ends_at <= v_now then raise exception 'campaign_not_active'; end if;
    update public.mega_rewards set status = 'active', issued_at = v_now, expires_at = v_now + interval '1 month',
           review_note = left(p_note, 300), reviewed_by = auth.uid(), reviewed_at = v_now where id = r.id;
    begin
      perform public._notify(r.customer_id, 'mega_reward_issued', 'system',
        jsonb_build_object('business_name', ms.name, 'discount_type', r.reward_type, 'discount_value', r.reward_value,
                           'expires_at', v_now + interval '1 month'), '/my-rewards', 'mega_reward_' || r.id::text, true);
    exception when others then null; end;
  else
    update public.mega_rewards set status = 'rejected', review_note = left(p_note, 300), reviewed_by = auth.uid(), reviewed_at = v_now where id = r.id;
  end if;
end $$;

-- Database-level gate: a NEW reward (or the release of a held one) needs a running campaign, even if some function forgets to check.
-- Redeeming / revoking / expiring existing rewards is NOT gated: issued, unexpired rewards stay valid while a campaign is paused or ended.
create or replace function public.mega_reward_issue_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.mega_campaigns;
begin
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status = 'on_hold' and new.status = 'active') then
    select * into c from public.mega_campaigns where id = new.campaign_id;
    if not found or c.status <> 'active' or c.ends_at <= now() then raise exception 'campaign_not_active'; end if;
  end if;
  return new;
end $$;
-- named so it fires BEFORE mega_rewards_guard (BEFORE triggers run in name order): a paused campaign is refused first.
drop trigger if exists mega_rewards_issue_gate on public.mega_rewards;
drop trigger if exists mega_rewards_a_issue_gate on public.mega_rewards;
create trigger mega_rewards_a_issue_gate before insert or update on public.mega_rewards
  for each row execute function public.mega_reward_issue_gate();

-- Registration (join) now goes through mega_registration_open(): paused campaigns refuse new customers unless configured otherwise.
create or replace function public.join_mega_campaign(p_code text, p_declared_female boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; pr public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into pr from public.profiles where id = auth.uid();
  if not found or pr.is_suspended then raise exception 'not_available' using errcode = '42501'; end if;
  if pr.role <> 'customer' then raise exception 'customer_only'; end if;
  if not pr.email_verified then raise exception 'email_not_verified'; end if;
  if p_declared_female is distinct from true then raise exception 'declare_required'; end if;
  select * into m from public.mega_stores where code = lower(trim(coalesce(p_code, ''))) and status = 'approved';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('active', 'paused') and ends_at > now();
  if not found then raise exception 'not_active'; end if;
  if not public.mega_registration_open(c.id) then raise exception 'registrations_paused'; end if;
  if m.owner_id = auth.uid() then raise exception 'own_store'; end if;
  insert into public.mega_enrollments (campaign_id, customer_id, declared_female) values (c.id, auth.uid(), true)
  on conflict (campaign_id, customer_id) do nothing;
end $$;

create or replace function public.mega_enrollment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.mega_campaigns; ms public.mega_stores; pr public.profiles; v_terms uuid;
begin
  if exists (select 1 from public.mega_enrollments where campaign_id = new.campaign_id and customer_id = new.customer_id) then
    return new;
  end if;
  select * into c from public.mega_campaigns where id = new.campaign_id;
  if not found or not public.mega_registration_open(c.id) then raise exception 'not_active'; end if;
  select * into ms from public.mega_stores where id = c.mega_store_id;
  if ms.status <> 'approved' then raise exception 'store_not_approved'; end if;
  select * into pr from public.profiles where id = new.customer_id;
  if not found or pr.is_suspended or pr.role <> 'customer' then raise exception 'customer_only'; end if;
  if ms.owner_id = new.customer_id then raise exception 'own_store'; end if;
  v_terms := public.mega_current_terms(c.id, 'customer');
  if v_terms is not null then
    if not exists (select 1 from public.mega_terms_acceptances a
                    where a.terms_id = v_terms and a.user_id = new.customer_id and a.campaign_id = c.id and a.business_id is null) then
      raise exception 'terms_not_accepted';
    end if;
    new.terms_id := v_terms;
  end if;
  return new;
end $$;

create or replace function public.accept_mega_terms(p_campaign_id uuid, p_scope text, p_business_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.mega_campaigns; pr public.profiles; v_terms uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into pr from public.profiles where id = auth.uid();
  if not found or pr.is_suspended then raise exception 'not_available' using errcode = '42501'; end if;
  select * into c from public.mega_campaigns where id = p_campaign_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_scope = 'customer' then
    if pr.role <> 'customer' then raise exception 'customer_only'; end if;
    if not public.mega_registration_open(c.id) then raise exception 'not_active'; end if;
  elsif p_scope = 'partner' then
    if p_business_id is null or not public.owns_business(p_business_id) then raise exception 'not_authorized' using errcode = '42501'; end if;
    if not exists (select 1 from public.mega_campaign_shops s where s.campaign_id = c.id and s.business_id = p_business_id) then raise exception 'not_partner_shop'; end if;
  else
    raise exception 'invalid_scope';
  end if;
  v_terms := public.mega_current_terms(c.id, p_scope);
  if v_terms is null then raise exception 'no_terms'; end if;
  insert into public.mega_terms_acceptances (terms_id, user_id, campaign_id, scope, business_id)
  values (v_terms, auth.uid(), c.id, p_scope, case when p_scope = 'partner' then p_business_id end)
  on conflict do nothing;
end $$;

-- Public QR page: same as 0038 plus campaign.registrations_open (so the page knows whether to show the join button).
create or replace function public.get_mega_campaign_public(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; v_shops jsonb; v_me jsonb := null; v_enrolled boolean; v_earned int; v_role public.user_role;
begin
  select * into m from public.mega_stores where code = lower(trim(coalesce(p_code, ''))) and status = 'approved';
  if not found then return jsonb_build_object('found', false); end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('active', 'paused');
  if not found then
    return jsonb_build_object('found', true, 'store', jsonb_build_object('name', m.name, 'description', m.description, 'city', m.city), 'campaign', null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'city', b.city) order by b.name), '[]'::jsonb) into v_shops
    from public.mega_campaign_shops s join public.businesses b on b.id = s.business_id
   where s.campaign_id = c.id and b.status = 'approved';
  if auth.uid() is not null then
    select role into v_role from public.profiles where id = auth.uid();
    select exists (select 1 from public.mega_enrollments where campaign_id = c.id and customer_id = auth.uid()) into v_enrolled;
    select count(*)::int into v_earned from public.mega_rewards
     where campaign_id = c.id and customer_id = auth.uid() and status in ('active', 'on_hold', 'redeemed');
    v_me := jsonb_build_object('role', v_role, 'enrolled', v_enrolled, 'earned', v_earned);
  end if;
  return jsonb_build_object('found', true,
    'store', jsonb_build_object('name', m.name, 'description', m.description, 'city', m.city),
    'campaign', jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description, 'status', c.status,
        'starts_at', c.starts_at, 'ends_at', c.ends_at, 'reward_type', c.reward_type, 'reward_value', c.reward_value,
        'max_discount_inr', c.max_discount_inr, 'min_purchase_inr', c.min_purchase_inr, 'min_service_price_inr', c.min_service_price_inr,
        'max_rewards', c.max_rewards_per_customer, 'one_reward_per_shop', c.one_reward_per_shop,
        'registrations_open', public.mega_registration_open(c.id)),
    'shops', v_shops, 'me', v_me, 'server_now', now());
end $$;

-- ============ 8. OWNER DASHBOARD ============
-- Only an APPROVED store gets data. A pending / rejected / suspended store gets its own status only.
-- Counting rules (never mixed):
--   enrolled           = customers who joined the campaign (registrations)
--   verified_services  = partner-shop services verified and linked to a reward
--   issued             = rewards that were ever issued (issued_at set). Redeemed rewards are a SUBSET of issued, never the same number.
--   redeemed           = rewards actually used at the Mega Store (rows in mega_reward_redemptions)
--   discount_cost_inr  = total discount the Mega Store funded = sum of redemptions only (an issued reward costs nothing until redeemed)
create or replace function public.get_my_megastore() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.mega_stores; c public.mega_campaigns; v_role text;
  v_store jsonb; v_shops jsonb; v_stats jsonb; v_budget jsonb; v_held jsonb; v_flags jsonb; v_recent jsonb;
  v_spent numeric := 0; v_exposure numeric := 0; v_uncapped int := 0; v_remaining numeric;
begin
  if not public.is_owner() then raise exception 'owner_only' using errcode = '42501'; end if;
  select * into m from public.mega_stores where owner_id = auth.uid();
  if found then
    v_role := 'owner';
  else
    select s.* into m from public.mega_stores s join public.mega_store_members mm on mm.mega_store_id = s.id
     where mm.user_id = auth.uid() and mm.status = 'active' order by s.created_at limit 1;
    if not found then return jsonb_build_object('store', null, 'limits', public.get_mega_limits()); end if;
    v_role := 'manager';
  end if;
  v_store := jsonb_build_object('id', m.id, 'name', m.name, 'description', m.description, 'phone', m.phone, 'city', m.city,
                                'address_line', m.address_line, 'code', m.code, 'status', m.status, 'rejection_reason', m.rejection_reason);
  if m.status <> 'approved' then
    return jsonb_build_object('store', v_store, 'my_role', v_role, 'can_manage', v_role = 'owner', 'campaign', null, 'shops', '[]'::jsonb,
      'stats', '{}'::jsonb, 'budget', null, 'held', '[]'::jsonb, 'flags', '[]'::jsonb, 'recent', '[]'::jsonb, 'limits', public.get_mega_limits());
  end if;

  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('draft', 'active', 'paused');
  if not found then
    select * into c from public.mega_campaigns where mega_store_id = m.id order by created_at desc limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.name, 'city', b.city, 'status', b.status,
      'partner_status', coalesce(pp.status, 'invited'),
      'verified_services', (select count(*) from public.mega_service_verifications v where v.campaign_id = c.id and v.business_id = b.id and v.status = 'verified'),
      'rewards_issued', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.business_id = b.id and r.issued_at is not null),
      'rewards_redeemed', (select count(*) from public.mega_reward_redemptions d join public.mega_rewards r on r.id = d.reward_id
                            where d.campaign_id = c.id and r.business_id = b.id)
    ) order by b.name), '[]'::jsonb)
    into v_shops
    from public.mega_campaign_shops s
    join public.businesses b on b.id = s.business_id
    left join public.mega_partner_participation pp on pp.campaign_id = s.campaign_id and pp.business_id = s.business_id
   where c.id is not null and s.campaign_id = c.id;

  if c.id is not null then
    select coalesce(sum(discount_inr), 0) into v_spent from public.mega_reward_redemptions where campaign_id = c.id;
    -- exposure = the most the usable (issued, unexpired, not yet redeemed) rewards can still cost; percent rewards without a cap are counted separately
    select coalesce(sum(case when r.reward_type = 'flat' then r.reward_value else coalesce(r.max_discount_inr, 0) end), 0),
           (count(*) filter (where r.reward_type = 'percent' and r.max_discount_inr is null))::int
      into v_exposure, v_uncapped
      from public.mega_rewards r where r.campaign_id = c.id and r.status = 'active' and r.expires_at > now();

    v_stats := jsonb_build_object(
      'enrolled', (select count(*) from public.mega_enrollments e where e.campaign_id = c.id),
      'verified_services', (select count(*) from public.mega_service_verifications v where v.campaign_id = c.id and v.status = 'verified'),
      'issued', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.issued_at is not null),
      'on_hold', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.status = 'on_hold'),
      'active', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.status = 'active' and r.expires_at > now()),
      'expired', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.status = 'active' and r.expires_at <= now()),
      'revoked', (select count(*) from public.mega_rewards r where r.campaign_id = c.id and r.status = 'revoked' and r.issued_at is not null),
      'redeemed', (select count(*) from public.mega_reward_redemptions d where d.campaign_id = c.id),
      'discount_cost_inr', v_spent,
      'discount_given_inr', v_spent,
      'bills_inr', (select coalesce(sum(d.bill_inr), 0) from public.mega_reward_redemptions d where d.campaign_id = c.id));

    v_remaining := case when c.budget_inr is null then null else greatest(c.budget_inr - v_spent, 0) end;
    v_budget := jsonb_build_object('budget_inr', c.budget_inr, 'spent_inr', v_spent, 'remaining_inr', v_remaining,
      'outstanding_exposure_inr', v_exposure, 'uncapped_outstanding', v_uncapped,
      'shortfall_inr', case when v_remaining is null then 0 else greatest(v_exposure - v_remaining, 0) end);

    -- requests that need the owner's decision (the server put them on hold)
    select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'business_name', r.business_name,
             'customer_name', coalesce(split_part(p.full_name, ' ', 1), ''), 'risk_flags', r.risk_flags, 'created_at', r.created_at)
             order by r.created_at), '[]'::jsonb)
      into v_held from public.mega_rewards r join public.profiles p on p.id = r.customer_id
     where r.campaign_id = c.id and r.status = 'on_hold';

    -- suspicious transactions: open and confirmed fraud flags
    select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) into v_flags
      from (select f.created_at as at,
                   jsonb_build_object('id', f.id, 'flag_type', f.flag_type, 'severity', f.severity, 'status', f.status, 'source', f.source,
                     'created_at', f.created_at, 'business_name', b.name, 'customer_name', coalesce(split_part(p.full_name, ' ', 1), ''),
                     'reward_code', r.code, 'reward_status', r.status) as j
              from public.mega_fraud_flags f
              left join public.businesses b on b.id = f.business_id
              left join public.profiles p on p.id = f.customer_id
              left join public.mega_rewards r on r.id = f.reward_id
             where f.campaign_id = c.id and f.status in ('open', 'confirmed')
             order by f.created_at desc limit 30) x;

    select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) into v_recent
      from (select d.redeemed_at as at,
                   jsonb_build_object('code', r.code, 'customer_name', coalesce(split_part(p.full_name, ' ', 1), ''),
                     'business_name', r.business_name, 'bill_inr', d.bill_inr, 'discount_inr', d.discount_inr, 'redeemed_at', d.redeemed_at) as j
              from public.mega_reward_redemptions d
              join public.mega_rewards r on r.id = d.reward_id
              join public.profiles p on p.id = d.customer_id
             where d.campaign_id = c.id
             order by d.redeemed_at desc limit 15) x;
  end if;

  return jsonb_build_object(
    'store', v_store, 'my_role', v_role, 'can_manage', v_role = 'owner',
    'campaign', case when c.id is null then null else to_jsonb(c) - 'mega_store_id' end,
    'issuance_open', c.id is not null and c.status = 'active' and c.ends_at > now(),
    'registrations_open', c.id is not null and public.mega_registration_open(c.id),
    'shops', coalesce(v_shops, '[]'::jsonb), 'stats', coalesce(v_stats, '{}'::jsonb), 'budget', v_budget,
    'held', coalesce(v_held, '[]'::jsonb), 'flags', coalesce(v_flags, '[]'::jsonb), 'recent', coalesce(v_recent, '[]'::jsonb),
    'limits', public.get_mega_limits());
end $$;

-- ============ 9. FUNCTION PRIVILEGES ============
revoke execute on function
  public.get_mega_limits(), public.admin_set_mega_limits(numeric, numeric, numeric, numeric, int, numeric, numeric),
  public.mega_registration_open(uuid), public.mega_reward_issue_gate(), public.mega_enrollment_guard(),
  public.megastore_save_campaign(text, text, timestamptz, timestamptz, text, numeric, numeric, numeric, numeric, boolean, numeric, boolean),
  public.megastore_increase_budget(numeric)
  from public, anon, authenticated;

grant execute on function
  public.get_mega_limits(), public.admin_set_mega_limits(numeric, numeric, numeric, numeric, int, numeric, numeric),
  public.megastore_save_campaign(text, text, timestamptz, timestamptz, text, numeric, numeric, numeric, numeric, boolean, numeric, boolean),
  public.megastore_increase_budget(numeric)
  to authenticated;
