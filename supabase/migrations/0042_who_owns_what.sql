-- ============================================================
-- Who owns each ledger, and who can read it.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Read only. Changes nothing.
--
-- The app marks a ledger read only when its owner is not you:
--
--   readOnly = ledger.user_id !== auth.uid()
--
-- If your personal ledger is refusing writes, that comparison is coming out
-- true, and this says why. Three possibilities and they need different
-- answers:
--
--   the ledger belongs to another account you once used
--   you are signed in as a different account than you think
--   the ledger has no owner at all, from before multi-ledger
-- ============================================================

select
  g.name                                   as ledger,
  g.kind,
  g.user_id                                as owner_id,
  au.email                                 as owner_email,
  case
    when g.user_id is null then 'NO OWNER, writes will be refused'
    when g.user_id = auth.uid() then 'yours, writable'
    else 'owned by someone else, read only for you'
  end                                      as verdict,
  (select count(*) from public.ledger_shares s
    where s.ledger_id = g.id and s.status = 'active')  as readers
from public.ledgers g
left join auth.users au on au.id = g.user_id
order by g.created_at;

-- And who you are right now, so the comparison above can be checked by eye.
select auth.uid() as signed_in_as,
       (select email from auth.users where id = auth.uid()) as signed_in_email;
