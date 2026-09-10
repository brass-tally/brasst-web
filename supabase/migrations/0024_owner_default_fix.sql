-- ============================================================
-- Repair: owner_id needs a default.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Safe to run whether or not you already ran 0022, and safe to run twice.
--
-- Why this exists: 0022 was published with `owner_id uuid not null` and no
-- default, then changed to `default auth.uid()` so the browser would stop
-- asserting who owns a share. Anyone who ran the first version has a column
-- with no default while the app no longer sends the value, so every insert
-- fails on the not-null constraint.
--
-- `create table if not exists` does not alter an existing table, so re-running
-- 0022 fixes nothing. This does.
-- ============================================================

do $$
begin
  if to_regclass('public.ledger_shares') is not null then
    alter table public.ledger_shares alter column owner_id set default auth.uid();
  end if;

  if to_regclass('public.invoice_links') is not null then
    alter table public.invoice_links alter column owner_id set default auth.uid();
  end if;
end $$;

-- Confirm it took. Both rows should read auth.uid().
select table_name, column_name, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('ledger_shares', 'invoice_links')
  and column_name = 'owner_id';
