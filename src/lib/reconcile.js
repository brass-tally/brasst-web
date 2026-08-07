// Reconciliation — matching bank lines to ledger entries, and explaining the
// gap that's left over. Pure functions, same contract as lib/analysis.js:
// no network, no React, so the agent and the UI quote identical numbers.
//
// The core idea: bank-versus-books drift is never a single number, it's a list.
// Every dollar of Δ is either a bank line nobody recorded, an entry that never
// cleared, or genuinely unexplained. Anchoring hides all three; this finds them.
//
// Shapes:
//   bankTxn { id, date, amount>0, direction: debit|credit, description,
//             pending, status: unmatched|matched|ignored, matchedTxId,
//             matchSource, reviewReason, removedAt }
//   tx      see lib/analysis.js

import { round2, daysBetween, similarity, isCash } from "./analysis";

// A bank debit is money leaving the account, which the books call an expense.
const TYPE_FOR = { debit: "expense", credit: "income" };

// Beyond this the pairing is guesswork: cards post 1-3 days after the swipe,
// cheques and pre-authorized debits can lag a few more.
const MAX_DAY_GAP = 5;
const CENT = 0.005;

/* ---------------- scoring one candidate pair ---------------- */

/**
 * Score a bank line against a ledger entry, or null if they can't be the same
 * event. Amount and direction must agree exactly — those are facts, not
 * signals. Date proximity and merchant text are what actually vary.
 */
export function scoreMatch(bankTxn, tx) {
  if (TYPE_FOR[bankTxn.direction] !== tx.type) return null;
  if (Math.abs(Number(tx.amount) - Number(bankTxn.amount)) > CENT) return null;
  const gap = Math.abs(daysBetween(bankTxn.date, tx.date));
  if (gap > MAX_DAY_GAP) return null;

  const text = similarity(bankTxn.description, tx.description);
  const dateScore = 1 - gap / (MAX_DAY_GAP + 1);
  const score = 0.55 * dateScore + 0.45 * text;

  // Three ways to be sure, because the two signals trade off against each
  // other. Bank descriptions ("SQ *FIGMA #4412") often share no words with what
  // someone typed ("design tool"), so text must never veto a same-day exact
  // amount — and equally, a card that posts three days after the swipe is
  // routine, so a near-perfect merchant match shouldn't be demoted for lag.
  const confidence =
    (gap === 0 && text >= 0.2) || (gap <= 1 && text >= 0.5) || (gap <= 3 && text >= 0.8) ? "high"
      : score >= 0.45 ? "medium"
        : "low";

  return { gap, text: round2(text), score: round2(score), confidence };
}

/* ---------------- proposing a whole set of matches ---------------- */

/**
 * Greedy one-to-one assignment across every open bank line and every ledger
 * entry that could still account for one.
 *
 * Returns { auto, suggested, unmatchedBank, unmatchedBook }. `auto` is safe to
 * apply without asking: high confidence AND no near-tie behind it. Anything a
 * person would have to think about lands in `suggested` instead.
 */
export function proposeMatches(bankTxns, txs, { anchorDate = "1970-01-01" } = {}) {
  const openBank = (bankTxns || []).filter(
    (b) => b.status === "unmatched" && !b.removedAt && b.date > anchorDate,
  );
  // Credit-denominated entries are real spend that never touches the bank, so
  // they can't be the other half of a bank line. Entries already spoken for by
  // another bank line are out too.
  const claimed = new Set((bankTxns || []).map((b) => b.matchedTxId).filter(Boolean));
  const openBook = (txs || []).filter(
    (t) => t.date && t.date > anchorDate && isCash(t) && !claimed.has(t.id),
  );

  const candidates = [];
  for (const b of openBank) {
    for (const t of openBook) {
      const s = scoreMatch(b, t);
      if (s) candidates.push({ bankId: b.id, txId: t.id, bank: b, tx: t, ...s });
    }
  }
  candidates.sort((x, y) => y.score - x.score);

  // Runner-up per bank line: a clear winner can be applied silently, a coin
  // flip between two identical charges must not be.
  const bestByBank = new Map();
  const runnerUpByBank = new Map();
  for (const c of candidates) {
    if (!bestByBank.has(c.bankId)) bestByBank.set(c.bankId, c);
    else if (!runnerUpByBank.has(c.bankId)) runnerUpByBank.set(c.bankId, c);
  }

  const takenBank = new Set(), takenTx = new Set();
  const auto = [], suggested = [];
  for (const c of candidates) {
    if (takenBank.has(c.bankId) || takenTx.has(c.txId)) continue;
    takenBank.add(c.bankId);
    takenTx.add(c.txId);

    const runnerUp = runnerUpByBank.get(c.bankId);
    const ambiguous = runnerUp && c.score - runnerUp.score < 0.05;
    const pair = { ...c, ambiguous: Boolean(ambiguous) };
    if (c.confidence === "high" && !ambiguous) auto.push(pair);
    else suggested.push(pair);
  }

  return {
    auto,
    suggested,
    unmatchedBank: openBank.filter((b) => !takenBank.has(b.id)),
    unmatchedBook: openBook.filter((t) => !takenTx.has(t.id)),
  };
}

/* ---------------- what the delta is actually made of ---------------- */

/**
 * Decompose bank-minus-books into named lines.
 *
 * A bank line nobody recorded moves the bank but not the books; an entry that
 * never cleared moves the books but not the bank. Sum those two effects and
 * whatever is left over is genuinely unexplained — a wrong anchor, a
 * transaction outside the matching window, or an account the ledger can't see.
 *
 * Only activity after the anchor date counts: everything on or before it is
 * already baked into the anchor amount, so counting it again double-counts.
 *
 * Note that pending suggestions don't skew the totals. A proposed pair leaves
 * both sides out of the lists, but had it been left in, the bank line and the
 * ledger entry would contribute equal and opposite effects — so `explained` and
 * `unexplained` come out the same either way. Only the item lists get shorter.
 */
export function explainDelta(bankTxns, txs, { balance } = {}) {
  const anchorDate = balance?.anchorDate || "1970-01-01";
  const delta = balance?.delta;

  const { auto, suggested, unmatchedBank, unmatchedBook } = proposeMatches(bankTxns, txs, { anchorDate });
  const flagged = (bankTxns || []).filter((b) => b.reviewReason);

  // Money the bank has seen and the books haven't.
  const bankOnly = unmatchedBank.map((b) => ({
    id: b.id,
    date: b.date,
    description: b.description,
    amount: round2(b.amount),
    direction: b.direction,
    pending: Boolean(b.pending),
    effect: round2(b.direction === "credit" ? b.amount : -b.amount),
  }));

  // Money the books have recorded and the bank hasn't cleared.
  const bookOnly = unmatchedBook.map((t) => ({
    id: t.id,
    date: t.date,
    description: t.description,
    amount: round2(t.amount),
    type: t.type,
    effect: round2(t.type === "income" ? -t.amount : t.amount),
  }));

  const fromBank = round2(bankOnly.reduce((s, r) => s + r.effect, 0));
  const fromBooks = round2(bookOnly.reduce((s, r) => s + r.effect, 0));
  const explained = round2(fromBank + fromBooks);
  const pendingCount = bankOnly.filter((r) => r.pending).length;

  return {
    delta: delta == null ? null : round2(delta),
    explained,
    unexplained: delta == null ? null : round2(delta - explained),
    bankOnly: {
      count: bankOnly.length,
      effect: fromBank,
      pendingCount,
      items: bankOnly.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 40),
    },
    bookOnly: {
      count: bookOnly.length,
      effect: fromBooks,
      items: bookOnly.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 40),
    },
    readyToMatch: auto.length,
    needsAChoice: suggested.length,
    needsReview: flagged.length,
    // Fingerprint of everything still open. Two reads of the same untouched
    // ledger produce the same string; a new bank line, a new or edited entry,
    // or a move in the bank's own balance produces a different one. This is
    // what lets the app stop asking once the work has actually been done.
    //
    // Deliberately built from ids and amounts rather than from the delta: the
    // book balance is computed up to the month on screen, so a delta-based
    // fingerprint would change every time someone paged back a month and the
    // app would start asking all over again.
    openSignature: signatureOf([
      // Every bank line still open, including the ones a proposed pair has
      // spoken for — a pending suggestion is work that hasn't been done yet.
      [...unmatchedBank, ...auto.map((p) => p.bank), ...suggested.map((p) => p.bank)]
        .map((b) => `${b.id}:${round2(b.amount).toFixed(2)}:${b.date}:${b.pending ? "p" : ""}`).sort().join(","),
      [...unmatchedBook, ...auto.map((p) => p.tx), ...suggested.map((p) => p.tx)]
        .map((t) => `${t.id}:${round2(t.amount).toFixed(2)}:${t.date}`).sort().join(","),
      flagged.map((b) => `${b.id}:${b.reviewReason}`).sort().join(","),
      // Month-independent, unlike the delta: the bank's own figure, and the
      // anchor the books count from.
      balance?.bank == null ? "na" : round2(balance.bank).toFixed(2),
      `${round2(balance?.anchorAmount ?? 0).toFixed(2)}@${anchorDate}`,
    ]),
    reading: delta == null
      ? "No bank connected — the book balance is the only figure."
      : Math.abs(delta) < 0.01
        ? "Bank and books agree."
        : Math.abs(round2(delta - explained)) < 0.01
          ? `Every cent of the ${fmtish(delta)} gap is accounted for by ${bankOnly.length} bank ${plural(bankOnly.length, "line")} and ${bookOnly.length} ledger ${plural(bookOnly.length, "entry", "entries")} that haven't been paired up.`
          : `${fmtish(explained)} of the ${fmtish(delta)} gap is named line by line; ${fmtish(round2(delta - explained))} is not, which usually means the anchor is wrong or an account isn't connected.`,
  };
}

const plural = (n, one, many) => (n === 1 ? one : many || `${one}s`);
const fmtish = (n) => `${n < 0 ? "-" : ""}$${Math.abs(Number(n) || 0).toFixed(2)}`;

/* ---------------- signatures ---------------- */

/**
 * Short stable hash of whatever parts describe "what's still open". Used to
 * decide whether a reconciliation the user already finished still applies, so
 * switching ledgers or reloading doesn't ask for the same work twice. FNV-1a:
 * no crypto needed, it only has to change when the input changes.
 */
export function signatureOf(parts) {
  const s = (parts || []).map((p) => String(p ?? "")).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/* ---------------- duplicates ---------------- */

// Same amount, same direction, within a few days, and the description agrees:
// that's one event written down twice, not two events that happen to rhyme.
const DUP_WINDOW_DAYS = 3;
const DUP_TEXT = 0.8;

/**
 * Groups of ledger entries that look like the same event recorded more than
 * once. Each group names one entry to keep and the extras that can go.
 *
 * Two rules keep this from eating real data:
 *   · An entry a bank line has matched is proof the money moved, so it's always
 *     the keeper — and if two members are both bank-matched the bank saw two
 *     separate events, so the group isn't a duplicate at all and is dropped.
 *   · Transfers are two linked halves by design and are never candidates.
 *
 * Nothing here deletes anything; the caller decides, group by group.
 */
export function findDuplicateEntries(txs, { bankTxns = [], windowDays = DUP_WINDOW_DAYS, minAmount = 0.01 } = {}) {
  const matchedIds = new Set(
    (bankTxns || []).filter((b) => b.status === "matched" && b.matchedTxId).map((b) => b.matchedTxId),
  );
  const rows = (txs || []).filter((t) => t.id && t.date && !t.transferId && Number(t.amount) >= minAmount);

  const buckets = new Map();
  for (const t of rows) {
    const key = `${t.type}|${round2(t.amount).toFixed(2)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }

  const groups = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => (a.date === b.date ? String(a.id).localeCompare(String(b.id)) : a.date < b.date ? -1 : 1));
    const used = new Set();

    for (let i = 0; i < sorted.length; i++) {
      if (used.has(sorted[i].id)) continue;
      const members = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(sorted[j].id)) continue;
        // sorted by date, so once we're past the window everything after is too
        if (Math.abs(daysBetween(sorted[i].date, sorted[j].date)) > windowDays) break;
        if (similarity(sorted[i].description, sorted[j].description) < DUP_TEXT) continue;
        members.push(sorted[j]);
      }
      if (members.length < 2) continue;
      for (const m of members) used.add(m.id);

      // Both halves cleared the bank → two real events that look alike.
      if (members.filter((m) => matchedIds.has(m.id)).length > 1) continue;

      const score = (t) => (matchedIds.has(t.id) ? 4 : 0) + (t.attachmentId ? 2 : 0) + (t.subcategory ? 1 : 0);
      const keep = [...members].sort((a, b) => score(b) - score(a) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
      const extras = members.filter((m) => m.id !== keep.id);
      const identical = extras.every((e) => e.date === keep.date && similarity(e.description, keep.description) >= 0.999);

      groups.push({
        id: `dup-${keep.id}`,
        type: keep.type,
        amount: round2(keep.amount),
        date: keep.date,
        description: keep.description,
        confidence: identical ? "high" : "medium",
        keep,
        extras,
        extraTotal: round2(extras.reduce((s, e) => s + Number(e.amount || 0), 0)),
        reason: matchedIds.has(keep.id)
          ? "one copy is matched to a bank line, the others aren't backed by anything"
          : identical
            ? `${members.length} identical copies on ${keep.date} — usually a statement imported twice`
            : "same amount within a few days and the descriptions agree",
      });
    }
  }

  return groups.sort((a, b) => b.extraTotal - a.extraTotal);
}

/**
 * The same bank line delivered twice — an account linked through two
 * connections, or a re-sync that landed under a fresh Plaid id. Extras get
 * ignored rather than deleted: the rows are the durable record of what the bank
 * sent, and deleting one just invites the next sync to re-create it.
 */
export function findDuplicateBankLines(bankTxns) {
  const live = (bankTxns || []).filter((b) => !b.removedAt && b.status !== "ignored");
  const buckets = new Map();
  for (const b of live) {
    const key = `${b.date}|${round2(b.amount).toFixed(2)}|${b.direction}|${String(b.description || "").trim().toLowerCase()}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(b);
  }

  const groups = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    // Two lines the same bank sent under one connection with different ids are
    // two real charges (think two identical coffees). Only cross-connection
    // repeats, or a pending line re-delivered as posted, are duplicates.
    const connections = new Set(members.map((m) => m.connectionId));
    const pendingSplit = new Set(members.map((m) => Boolean(m.pending))).size > 1;
    if (connections.size < 2 && !pendingSplit) continue;

    const score = (b) => (b.status === "matched" ? 4 : 0) + (b.pending ? 0 : 1);
    const keep = [...members].sort((a, b) => score(b) - score(a))[0];
    const extras = members.filter((m) => m.id !== keep.id);
    groups.push({
      id: `dupbank-${keep.id}`,
      date: keep.date,
      amount: round2(keep.amount),
      direction: keep.direction,
      description: keep.description,
      keep,
      extras,
      reason: connections.size > 1
        ? "the same line arrived from two connections — the account is probably linked twice"
        : "a pending line was re-delivered after it posted",
    });
  }
  return groups.sort((a, b) => b.amount - a.amount);
}

/**
 * Is this bank line probably already in the books, just dated further out than
 * the matcher's window? Answering before an entry gets created is the whole
 * point: adding it anyway is how a ledger grows duplicates.
 */
export function likelyAlreadyInBooks(bankTxn, txs, bankTxns, { windowDays = 21 } = {}) {
  const claimed = new Set((bankTxns || []).map((b) => b.matchedTxId).filter(Boolean));
  const type = TYPE_FOR[bankTxn.direction];
  let best = null;
  for (const t of txs || []) {
    if (t.type !== type || claimed.has(t.id) || !t.date) continue;
    if (Math.abs(Number(t.amount) - Number(bankTxn.amount)) > CENT) continue;
    const gap = Math.abs(daysBetween(bankTxn.date, t.date));
    if (gap > windowDays) continue;
    const text = similarity(bankTxn.description, t.description);
    const score = text + (1 - gap / (windowDays + 1));
    if (!best || score > best.score) best = { tx: t, gap, text: round2(text), score };
  }
  // A same-amount entry three weeks out is only interesting if the description
  // backs it up; closer than a week, the amount alone is enough of a warning.
  if (!best) return null;
  if (best.gap > 7 && best.text < 0.4) return null;
  return best;
}

/* ---------------- reconciliation status of a single entry ---------------- */

/** Map of ledger tx id → the bank line that cleared it. */
export function clearedIndex(bankTxns) {
  const map = new Map();
  for (const b of bankTxns || []) {
    if (b.status === "matched" && b.matchedTxId) map.set(b.matchedTxId, b);
  }
  return map;
}
