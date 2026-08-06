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
    needsReview: (bankTxns || []).filter((b) => b.reviewReason).length,
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

/* ---------------- reconciliation status of a single entry ---------------- */

/** Map of ledger tx id → the bank line that cleared it. */
export function clearedIndex(bankTxns) {
  const map = new Map();
  for (const b of bankTxns || []) {
    if (b.status === "matched" && b.matchedTxId) map.set(b.matchedTxId, b);
  }
  return map;
}
