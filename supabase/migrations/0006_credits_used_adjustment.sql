-- Migration: track credits used outside the app
alter table public.credits add column if not exists used_adjustment numeric not null default 0;
