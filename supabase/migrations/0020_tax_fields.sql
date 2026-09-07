-- ============================================================
-- Tax fields on transactions.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
--
-- Stores only what cannot be derived. The GIFI line and the deductible
-- percentage are computed from the category at report time, because a code
-- frozen onto a row goes stale the moment the entry is recategorised and then
-- the statement and the ledger disagree with no way to tell which is right.
--
-- What has to be stored is what is printed on the receipt and what the user
-- decided:
--
--   tax_amount  the GST/HST actually charged. Reading it beats computing it:
--               mixed-rate baskets, zero-rated groceries and rounding all make
--               the arithmetic version approximate.
--   tax_code    which regime applied, so the recoverable share is known. In BC
--               and Saskatchewan the provincial portion is not recoverable, so
--               a single "tax paid" figure is not enough to claim a credit.
--   capital     the user's decision to capitalise. Only they know the useful
--               life, and the threshold is a policy, not a fact.
-- ============================================================

alter table public.transactions
  add column if not exists tax_amount numeric,
  add column if not exists tax_code   text,
  add column if not exists capital    boolean not null default false;

alter table public.transactions
  drop constraint if exists transactions_tax_code_check;
alter table public.transactions
  add constraint transactions_tax_code_check
  check (tax_code is null or tax_code in ('hst13','hst15','gst5','gstpst','gstqst','zero','exempt','none'));

-- The same three on obligations, so an invoice carries its tax through settling
-- rather than losing it at the moment it becomes a transaction.
alter table public.obligations
  add column if not exists tax_amount numeric,
  add column if not exists tax_code   text,
  add column if not exists capital    boolean not null default false;

alter table public.obligations
  drop constraint if exists obligations_tax_code_check;
alter table public.obligations
  add constraint obligations_tax_code_check
  check (tax_code is null or tax_code in ('hst13','hst15','gst5','gstpst','gstqst','zero','exempt','none'));

-- The summary reads a year at a time, filtered to entries with tax recorded.
create index if not exists transactions_tax_idx
  on public.transactions (ledger_id, date desc)
  where tax_amount is not null;

-- Your capitalisation policy, written down once. CRA sets no threshold; what
-- matters is that you adopt one and apply it consistently, and that the number
-- lives somewhere an auditor can be shown.
alter table public.ledgers
  add column if not exists capital_threshold numeric not null default 500,
  add column if not exists gst_registered boolean not null default false,
  add column if not exists province text;
