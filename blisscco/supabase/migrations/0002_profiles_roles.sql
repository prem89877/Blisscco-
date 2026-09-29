-- 0002: profiles and roles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'customer',
  full_name text check (char_length(full_name) <= 120),
  phone text,
  phone_verified boolean not null default false,
  language text not null default 'en' check (language in ('en', 'hi', 'mr')),
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- New signups: only 'customer' or 'owner' can ever be chosen. 'admin' is NEVER assignable here.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role;
  v_lang text;
begin
  v_role := case new.raw_user_meta_data ->> 'signup_role'
              when 'owner' then 'owner'::public.user_role
              else 'customer'::public.user_role end;
  v_lang := case when new.raw_user_meta_data ->> 'language' in ('en', 'hi', 'mr')
                 then new.raw_user_meta_data ->> 'language' else 'en' end;
  insert into public.profiles (id, role, full_name, language)
  values (new.id, v_role, nullif(left(new.raw_user_meta_data ->> 'full_name', 120), ''), v_lang);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Phone verification status comes ONLY from Supabase Auth (never from the client).
create or replace function public.sync_profile_phone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
     set phone = nullif(new.phone, ''),
         phone_verified = (new.phone_confirmed_at is not null and coalesce(new.phone, '') <> '')
   where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_phone_changed on auth.users;
create trigger on_auth_user_phone_changed after update of phone, phone_confirmed_at on auth.users
  for each row execute function public.sync_profile_phone();

-- Role helpers (used by RLS policies everywhere)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin' and not p.is_suspended);
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'owner' and not p.is_suspended);
$$;

-- Defense in depth: API users can never change role / suspension / phone_verified.
create or replace function public.guard_profile_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role
       or new.is_suspended is distinct from old.is_suspended
       or new.phone_verified is distinct from old.phone_verified
       or new.id is distinct from old.id then
      raise exception 'protected profile fields cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- RLS
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_select_admin on public.profiles
  for select to authenticated using (public.is_admin());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, language) on public.profiles to authenticated;

-- Function privileges
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_profile_phone() from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_owner() to anon, authenticated;
