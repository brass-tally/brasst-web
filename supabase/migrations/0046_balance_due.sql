-- ============================================================
-- When the rest of a part-paid bill is due.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0045. Safe to run twice.
--
-- Paying half a bill and agreeing the rest for the 30th is an arrangement, and
-- an arrangement nobody wrote down is a bill that surprises you. The original
-- due date is not it: that date has passed, it was met in part, and leaving it
-- means the bill reads as overdue when it is not.
-- ============================================================

alter table public.obligations
  add column if not exists balance_due date;

comment on column public.obligations.balance_due is
  'When the unpaid remainder is expected. Set when a part payment is made; null on anything paid in full or untouched.';

/* An index on what is actually queried: the balance dates still ahead of us on
   bills that are still open. */
create index if not exists obligations_balance_due_idx
  on public.obligations (balance_due)
  where balance_due is not null and status = 'open';

select count(*) filter (where balance_due is not null) as with_a_date,
       count(*) filter (where status = 'open' and paid_amount > 0) as part_paid
from public.obligations;
