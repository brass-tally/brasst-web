-- ============================================================
-- A supplier signs in and sees every business that invited them.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0055. Safe to run twice.
--
-- The same shape as the accountant share: an address, a six digit code, no
-- password. What it adds is that a supplier deals with more than one business,
-- so signing in gathers every portal issued to their address rather than one.
--
-- The token link still works, unchanged, for somebody who does not want to
-- sign in at all. Signing in is an upgrade, not a gate.
-- ============================================================

/* Every portal issued to the address of whoever is signed in.
 *
 * Keyed on the contact's email matching the caller's, which is the only claim
 * a signed-in supplier has. No token needed once they have proved the address
 * is theirs, and a forwarded link cannot reach this at all.
 */
create or replace function public.my_supplier_portals()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_out json;
begin
  select lower(trim(email)) into v_email from auth.users where id = auth.uid();
  if v_email is null or v_email = '' then
    return json_build_object('ok', false, 'error', 'Sign in first.');
  end if;

  select coalesce(json_agg(x order by x.business), '[]'::json) into v_out
  from (
    select p.token,
           g.name     as business,
           coalesce(g.currency, 'CAD') as currency,
           c.name     as contact_name,
           (
             select coalesce(sum(greatest(0, abs(o.amount) - coalesce(o.paid_amount, 0))), 0)
             from public.inbound_invoices i
             join public.obligations o on o.id = i.obligation_id
             where i.ledger_id = p.ledger_id
               and o.status = 'open'
               and (lower(trim(i.contact_email)) = v_email
                    or lower(trim(i.party)) = lower(trim(c.name)))
           ) as outstanding
    from public.contact_portals p
    join public.contacts c on c.id = p.contact_id
    join public.ledgers  g on g.id = p.ledger_id
    where p.active
      and lower(trim(c.email)) = v_email
  ) x;

  return json_build_object('ok', true, 'email', v_email, 'portals', v_out);
end;
$$;

revoke all on function public.my_supplier_portals() from public;
grant execute on function public.my_supplier_portals() to authenticated;

/* Raise an invoice from the portal.
 *
 * Deliberately routed through the ledger's own intake link rather than writing
 * to inbound_invoices directly, so an invoice raised here arrives in exactly
 * the same tray, with the same review, as one sent through the public form.
 * A supplier with a portal gets a shorter path, not a different one.
 */
create or replace function public.portal_submit_invoice(
  p_token       text,
  p_amount      numeric,
  p_description text default null,
  p_invoice_no  text default null,
  p_due_date    date default null,
  p_currency    text default null,
  p_lines       jsonb default null,
  p_file_path   text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.contact_portals%rowtype;
  v_contact public.contacts%rowtype;
  v_link text;
begin
  select * into v from public.contact_portals where token = p_token and active limit 1;
  if not found then
    return json_build_object('ok', false, 'error', 'This link is not active.');
  end if;

  select * into v_contact from public.contacts where id = v.contact_id;

  /* The ledger's general intake link, or one made for the purpose. Reusing it
     means every downstream behaviour, notification and rule already applies. */
  select token into v_link
  from public.invoice_links
  where ledger_id = v.ledger_id and active
  order by created_at
  limit 1;

  if v_link is null then
    return json_build_object('ok', false,
      'error', 'This business is not accepting invoices through Brasstally yet.');
  end if;

  return public.submit_invoice(
    v_link,
    v_contact.name,
    p_amount,
    p_description,
    p_invoice_no,
    current_date,
    p_due_date,
    null,
    v_contact.email,
    null,
    p_file_path,
    'once',
    coalesce(p_currency, 'CAD'),
    p_lines
  );
end;
$$;

revoke all on function public.portal_submit_invoice(text, numeric, text, text, date, text, jsonb, text) from public;
drop function if exists public.portal_submit_invoice(text, numeric, text, text, date, text, jsonb);
grant execute on function public.portal_submit_invoice(text, numeric, text, text, date, text, jsonb, text) to anon, authenticated;

select 'ready' as status;
