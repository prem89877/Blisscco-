-- 0003: categories, businesses, images, hours, services, terms, history, audit

-- ---------- Tables ----------
create table if not exists public.business_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name_en text not null check (char_length(name_en) between 2 and 80),
  name_hi text,
  name_mr text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger business_categories_updated_at before update on public.business_categories
  for each row execute function public.set_updated_at();

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  category_id uuid references public.business_categories(id),
  name text not null check (char_length(trim(name)) between 2 and 120),
  description text check (char_length(description) <= 2000),
  description_i18n jsonb not null default '{}'::jsonb check (jsonb_typeof(description_i18n) = 'object'),
  phone text check (phone ~ '^\+?[0-9]{10,13}$'),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  show_phone_publicly boolean not null default true,
  show_email_publicly boolean not null default false,
  address_line text check (char_length(address_line) <= 300),
  city text check (char_length(city) <= 80),
  state text check (char_length(state) <= 80),
  pincode text check (pincode ~ '^[0-9]{6}$'),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  location extensions.geography(Point, 4326),
  status public.business_status not null default 'draft',
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lat_lng_together check ((latitude is null) = (longitude is null))
);
create index if not exists businesses_owner_idx on public.businesses(owner_id);
create index if not exists businesses_status_idx on public.businesses(status);
create index if not exists businesses_category_idx on public.businesses(category_id);
create index if not exists businesses_location_gix on public.businesses using gist(location)
  where status = 'approved';
create index if not exists businesses_city_idx on public.businesses(state, city) where status = 'approved';

-- location is derived from lat/lng only (clients cannot write it)
create or replace function public.businesses_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.latitude is not null and new.longitude is not null then
    new.location := extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)::extensions.geography;
  else
    new.location := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger businesses_before_write before insert or update on public.businesses
  for each row execute function public.businesses_before_write();

create table if not exists public.business_images (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  storage_path text not null,
  is_cover boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint image_path_in_business_folder check (storage_path like business_id::text || '/%')
);
create index if not exists business_images_business_idx on public.business_images(business_id);
create unique index if not exists business_images_one_cover on public.business_images(business_id) where is_cover;

create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  unique (business_id, day_of_week),
  constraint hours_valid check (is_closed or (opens_at is not null and closes_at is not null and closes_at > opens_at))
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  name_i18n jsonb not null default '{}'::jsonb check (jsonb_typeof(name_i18n) = 'object'),
  service_category text not null check (char_length(trim(service_category)) between 2 and 60),
  description text check (char_length(description) <= 1000),
  price_inr numeric(10, 2) not null check (price_inr > 0 and price_inr <= 100000),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists services_business_idx on public.services(business_id) where is_active;
create trigger services_updated_at before update on public.services
  for each row execute function public.set_updated_at();

create table if not exists public.terms_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  body_md text not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists terms_one_current on public.terms_versions(is_current) where is_current;

create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  business_id uuid not null references public.businesses(id) on delete cascade,
  terms_version text not null references public.terms_versions(version),
  accepted_at timestamptz not null default now(),
  unique (user_id, business_id, terms_version)
);

create table if not exists public.business_status_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  from_status public.business_status,
  to_status public.business_status not null,
  reason text,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists bsh_business_idx on public.business_status_history(business_id, created_at desc);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_entity_idx on public.admin_audit_logs(entity_type, entity_id, created_at desc);

-- ---------- Access helpers ----------
create or replace function public.owns_business(p_business_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.businesses b
                   join public.profiles p on p.id = b.owner_id
                  where b.id = p_business_id and b.owner_id = auth.uid() and not p.is_suspended);
$$;

create or replace function public.business_is_editable(p_business_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.businesses b
                   join public.profiles p on p.id = b.owner_id
                  where b.id = p_business_id and b.owner_id = auth.uid() and not p.is_suspended
                    and b.status in ('draft', 'rejected'));
$$;

create or replace function public.business_is_public(p_business_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.businesses b where b.id = p_business_id and b.status = 'approved');
$$;

grant execute on function public.owns_business(uuid), public.business_is_editable(uuid),
  public.business_is_public(uuid) to anon, authenticated;

-- ---------- Internal audit writer (not callable by API clients) ----------
create or replace function public.write_audit_log(p_action text, p_entity_type text, p_entity_id uuid, p_details jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;
revoke execute on function public.write_audit_log(text, text, uuid, jsonb) from public, anon, authenticated;

-- ---------- RLS ----------
alter table public.business_categories enable row level security;
alter table public.businesses enable row level security;
alter table public.business_images enable row level security;
alter table public.business_hours enable row level security;
alter table public.services enable row level security;
alter table public.terms_versions enable row level security;
alter table public.terms_acceptances enable row level security;
alter table public.business_status_history enable row level security;
alter table public.admin_audit_logs enable row level security;

-- categories: public sees active; admin manages all
create policy cat_select on public.business_categories for select to anon, authenticated
  using (is_active or public.is_admin());
create policy cat_admin_write on public.business_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- businesses: NO public access to the base table (public uses the view below)
create policy biz_select_owner on public.businesses for select to authenticated using (owner_id = auth.uid());
create policy biz_select_admin on public.businesses for select to authenticated using (public.is_admin());
create policy biz_insert_owner on public.businesses for insert to authenticated
  with check (owner_id = auth.uid() and status = 'draft' and public.is_owner());
create policy biz_update_owner on public.businesses for update to authenticated
  using (owner_id = auth.uid() and status in ('draft', 'rejected') and public.is_owner())
  with check (owner_id = auth.uid() and status in ('draft', 'rejected'));
create policy biz_delete_owner on public.businesses for delete to authenticated
  using (owner_id = auth.uid() and status = 'draft');

-- images
create policy img_select on public.business_images for select to anon, authenticated
  using (public.business_is_public(business_id) or public.owns_business(business_id) or public.is_admin());
create policy img_write_owner on public.business_images for all to authenticated
  using (public.business_is_editable(business_id)) with check (public.business_is_editable(business_id));
create policy img_delete_admin on public.business_images for delete to authenticated using (public.is_admin());

-- hours
create policy hours_select on public.business_hours for select to anon, authenticated
  using (public.business_is_public(business_id) or public.owns_business(business_id) or public.is_admin());
create policy hours_write_owner on public.business_hours for all to authenticated
  using (public.owns_business(business_id)) with check (public.owns_business(business_id));

-- services (owners may manage while listing is live; suspended owners are blocked by owns_business)
create policy svc_select on public.services for select to anon, authenticated
  using ((is_active and public.business_is_public(business_id)) or public.owns_business(business_id) or public.is_admin());
create policy svc_write_owner on public.services for all to authenticated
  using (public.owns_business(business_id)) with check (public.owns_business(business_id));
create policy svc_write_admin on public.services for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- terms
create policy terms_select on public.terms_versions for select to anon, authenticated using (true);
create policy tacc_select on public.terms_acceptances for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- history & audit
create policy bsh_select on public.business_status_history for select to authenticated
  using (public.owns_business(business_id) or public.is_admin());
create policy audit_select_admin on public.admin_audit_logs for select to authenticated using (public.is_admin());

-- ---------- Table privileges (RLS is the gate, grants are the second lock) ----------
revoke all on public.business_categories, public.businesses, public.business_images, public.business_hours,
  public.services, public.terms_versions, public.terms_acceptances, public.business_status_history,
  public.admin_audit_logs from anon, authenticated;

grant select on public.business_categories, public.business_images, public.business_hours, public.services,
  public.terms_versions to anon;
grant select, insert, update, delete on public.business_categories to authenticated;
grant select, insert, update, delete on public.business_images, public.business_hours, public.services to authenticated;
grant select on public.terms_versions, public.terms_acceptances, public.business_status_history,
  public.admin_audit_logs to authenticated;

-- owners can only write "application" columns; status/review fields are function-only
grant select, delete on public.businesses to authenticated;
grant insert (owner_id, category_id, name, description, description_i18n, phone, email, show_phone_publicly,
  show_email_publicly, address_line, city, state, pincode, latitude, longitude) on public.businesses to authenticated;
grant update (category_id, name, description, description_i18n, phone, email, show_phone_publicly,
  show_email_publicly, address_line, city, state, pincode, latitude, longitude) on public.businesses to authenticated;

-- ---------- Public read model: only approved listings, no owner info, contact per settings ----------
create or replace view public.public_businesses with (security_invoker = false) as
select b.id, b.name, b.category_id, c.slug as category_slug, c.name_en as category_name_en,
       c.name_hi as category_name_hi, c.name_mr as category_name_mr,
       b.description, b.description_i18n, b.address_line, b.city, b.state, b.pincode,
       b.latitude, b.longitude,
       case when b.show_phone_publicly then b.phone end as phone,
       case when b.show_email_publicly then b.email end as email,
       b.created_at
  from public.businesses b
  join public.business_categories c on c.id = b.category_id
 where b.status = 'approved';
grant select on public.public_businesses to anon, authenticated;

-- ---------- Seed data ----------
insert into public.business_categories (slug, name_en, name_hi, name_mr, sort_order) values
  ('beauty-salon', 'Beauty salon', 'ब्यूटी सैलून', 'ब्युटी सलून', 1),
  ('beauty-parlour', 'Beauty parlour', 'ब्यूटी पार्लर', 'ब्युटी पार्लर', 2),
  ('hair-salon', 'Hair salon', 'हेयर सैलून', 'हेअर सलून', 3),
  ('tattoo-studio', 'Tattoo studio', 'टैटू स्टूडियो', 'टॅटू स्टुडिओ', 4),
  ('spa', 'Spa', 'स्पा', 'स्पा', 5),
  ('nail-studio', 'Nail art / nail studio', 'नेल आर्ट / नेल स्टूडियो', 'नेल आर्ट / नेल स्टुडिओ', 6),
  ('makeup-artist', 'Makeup artist', 'मेकअप आर्टिस्ट', 'मेकअप आर्टिस्ट', 7),
  ('bridal-services', 'Bridal services', 'ब्राइडल सर्विसेज', 'ब्रायडल सर्व्हिसेस', 8),
  ('other-beauty', 'Other beauty and personal-care services', 'अन्य ब्यूटी और पर्सनल केयर सेवाएँ', 'इतर ब्युटी व पर्सनल केअर सेवा', 99)
on conflict (slug) do nothing;

-- PLACEHOLDER terms: replace body_md with lawyer-reviewed text before launch.
insert into public.terms_versions (version, title, body_md, is_current)
values ('v1', 'Blisscco Business Listing Terms',
        'PLACEHOLDER - replace with reviewed Terms & Conditions before going live.', true)
on conflict (version) do nothing;
