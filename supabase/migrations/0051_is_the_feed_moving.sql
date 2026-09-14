-- ============================================================
-- Is the feed moving, and is anything wired to move it?
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Read only. One statement, so the editor shows the whole answer.
-- ============================================================

select
  g.name                                                        as ledger,
  max(b.date)                                                   as newest_line,
  current_date - max(b.date)                                    as days_behind,
  max(c.last_synced)                                            as last_synced,
  -- `first_seen` is when we first received the line, which is exactly the
  -- question: did today's sync bring anything in. There is no created_at.
  count(b.id) filter (where b.first_seen > now() - interval '24 hours') as rows_added_today,
  (select count(*) from cron.job j
    where j.jobname like 'bank-autorefresh%' and j.active)      as job_active,
  (select count(*) from cron.job_run_details d
     join cron.job j on j.jobid = d.jobid
    where j.jobname like 'bank-autorefresh%'
      and d.start_time > now() - interval '48 hours')           as job_ran_48h,
  (select count(*) from private.cron_config
    where value not like 'PASTE%')                              as config_rows
from public.ledgers g
left join public.bank_connections  c on c.ledger_id = g.id
left join public.bank_transactions b on b.ledger_id = g.id
group by g.name
order by g.name;
