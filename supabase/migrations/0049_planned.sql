-- ============================================================
-- Money you mean to spend, kept apart from money you owe.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Safe to run twice.
--
-- A payable is somebody else's claim on you: they expect the money and will
-- chase it. A planned expense is your own intention, and you can change your
-- mind about it for nothing.
--
-- They are in separate tables rather than one table with a flag, because
-- every existing query that reads obligations would otherwise start counting
-- intentions as debts. "You owe them" is a figure people make decisions
-- against, and a trip you might take does not belong in it.
-- ============================================================

create table if not exists public.planned_expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ledger_id   uuid not null references public.ledgers (id) on delete cascade,
  label       text not null,
  amount      numeric not null default 0,
  category    text,
  -- What kind of thing it is, so a list of twelve reads as three groups.
  bucket      text not null default 'other'
                check (bucket in ('travel', 'equipment', 'software', 'people', 'tax', 'other')),
  -- Roughly when, because a plan rarely has a due date.
  expected_on date,
  note        text,
  status      text not null default 'planned'
                check (status in ('planned', 'committed', 'dropped')),
  -- Set when it becomes a real bill, so the plan can point at what it became.
  obligation_id uuid references public.obligations (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.planned_expenses enable row level security;

drop policy if exists "own planned" on public.planned_expenses;
create policy "own planned" on public.planned_expenses
  for all to authenticated
  using (public.owns_ledger(ledger_id))
  with check (public.owns_ledger(ledger_id));

create index if not exists planned_by_ledger
  on public.planned_expenses (ledger_id, status, expected_on);

select to_regclass('public.planned_expenses')::text as created;
