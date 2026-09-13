-- ============================================================
-- Let the open app hear about new bank lines.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Safe to run twice.
--
-- Realtime only publishes tables that have been added to the publication.
-- Without this the subscription connects, waits, and never fires, which is
-- worse than not subscribing because it looks like it is working.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'bank_transactions'
  ) then
    alter publication supabase_realtime add table public.bank_transactions;
  end if;
end $$;

/* Row level security still applies to realtime, so a subscriber receives only
   the rows they could have selected. Adding the table does not widen access. */
alter table public.bank_transactions replica identity full;

select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
