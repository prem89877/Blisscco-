-- 0001: extensions and enums
create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

do $$ begin
  create type public.user_role as enum ('customer', 'owner', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.business_status as enum
    ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'inactive');
exception when duplicate_object then null; end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.safe_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;
