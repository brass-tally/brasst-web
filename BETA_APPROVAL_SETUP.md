# Beta Approval Flow Setup

This document outlines the 7-minute auto-approval flow for early access signups.

## How It Works

1. **User signs up on landing page** → Email added to `beta_signups` table with status "pending"
2. **Cron runs every minute** → Queries for signups created 7+ minutes ago
3. **Invite sent** → `supabase.auth.admin.inviteUserByEmail()` — Supabase sends the
   email itself via the custom SMTP (Postmark) configured on the project, using the
   "Invite user" Auth Email Template
4. **Status updated** → Signup marked as "approved" with timestamp
5. **User clicks link in email** → Automatically authenticated and logged into app

## Required Environment Variables

### Vercel (Project Settings)

Set these in your Vercel project:

```
SUPABASE_URL=https://xwoccmgppjmgficvmogr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
APP_URL=https://brasstally.com
CRON_SECRET=<optional-security-token>
```

### Getting the Service Role Key

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Settings → API
4. Copy the **Service Role Key** (keep it secret!)

### Email delivery

No email-provider env vars are needed here — Supabase sends the invite email
directly through the custom SMTP (Postmark) set up under Auth → SMTP Settings.
Edit the branded HTML under Auth → Email Templates → "Invite user".

## Database Schema

The `beta_signups` table should have:

```sql
create table beta_signups (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  status text default 'pending', -- pending, approved, failed
  created_at timestamp with time zone default now(),
  approved_at timestamp with time zone,
  created_by uuid references auth.users
);

create index idx_beta_signups_status_created on beta_signups(status, created_at);

-- Row-level security: allow public inserts (landing page), service role can read/update
alter table beta_signups enable row level security;

create policy "Allow public signups" on beta_signups
  for insert with check (true);

create policy "Service role can select" on beta_signups
  for select using (auth.role() = 'service_role');

create policy "Service role can update" on beta_signups
  for update using (auth.role() = 'service_role');
```

## Testing Locally

To test the approval flow:

1. **Start the app**: `npm run dev` in `/app`
2. **Test signup**: Go to landing page, enter an email
3. **Manually trigger cron**: 
   ```bash
   curl -X POST http://localhost:3000/api/send-beta-approvals \
     -H "Authorization: Bearer your-secret-token"
   ```
4. **Check emails**: Postmark Activity tab or email inbox

## Verifying It Works

1. Signup on landing page with test email
2. Wait ~7 minutes
3. Check Postmark's Activity tab for the sent email
4. Click the link in the approval email
5. Should be logged in and redirected to `/app`

## Troubleshooting

- **No emails sent**: Check Vercel logs for the cron job, and Supabase Auth logs
  for the `inviteUserByEmail` call
- **Email sending fails**: Verify the custom SMTP settings under Supabase Auth →
  SMTP Settings, and check Postmark's Activity tab for bounces/errors
- **Approval link doesn't work**: Check APP_URL and SUPABASE_SERVICE_ROLE_KEY
- **Signups not found**: Check database has records and schema matches above

## Files Changed

- `/api/send-beta-approvals.js` - Cron handler
- `vercel.json` - Added cron schedule
- `/landing/index.html` - Already has signup form ✓

## Next Steps

1. Set all environment variables in Vercel
2. Deploy to Vercel
3. Test with a real email address
4. Monitor cron logs in Vercel dashboard
