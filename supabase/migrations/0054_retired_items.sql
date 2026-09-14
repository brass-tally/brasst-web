-- ============================================================
-- Keep the tokens of Items we stop using, so they can be removed.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Safe to run twice.
--
-- Plaid has no endpoint that lists your Items. An Item is reachable only
-- through its access token, so the moment we overwrite or delete a token, that
-- Item becomes invisible to us and stays alive at Plaid: refreshing on their
-- schedule, signing in to the bank, and at an institution that permits one
-- session per login, knocking out whichever Item is currently in use.
--
-- Two places lost tokens. Disconnect deleted the row without telling Plaid,
-- and a re-link overwrote the token on the row it adopted. Both are fixed, but
-- neither fix helps with a token that is already gone.
--
-- So from now on a retired token is written here first. Nothing about it is
-- useful to anybody except for removing the Item it belongs to.
-- ============================================================

create table if not exists public.retired_bank_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ledger_id    uuid references public.ledgers (id) on delete set null,
  item_id      text,
  access_token text not null,
  institution  text,
  reason       text,
  retired_at   timestamptz not null default now(),
  removed_at   timestamptz
);

alter table public.retired_bank_items enable row level security;

/* Nobody reads this from the browser. The edge function uses the service role;
   the policy exists so the table is not open by accident. */
drop policy if exists "own retired items" on public.retired_bank_items;
create policy "own retired items" on public.retired_bank_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists retired_pending
  on public.retired_bank_items (removed_at) where removed_at is null;

select to_regclass('public.retired_bank_items')::text as created;
