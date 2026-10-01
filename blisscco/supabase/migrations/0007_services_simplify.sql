-- 0007: services no longer need a separate name or a duration.
-- A service is now just: service (e.g. "Facial") + price. Old rows keep their data.
alter table public.services alter column name drop not null;
alter table public.services alter column duration_minutes drop not null;
