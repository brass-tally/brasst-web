-- ============================================================
-- Make the 7am bank refresh actually fire.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
--
-- 0018 scheduled the job and left its three configuration rows as an
-- instruction inside a comment. A missing row is silent: net.http_post with a
-- null url does nothing and reports nothing, so the job runs every hour,
-- succeeds every hour, and syncs nothing. The balance quietly goes a day old.
--
-- Fill in the two values below and run it. The first is fixed.
-- ============================================================

-- === EDIT THESE TWO ===
--   anon_key    : Project Settings -> API Keys -> anon / publishable
--   cron_secret : any long random string, and set the SAME value as
--                 CRON_SECRET in Edge Functions -> Secrets
insert into private.cron_config (key, value) values
  ('project_url', 'https://xwoccmgppjmgficvmogr.supabase.co'),
  ('anon_key',    'PASTE_YOUR_ANON_KEY'),
  ('cron_secret', 'PASTE_A_LONG_RANDOM_STRING')
on conflict (key) do update set value = excluded.value;

-- Did it take, and is the job alive?
select
  (select count(*) from private.cron_config
    where key in ('project_url','anon_key','cron_secret')
      and value not like 'PASTE%') as config_rows_set,
  (select count(*) from cron.job where jobname = 'bank-autorefresh-hourly' and active) as job_active,
  (select count(*) from cron.job_run_details d
     join cron.job j on j.jobid = d.jobid
    where j.jobname = 'bank-autorefresh-hourly'
      and d.start_time > now() - interval '24 hours') as runs_last_24h;

-- Every connection and how old it is, on every ledger.
select g.name as ledger, c.institution_name,
       to_char(c.last_synced_at, 'Mon DD HH24:MI') as last_synced,
       round(extract(epoch from (now() - c.last_synced_at)) / 3600)::int as hours_ago
from public.bank_connections c
join public.ledgers g on g.id = c.ledger_id
order by c.last_synced_at nulls first;
