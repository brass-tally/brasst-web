# BrassTally Beta Deployment Checklist

Copy this and check off as you go. Should take ~30-45 minutes to get everything live.

## Pre-Deployment (5 min)

- [ ] Verify Vercel project is linked and healthy
- [ ] Confirm Supabase project has all existing migrations applied
- [ ] Pull latest code
  ```bash
  git pull origin main
  ```

## 1. Database Migrations (10 min)

Deploy in this order:

- [ ] `migration-beta-signups.sql`
  ```bash
  supabase db push
  # OR: copy/paste into Supabase SQL editor
  ```

- [ ] `migration-beta-feedback.sql`
  ```bash
  supabase db push
  ```

- [ ] Verify tables created
  ```sql
  select table_name from information_schema.tables where table_schema = 'public';
  ```

**Verify:**
- [ ] `beta_signups` table exists with RLS
- [ ] `beta_feedback` table exists with RLS

## 2. Edge Functions (10 min)

- [ ] Deploy beta-approval function
  ```bash
  supabase functions deploy beta-approval --project-ref <YOUR_PROJECT>
  ```

- [ ] Deploy feedback function
  ```bash
  supabase functions deploy feedback --project-ref <YOUR_PROJECT>
  ```

- [ ] Test functions locally (if using local Supabase)
  ```bash
  supabase functions serve
  # In another terminal:
  curl -X POST http://localhost:54321/functions/v1/beta-approval \
    -H "Authorization: Bearer YOUR_ANON_KEY"
  ```

**Verify:**
- [ ] Both functions appear in Supabase dashboard
- [ ] No deployment errors in logs

## 3. Cron Job Setup (15 min)

- [ ] Open Supabase SQL editor
- [ ] Go to SQL Editor → "New Query"
- [ ] Copy `migration-beta-approval-cron.sql`
- [ ] Replace placeholders:
  - `<your-project>` → Your Supabase project URL (e.g., `xwoccmgppjmgficvmogr.supabase.co`)
  - `<your-anon-key>` → Your Supabase anon key (from Settings → API)
- [ ] Run the query
- [ ] Verify in Supabase → Extensions → "cron" to see the scheduled job

**Verify:**
- [ ] Cron job appears in list
- [ ] No SQL errors

## 4. Environment Variables (5 min)

- [ ] In Supabase, set `APP_URL` environment variable (or use default `app.brasstally.com`)
- [ ] Verify in Vercel that domain is configured:
  - [ ] `brasstally.com` → landing
  - [ ] `app.brasstally.com` → app

## 5. Email Template (5 min)

- [ ] Go to Supabase Dashboard → Authentication → Email Templates
- [ ] Copy content from `emails/beta-approval.html`
- [ ] Create/update the OTP confirmation email template
- [ ] Test by sending yourself an email

**Alternative:** Keep default Supabase template for now, customize later

## 6. Landing Page Deployment (5 min)

- [ ] Verify landing page changes:
  ```bash
  # Check the file
  git diff landing/index.html
  ```
- [ ] Push to main (or merge PR)
  ```bash
  git push origin main
  ```
- [ ] Vercel auto-deploys → Check deployment preview
- [ ] Test landing page:
  - [ ] Beta badge visible in nav
  - [ ] Form works
  - [ ] Success message shows after signup
  - [ ] Mobile responsive at 560px

## 7. App Configuration (5 min)

- [ ] Integrate BetaBadge into app header (optional, recommended)
  ```jsx
  import { BetaBadge } from './components/BetaBadge';
  // In your header: <BetaBadge />
  ```

- [ ] Integrate BetaFeedback into app layout (optional but recommended)
  ```jsx
  import { BetaFeedback } from './components/BetaFeedback';
  // In App.jsx or layout: <BetaFeedback />
  ```

- [ ] Create `/api/feedback` endpoint OR use edge function directly
- [ ] Deploy app
  ```bash
  git push origin main
  ```

## 8. Testing (10 min)

### Landing Page Signup
- [ ] Navigate to brasstally.com
- [ ] Enter email → see success message
- [ ] Check `beta_signups` table in Supabase
  ```sql
  select * from beta_signups order by created_at desc limit 5;
  ```

### Approval Flow
- [ ] Wait 7+ minutes (or run approval function manually to test)
  ```bash
  # Manual trigger
  curl -X POST https://<YOUR_PROJECT>.supabase.co/functions/v1/beta-approval \
    -H "Authorization: Bearer YOUR_ANON_KEY"
  ```
- [ ] Check status changed to "approved"
- [ ] Verify email received
- [ ] Click magic link → should redirect to app.brasstally.com
- [ ] Verify logged in

### Feedback (if integrated)
- [ ] Open app
- [ ] Look for feedback button (should be floating on bottom-right)
- [ ] Click → modal appears
- [ ] Submit feedback
- [ ] Check `beta_feedback` table
  ```sql
  select * from beta_feedback order by created_at desc limit 5;
  ```

## 9. Go-Live Checklist (5 min)

Before announcing the beta:

- [ ] Landing page deployed and live at brasstally.com ✓
- [ ] App accessible at app.brasstally.com ✓
- [ ] Signup flow works end-to-end ✓
- [ ] Magic link redirect works ✓
- [ ] Emails being sent correctly ✓
- [ ] Approval happens after ~7 minutes ✓
- [ ] No console errors on landing or app ✓
- [ ] Mobile responsive tested ✓
- [ ] Beta badge visible ✓

## 10. Monitoring (Ongoing)

After going live, monitor:

- [ ] Check `beta_signups` table daily
  ```sql
  select status, count(*) from beta_signups group by status;
  ```

- [ ] Check `beta_feedback` table for bugs
  ```sql
  select * from beta_feedback where status = 'new' order by created_at desc;
  ```

- [ ] Check email logs in Supabase → Email Logs
- [ ] Check function logs in Supabase → Functions
- [ ] Set up Sentry/DataDog for error tracking (optional)

## Rollback Plan

If something goes wrong:

1. **Landing page**: Revert HTML to previous version
2. **Migrations**: Don't rollback (keep tables for data), just disable RLS policies if needed
3. **Functions**: Disable cron job and delete functions
4. **Signups**: Keep data, just disable beta-related copy on landing

## Support

- Check BETA_SETUP.md for detailed setup instructions
- Check BETA_PACKAGING_SUMMARY.md for overview
- Supabase docs: https://supabase.com/docs

---

**Time estimate**: 30-45 minutes
**Difficulty**: Moderate (mostly clicking around Supabase)
**Risk level**: Low (changes are isolated, can be reverted)

Good luck! 🎉
