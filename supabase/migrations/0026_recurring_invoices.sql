-- ============================================================
-- Invoices that come back every month.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0022. Safe to run twice.
--
-- A contractor you pay monthly should not have to fill in the same form twelve
-- times. They mark one submission as monthly, and from then on it is raised
-- for them.
--
-- What it does NOT do is put those straight into your books. A generated
-- invoice lands in the tray as pending, exactly like one somebody typed, and
-- you accept it. That keeps the rule the whole feature rests on: nothing that
-- arrives through a public link reaches the books without a person agreeing to
-- it. The work it removes is the contractor's, which is where the work was.
-- ============================================================

alter table public.inbound_invoices
  add column if not exists recurrence text not null default 'once'
    check (recurrence in ('once', 'monthly'));

create table if not exists public.invoice_schedules (
  id           uuid primary key default gen_random_uuid(),
  ledger_id    uuid not null references public.ledgers(id) on delete cascade,
  link_id      uuid references public.invoice_links(id) on delete set null,
  party        text not null,
  contact_email text,
  description  text,
  amount       numeric not null check (amount > 0),
  tax_amount   numeric,
  day_of_month integer not null default 1 check (day_of_month between 1 and 28),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  stopped_at   timestamptz,
  last_period  date
);

alter table public.invoice_schedules enable row level security;

drop policy if exists "owner manages schedules" on public.invoice_schedules;
create policy "owner manages schedules" on public.invoice_schedules
  for all to authenticated
  using (exists (select 1 from public.ledgers l where l.id = ledger_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.ledgers l where l.id = ledger_id and l.user_id = auth.uid()));

alter table public.inbound_invoices
  add column if not exists schedule_id uuid references public.invoice_schedules(id) on delete set null,
  add column if not exists period date;

-- One invoice per schedule per month, enforced by the database rather than by
-- whoever calls the generator. Two tabs open, or a retry after a timeout, must
-- not produce two bills for the same month.
create unique index if not exists inbound_one_per_period
  on public.inbound_invoices (schedule_id, period)
  where schedule_id is not null;

/* Raise anything due. Idempotent: the unique index above means a second call
   in the same month inserts nothing rather than duplicating. Called by the app
   on load, so it needs no scheduler and cannot drift when one is not running.

   It fills in every month since the schedule started, not only the current
   one, so a ledger nobody opened for a quarter catches up rather than silently
   skipping two bills. */
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
  for s in
    select * from public.invoice_schedules
    where ledger_id = p_ledger and active
  loop
    m := date_trunc('month', greatest(s.created_at::date, coalesce(s.last_period, s.created_at::date)))::date;
    while m <= date_trunc('month', current_date)::date loop
      begin
        insert into public.inbound_invoices (
          ledger_id, link_id, schedule_id, period, party, contact_email, description,
          amount, tax_amount, issue_date, due_date, recurrence, status, note
        ) values (
          s.ledger_id, s.link_id, s.id, m, s.party, s.contact_email, s.description,
          s.amount, s.tax_amount, m,
          (m + (s.day_of_month - 1)),
          'monthly', 'pending',
          'Raised automatically from a monthly arrangement'
        );
        made := made + 1;
      exception when unique_violation then
        -- already raised for this month, which is the normal case
        null;
      end;
      m := (m + interval '1 month')::date;
    end loop;

    update public.invoice_schedules
      set last_period = date_trunc('month', current_date)::date
      where id = s.id;
  end loop;

  return made;
end;
$$;

revoke all on function public.generate_due_invoices(uuid) from public;
grant execute on function public.generate_due_invoices(uuid) to authenticated;

-- The submission form can now say "every month".
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
  p_recurrence  text default 'once'
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

  insert into public.inbound_invoices (
    ledger_id, link_id, party, contact_email, invoice_no, description,
    amount, tax_amount, issue_date, due_date, note, file_path, recurrence
  ) values (
    v_link.ledger_id, v_link.id, trim(p_party), nullif(trim(coalesce(p_contact, '')), ''),
    nullif(trim(coalesce(p_invoice_no, '')), ''), nullif(trim(coalesce(p_description, '')), ''),
    round(p_amount, 2), case when p_tax_amount is null then null else round(p_tax_amount, 2) end,
    p_issue_date, p_due_date, nullif(trim(coalesce(p_note, '')), ''), v_path, v_rec
  ) returning id into v_id;

  update public.invoice_links set submissions = submissions + 1 where id = v_link.id;

  return json_build_object('ok', true, 'id', v_id, 'recurrence', v_rec);
end;
$$;

revoke all on function public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text, text) from public;
grant execute on function public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text, text) to anon, authenticated;

-- The eleven argument version is shadowed now. One function, one signature.
drop function if exists public.submit_invoice(text, text, numeric, text, text, date, date, numeric, text, text, text);

select 'invoice_schedules' as object, to_regclass('public.invoice_schedules')::text as present
union all select 'generate_due_invoices', (select proname from pg_proc where proname = 'generate_due_invoices' limit 1);
