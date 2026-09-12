-- ============================================================
-- A new conversation each morning.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0032. Safe to run twice.
--
-- One endless transcript is the wrong shape for a bookkeeper you speak to
-- daily: yesterday's questions are answered and in the way, and there is
-- nowhere for "what happened overnight" to live.
--
-- A thread is a date, in Eastern time, rolling at 7am rather than midnight.
-- Something asked at 11pm belongs to that day's conversation, not to the one
-- starting while you sleep.
-- ============================================================

alter table public.chat_messages
  add column if not exists thread date;

/* Existing messages belong to the day they were sent, so nothing is orphaned
   and yesterday's conversation stays readable. */
update public.chat_messages
   set thread = ((created_at at time zone 'America/New_York') - interval '7 hours')::date
 where thread is null;

create index if not exists chat_messages_by_thread
  on public.chat_messages (user_id, ledger_id, thread, id);

/* The threads a person has, newest first, for the history list. Counting in
   the database rather than fetching every message to count them in the
   browser. */
create or replace function public.chat_threads(p_ledger uuid, p_limit integer default 30)
returns table (thread date, messages bigint, last_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select thread, count(*), max(created_at)
  from public.chat_messages
  where user_id = auth.uid() and ledger_id = p_ledger and thread is not null
  group by thread
  order by thread desc
  limit greatest(1, least(coalesce(p_limit, 30), 120));
$$;

revoke all on function public.chat_threads(uuid, integer) from public;
grant execute on function public.chat_threads(uuid, integer) to authenticated;

select 'thread' as column,
       (select count(*) from information_schema.columns
         where table_schema='public' and table_name='chat_messages' and column_name='thread') as present;
