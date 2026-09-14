-- ============================================================
-- What did the bank actually send us?
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Read only. Changes nothing.
--
-- No ledger name to fill in. The first version asked you to edit 'Personal'
-- in three places, your ledger is called something else, and the result was a
-- query that ran perfectly and returned nothing. A diagnostic that can be
-- silently wrong about which rows it is reading is worse than no diagnostic.
--
-- Run the statements one at a time: the SQL editor shows only the last
-- result when several are run together.
-- ============================================================

-- 1. The last five lines per ledger, newest first.
select ledger, date, direction, amount, pending, status, description
from (
  select g.name as ledger, b.date, b.direction, b.amount, b.pending, b.status,
         left(b.description, 40) as description,
         row_number() over (partition by g.name order by b.date desc, b.amount desc) as rn
  from public.bank_transactions b
  join public.ledgers g on g.id = b.ledger_id
) ranked
where rn <= 5
order by ledger, date desc;

-- 2. This month, day by day, per ledger.
select g.name as ledger, b.date,
       count(*)                                                  as lines,
       count(*) filter (where b.pending)                         as pending,
       sum(b.amount) filter (where b.direction = 'credit')        as money_in,
       sum(abs(b.amount)) filter (where b.direction <> 'credit')  as money_out
from public.bank_transactions b
join public.ledgers g on g.id = b.ledger_id
where b.date >= date_trunc('month', current_date)
group by g.name, b.date
order by g.name, b.date desc;

-- 3. Every connection, and what it says about itself.
select g.name as ledger, c.institution, c.last_synced, c.status, c.status_code,
       c.status_error, c.current_balance, c.balance_as_of,
       c.cursor is not null as has_cursor
from public.bank_connections c
join public.ledgers g on g.id = c.ledger_id
order by g.name;
