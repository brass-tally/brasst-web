# Brasstally: technical specification

Written for a client's IT or security reviewer, and for an accounting practice
deciding whether to let a client's books live here.

As at 11 September 2026. GENIE AI, Inc., Ontario, Canada.
Contact: legal@genieai.ca

---

## What the system is

A browser application with an offline-tolerant installable mode, a static
marketing and supplier-facing site, and a managed Postgres database with edge
functions. There is no self-managed server.

| Component | Technology | Where it runs |
|---|---|---|
| Application | React 18, Vite | Vercel, served at `/app` |
| Site and public forms | Static HTML | Vercel |
| Database and auth | Supabase, Postgres | Supabase, Canadian region |
| Server functions | Deno edge functions | Supabase |
| Bank data | Plaid | Plaid, read only |
| Transactional email | Resend | Resend |
| Document reading | Anthropic API | Anthropic |

## Data model

Nineteen tables. Every one carries a ledger reference, every one has row level
security enabled, and a ledger belongs to exactly one owner.

**Financial records.** `ledgers`, `transactions`, `obligations`, `categories`,
`credits`, `balance_anchors`, `settings`.

**Banking.** `bank_connections`, `bank_transactions`, `consolidations`.

**Tax.** `filings`, plus tax amount, tax code and capital flags carried on
transactions and obligations.

**People and intake.** `contacts`, `ledger_shares`, `invoice_links`,
`inbound_invoices`, `invoice_schedules`, `import_rules`.

## Access control

Authorisation is enforced in the database, not in the application. A browser
holding a valid session still cannot read or write outside what the policies
allow.

**Owner access.** Each table carries a policy admitting rows the signed-in user
owns.

**Shared read access.** A ledger owner may grant read access to an email
address. A separate policy admits select, and only select, where an active
share matches the address in the reader's own token. Access is therefore
evaluated against the reader's identity on every query, and revocation is
immediate.

**Write isolation.** Restrictive policies on insert, update and delete require
that the row's ledger is owned by the caller. These combine with AND rather
than OR, so they cannot be widened by another policy. Select is deliberately
excluded, because read is what sharing exists for.

**The bank credential is never shared.** `bank_connections` is outside the
shared read policy, so a reader with full access to the books cannot see the
token that fetches them.

**Anonymous access.** A supplier submitting an invoice holds no session and no
table grant. They reach two database functions and one edge function, none of
which accept a ledger identifier. The intake token resolves the ledger
server-side.

## Server functions

One edge function serves the invoice and sharing flows, with nine actions.
Four require the owner's session and verify ledger ownership before running,
because they send mail from our domain to an address the caller names.

| Action | Caller | Purpose |
|---|---|---|
| `health` | anyone | deployment check |
| `info` | supplier | names the recipient business |
| `upload` | supplier | one signed upload to one key |
| `notify` | supplier | notifies both parties of a submission |
| `test` | owner | verifies the mail path |
| `send-link` | owner | emails an intake link |
| `decided` | owner | tells a supplier the outcome |
| `correct` | owner | requests a corrected invoice |
| `share-invite` | owner | notifies a reader of access |

Uploaded files are written to a key the server chooses, under a prefix derived
from the resolved ledger. The browser never selects the path.

## Banking

Bank connections are established through Plaid Link. The user authenticates on
their own bank's page; Brasstally never receives banking credentials. The
resulting access token permits reading transactions and balances and does not
permit payment initiation.

Tokens are stored in `bank_connections`, which no sharing policy admits.

A scheduled job refreshes connections each morning. Bank lines are never
written directly into the books: they are proposed, matched and confirmed.

## Third parties and data flow

| Recipient | What is sent | Why |
|---|---|---|
| Supabase | all ledger data | storage and authentication |
| Plaid | bank authorisation | transaction retrieval |
| Anthropic | receipt images, questions and ledger extracts | reading documents, answering questions |
| Resend | email addresses and message content | transactional email |
| Vercel | static assets, request metadata | hosting |

Ledger data is not sold, not used for advertising and not used to train models.

## Retention and deletion

A ledger can be reset, which removes its records. Deleting an account removes
the owner and cascades to their ledgers and every row beneath them. Attachments
are removed with the entries that carry them, except where a settled
transaction still references the document as evidence.

Voiding a supplier invoice deletes the intake record and the payable it
created, and deliberately leaves any transaction that already settled it,
because that money moved and removing it would misstate the balance.

## Correctness practices

Six automated checks fail the build rather than warn, each written after a
defect that reached a running application:

| Check | What it prevents |
|---|---|
| Declaration order | a hook reading a value declared below it |
| Stylesheet integrity | styles referencing classes that no longer exist |
| State ownership | a state setter called outside its component |
| Component nesting | form fields that lose focus on every keystroke |
| Write lock | a database write bypassing the read-only guard |
| Props contract | a prop that silently defaults instead of arriving |

Fifty-two assertions cover the tax treatment engine and the filing-rule matcher,
including the duplicate-detection cases that previously produced wrong results.

Every build carries a compile timestamp, visible in the application, so the
running version can be identified without inference.

## Known limitations

Stated plainly, because a reviewer will find them anyway.

**No SOC 2, no penetration test, no formal SLA.** Brasstally is early-access
software.

**Plaid is on development credentials.** Production access is in progress.
Connection limits apply until it completes.

**Legal documents have not had counsel review.** The privacy policy and terms
accurately describe the implementation; the wording has not been examined by a
lawyer.

**Read-only access is one reader per email address.** A practice cannot yet
hold its own credential into a client ledger, and there is no viewer audit log.

**Tax treatment infers the regime from the printed rate**, so an
out-of-province receipt can be mislabelled until corrected.

**Filing is not possible from any third-party product** in Canada, including
this one.

## Business continuity

Data lives in Supabase with its managed backups. Every section of the
application exports to CSV without assistance, and a full tax pack exports for
any period, so a client's records can be removed from Brasstally at any time in
a format their accountant can use.
