-- Phase 10: tell the database where the Vercel dispatcher lives. Run ONCE by hand in the Supabase SQL Editor
-- (after migration 0013). This is NOT a migration: it holds a secret, so it is never committed with real values.
--
-- 1) Replace YOUR-SITE with your Vercel domain.
-- 2) Replace the secret with a long random string. The SAME string must be set in Vercel as NOTIFY_CRON_SECRET.
--    (generate one: `openssl rand -hex 32`)

insert into public.notification_config (key, value) values
  ('dispatch_url', 'https://YOUR-SITE.vercel.app/api/dispatch-notifications'),
  ('cron_secret',  'PASTE-A-LONG-RANDOM-STRING-HERE')
on conflict (key) do update set value = excluded.value;

-- Check that pg_net can reach the route (should print a number; then look at the response below):
--   select net.http_post(
--     url := (select value from public.notification_config where key = 'dispatch_url'),
--     headers := jsonb_build_object('Content-Type', 'application/json',
--                'Authorization', 'Bearer ' || (select value from public.notification_config where key = 'cron_secret')),
--     body := '{}'::jsonb);
--   select id, status_code, content from net._http_response order by created desc limit 5;   -- 200 = working, 401 = secret mismatch
