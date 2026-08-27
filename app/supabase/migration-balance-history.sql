-- ============================================================
-- Migration: balance anchor history
-- For databases created before this feature.
-- Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

create table if not exists public.balance_anchors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount numeric not null,
  anchor_date date not null,
  source text not null default 'manual' check (source in ('manual', 'statement')),
  created_at timestamptz not null default now()
);
create index if not exists balance_anchors_user_idx on public.balance_anchors (user_id, created_at desc);

alter table public.balance_anchors enable row level security;
create policy "own balance anchors" on public.balance_anchors
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
