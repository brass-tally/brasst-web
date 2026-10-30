-- ============================================================
-- Recover the invitations sent before there was anywhere to record them.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0036. Safe to run twice.
--
-- The history was empty and said so, which was true and useless: invitations
-- had gone out, they just predated the table.
--
-- Anything recoverable is recoverable from invoice_links, because a personal
-- link carries the recipient's address as its label. A send that used the old
-- shared link left no trace anywhere and cannot be recovered, which the
-- interface says rather than implying the list is complete.
-- ============================================================

insert into public.invoice_link_invites (link_id, ledger_id, email, sent_at)
select l.id, l.ledger_id, l.label, l.created_at
  from public.invoice_links l
 where l.label is not null
   and l.label ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
   and not exists (
     select 1 from public.invoice_link_invites i
      where i.link_id = l.id and lower(i.email) = lower(l.label)
   );

select count(*) as invites_on_record from public.invoice_link_invites;
