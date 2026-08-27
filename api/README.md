# BrassTally API Functions

Vercel serverless functions for handling:
- Beta approval email automation (via Resend)
- Health checks
- Future features (email verification, webhooks, etc.)

## Functions

### `/api/send-beta-approvals`
**Cron**: Runs every 1 minute

Queries for beta signups pending approval (created 7+ minutes ago) and:
1. Sends an approval email via Resend API with a verification link
2. Updates signup status to "approved"

**Requires**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `APP_URL`

**How it works**:
- Queries the `beta_signups` table for pending signups older than 7 minutes
- Sends an invitation email via Resend with a clickable approval link
- Updates the signup status to "approved" in the database

### `/api/health`
**Method**: GET

Health check to verify all required environment variables are configured.

**Response** (200 if ready, 400 if not):
```json
{
  "status": "ready|incomplete",
  "checks": {
    "supabaseUrl": true,
    "supabaseServiceKey": true,
    "resendApiKey": true,
    "resendFromEmail": true,
    "appUrl": true
  },
  "message": "..."
}
```

## Local Development

```bash
# Install dependencies
npm install

# Test the cron endpoint
curl -X POST http://localhost:3000/api/send-beta-approvals \
  -H "Authorization: Bearer your-secret"

# Check health
curl http://localhost:3000/api/health
```

## File Structure

```
api/
├── send-beta-approvals.js  # Main cron handler
├── health.js               # Health check endpoint
├── package.json           # Dependencies
└── README.md              # This file
```

## Email Template

The approval email is generated and sent via Resend API. The HTML template is defined
in `send-beta-approvals.js` in the `resend.emails.send()` call. To customize:

1. Edit the HTML template in `send-beta-approvals.js`
2. Variables available:
   - `approvalUrl` → Dynamic link from `APP_URL` + approval path
   - `signup.email` → Recipient's email address

Or use custom templates from `/emails/` directory:
- `beta-approval.html` → Custom beta approval template (can be loaded if needed)
- `brasstally-welcome-invite.html` → Welcome email template
