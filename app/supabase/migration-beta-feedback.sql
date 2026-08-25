-- Beta feedback table for collecting user feedback during beta phase
create table beta_feedback (
  id bigserial primary key,
  category text not null, -- 'bug', 'feature', 'improvement', 'other'
  message text not null,
  url text,
  timestamp timestamp with time zone,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'new', -- 'new', 'reviewed', 'addressed', 'closed'
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index idx_beta_feedback_status on beta_feedback(status);
create index idx_beta_feedback_category on beta_feedback(category);
create index idx_beta_feedback_created_at on beta_feedback(created_at desc);
create index idx_beta_feedback_user_id on beta_feedback(user_id);

-- Enable RLS
alter table beta_feedback enable row level security;

-- Allow public to insert feedback (users don't need to be logged in)
create policy "Allow public to submit feedback"
  on beta_feedback
  for insert
  with check (true);

-- Users can view their own feedback
create policy "Users can view their own feedback"
  on beta_feedback
  for select
  using (auth.uid() = user_id or user_id is null);

-- Only service role can update feedback (for internal review)
create policy "Only admins can update feedback"
  on beta_feedback
  for update
  using (auth.jwt() ->> 'role' = 'service_role');
