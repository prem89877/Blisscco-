-- 0006: lets a signed-in CUSTOMER become a business OWNER (needed for "Continue with Google" as owner).
-- Only customer -> owner is possible. It can never produce 'admin'.
create or replace function public.become_owner()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.profiles set role = 'owner'
   where id = auth.uid() and role = 'customer' and not is_suspended;
end $$;

revoke execute on function public.become_owner() from public, anon, authenticated;
grant execute on function public.become_owner() to authenticated;
