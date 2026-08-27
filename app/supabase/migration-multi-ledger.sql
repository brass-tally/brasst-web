-- ============================================================
-- Migration: multi-ledger (REQUIRED before deploying this version)
-- Creates the ledgers table, adds ledger_id to every data table,
-- and moves your existing data into a "GENIE AI" ledger.
-- Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

create table if not exists public.ledgers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'business' check (kind in ('business', 'personal')),
  currency text not null default 'CAD',
  starting_balance numeric not null default 0,
  anchor_date date not null default '1970-01-01',
  fye text not null default '12-31',
  created_at timestamptz not null default now()
);
alter table public.ledgers enable row level security;
create policy "own ledgers" on public.ledgers
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.categories       add column if not exists ledger_id uuid references public.ledgers (id) on delete cascade;
alter table public.transactions     add column if not exists ledger_id uuid references public.ledgers (id) on delete cascade;
alter table public.obligations      add column if not exists ledger_id uuid references public.ledgers (id) on delete cascade;
alter table public.credits          add column if not exists ledger_id uuid references public.ledgers (id) on delete cascade;
alter table public.balance_anchors  add column if not exists ledger_id uuid references public.ledgers (id) on delete cascade;

-- categories were unique per user; now unique per ledger
alter table public.categories drop constraint if exists categories_user_id_type_name_key;

-- ---- backfill: one ledger per existing user, carrying their balance anchor ----
insert into public.ledgers (user_id, name, kind, starting_balance, anchor_date)
select s.user_id, 'GENIE AI', 'business', s.starting_balance, s.anchor_date
from public.settings s
where not exists (select 1 from public.ledgers l where l.user_id = s.user_id);

update public.categories      t set ledger_id = l.id from public.ledgers l where t.user_id = l.user_id and t.ledger_id is null;
update public.transactions    t set ledger_id = l.id from public.ledgers l where t.user_id = l.user_id and t.ledger_id is null;
update public.obligations     t set ledger_id = l.id from public.ledgers l where t.user_id = l.user_id and t.ledger_id is null;
update public.credits         t set ledger_id = l.id from public.ledgers l where t.user_id = l.user_id and t.ledger_id is null;
update public.balance_anchors t set ledger_id = l.id from public.ledgers l where t.user_id = l.user_id and t.ledger_id is null;

create index if not exists transactions_ledger_idx on public.transactions (ledger_id, date desc);
create index if not exists obligations_ledger_idx  on public.obligations (ledger_id, kind, status);
create index if not exists categories_ledger_idx   on public.categories (ledger_id);
