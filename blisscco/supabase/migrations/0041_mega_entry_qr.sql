-- 0041 Mega Store campaign-entry QR: duplicate-entry protection, friendly "already joined", terms in the same call, QR page states.
-- Run after 0040. Safe to re-run.
--
-- What the earlier migrations already gave us (kept as it is):
--   * mega_enrollments has unique (campaign_id, customer_id): one account = one entry per campaign, enforced by the database.
--   * The QR carries only mega_stores.code (random, 10 hex characters). No customer data, no keys, no reward credential.
--   * Registration is checked on the server: approved store, running campaign (mega_registration_open), customer account,
--     verified e-mail, not suspended, not the store owner, terms accepted (mega_enrollment_guard).
--   * Scanning / joining NEVER creates a reward. Rewards are made only by the booking trigger after a partner-shop service is
--     completed (mega_try_issue_reward).
--
-- What this migration changes:
--   1. join_mega_campaign() now RETURNS text: 'joined' (new entry) or 'already_joined' (this account is already in).
--      A second scan, a double tap or two tabs at once never create a second row and never show an error.
--      An account that already joined also gets 'already_joined' while the campaign is paused (it is already in).
--      The older 2-argument call still works (p_accept_terms is optional).
--   2. join_mega_campaign() takes the customer's acceptance of the campaign terms (p_accept_terms) and records it in the same
--      transaction. Before this, a campaign with published customer terms could not be joined from the app at all
--      (mega_enrollment_guard raised terms_not_accepted and nothing recorded the acceptance).
--   3. get_mega_campaign_public() adds: campaign.state (active / paused / expired), top-level closed (the store only has
--      ended campaigns), me.email_verified, me.enrolled_at. The QR page uses these to show the right message.

-- ============ 0. SAFETY CHECK: the database-level uniqueness must exist ============
do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.mega_enrollments'::regclass and c.contype = 'u'
       and (select array_agg(a.attname::text order by a.attname::text) from pg_attribute a
             where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['campaign_id', 'customer_id']
  ) then
    alter table public.mega_enrollments add constraint mega_enrollments_one_per_customer unique (campaign_id, customer_id);
  end if;
end $$;

-- ============ 1. JOIN ============
drop function if exists public.join_mega_campaign(text, boolean);
drop function if exists public.join_mega_campaign(text, boolean, boolean);

create or replace function public.join_mega_campaign(p_code text, p_declared_female boolean, p_accept_terms boolean default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; pr public.profiles; v_terms uuid; v_id uuid;
begin
  -- identity = the stable auth user id from the session, never an e-mail address sent by the browser
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into pr from public.profiles where id = auth.uid();
  if not found or pr.is_suspended then raise exception 'not_available' using errcode = '42501'; end if;
  if pr.role <> 'customer' then raise exception 'customer_only'; end if;

  select * into m from public.mega_stores where code = lower(trim(coalesce(p_code, ''))) and status = 'approved';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('active', 'paused') and ends_at > now();
  if not found then raise exception 'not_active'; end if;       -- draft / ended / expired: nobody can join

  if not pr.email_verified then raise exception 'email_not_verified'; end if;
  if p_declared_female is distinct from true then raise exception 'declare_required'; end if;

  -- already inside this campaign: friendly answer, nothing is written (also while the campaign is paused)
  if exists (select 1 from public.mega_enrollments where campaign_id = c.id and customer_id = auth.uid()) then
    return 'already_joined';
  end if;

  if not public.mega_registration_open(c.id) then raise exception 'registrations_paused'; end if;
  if m.owner_id = auth.uid() then raise exception 'own_store'; end if;

  -- campaign terms: recorded with the server-side user id and the current version, in the same transaction as the entry
  v_terms := public.mega_current_terms(c.id, 'customer');
  if v_terms is not null and not exists (
       select 1 from public.mega_terms_acceptances a
        where a.terms_id = v_terms and a.user_id = auth.uid() and a.campaign_id = c.id and a.business_id is null) then
    -- NULL = argument not given (old 2-argument calls): the enrolment guard below still refuses with terms_not_accepted
    if p_accept_terms = false then raise exception 'terms_required'; end if;
    if p_accept_terms then
      insert into public.mega_terms_acceptances (terms_id, user_id, campaign_id, scope, business_id)
      values (v_terms, auth.uid(), c.id, 'customer', null)
      on conflict do nothing;
    end if;
  end if;

  -- the unique key (campaign_id, customer_id) settles any race between two requests of the same account
  insert into public.mega_enrollments (campaign_id, customer_id, declared_female) values (c.id, auth.uid(), true)
  on conflict (campaign_id, customer_id) do nothing
  returning id into v_id;
  if v_id is null then return 'already_joined'; end if;
  return 'joined';
end $$;

revoke execute on function public.join_mega_campaign(text, boolean, boolean) from public, anon;
grant execute on function public.join_mega_campaign(text, boolean, boolean) to authenticated;

-- ============ 2. PUBLIC QR PAGE DATA ============
create or replace function public.get_mega_campaign_public(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.mega_stores; c public.mega_campaigns; v_shops jsonb; v_me jsonb := null; v_enrolled boolean; v_enrolled_at timestamptz;
        v_earned int; v_role public.user_role; v_verified boolean; v_closed boolean;
begin
  select * into m from public.mega_stores where code = lower(trim(coalesce(p_code, ''))) and status = 'approved';
  if not found then return jsonb_build_object('found', false); end if;
  select * into c from public.mega_campaigns where mega_store_id = m.id and status in ('active', 'paused');
  if not found then
    -- no running campaign: tell "it has finished" apart from "nothing was ever started" (drafts are never revealed)
    select exists (select 1 from public.mega_campaigns where mega_store_id = m.id and status = 'ended') into v_closed;
    return jsonb_build_object('found', true, 'store', jsonb_build_object('name', m.name, 'description', m.description, 'city', m.city),
                              'campaign', null, 'closed', v_closed);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'city', b.city) order by b.name), '[]'::jsonb) into v_shops
    from public.mega_campaign_shops s join public.businesses b on b.id = s.business_id
   where s.campaign_id = c.id and b.status = 'approved';
  if auth.uid() is not null then
    select role, email_verified into v_role, v_verified from public.profiles where id = auth.uid();
    select true, e.enrolled_at into v_enrolled, v_enrolled_at from public.mega_enrollments e where e.campaign_id = c.id and e.customer_id = auth.uid();
    v_enrolled := coalesce(v_enrolled, false);
    select count(*)::int into v_earned from public.mega_rewards
     where campaign_id = c.id and customer_id = auth.uid() and status in ('active', 'on_hold', 'redeemed');
    v_me := jsonb_build_object('role', v_role, 'enrolled', v_enrolled, 'enrolled_at', v_enrolled_at, 'earned', v_earned,
                               'email_verified', coalesce(v_verified, false));
  end if;
  return jsonb_build_object('found', true,
    'store', jsonb_build_object('name', m.name, 'description', m.description, 'city', m.city),
    'campaign', jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description, 'status', c.status,
        'state', case when c.ends_at <= now() then 'expired' when c.status = 'paused' then 'paused' else 'active' end,
        'starts_at', c.starts_at, 'ends_at', c.ends_at, 'reward_type', c.reward_type, 'reward_value', c.reward_value,
        'max_discount_inr', c.max_discount_inr, 'min_purchase_inr', c.min_purchase_inr, 'min_service_price_inr', c.min_service_price_inr,
        'max_rewards', c.max_rewards_per_customer, 'one_reward_per_shop', c.one_reward_per_shop,
        'registrations_open', public.mega_registration_open(c.id)),
    'shops', v_shops, 'me', v_me, 'closed', false, 'server_now', now());
end $$;

grant execute on function public.get_mega_campaign_public(text) to anon, authenticated;     -- the QR page works before login
