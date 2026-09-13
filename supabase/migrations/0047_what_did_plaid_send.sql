-- ============================================================
-- What did the bank actually send us?
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Read only. Changes nothing. Takes a second.
--
-- Everything else is downstream of this. If a transaction is not in this
-- table, no amount of work on a card will make it appear, and if it is here
-- then the fault is ours and I can find it in one look.
-- ============================================================

-- 1. The last ten lines the feed holds, newest first.
select b.date, b.direction, b.amount, b.pending, b.status,
       left(b.description, 44) as description
from public.bank_transactions b
join public.ledgers g on g.id = b.ledger_id
where g.name = 'Personal'
order by b.date desc, b.amount desc
limit 10;

-- 2. Day by day for September: how many, how much, how many pending.
select b.date,
       count(*)                                           as lines,
       count(*) filter (where b.pending)                  as pending,
       sum(b.amount) filter (where b.direction = 'credit') as money_in,
       sum(abs(b.amount)) filter (where b.direction <> 'credit') as money_out
from public.bank_transactions b
join public.ledgers g on g.id = b.ledger_id
where g.name = 'Personal'
  and to_char(b.date, 'YYYY-MM') = '2026-09'
group by b.date
order by b.date desc;

-- 3. The connection itself: when it was last synced and what it says.
--    The column is `institution`, not `institution_name`. My mistake, and the
--    kind a schema check would have caught before you ran it.
select c.institution, c.last_synced, c.status, c.status_code, c.status_error,
       c.current_balance, c.balance_as_of, c.cursor is not null as has_cursor
from public.bank_connections c
join public.ledgers g on g.id = c.ledger_id
where g.name = 'Personal';
