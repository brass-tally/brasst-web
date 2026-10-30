-- ============================================================
-- Tie invoices already accepted to the arrangements they started.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0026. Safe to run twice.
--
-- Accepting a monthly invoice created an arrangement and never wrote the
-- arrangement back onto the invoice. The two are the same agreement and the
-- interface had no way to know, so one supplier occupied two rows: the
-- arrangement, and the invoice that started it.
-- ============================================================

update public.inbound_invoices i
   set schedule_id = s.id
  from public.invoice_schedules s
 where i.schedule_id is null
   and i.recurrence = 'monthly'
   and s.ledger_id = i.ledger_id
   and lower(trim(s.party)) = lower(trim(i.party))
   and s.amount = i.amount
   -- The arrangement was created by accepting this invoice, so it cannot
   -- predate it by much. A day of slack covers a slow evening.
   and s.created_at >= i.submitted_at - interval '1 day';

select count(*) filter (where schedule_id is not null) as linked,
       count(*) filter (where schedule_id is null and recurrence = 'monthly') as still_loose
from public.inbound_invoices;
