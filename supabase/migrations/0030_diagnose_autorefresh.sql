-- ============================================================
-- Why is the bank two days stale?
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Read only. Changes nothing, reports on everything.
--
-- 0018 wired pg_cron to call the plaid function hourly, and the function
-- syncs only when it is 8am in America/New_York. That design is fine. The
-- parts that are not in the migration are the three config rows and the
-- function's own secret, and a missing one fails silently: net.http_post
-- with a null url does nothing and reports nothing.
--
-- Six checks. The first that says FAIL is the answer.
-- ============================================================

-- 1. Are the extensions there?
select '1. extensions' as check,
       coalesce(string_agg(extname, ', '), 'NONE') as found,
       case when count(*) = 2 then 'ok' else 'FAIL: run 0018' end as verdict
from pg_extension where extname in ('pg_cron', 'pg_net');

-- 2. Is the job scheduled, and active?
select '2. cron job' as check,
       coalesce(string_agg(jobname || ' at ' || schedule || case when active then '' else ' (INACTIVE)' end, ', '), 'NONE') as found,
       case when count(*) filter (where active) > 0 then 'ok' else 'FAIL: run 0018' end as verdict
from cron.job where jobname = 'bank-autorefresh-hourly';

-- 3. The three config rows. A missing one is the most likely cause, because
--    0018 leaves them as an instruction in a comment rather than inserting them.
select '3. cron_config' as check,
       coalesce(string_agg(key, ', ' order by key), 'NONE') as found,
       case when count(*) = 3 then 'ok'
            else 'FAIL: insert project_url, anon_key and cron_secret into private.cron_config' end as verdict
from private.cron_config where key in ('project_url', 'anon_key', 'cron_secret');

-- 4. Has it actually run, and what happened? The hourly ticks that are not
--    8am return quickly and count as success, so what matters is that rows
--    exist at all and none are failing.
select '4. recent runs' as check,
       coalesce(count(*)::text || ' in 24h, ' || count(*) filter (where status = 'succeeded')::text || ' ok', 'NONE') as found,
       case when count(*) = 0 then 'FAIL: the job has never fired, check 1 and 2'
            when count(*) filter (where status <> 'succeeded') > 0 then 'FAIL: see the errors below'
            else 'ok' end as verdict
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname = 'bank-autorefresh-hourly')
  and start_time > now() - interval '24 hours';

-- 5. Any error text from the last day.
select '5. errors' as check, coalesce(string_agg(distinct return_message, ' | '), 'none') as found, '' as verdict
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname = 'bank-autorefresh-hourly')
  and status <> 'succeeded' and start_time > now() - interval '24 hours';

-- 6. Every connection, on every ledger, including personal. This is the one
--    that answers "is it only my business ledger".
select '6. connections' as check,
       l.name || ' (' || l.kind || '): ' || c.institution_name ||
         ', last synced ' || coalesce(to_char(c.last_synced_at, 'Mon DD HH24:MI'), 'never') ||
         ', ' || round(extract(epoch from (now() - c.last_synced_at)) / 3600)::text || 'h ago' as found,
       case when c.last_synced_at > now() - interval '36 hours' then 'ok' else 'STALE' end as verdict
from public.bank_connections c
join public.ledgers l on l.id = c.ledger_id
order by c.last_synced_at nulls first;
