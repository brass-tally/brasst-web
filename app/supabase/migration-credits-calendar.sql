-- ============================================================
-- Migration: credits, AR/AP categories, frequency, pay method
-- Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

create table if not exists public.credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  initial numeric not null default 0,
  created_at timestamptz not null default now()
);
alter table public.credits enable row level security;
create policy "own credits" on public.credits
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.obligations add column if not exists category text;
alter table public.obligations add column if not exists subcategory text;
alter table public.obligations add column if not exists frequency text;
alter table public.obligations add column if not exists pay_method text not null default 'cash';
alter table public.obligations add column if not exists credit_id uuid;

alter table public.transactions add column if not exists pay_method text not null default 'cash';
alter table public.transactions add column if not exists credit_id uuid;
