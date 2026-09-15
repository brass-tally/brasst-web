-- ============================================================
-- A supplier can put a withdrawn invoice away.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0059. Safe to run twice.
--
-- A withdrawn invoice has to stay visible when it is withdrawn, or the thing
-- simply vanishes and nobody can ask about it. But it stays visible forever,
-- and a supplier who sends a few a month ends up reading past a column of
-- struck-through rows that are finished business.
--
-- Archived, not deleted. The row is the only record either side has that it
-- was ever sent, and the business can still see it. This is one person tidying
-- their own view.
-- ============================================================

alter table public.inbound_invoices
  add column if not exists archived_at timestamptz;

create or replace function public.portal_archive_invoice(
  p_token text, p_invoice_id uuid, p_archive boolean default true
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

  /* Only something already finished. Putting away an invoice that is still
     waiting on the business would hide the very thing the page exists to
     show. */
  if v_inv.status not in ('withdrawn', 'declined') then
    return json_build_object('ok', false,
      'error', 'Only a withdrawn or declined invoice can be put away.');
  end if;

  update public.inbound_invoices
     set archived_at = case when p_archive then now() else null end
   where id = p_invoice_id;

  return json_build_object('ok', true, 'archived', p_archive);
end;
$$;

revoke all on function public.portal_archive_invoice(text, uuid, boolean) from public;
grant execute on function public.portal_archive_invoice(text, uuid, boolean) to anon, authenticated;

/* The view has to carry it, or the page cannot tell what has been put away.
 *
 * Rewritten rather than patched, because a function is replaced whole and a
 * half-updated one is how the last three migrations disagreed with each
 * other. */
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
           i.correction_note, i.correction_at, i.archived_at,
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

notify pgrst, 'reload schema';

select to_regprocedure('public.portal_archive_invoice(text, uuid, boolean)')::text as archive_fn;
