-- ============================================================
-- Paying part of a bill.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0001. Safe to run twice.
--
-- An obligation was paid or it was not. Real money does not work that way: a
-- contractor takes half now and half on completion, a client pays what they
-- can, a supplier agrees to instalments.
--
-- Without this the only options were to mark the whole thing paid, which is a
-- lie, or to leave it open, which is also a lie once half of it has gone.
-- ============================================================

alter table public.obligations
  add column if not exists paid_amount numeric not null default 0;

/* Every settled obligation was paid in full, by definition, since partial
   settlement did not exist until now. */
update public.obligations
   set paid_amount = amount
 where status <> 'open' and paid_amount = 0;

/* What is still owed. A column rather than arithmetic scattered through the
   app, so every reader agrees about the figure. */
create or replace function public.outstanding(o public.obligations)
returns numeric
language sql
immutable
as $$
  select greatest(0, round(abs(o.amount) - coalesce(o.paid_amount, 0), 2));
$$;

comment on column public.obligations.paid_amount is
  'Sum of part payments made against this obligation. Equal to amount once settled.';

select
  count(*) filter (where status = 'open' and paid_amount > 0) as part_paid,
  count(*) filter (where status = 'open') as still_open,
  count(*) filter (where status <> 'open') as settled
from public.obligations;
