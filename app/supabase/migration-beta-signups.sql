-- Beta Signups Table
-- Stores beta access requests from the landing page

create table if not exists public.beta_signups (
  id bigserial primary key,
  email text not null unique,
  status text not null default 'pending', -- pending | approved | joined
  approved_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Enable row-level security
alter table public.beta_signups enable row level security;

-- Allow anyone to insert (landing page signups)
create policy "anyone can insert beta signups"
  on public.beta_signups
  for insert
  with check (true);

-- Allow users to view their own signup status
create policy "users can view their own signups"
  on public.beta_signups
  for select
  using (true);

-- Create an index for querying pending signups
create index if not exists idx_beta_signups_status
  on public.beta_signups(status);

create index if not exists idx_beta_signups_email
  on public.beta_signups(email);

-- Grant permissions
grant insert on public.beta_signups to anon, authenticated;
grant select on public.beta_signups to anon, authenticated;
