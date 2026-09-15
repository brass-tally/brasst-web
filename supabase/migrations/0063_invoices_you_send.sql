-- ============================================================
-- Invoices you send.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0061. Safe to run twice.
--
-- The mirror of the intake tray: what you bill, rather than what you are
-- billed. It shares that flow's shape deliberately, because a supplier's
-- invoice and yours are the same object seen from two ends, and the customer
-- reads theirs on the same kind of page your contractors already use.
--
-- The receivable stays the source of truth for what you are owed. This table
-- holds the document: its number, its lines, when it went out, and who has
-- looked at it. Settling still happens in the books, so an invoice cannot
-- disagree with the ledger about whether it was paid.
-- ============================================================

create table if not exists public.sent_invoices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ledger_id      uuid not null references public.ledgers (id) on delete cascade,
  contact_id     uuid references public.contacts (id) on delete set null,

  number         text not null,
  party          text not null,
  contact_email  text,

  issued_on      date not null default current_date,
  due_on         date,
  currency       text not null default 'CAD',
  amount         numeric not null default 0,
  tax_amount     numeric not null default 0,
  note           text,
  line_items     jsonb,

  -- draft: written, not sent. sent: it has gone. The rest follow the money.
  status         text not null default 'draft'
                   check (status in ('draft', 'sent', 'paid', 'cancelled')),

  token          text unique,
  sent_at        timestamptz,
  opened_at      timestamptz,
  opens          integer not null default 0,

  -- What it becomes in the books, so the two can never disagree.
  obligation_id  uuid references public.obligations (id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ledger_id, number)
);

alter table public.sent_invoices enable row level security;

drop policy if exists "own sent invoices" on public.sent_invoices;
create policy "own sent invoices" on public.sent_invoices
  for all to authenticated
  using (public.owns_ledger(ledger_id))
  with check (public.owns_ledger(ledger_id));

create index if not exists sent_invoices_by_ledger
  on public.sent_invoices (ledger_id, status, issued_on desc);

/* The next number in the ledger's own sequence.
 *
 * Per ledger, not global: two businesses should each count from one, and a
 * customer reading INV-0007 should not be able to infer how many invoices
 * everybody else has sent.
 */
create or replace function public.next_invoice_number(p_ledger_id uuid, p_prefix text default 'INV')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.owns_ledger(p_ledger_id) then
    raise exception 'not your ledger';
  end if;

  select coalesce(max(
           nullif(regexp_replace(number, '^.*?(\d+)$', '\1'), '')::int
         ), 0) + 1
    into n
    from public.sent_invoices
   where ledger_id = p_ledger_id;

  return p_prefix || '-' || lpad(n::text, 4, '0');
end;
$$;

grant execute on function public.next_invoice_number(uuid, text) to authenticated;

/* What a customer sees, by token. No account, same shape as a supplier's
   page. It returns one invoice and nothing else: no other customers, no
   totals, no ledger. */
create or replace function public.sent_invoice_view(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.sent_invoices%rowtype;
  v_ledger public.ledgers%rowtype;
  v_paid numeric := 0;
  v_balance date;
begin
  select * into v from public.sent_invoices where token = p_token and status <> 'draft' limit 1;
  if not found then
    return json_build_object('ok', false, 'error', 'This invoice is not available.');
  end if;

  select * into v_ledger from public.ledgers where id = v.ledger_id;

  update public.sent_invoices
     set opens = opens + 1, opened_at = now()
   where id = v.id;

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
    'balance_due', v_balance
  );
end;
$$;

revoke all on function public.sent_invoice_view(text) from public;
grant execute on function public.sent_invoice_view(text) to anon, authenticated;

notify pgrst, 'reload schema';

select to_regclass('public.sent_invoices')::text as created;
