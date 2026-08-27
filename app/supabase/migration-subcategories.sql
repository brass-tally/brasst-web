-- ============================================================
-- Migration: subcategories
-- Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

alter table public.categories
  add column if not exists subcategories text[] not null default '{}';

alter table public.transactions
  add column if not exists subcategory text;

-- sensible starters (add/remove your own in-app with "+ add subcategory")
update public.categories
  set subcategories = array['Software & SaaS','Hosting & Cloud','Salaries','Marketing','Equipment']
  where type = 'expense' and name = 'GENIE AI' and subcategories = '{}';

update public.categories
  set subcategories = array['Mortgage','Utilities','Maintenance']
  where type = 'expense' and name = 'Home' and subcategories = '{}';
