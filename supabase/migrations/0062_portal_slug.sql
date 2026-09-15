-- ============================================================
-- A shorter address, with their name in it.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0061. Safe to run twice.
--
--   before  /c/a7f3c91e42b8d05f16a2c9
--   after   /c/syed-belal/k7m2q9xr4t
--
-- The name is for the person reading it: an address you can recognise in a
-- message is one you will keep rather than delete. It is not the credential
-- and nothing is checked against it, so changing a contact's name cannot break
-- a link somebody has bookmarked.
--
-- The token is shorter but still unguessable: ten characters from an alphabet
-- of 32 is about fifty bits, which is far past anything worth trying against a
-- page holding one supplier's invoices. Old long tokens keep working, because
-- the lookup has never cared how long they are.
-- ============================================================

alter table public.contact_portals
  add column if not exists slug text;

/* Letters, digits and single hyphens. Ambiguous characters are left out of the
   token alphabet below, but a name is read rather than typed, so it keeps its
   own spelling. */
create or replace function public.portal_slug(p_name text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both '-' from
      regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g')
    ),
  '');
$$;

/* A short token that cannot be misread aloud: no i, l, o, 0 or 1. */
create or replace function public.short_token(p_len int default 10)
returns text
language plpgsql
volatile
as $$
declare
  alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
  out text := '';
begin
  for i in 1..p_len loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

/* Fill in the slug for portals that already exist. Their tokens are left
   alone: somebody may have bookmarked one, and a tidier address is not worth
   breaking a link that works. */
update public.contact_portals p
   set slug = public.portal_slug(c.name)
  from public.contacts c
 where c.id = p.contact_id
   and p.slug is null;

/* Shorten the ones nobody has opened.
 *
 * A token that has never been used cannot be bookmarked, sitting in somebody's
 * inbox is the only place it can be, and that link would have gone out with
 * the old long address anyway. Shortening those is free.
 *
 * Anything with an open against it keeps its token, because somebody has been
 * there and may return to it. A tidier address is not worth breaking a link
 * that works.
 */
update public.contact_portals
   set token = public.short_token(10)
 where opens = 0
   and length(token) > 12;

notify pgrst, 'reload schema';

select count(*) filter (where slug is not null) as with_slug,
       count(*)                                 as total,
       min(length(token))                       as shortest_token
from public.contact_portals;
