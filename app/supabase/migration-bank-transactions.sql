-- ============================================================
-- Bank transactions — the durable record of every line Plaid sends us,
-- and the link from a bank line to the ledger entry that accounts for it.
-- Run once in: Supabase Dashboard → SQL Editor → New query
--
-- Why this table exists: /transactions/sync is cursor-based and one-shot.
-- Before this, sync advanced the cursor and handed the rows straight to a
-- review modal — closing that modal lost them permanently. Now every line is
-- stored first and the cursor moves last, so nothing is ever only in memory.
-- ============================================================

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ledger_id uuid references public.ledgers (id) on delete cascade,
  connection_id uuid references public.bank_connections (id) on delete cascade,

  -- Plaid's own id. Unique per connection, and the reason a replayed sync is
  -- idempotent rather than duplicating everything.
  plaid_txn_id text not null,
  account_id text,

  date date not null,
  amount numeric not null,                     -- always positive; direction carries the sign
  direction text not null check (direction in ('debit', 'credit')),
  description text not null default '',
  pending boolean not null default false,

  -- reconciliation state
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'ignored')),
  matched_tx_id uuid references public.transactions (id) on delete set null,
  matched_at timestamptz,
  match_source text,                           -- 'auto' | 'manual' | 'created'
  review_reason text,                          -- set when the bank changes or reverses a line we'd settled
  removed_at timestamptz,                      -- Plaid withdrew this line (reversal, or a pending that never posted)

  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (connection_id, plaid_txn_id)
);

create index if not exists bank_transactions_ledger_idx
  on public.bank_transactions (ledger_id, status, date desc);
create index if not exists bank_transactions_matched_idx
  on public.bank_transactions (matched_tx_id);

-- Deleting the ledger entry dissolves the match (on delete set null above).
-- This keeps status honest when that happens, so a row can never read
-- "matched" while pointing at nothing.
create or replace function public.bank_txn_unmatch_on_null()
returns trigger language plpgsql as $$
begin
  if new.matched_tx_id is null and new.status = 'matched' then
    new.status := 'unmatched';
    new.matched_at := null;
    new.match_source := null;
  end if;
  return new;
end $$;

drop trigger if exists bank_txn_unmatch_guard on public.bank_transactions;
create trigger bank_txn_unmatch_guard
  before update on public.bank_transactions
  for each row execute function public.bank_txn_unmatch_on_null();

alter table public.bank_transactions enable row level security;

drop policy if exists "own bank transactions" on public.bank_transactions;
create policy "own bank transactions" on public.bank_transactions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
