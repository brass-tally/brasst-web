-- ============================================================
-- The second routing number a US account usually has.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0069. Safe to run twice.
--
-- Many US banks publish two routing numbers: one for ACH, which is the one
-- printed on a cheque, and a different one for wires. They are not
-- interchangeable.
--
-- A Canadian customer wiring to a US account using the ACH number has the
-- payment rejected or returned days later, minus a fee, with nothing on either
-- side explaining why. The form offered one field, so there was no way to tell
-- them the right one.
-- ============================================================

alter table public.payment_details
  add column if not exists wire_routing_number text;

/* The invoice view carries it, so a customer paying from abroad is given the
   number their bank will actually accept. */
create or replace function public.sent_invoice_view(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.sent_invoices%rowtype;
  v_ledger public.ledgers%rowtype;
  v_pay public.payment_details%rowtype;
  v_paid numeric := 0;
  v_balance date;
begin
  select * into v from public.sent_invoices where token = p_token and status <> 'draft' limit 1;
  if not found then
    return json_build_object('ok', false, 'error', 'This invoice is not available.');
  end if;

  select * into v_ledger from public.ledgers where id = v.ledger_id;
  select * into v_pay from public.payment_details_for(v.ledger_id, v.currency);

  update public.sent_invoices set opens = opens + 1, opened_at = now() where id = v.id;

  if v.obligation_id is not null then
    select coalesce(paid_amount, 0), balance_due into v_paid, v_balance
      from public.obligations where id = v.obligation_id;
  end if;

  return json_build_object(
    'ok', true,
    'from', v_ledger.name,
    'number', v.number,
    'party', v.party,
    'issued_on', v.issued_on,
    'due_on', v.due_on,
    'currency', v.currency,
    'amount', v.amount,
    'tax_amount', v.tax_amount,
    'note', v.note,
    'lines', v.line_items,
    'status', v.status,
    'paid_amount', v_paid,
    'balance_due', v_balance,
    'pay_to', case when v_pay.id is null then null else json_build_object(
      'label', v_pay.label,
      'country', v_pay.country,
      'currency', v_pay.currency,
      'beneficiary_name', v_pay.beneficiary_name,
      'beneficiary_address', v_pay.beneficiary_address,
      'account_number', v_pay.account_number,
      'account_type', v_pay.account_type,
      'institution_number', v_pay.institution_number,
      'transit_number', v_pay.transit_number,
      'routing_number', v_pay.routing_number,
      'wire_routing_number', v_pay.wire_routing_number,
      'iban', v_pay.iban,
      'swift_code', v_pay.swift_code,
      'bank_name', v_pay.bank_name,
      'branch_address', v_pay.branch_address,
      'note', v_pay.note,
      'matches_invoice', (v_pay.currency is not distinct from v.currency)
    ) end
  );
end;
$$;

grant execute on function public.sent_invoice_view(text) to anon, authenticated;

notify pgrst, 'reload schema';

select label, country, routing_number, wire_routing_number
from public.payment_details
order by is_default desc;
