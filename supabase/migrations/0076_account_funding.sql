-- ============================================================
-- Who puts the money into an account.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0075. Safe to run twice.
--
-- A card kept only for business costs, like the Wise card, lives on the
-- business ledger. Money spent from it is a business expense. Money paid INTO
-- it is not income, and treating it as income would overstate revenue by every
-- dollar ever moved onto the card.
--
-- What it is instead depends on whose money it was:
--
--   own      the account's money is the company's own, as with any normal
--            business account. Money in is what it says it is.
--   owner    the owner tops it up personally. Money in is the owner funding
--            the company: a shareholder loan, never income.
--   company  the company tops it up from another of its accounts. Money in is
--            a transfer between the company's own accounts, never income.
--
-- Both of the last two are recorded with pl_exclude, the mechanism transfers
-- between ledgers already use, so the P&L and the tax pack leave them out.
-- ============================================================

/* Self-contained, so it works whether or not 0075 has run.
 *
 * The first version read `source`, which 0075 adds, in its closing check. Run
 * before 0075, the whole script failed on that one line, and because the SQL
 * editor runs a script as one transaction, the funding column it had just
 * added was rolled back with it. A migration that only works in a particular
 * order is a migration somebody will run out of order. */
alter table public.bank_connections
  add column if not exists source text not null default 'plaid';

alter table public.bank_connections
  add column if not exists funding text not null default 'own';

alter table public.bank_connections
  drop constraint if exists bank_connections_funding_check;
alter table public.bank_connections
  add constraint bank_connections_funding_check check (funding in ('own', 'owner', 'company'));

notify pgrst, 'reload schema';

select institution, funding from public.bank_connections order by created_at;
