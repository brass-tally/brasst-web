-- ============================================================
-- Why PostgREST cannot see import_rules.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Safe to run twice. Grants nothing that other tables do not already have.
--
-- "Could not find the table in the schema cache" has three causes and they
-- need different answers:
--
--   the table does not exist
--   it exists and the API role cannot touch it, so PostgREST hides it
--   it exists, the role can touch it, and the cache predates it
--
-- This reports the first two, fixes the second, and then asks for a reload,
-- which handles the third. Run it and reload the app.
-- ============================================================

-- What is actually true right now.
select
  to_regclass('public.import_rules') is not null                   as table_exists,
  (select relrowsecurity from pg_class
    where oid = to_regclass('public.import_rules'))                as rls_on,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'import_rules')    as policies,
  has_table_privilege('authenticated', 'public.import_rules', 'SELECT') as authenticated_can_read,
  has_table_privilege('anon', 'public.import_rules', 'SELECT')        as anon_can_read;

-- Grant it the same way Supabase grants everything else by default, but only
-- if the table is there. The first version ran the grant unconditionally, so
-- a missing table produced "relation does not exist" and the report above,
-- which was the point of the file, never reached the screen.
do $$
begin
  if to_regclass('public.import_rules') is not null then
    grant select, insert, update, delete on public.import_rules to authenticated;
    grant select on public.import_rules to anon;
    raise notice 'granted';
  else
    raise notice 'public.import_rules does not exist. Run 0021_import_rules.sql first.';
  end if;
end $$;

-- And rebuild the cache. PostgREST keeps an in-memory picture of the schema
-- and builds its endpoints from it: a table created after that picture was
-- taken is real, queryable in SQL, and invisible over the API until this runs.
notify pgrst, 'reload schema';

select
  to_regclass('public.import_rules') is not null as table_exists_now,
  'reload requested' as cache;
