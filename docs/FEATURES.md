# Brasstally: what it does

Bookkeeping for owner-operated Canadian companies. Two ledgers, one for the
business and one for the person running it, kept as separate records rather
than filtered views of one pile.

**As at 9 September 2026.** Developed by GENIE AI, Inc., Ontario, Canada.

---

## Capture

**Photograph a receipt.** Vendor, amount, date, tax and a suggested category
are read off the page and the form is filled in. Every field stays editable,
because a model reading a crumpled receipt can be wrong and you are the one
filing the return.

**Type it in plain words.** "paid Vercel $70 today" becomes an entry with a
category and a date.

**A receipt settles the bill it pays.** If a photographed receipt matches an
open payable by party and amount, it offers to settle that bill rather than
adding a second entry. The receipt becomes the evidence the settle step asks
for.

**Import a statement.** Paste or upload, then review line by line with
duplicates caught before they land.

**Filing rules.** Categorise an unmatched bank line once and the same line is
filed the same way next month. Keyed on the description with reference numbers
and dates stripped, so a monthly fee is recognised across instances.

## The books

**Snapshot.** Balance, net for the month, money in and out, owed to you, you
owe. Cards can be turned on and off, and the two wide ones lead. A condensing
bar keeps the figures visible as you scroll.

**What wants you.** Three panels above the numbers: what needs a decision, how
close the month is to closed, and the reports you keep returning to. The
closing checklist is derived from the books, not ticked by hand, so the
percentage is a fact rather than a record of your diligence.

**Transactions.** Search across description, category and subcategory, filter
by direction and account, inline editing, attachments, transfers between
ledgers, recurring entries.

**AR and AP.** Who owes you and what you owe, grouped by party with running
totals. Settling requires a receipt, and a settled entry locks.

**Credits.** Non-cash pools such as AWS or Anthropic credits, tracked beside
cash. What is left leads, what it bought is listed underneath, and none of it
touches your bank balance.

**Calendar.** A month grid where a day with something on it lifts off the page,
plus expected in and out over the next thirty days.

**Profit and loss.** Revenue, expenses and net with month-over-month change,
category breakdown, six-month trend, average daily burn, CSV export.

**Reports.** Any period cut into a statement, the months behind it, and where
the money went. Every block exports as CSV or PDF.

## The bank

**Connect through Plaid.** You sign in on your bank's own screen. The token we
receive reads transactions and balances and cannot move money.

**Consolidate.** Pairing what the bank saw with what the books say so every
difference has a name. The app states its plan before running it, does the
certain work itself, and asks about the rest.

**Duplicates, two tiers.** Identical entries on the same day with the same
reference are removed automatically and recorded. Anything ambiguous is asked
about, and a cluster too large to be copies is reported rather than deleted.

**A record of every run.** What was paired, created, removed and set aside,
kept so a consolidation can be explained later.

## Tax

**GST and HST per receipt.** Read as printed rather than calculated, with the
regime recorded, so the recoverable share is known. It knows the provincial
portion is not recoverable in BC or Saskatchewan.

**Rules applied as you go.** Meals halved on both the deduction and the credit,
because CRA limits them together. Capital separated from expense against a
threshold you adopt, with a CCA class suggested.

**Tax pack.** A period's figures, every category on the CRA line it belongs to,
capital additions with their classes, and the net tax position owing or
refundable. One CSV for your accountant, ending with your capitalisation
policy, registration status and province.

**Receipts on file.** Every entry in the period with a document behind it, plus
the count of those without one and the total at risk.

**Corporate and personal drafts.** Your year mapped onto GIFI lines with
deadlines tracked, and a T1 working paper for what CRA cannot see.

## Tally

**Ask about the money.** Eighteen tools over your own ledger: variance, trends,
obligations, balance breakdown, duplicates, recurring costs, cash forecast,
data quality.

**Proposals, not actions.** Tally drafts a transaction, an obligation, a
settlement, a budget or an anchor, and you confirm it.

**Speaks first, once.** At most one message, only when something is worth
saying, dismissed for good when dismissed.

**Guides.** A brief per section for filing T1, filing T2, the bank feed,
consolidating and AR/AP.

## Working with other people

**Read access for your accountant.** Per ledger, by email address, granted at
the database rather than in the interface. They see the books and not the bank
credential. They cannot change anything.

**An intake link for suppliers.** Send a contractor a link and their invoice
arrives in a tray in AR/AP with the PDF attached. Both sides are emailed.
Accepting creates an ordinary payable; nothing reaches the books unaccepted.

## The app itself

**Runs in a browser, installs to a phone.** Offline-tolerant, safe-area aware,
44px targets throughout.

**Four palettes** in light and dark, every combination contrast-checked.

**Everything exports.** Every section to CSV without asking us, and a whole
period as a tax pack.

**Published documents.** A privacy policy, terms of use, and a plain-language
page on how financial data is handled, all readable inside the app.

---

# What is next

Ordered by how much it costs you today.

## Soon

**Push notifications.** An invoice arriving, a bank line needing attention, a
payable due tomorrow. Email and an in-app mark cover it now, which does not
reach you when the app is shut.

**A screen for your filing rules.** Rules are learned and used but there is
nowhere to see the set or remove one.

**Multi-user access for a firm.** Sharing is one reader per email today. A
practice needs its own login into a client's ledger, and a client needs to see
who looked.

**Read-only polish.** A shared reader can still open dialogs whose writes are
then refused with an explanation. They should be absent rather than refused.

## Next

**GST and HST filing periods.** The pack computes a net position; it does not
yet know your filing frequency or track what has been remitted.

**CCA schedules.** Classes are suggested. The half-year rule, immediate
expensing and the pools themselves are still your accountant's work.

**Per-vendor tax memory.** The regime is inferred from the printed rate, so an
out-of-province receipt can be mislabelled until corrected.

**Invoices you send.** Brasstally records what you are owed but does not issue
the invoice. The intake link works in one direction only.

**Multi-currency.** One currency per ledger today, foreign purchases recorded
at whatever the bank charged.

## Later

**Payroll.** Not attempted. A business with employees needs a payroll product
alongside this.

**An audit trail export.** Changes are recorded but there is no formal
who-changed-what report.

**Attachment search.** Receipts are stored and previewable but not searchable
by their contents.

---

## What it will not do

Stated so nobody discovers it later.

**It is not an accountant.** It prepares and shows its working. Nothing in it
is accounting, tax or legal advice.

**It cannot file.** No Canadian tax software exposes a filing interface to
third parties. Anyone claiming one-click filing is transmitting through
certified software you could have used directly. Brasstally prepares the
package and tracks the return through draft, sent, filed and assessed.

**It never moves money.** Bank connections are read only.

**It does not sell data or show advertising.** Your ledger is not used to train
models.
