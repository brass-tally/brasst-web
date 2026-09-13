-- ============================================================
-- Every invitation is its own thing, with its own reference.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0036. Safe to run twice.
--
-- Inviting the same person twice reused their existing link, so two requests
-- for two different pieces of work shared one address and one history. There
-- was no way to say which invitation an arriving invoice answered, and
-- revoking one revoked both.
--
-- A reference per invitation, readable, per ledger, so it can be quoted in an
-- email and recognised on an invoice.
-- ============================================================

alter table public.invoice_link_invites
  add column if not exists reference text;

/* Per ledger, not global. Two businesses both starting at REQ-001 is correct;
   a reference that depends on somebody else's activity is not. */
create or replace function public.next_invite_reference(p_ledger uuid)
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'REQ-' || lpad((
    coalesce(max(nullif(regexp_replace(coalesce(reference, ''), '\D', '', 'g'), '')::int), 0) + 1
  )::text, 3, '0')
  from public.invoice_link_invites
  where ledger_id = p_ledger;
$$;

revoke all on function public.next_invite_reference(uuid) from public;
grant execute on function public.next_invite_reference(uuid) to authenticated, service_role;

/* Anything sent before this gets one, oldest first, so the history reads in
   the order things happened rather than in the order they were backfilled. */
with numbered as (
  select id, ledger_id,
         row_number() over (partition by ledger_id order by sent_at) as n
  from public.invoice_link_invites
  where reference is null
)
update public.invoice_link_invites i
   set reference = 'REQ-' || lpad(numbered.n::text, 3, '0')
  from numbered
 where numbered.id = i.id;

create index if not exists invite_reference_idx
  on public.invoice_link_invites (ledger_id, reference);

select reference, email, sent_at
from public.invoice_link_invites
order by ledger_id, sent_at desc
limit 10;
