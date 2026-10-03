-- 0017: Subscriptions (PRO / ELITE) removed. Only paid services left: Banner (per banner credit) and Blue badge.
-- Re-runnable. Needs 0011 and 0012. Old payments / subscriptions rows are KEPT (history, refunds still work).

-- 1) PRO / ELITE can no longer be bought (rows stay so old payment history keeps its plan name)
update public.plans set is_active = false where kind = 'plan';

-- 2) Entitlements: banner + analytics are open to every shop. Blue badge still needs a paid, unexpired badge.
create or replace function public.has_entitlement(p_business_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_feature in ('banner', 'analytics') then true
    else exists (
      select 1 from public.subscriptions s
        join public.plans p on p.code = s.plan_code
       where s.business_id = p_business_id and s.status = 'active' and p.kind = 'badge'
         and s.starts_at <= now() and s.expires_at > now()
         and p_feature = any (p.features))
  end;
$$;

-- 3) No tiers any more: nobody is ranked above others in search because of a plan
create or replace function public.business_tier_rank(p_business_id uuid)
returns int language sql stable security definer set search_path = '' as $$ select 0; $$;

-- 4) Extra banner pack no longer needs a plan (only an approved shop, checked above in create_payment_txn)
create or replace function public.create_payment_txn(p_user_id uuid, p_business_id uuid, p_plan_code text, p_receipt text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl public.plans; v_owner uuid; v_status public.business_status; v_id uuid;
begin
  select * into pl from public.plans where code = p_plan_code and is_active and kind <> 'plan';
  if not found then raise exception 'plan_not_found'; end if;
  select b.owner_id, b.status into v_owner, v_status from public.businesses b where b.id = p_business_id;
  if not found or v_owner is distinct from p_user_id then raise exception 'not_owner'; end if;
  if exists (select 1 from public.profiles where id = p_user_id and (is_suspended or role <> 'owner')) then
    raise exception 'not_owner';
  end if;
  if v_status <> 'approved' then raise exception 'business_not_approved'; end if;
  if pl.kind = 'badge' and not exists (select 1 from public.verification_requests
        where business_id = p_business_id and status = 'approved') then
    raise exception 'verification_required';
  end if;
  if (select count(*) from public.payment_transactions
       where business_id = p_business_id and status = 'created' and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_orders';
  end if;
  insert into public.payment_transactions (business_id, user_id, plan_code, amount_paise, receipt)
  values (p_business_id, p_user_id, pl.code, pl.amount_paise, p_receipt) returning id into v_id;
  return jsonb_build_object('txn_id', v_id, 'amount_paise', pl.amount_paise, 'plan_name', pl.name);
end $$;

-- 5) AI insights: ELITE gate removed (daily limit of 10 per shop stays)
create or replace function public.claim_ai_insight(p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then raise exception 'not_owner' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
  select count(*) into v_n from public.ai_insight_log where business_id = p_business_id and created_at > now() - interval '24 hours';
  if v_n >= 10 then raise exception 'rate_limited' using errcode = '53400'; end if;
  insert into public.ai_insight_log (business_id) values (p_business_id);
end $$;

-- 6) Admin "grant free plan" tool is gone from the UI; block the old function in the database too
revoke execute on function public.admin_grant_subscription(uuid, text, int, text) from anon, authenticated, public;
