-- ============================================================
-- Show a supplier when a correction has been asked for.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0055. Safe to run twice.
--
-- Asking for a correction leaves the invoice `pending`, which is right: it is
-- still an open question rather than a closed one. But the supplier's page
-- then reads "With them for review", when in fact the ball is in the
-- supplier's court and an email they may have missed is the only thing that
-- says so.
--
-- The request is recorded here so the page can say it plainly, with the reason
-- the owner gave.
-- ============================================================

alter table public.inbound_invoices
  add column if not exists correction_note text,
  add column if not exists correction_at   timestamptz;

/* Carry it through to the supplier's view. */
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

  select coalesce(json_agg(x order by x.submitted_at desc), '[]'::json) into v_invoices
  from (
    select i.invoice_no, i.description, i.amount, i.currency, i.status,
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
      and i.status <> 'voided'
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
