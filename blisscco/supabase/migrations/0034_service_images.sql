-- 0034: up to 3 photos per service (add business + edit business). Run BEFORE deploying the new frontend. Safe to re-run.
-- Photos live in the existing private 'business-images' bucket (path {business_id}/{uuid}.ext), so the storage policies
-- from 0005 / 0028 already cover them. Only a new table + RLS is needed.

create table if not exists public.service_images (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint service_image_path_in_business_folder check (storage_path like business_id::text || '/%')
);
create index if not exists service_images_service_idx on public.service_images(service_id, sort_order);
create index if not exists service_images_business_idx on public.service_images(business_id);

-- Hard limit: 3 photos per service, and the service must belong to the same business (cannot be bypassed from the app).
create or replace function public.service_images_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.services s where s.id = new.service_id and s.business_id = new.business_id for update;
  if not found then
    raise exception 'service_not_in_business' using errcode = '23514';
  end if;
  if (select count(*) from public.service_images i where i.service_id = new.service_id) >= 3 then
    raise exception 'max_3_service_images' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists service_images_before_insert on public.service_images;
create trigger service_images_before_insert before insert on public.service_images
  for each row execute function public.service_images_before_insert();

alter table public.service_images enable row level security;

drop policy if exists simg_select on public.service_images;
create policy simg_select on public.service_images for select to anon, authenticated
  using (public.business_is_public(business_id) or public.owns_business(business_id) or public.is_admin());

drop policy if exists simg_write_owner on public.service_images;
create policy simg_write_owner on public.service_images for all to authenticated
  using (public.business_is_editable(business_id)) with check (public.business_is_editable(business_id));

drop policy if exists simg_delete_admin on public.service_images;
create policy simg_delete_admin on public.service_images for delete to authenticated using (public.is_admin());

revoke all on public.service_images from anon, authenticated;
grant select on public.service_images to anon;
grant select, insert, update, delete on public.service_images to authenticated;
