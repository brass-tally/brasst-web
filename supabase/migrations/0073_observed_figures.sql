-- ============================================================
-- What the bank showed, carried to the ledger that answers for it.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0072. Safe to run twice.
--
-- A subscription detected on the personal feed and tagged as belonging to the
-- business arrived on the business ledger as a name and nothing else. The
-- figures live in the personal bank feed, which the business ledger has no
-- business reading, so every row said "amount not recorded".
--
-- The personal side now writes what it observed into the tag each time it
-- works it out. The business side reads the tag. Neither ledger reaches into
-- the other's bank lines, which is the boundary that matters.
-- ============================================================

alter table public.subscription_tags
  add column if not exists observed_amount    numeric,
  add column if not exists observed_monthly   numeric,
  add column if not exists observed_low       numeric,
  add column if not exists observed_high      numeric,
  add column if not exists observed_kind      text,
  add column if not exists observed_cadence   text,
  add column if not exists observed_charges   integer,
  add column if not exists first_charged      date,
  add column if not exists last_charged       date,
  add column if not exists observed_status    text,
  add column if not exists observed_at        timestamptz;

notify pgrst, 'reload schema';

select count(*) filter (where observed_at is not null) as with_figures,
       count(*) filter (where charged_to is not null)  as shared,
       count(*)                                         as total
from public.subscription_tags;
