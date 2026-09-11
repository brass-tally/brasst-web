-- ============================================================
-- Contacts: the people and businesses a ledger deals with.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Safe to run twice.
--
-- Every party name and email in this app has been free text typed again each
-- time, which is how one contractor becomes "Acme", "Acme Contracting" and
-- "acme contracting inc" across three screens and stops grouping.
-- ============================================================

create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  ledger_id   uuid not null references public.ledgers(id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  role        text not null default 'vendor'
              check (role in ('contractor', 'employee', 'vendor', 'client', 'accountant')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.contacts enable row level security;

drop policy if exists "own contacts" on public.contacts;
create policy "own contacts" on public.contacts
  for all to authenticated
  using (exists (select 1 from public.ledgers l where l.id = ledger_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.ledgers l where l.id = ledger_id and l.user_id = auth.uid()));

-- An accountant reading a shared ledger should see who it deals with.
drop policy if exists "shared read" on public.contacts;
create policy "shared read" on public.contacts
  for select to authenticated using (public.can_read_ledger(ledger_id));

/* One entry per name per ledger. Case and spacing folded, because "Acme
   Contracting" and "acme  contracting" are the same supplier and letting both
   exist defeats the point of having a list at all. */
create unique index if not exists contacts_unique_name
  on public.contacts (ledger_id, lower(regexp_replace(name, '\s+', ' ', 'g')));

create index if not exists contacts_role_idx on public.contacts (ledger_id, role, name);

select count(*) as contacts_ready from public.contacts;
