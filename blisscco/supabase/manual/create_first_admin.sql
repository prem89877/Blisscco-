-- Run MANUALLY in Supabase Dashboard > SQL Editor (runs as postgres, so the API guards don't block it).
-- Steps:
--   1. Sign up normally on the website with YOUR email and verify it.
--   2. Replace the email below and run this script.
--   3. Log out and log in again.
-- There is no API or UI path that can create an admin. Anyone else calling this from the app is blocked.

do $$
declare v_id uuid;
begin
  select id into v_id from auth.users
   where email = 'YOUR_EMAIL@example.com' and email_confirmed_at is not null;
  if v_id is null then
    raise exception 'user not found or email not verified';
  end if;

  update public.profiles set role = 'admin' where id = v_id;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, details)
  values (null, 'admin.bootstrap', 'profile', v_id, '{"via":"sql-editor"}');
end $$;

-- To remove admin rights later:
-- update public.profiles set role = 'customer' where id = '<user uuid>';
