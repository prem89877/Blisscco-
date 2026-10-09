-- 0035: Shop owner UPI ID (so admin can pay the owner once the promotional "Business Growth Credit" is fully used). Re-runnable.
-- Run AFTER 0030 (needs growth_credit_ledger), BEFORE deploying the new frontend.
-- The UPI ID is stored in its own table: only the owner themself and admins can read it; nobody can write it directly,
-- the owner saves it through set_my_upi_id() which validates the format.

create table if not exists public.owner_upi_ids (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  upi_id text not null check (upi_id ~ '^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,31}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists owner_upi_ids_updated_at on public.owner_upi_ids;
create trigger owner_upi_ids_updated_at before update on public.owner_upi_ids
  for each row execute function public.set_updated_at();

alter table public.owner_upi_ids enable row level security;
drop policy if exists owner_upi_select on public.owner_upi_ids;
create policy owner_upi_select on public.owner_upi_ids for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
revoke all on public.owner_upi_ids from anon, authenticated;
grant select on public.owner_upi_ids to authenticated;

-- Owner: read own UPI ID (null when not added)
create or replace function public.get_my_upi_id() returns text
language sql stable security definer set search_path = '' as $$
  select upi_id from public.owner_upi_ids where owner_id = auth.uid();
$$;

-- Owner: add / change own UPI ID
create or replace function public.set_my_upi_id(p_upi text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := lower(trim(coalesce(p_upi, '')));
begin
  if not public.is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  if v !~ '^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,31}$' then raise exception 'invalid_upi'; end if;
  insert into public.owner_upi_ids (owner_id, upi_id) values (auth.uid(), v)
  on conflict (owner_id) do update set upi_id = excluded.upi_id;
  return v;
end $$;

-- Owner: remove own UPI ID
create or replace function public.remove_my_upi_id() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  delete from public.owner_upi_ids where owner_id = auth.uid();
end $$;

-- Admin: every shop owner with UPI ID, current promotional balance and total credit ever earned.
-- "Credit used up" = earned > 0 and balance = 0 (that is when you pay the owner).
create or replace function public.admin_list_owner_upi(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (owner_id uuid, full_name text, email text, phone text, shops text, upi_id text, balance numeric, total_earned numeric, upi_updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_pat text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  v_pat := '%' || replace(replace(replace(left(trim(coalesce(p_search, '')), 60), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, p.full_name, u.email::text, p.phone,
         (select string_agg(b.name, ', ' order by b.name) from public.businesses b where b.owner_id = p.id),
         q.upi_id,
         coalesce((select sum(l.delta_inr) from public.growth_credit_ledger l where l.owner_id = p.id), 0)::numeric,
         coalesce((select sum(l.delta_inr) from public.growth_credit_ledger l where l.owner_id = p.id and l.delta_inr > 0), 0)::numeric,
         q.updated_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.owner_upi_ids q on q.owner_id = p.id
   where p.role = 'owner'
     and (coalesce(trim(p_search), '') = '' or u.email ilike v_pat or p.full_name ilike v_pat or p.phone ilike v_pat or q.upi_id ilike v_pat)
   order by (q.upi_id is not null) desc, q.updated_at desc nulls last, p.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

revoke execute on function public.get_my_upi_id(), public.set_my_upi_id(text), public.remove_my_upi_id(),
  public.admin_list_owner_upi(text, int, int) from public, anon, authenticated;
grant execute on function public.get_my_upi_id(), public.set_my_upi_id(text), public.remove_my_upi_id(),
  public.admin_list_owner_upi(text, int, int) to authenticated;
