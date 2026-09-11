# Upload this to the `web` repo

Unzip at the repo root, over what is there. Then two things have to happen or
the app will keep serving a white page.

```
your-repo/
├── vercel.json     <- the file that makes the app build
├── app/            React + Vite, verified building
├── landing/        the marketing site
├── api/            beta approvals, health
├── supabase/       19 migrations + edge functions
└── scripts/
```

---

## 1. Push it

```bash
git add -A
git commit -m "Build the app service, add the beta cron, harden RLS, new palette"
git push
```

## 2. Redeploy without the cache

Framework is already set to **Services**, but the deployment serving traffic was
built before that change, which is what the banner on the settings page is
saying. Settings apply to the next build, not the one already running.

Vercel -> Deployments -> newest -> **...** -> **Redeploy** ->
**uncheck "Use existing Build Cache"** -> confirm.

The cache checkbox is the part that matters. With it on, Vercel can skip the
build and hand you another seven second no-op.

### Reading the result

Build duration is the tell.

| Duration | Meaning |
|---|---|
| 7 to 13 seconds | no build ran, files served raw |
| 30 seconds or more | Vite compiled, which is what you want |

Then:

```bash
curl -o /dev/null -w "%{http_code}\n" https://www.brasstally.com/app/src/App.jsx
```

`404` means the source is no longer public and only `dist/` is being served.
`200` means it is still not building.

## 3. Set CRON_SECRET if it is not already

Vercel -> Settings -> Environment Variables. It gates
`/api/send-beta-approvals`, which mints sign-in links and emails them, so it
fails closed: no secret, no runs.

---

# What is in this package

## The deploy fix

`vercel.json` is your file with one line added: `"framework": "vite"` inside the
app service. With Services selected, Vercel takes build configuration entirely
from this file, so without that line it knows the folder exists but not that it
is an application.

The cron also moved from `*/1` to `*/5`. A seven minute wait does not need a
sixty second poll: 8,640 runs a month instead of 43,200.

## The missing cron target

`api/send-beta-approvals.js` did not exist. `/api/health` answers 200 and
`/api/send-beta-approvals` answered 404, so the cron has been calling nothing
since the day it was configured and **no signup has ever been approved
automatically**. Anything in `beta_signups` is still pending.

After deploying:

```sql
select email, status, created_at from public.beta_signups order by created_at;
```

Four decisions in it that differ from the older notes:

- **`CRON_SECRET` is required.** The route mints authentication links. Without a
  secret anyone could drain the Resend quota and approve everyone on demand.
- **The row is marked approved only after Resend accepts the email.** The other
  order produces people who are approved, never hear from you, and cannot be
  found by the next run.
- **A failed send stays pending** and retries. The update is conditional on
  still being pending, so overlapping runs cannot double send.
- **The email carries a six digit code as well as a link**, because the sign-in
  screen accepts one and mail clients that rewrite links would otherwise strand
  people.

## Database

`supabase/migrations/`, numbered and replayable. **Commit them, do not run
them.** They are already applied, including `0019`, which closed the waitlist
that was readable by anyone holding the publishable key. That fix is verified
live: the endpoint now returns 401 instead of a list of emails.

## The palette

`app/src/ui/tokens.js` and `app/src/index.css`, and 62 sites in `App.jsx` moved
from `color: P.brass` to `color: P.brassText`. The six `background: P.brass`
fills were left alone.

The old single token measured 2.04:1 as text on the light surface where 4.5 is
the minimum, so every eyebrow and outlined pill was close to unreadable in
daylight. `brass` is the fill now, `brassText` is the text.

## The shell

`app/src/shell/Rail.jsx` is wired in: navigation moved to a left rail on
desktop, with the ledger switcher living on the app mark. The dock is now
`lg:hidden`, so it is the phone's navigation, and a desktop Tally button sits in
the corner since hiding the dock also hid the way in.

`TallyDock.jsx` and `useNudges.js` are included but **not wired**. They are the
drawer, the peek bubble, and the queue that makes Tally speak first. The capture
panel you have works, and swapping it is worth doing with the app running in
front of you rather than blind.

## The feedback function

`supabase/functions/beta-feedback/index.ts` replaces one that ran on the service
role and read `user_id` from the request body, so a caller could file feedback
under anyone's account. It also had no CORS handling, which means it likely
never worked from a browser at all. Deploy it only if something actually calls
it. Nothing in `App.jsx` does.

```bash
supabase functions deploy beta-feedback --no-verify-jwt
```

---

# Verified before packaging

- `npm run build` from a clean unzip: compiles, output references
  `/app/assets/index-<hash>.js`
- the auth gate on the cron route: five cases, all correct
- the approval email renders with and without a code
- all 19 migrations parse, are numbered, and are replayable
- line endings normalised to LF, so the diff shows real changes rather than
  every line of every file

# Not included

Secrets. `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and the
Plaid keys belong in Vercel and Supabase settings, never in the repository.
