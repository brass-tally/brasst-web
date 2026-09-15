-- ============================================================
-- A supplier can withdraw an invoice they sent.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0057. Safe to run twice.
--
-- Sending the wrong thing is ordinary, and the only route out was to email the
-- business and ask them to void it. That makes a person's mistake into
-- somebody else's task.
--
-- Bounded deliberately: an invoice that has been accepted is a payable in
-- their books, and possibly part paid. Withdrawing that from the outside would
-- change their figures without their knowledge, so it is refused and the
-- supplier is told to ask.
-- ============================================================

create or replace function public.portal_withdraw_invoice(p_token text, p_invoice_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.contact_portals%rowtype;
  v_contact public.contacts%rowtype;
  v_inv public.inbound_invoices%rowtype;
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

  -- It has to be theirs, on the same terms the view uses to show it to them.
  if not (
    lower(trim(coalesce(v_inv.contact_email, ''))) = lower(trim(coalesce(v_contact.email, '')))
    or lower(trim(v_inv.party)) = lower(trim(v_contact.name))
  ) then
    return json_build_object('ok', false, 'error', 'That invoice is not yours.');
  end if;

  if v_inv.status = 'accepted' or v_inv.obligation_id is not null then
    return json_build_object('ok', false,
      'error', 'This one has been accepted into their books. Ask them to void it.');
  end if;

  if v_inv.status = 'voided' then
    return json_build_object('ok', true, 'already', true);
  end if;

  update public.inbound_invoices
     set status = 'voided', decided_at = now()
   where id = p_invoice_id;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.portal_withdraw_invoice(text, uuid) from public;
grant execute on function public.portal_withdraw_invoice(text, uuid) to anon, authenticated;

/* The view has to return an id, or nothing on the page can name a row. */
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

  update public.contact_portals set opens = opens + 1, opened_at = now() where id = v.id;

  select coalesce(json_agg(x order by x.submitted_at desc), '[]'::json) into v_invoices
  from (
    select i.id, i.invoice_no, i.description, i.amount, i.currency, i.status,
           i.submitted_at, i.due_date,
           i.file_path is not null as has_file,
           i.correction_note, i.correction_at,
           o.status   as payable_status,
           o.amount   as payable_amount,
           o.paid_amount,
           o.settled_on,
           o.balance_due
    from public.inbound_invoices i
    left join public.obligations o on o.id = i.obligation_id
    where i.ledger_id = v.ledger_id
      and (
        lower(trim(i.contact_email)) = lower(trim(coalesce(v_contact.email, '')))
        or lower(trim(i.party)) = lower(trim(v_contact.name))
      )
  ) x;

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

grant execute on function public.contact_portal_view(text) to anon, authenticated;

select 'ready' as status;
