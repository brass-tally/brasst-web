-- ============================================================
-- Adding a subscription by hand, and letting the bank confirm it.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0071. Safe to run twice.
--
-- Detection needs three charges, so anything new, annual, or paid on a card
-- that is not connected is invisible. The owner knows about it today and the
-- feed will agree in three months.
--
-- So: the same table. A manual entry is a tag with no charges behind it yet,
-- which means when the charges do appear they attach to it automatically
-- rather than arriving as a second, duplicate row. That is the whole reason
-- not to give manual subscriptions a table of their own.
-- ============================================================

alter table public.subscription_tags
  add column if not exists manual            boolean not null default false,
  add column if not exists expected_amount   numeric,
  add column if not exists expected_currency text,
  add column if not exists expected_cadence  text
    check (expected_cadence is null or expected_cadence in ('week', 'month', 'quarter', 'year')),
  add column if not exists started_on        date,
  add column if not exists next_due          date,
  -- Set the first time the feed shows a charge matching this key. Until then
  -- the figure is what the owner said it was, and the interface says so.
  add column if not exists verified_at       timestamptz,
  add column if not exists verified_amount   numeric;

/* What a manual entry costs per month, so it can sit in the same total as a
   detected one without anybody doing arithmetic in their head. */
create or replace function public.monthly_equivalent(p_amount numeric, p_cadence text)
returns numeric
language sql
immutable
as $$
  select case p_cadence
    when 'week'    then coalesce(p_amount, 0) * 52 / 12
    when 'month'   then coalesce(p_amount, 0)
    when 'quarter' then coalesce(p_amount, 0) / 3
    when 'year'    then coalesce(p_amount, 0) / 12
    else coalesce(p_amount, 0)
  end;
$$;

grant execute on function public.monthly_equivalent(numeric, text) to authenticated;

/* The cross-ledger view gains the manual fields, so a business ledger showing
   something paid on a personal card shows the same detail either way. */
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

select count(*) filter (where manual) as manual,
       count(*) filter (where verified_at is not null) as verified,
       count(*) as total
from public.subscription_tags;
