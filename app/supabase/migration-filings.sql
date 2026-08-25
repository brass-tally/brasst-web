-- ============================================================
-- Filings tracker (T2 / T1) — run once in SQL Editor if missing
-- Live Ledger already has this table; keep for repo parity / fresh installs
-- ============================================================

create table if not exists public.filings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ledger_id uuid references public.ledgers (id) on delete cascade,
  tax_year integer not null,
  form text not null default 'T2',
  route text,
  software text,
  status text not null default 'draft',
  confirmation_number text,
  filed_on date,
  notes text,
  updated_at timestamptz not null default now(),
  unique (ledger_id, tax_year, form)
);

alter table public.filings enable row level security;

drop policy if exists "own filings" on public.filings;
create policy "own filings" on public.filings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
