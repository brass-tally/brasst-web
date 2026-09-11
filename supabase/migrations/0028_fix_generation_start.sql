-- ============================================================
-- Stop the first month being raised twice.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0026. Safe to run twice.
--
-- last_period means "the last month already covered". Generation started AT
-- that month instead of after it, so accepting a monthly invoice created the
-- arrangement, and the next load immediately raised a second invoice for the
-- same month: the one you had just accepted.
--
-- A month either side of a boundary is the oldest bug in scheduling and it is
-- always this, so the loop now starts at last_period plus one month and the
-- name of the column is what it says.
-- ============================================================

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
    -- The month after the last one already covered. With no last_period, the
    -- month the arrangement was created, because that one is not covered yet.
    m := case
           when s.last_period is null
             then date_trunc('month', s.created_at)::date
           else (date_trunc('month', s.last_period)::date + interval '1 month')::date
         end;

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
        null;   -- already raised for this month
      end;

      -- Recorded per month, so an interrupted run resumes where it stopped
      -- rather than starting the whole catch-up again.
      update public.invoice_schedules set last_period = m where id = s.id;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  return made;
end;
$$;

revoke all on function public.generate_due_invoices(uuid) from public;
grant execute on function public.generate_due_invoices(uuid) to authenticated;

/* Clean up what the old version raised: an untouched auto-raised invoice for a
   month that already has an accepted one from the same arrangement. Only
   pending rows, only auto-raised ones, so nothing anybody decided is removed. */
delete from public.inbound_invoices d
 where d.status = 'pending'
   and d.schedule_id is not null
   and d.note = 'Raised automatically from a monthly arrangement'
   and exists (
     select 1 from public.inbound_invoices k
      where k.ledger_id = d.ledger_id
        and k.status = 'accepted'
        and k.party = d.party
        and k.amount = d.amount
        and date_trunc('month', coalesce(k.period, k.issue_date, k.submitted_at::date))
            = date_trunc('month', d.period)
   );

select count(*) as still_pending_auto
from public.inbound_invoices
where status = 'pending' and schedule_id is not null;
