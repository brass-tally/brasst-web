-- ============================================================
-- Once a day, at seven Eastern.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0018. Safe to run twice.
--
-- Two things were wrong with the old job.
--
-- It fired at 8am Eastern, and everything else in the application treats 7am
-- as the start of the day: the chat thread rolls then, and a feed older than
-- that is judged stale and fetched by the app itself. So for one hour every
-- morning the app fetched, and the job repeated the work an hour later.
--
-- And it ticked every hour, twenty-four times a day, with the function
-- returning immediately on twenty-three of them. That was to sidestep pg_cron
-- having no daylight saving: a fixed UTC hour drifts by one for half the year.
--
-- Two ticks solve that just as well. Seven Eastern is 12:00 UTC in winter and
-- 11:00 UTC in summer, so the job runs at both and the hour check inside the
-- function lets exactly one of them through. Two calls a day rather than
-- twenty-four, and the name now says what it does.
-- ============================================================

select cron.unschedule('bank-autorefresh-hourly')
where exists (select 1 from cron.job where jobname = 'bank-autorefresh-hourly');

select cron.unschedule('bank-autorefresh-daily')
where exists (select 1 from cron.job where jobname = 'bank-autorefresh-daily');

select cron.schedule(
  'bank-autorefresh-daily',
  '0 11,12 * * *',                 -- 7am Eastern, whichever side of daylight saving
  $$
  select net.http_post(
    url := (select value from private.cron_config where key = 'project_url') || '/functions/v1/plaid',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select value from private.cron_config where key = 'anon_key'),
      'x-cron-secret', (select value from private.cron_config where key = 'cron_secret')
    ),
    -- The function returns immediately unless it is genuinely 7am in New York,
    -- so only one of the two ticks does any work.
    body := jsonb_build_object('action', 'cron_sync_all', 'only_if_hour_ny', 7)
  );
  $$
);

select jobname, schedule, active,
       (select max(start_time) from cron.job_run_details d where d.jobid = j.jobid) as last_run
from cron.job j
where jobname like 'bank-autorefresh%';
