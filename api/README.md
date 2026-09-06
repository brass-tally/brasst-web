# API routes

Vercel serverless functions. Verified live: `/api/health` answers 200 with every
environment variable set.

```
send-beta-approvals.js   the cron target. Approves waiting signups and emails a way in
lib/email.js             the approval email
health.js                which environment variables are present
```

## The gap this filled

`vercel.json` has scheduled `/api/send-beta-approvals` since it was written, but
the file did not exist. The endpoint returned 404 on every run, so **no signup
was ever approved automatically**. Anything sitting in `beta_signups` with
status `pending` has been waiting the whole time.

After deploying, check what is queued:

```sql
select email, status, created_at, approved_at
from public.beta_signups order by created_at;
```

Anything older than seven minutes goes out on the next run.

## Environment

Set in Vercel project settings. `/api/health` reports which are present.

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY     admin. This route mints sign-in links
RESEND_API_KEY
RESEND_FROM_EMAIL             a verified sender in Resend
APP_URL                       https://brasstally.com
CRON_SECRET                   required, and not currently reported by health.js
```

**`CRON_SECRET` is not optional here**, whatever the older notes say. The route
mints authentication links and sends them, so without a secret anyone could
call it, drain the Resend quota, and approve every pending signup at will. It
fails closed: no secret configured means it refuses to run. Vercel attaches
`Authorization: Bearer $CRON_SECRET` automatically once the variable is set.

## Behaviour worth knowing

- **The row is marked approved only after the email is accepted.** Marking first
  and sending second produces people who are approved and never hear from us,
  and the next run cannot find them again.
- **A failed send stays pending** and is retried on the next run, so a transient
  Resend hiccup does not cost someone their invitation.
- **The update is conditional on still being pending**, so two overlapping runs
  cannot both send.
- **Fifty per run.** Bounds the email bill if the table ever fills quickly.
- **The email carries a six digit code as well as a link**, because the app's
  sign-in screen accepts one, and mail clients that rewrite links or open on
  another device would otherwise strand people.

## Testing

```bash
curl -X POST https://brasstally.com/api/send-beta-approvals \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expect `{"approved":n,"checked":n}`. Without the header, `401`.
