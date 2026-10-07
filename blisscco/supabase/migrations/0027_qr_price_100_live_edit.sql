-- 0027: (1) Physical QR poster price Rs 50 -> Rs 100  (2) owner can edit contact details of a LIVE listing.
-- Run after 0026, BEFORE deploying the new frontend. Safe to re-run. No table or column change.

-- 1) Price lives only in public.plans (the client never sends an amount). Rs 100 = 10000 paise.
update public.plans set amount_paise = 10000, is_active = true where code = 'physical_qr';

-- 2) Owners could only edit draft / rejected listings. This function lets an owner change ONLY the safe fields of an
--    approved or hidden (inactive) listing: description, phone, e-mail and the two "show publicly" switches.
--    Name, category, address and map location stay locked (they need admin review). Table CHECKs still validate phone/e-mail.
create or replace function public.owner_update_live_details(
  p_business_id uuid, p_description text, p_phone text, p_email text, p_show_phone boolean, p_show_email boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.owns_business(p_business_id) then raise exception 'business not found' using errcode = 'P0002'; end if;
  update public.businesses
     set description = nullif(trim(p_description), ''), phone = nullif(trim(p_phone), ''), email = nullif(trim(p_email), ''),
         show_phone_publicly = coalesce(p_show_phone, false), show_email_publicly = coalesce(p_show_email, false)
   where id = p_business_id and owner_id = auth.uid() and status in ('approved', 'inactive');
  if not found then raise exception 'transition not allowed' using errcode = '42501'; end if;
end $$;

revoke execute on function public.owner_update_live_details(uuid, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.owner_update_live_details(uuid, text, text, text, boolean, boolean) to authenticated;
