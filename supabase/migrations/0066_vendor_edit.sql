-- ============================================================
-- A supplier correcting an invoice they already sent.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0060. Safe to run twice.
--
-- Sending the wrong figure is ordinary. Until now the only routes out were to
-- withdraw it and send another, which leaves two rows and a business wondering
-- which is real, or to email and ask.
--
-- Bounded the same way withdrawing is: an accepted invoice is a payable in the
-- other party's books and possibly part paid, so changing it from outside
-- would move their figures without their knowledge. The function refuses, and
-- says to ask them, rather than trusting the button not to be offered.
-- ============================================================

alter table public.inbound_invoices
  add column if not exists edited_at timestamptz,
  add column if not exists edit_note text;

create or replace function public.portal_edit_invoice(
  p_token       text,
  p_invoice_id  uuid,
  p_amount      numeric default null,
  p_description text default null,
  p_invoice_no  text default null,
  p_due_date    date default null,
  p_currency    text default null,
  p_note        text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.contact_portals%rowtype;
  v_contact public.contacts%rowtype;
  v_inv public.inbound_invoices%rowtype;
  v_was numeric;
begin
  select * into v from public.contact_portals where token = p_token and active limit 1;
  if not found then
    return json_build_object('ok', false, 'error', 'This link is not active.');
  end if;

  select * into v_contact from public.contacts where id = v.contact_id;
  select * into v_inv from public.inbound_invoices where id = p_invoice_id;

  if v_inv.id is null or v_inv.ledger_id <> v.ledger_id then
    return json_build_object('ok', false, 'error', 'No such invoice.');
  end if;

  if not (
    lower(trim(coalesce(v_inv.contact_email, ''))) = lower(trim(coalesce(v_contact.email, '')))
    or lower(trim(v_inv.party)) = lower(trim(v_contact.name))
  ) then
    return json_build_object('ok', false, 'error', 'That invoice is not yours.');
  end if;

  if v_inv.status = 'accepted' or v_inv.obligation_id is not null then
    return json_build_object('ok', false,
      'error', 'They have accepted this one into their books. Ask them to void it and send a new one.');
  end if;

  if v_inv.status = 'withdrawn' then
    return json_build_object('ok', false, 'error', 'This one has been withdrawn. Send a new invoice instead.');
  end if;

  v_was := v_inv.amount;

  update public.inbound_invoices
     set amount      = coalesce(p_amount, amount),
         description = coalesce(p_description, description),
         invoice_no  = coalesce(p_invoice_no, invoice_no),
         due_date    = coalesce(p_due_date, due_date),
         currency    = coalesce(p_currency, currency),
         /* An edit clears the correction request: they have answered it, and
            leaving it would show the business a complaint already addressed. */
         correction_note = null,
         correction_at   = null,
         /* Back to waiting, whatever it was. A declined invoice that has been
            corrected is a new question, not a closed one. */
         status      = 'pending',
         edited_at   = now(),
         edit_note   = p_note
   where id = p_invoice_id;

  return json_build_object(
    'ok', true,
    'was', v_was,
    'now', coalesce(p_amount, v_was),
    'party', v_contact.name,
    'ledger_id', v.ledger_id,
    'invoice_no', coalesce(p_invoice_no, v_inv.invoice_no)
  );
end;
$$;

revoke all on function public.portal_edit_invoice(text, uuid, numeric, text, text, date, text, text) from public;
grant execute on function public.portal_edit_invoice(text, uuid, numeric, text, text, date, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select to_regprocedure('public.portal_edit_invoice(text, uuid, numeric, text, text, date, text, text)')::text as edit_fn;
