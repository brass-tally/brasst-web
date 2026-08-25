-- ============================================================
-- Bank connection health + one-Item-per-ledger guard
-- Run once in: Supabase Dashboard -> SQL Editor -> New query
--
-- Two problems this fixes.
--
-- 1. A broken Plaid Item left no trace. bank_connections had nowhere to record
--    that the bank had dropped the sign-in, so the only symptom was last_synced
--    quietly refusing to move -- invisible unless someone read the table.
--
-- 2. There was no way to repair an Item in place, so the only route back was
--    to link the bank again. That INSERTed a second row, and because
--    sumBankBalance() adds current_balance across every row the ledger balance
--    then double-counts, while bank_transactions dedupes on
--    (connection_id, plaid_txn_id) -- so a new connection_id re-imports the
--    entire history as fresh unmatched lines.
-- ============================================================

alter table public.bank_connections
  add column if not exists status      text not null default 'ok',
  add column if not exists status_code text,          -- raw Plaid error_code
  add column if not exists status_error text,         -- raw Plaid error_message
  add column if not exists status_at   timestamptz;   -- when status was last confirmed

-- 'ok'             — syncing normally
-- 'login_required' — needs the user to sign in again via Link update mode
-- 'error'          — some other Plaid error; status_code carries the detail
alter table public.bank_connections
  drop constraint if exists bank_connections_status_check;
alter table public.bank_connections
  add constraint bank_connections_status_check
  check (status in ('ok', 'login_required', 'error'));

-- One Plaid Item per ledger. This is what makes reconnecting repair the
-- existing row instead of adding a rival one.
--
-- Check for duplicates BEFORE running this -- the index creation fails if any
-- exist, and the right cleanup depends on which row holds the reconciled work:
--
--   select ledger_id, item_id, count(*)
--   from public.bank_connections
--   where item_id is not null
--   group by ledger_id, item_id
--   having count(*) > 1;
create unique index if not exists bank_connections_ledger_item_uniq
  on public.bank_connections (ledger_id, item_id)
  where item_id is not null;
