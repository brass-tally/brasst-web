-- ============================================================
-- Statements imported from a file, for accounts Plaid cannot reach.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0074. Safe to run twice.
--
-- The case that prompted it is a Wise card. In Canada it is prepaid and spends
-- from the Wise balance, so the RBC feed only ever sees money going INTO Wise,
-- never what the card paid for. Every subscription on it was invisible.
--
-- Imported lines go into bank_transactions, the same table as Plaid's, under a
-- connection marked as an import. So subscription detection, matching, the
-- spend graph and reconciliation all work on them with no special case: a
-- line is a line, whichever way it arrived.
--
-- Checked before writing: bank_connections.item_id and access_token are both
-- nullable, and bank_transactions has unique (connection_id, plaid_txn_id),
-- which is what makes importing the same statement twice change nothing.
-- ============================================================

alter table public.bank_connections
  add column if not exists source text not null default 'plaid';

alter table public.bank_connections
  drop constraint if exists bank_connections_source_check;
alter table public.bank_connections
  add constraint bank_connections_source_check check (source in ('plaid', 'import'));

/* When a statement was last imported, and how much it brought in, so the
   connection can say "last statement imported 3 weeks ago" rather than
   pretending to be live. */
alter table public.bank_connections
  add column if not exists last_import_at timestamptz,
  add column if not exists last_import_lines integer;

notify pgrst, 'reload schema';

select source, count(*) from public.bank_connections group by source;
