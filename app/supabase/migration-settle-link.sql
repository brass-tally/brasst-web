-- Link a settled obligation to the transaction it created, so undo is precise.
alter table public.obligations add column if not exists settled_tx_id uuid;
