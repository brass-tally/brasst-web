-- ============================================================
-- Two features: read access for an accountant, and an intake link a supplier
-- can use to send you an invoice.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- ------------------------------------------------------------
-- 1. Sharing a ledger, read only
-- ------------------------------------------------------------
-- Invited by email, because that is what you know about your accountant. The
-- share is claimed when they sign in with that address; until then it sits
-- pending and grants nothing.

create table if not exists public.ledger_shares (
  id            uuid primary key default gen_random_uuid(),
  ledger_id     uuid not null references public.ledgers(id) on delete cascade,
  -- Filled by the database, not the client. The browser should not be the
  -- thing asserting who owns a share; auth.uid() already knows.
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email         text not null,
  role          text not null default 'viewer' check (role in ('viewer')),
  status        text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  note          text,
  unique (ledger_id, email)
);

alter table public.ledger_shares enable row level security;

-- The owner manages shares on their own ledgers.
drop policy if exists "owner manages shares" on public.ledger_shares;
create policy "owner manages shares" on public.ledger_shares
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- The invited person can see the row addressed to them, so the app can show
-- "shared with you" without the owner having to tell them.
drop policy if exists "invitee sees own share" on public.ledger_shares;
create policy "invitee sees own share" on public.ledger_shares
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create index if not exists ledger_shares_email_idx on public.ledger_shares (lower(email), status);

/* Can the signed-in user read this ledger?
   SECURITY DEFINER so the check itself is not subject to the policies it is
   used by, and STABLE so Postgres can cache it within a statement rather than
   running it per row. */
create or replace function public.can_read_ledger(lid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ledgers l
    where l.id = lid and l.user_id = auth.uid()
  ) or exists (
    select 1 from public.ledger_shares s
    where s.ledger_id = lid
      and s.status = 'active'
      and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.can_read_ledger(uuid) from public;
grant execute on function public.can_read_ledger(uuid) to authenticated;

/* Read access is granted by ADDING a policy, never by editing the owner's.
   Postgres OR's permissive policies together, so the existing
   "auth.uid() = user_id" rules keep working exactly as they did and a shared
   reader gets select on top. Rewriting eleven working policies to add a second
   condition to each is how you accidentally widen one of them. */
do $$
declare t text;
begin
  /* Only tables that actually have a ledger_id.
     The first version of this migration listed `settings` among them. It is
     keyed on user_id and has no ledger_id, so the statement failed, and
     because the SQL editor runs a script as one transaction the entire
     migration rolled back: no tables, no functions, nothing. The app then
     reported the tables as missing, which was true and gave no hint why.

     Checking the column rather than trusting a hand-written list means a table
     that does not fit is skipped instead of taking everything else with it. */
  foreach t in array array[
    'transactions', 'obligations', 'categories', 'credits',
    'balance_anchors', 'consolidations', 'filings', 'bank_transactions', 'import_rules'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, table not present', t;
      continue;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'ledger_id'
    ) then
      raise notice 'skipping %, no ledger_id column', t;
      continue;
    end if;

    execute format('drop policy if exists "shared read" on public.%I', t);
    execute format(
      'create policy "shared read" on public.%I for select to authenticated using (public.can_read_ledger(ledger_id))', t);
  end loop;
end $$;

/* `settings` is deliberately not in that list, and not just because of the
   column. It is one row per user holding preferences, not per ledger, so
   sharing it would hand a reader the owner's own settings rather than
   anything about the books. The figures that matter, the starting balance and
   the anchor date, live on the ledger row itself since 0007. */

-- The ledger row itself, so it can appear in their switcher.
drop policy if exists "shared read" on public.ledgers;
create policy "shared read" on public.ledgers
  for select to authenticated using (public.can_read_ledger(id));

/* bank_connections is deliberately absent from that list.
   It holds the Plaid access token, the cursor and the item id. An accountant
   needs to see the books, not the credential that fetches them, and a viewer
   who can read the token can pull the feed themselves outside the app. Shared
   readers see bank_transactions, which is the data, and not the key to it. */

-- ------------------------------------------------------------
-- 2. An intake link for suppliers
-- ------------------------------------------------------------
-- A link you send to a contractor. They fill in the invoice and it arrives in
-- a review queue. It does not become a payable until you accept it, because
-- anyone holding the link can submit anything.

create table if not exists public.invoice_links (
  id          uuid primary key default gen_random_uuid(),
  ledger_id   uuid not null references public.ledgers(id) on delete cascade,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token       text not null unique,
  label       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  submissions integer not null default 0
);

alter table public.invoice_links enable row level security;

drop policy if exists "owner manages invoice links" on public.invoice_links;
create policy "owner manages invoice links" on public.invoice_links
  for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create index if not exists invoice_links_token_idx on public.invoice_links (token) where active;

create table if not exists public.inbound_invoices (
  id            uuid primary key default gen_random_uuid(),
  ledger_id     uuid not null references public.ledgers(id) on delete cascade,
  link_id       uuid references public.invoice_links(id) on delete set null,
  party         text not null,
  contact_email text,
  invoice_no    text,
  description   text,
  amount        numeric not null check (amount > 0),
  tax_amount    numeric,
  tax_code      text,
  issue_date    date,
  due_date      date,
  currency      text not null default 'CAD',
  note          text,
  -- Reserved so adding a supplier upload later is not another migration.
  file_path     text,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  obligation_id uuid references public.obligations(id) on delete set null,
  submitted_at  timestamptz not null default now(),
  decided_at    timestamptz,
  submitted_ip  text
);

alter table public.inbound_invoices enable row level security;

-- Only the ledger owner reviews the queue. Not shared readers: accepting an
-- invoice creates a payable, which is a write, and a viewer does not write.
drop policy if exists "owner reviews inbound" on public.inbound_invoices;
create policy "owner reviews inbound" on public.inbound_invoices
  for all to authenticated
  using (exists (select 1 from public.ledgers l where l.id = ledger_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.ledgers l where l.id = ledger_id and l.user_id = auth.uid()));

create index if not exists inbound_invoices_queue_idx
  on public.inbound_invoices (ledger_id, status, submitted_at desc);

/* Submission runs through a function, not a table grant.
   The supplier is anonymous. Giving anon insert on inbound_invoices would mean
   giving it the ledger_id column to fill in, and then anyone could post an
   invoice into any ledger whose id they guessed. The function takes a token,
   resolves the ledger itself, and never exposes either. */
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

  -- A public endpoint needs a ceiling. Twenty in an hour on one link is far
  -- more than a supplier sends and far less than a script would.
  select count(*) into v_recent
  from public.inbound_invoices
  where link_id = v_link.id and submitted_at > now() - interval '1 hour';
  if v_recent >= 20 then
    return json_build_object('ok', false, 'error', 'Too many submissions on this link. Try again later.');
  end if;

  /* A file, if one was uploaded, but only under this ledger's own prefix.
     The path comes from /api/invoice-received, which resolves the token server
     side and signs an upload for a key it chooses. Checked again here because
     a server route can change and a free check should not depend on one. A
     path pointing anywhere else is dropped rather than rejected: the invoice
     details are worth keeping even when the attachment is wrong. */
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

/* What the supplier is allowed to see about the link they were sent: the
   business name, so the form does not look like a phishing page, and nothing
   else. Not the ledger id, not the owner, not what else has been submitted. */
create or replace function public.invoice_link_info(p_token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when l.id is null then json_build_object('ok', false)
              else json_build_object('ok', true, 'business', lg.name, 'label', l.label)
         end
  from (select 1) x
  left join public.invoice_links l on l.token = p_token and l.active
  left join public.ledgers lg on lg.id = l.ledger_id;
$$;

revoke all on function public.invoice_link_info(text) from public;
grant execute on function public.invoice_link_info(text) to anon, authenticated;

-- ------------------------------------------------------------
-- Did it work?
-- ------------------------------------------------------------
-- Four rows means yes. Fewer means something above did not run, and the
-- statement that failed will be in the editor's output.
select 'ledger_shares'   as object, to_regclass('public.ledger_shares')::text   as present
union all select 'invoice_links',    to_regclass('public.invoice_links')::text
union all select 'inbound_invoices', to_regclass('public.inbound_invoices')::text
union all select 'submit_invoice',   (select proname from pg_proc where proname = 'submit_invoice' limit 1);
