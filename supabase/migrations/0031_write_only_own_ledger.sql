-- ============================================================
-- A shared reader must not be able to write into your ledger.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0022. Safe to run twice.
--
-- THIS IS THE ONE THAT MATTERS. Everything before it was interface.
--
-- The owner policies from 0001 read:
--
--   for all using (auth.uid() = user_id) with check (auth.uid() = user_id)
--
-- They check who owns the ROW, not which ledger the row is in. When I added
-- read sharing in 0022 that became a hole: an accountant inserting into your
-- ledger writes a row carrying their own user_id and your ledger_id, and
-- `auth.uid() = user_id` is perfectly true. The write succeeds.
--
-- It was invisible because their own select filter hides those rows from you
-- and the shared read policy shows them to the reader. Two people looking at
-- one ledger and seeing different books.
--
-- Permissive policies OR together, so a stricter one alongside changes
-- nothing. This needs RESTRICTIVE policies, which AND with everything else.
-- They cover insert, update and delete only. Select is left alone, because
-- select is the thing sharing is for.
-- ============================================================

create or replace function public.owns_ledger(lid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.ledgers l where l.id = lid and l.user_id = auth.uid());
$$;

revoke all on function public.owns_ledger(uuid) from public;
grant execute on function public.owns_ledger(uuid) to authenticated;


/* Rows with no ledger.
   0007 backfilled ledger_id and never made the column NOT NULL, so a row that
   missed the backfill, or one written by an older client, can still be null.
   `owns_ledger(null)` is false, and a plain restrictive policy would lock the
   OWNER out of their own stale rows while fixing a problem for readers.

   So null is allowed through here and left to the permissive owner policy,
   which already requires auth.uid() = user_id. A shared reader cannot use it:
   a row with no ledger_id is in no ledger, so it appears in nobody's books and
   changes no figure. The hole this migration closes is writing into somebody
   else's ledger, and a null is not that. */

do $$
declare
  t text;
  tables text[] := array[
    'transactions', 'obligations', 'categories', 'credits',
    'balance_anchors', 'consolidations', 'filings', 'bank_transactions',
    'import_rules', 'contacts', 'invoice_links', 'inbound_invoices',
    'invoice_schedules', 'bank_connections'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, not present', t;
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'ledger_id'
    ) then
      raise notice 'skipping %, no ledger_id', t;
      continue;
    end if;

    -- Three, because a restrictive "for all" would apply its USING clause to
    -- select as well and lock a shared reader out of the books entirely.
    execute format('drop policy if exists "write own ledger insert" on public.%I', t);
    execute format(
      'create policy "write own ledger insert" on public.%I as restrictive for insert to authenticated with check (ledger_id is null or public.owns_ledger(ledger_id))', t);

    execute format('drop policy if exists "write own ledger update" on public.%I', t);
    execute format(
      'create policy "write own ledger update" on public.%I as restrictive for update to authenticated using (ledger_id is null or public.owns_ledger(ledger_id)) with check (ledger_id is null or public.owns_ledger(ledger_id))', t);

    execute format('drop policy if exists "write own ledger delete" on public.%I', t);
    execute format(
      'create policy "write own ledger delete" on public.%I as restrictive for delete to authenticated using (ledger_id is null or public.owns_ledger(ledger_id))', t);

    raise notice 'locked writes on %', t;
  end loop;
end $$;

/* The ledger row itself. A reader can see it because of the shared read
   policy; they must not be able to rename or delete it. */
drop policy if exists "write own ledger only" on public.ledgers;
create policy "write own ledger only" on public.ledgers
  as restrictive for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own ledger only" on public.ledgers;
create policy "delete own ledger only" on public.ledgers
  as restrictive for delete to authenticated
  using (user_id = auth.uid());

-- Confirm. Three restrictive write policies on each table that has a ledger.
select tablename, count(*) as restrictive_write_policies
from pg_policies
where schemaname = 'public'
  and permissive = 'RESTRICTIVE'
  and policyname like 'write own ledger%'
group by tablename
order by tablename;
