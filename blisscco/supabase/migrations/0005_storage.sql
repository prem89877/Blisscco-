-- 0005: storage for business images
-- Private bucket. Path convention: {business_id}/{random-uuid}.{jpg|png|webp}
-- Unapproved images are visible only to the owner and admin. Approved-business images are
-- readable by anyone (via signed URLs created with the anon key).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-images', 'business-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "bizimg_select" on storage.objects;
drop policy if exists "bizimg_insert" on storage.objects;
drop policy if exists "bizimg_update" on storage.objects;
drop policy if exists "bizimg_delete" on storage.objects;

create policy "bizimg_select" on storage.objects for select to anon, authenticated
using (
  bucket_id = 'business-images' and (
    public.business_is_public(public.safe_uuid((storage.foldername(name))[1]))
    or public.owns_business(public.safe_uuid((storage.foldername(name))[1]))
    or public.is_admin()
  )
);

create policy "bizimg_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'business-images'
  and array_length(storage.foldername(name), 1) = 1
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  and public.business_is_editable(public.safe_uuid((storage.foldername(name))[1]))
);

create policy "bizimg_update" on storage.objects for update to authenticated
using (bucket_id = 'business-images'
       and public.business_is_editable(public.safe_uuid((storage.foldername(name))[1])))
with check (bucket_id = 'business-images'
       and public.business_is_editable(public.safe_uuid((storage.foldername(name))[1])));

create policy "bizimg_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'business-images' and (
    public.business_is_editable(public.safe_uuid((storage.foldername(name))[1])) or public.is_admin()
  )
);
