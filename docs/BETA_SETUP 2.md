# BrassTally Beta Packaging Setup

This document outlines the beta access flow setup for BrassTally. The system automatically approves beta signups after 7 minutes and sends users a login link, creating a sense of approval.

## What's Been Implemented

### 1. Landing Page Updates (`landing/index.html`)
- ✅ Added beta badge to navigation
- ✅ Updated button copy: "Join the beta" (instead of "Open your books")
- ✅ Added 7-minute approval messaging
- ✅ Modern animations and transitions on forms
- ✅ Mobile-optimized layout (responsive breakpoints at 560px, 400px)
- ✅ Better button hover states with subtle shadow effects
- ✅ Fade-in animations for form states

### 2. Database Schema (`migration-beta-signups.sql`)
- ✅ Created `beta_signups` table with:
  - `email` (unique)
  - `status` (pending → approved → joined)
  - `approved_at` timestamp
  - `created_at` and `updated_at` timestamps
- ✅ Row-level security enabled
- ✅ Public insert access for signup form
- ✅ Users can view their own signup status

### 3. Approval Automation (`functions/beta-approval/index.ts`)
- ✅ Edge function that:
  - Finds pending signups older than 7 minutes
  - Updates their status to "approved"
  - Sends them a magic link via Supabase Auth OTP

### 4. Cron Scheduling (`migration-beta-approval-cron.sql`)
- ⚠️ Requires manual setup in Supabase dashboard

### 5. App Modernization
- ✅ Enhanced `tailwind.config.js` with:
  - Custom brass color palette
  - New animations (fade-in, slide-up)
  - Box shadow utilities matching brass accent
  - Better responsive design tokens

## What Still Needs Setup

### 1. Supabase Configuration
- [ ] Run migration: `migration-beta-signups.sql`
- [ ] Deploy edge function: `functions/beta-approval/index.ts`
  ```bash
  supabase functions deploy beta-approval
  ```
- [ ] Set up cron job (see note below)
- [ ] Update `APP_URL` environment variable if not `app.brasstally.com`

### 2. Cron Job Setup (Important!)
The `migration-beta-approval-cron.sql` needs manual configuration:

Option A: **Use Supabase Dashboard**
1. Go to SQL Editor in Supabase dashboard
2. Create new query with the cron SQL
3. Replace placeholders:
   - `<your-project>` → Your Supabase project URL
   - `<your-anon-key>` → Your Supabase anon key

Option B: **Use Supabase CLI**
```bash
supabase db push  # after completing the migration
```

### 3. Email Template Setup
- [ ] Customize the OTP email in Supabase Auth settings
- [ ] Add a custom email template for beta approval (optional but recommended for branding)
- [ ] Update the redirect URL in the approval function to match your app URL

### 4. App Updates Needed
- [ ] Add beta version badge in app header
- [ ] Add in-app feedback/bug report mechanism
- [ ] Mobile layout improvements:
  - [ ] Make top stat section sticky/collapsible on mobile
  - [ ] Ensure ledger deck is responsive on small screens
  - [ ] Test on real mobile devices

### 5. Domain & SSL
- [ ] Ensure `app.brasstally.com` is pointing to Vercel
- [ ] Verify SSL certificates are valid
- [ ] Test magic link redirect to app.brasstally.com

## The 7-Minute Approval Flow

1. **User visits landing page** → Clicks "Join the beta"
2. **Enters email** → Lands in `beta_signups` table with status="pending"
3. **User sees message**: "You'll get a sign-in link once we approve your access (usually ~7 min)"
4. **Cron function runs** (every minute) → Finds pending signups > 7 minutes old
5. **Status updated** → status="approved", approved_at set
6. **Magic link sent** → User gets OTP email with link to app.brasstally.com
7. **User clicks link** → Authenticated in the app
8. **Status updated** → status="joined" (when they first sign in)

## Testing the Flow

### Local Testing
```bash
# Run the approval function locally
supabase functions serve

# Or invoke it directly:
curl -X POST http://localhost:54321/functions/v1/beta-approval \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Check Signup Status
```sql
-- In Supabase SQL Editor
select email, status, created_at, approved_at from beta_signups order by created_at desc;
```

## Files Modified/Created

### Modified
- `landing/index.html` - Beta signup form and styling
- `app/tailwind.config.js` - Modern color palette and animations

### Created
- `supabase/migration-beta-signups.sql` - Database schema
- `supabase/functions/beta-approval/index.ts` - Approval function
- `supabase/migration-beta-approval-cron.sql` - Cron schedule
- `BETA_SETUP.md` - This file

## Next Steps (From Bilal)

1. **Database Connection**: Connect the beta_signups table once DB is set up
2. **Mobile Optimization**: Improve app layout for mobile (sticky header sections)
3. **Feedback Mechanism**: Add in-app feedback tool
4. **Email Branding**: Customize the approval email template
5. **Beta Messaging**: Consider adding release notes or status page

## Notes

- The 7-minute wait is intentional to create a sense of approval
- All signups are public (anyone can join, no approval logic yet)
- Magic links expire after 24 hours
- Users can sign up multiple times (if they use a new email)
- The app should track when a user first signs in to update status to "joined"
