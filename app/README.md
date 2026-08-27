# The Ledger ΓÇö GENIE AI ┬╖ Personal

> **Fast path (no CLI, no local run)** ΓÇö your Supabase URL and publishable key are already baked into the code.
>
> 1. **Database**: Supabase dashboard ΓåÆ SQL Editor ΓåÆ New query ΓåÆ paste all of `supabase/schema.sql` ΓåÆ Run.
>    (Already ran an older schema? Run `supabase/migration-balance-anchor.sql` instead.)
>    Then run `supabase/migration-bank-transactions.sql` ΓÇö bank reconciliation needs it, and
>    redeploying the `plaid` function without it will make **Sync now** fail.
>    Then run `supabase/migration-consolidations.sql` ΓÇö without it the app can't remember that
>    you've already consolidated a ledger, and will keep asking on every switch.
>
>    **Order matters.** Do not run the migrations alphabetically: `migration-multi-ledger.sql`
>    creates the `ledgers` table that five later files point at, and it sorts after four of them.
>    Run them in this order, top to bottom (every file is idempotent, so re-running is safe):
>
>    ```
>    schema.sql                          <- fresh installs only
>    migration-balance-anchor.sql        <- older databases only
>    migration-subcategories.sql
>    migration-credits-calendar.sql
>    migration-credits-used.sql
>    migration-multi-ledger.sql          <- REQUIRED, and required before everything below
>    migration-balance-history.sql
>    migration-settle-link.sql
>    migration-transfers.sql
>    migration-bank-connections.sql
>    migration-bank-balances.sql
>    migration-bank-connection-health.sql
>    migration-bank-transactions.sql
>    migration-consolidations.sql
>    migration-filings.sql
>    migration-beta-signups.sql
>    migration-beta-feedback.sql
>    migration-autorefresh-cron.sql      <- needs pg_cron; skip if you don't want scheduled syncs
>    ```
> 2. **AI function**: dashboard ΓåÆ Edge Functions ΓåÆ **Deploy a new function ΓåÆ Via Editor** ΓåÆ name it exactly `extract`,
>    paste the contents of `supabase/functions/extract/index.ts`, Deploy.
> 3. **API key secret**: Edge Functions ΓåÆ **Secrets** ΓåÆ add `ANTHROPIC_API_KEY` = your key. (Never put this in the code or repo.)
> 4. **GitHub**: create a **private** repo, push this folder (see Step 5 below for exact commands or drag-and-drop).
> 5. **Vercel**: Add New ΓåÆ Project ΓåÆ import the repo ΓåÆ Deploy. No env vars needed.
> 6. **Auth URLs**: Supabase ΓåÆ Authentication ΓåÆ URL Configuration ΓåÆ set Site URL to your Vercel URL and add it under Redirect URLs.
> 7. Open the Vercel URL, sign in with your email, done.

Your budget app, backed by Supabase (database + private file storage + auth) with AI receipt/invoice extraction running through a Supabase Edge Function. Deployed on Vercel.

## What you need

- A Supabase account (free tier is fine) ΓÇö https://supabase.com
- An Anthropic API key (for receipt/invoice reading) ΓÇö https://console.anthropic.com
- A Vercel account ΓÇö https://vercel.com
- Node.js 18+ locally, and the Supabase CLI

---

## Step 1 ΓÇö Create the Supabase project

1. supabase.com ΓåÆ **New project**. Name it (e.g. `genie-ledger`), set a strong database password, pick a region near you.
2. When it finishes provisioning, go to **Project Settings ΓåÆ API** and copy two values:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon / public key**

## Step 2 ΓÇö Create the database

1. In the dashboard, open **SQL Editor ΓåÆ New query**.
2. Paste the entire contents of `supabase/schema.sql` and hit **Run**.
   This creates the tables (settings, categories, transactions, obligations), row-level security so only you can read your rows, and a private `invoices` storage bucket for your PDFs/receipts.

## Step 3 ΓÇö Deploy the AI extraction function

The Anthropic key must never ship to the browser, so extraction runs in an Edge Function.

```bash
# install the CLI if you don't have it
npm install -g supabase

supabase login
cd genie-ledger
supabase link --project-ref YOUR_PROJECT_REF   # the id from your project URL

supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here
supabase functions deploy extract
```

## Step 4 ΓÇö Run it locally

```bash
cp .env.example .env
# edit .env: paste your Project URL and anon key
npm install
npm run dev
```

Open http://localhost:5173, enter your email, and click the magic link that arrives. First sign-in seeds the database with your spreadsheet data (categories, planned budgets, March 2026 transactions, $6,622.36 starting balance). Test: capture a receipt, upload an invoice to receivables, flip the theme ΓÇö then refresh and confirm it all persisted.

## Step 5 ΓÇö Deploy to Vercel

1. Push this folder to a GitHub repo (`.env` is git-ignored ΓÇö never commit it).
2. vercel.com ΓåÆ **Add New ΓåÆ Project** ΓåÆ import the repo. Vercel auto-detects Vite.
3. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
4. **Deploy.** You'll get a URL like `https://genie-ledger.vercel.app`.

## Step 6 ΓÇö Point Supabase auth at your live URL

Magic links must redirect to the deployed site:

1. Supabase dashboard ΓåÆ **Authentication ΓåÆ URL Configuration**
2. **Site URL**: `https://your-app.vercel.app`
3. **Redirect URLs**: add `https://your-app.vercel.app` (keep `http://localhost:5173` too for local dev).

## Step 7 ΓÇö Verify live

Open the Vercel URL on your phone, sign in, and run the loop: snap a receipt in the capture chat ΓåÆ confirm ΓåÆ check it lands in Transactions and the P&L; upload an invoice PDF to receivables ΓåÆ preview it ΓåÆ mark it received.

---

## The finance agent

The chat bubble has two modes. **Capture** reads a receipt or a typed line into a draft entry.
**Ask** runs an agent over your actual books.

It isn't given a summary of your ledger and asked to guess ΓÇö it has tools, and it uses them:
searching transactions, budget variance, month-over-month trend, AR/AP aging, a duplicate scan,
a breakdown of where the balance comes from, recurring costs, a cash forecast, and a bookkeeping-gap
check. Ask "why is my bank $412 above my books" and it goes looking, then tells you which entries
account for it.

**It cannot write to your ledger.** When it wants to change something ΓÇö log an entry, settle a
payable, set a budget, re-anchor the balance ΓÇö it draws a confirmation card in the chat with the
fields still editable. Nothing reaches the database until you tap it.

Above the Overview tab, **Worth a look** shows what the agent would have told you if you'd asked:
overdue invoices, budget overruns, likely duplicates, subscriptions that quietly went up, runway
getting short. Those are computed locally on every render ΓÇö no API call, no cost, never stale.
Tapping one hands that question to the agent, which then goes and finds the entries behind it.

> **Redeploy `extract` after pulling this.** The agent runs through the same Edge Function as
> receipt reading (one function, one deploy). Until you redeploy it, Capture keeps working and Ask
> returns an error. Supabase dashboard ΓåÆ Edge Functions ΓåÆ `extract` ΓåÆ paste
> `supabase/functions/extract/index.ts` ΓåÆ Deploy. No new secrets or migrations needed.

Agent turns use a larger model than receipt reading and may make several tool calls per question, so
a question costs more than a receipt ΓÇö still cents, not dollars. The tools run in your browser
against data already loaded, so only the slice a tool returns is ever sent to the API.

## How the pieces map

| In the artifact | Now |
|---|---|
| window.storage JSON blob | Postgres tables with row-level security |
| Attachments as base64 (3.5 MB cap) | Private Supabase Storage bucket (8 MB cap in-app) |
| Anthropic call proxied by Claude.ai | `extract` Edge Function holding your API key |
| No way to ask about the books | A tool-using agent over your real ledger, with proposals you confirm |
| No sign-in | Email magic-link auth; every row scoped to your user |

## Notes

- **Extraction costs**: each receipt/invoice read is an API call billed to your Anthropic account ΓÇö fractions of a cent for a receipt image, a bit more for multi-page PDFs.
- **Sharing with a partner/accountant**: they can sign in with their own email, but they'll get their *own* empty ledger (rows are per-user). Shared books would be the next feature.
- **Backups**: Supabase free tier keeps daily backups for 7 days; the CSV exports in P&L and AR/AP are your quick manual backup.
- **Reset**: the Γå║ icon wipes your rows and reseeds the spreadsheet data.
