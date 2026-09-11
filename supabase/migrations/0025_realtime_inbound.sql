-- ============================================================
-- Push invoice arrivals to the app instead of making it ask.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0022.
--
-- Realtime only sends changes for tables in the supabase_realtime
-- publication, and no table is in it by default. The app subscribes either
-- way and falls back to polling, so without this nothing breaks, it is just
-- up to forty five seconds slower.
-- ============================================================

do $$
begin
  if to_regclass('public.inbound_invoices') is null then
    raise notice 'inbound_invoices is missing, run 0022 first';
    return;
  end if;

  -- Adding a table twice is an error rather than a no-op, so check.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'inbound_invoices'
  ) then
    alter publication supabase_realtime add table public.inbound_invoices;
    raise notice 'inbound_invoices added to realtime';
  else
    raise notice 'inbound_invoices was already in realtime';
  end if;
end $$;

/* Row level security still applies to what is pushed.
   A subscriber is only sent changes to rows they could have selected, so the
   owner policy on inbound_invoices does the same job here that it does for a
   query. A shared reader gets nothing from this table, which is correct: they
   cannot accept an invoice, so being told one arrived would only be noise. */

-- Confirm it took.
select tablename, 'in realtime' as state
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbound_invoices';
