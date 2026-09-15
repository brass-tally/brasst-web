-- ============================================================
-- How a customer pays you.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0063. Safe to run twice.
--
-- The void cheque that gets emailed as a photograph, written down once instead.
-- It travels with every invoice, so nobody has to ask for it and nobody has to
-- dig out a bank statement to answer.
--
-- Canada and the United States name the same things differently, and getting
-- that wrong is how a payment bounces:
--
--   Canada         transit (5 digits) + institution (3 digits) + account
--   United States  routing / ABA (9 digits) + account
--   anywhere else  IBAN and SWIFT
--
-- So the fields are all here and the form asks for the ones that matter.
-- ============================================================

create table if not exists public.payment_details (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ledger_id         uuid not null references public.ledgers (id) on delete cascade,

  country           text not null default 'CA' check (country in ('CA', 'US', 'OTHER')),

  beneficiary_name  text,
  beneficiary_address text,

  account_number    text,
  account_type      text,                 -- chequing, savings, business
  institution_number text,                -- Canada, three digits
  transit_number    text,                 -- Canada, five digits
  routing_number    text,                 -- United States, nine digits
  iban              text,
  swift_code        text,

  bank_name         text,
  branch_address    text,

  note              text,                 -- "please quote the invoice number"
  -- Off until somebody has filled it in and chosen to share it.
  active            boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (ledger_id)
);

alter table public.payment_details enable row level security;

drop policy if exists "own payment details" on public.payment_details;
create policy "own payment details" on public.payment_details
  for all to authenticated
  using (public.owns_ledger(ledger_id))
  with check (public.owns_ledger(ledger_id));

/* The invoice view carries them, so a customer reading an invoice has what
 * they need to pay it without a second email.
 *
 * These are the details printed on the bottom of every invoice anybody has
 * ever sent, and a void cheque shows all of them at once. They are behind an
 * unguessable token and only for an invoice that has actually been sent.
 */
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
  select * into v_pay from public.payment_details where ledger_id = v.ledger_id and active;

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
      'country', v_pay.country,
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
      'note', v_pay.note
    ) end
  );
end;
$$;

grant execute on function public.sent_invoice_view(text) to anon, authenticated;

notify pgrst, 'reload schema';

select to_regclass('public.payment_details')::text as created;
