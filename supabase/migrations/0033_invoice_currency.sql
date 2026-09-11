-- ============================================================
-- The currency a supplier invoiced in.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0026. Safe to run twice.
--
-- A ledger has one currency. A contractor does not necessarily use it, and an
-- invoice for 1,250 means nothing without knowing 1,250 of what.
--
-- The currency is recorded on the submission and carried to the payable, so
-- the original is never lost even when the books record a converted figure.
-- ============================================================

alter table public.inbound_invoices
  add column if not exists currency text not null default 'CAD'
    check (currency ~ '^[A-Z]{3}$');

alter table public.invoice_schedules
  add column if not exists currency text not null default 'CAD'
    check (currency ~ '^[A-Z]{3}$');

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
  p_currency    text default 'CAD'
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

  v_path := null;
  if p_file_path is not null
     and p_file_path like 'inbound/' || v_link.ledger_id::text || '/%'
     and length(p_file_path) < 400
  then
    v_path := p_file_path;
  end if;

  v_rec := case when p_recurrence = 'monthly' then 'monthly' else 'once' end;

  -- Anything that is not three letters falls back to the ledger's own, which
  -- is the assumption the form makes anyway.
  v_cur := upper(coalesce(nullif(trim(p_currency), ''), ''));
  if v_cur !~ '^[A-Z]{3}$' then
    select currency into v_cur from public.ledgers where id = v_link.ledger_id;
    v_cur := coalesce(v_cur, 'CAD');
  end if;

  insert into public.inbound_invoices (
    ledger_id, link_id, party, contact_email, invoice_no, description,
    amount, tax_amount, issue_date, due_date, note, file_path, recurrence, currency
  ) values (
    v_link.ledger_id, v_link.id, trim(p_party), nullif(trim(coalesce(p_contact, '')), ''),
    nullif(trim(coalesce(p_invoice_no, '')), ''), nullif(trim(coalesce(p_description, '')), ''),
    round(p_amount, 2), case when p_tax_amount is null then null else round(p_tax_amount, 2) end,
    p_issue_date, p_due_date, nullif(trim(coalesce(p_note, '')), ''), v_path, v_rec, v_cur
  ) returning id into v_id;

  update public.invoice_links set submissions = submissions + 1 where id = v_link.id;

  return json_build_object('ok', true, 'id', v_id, 'recurrence', v_rec, 'currency', v_cur);
end;
$$;

revoke all on function public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text, text, text) from public;
grant execute on function public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text, text, text) to anon, authenticated;

-- The twelve argument version is shadowed. One function, one signature.
drop function if exists public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text, text);

-- And generated invoices inherit the arrangement's currency.
create or replace function public.generate_due_invoices(p_ledger uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  s public.invoice_schedules%rowtype;
  m date;
  made integer := 0;
begin
  for s in select * from public.invoice_schedules where ledger_id = p_ledger and active loop
    m := case
           when s.last_period is null then date_trunc('month', s.created_at)::date
           else (date_trunc('month', s.last_period)::date + interval '1 month')::date
         end;
    while m <= date_trunc('month', current_date)::date loop
      begin
        insert into public.inbound_invoices (
          ledger_id, link_id, schedule_id, period, party, contact_email, description,
          amount, tax_amount, issue_date, due_date, recurrence, status, note, currency
        ) values (
          s.ledger_id, s.link_id, s.id, m, s.party, s.contact_email, s.description,
          s.amount, s.tax_amount, m, (m + (s.day_of_month - 1)),
          'monthly', 'pending', 'Raised automatically from a monthly arrangement',
          coalesce(s.currency, 'CAD')
        );
        made := made + 1;
      exception when unique_violation then
        null;
      end;
      update public.invoice_schedules set last_period = m where id = s.id;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
  return made;
end;
$$;

revoke all on function public.generate_due_invoices(uuid) from public;
grant execute on function public.generate_due_invoices(uuid) to authenticated;


/* The supplier's form needs to know what the recipient keeps their books in,
   so it can default to that rather than making a contractor guess. */
create or replace function public.invoice_link_info(p_token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when l.id is null then json_build_object('ok', false)
              else json_build_object(
                'ok', true, 'business', lg.name, 'label', l.label,
                'slug', l.slug, 'currency', coalesce(lg.currency, 'CAD'))
         end
  from (select 1) x
  left join public.invoice_links l on l.token = p_token and l.active
  left join public.ledgers lg on lg.id = l.ledger_id;
$$;

revoke all on function public.invoice_link_info(text) from public;
grant execute on function public.invoice_link_info(text) to anon, authenticated;

select 'currency on submissions' as object,
       (select count(*) from information_schema.columns
         where table_schema='public' and table_name='inbound_invoices' and column_name='currency') as present;
