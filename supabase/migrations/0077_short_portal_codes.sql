-- ============================================================
-- A short address for every supplier page, including ones already opened.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0062. Safe to run twice.
--
--   before   /c/syed-belal/a7f3c91e42b8d05f16a2c9
--   after    /c/syed-belal/k7m2q9xr
--
-- 0062 only shortened links nobody had opened yet, because an opened link may
-- be bookmarked. So anyone who had used their page kept the long one.
--
-- This gives every page a short code WITHOUT replacing its token. The page
-- looks the token up from the code it was opened with, so:
--
--   - the short address works
--   - the old long address still works, so no bookmark breaks
--   - every server function keeps taking the token exactly as before,
--     and none of them needed changing
--
-- Eight characters from a 31 character alphabet is about 40 bits, a little
-- under a trillion possibilities, for a page holding one supplier's invoices.
-- ============================================================

alter table public.contact_portals
  add column if not exists short_code text;

create unique index if not exists contact_portals_short_code
  on public.contact_portals (short_code)
  where short_code is not null;

/* One at a time, retrying on the vanishingly rare collision, rather than a
   single UPDATE that the unique index would abort entirely. */
do $$
declare
  r record;
  v text;
begin
  for r in select id from public.contact_portals where short_code is null loop
    loop
      v := public.short_token(8);
      begin
        update public.contact_portals set short_code = v where id = r.id;
        exit;
      exception when unique_violation then
        -- try another
      end;
    end loop;
  end loop;
end $$;

/* New pages get one as they are made. */
create or replace function public.contact_portals_fill_code()
returns trigger
language plpgsql
as $$
begin
  if new.short_code is null then
    new.short_code := public.short_token(8);
  end if;
  return new;
end;
$$;

drop trigger if exists contact_portals_fill_code on public.contact_portals;
create trigger contact_portals_fill_code
  before insert on public.contact_portals
  for each row execute function public.contact_portals_fill_code();

/* The code in the address, turned into the token everything else takes.
 *
 * Accepts the short code or the original token, so a link from before this
 * migration still opens. Returns nothing for a page that has been turned off,
 * which the page already knows how to explain. */
create or replace function public.portal_resolve(p_code text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select token
    from public.contact_portals
   where active
     and (short_code = p_code or token = p_code)
   limit 1;
$$;

grant execute on function public.portal_resolve(text) to anon, authenticated;

notify pgrst, 'reload schema';

select c.name, p.slug, p.short_code, length(p.token) as old_token_length
  from public.contact_portals p
  join public.contacts c on c.id = p.contact_id
 order by c.name;
