-- ============================================================
-- Remembered filing rules.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
--
-- When a bank line has no entry behind it, you tell the app what it is once.
-- The same line arrives every month and you tell it again. This table is the
-- app remembering.
--
-- The key is a signature of the description with the variable parts removed:
-- reference numbers, dates and the amount. "e-Transfer Request Fulfilled fee"
-- keeps its shape while "Online transfer sent - 7098" becomes
-- "online transfer sent". That is the opposite of what the duplicate detector
-- needs, and deliberately so: there, digits distinguish two events; here, they
-- are the noise between two instances of the same recurring thing.
-- ============================================================

create table if not exists public.import_rules (
  id           uuid primary key default gen_random_uuid(),
  ledger_id    uuid not null references public.ledgers(id) on delete cascade,
  signature    text not null,
  direction    text not null check (direction in ('debit', 'credit')),
  category     text not null,
  subcategory  text,
  -- The amount the rule was learned from, kept for display only. A rule is not
  -- restricted to one amount: a bank fee is the same category at $1.50 or $2.
  learned_from numeric,
  times_used   integer not null default 0,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  unique (ledger_id, signature, direction)
);

alter table public.import_rules enable row level security;

drop policy if exists "own import rules" on public.import_rules;
create policy "own import rules" on public.import_rules
  for all
  using (
    exists (
      select 1 from public.ledgers l
      where l.id = import_rules.ledger_id and l.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.ledgers l
      where l.id = import_rules.ledger_id and l.user_id = auth.uid()
    )
  );

create index if not exists import_rules_lookup_idx
  on public.import_rules (ledger_id, signature);

-- Which entries were created by a rule rather than by hand. Needed so a run can
-- be undone and so the history can say what happened, and nullable so every
-- existing row stays valid.
alter table public.transactions
  add column if not exists rule_id uuid references public.import_rules(id) on delete set null;

create index if not exists transactions_rule_idx
  on public.transactions (ledger_id, rule_id)
  where rule_id is not null;
