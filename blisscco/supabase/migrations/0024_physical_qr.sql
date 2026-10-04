-- 0024: Physical QR poster (Rs 50, UPI). Re-runnable. Run after 0023, BEFORE deploying the new frontend.
-- Re-uses the existing Razorpay pipeline (create_payment_txn + process_razorpay_event): the price lives in public.plans,
-- the client never sends an amount. A paid 'physical_qr' payment is only a paid order (no subscription, no credits).

-- 1) allow a new plan kind
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.plans'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) like '%banner_pack%') and conname <> 'plan_duration'
  loop
    execute format('alter table public.plans drop constraint %I', c);
  end loop;
end $$;
alter table public.plans add constraint plans_kind_check check (kind in ('plan', 'badge', 'banner_pack', 'physical_qr'));

alter table public.plans drop constraint if exists plan_duration;
alter table public.plans add constraint plan_duration check (kind in ('banner_pack', 'physical_qr') or duration_days > 0);

-- 2) the product: Rs 50 = 5000 paise
insert into public.plans (code, kind, name, amount_paise, duration_days, banner_credits, tier_rank, features, sort_order)
values ('physical_qr', 'physical_qr', 'Physical QR poster', 5000, 0, 0, 0, array[]::text[], 5)
on conflict (code) do update set kind = 'physical_qr', amount_paise = 5000, is_active = true;
