-- ============================================================
-- Business costs paid on a personal card.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0073. Safe to run twice.
--
-- The software the company runs on is charged to the owner's personal card.
-- Those charges never reached the company's books, so its expenses were
-- understated and its deductions lost.
--
-- They are NOT payables to the vendor. Anthropic has been paid; raising a
-- payable to them would say the company still owes them, and paying it would
-- pay them twice. What happened is that the business incurred an expense and
-- the owner funded it, so:
--
--   the business records the expense, in the month it happened
--   the business owes the OWNER that amount (due to shareholder)
--   a reimbursement later clears what it owes the owner
--
-- This table remembers which personal charges have been filed, so a month is
-- never filed twice and nothing is filed without the owner pressing a button.
-- ============================================================

create table if not exists public.personal_paid_filings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- where the charge landed, and where the cost belongs
  from_ledger_id  uuid not null references public.ledgers (id) on delete cascade,
  to_ledger_id    uuid not null references public.ledgers (id) on delete cascade,

  payee_key       text not null,
  month           text not null,          -- 'YYYY-MM'
  amount          numeric not null,       -- the business share, after any split

  -- what it became on the business side
  transaction_id  uuid references public.transactions (id) on delete set null,
  obligation_id   uuid references public.obligations (id) on delete set null,

  filed_at        timestamptz not null default now(),
  unique (to_ledger_id, payee_key, month)
);

alter table public.personal_paid_filings enable row level security;

drop policy if exists "own filings" on public.personal_paid_filings;
create policy "own filings" on public.personal_paid_filings
  for all to authenticated
  using (public.owns_ledger(to_ledger_id) and public.owns_ledger(from_ledger_id))
  with check (public.owns_ledger(to_ledger_id) and public.owns_ledger(from_ledger_id));

create index if not exists personal_paid_by_target
  on public.personal_paid_filings (to_ledger_id, month);

/* What each tagged subscription charged, month by month, as the personal side
 * observed it. The business side needs per-month figures to file, and only
 * the personal side can see the charges, so the tag carries them across in
 * the same way 0073 carries the summary. */
alter table public.subscription_tags
  add column if not exists observed_months jsonb;

notify pgrst, 'reload schema';

select to_regclass('public.personal_paid_filings')::text as created;
