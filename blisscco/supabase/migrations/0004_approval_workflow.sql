-- 0004: trusted workflow functions (all state changes go through here)

-- Owner accepts the current terms for a business (stores user, timestamp, version)
create or replace function public.accept_business_terms(p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_version text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.owns_business(p_business_id) then raise exception 'business not found' using errcode = 'P0002'; end if;
  select version into v_version from public.terms_versions where is_current;
  if v_version is null then raise exception 'no current terms configured'; end if;
  insert into public.terms_acceptances (user_id, business_id, terms_version)
  values (auth.uid(), p_business_id, v_version)
  on conflict (user_id, business_id, terms_version) do nothing;
end $$;

-- Owner submits (or resubmits after rejection) for admin review
create or replace function public.submit_business_application(p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
  v_missing text[] := '{}';
  v_version text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into b from public.businesses
   where id = p_business_id and owner_id = auth.uid() for update;
  if not found then raise exception 'business not found' using errcode = 'P0002'; end if;
  if b.status not in ('draft', 'rejected') then
    raise exception 'application cannot be submitted from status %', b.status;
  end if;
  if not public.is_owner() then raise exception 'owner account required' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    raise exception 'email not verified';
  end if;

  if b.category_id is null or not exists (select 1 from public.business_categories where id = b.category_id and is_active) then
    v_missing := array_append(v_missing, 'category'::text); end if;
  if coalesce(trim(b.description), '') = '' then v_missing := array_append(v_missing, 'description'::text); end if;
  if b.phone is null then v_missing := array_append(v_missing, 'phone'::text); end if;
  if b.email is null then v_missing := array_append(v_missing, 'email'::text); end if;
  if coalesce(trim(b.address_line), '') = '' then v_missing := array_append(v_missing, 'address'::text); end if;
  if coalesce(trim(b.city), '') = '' then v_missing := array_append(v_missing, 'city'::text); end if;
  if coalesce(trim(b.state), '') = '' then v_missing := array_append(v_missing, 'state'::text); end if;
  if b.latitude is null or b.longitude is null then v_missing := array_append(v_missing, 'location'::text); end if;
  if (select count(*) from public.business_images where business_id = b.id) < 3 then
    v_missing := array_append(v_missing, 'at least 3 photos'::text); end if;
  if not exists (select 1 from public.business_hours where business_id = b.id and not is_closed) then
    v_missing := array_append(v_missing, 'opening hours'::text); end if;
  if not exists (select 1 from public.services where business_id = b.id and is_active) then
    v_missing := array_append(v_missing, 'at least 1 service with price'::text); end if;

  select version into v_version from public.terms_versions where is_current;
  if not exists (select 1 from public.terms_acceptances
                  where user_id = auth.uid() and business_id = b.id and terms_version = v_version) then
    v_missing := array_append(v_missing, 'terms acceptance'::text); end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'application incomplete: %', array_to_string(v_missing, ', ') using errcode = '23514';
  end if;

  update public.businesses
     set status = 'pending_review', submitted_at = now(), rejection_reason = null
   where id = b.id;
  insert into public.business_status_history (business_id, from_status, to_status, actor_id)
  values (b.id, b.status, 'pending_review', auth.uid());
end $$;

-- Admin approves or rejects (rejection requires a reason)
create or replace function public.admin_review_business(p_business_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.business_status; v_new public.business_status;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select status into v_old from public.businesses where id = p_business_id for update;
  if not found then raise exception 'business not found' using errcode = 'P0002'; end if;
  if v_old <> 'pending_review' then raise exception 'business is not pending review (status: %)', v_old; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'a rejection reason is required' using errcode = '23514'; end if;

  v_new := case when p_approve then 'approved'::public.business_status else 'rejected'::public.business_status end;
  update public.businesses
     set status = v_new,
         rejection_reason = case when p_approve then null else trim(p_reason) end,
         reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_business_id;
  insert into public.business_status_history (business_id, from_status, to_status, reason, actor_id)
  values (p_business_id, v_old, v_new, nullif(trim(p_reason), ''), auth.uid());
  perform public.write_audit_log(case when p_approve then 'business.approve' else 'business.reject' end,
                                 'business', p_business_id, jsonb_build_object('reason', p_reason));
end $$;

-- Admin suspend / reactivate
create or replace function public.admin_set_business_status(p_business_id uuid, p_target public.business_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.business_status;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select status into v_old from public.businesses where id = p_business_id for update;
  if not found then raise exception 'business not found' using errcode = 'P0002'; end if;
  if not ((v_old in ('approved', 'inactive') and p_target = 'suspended') or (v_old = 'suspended' and p_target = 'approved')) then
    raise exception 'transition % -> % not allowed', v_old, p_target;
  end if;
  if p_target = 'suspended' and coalesce(trim(p_reason), '') = '' then
    raise exception 'a suspension reason is required' using errcode = '23514'; end if;

  update public.businesses set status = p_target, reviewed_at = now(), reviewed_by = auth.uid(),
         rejection_reason = case when p_target = 'suspended' then trim(p_reason) else null end
   where id = p_business_id;
  insert into public.business_status_history (business_id, from_status, to_status, reason, actor_id)
  values (p_business_id, v_old, p_target, nullif(trim(p_reason), ''), auth.uid());
  perform public.write_audit_log('business.' || p_target::text, 'business', p_business_id,
                                 jsonb_build_object('reason', p_reason));
end $$;

-- Owner temporarily hides / re-shows their own approved listing
create or replace function public.owner_set_business_active(p_business_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.business_status; v_new public.business_status;
begin
  if not public.owns_business(p_business_id) then raise exception 'business not found' using errcode = 'P0002'; end if;
  select status into v_old from public.businesses where id = p_business_id for update;
  if p_active and v_old = 'inactive' then v_new := 'approved';
  elsif not p_active and v_old = 'approved' then v_new := 'inactive';
  else raise exception 'transition not allowed from status %', v_old; end if;
  update public.businesses set status = v_new where id = p_business_id;
  insert into public.business_status_history (business_id, from_status, to_status, actor_id)
  values (p_business_id, v_old, v_new, auth.uid());
end $$;

-- Only signed-in users may call these; each function re-checks authorization itself.
revoke execute on function
  public.accept_business_terms(uuid), public.submit_business_application(uuid),
  public.admin_review_business(uuid, boolean, text),
  public.admin_set_business_status(uuid, public.business_status, text),
  public.owner_set_business_active(uuid, boolean)
  from public, anon, authenticated;
grant execute on function
  public.accept_business_terms(uuid), public.submit_business_application(uuid),
  public.admin_review_business(uuid, boolean, text),
  public.admin_set_business_status(uuid, public.business_status, text),
  public.owner_set_business_active(uuid, boolean)
  to authenticated;
