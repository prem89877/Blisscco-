-- 0026: Payment gateway switch Razorpay -> Cashfree Payments.
-- Run after 0025. Safe to re-run. Existing payment rows are kept (columns are only renamed).
--   * payment_transactions.razorpay_order_id / razorpay_payment_id  ->  gateway_order_id / gateway_payment_id
--   * payment_refunds.razorpay_refund_id                            ->  gateway_refund_id
--   * attach_razorpay_order()   ->  attach_gateway_order()
--   * process_razorpay_event()  ->  process_cashfree_event()   (reads Cashfree webhook payloads; amounts arrive in RUPEES)
-- Everything else (create_payment_txn, mark_txn_failed, notification trigger, earnings report) is unchanged.

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_transactions' and column_name = 'razorpay_order_id') then
    alter table public.payment_transactions rename column razorpay_order_id to gateway_order_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_transactions' and column_name = 'razorpay_payment_id') then
    alter table public.payment_transactions rename column razorpay_payment_id to gateway_payment_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_refunds' and column_name = 'razorpay_refund_id') then
    alter table public.payment_refunds rename column razorpay_refund_id to gateway_refund_id;
  end if;
end $$;

-- Old functions are removed (they referenced the old column names).
drop function if exists public.attach_razorpay_order(uuid, text);
drop function if exists public.process_razorpay_event(text, text, jsonb);

create or replace function public.attach_gateway_order(p_txn_id uuid, p_order_id text)
returns void language sql security definer set search_path = '' as $$
  update public.payment_transactions set gateway_order_id = p_order_id
   where id = p_txn_id and gateway_order_id is null and status = 'created';
$$;

-- Step 2: the verified Cashfree webhook. Runs in ONE transaction: if anything raises, the event row is rolled back too,
-- so Cashfree's retry can process it again. A repeated event id returns 'duplicate' and changes nothing.
-- Event types handled: PAYMENT_SUCCESS_WEBHOOK, REFUND_STATUS_WEBHOOK (refund_status = SUCCESS). Everything else is stored and ignored.
-- Cashfree amounts are in rupees (e.g. 499 or 499.00); we compare them with the paise stored at order time.
create or replace function public.process_cashfree_event(p_event_id text, p_event_type text, p_payload jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_rows int; v_result text := 'ignored'; pay jsonb; ord jsonb; ref jsonb;
  tx public.payment_transactions; pl public.plans; v_start timestamptz; v_total int; v_granted int;
begin
  if coalesce(p_event_id, '') = '' then raise exception 'missing_event_id'; end if;
  insert into public.webhook_events (event_id, event_type, payload) values (p_event_id, p_event_type, p_payload)
  on conflict (event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return 'duplicate'; end if;

  if p_event_type = 'PAYMENT_SUCCESS_WEBHOOK' then
    pay := p_payload #> '{data,payment}';
    ord := p_payload #> '{data,order}';
    select * into tx from public.payment_transactions where gateway_order_id = ord ->> 'order_id' for update;
    if not found then
      v_result := 'unknown_order';
    elsif tx.status <> 'created' then
      v_result := 'already_processed';
    elsif round((pay ->> 'payment_amount')::numeric * 100)::int is distinct from tx.amount_paise
          or pay ->> 'payment_currency' is distinct from 'INR' or pay ->> 'payment_status' is distinct from 'SUCCESS' then
      update public.payment_transactions set status = 'amount_mismatch', gateway_payment_id = pay ->> 'cf_payment_id' where id = tx.id;
      v_result := 'amount_mismatch';
    else
      select * into pl from public.plans where code = tx.plan_code;
      update public.payment_transactions set status = 'paid', gateway_payment_id = pay ->> 'cf_payment_id', paid_at = now() where id = tx.id;
      if pl.kind in ('plan', 'badge') then
        -- renewal stacks after the current expiry of the same product
        select max(s.expires_at) into v_start from public.subscriptions s
         where s.business_id = tx.business_id and s.plan_code = pl.code and s.status = 'active' and s.expires_at > now();
        v_start := greatest(coalesce(v_start, now()), now());
        insert into public.subscriptions (business_id, plan_code, starts_at, expires_at, payment_transaction_id)
        values (tx.business_id, pl.code, v_start, v_start + make_interval(days => pl.duration_days), tx.id);
      end if;
      if pl.banner_credits > 0 then
        insert into public.banner_credits (business_id, delta, reason, payment_transaction_id)
        values (tx.business_id, pl.banner_credits, case when pl.kind = 'plan' then 'plan_grant' else 'extra_purchase' end, tx.id)
        on conflict do nothing;
      end if;
      v_result := 'activated';
    end if;

  elsif p_event_type = 'REFUND_STATUS_WEBHOOK' and p_payload #>> '{data,refund,refund_status}' = 'SUCCESS' then
    ref := p_payload #> '{data,refund}';
    select * into tx from public.payment_transactions where gateway_payment_id = ref ->> 'cf_payment_id' for update;
    if not found then
      raise exception 'payment_not_ready';        -- roll back so Cashfree retries after the payment event was handled
    end if;
    insert into public.payment_refunds (gateway_refund_id, txn_id, amount_paise)
    values (ref ->> 'cf_refund_id', tx.id, round((ref ->> 'refund_amount')::numeric * 100)::int) on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      v_result := 'duplicate_refund';
    else
      select coalesce(sum(amount_paise), 0)::int into v_total from public.payment_refunds where txn_id = tx.id;
      update public.payment_transactions
         set refunded_paise = v_total, status = case when v_total >= tx.amount_paise then 'refunded' else 'partially_refunded' end
       where id = tx.id;
      if v_total >= tx.amount_paise then
        update public.subscriptions set status = 'refunded' where payment_transaction_id = tx.id;
        select delta into v_granted from public.banner_credits where payment_transaction_id = tx.id and delta > 0 limit 1;
        if v_granted is not null then
          insert into public.banner_credits (business_id, delta, reason, payment_transaction_id)
          values (tx.business_id, -v_granted, 'payment_refund', tx.id) on conflict do nothing;
        end if;
        v_result := 'refunded';
      else
        v_result := 'partially_refunded';         -- entitlement stays; admin decides (see README)
      end if;
    end if;
  end if;

  update public.webhook_events set result = v_result, processed_at = now() where event_id = p_event_id;
  return v_result;
end $$;

-- Only the Vercel API routes (service_role key) may call these. Never the browser.
revoke execute on function public.attach_gateway_order(uuid, text), public.process_cashfree_event(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.attach_gateway_order(uuid, text), public.process_cashfree_event(text, text, jsonb) to service_role;
