-- ============================================================
-- Tally's transcript, kept where every device can reach it.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Safe to run twice.
--
-- It lived in the browser's own storage, so the phone and the desktop each
-- had a different conversation with the same bookkeeper, and a card drawn on
-- one was invisible on the other.
--
-- Scoped to a user AND a ledger, not just a ledger. An accountant reading
-- shared books has their own thread: they should not see what the owner asked,
-- and the owner should not see theirs.
-- ============================================================

create table if not exists public.chat_messages (
  id         bigserial primary key,
  ledger_id  uuid not null references public.ledgers(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

/* Your own thread, on any ledger you can open. Deliberately not tied to
   owning the ledger: a shared reader can talk to Tally about books they can
   read, and those messages are theirs. */
drop policy if exists "own chat" on public.chat_messages;
create policy "own chat" on public.chat_messages
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_read_ledger(ledger_id));

create index if not exists chat_messages_thread
  on public.chat_messages (user_id, ledger_id, id);

/* Realtime, so a card tapped on the phone stops waiting on the desktop.
   Without this the app still works, it just syncs on load rather than live. */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

/* Keep the last 200 per thread. A transcript is a working record, not an
   archive, and an unbounded one eventually costs a slow first paint on the
   device with the worst connection. */
create or replace function public.trim_chat_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.chat_messages c
   where c.user_id = new.user_id
     and c.ledger_id = new.ledger_id
     and c.id < (
       select min(id) from (
         select id from public.chat_messages
          where user_id = new.user_id and ledger_id = new.ledger_id
          order by id desc limit 200
       ) keep
     );
  return null;
end;
$$;

drop trigger if exists chat_messages_trim on public.chat_messages;
create trigger chat_messages_trim
  after insert on public.chat_messages
  for each row execute function public.trim_chat_thread();

select 'chat_messages' as object, to_regclass('public.chat_messages')::text as present,
       (select count(*) from pg_publication_tables
         where pubname = 'supabase_realtime' and tablename = 'chat_messages') as in_realtime;
