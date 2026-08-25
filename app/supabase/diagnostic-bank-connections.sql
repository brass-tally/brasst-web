-- ============================================================
-- Brasstally — bank connection diagnostic (READ ONLY)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
--
-- This is ONE statement on purpose. The SQL Editor only returns the last
-- statement's result, so the earlier multi-block version silently dropped
-- everything above it. Just hit Run and export/paste the whole result.
--
-- Output shape: 3 columns — section, sort_key, detail (JSON).
-- Nothing here writes. access_token is masked to an 8-char prefix, so the
-- output is safe to paste back into chat. Do NOT remove that masking.
-- ============================================================

with newest_per_item as (
  select distinct on (ledger_id, coalesce(item_id, id::text))
    ledger_id, current_balance
  from public.bank_connections
  order by ledger_id, coalesce(item_id, id::text), created_at desc
),

-- same institution linked more than once inside one ledger = the
-- "reconnect by connecting fresh" path already fired
dupes as (
  select
    ledger_id,
    institution,
    count(*)                                            as row_count,
    count(distinct item_id)                             as distinct_item_ids,
    sum(current_balance)                                as summed_balance_app_shows,
    array_agg(id::text order by created_at)             as connection_ids,
    array_agg(coalesce(item_id, '(null)') order by created_at) as item_ids,
    array_agg(current_balance order by created_at)      as balances
  from public.bank_connections
  group by ledger_id, institution
  having count(*) > 1
),

balance_check as (
  select
    bc.ledger_id,
    sum(bc.current_balance) as app_total,
    (select sum(n.current_balance) from newest_per_item n where n.ledger_id = bc.ledger_id) as deduped_total,
    count(*)                as connection_rows
  from public.bank_connections bc
  group by bc.ledger_id
),

-- same Plaid txn id under two connection_ids: the unique key is
-- (connection_id, plaid_txn_id), so a new connection row defeats dedupe
dupe_txns as (
  select ledger_id, count(*) as duplicated_txn_ids, sum(copies) as total_duplicate_rows
  from (
    select ledger_id, plaid_txn_id, count(*) as copies
    from public.bank_transactions
    group by ledger_id, plaid_txn_id
    having count(distinct connection_id) > 1
  ) z
  group by ledger_id
),

txn_state as (
  select
    bc.ledger_id,
    bc.institution,
    bc.id           as connection_id,
    bc.created_at   as conn_created,
    bc.last_synced,
    count(bt.id)                                          as txns,
    count(*) filter (where bt.status = 'matched')         as matched,
    count(*) filter (where bt.status = 'unmatched')       as unmatched,
    count(*) filter (where bt.status = 'ignored')         as ignored,
    count(*) filter (where bt.review_reason is not null)  as flagged_for_review,
    count(*) filter (where bt.removed_at is not null)     as removed,
    min(bt.date)                                          as earliest,
    max(bt.date)                                          as latest
  from public.bank_connections bc
  left join public.bank_transactions bt on bt.connection_id = bc.id
  group by bc.ledger_id, bc.institution, bc.id, bc.created_at, bc.last_synced
),

-- connection row gone but its transactions remain (past Disconnect);
-- normally empty
orphans as (
  select bt.ledger_id, bt.connection_id, count(*) as txns
  from public.bank_transactions bt
  left join public.bank_connections bc on bc.id = bt.connection_id
  where bc.id is null
  group by bt.ledger_id, bt.connection_id
)

select section, sort_key, detail
from (

  -- 1. every ledger, so I can tell which one is personal vs business
  select '1_ledger'::text as section, 1 as sort_key, to_jsonb(l) as detail
  from public.ledgers l

  union all

  -- 2. connection inventory — the main one
  select '2_connection', 2, jsonb_build_object(
    'email',            u.email,
    'ledger_id',        bc.ledger_id,
    'connection_id',    bc.id,
    'institution',      bc.institution,
    'item_id',          bc.item_id,
    'token_masked',     left(coalesce(bc.access_token, ''), 8) || '...',
    'has_cursor',       (bc.cursor is not null),
    'current_balance',  bc.current_balance,
    'balance_as_of',    bc.balance_as_of,
    'last_synced',      bc.last_synced,
    'days_since_sync',  round((extract(epoch from (now() - bc.last_synced)) / 86400.0)::numeric, 1),
    'created_at',       bc.created_at,
    'n_accounts',       jsonb_array_length(coalesce(bc.accounts, '[]'::jsonb))
  )
  from public.bank_connections bc
  left join auth.users u on u.id = bc.user_id

  union all

  -- 3. duplicate connections (empty = no double-count damage yet)
  select '3_duplicate_connection', 3, to_jsonb(d) from dupes d

  union all

  -- 4. is the dashboard cash figure overstated right now?
  select '4_balance_check', 4, jsonb_build_object(
    'ledger_id',        b.ledger_id,
    'app_total',        b.app_total,
    'deduped_total',    b.deduped_total,
    'overstated_by',    b.app_total - coalesce(b.deduped_total, 0),
    'connection_rows',  b.connection_rows
  )
  from balance_check b

  union all

  -- 5. account-level detail: which connection holds which real account
  select '5_account', 5, jsonb_build_object(
    'ledger_id',      bc.ledger_id,
    'institution',    bc.institution,
    'connection_id',  bc.id,
    'account_name',   a->>'name',
    'mask',           a->>'mask',
    'type',           a->>'type',
    'subtype',        a->>'subtype',
    'current',        a->>'current',
    'available',      a->>'available'
  )
  from public.bank_connections bc
  cross join lateral jsonb_array_elements(coalesce(bc.accounts, '[]'::jsonb)) a

  union all

  -- 6. re-imported duplicate transactions (empty = good)
  select '6_duplicate_txns', 6, to_jsonb(t) from dupe_txns t

  union all

  -- 7. per-connection reconciliation state
  select '7_txn_state', 7, to_jsonb(s) from txn_state s

  union all

  -- 8. orphaned transactions (empty = good)
  select '8_orphans', 8, to_jsonb(o) from orphans o

) x
order by sort_key, detail::text;
