-- ============================================================
-- Consolidations — the durable record of every reconciliation run:
-- when it happened, what it matched, what it created, and what
-- duplicates it removed.
-- Run once in: Supabase Dashboard → SQL Editor → New query
--
-- Why this table exists: matching a bank line to a ledger entry explains the
-- gap but doesn't close it, so "bank and books disagree" stayed true forever
-- and the app asked for the same reconciliation on every ledger switch. A run
-- now stores the fingerprint of what was open when it finished (`signature`),
-- and the app only asks again when that fingerprint changes — i.e. when the
-- bank or the books actually moved.
-- ============================================================

create table if not exists public.consolidations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ledger_id uuid references public.ledgers (id) on delete cascade,
  created_at timestamptz not null default now(),

  -- 'reconcile' = lines were matched/created/ignored
  -- 'reviewed'  = looked at, nothing needed changing
  -- 'import'    = a statement was folded into the books
  kind text not null default 'reconcile' check (kind in ('reconcile', 'reviewed', 'import')),

  -- fingerprint of everything still open at the end of the run; null for runs
  -- that don't settle anything (imports)
  signature text,

  delta_before numeric,
  delta_after numeric,
  unexplained_before numeric,
  unexplained_after numeric,

  matched_count integer not null default 0,
  created_count integer not null default 0,
  ignored_count integer not null default 0,
  unmatched_count integer not null default 0,
  duplicates_removed integer not null default 0,
  duplicate_amount numeric not null default 0,

  -- what was still open when the run finished
  open_bank integer not null default 0,
  open_books integer not null default 0,

  -- one row per thing the run did: { at, kind, amount, description, detail }
  items jsonb not null default '[]'::jsonb,
  note text
);

create index if not exists consolidations_ledger_idx
  on public.consolidations (ledger_id, created_at desc);

alter table public.consolidations enable row level security;

drop policy if exists "own consolidations" on public.consolidations;
create policy "own consolidations" on public.consolidations
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
