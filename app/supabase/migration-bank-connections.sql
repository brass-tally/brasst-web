-- ============================================================
-- Bank connections (Plaid) — run once in SQL Editor if missing
-- Live Ledger already has this table; keep for repo parity / fresh installs
-- ============================================================

create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ledger_id uuid references public.ledgers (id) on delete cascade,
  item_id text,
  access_token text,
  institution text,
  cursor text,
  last_synced timestamptz,
  current_balance numeric,
  balance_as_of timestamptz,
  accounts jsonb,
  created_at timestamptz not null default now()
);

alter table public.bank_connections enable row level security;

drop policy if exists "own bank connections" on public.bank_connections;
create policy "own bank connections" on public.bank_connections
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
