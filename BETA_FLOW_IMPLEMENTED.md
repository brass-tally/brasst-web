# Beta Approval Flow - Implementation Summary

## What's New ✨

A complete **7-minute automatic approval system** that creates a delightful UX: users sign up on the landing page and get a login invitation after ~7 minutes, feeling like they've been "approved" for early access.

## The Flow

```
User → Landing Page → "Join the beta"
   ↓
Email inserted to beta_signups table (status: pending)
   ↓
(Wait 7 minutes...)
   ↓
Cron job queries for pending signups
   ↓
Generates Supabase Auth invite link
   ↓
Sends approval email with "You're approved!" message
   ↓
User clicks link in email
   ↓
Automatically logged in + redirected to /app
   ↓
Brand new ledger ready to use
```

## Files Created

### Backend (API Functions)
- **`/api/send-beta-approvals.js`** — Cron handler (runs every 1 minute)
  - Queries pending beta signups created 7+ min ago
  - Generates invite links via Supabase Auth
  - Sends approval emails via Resend
  - Updates database status to "approved"

- **`/api/lib/email.js`** — Email sender utility
  - Loads HTML template from `/emails/beta-approval.html`
  - Renders variables (approval link, token, etc.)
  - Sends via Resend (with fallback for other services)

- **`/api/health.js`** — Health check endpoint
  - Verifies all env vars are configured
  - Useful for debugging setup issues

- **`/api/package.json`** — API dependencies
  - `@supabase/supabase-js` for database
  - `resend` for email sending

### Documentation
- **`BETA_APPROVAL_SETUP.md`** — Complete setup guide
  - Environment variables needed
  - Database schema SQL
  - Testing instructions
  - Troubleshooting tips

- **`api/README.md`** — API functions reference
  - Endpoint details
  - Local testing
  - File structure

- **`BETA_FLOW_IMPLEMENTED.md`** — This file

### Updated Files
- **`vercel.json`** — Added cron config
  - Runs `/api/send-beta-approvals` every 1 minute
  - ✅ No user changes needed

- **`landing/index.html`** — Enhanced signup form
  - Better handling of duplicate emails
  - Shows "already approved" message if email exists
  - ✅ User feedback improved

### Existing (Already Ready)
- **`emails/beta-approval.html`** — Beautiful approval email ✅
- **`app/src/App.jsx`** — Auth already handles approval links ✅

## What You Need to Do

### 1. Set Environment Variables (Vercel Dashboard)

Go to Project Settings → Environment Variables and add:

```
SUPABASE_URL=https://xwoccmgppjmgficvmogr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key-from-supabase>
APP_URL=https://brasstally.com
RESEND_API_KEY=<your-resend-api-key>
RESEND_FROM_EMAIL=noreply@brasstally.com
```

**How to get these:**
- **Service Role Key**: Supabase Dashboard → Settings → API → Copy "Service Role Key"
- **Resend API Key**: [Resend Dashboard](https://resend.com) → API Keys → Create or copy
- **Resend Email**: Set up a verified sender domain in Resend (e.g., noreply@brasstally.com)

### 2. Create/Verify Database Table

Run this SQL in Supabase:

```sql
create table beta_signups (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  status text default 'pending',
  created_at timestamp with time zone default now(),
  approved_at timestamp with time zone
);

create index idx_beta_signups_status_created on beta_signups(status, created_at);

alter table beta_signups enable row level security;
create policy "Allow public signups" on beta_signups for insert with check (true);
create policy "Service role can select" on beta_signups for select using (auth.role() = 'service_role');
create policy "Service role can update" on beta_signups for update using (auth.role() = 'service_role');
```

### 3. Deploy to Vercel

```bash
git add -A
git commit -m "Add 7-minute beta approval automation"
git push
```

Vercel will automatically deploy the API routes and enable the cron job.

### 4. Test It

1. Visit landing page and sign up with a test email
2. Wait ~7 minutes (or manually test by changing the time in the code)
3. Check Resend dashboard for sent email
4. Click the approval link
5. Should be logged in to `/app`

## How It Works (Technical Details)

### Cron Timing
- Runs **every minute** (`*/1 * * * *`)
- Queries for signups created **7+ minutes ago**
- Only processes status="pending"
- Updates to status="approved" after sending

### Email Generation
- Supabase Auth's `generateLink()` creates a secure signup/login link
- Valid for 24 hours
- Automatically creates user account when clicked
- Includes backup token code in email

### Supabase Auth Integration
- Uses `admin.generateLink()` (requires service role key)
- Type: "signup" (can be used for new or existing emails)
- Automatically authenticates user when link clicked
- Respects `redirectTo` parameter to send them to `/app`

### Resend Email Service
- Professional transactional emails
- High deliverability
- Handles bounces and compliance
- Integrates seamlessly with Vercel

## Files Structure

```
ledger/
├── api/
│   ├── send-beta-approvals.js
│   ├── health.js
│   ├── lib/
│   │   └── email.js
│   ├── package.json
│   └── README.md
├── emails/
│   └── beta-approval.html (existing)
├── landing/
│   └── index.html (updated)
├── app/ (existing)
├── vercel.json (updated)
├── BETA_APPROVAL_SETUP.md (new)
└── BETA_FLOW_IMPLEMENTED.md (this file)
```

## Monitoring

### Check Email Delivery
- Resend Dashboard → Emails tab
- Shows sent, bounced, failed emails
- View email content and recipient status

### Check Cron Execution
- Vercel Dashboard → Deployments → Functions → Cron
- Shows execution logs
- Timing and error details

### Debug Endpoint
```bash
# Check if env vars are set
curl https://brasstally.com/api/health
```

## Future Enhancements

- [ ] Add email verification before approval
- [ ] Customizable approval delay (not just 7 min)
- [ ] Approval reason/tier system (different tiers = different delays)
- [ ] Admin dashboard to manage approvals
- [ ] Webhook for approval events
- [ ] A/B test different messaging

## Questions?

See `BETA_APPROVAL_SETUP.md` for troubleshooting or check:
- Vercel logs for cron execution errors
- Resend dashboard for email delivery issues
- Supabase logs for database queries
