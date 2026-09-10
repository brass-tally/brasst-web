-- ============================================================
-- Let a supplier attach the invoice itself.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0022.
--
-- The column already exists. What is missing is a way for the submission to
-- carry it, so this replaces submit_invoice with a version that takes a path.
--
-- The path is not trusted. It is produced by /api/invoice-received, which
-- resolves the token server side and signs an upload for one key it chooses
-- itself, so the only thing the supplier can do is put a file where they were
-- told. This function then checks the shape before storing it, because a
-- server route can be changed and a check that costs nothing should not
-- depend on one.
-- ============================================================

create or replace function public.submit_invoice(
  p_token       text,
  p_party       text,
  p_amount      numeric,
  p_description text default null,
  p_invoice_no  text default null,
  p_issue_date  date default null,
  p_due_date    date default null,
  p_tax_amount  numeric default null,
  p_contact     text default null,
  p_note        text default null,
  p_file_path   text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.invoice_links%rowtype;
  v_id uuid;
  v_recent integer;
  v_path text;
begin
  select * into v_link from public.invoice_links where token = p_token and active limit 1;
  if not found then
    return json_build_object('ok', false, 'error', 'This link is not active.');
  end if;

  if coalesce(trim(p_party), '') = '' then
    return json_build_object('ok', false, 'error', 'A name is required.');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    return json_build_object('ok', false, 'error', 'Enter an amount greater than zero.');
  end if;

  select count(*) into v_recent
  from public.inbound_invoices
  where link_id = v_link.id and submitted_at > now() - interval '1 hour';
  if v_recent >= 20 then
    return json_build_object('ok', false, 'error', 'Too many submissions on this link. Try again later.');
  end if;

  -- A file, if one was uploaded, but only under this ledger's own prefix. A
  -- path pointing anywhere else is dropped rather than rejected: the invoice
  -- details are worth keeping even when the attachment is wrong.
  v_path := null;
  if p_file_path is not null
     and p_file_path like 'inbound/' || v_link.ledger_id::text || '/%'
     and length(p_file_path) < 400
  then
    v_path := p_file_path;
  end if;

  insert into public.inbound_invoices (
    ledger_id, link_id, party, contact_email, invoice_no, description,
    amount, tax_amount, issue_date, due_date, note, file_path
  ) values (
    v_link.ledger_id, v_link.id, trim(p_party), nullif(trim(coalesce(p_contact, '')), ''),
    nullif(trim(coalesce(p_invoice_no, '')), ''), nullif(trim(coalesce(p_description, '')), ''),
    round(p_amount, 2), case when p_tax_amount is null then null else round(p_tax_amount, 2) end,
    p_issue_date, p_due_date, nullif(trim(coalesce(p_note, '')), ''), v_path
  ) returning id into v_id;

  update public.invoice_links set submissions = submissions + 1 where id = v_link.id;

  return json_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text) from public;
grant execute on function public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text) to anon, authenticated;

-- The ten argument version from 0022 is now shadowed and would be chosen by a
-- caller that omits the new parameter. Removed so there is one.
drop function if exists public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text);
