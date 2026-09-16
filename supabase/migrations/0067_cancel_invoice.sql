-- ============================================================
-- Cancelling an invoice retires what it raised.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0063. Safe to run twice.
--
-- Sending an invoice raises a receivable. Cancelling it marked the document
-- and left the debt, so the books went on claiming money from somebody who had
-- been told the bill was withdrawn. The two must move together or neither
-- should.
--
-- Done in the database rather than in two calls from the browser, because a
-- browser that closes between them leaves exactly the state this fixes.
-- ============================================================

alter table public.sent_invoices
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancel_reason text;

create or replace function public.cancel_sent_invoice(
  p_invoice_id uuid,
  p_reason     text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.sent_invoices%rowtype;
  v_ob public.obligations%rowtype;
  v_who text;
  v_paid numeric := 0;
begin
  select * into v from public.sent_invoices where id = p_invoice_id;
  if v.id is null then
    return json_build_object('ok', false, 'error', 'No such invoice.');
  end if;
  if not public.owns_ledger(v.ledger_id) then
    return json_build_object('ok', false, 'error', 'That is not your invoice.');
  end if;

  /* Money already received is a fact, whatever you do to the paperwork.
     Cancelling an invoice somebody has part paid would leave that payment
     attached to nothing. */
  if v.obligation_id is not null then
    select * into v_ob from public.obligations where id = v.obligation_id;
    v_paid := coalesce(v_ob.paid_amount, 0);
    if v_paid > 0.005 then
      return json_build_object('ok', false,
        'error', 'Some of this has been paid. Settle or refund it first, then cancel.');
    end if;
  end if;

  select coalesce(email, 'you') into v_who from auth.users where id = auth.uid();

  update public.sent_invoices
     set status        = 'cancelled',
         cancelled_at  = now(),
         cancelled_by  = v_who,
         cancel_reason = p_reason,
         updated_at    = now()
   where id = p_invoice_id;

  /* The receivable goes with it. Deleted rather than closed: it was never
     income, and a settled row would show as money that arrived. */
  if v.obligation_id is not null then
    delete from public.obligations where id = v.obligation_id and coalesce(paid_amount, 0) <= 0.005;
  end if;

  return json_build_object(
    'ok', true,
    'number', v.number,
    'cancelled_at', now(),
    'cancelled_by', v_who,
    'removed_obligation', v.obligation_id is not null
  );
end;
$$;

grant execute on function public.cancel_sent_invoice(uuid, text) to authenticated;

notify pgrst, 'reload schema';

/* Anything already cancelled that left its receivable behind. This is the
   state you are looking at now, and it does not fix itself. */
delete from public.obligations o
 using public.sent_invoices i
 where i.obligation_id = o.id
   and i.status = 'cancelled'
   and coalesce(o.paid_amount, 0) <= 0.005;

select count(*) as still_open_against_cancelled
from public.sent_invoices i
join public.obligations o on o.id = i.obligation_id
where i.status = 'cancelled';
