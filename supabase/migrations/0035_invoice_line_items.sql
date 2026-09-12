-- ============================================================
-- Line items, for suppliers who do not have a PDF to attach.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0033. Safe to run twice.
--
-- A contractor without invoicing software was being asked for one total and
-- a description, which is the point at which they go and make a PDF instead,
-- which is the thing this feature exists to avoid.
-- ============================================================

alter table public.inbound_invoices
  add column if not exists line_items jsonb;

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
  p_file_path   text default null,
  p_recurrence  text default 'once',
  p_currency    text default 'CAD',
  p_lines       jsonb default null
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
  v_rec text;
  v_cur text;
  v_lines jsonb;
  v_sum numeric;
begin
  select * into v_link from public.invoice_links where token = p_token and active limit 1;
  if not found then
    return json_build_object('ok', false, 'error', 'This link is not active.');
  end if;

  if coalesce(trim(p_party), '') = '' then
    return json_build_object('ok', false, 'error', 'A name is required.');
  end if;

  /* Lines are cleaned here rather than trusted.
     A public endpoint should not store whatever shape a browser sent, and the
     total is recomputed from them so the figure on the invoice and the sum of
     its parts cannot disagree. */
  v_lines := null;
  v_sum := null;
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
    select jsonb_agg(jsonb_build_object(
             'description', left(coalesce(e->>'description', ''), 200),
             'quantity', round(coalesce((e->>'quantity')::numeric, 1), 3),
             'rate', round(coalesce((e->>'rate')::numeric, 0), 2),
             'amount', round(coalesce((e->>'quantity')::numeric, 1) * coalesce((e->>'rate')::numeric, 0), 2)
           ))
      into v_lines
      from jsonb_array_elements(p_lines) e
     where coalesce(e->>'description', '') <> ''
       and coalesce((e->>'rate')::numeric, 0) <> 0;

    if v_lines is not null then
      select sum((l->>'amount')::numeric) into v_sum from jsonb_array_elements(v_lines) l;
      if jsonb_array_length(v_lines) > 50 then
        return json_build_object('ok', false, 'error', 'Too many lines on one invoice.');
      end if;
    end if;
  end if;

  -- The lines win when there are any, because they are what was itemised.
  if v_sum is not null and v_sum > 0 then
    p_amount := round(v_sum, 2);
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

  v_path := null;
  if p_file_path is not null
     and p_file_path like 'inbound/' || v_link.ledger_id::text || '/%'
     and length(p_file_path) < 400
  then
    v_path := p_file_path;
  end if;

  v_rec := case when p_recurrence = 'monthly' then 'monthly' else 'once' end;

  v_cur := upper(coalesce(nullif(trim(p_currency), ''), ''));
  if v_cur !~ '^[A-Z]{3}$' then
    select currency into v_cur from public.ledgers where id = v_link.ledger_id;
    v_cur := coalesce(v_cur, 'CAD');
  end if;

  insert into public.inbound_invoices (
    ledger_id, link_id, party, contact_email, invoice_no, description,
    amount, tax_amount, issue_date, due_date, note, file_path, recurrence, currency, line_items
  ) values (
    v_link.ledger_id, v_link.id, trim(p_party), nullif(trim(coalesce(p_contact, '')), ''),
    nullif(trim(coalesce(p_invoice_no, '')), ''), nullif(trim(coalesce(p_description, '')), ''),
    round(p_amount, 2), case when p_tax_amount is null then null else round(p_tax_amount, 2) end,
    p_issue_date, p_due_date, nullif(trim(coalesce(p_note, '')), ''), v_path, v_rec, v_cur, v_lines
  ) returning id into v_id;

  update public.invoice_links set submissions = submissions + 1 where id = v_link.id;

  return json_build_object('ok', true, 'id', v_id, 'recurrence', v_rec,
                           'currency', v_cur, 'lines', coalesce(jsonb_array_length(v_lines), 0));
end;
$$;

revoke all on function public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text, text, text, jsonb) from public;
grant execute on function public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text, text, text, jsonb) to anon, authenticated;

drop function if exists public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text, text, text);

select 'line_items' as column,
       (select count(*) from information_schema.columns
         where table_schema='public' and table_name='inbound_invoices' and column_name='line_items') as present;
