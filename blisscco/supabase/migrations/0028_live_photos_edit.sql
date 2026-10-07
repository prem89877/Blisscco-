-- 0028: owners may add / remove / replace photos of an approved or hidden (inactive) listing.
-- Run after 0027, BEFORE deploying the new frontend. Safe to re-run. No table or column change.
-- business_is_editable() is used only by the business_images table policy and the business-images storage policies,
-- so widening it affects photos only. Name, category, address and location stay locked (draft / rejected only, via RLS).
create or replace function public.business_is_editable(p_business_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.businesses b
                   join public.profiles p on p.id = b.owner_id
                  where b.id = p_business_id and b.owner_id = auth.uid() and not p.is_suspended
                    and b.status in ('draft', 'rejected', 'approved', 'inactive'));
$$;
grant execute on function public.business_is_editable(uuid) to anon, authenticated;
