-- Migration: inter-ledger transfers
alter table public.transactions add column if not exists transfer_id uuid;
alter table public.transactions add column if not exists pl_exclude boolean not null default false;
create index if not exists transactions_transfer_idx on public.transactions (transfer_id);
