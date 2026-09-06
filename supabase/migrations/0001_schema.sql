-- ============================================================
-- The Ledger — Supabase schema
-- Run this once in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ---------- tables ----------

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  starting_balance numeric not null default 0,  -- the balance at the anchor date below
  anchor_date date not null default '1970-01-01', -- "balance was starting_balance as of this date"; transactions on/before it don't count toward balance
  currency text not null default 'CAD',
  theme text not null default 'dark'
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  name text not null,
  planned numeric not null default 0,
  account text not null default 'personal',
  subcategories text[] not null default '{}',
  sort integer not null default 0,
  unique (user_id, type, name)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  amount numeric not null,
  type text not null check (type in ('expense', 'income')),
  category text not null,
  description text not null default '',
  account text not null default 'business',
  recurrence text not null default 'once' check (recurrence in ('once', 'recurring')),
  subcategory text,
  pay_method text not null default 'cash',
  credit_id uuid,
  attachment_path text,
  attachment_name text,
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);

-- receivables + payables live in one table, distinguished by "kind"
create table if not exists public.obligations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('receivable', 'payable')),
  party text not null,
  description text not null default '',
  amount numeric not null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'paid')),
  settled_on date,
  settled_tx_id uuid,
  account text not null default 'business',
  recurrence text not null default 'once' check (recurrence in ('once', 'recurring')),
  category text,
  subcategory text,
  frequency text,
  pay_method text not null default 'cash',
  credit_id uuid,
  attachment_path text,
  attachment_name text,
  created_at timestamptz not null default now()
);
create index if not exists obligations_user_kind_idx on public.obligations (user_id, kind, status);

-- non-cash credit pools (AWS credits, compute credits, SR&ED, etc.)
create table if not exists public.credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  initial numeric not null default 0,
  used_adjustment numeric not null default 0, -- credits burned before/outside the app
  created_at timestamptz not null default now()
);

-- every time the balance is anchored (manual fix or statement import), log it
create table if not exists public.balance_anchors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount numeric not null,
  anchor_date date not null,
  source text not null default 'manual' check (source in ('manual', 'statement')),
  created_at timestamptz not null default now()
);
create index if not exists balance_anchors_user_idx on public.balance_anchors (user_id, created_at desc);

-- ---------- row level security: each user sees only their own rows ----------

alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.obligations enable row level security;

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own obligations" on public.obligations;
create policy "own obligations" on public.obligations
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter table public.credits enable row level security;
drop policy if exists "own credits" on public.credits;
create policy "own credits" on public.credits
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter table public.balance_anchors enable row level security;
drop policy if exists "own balance anchors" on public.balance_anchors;
create policy "own balance anchors" on public.balance_anchors
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- private storage bucket for receipts & invoice PDFs ----------

insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
  on conflict (id) do nothing;

-- files are stored under <user-id>/<filename>; users can only touch their own folder
drop policy if exists "own invoice files" on storage.objects;
create policy "own invoice files" on storage.objects
  for all to authenticated
  using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);
