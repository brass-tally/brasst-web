-- ============================================================
-- Nightly bank autorefresh — run once in: Supabase Dashboard → SQL Editor
--
-- Before this, "Sync now" was the ONLY way a bank connection ever synced —
-- there was no cron, no scheduled function, nothing. A bank could sit
-- unsynced indefinitely with no one noticing until they opened the app and
-- clicked the button themselves. This wires up pg_cron + pg_net to call the
-- plaid function's `cron_sync_all` action (see supabase/functions/plaid),
-- which loops every bank_connections row with the service role key.
--
-- pg_cron schedules run in UTC with no DST awareness, so a plain "13:00"
-- entry would drift an hour off "8am Eastern" for half the year. Instead
-- this runs once an hour and lets the request body's own clock check gate
-- the actual work, so it always fires within its hour of 8am America/New_York
-- regardless of EST/EDT.
-- ============================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Secrets read by the Edge Function itself (CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY)
-- live in the function's own env, set via:
--   supabase secrets set CRON_SECRET=<a random string> --project-ref <ref>
-- This table only needs to know the *same* secret, to attach it to the request.
-- It lives outside `public` so it's never exposed through PostgREST/the API.
create schema if not exists private;
create table if not exists private.cron_config (
  key text primary key,
  value text not null
);

-- Run:
--   insert into private.cron_config (key, value) values
--     ('project_url', 'https://<ref>.supabase.co'),
--     ('cron_secret', '<the same random string set as CRON_SECRET above>'),
--     -- The Edge Gateway rejects any request with no Authorization header
--     -- before it ever reaches our code, regardless of x-cron-secret. The
--     -- anon/publishable key already ships in the frontend bundle, so it
--     -- carries no new exposure here — x-cron-secret is still what actually
--     -- gates the cron_sync_all action inside the function.
--     ('anon_key', '<the project''s anon/publishable key, from src/lib/supabase.js>')
--   on conflict (key) do update set value = excluded.value;

select cron.unschedule('bank-autorefresh-hourly')
where exists (select 1 from cron.job where jobname = 'bank-autorefresh-hourly');

select cron.schedule(
  'bank-autorefresh-hourly',
  '5 * * * *', -- five past every hour, UTC
  $$
  select net.http_post(
    url := (select value from private.cron_config where key = 'project_url') || '/functions/v1/plaid',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select value from private.cron_config where key = 'anon_key'),
      'x-cron-secret', (select value from private.cron_config where key = 'cron_secret')
    ),
    -- Only actually syncs when it's 8am in America/New_York; every other
    -- hourly tick is a cheap no-op so the job still self-heals if one run
    -- is missed (a Supabase restart, a slow cold start) without needing a
    -- human to notice and re-trigger it.
    body := jsonb_build_object(
      'action', 'cron_sync_all',
      'only_if_hour_ny', 8
    )
  );
  $$
);
