# Brasstally

Bookkeeping for owner-operated Canadian companies. Two ledgers, one for the
business and one for the person running it, kept as separate records rather
than filtered views of one pile.

**As at 11 September 2026.** Developed by GENIE AI, Inc., Ontario, Canada.
Part one is what it does. Part two is how it is built.

---

# Part one: what it does

## Capture

**Photograph a receipt.** Vendor, amount, date, tax and a suggested category
are read off the page. Every field stays editable, because a model reading a
crumpled receipt can be wrong and you are the one filing the return.

**Type it in plain words.** "paid Vercel $70 today" becomes an entry with a
category and a date.

**A receipt settles the bill it pays.** If it matches an open payable by party
and amount, it offers to settle that bill rather than adding a second entry.

**Import a statement.** Paste or upload, reviewed line by line with duplicates
caught before they land.

**Filing rules.** Categorise an unmatched bank line once and the same line is
filed the same way next month. Keyed on the description with reference numbers
and dates stripped.

## The books

**Snapshot.** Balance, net, money in and out, owed to you, you owe. Cards can
be turned on and off. One bar underneath shows the month's shape as a
proportion with a sentence saying what it means.

**What wants you.** What needs a decision, how close the month is to closed,
and the reports you keep returning to. The closing checklist is derived from
the books, so the percentage is a fact rather than a record of your diligence.

**Transactions.** Search across description, category and subcategory, filter
by direction and account, inline editing, attachments, transfers, recurring
entries.

**AR and AP.** Who owes you and what you owe, grouped by party. Settling
requires a receipt, and a settled entry locks.

**Credits.** Non-cash pools such as AWS or Anthropic credits, tracked beside
cash and never touching your bank balance.

**Calendar.** A month grid where a day with something on it lifts, plus
expected in and out over thirty days.

**Profit and loss.** Revenue, expenses and net with change, category
breakdown, six-month trend, average daily burn.

**Contacts.** Everyone the ledger deals with, filed by role: contractor,
vendor, employee, client, accountant. Every party and email field in the app
offers them, filtered to the roles that make sense there, and typing a new
name is still a valid answer.

**Reports.** Any period cut into a statement, the months behind it, and where
the money went. CSV or PDF.

## The bank

**Connect through Plaid.** You sign in on your bank's own screen. The token
reads transactions and balances and cannot move money.

**Consolidate.** Pairing what the bank saw with what the books say so every
difference has a name. The plan is stated before it runs.

**Duplicates, two tiers.** Identical entries on the same day with the same
reference are removed automatically and recorded. Anything ambiguous is asked
about; a cluster too large to be copies is reported rather than deleted.

**A record of every run**, so a consolidation can be explained later.

## Tax

**GST and HST per receipt**, read as printed rather than calculated, with the
regime recorded. It knows the provincial portion is not recoverable in BC or
Saskatchewan.

**Rules applied as you go.** Meals halved on both the deduction and the
credit. Capital separated from expense against a threshold you adopt, with a
CCA class suggested.

**Tax pack.** A period's figures, every category on its CRA line, capital
additions, and the net tax position owing or refundable. One CSV, ending with
your capitalisation policy, registration status and province.

**Receipts on file**, plus the count of entries without one and the total at
risk.

## Tally

**Twenty tools over your own ledger**: variance, trends, obligations, balance
breakdown, duplicates, recurring costs, cash forecast, data quality.

**Proposals, not actions.** A transaction, an obligation, a settlement, a
budget, an anchor, a contact or an invitation to a supplier. Each is a card,
and nothing happens until you tap it.

**Speaks once.** At most one message, only when something is worth saying,
and opening it shows what was said rather than a greeting.

## Working with other people

**Read access for your accountant.** Per ledger, by email address, enforced by
the database. They see the books and not the bank credential, and they cannot
change anything. They are emailed and told exactly what they can and cannot do.

**An intake link for suppliers.** Send a contractor a link and their invoice
arrives in a tray in AR / AP with the PDF attached. Both sides are emailed.
Accepting creates an ordinary payable; nothing reaches the books unaccepted.

**Monthly arrangements.** A contractor marks a submission as monthly and it is
raised for them from then on, into the tray rather than into the books.

**Needs correction.** Send an invoice back with a reason and a link, and it
stays pending until the corrected one arrives.

## The app itself

Runs in a browser, installs to a phone. Four palettes in light and dark, every
combination contrast-checked. Everything exports to CSV. A privacy policy,
terms of use and a page on financial data handling, readable inside the app.

---

# Part two: how it is built

## Shape

| Piece | What it is |
|---|---|
| `app/` | React 18, Vite, Tailwind. The application at `/app` |
| `landing/` | Static HTML. The site, the legal pages, the supplier form |
| `supabase/migrations/` | 29 SQL files, run in order |
| `supabase/functions/` | Deno edge functions: `invoice-mail`, `plaid`, `beta-feedback` |
| `scripts/` | Four build checks and three test suites |

One Vercel project with two services, `landing` and `app`, routed by
`vercel.json`.

**There is no `/api`.** Vercel's services config does not host serverless
functions: three placements of the same file all resolved to a static 404 or
to the app's own catch-all. Anything server-side is a Supabase edge function,
which has its own URL and needs no routing.

## Data

Nineteen tables, all with row level security, all scoped to a ledger owned by
a user.

**Core.** `ledgers`, `transactions`, `obligations`, `categories`, `credits`,
`settings`, `balance_anchors`.

**Bank.** `bank_connections` holds the Plaid token and is the one table never
shared. `bank_transactions`, `consolidations`.

**Tax.** `filings`, plus `tax_amount`, `tax_code` and `capital` on
transactions and obligations.

**People and intake.** `contacts`, `ledger_shares`, `invoice_links`,
`inbound_invoices`, `invoice_schedules`, `import_rules`.

## How access works

Owner policies are `auth.uid() = user_id`, unchanged since the first
migration.

Read sharing was added by **adding** a policy per table rather than editing
those, because Postgres combines permissive policies with OR. Rewriting eleven
working policies to add a condition to each is how one of them gets widened by
accident.

`can_read_ledger(uuid)` is the shared predicate: owner, or an active share
matching the address in the caller's token. Access is therefore checked at
query time against the reader's own identity, and revoking is immediate.

Anonymous callers reach nothing directly. The supplier form calls two database
functions and one edge function, none of which take a ledger id.

## The edge function

`invoice-mail`, nine actions.

| Action | Who | What |
|---|---|---|
| `health` | anyone | proves it is deployed, before any lookup |
| `info` | supplier | the business name, and nothing else |
| `upload` | supplier | one signed upload to one key |
| `notify` | supplier | emails both sides after a submission |
| `test` | owner | proves the mail path |
| `send-link` | **owner** | emails the intake link |
| `decided` | **owner** | tells the supplier accepted, denied or voided |
| `correct` | **owner** | asks for a corrected invoice |
| `share-invite` | **owner** | tells an accountant they have access |

The four marked owner require a bearer token and check ledger ownership. They
send mail to an address the caller names, which is a spam relay if an intake
token is the only guard, and an intake token is meant to be handed around.

`INVOICE_LINK_STYLE` switches link format between `/i/<slug>/<token>` and
`/invoice?t=<token>` without a code change.

## Generation, without a scheduler

Monthly invoices are raised by `generate_due_invoices(ledger)`, called on app
load rather than by a cron.

Idempotent by construction: a unique index on `(schedule_id, period)` means a
second call inserts nothing. It fills every month since the last one covered,
so a ledger nobody opened for a quarter catches up.

No scheduler to be down, which matters on this project: the Vercel cron for
beta approvals has never fired once, for the routing reason above.

## Build checks

Four, all failing the build.

| Check | Catches |
|---|---|
| `check-tdz` | a hook reading a value declared below it |
| `check-css` | a class used with no rule, and nine load-bearing classes |
| `check-handlers` | a state setter called outside its owning component |
| `check-inline-components` | a component declared inside another that renders a field |

Each was written after a bug it would have caught. The last one twice: a form
inside `Row`, then a field inside `ContactsPage`, both of which lost focus on
every keystroke and both of which built cleanly.

Three test suites: 36 tax assertions, 16 filing-rule cases, and the duplicate
matcher against the data that broke it.

## What it will not do

**Not an accountant.** It prepares and shows its working. Nothing in it is
advice.

**Cannot file.** No Canadian tax software exposes a filing interface to third
parties. It prepares the package and tracks the return from draft to assessed.

**Never moves money.** Bank connections are read only.

**No data sale, no advertising**, and your ledger is not used to train models.

---

# Part three: what is next

## Soon

**Push notifications.** Email and an in-app mark do not reach a closed phone.

**Beta approvals.** The cron has never run. Needs moving to an edge function
called by `pg_cron`, and `beta_signups` needs draining once it works.

**Multi-user access for a firm.** Sharing is one reader per email. A practice
needs its own login into a client's ledger and a record of who looked.

**Read-only polish.** A shared reader can open dialogs whose writes are then
refused with an explanation. They should be absent rather than refused.

## Next

**GST and HST filing periods.** The pack computes a net position; it does not
know your filing frequency or track what has been remitted.

**CCA schedules.** Classes are suggested. The half-year rule, immediate
expensing and the pools are still your accountant's work.

**Per-vendor tax memory.** The regime is inferred from the printed rate, so an
out-of-province receipt can be mislabelled until corrected.

**Invoices you send.** The intake link works in one direction only.

**Multi-currency.** One currency per ledger.

## Later

**Payroll.** Not attempted.

**Audit trail export.** Changes are recorded; there is no who-changed-what
report.

**Attachment search.** Receipts are stored and previewable, not searchable by
contents.

---

# Before a wider launch

- [ ] The privacy policy and terms have not had a lawyer's review. They are
      accurate about the implementation; the wording has not been checked.
- [ ] Plaid is on development credentials. Production access is in progress.
- [ ] No SOC 2, no penetration test, no formal SLA.
- [ ] Two contact domains are in use, `genieai.io` and `genieai.ca`. Confirm
      which is right before either appears on anything external.
