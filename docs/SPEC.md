# Brasstally: technical specification

Written for a client's IT or security reviewer, and for an accounting practice
deciding whether to let a client's books live here.

As at 15 September 2026. GENIE AI, Inc., Ontario, Canada.
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

Twenty-four tables. Every one carries a ledger reference, every one has row
level security enabled, and a ledger belongs to exactly one owner.

**Financial records.** `ledgers`, `transactions`, `obligations`, `categories`,
`credits`, `balance_anchors`, `settings`.

An obligation carries `paid_amount` and `balance_due` alongside its total, so a
bill settled in instalments holds what has been paid and when the remainder is
expected. It closes when the payments reach the total; until then it is judged
overdue on the balance date rather than on the original one.

**Banking.** `bank_connections`, `bank_transactions`, `consolidations`.

**Tax.** `filings`, plus tax amount, tax code and capital flags carried on
transactions and obligations.

**People and intake.** `contacts`, `ledger_shares`, `invoice_links`,
`invoice_link_invites`, `inbound_invoices`, `invoice_schedules`, `import_rules`,
`chat_messages`, `contact_portals`.

**Intentions, kept out of the books.** `planned_expenses` is a separate table
rather than a flag on `obligations`, because every existing query that reads
obligations would otherwise begin counting intentions as debts.

**Tokens we would otherwise lose.** `retired_bank_items` holds the access token
of any bank connection we stop using. Plaid has no endpoint that lists the
Items you hold, so a token that is overwritten or deleted leaves an Item alive
at the institution, refreshing on their schedule and signing in, with no way to
find it again.

Each invitation is a row in `invoice_link_invites` with its own reference and
its own link, so an invitation can be revoked without affecting others sent to
the same person. An inbound invoice carries the currency it was raised in and,
where the supplier itemised rather than attached a file, the lines themselves.
The total is recomputed in the database from those lines, so the figure claimed
and the figure itemised cannot diverge.

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

**A contact's page is scoped to one relationship.** `contact_portal_view`
returns only rows naming that contact on that ledger: no balances, no other
suppliers, no bank, no totals of any kind. It is security definer because the
reader has no account, so the function itself is the boundary.

A supplier may withdraw an invoice they sent, and may put a finished one away,
and neither is permitted once it has been accepted: at that point it is a
payable in the owner's books and possibly part paid, so changing it from
outside would move their figures without their knowledge. The function refuses
rather than relying on the button not being offered.

**The bank credential is never shared.** `bank_connections` is outside the
shared read policy, so a reader with full access to the books cannot see the
token that fetches them.

**Supplier uploads are read by ledger, not by uploader.** A supplier has no
account, so their file is written by the service role under a path keyed to the
ledger. Reading it is permitted to anyone who may read that ledger, which
includes a shared accountant; deleting it is restricted to the owner.

**Anonymous access.** A supplier submitting an invoice holds no session and no
table grant. They reach two database functions and one edge function, none of
which accept a ledger identifier. The intake token resolves the ledger
server-side.

## Server functions

One edge function serves the invoice and sharing flows, with fifteen actions.
Six require the owner's session and verify ledger ownership before running,
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
| `paid` | owner | tells a supplier a payment was made |
| `preview-invite` | owner | sends the owner the supplier's own email |
| `share-invite` | owner | notifies a reader of access |
| `portal-invite` | owner | gives a contact their own page and sends the address |
| `portal-upload` | supplier | one signed upload, resolved from a portal token |
| `portal-submitted` | supplier | tells the business an invoice has landed |

Uploaded files are written to a key the server chooses, under a prefix derived
from the resolved ledger. The browser never selects the path.

**Authorisation is performed by the function, not by the platform.** JWT
verification is disabled on this function deliberately: a supplier submitting an
invoice has no account to hold a token, and a browser's CORS preflight carries
no authorization header at all, so a blanket check rejects the request before
any code runs. Supplier actions are instead gated on an intake token that
resolves the ledger server side; owner actions verify the caller's session
against the ledger's owner. This is narrower than a blanket check, not wider.

**The `paid` action attaches the receipt** filed against the payment, read from
storage by the service role and capped at eight megabytes. Sending it is the
default and can be declined in the application before the payment is recorded,
because a payment receipt frequently shows unrelated account information.

## Banking

Bank connections are established through Plaid Link. The user authenticates on
their own bank's page; Brasstally never receives banking credentials. The
resulting access token permits reading transactions and balances and does not
permit payment initiation.

Tokens are stored in `bank_connections`, which no sharing policy admits.

A scheduled job refreshes connections each morning at seven Eastern. The
application also refreshes any connection not synced since that boundary when it
loads, which covers a project where the job has not been configured.

**Both paths are metered, so both are limited.** The application attempts the
refresh at most once per morning per device, recorded before the attempt runs,
so a failure does not produce a retry loop against a paid API. The connection
health check, which calls Plaid once per connection, runs at most every six
hours.

Bank lines are never written directly into the books: they are proposed, matched
and confirmed. Payments the bank made that no entry accounts for are recorded
during consolidation with a guessed category, and the run distinguishes the
facts from the guess.

**The bank connection is read on request as well as on a schedule.** A
diagnostic action reads the Item directly from Plaid rather than from our
records, because our records are the thing in doubt when a feed stops moving:
its granted products, its error state, its consent expiry, and what
`/transactions/get` returns over an explicit date range, which depends on no
cursor of ours.

**Items are removed at the provider, not only forgotten here.** Disconnecting
calls `/item/remove` before deleting the row, and a token that cannot be
removed is retained rather than lost. An orphaned Item keeps signing in to the
bank, and at an institution permitting one session per login it will knock out
whichever Item is currently in use.

**Exchange rates** are read from the Bank of Canada where the currency is
published there, which is the source the CRA accepts for reporting, and from a
general rate service for the remainder. Rates are offered as a suggestion with
their source shown, can be overwritten, and are recorded against the converted
entry along with the original amount.

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

Ten automated checks fail the build rather than warn, each written after a
defect that reached a running application:

| Check | What it prevents |
|---|---|
| Declaration order | a hook reading a value declared below it |
| Stylesheet integrity | styles referencing classes that no longer exist |
| State ownership | a state setter called outside its component |
| Component nesting | form fields that lose focus on every keystroke |
| Write lock | a database write bypassing the read-only guard |
| Props contract | a prop that silently defaults instead of arriving |
| Optional comparison | a branch true because both sides are absent |
| Silent truncation | a rendered list dropping rows without saying so |
| Render-time access | a hook reading a value that does not exist yet |
| Hook scope | the same, one call deep, through a helper |

The last two are worth describing, because both defects were valid code that no
linter objects to.

`a?.id === b?.id` is true when both are missing, so a branch meant for one row
fired for every row that had nothing. And a list capped at forty rows showed a
partial figure with the appearance of a complete one; it hid sixteen bank lines
and was found by a person reading a statement against the screen.

The last two exist because one fault reached a running application twice in a
day. A value read during render before it was declared crashes the whole page,
not one section, and the first check missed the second occurrence because the
hook's own text was innocent: it called a helper, and the helper did the
reading. The second follows one call deep.

Both were written wrong before they were written right, and each attempt is
recorded in the file. One counted brackets to find where a hook ended and
overran into the next declaration. One matched property names as though they
were variables. One flagged helpers that only run when called, and was removed
rather than shipped, because a check with false positives blocks a build for no
reason and teaches people to disable it.

Fifty-two assertions cover the tax treatment engine and the filing-rule matcher,
including the duplicate-detection cases that previously produced wrong results.

**One check runs in front of the reader rather than at build time.** The detail
behind a figure and the figure itself are computed by different code from the
same data. When they disagree the detail view says so, names the difference, and
says the fault is worth reporting rather than adjusting. A reconciliation that
only runs in a test cannot catch a divergence introduced after it passed.

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

**Push notification is not implemented.** Email covers the cases that matter,
including a supplier submitting an invoice, but nothing reaches a closed
phone.

**Exchange rates come from a public service with no contractual availability.**
A rate that cannot be fetched falls back to being asked for, rather than
guessed, so a conversion is never invented; but the suggestion is absent when
the source is down.

**A contact's page is readable by anyone holding the address.** It says so on
the page. Signing in with the contact's own email is offered as an alternative
and makes a forwarded link useless, but it is an upgrade rather than a
requirement, because most suppliers will not create an account to read two
invoices.

**Orphaned bank Items may exist from before this was fixed.** Disconnecting
used to delete our record without telling Plaid, and a re-link overwrote the
previous token. Those Items cannot be enumerated by anyone but the provider's
support, and while they exist they may interfere with authentication at an
institution allowing one session per login.

**Contacts belong to a ledger.** A person you deal with in both your business
and personal books is saved twice, and a lookup on one ledger will not find a
name saved on the other.

## Business continuity

Data lives in Supabase with its managed backups. Every section of the
application exports to CSV without assistance, and a full tax pack exports for
any period, so a client's records can be removed from Brasstally at any time in
a format their accountant can use.
