-- ============================================================
-- A readable slug in the intake link.
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Requires 0022. Safe to run twice.
--
-- brasstally.com/i/cr7va67h3she9 tells a contractor nothing about who it is
-- for, and an unfamiliar domain plus a random string is what a phishing link
-- looks like. brasstally.com/i/genie-ai/cr7va67h3she9 answers the question
-- before they click.
--
-- The slug is decoration. The token still does all the work, so a slug that
-- is wrong, stale or missing changes nothing about which ledger the invoice
-- reaches.
-- ============================================================

alter table public.invoice_links
  add column if not exists slug text;

/* Filled from the ledger name, lowercased, punctuation to hyphens. Capped so
   a long company name does not undo the point of a short link. */
create or replace function public.slugify(p text)
returns text
language sql
immutable
as $$
  select nullif(
    left(
      trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')),
      24
    ),
    ''
  );
$$;

update public.invoice_links l
   set slug = public.slugify(g.name)
  from public.ledgers g
 where g.id = l.ledger_id
   and l.slug is null;

/* New links get one too, without the client having to ask for it. */
create or replace function public.set_link_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.slug is null then
    select public.slugify(name) into new.slug from public.ledgers where id = new.ledger_id;
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_links_slug on public.invoice_links;
create trigger invoice_links_slug
  before insert on public.invoice_links
  for each row execute function public.set_link_slug();

-- The supplier-facing lookup can return it, so the page can show the name
-- before the form loads.
create or replace function public.invoice_link_info(p_token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case when l.id is null then json_build_object('ok', false)
              else json_build_object('ok', true, 'business', lg.name, 'label', l.label, 'slug', l.slug)
         end
  from (select 1) x
  left join public.invoice_links l on l.token = p_token and l.active
  left join public.ledgers lg on lg.id = l.ledger_id;
$$;

revoke all on function public.invoice_link_info(text) from public;
grant execute on function public.invoice_link_info(text) to anon, authenticated;

select token, slug from public.invoice_links where active limit 5;
