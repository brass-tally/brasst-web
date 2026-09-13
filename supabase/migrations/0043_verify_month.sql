-- ============================================================
-- Does a month in the books agree with the bank?
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Read only. Changes nothing.
--
-- Set the two values below, then read the four results in order. The first
-- says whether the totals agree; the rest say why they do not.
--
-- Note on pending lines: a bank feed includes transactions the bank has not
-- settled yet, and those are not part of a month's activity. They are counted
-- separately here rather than being dropped, because a figure that is out by
-- exactly one pending payment is worth being able to see.
-- ============================================================

-- === EDIT THESE TWO, they appear in each query below ===
--   the ledger's name exactly as it appears in the app
--   the month as YYYY-MM

-- 1. The two totals, side by side.
with g as (
  select id from public.ledgers where name = 'Personal' limit 1
),
books as (
  select
    coalesce(sum(amount) filter (where type = 'income'), 0)  as money_in,
    coalesce(sum(amount) filter (where type = 'expense'), 0) as money_out,
    count(*) filter (where type = 'income')  as in_count,
    count(*) filter (where type = 'expense') as out_count
  from public.transactions
  where ledger_id = (select id from g)
    and to_char(date, 'YYYY-MM') = '2026-08'
),
bank as (
  select
    coalesce(sum(abs(amount)) filter (where direction = 'credit' and not pending), 0) as money_in,
    coalesce(sum(abs(amount)) filter (where direction <> 'credit' and not pending), 0) as money_out,
    count(*) filter (where direction = 'credit' and not pending)  as in_count,
    count(*) filter (where direction <> 'credit' and not pending) as out_count,
    count(*) filter (where pending) as pending_count
  from public.bank_transactions
  where ledger_id = (select id from g)
    and to_char(date, 'YYYY-MM') = '2026-08'
)
select
  'money in'  as side,
  books.money_in  as books,
  bank.money_in   as bank,
  round(books.money_in - bank.money_in, 2)  as difference,
  books.in_count  as book_entries,
  bank.in_count   as bank_lines
from books, bank
union all
select
  'money out',
  books.money_out, bank.money_out,
  round(books.money_out - bank.money_out, 2),
  books.out_count, bank.out_count
from books, bank;

-- 2. Bank lines that month with nothing in the books behind them.
--    These are the whole of the difference unless something below says otherwise.
select b.date, b.direction, abs(b.amount) as amount, left(b.description, 48) as description, b.pending
from public.bank_transactions b
where b.ledger_id = (select id from public.ledgers where name = 'Personal' limit 1)
  and to_char(b.date, 'YYYY-MM') = '2026-08'
  and b.status not in ('matched', 'ignored')
order by abs(b.amount) desc;

-- 3. Entries in the books with no bank line behind them.
--    Cash, credits, transfers between your own accounts, and anything typed in
--    by hand all live here legitimately. Anything else is worth a look.
select t.date, t.type, t.amount, t.category, left(t.description, 40) as description, t.pay_method
from public.transactions t
where t.ledger_id = (select id from public.ledgers where name = 'Personal' limit 1)
  and to_char(t.date, 'YYYY-MM') = '2026-08'
  and not exists (
    select 1 from public.bank_transactions b
     where b.matched_tx_id = t.id
  )
order by t.amount desc;

-- 4. Pending lines, counted apart because the bank has not settled them.
select b.date, b.direction, abs(b.amount) as amount, left(b.description, 48) as description
from public.bank_transactions b
where b.ledger_id = (select id from public.ledgers where name = 'Personal' limit 1)
  and to_char(b.date, 'YYYY-MM') = '2026-08'
  and b.pending
order by b.date;
