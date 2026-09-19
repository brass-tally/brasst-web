-- ============================================================
-- What Plaid support found, written down.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0054. Safe to run twice.
--
-- Case #899487. Plaid listed nine inactive Items and one further active Item
-- against this user, all of which were made by the connect flow before it
-- learned to reuse an existing Item. They are the reason the RBC connection
-- keeps losing its session.
--
-- This records their ids so they can be removed by the `remove_orphans`
-- action, which needs a token and can only find one in our own rows. It does
-- not remove anything.
-- ============================================================

/* A note of where each id came from, so a year from now the list is not a
   mystery. */
alter table public.retired_bank_items
  add column if not exists source text;

/* An Item we know about but hold no token for.
 *
 * The table was built for tokens being retired, so it required one. That was
 * right for its original job and wrong for this: the whole difficulty with
 * these nine is that the token was thrown away, which is precisely the case
 * most worth recording.
 *
 * A row with no token is not an incomplete record. It is the record that says
 * "only Plaid can remove this one", which is what the removal action reads it
 * as, and what turns nine unknown ids into a list you can send support.
 *
 * I should have read this table's definition before writing to it. Twice. */
alter table public.retired_bank_items
  alter column access_token drop not null;

/* Rows for anything we do not already have.
 *
 * `user_id` is not null on this table and `auth.uid()` is null in the SQL
 * editor, which is what the first version of this migration tripped over.
 *
 * The owner is taken from the live RBC connection instead. These Items were
 * all made by the same person connecting the same bank over and over, so that
 * is the right answer rather than a convenient one, and deriving it means
 * nobody has to paste a user id into a migration.
 */
do $$
declare
  v_user uuid;
  v_ledger uuid;
  v_made int := 0;
  v_id text;
  v_ids text[] := array[
    'LoMJ3Pr6QnhmB5LnX1mBF3oRmbE9vbioxkom4',
    'LoYXJrrD5EsKeomAze6Ahyd0Byb4xbUoRrLE3',
    'ak7vkV7j1VsKq184p4PMha7vneLLdgtj4j7bm',
    'yDmVdQaN3AF9eJZ7weXzhkd58ZzyDktX9Keek',
    'OE6YzOQRwmF3dVYEV5drubmOYY4MKgHoezjpM',
    'DbpMMOyjZ9cEVDr84Dr1spm057yeDNFYg3Pqg',
    'a31ny1YAJMfJK56j7L5QCK474A77k7IjbOPX5',
    'EoBxPDpAjjIPm1zwRe1DURpOvvZeJNf6L7p4V',
    'KorBMpkA7jhQXeROVYopH1jYaLY9AXHdNwN80'
  ];
begin
  /* The live Item Plaid told us to keep. If it is here, its owner owns the
     orphans too. */
  select user_id, ledger_id into v_user, v_ledger
    from public.bank_connections
   where item_id = 'mBberALBBYC3ojdd418Nfx6Zk69dEMIrQeEzp'
   limit 1;

  /* Failing that, any connection at all: this project has one owner, and a
     wrong guess here is visible and harmless because the row is only a note. */
  if v_user is null then
    select user_id, ledger_id into v_user, v_ledger
      from public.bank_connections order by created_at limit 1;
  end if;

  if v_user is null then
    raise exception
      'No bank connection found to take an owner from. Connect a bank first, or add the user_id by hand.';
  end if;

  foreach v_id in array v_ids loop
    if not exists (select 1 from public.retired_bank_items r where r.item_id = v_id) then
      insert into public.retired_bank_items
        (user_id, ledger_id, item_id, reason, source, retired_at)
      values
        (v_user, v_ledger, v_id, 'orphaned item, plaid case 899487', 'plaid support', now());
      v_made := v_made + 1;
    end if;
  end loop;

  raise notice 'recorded % of % orphaned items against %', v_made, array_length(v_ids, 1), v_user;
end $$;

notify pgrst, 'reload schema';

/* What you can remove yourself, and what only support can.
 *
 * The Item to keep (mBberALB…) and the second active one (9ZkQqX03…, the 5651
 * account) are deliberately not in the list above. The first is the live
 * connection. The second is a decision rather than a cleanup: Plaid called it
 * active, and only you know whether that account is still wanted.
 */
select
  r.item_id,
  case
    when b.id is not null then 'LIVE - attached to a ledger, will not be removed'
    when r.removed_at is not null then 'already removed'
    when r.access_token is not null then 'removable by us'
    else 'no token - ask Plaid support to remove'
  end as status
from public.retired_bank_items r
left join public.bank_connections b on b.item_id = r.item_id
where r.source = 'plaid support'
order by status, r.item_id;
