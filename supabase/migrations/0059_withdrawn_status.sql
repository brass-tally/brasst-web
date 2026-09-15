-- ============================================================
-- Let an invoice be withdrawn without deleting it.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0058. Safe to run twice.
--
-- I wrote code that sets `status = 'voided'` on a table whose constraint
-- allows only pending, accepted and declined. There is no such status: voiding
-- on the owner's side deletes the row outright, and I assumed a value that had
-- never existed rather than reading the table.
--
-- Deleting is right for the owner: they are removing something from their own
-- books. It is wrong for a supplier withdrawing one, because the row is the
-- only record either side has that it was ever sent, and it needs to stay
-- visible on their page marked as withdrawn.
--
-- So 'withdrawn' is added, and it means one specific thing: the supplier took
-- it back. An owner removing an invoice still deletes.
-- ============================================================

alter table public.inbound_invoices
  drop constraint if exists inbound_invoices_status_check;

alter table public.inbound_invoices
  add constraint inbound_invoices_status_check
  check (status in ('pending', 'accepted', 'declined', 'withdrawn'));

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

  if v_inv.status = 'withdrawn' then
    return json_build_object('ok', true, 'already', true);
  end if;

  update public.inbound_invoices
     set status = 'withdrawn', decided_at = now()
   where id = p_invoice_id;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.portal_withdraw_invoice(text, uuid) from public;
grant execute on function public.portal_withdraw_invoice(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

select pg_get_constraintdef(oid) as status_rule
from pg_constraint
where conname = 'inbound_invoices_status_check';
