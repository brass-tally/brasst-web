# Email Setup Guide

All transactional emails (welcome, beta approvals, password resets, etc.) are now sent via **Resend** instead of Supabase's built-in SMTP.

## ⚠️ One dashboard change is required

The app now signs people in with a **six-digit code** as well as a link. The code
is the only thing that works inside an installed home-screen app: on iOS a link
opened from Mail lands in Safari, Safari has its own storage jar, and the app
icon still shows the signed-out screen. Typing a code keeps the whole sign-in
inside the app.

Supabase's stock auth emails contain only a link, so **paste
`emails/supabase-magic-link.html` into both templates** at
Supabase → Authentication → Emails:

- **Magic Link** — sent to people who already have an account
- **Confirm signup** — sent the first time an address is seen, and a first-time
  user is exactly who gets stranded without a code

The important line in each is `{{ .Token }}` — that renders the code. Until both
templates carry it, the "Email me a code" button sends an email with no code in
it and the code screen can't be completed.

Also confirm the redirect allowlist at Supabase → Authentication → URL
Configuration:
- **Site URL**: `https://brasstally.com/app/`
- **Redirect URLs**: `https://brasstally.com/app/**` (plus your preview domains)

The app asks Supabase to return people to `/app/`, not to the bare origin.
Pointing it at the origin was what made signing in take two clicks: the first
click dropped you on the marketing page holding the token, and you had to
navigate into the app yourself.

The beta-approval invite is unaffected by all of this — it mints its link and
code server-side with the service-role key, so it carries a working code no
matter what the dashboard templates say.

## Email Flows

### 1. **Beta Approval Flow** ✅ (Fully Configured)
- **Trigger**: Cron job runs every minute for signups pending 7+ minutes
- **Email**: `emails/beta-approval.html`
- **Function**: `/api/send-beta-approvals`
- **Service**: Resend API
- **Contents**: a real Supabase magic link **and** the matching six-digit code,
  both minted by `supabase.auth.admin.generateLink`. If the address has no auth
  user yet, one is created (pre-confirmed) on the first pass.
- **Status**: Ready to deploy

### 2. **Sign-in code** (Supabase Native)
- **Trigger**: "Email me a code" on the sign-in screen (`signInWithOtp`)
- **Email**: Supabase "Magic Link" / "Confirm signup" templates
- **Service**: Supabase Auth (native)
- **Requires**: `{{ .Token }}` in both templates — see the section above

### 3. **Password Reset** (Supabase Native)
- **Trigger**: User clicks "Forgot password?" on sign-in screen
- **Email**: Supabase Auth's built-in "Reset password" template
- **Service**: Supabase Auth (native)
- **Note**: Sent automatically by Supabase

### 4. **Welcome Email** (Optional - Manual)
- **Trigger**: Can be called manually or integrated with post-signup flow
- **Email**: `emails/brasstally-welcome-invite.html`
- **Function**: `/api/send-welcome-email` (POST)
- **Service**: Resend API
- **Usage**:
  ```bash
  curl -X POST https://your-domain.com/api/send-welcome-email \
    -H "Content-Type: application/json" \
    -d '{"email": "user@example.com"}'
  ```

## Email Templates

| Template | Path | Used For | Service |
|----------|------|----------|---------|
| Beta Approval | `emails/beta-approval.html` | Beta signup approvals | Resend |
| Welcome Invite | `emails/brasstally-welcome-invite.html` | New user welcome | Resend |
| Sign-in code | `emails/supabase-magic-link.html` | Paste into Supabase "Magic Link" **and** "Confirm signup" | Supabase Auth |

### Customizing Templates

All Resend email templates use `{{approvalUrl}}` or `{{welcomeUrl}}` as dynamic placeholders. Edit the HTML files directly to customize:
- Styling
- Copy/messaging
- Links and CTAs
- Branding

## Environment Setup

### Required Variables (Vercel)
```
RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@brasstally.com
```

### Verified Domain in Resend
1. Go to [Resend Dashboard](https://resend.com)
2. Click "Domains"
3. Add your domain (e.g., `brasstally.com`)
4. Verify using DNS records
5. Use verified domain in `RESEND_FROM_EMAIL`

## Testing Locally

### Beta Approvals
```bash
# Trigger the cron manually
curl -X POST http://localhost:3000/api/send-beta-approvals \
  -H "Authorization: Bearer your-cron-secret"

# Check health
curl http://localhost:3000/api/health
```

### Welcome Email
```bash
curl -X POST http://localhost:3000/api/send-welcome-email \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

## Sign-In Page

The sign-in page is now linked in the top-right of the landing page navbar:
- **Link**: `/app`
- **Features**:
  - Email/password sign-in
  - Email/password sign-up
  - Magic link (one-tap sign-in)
  - Password reset (forgot password)

Users can access all auth flows from the sign-in page.

## Files Changed

- ✅ `vercel/functions/send-beta-approvals.js` — Now uses Resend API
- ✅ `vercel/functions/send-welcome-email.js` — New function for welcome emails
- ✅ `api/health.js` — Updated to check Resend env vars
- ✅ `emails/beta-approval.html` — Updated to use `{{approvalUrl}}` placeholder
- ✅ `emails/brasstally-welcome-invite.html` — Ready to use
- ✅ `landing/index.html` — Added sign-in link in navbar
- ✅ `.env.example` — Updated with Resend variables
- ✅ `PRODUCTION_SETUP.md` — Updated with Resend setup
- ✅ `BETA_APPROVAL_SETUP.md` — Updated for Resend flow

## Next Steps

1. Deploy to Vercel:
   ```bash
   git add .
   git commit -m "Add Resend email integration and sign-in link"
   git push
   ```

2. Test sign-in on landing page
3. Test beta approval flow
4. Monitor cron logs in Vercel dashboard
