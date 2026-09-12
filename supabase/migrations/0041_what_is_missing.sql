-- ============================================================
-- Which migrations has this database actually had?
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Read only. Changes nothing.
--
-- Forty migrations have been written across this project and there is no
-- record of which ones were run. The app degrades quietly when a table is
-- absent, which is the right behaviour and means a missing migration shows up
-- weeks later as a feature that seems not to work.
--
-- Every row that says MISSING is a feature that is off.
-- ============================================================

with expected(mig, object, kind, feature) as (values
  ('0012', 'bank_transactions',    'table', 'Bank lines'),
  ('0014', 'consolidations',       'table', 'Consolidation history'),
  ('0015', 'filings',              'table', 'Tax filings'),
  ('0020', 'tax_code',             'column','Tax treatment per entry'),
  ('0021', 'import_rules',         'table', 'Filing rules, so a line is categorised once'),
  ('0022', 'ledger_shares',        'table', 'Read access for an accountant'),
  ('0022', 'invoice_links',        'table', 'Supplier intake links'),
  ('0022', 'inbound_invoices',     'table', 'Invoices sent to you'),
  ('0026', 'invoice_schedules',    'table', 'Monthly arrangements'),
  ('0029', 'contacts',             'table', 'Contacts'),
  ('0031', 'owns_ledger',          'func',  'Write isolation, a reader cannot edit your books'),
  ('0032', 'chat_messages',        'table', 'Tally transcript, synced across devices'),
  ('0033', 'currency',             'column','Currency on supplier invoices'),
  ('0035', 'line_items',           'column','Invoice line items'),
  ('0036', 'invoice_link_invites', 'table', 'Who holds an intake link'),
  ('0038', 'thread',               'column','A new conversation each morning')
)
select
  e.mig as migration,
  e.feature,
  case
    when e.kind = 'table' and to_regclass('public.' || e.object) is not null then 'ok'
    when e.kind = 'func'  and exists (select 1 from pg_proc where proname = e.object) then 'ok'
    when e.kind = 'column' and exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and column_name = e.object
    ) then 'ok'
    else 'MISSING'
  end as state
from expected e
order by (case
    when e.kind = 'table' and to_regclass('public.' || e.object) is not null then 1
    when e.kind = 'func'  and exists (select 1 from pg_proc where proname = e.object) then 1
    when e.kind = 'column' and exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and column_name = e.object
    ) then 1
    else 0
  end), e.mig;
