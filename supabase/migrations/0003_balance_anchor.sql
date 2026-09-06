-- ============================================================
-- Migration: balance anchor
-- Run this if you ALREADY created the database from an earlier
-- schema.sql (fresh installs don't need it — it's in the schema now).
-- Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

alter table public.settings
  add column if not exists anchor_date date not null default '1970-01-01';

-- The seed's $6,622.36 was your balance going into March 2026,
-- so anchor existing rows there (transactions after Feb 28 count):
update public.settings
  set anchor_date = '2026-02-28'
  where anchor_date = '1970-01-01';
