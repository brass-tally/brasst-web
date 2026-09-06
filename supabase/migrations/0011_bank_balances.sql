-- ============================================================
-- Bank balances on Plaid connections — run once in SQL Editor
-- ============================================================

alter table public.bank_connections
  add column if not exists current_balance numeric,
  add column if not exists balance_as_of timestamptz,
  add column if not exists accounts jsonb;
