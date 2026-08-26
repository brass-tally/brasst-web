# BrassTally API Functions

Vercel serverless functions for handling:
- Beta approval email automation
- Health checks
- Future features (email verification, webhooks, etc.)

## Functions

### `/api/send-beta-approvals`
**Cron**: Runs every 1 minute

Queries for beta signups pending approval (created 7+ minutes ago) and:
1. Invites the user via Supabase Auth (`admin.inviteUserByEmail`) — Supabase sends
   the email itself through the configured custom SMTP (Postmark)
2. Updates signup status to "approved"

**Requires**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_URL`

The email itself is Supabase's "Invite user" template (Dashboard → Auth →
Email Templates), not anything in this repo.

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

The approval email is Supabase Auth's **"Invite user"** template
(Dashboard → Auth → Email Templates), sent via the custom SMTP (Postmark)
configured on the project. It's not stored in this repo — update the
template directly in the Supabase dashboard using Supabase's own variables:
- `{{ .ConfirmationURL }}` → Magic link to create/login
- `{{ .Token }}` → Backup code
- `{{ .SiteURL }}` → Main website URL
