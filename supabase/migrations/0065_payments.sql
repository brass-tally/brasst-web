-- ============================================================
-- Taking card payments on an invoice.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0063 and 0064. Safe to run twice.
--
-- Two decisions worth knowing, because both are hard to reverse.
--
-- **No credential is stored here.** A secret key in a row is a live key in
-- every backup and every leak, and encrypting it in-column moves the problem
-- to wherever the decryption key lives. The keys are Supabase secrets, read
-- only inside the edge runtime.
--
-- **The rows are shaped for Stripe Connect** even though this uses one
-- account: `account_ref` is what Connect fills in when a platform onboards
-- many sellers, so that migration is a backfill rather than a redesign.
-- ============================================================

create table if not exists public.payment_providers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ledger_id   uuid not null references public.ledgers (id) on delete cascade,
  provider    text not null check (provider in ('stripe', 'paypal', 'square')),

  -- Which account at the provider. One project's own account today; a
  -- connected account tomorrow. No secret, ever.
  account_ref text,
  enabled     boolean not null default false,
  -- Their charge, or yours. Recorded because it changes what you are owed.
  fees_to     text not null default 'me' check (fees_to in ('me', 'them')),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (ledger_id, provider)
);

alter table public.payment_providers enable row level security;

drop policy if exists "own providers" on public.payment_providers;
create policy "own providers" on public.payment_providers
  for all to authenticated
  using (public.owns_ledger(ledger_id))
  with check (public.owns_ledger(ledger_id));

/* What the provider told us happened.
 *
 * One row per attempt, not per invoice: a customer who tries a card that fails
 * and then pays with another has two, and both matter when somebody asks why
 * the first did not go through.
 *
 * `raw` keeps the event as it arrived. When a figure here and a figure at the
 * provider disagree, the argument is settled by what they actually sent rather
 * than by what we chose to read from it.
 */
create table if not exists public.invoice_payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users (id) on delete cascade,
  ledger_id     uuid not null references public.ledgers (id) on delete cascade,
  invoice_id    uuid references public.sent_invoices (id) on delete set null,

  provider      text not null,
  provider_ref  text not null,          -- their id for the payment
  session_ref   text,                   -- their id for the checkout

  amount        numeric not null default 0,
  fee           numeric not null default 0,
  net           numeric not null default 0,
  currency      text not null default 'CAD',

  status        text not null default 'pending'
                  check (status in ('pending', 'paid', 'failed', 'refunded')),
  paid_at       timestamptz,
  raw           jsonb,

  -- What it became in the books, once somebody confirmed it.
  transaction_id uuid references public.transactions (id) on delete set null,
  confirmed_at   timestamptz,

  created_at    timestamptz not null default now(),
  unique (provider, provider_ref)
);

alter table public.invoice_payments enable row level security;

drop policy if exists "own invoice payments" on public.invoice_payments;
create policy "own invoice payments" on public.invoice_payments
  for all to authenticated
  using (public.owns_ledger(ledger_id))
  with check (public.owns_ledger(ledger_id));

create index if not exists invoice_payments_by_invoice
  on public.invoice_payments (invoice_id, status);
create index if not exists invoice_payments_unconfirmed
  on public.invoice_payments (ledger_id) where confirmed_at is null and status = 'paid';

/* The invoice carries where to pay, so the page can show a button. */
alter table public.sent_invoices
  add column if not exists pay_url text,
  add column if not exists pay_provider text;

/* Which providers a customer may use, on the public invoice page. No keys, no
 * account references: only which buttons to draw. */
create or replace function public.invoice_pay_options(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.sent_invoices%rowtype;
begin
  select * into v from public.sent_invoices where token = p_token and status = 'sent' limit 1;
  if not found then return json_build_object('ok', true, 'providers', '[]'::json); end if;

  return json_build_object(
    'ok', true,
    'pay_url', v.pay_url,
    'provider', v.pay_provider,
    'providers', (
      select coalesce(json_agg(provider order by provider), '[]'::json)
      from public.payment_providers
      where ledger_id = v.ledger_id and enabled
    )
  );
end;
$$;

revoke all on function public.invoice_pay_options(text) from public;
grant execute on function public.invoice_pay_options(text) to anon, authenticated;

notify pgrst, 'reload schema';

select to_regclass('public.invoice_payments')::text as payments,
       to_regclass('public.payment_providers')::text as providers;
