-- ============================================================
-- More than one account to be paid into.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0064. Safe to run twice.
--
-- A business billing in two currencies has two accounts, and they are not
-- interchangeable: a US customer paying a Canadian account by wire loses money
-- to conversion and a correspondent bank fee, and a Canadian customer sent a
-- routing number has nothing to type it into.
--
-- `unique (ledger_id)` allowed exactly one, so whichever was saved last was the
-- only one anybody could be shown. This lifts that and adds the two things the
-- choice needs: a name a person recognises, and the currency the account
-- receives.
-- ============================================================

alter table public.payment_details
  add column if not exists label      text,
  add column if not exists currency   text,
  add column if not exists is_default boolean not null default false;

/* One account per ledger was the rule. It is now one DEFAULT per ledger, which
   is a different constraint and has to be expressed differently: a partial
   index, because a unique column would allow only one row again. */
alter table public.payment_details
  drop constraint if exists payment_details_ledger_id_key;

drop index if exists payment_details_one_default;
create unique index payment_details_one_default
  on public.payment_details (ledger_id)
  where is_default;

create index if not exists payment_details_by_ledger
  on public.payment_details (ledger_id, active, currency);

/* Whatever exists already becomes the default, and is named from its country so
   it is not an unlabelled row in a list of one. */
update public.payment_details
   set is_default = true,
       label = coalesce(label, case country
                 when 'CA' then 'Canadian account'
                 when 'US' then 'US account'
                 else 'International account' end),
       currency = coalesce(currency, case country
                 when 'CA' then 'CAD'
                 when 'US' then 'USD'
                 else null end)
 where id in (
   select distinct on (ledger_id) id
     from public.payment_details
    order by ledger_id, updated_at desc
 );

/* Which account to show on an invoice.
 *
 * The invoice's own currency decides. A customer being billed in USD is shown
 * the account that receives USD, because showing them any other is asking them
 * to pay a conversion they did not agree to.
 *
 * Falling back to the default rather than to nothing: an account they can pay
 * into imperfectly beats an invoice with no payment details at all.
 */
create or replace function public.payment_details_for(p_ledger_id uuid, p_currency text)
returns public.payment_details
language sql
stable
security definer
set search_path = public
as $$
  select *
    from public.payment_details
   where ledger_id = p_ledger_id
     and active
   order by
     (currency is not distinct from p_currency) desc,
     is_default desc,
     updated_at desc
   limit 1;
$$;

/* The invoice view takes the matching account rather than the only one. */
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
      'iban', v_pay.iban,
      'swift_code', v_pay.swift_code,
      'bank_name', v_pay.bank_name,
      'branch_address', v_pay.branch_address,
      'note', v_pay.note,
      /* So the page can say "this is the account for USD" rather than
         leaving a customer to wonder whether it is the right one. */
      'matches_invoice', (v_pay.currency is not distinct from v.currency)
    ) end
  );
end;
$$;

grant execute on function public.payment_details_for(uuid, text) to authenticated;
grant execute on function public.sent_invoice_view(text) to anon, authenticated;

notify pgrst, 'reload schema';

select label, country, currency, is_default, active
from public.payment_details
order by ledger_id, is_default desc;
