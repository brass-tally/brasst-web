-- ============================================================
-- Tagging a subscription, and showing it on the right ledger.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0001. Safe to run twice.
--
-- A personal card paying for business software is the ordinary case for an
-- owner-operator, not an edge case. The charge lands on the personal feed and
-- the cost belongs to the company, and until now there was nowhere to say so.
--
-- Detection stays derived: nothing here stores a subscription. What is stored
-- is the person's judgement about one, which is the part a computer cannot
-- work out and the part that must survive the next sync.
-- ============================================================

create table if not exists public.subscription_tags (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,

  /* The ledger whose feed the charges appear in. */
  ledger_id    uuid not null references public.ledgers (id) on delete cascade,

  /* The normalised merchant key, which is how detection groups charges.
     Stable across statements: the reference number changes, the key does not. */
  payee_key    text not null,

  /* What the person calls it, when the bank's name is not good enough. */
  label        text,

  /* Whose cost it is, which is the whole point of this table. */
  side         text not null default 'unset'
                 check (side in ('unset', 'business', 'personal', 'mixed')),

  /* Where it should also appear, when the charge is on one ledger and the
     cost belongs to another. */
  charged_to   uuid references public.ledgers (id) on delete set null,

  /* A business share, for something used by both. 0.6 means 60% business. */
  business_share numeric check (business_share >= 0 and business_share <= 1),

  category     text,
  note         text,
  hidden       boolean not null default false,
  cancelled_on date,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (ledger_id, payee_key)
);

alter table public.subscription_tags enable row level security;

drop policy if exists "own subscription tags" on public.subscription_tags;
create policy "own subscription tags" on public.subscription_tags
  for all to authenticated
  using (public.owns_ledger(ledger_id))
  with check (public.owns_ledger(ledger_id));

create index if not exists subscription_tags_by_ledger
  on public.subscription_tags (ledger_id, hidden);

/* Subscriptions charged elsewhere that belong to this ledger.
 *
 * The business ledger asks "what software am I paying for", and the honest
 * answer includes the things on the owner's personal card. This returns the
 * tags pointing here, and the interface pairs them with the charges from the
 * feed they actually live in.
 */
create or replace function public.subscriptions_charged_to(p_ledger_id uuid)
returns setof public.subscription_tags
language sql
stable
security definer
set search_path = public
as $$
  select t.*
    from public.subscription_tags t
   where t.charged_to = p_ledger_id
     and t.ledger_id <> p_ledger_id
     and not t.hidden
     and public.owns_ledger(p_ledger_id)
     and public.owns_ledger(t.ledger_id);
$$;

grant execute on function public.subscriptions_charged_to(uuid) to authenticated;

notify pgrst, 'reload schema';

select to_regclass('public.subscription_tags')::text as created;
