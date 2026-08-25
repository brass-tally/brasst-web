# BrassTally API Functions

Vercel serverless functions for handling:
- Beta approval email automation
- Health checks
- Future features (email verification, webhooks, etc.)

## Functions

### `/api/send-beta-approvals`
**Cron**: Runs every 1 minute

Queries for beta signups pending approval (created 7+ minutes ago) and:
1. Generates Supabase Auth invite links
2. Sends approval emails with login link
3. Updates signup status to "approved"

**Requires**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `APP_URL`

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
    "appUrl": true,
    "resendKey": true,
    "resendEmail": true
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
├── lib/
│   └── email.js           # Email sending utility
├── package.json           # Dependencies
└── README.md              # This file
```

## Email Template

The approval email template is at `/emails/beta-approval.html` and includes:
- Custom branding (BrassTally colors)
- Clickable approval link
- Feature highlights
- 24-hour expiration notice

Template variables:
- `{{.ConfirmationURL}}` → Magic link to create/login
- `{{.Token}}` → Backup code
- `{{.SiteURL}}` → Main website URL
