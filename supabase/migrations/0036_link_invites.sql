-- ============================================================
-- Who holds your intake link.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0022. Safe to run twice.
--
-- The panel said "6 received" and nothing about who was invited. A link that
-- has been handed to six people and one of them is a contractor you no longer
-- work with is a link you cannot reason about, because there is no record of
-- who was sent it.
-- ============================================================

create table if not exists public.invoice_link_invites (
  id        uuid primary key default gen_random_uuid(),
  link_id   uuid not null references public.invoice_links(id) on delete cascade,
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  email     text not null,
  note      text,
  sent_at   timestamptz not null default now()
);

alter table public.invoice_link_invites enable row level security;

drop policy if exists "own link invites" on public.invoice_link_invites;
create policy "own link invites" on public.invoice_link_invites
  for all to authenticated
  using (public.owns_ledger(ledger_id))
  with check (public.owns_ledger(ledger_id));

create index if not exists link_invites_by_link
  on public.invoice_link_invites (link_id, sent_at desc);

/* The edge function writes these with the service role, which bypasses the
   policy above. The policy is what lets the owner read and delete them. */

select 'invoice_link_invites' as object, to_regclass('public.invoice_link_invites')::text as present;
