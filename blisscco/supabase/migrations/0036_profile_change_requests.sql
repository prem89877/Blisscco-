-- 0036: Live shop can request a change of business NAME / CATEGORY / DESCRIPTION. The change goes live only after admin approval.
-- Run AFTER 0035, BEFORE deploying the new frontend. Safe to re-run.
-- Until approved, the public page keeps showing the old details. One pending request per shop (a new request replaces it).

create table if not exists public.business_change_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  category_id uuid not null references public.business_categories(id),
  description text not null check (char_length(trim(description)) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);
create unique index if not exists business_change_requests_one_pending on public.business_change_requests (business_id) where status = 'pending';
create index if not exists business_change_requests_biz_idx on public.business_change_requests (business_id, created_at desc);

alter table public.business_change_requests enable row level security;
drop policy if exists bcr_select on public.business_change_requests;
create policy bcr_select on public.business_change_requests for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
revoke all on public.business_change_requests from anon, authenticated;
grant select on public.business_change_requests to authenticated;   -- nobody writes directly; only the functions below

-- Owner: send (or replace) a change request for an approved / hidden shop
create or replace function public.owner_request_profile_change(p_business_id uuid, p_name text, p_category_id uuid, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.businesses; v_name text := trim(coalesce(p_name, '')); v_desc text := trim(coalesce(p_description, '')); v_id uuid;
begin
  if not public.owns_business(p_business_id) then raise exception 'business not found' using errcode = 'P0002'; end if;
  select * into b from public.businesses where id = p_business_id and owner_id = auth.uid();
  if not found or b.status not in ('approved', 'inactive') then raise exception 'transition not allowed' using errcode = '42501'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'invalid_name' using errcode = '23514'; end if;
  if v_desc = '' or char_length(v_desc) > 2000 then raise exception 'invalid_description' using errcode = '23514'; end if;
  if not exists (select 1 from public.business_categories where id = p_category_id and is_active) then raise exception 'invalid_category' using errcode = '23514'; end if;
  if v_name = b.name and p_category_id is not distinct from b.category_id and v_desc = coalesce(trim(b.description), '') then
    raise exception 'no_change' using errcode = '23514';
  end if;
  delete from public.business_change_requests where business_id = p_business_id and status = 'pending';
  insert into public.business_change_requests (business_id, owner_id, name, category_id, description)
  values (p_business_id, auth.uid(), v_name, p_category_id, v_desc) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.owner_request_profile_change(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.owner_request_profile_change(uuid, text, uuid, text) to authenticated;

-- Admin: approve (changes go live) or reject (reason required)
create or replace function public.admin_review_profile_change(p_request_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.business_change_requests;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into r from public.business_change_requests where id = p_request_id for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'request is not pending'; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then raise exception 'a rejection reason is required' using errcode = '23514'; end if;
  if p_approve then
    update public.businesses set name = r.name, category_id = r.category_id, description = r.description where id = r.business_id;
  end if;
  update public.business_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         rejection_reason = case when p_approve then null else trim(p_reason) end,
         reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_request_id;
  perform public.write_audit_log(case when p_approve then 'business.profile_change_approve' else 'business.profile_change_reject' end,
                                 'business', r.business_id, jsonb_build_object('request_id', r.id, 'reason', p_reason));
end $$;
revoke execute on function public.admin_review_profile_change(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_review_profile_change(uuid, boolean, text) to authenticated;
