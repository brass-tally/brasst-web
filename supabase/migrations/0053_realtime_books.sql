-- ============================================================
-- Publish entries and obligations to realtime.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0048. Safe to run twice.
--
-- Realtime only sends changes for tables in the publication. A subscription to
-- a table that is not in it connects, waits, and never fires, which is worse
-- than not subscribing because it looks like it is working.
--
-- Row level security still applies, so a subscriber receives only rows they
-- could have selected. Adding a table here does not widen access.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['transactions', 'obligations'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
