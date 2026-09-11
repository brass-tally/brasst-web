# The API service

Vercel serves functions from `<project root>/api`. This service's root is the
`api/` folder, so the functions live at `api/api/*.js`. That doubling looks
wrong and is what the platform expects: `api/api/health.js` is served at
`/api/health`.

They were at `api/*.js`, one level too high, which is why every route returned
the landing site's 404 page and why the beta approval cron has never fired.

## Check it after deploying

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://www.brasstally.com/api/health
```

**200** means the service is live. **404** means it is not, and the next thing
to look at is whether the Vercel project shows three services rather than two.

## Routes

| Path | What it does |
|---|---|
| `/api/health` | Returns ok. The cheapest way to tell whether this service exists. |
| `/api/invoice-received` | Signs a supplier's upload, emails both sides, and sends a test on request. |
| `/api/send-beta-approvals` | Cron, every five minutes. Approves waiting signups and emails them in. |

## Environment

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`, `APP_URL`, `CRON_SECRET`.
