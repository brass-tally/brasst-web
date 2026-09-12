-- ============================================================
-- Let an owner open a file their supplier uploaded.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0022. Safe to run twice.
--
-- The storage policy from 0001 reads:
--
--   (storage.foldername(name))[1] = auth.uid()::text
--
-- Every file a user uploads lands under their own id, which was right until
-- supplier intake existed. A supplier has no account, so their upload is
-- written by the service role to inbound/<ledger_id>/<uuid>, and the first
-- folder is the word "inbound".
--
-- The file uploaded fine and was stored fine. The owner simply could not sign
-- a URL for it, so "See the invoice" reported the file as missing when it was
-- sitting there the whole time.
-- ============================================================

drop policy if exists "read inbound files" on storage.objects;
create policy "read inbound files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = 'inbound'
    -- Second folder is the ledger. You may read it if you may read that ledger,
    -- which means an accountant with shared access can open the invoice too.
    and public.can_read_ledger(((storage.foldername(name))[2])::uuid)
  );

/* Deleting one, for when a payable is voided and its evidence goes with it.
   Owners only: a shared reader can open the file and not remove it. */
drop policy if exists "delete inbound files" on storage.objects;
create policy "delete inbound files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = 'inbound'
    and public.owns_ledger(((storage.foldername(name))[2])::uuid)
  );

select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like '%inbound%'
order by policyname;
