-- ============================================================
-- Close two openings in the beta tables.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
--
-- Nothing here touches ledger data. Only beta_signups and beta_feedback.
--
-- 1. beta_signups was readable by anyone. The policy was
--       for select using (true)
--    with `grant select ... to anon`, so an anonymous request to
--    /rest/v1/beta_signups?select=email returned the whole waitlist using the
--    publishable key that ships in the frontend bundle. Verified live before
--    writing this: the request returned 206 with a row count rather than 401.
--
-- 2. beta_feedback allowed any signed-in user to read every anonymous
--    submission, because the policy said
--       using (auth.uid() = user_id or user_id is null)
--    The `or user_id is null` half matches every row left by a logged-out
--    user. No such rows exist yet, which is the good moment to fix it.
-- ============================================================

-- ---------- beta_signups ----------

-- The list itself is not something anyone should be able to enumerate.
revoke select on public.beta_signups from anon;

drop policy if exists "users can view their own signups" on public.beta_signups;

-- A signed-in person may confirm their own row, matched on the email in their
-- JWT. Everyone else, including anon, sees nothing.
drop policy if exists "signups: read only your own row" on public.beta_signups;
create policy "signups: read only your own row"
  on public.beta_signups
  for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Signing up stays open, which it has to be for a public landing page. Note the
-- unique constraint on email means a duplicate request returns 409, so the
-- endpoint can still be used to test whether an address is on the list. If that
-- matters, move signups behind an Edge Function that always answers the same.
drop policy if exists "anyone can insert beta signups" on public.beta_signups;
drop policy if exists "signups: anyone may join" on public.beta_signups;
create policy "signups: anyone may join"
  on public.beta_signups
  for insert
  to anon, authenticated
  with check (true);

-- ---------- beta_feedback ----------

drop policy if exists "users can view their own feedback" on public.beta_feedback;

drop policy if exists "feedback: read only your own" on public.beta_feedback;
create policy "feedback: read only your own"
  on public.beta_feedback
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Submitting stays open so logged-out users can report a problem.
drop policy if exists "allow public to submit feedback" on public.beta_feedback;
drop policy if exists "feedback: anyone may submit" on public.beta_feedback;
create policy "feedback: anyone may submit"
  on public.beta_feedback
  for insert
  to anon, authenticated
  with check (true);

-- The service role bypasses RLS, so the old update policy was decorative.
-- Dropping it removes a rule that implied a protection it did not provide.
drop policy if exists "only admins can update feedback" on public.beta_feedback;

-- ---------- verify ----------
-- Re-run this from a logged-out client and expect zero rows, not a list:
--   select * from public.beta_signups;
