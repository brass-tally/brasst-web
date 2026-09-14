-- ============================================================
-- A page each contact can open, showing everything between you.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0029 (contacts) and 0022 (inbound invoices). Safe to run twice.
--
-- Not an account. A contractor will not sign up to look at two invoices, and
-- an account means new authentication, a ledger of their own, and a permission
-- model between two parties. That is a great deal of surface for somebody who
-- wants to know whether they have been paid.
--
-- A token instead, the same shape as the intake link and the accountant share:
-- one address, no password, revocable, and scoped to exactly one contact's
-- dealings with one ledger.
-- ============================================================

create table if not exists public.contact_portals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ledger_id  uuid not null references public.ledgers (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  token      text not null unique,
  active     boolean not null default true,
  opened_at  timestamptz,
  opens      integer not null default 0,
  created_at timestamptz not null default now(),
  unique (ledger_id, contact_id)
);

alter table public.contact_portals enable row level security;

drop policy if exists "own contact portals" on public.contact_portals;
create policy "own contact portals" on public.contact_portals
  for all to authenticated
  using (public.owns_ledger(ledger_id))
  with check (public.owns_ledger(ledger_id));

/* Everything one contact may see, by token.
 *
 * Security definer because the reader has no account. It returns only rows
 * that name this contact, on this ledger, and nothing else: no balances, no
 * other parties, no bank. A token is a key to one door.
 */
create or replace function public.contact_portal_view(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.contact_portals%rowtype;
  v_contact public.contacts%rowtype;
  v_ledger public.ledgers%rowtype;
  v_invoices json;
  v_payments json;
begin
  select * into v from public.contact_portals where token = p_token and active limit 1;
  if not found then
    return json_build_object('ok', false, 'error', 'This link is not active.');
  end if;

  select * into v_contact from public.contacts where id = v.contact_id;
  select * into v_ledger  from public.ledgers  where id = v.ledger_id;

  update public.contact_portals
     set opens = opens + 1, opened_at = now()
   where id = v.id;

  -- What they have sent, and where each one stands.
  select coalesce(json_agg(x order by x.submitted_at desc), '[]'::json) into v_invoices
  from (
    select i.invoice_no, i.description, i.amount, i.currency, i.status,
           i.submitted_at, i.due_date,
           i.file_path is not null as has_file,
           o.status   as payable_status,
           o.amount   as payable_amount,
           o.paid_amount,
           o.settled_on,
           o.balance_due
    from public.inbound_invoices i
    left join public.obligations o on o.id = i.obligation_id
    where i.ledger_id = v.ledger_id
      and i.status <> 'voided'
      and (
        lower(trim(i.contact_email)) = lower(trim(coalesce(v_contact.email, '')))
        or lower(trim(i.party)) = lower(trim(v_contact.name))
      )
  ) x;

  -- And what has actually been paid to them.
  select coalesce(json_agg(y order by y.date desc), '[]'::json) into v_payments
  from (
    select t.date, t.amount, t.description, t.pay_method
    from public.transactions t
    join public.obligations o on o.settled_tx_id = t.id
    where t.ledger_id = v.ledger_id
      and lower(trim(o.party)) = lower(trim(v_contact.name))
  ) y;

  return json_build_object(
    'ok', true,
    'business', v_ledger.name,
    'currency', coalesce(v_ledger.currency, 'CAD'),
    'contact', json_build_object('name', v_contact.name, 'email', v_contact.email),
    'invoices', v_invoices,
    'payments', v_payments
  );
end;
$$;

revoke all on function public.contact_portal_view(text) from public;
grant execute on function public.contact_portal_view(text) to anon, authenticated;

select to_regclass('public.contact_portals')::text as created;
