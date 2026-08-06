// Ledger analytics — pure functions over the in-memory snapshot that App.jsx
// already renders from. Nothing here touches the network or React.
//
// Both the agent's tools (lib/agent.js) and the proactive insight pass
// (lib/insights.js) read through this file, so a number the agent quotes in
// chat and a number on a card can't drift apart.
//
// Shapes (see lib/db.js):
//   tx   { id, date, amount>0, type: expense|income, category, subcategory,
//          description, account, recurrence, payMethod, creditId, transferId,
//          plExclude, attachmentId }
//   obl  { id, party, description, amount, dueDate, status, settledOn,
//          account, recurrence, frequency, category, payMethod, attachmentId }

import { todayLocal } from "./parse";

export const todayStr = todayLocal;

/* ---------------- small shared helpers ---------------- */

// Credit-denominated entries are real spend but never move the bank balance.
export const isCash = (x) => x?.payMethod !== "credits";
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const monthOf = (date) => String(date || "").slice(0, 7);

export const shiftMonth = (ym, d) => {
  const [y, m] = String(ym).split("-").map(Number);
  const dt = new Date(y, m - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};

export const addInterval = (dateStr, freq) => {
  const d = new Date(dateStr + "T00:00:00");
  if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "biweekly") d.setDate(d.getDate() + 14);
  else if (freq === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly default
  return d.toISOString().slice(0, 10);
};

export const addDays = (dateStr, n) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const daysBetween = (a, b) =>
  Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

const sum = (rows, pick = (r) => r.amount) => round2(rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0));

// Merchant names arrive with reference numbers, store ids, and punctuation
// glued on. Strip those so "SQ *FIGMA #4412" and "Figma" land in one bucket.
const normalizeText = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[#*]/g, " ")
    .replace(/\b(?:inc|llc|ltd|corp|co|the)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b\d{3,}\b/g, " ") // reference/order numbers, not part of the name
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s) => normalizeText(s).split(" ").filter((t) => t.length > 2);

// Jaccard overlap on words, with a containment shortcut for
// "Vercel" vs "Vercel Inc monthly".
export function similarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  if (shared === A.size || shared === B.size) return 1;
  return shared / (A.size + B.size - shared);
}

/* ---------------- headline snapshot ---------------- */

export function ledgerSummary(data, { balance, month, bankConns = [], recon = null } = {}) {
  const txs = data.transactions || [];
  const dates = txs.map((t) => t.date).filter(Boolean).sort();
  const openAr = (data.receivables || []).filter((r) => r.status === "open");
  const openAp = (data.payables || []).filter((r) => r.status === "open");
  const today = todayStr();

  return {
    ledger: {
      name: data.ledger.name,
      kind: data.ledger.kind,
      currency: data.ledger.currency || "CAD",
      fiscalYearEnd: data.ledger.fye || "12-31",
    },
    today,
    monthInView: month,
    balance: {
      shown: round2(balance?.value ?? 0),
      source: balance?.source || "books",
      book: round2(balance?.book ?? 0),
      bank: balance?.bank == null ? null : round2(balance.bank),
      delta_bank_minus_book: balance?.delta == null ? null : round2(balance.delta),
      anchor: { amount: round2(balance?.anchorAmount ?? 0), date: balance?.anchorDate || null },
      bankBalanceAsOf: balance?.balanceAsOf ? String(balance.balanceAsOf).slice(0, 10) : null,
    },
    openObligations: {
      receivable_total: sum(openAr),
      receivable_count: openAr.length,
      payable_total: sum(openAp),
      payable_count: openAp.length,
      overdue_receivable: sum(openAr.filter((r) => r.dueDate && r.dueDate < today)),
      overdue_payable: sum(openAp.filter((r) => r.dueDate && r.dueDate < today)),
      note: "Open AR/AP are not in the balance; they only move cash when settled.",
    },
    transactions: {
      count: txs.length,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null,
    },
    categories: {
      expense: (data.categories?.expense || []).map((c) => c.name),
      income: (data.categories?.income || []).map((c) => c.name),
    },
    creditPools: creditPools(data),
    bank: {
      connected: (bankConns || []).length > 0,
      institutions: (bankConns || []).map((c) => c.institution).filter(Boolean),
      lastSynced: (bankConns || []).map((c) => c.last_synced).filter(Boolean).sort().pop() || null,
      unmatchedBankLines: recon?.bankOnly?.count ?? 0,
      unclearedEntries: recon?.bookOnly?.count ?? 0,
    },
  };
}

export function creditPools(data) {
  return (data.credits || []).map((pool) => {
    const spent = sum((data.transactions || []).filter((t) => t.creditId === pool.id && t.type === "expense"));
    const earned = sum((data.transactions || []).filter((t) => t.creditId === pool.id && t.type === "income"));
    return {
      name: pool.name,
      granted: round2(pool.initial),
      spent,
      remaining: round2(pool.initial - (pool.usedAdjustment || 0) + earned - spent),
    };
  });
}

/* ---------------- transaction queries ---------------- */

const txOut = (t) => ({
  id: t.id,
  date: t.date,
  amount: round2(t.amount),
  type: t.type,
  category: t.category,
  subcategory: t.subcategory || null,
  description: t.description,
  recurrence: t.recurrence,
  paidWith: t.payMethod === "credits" ? "credits" : "cash",
  hasReceipt: !!t.attachmentId,
  isTransfer: !!t.transferId,
});

export function listTransactions(data, {
  month, from, to, type, category, subcategory, search,
  minAmount, maxAmount, paidWith, sort = "date_desc", limit = 40,
} = {}) {
  const q = normalizeText(search);
  let rows = (data.transactions || []).filter((t) => {
    if (month && monthOf(t.date) !== month) return false;
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (type && t.type !== type) return false;
    if (category && t.category !== category) return false;
    if (subcategory && t.subcategory !== subcategory) return false;
    if (paidWith === "cash" && !isCash(t)) return false;
    if (paidWith === "credits" && isCash(t)) return false;
    if (minAmount != null && t.amount < minAmount) return false;
    if (maxAmount != null && t.amount > maxAmount) return false;
    if (q && !normalizeText(`${t.description} ${t.category} ${t.subcategory || ""}`).includes(q)) return false;
    return true;
  });

  const total = rows.length;
  const cmp = {
    date_desc: (a, b) => (a.date < b.date ? 1 : -1),
    date_asc: (a, b) => (a.date > b.date ? 1 : -1),
    amount_desc: (a, b) => b.amount - a.amount,
    amount_asc: (a, b) => a.amount - b.amount,
  }[sort] || ((a, b) => (a.date < b.date ? 1 : -1));
  rows = [...rows].sort(cmp);

  const capped = rows.slice(0, Math.min(Math.max(Number(limit) || 40, 1), 100));
  return {
    matched: total,
    returned: capped.length,
    truncated: total > capped.length,
    totals: {
      expense: sum(rows.filter((t) => t.type === "expense")),
      income: sum(rows.filter((t) => t.type === "income")),
      cash_only_expense: sum(rows.filter((t) => t.type === "expense" && isCash(t))),
    },
    transactions: capped.map(txOut),
  };
}

/* ---------------- budget variance ---------------- */

export function categoryVariance(data, month) {
  const inMonth = (data.transactions || []).filter((t) => monthOf(t.date) === month);
  const build = (type) =>
    (data.categories?.[type] || [])
      .map((c) => {
        const rows = inMonth.filter((t) => t.type === type && t.category === c.name);
        const actual = sum(rows);
        return {
          category: c.name,
          planned: round2(c.planned),
          actual,
          // Positive = healthy: under budget on expenses, over target on income.
          variance: type === "expense" ? round2(c.planned - actual) : round2(actual - c.planned),
          pctOfPlan: c.planned ? Math.round((actual / c.planned) * 100) : null,
          entries: rows.length,
        };
      })
      .filter((r) => r.planned || r.actual)
      .sort((a, b) => a.variance - b.variance);

  const expense = build("expense");
  const income = build("income");
  return {
    month,
    expense,
    income,
    totals: {
      planned_expense: sum(expense, (r) => r.planned),
      actual_expense: sum(expense, (r) => r.actual),
      planned_income: sum(income, (r) => r.planned),
      actual_income: sum(income, (r) => r.actual),
      unbudgeted_categories: expense.filter((r) => !r.planned && r.actual).map((r) => r.category),
    },
  };
}

/* ---------------- trend over months ---------------- */

export function monthlyTotals(data, { months = 6, endMonth, category, type } = {}) {
  const end = endMonth || monthOf(todayStr());
  const span = Math.min(Math.max(Number(months) || 6, 1), 24);
  const keys = Array.from({ length: span }, (_, i) => shiftMonth(end, -(span - 1 - i)));

  const rows = keys.map((m) => {
    const inMonth = (data.transactions || []).filter(
      (t) => monthOf(t.date) === m && (!category || t.category === category) && (!type || t.type === type),
    );
    const income = sum(inMonth.filter((t) => t.type === "income"));
    const expense = sum(inMonth.filter((t) => t.type === "expense"));
    return { month: m, income, expense, net: round2(income - expense), entries: inMonth.length };
  });

  // Two kinds of month would drag every average down and neither is real
  // spending: the current one is only partly through, and months before the
  // ledger's first entry are empty because nothing was tracked yet, not
  // because nothing was spent.
  const firstMonth = monthOf((data.transactions || []).map((t) => t.date).filter(Boolean).sort()[0] || "");
  const complete = rows.filter((r) => r.month !== monthOf(todayStr()) && firstMonth && r.month >= firstMonth);
  const avg = (pick) => (complete.length ? round2(sum(complete, pick) / complete.length) : 0);

  return {
    filter: { category: category || null, type: type || null },
    months: rows,
    averages_excluding_current_month: {
      income: avg((r) => r.income),
      expense: avg((r) => r.expense),
      net: avg((r) => r.net),
      basedOnMonths: complete.length,
    },
  };
}

// Which categories moved most against their own recent baseline.
export function categoryShifts(data, { month, lookback = 3, minAmount = 25 } = {}) {
  const m = month || monthOf(todayStr());
  const baseMonths = Array.from({ length: lookback }, (_, i) => shiftMonth(m, -(i + 1)));
  const out = [];

  for (const c of data.categories?.expense || []) {
    const current = sum((data.transactions || []).filter((t) => t.type === "expense" && t.category === c.name && monthOf(t.date) === m));
    const past = baseMonths.map((bm) =>
      sum((data.transactions || []).filter((t) => t.type === "expense" && t.category === c.name && monthOf(t.date) === bm)));
    const baseline = round2(past.reduce((s, v) => s + v, 0) / (baseMonths.length || 1));
    const change = round2(current - baseline);
    if (Math.abs(change) < minAmount) continue;
    out.push({
      category: c.name,
      thisMonth: current,
      baseline,
      change,
      pctChange: baseline ? Math.round((change / baseline) * 100) : null,
    });
  }
  return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

/* ---------------- receivables & payables ---------------- */

const bucketFor = (days) =>
  days <= 0 ? "not_yet_due" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";

export function obligationsView(data, { kind, status = "open", limit = 40 } = {}) {
  const today = todayStr();
  const kinds = kind ? [kind] : ["receivables", "payables"];
  const out = {};

  for (const k of kinds) {
    const items = (data[k] || []).filter((o) => (status === "all" ? true : o.status === status));
    const rows = items
      .map((o) => {
        const overdueBy = o.dueDate && o.status === "open" ? daysBetween(o.dueDate, today) : 0;
        return {
          id: o.id,
          party: o.party,
          description: o.description,
          amount: round2(o.amount),
          dueDate: o.dueDate || null,
          status: o.status,
          settledOn: o.settledOn || null,
          recurring: o.recurrence === "recurring",
          frequency: o.frequency || null,
          daysOverdue: overdueBy > 0 ? overdueBy : 0,
          bucket: bucketFor(overdueBy),
          hasAttachment: !!o.attachmentId,
        };
      })
      .sort((a, b) => (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1);

    const aging = {};
    for (const r of rows.filter((r) => r.status === "open")) {
      aging[r.bucket] = round2((aging[r.bucket] || 0) + r.amount);
    }

    out[k] = {
      count: rows.length,
      total: sum(rows),
      aging,
      oldestOverdueDays: Math.max(0, ...rows.map((r) => r.daysOverdue)),
      items: rows.slice(0, Math.min(Math.max(Number(limit) || 40, 1), 100)),
      truncated: rows.length > limit,
    };
  }
  return out;
}

/* ---------------- duplicate scan ---------------- */

export function findDuplicates(data, { windowDays = 6, minAmount = 5, threshold = 0.5 } = {}) {
  const txs = (data.transactions || []).filter((t) => t.date && t.amount >= minAmount && !t.transferId);
  const byAmount = new Map();
  for (const t of txs) {
    const key = round2(t.amount).toFixed(2);
    if (!byAmount.has(key)) byAmount.set(key, []);
    byAmount.get(key).push(t);
  }

  const pairs = [];
  for (const group of byAmount.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const gap = daysBetween(sorted[i].date, sorted[j].date);
        if (gap > windowDays) break; // sorted by date: everything after is further out
        if (sorted[i].type !== sorted[j].type) continue;
        const score = similarity(sorted[i].description, sorted[j].description);
        if (score < threshold) continue;
        pairs.push({
          amount: round2(sorted[i].amount),
          daysApart: gap,
          confidence: score >= 0.85 ? "high" : score >= 0.65 ? "medium" : "low",
          a: txOut(sorted[i]),
          b: txOut(sorted[j]),
          // A settlement writes "Paid: <party>" — a manual entry for the same
          // bill is the single most common way this ledger doubles up.
          likelyCause: /^(paid|received):/i.test(sorted[j].description) || /^(paid|received):/i.test(sorted[i].description)
            ? "one side looks like an AR/AP settlement, the other like a manual or imported entry"
            : gap === 0
              ? "same day, same amount — often a double import or a double tap"
              : "same amount within a few days",
        });
      }
    }
  }
  return {
    windowDays,
    found: pairs.length,
    pairs: pairs.sort((a, b) => b.amount - a.amount).slice(0, 20),
  };
}

/* ---------------- where the balance comes from ---------------- */

export function balanceBreakdown(data, { balance, bankConns = [], recon = null } = {}) {
  const anchorDate = balance?.anchorDate || data.settings?.anchorDate || "1970-01-01";
  const since = (data.transactions || []).filter((t) => t.date && t.date > anchorDate && isCash(t));
  const income = sum(since.filter((t) => t.type === "income"));
  const expense = sum(since.filter((t) => t.type === "expense"));
  const creditOnly = (data.transactions || []).filter((t) => t.date > anchorDate && !isCash(t));

  const delta = balance?.delta;
  return {
    anchor: { amount: round2(balance?.anchorAmount ?? 0), date: anchorDate, source: "last reconcile or statement import" },
    sinceAnchor: {
      cashIn: income,
      cashOut: expense,
      net: round2(income - expense),
      cashEntries: since.length,
      creditPaidEntriesExcluded: creditOnly.length,
      excludedTotal: sum(creditOnly),
    },
    book: round2(balance?.book ?? 0),
    bank: balance?.bank == null ? null : round2(balance.bank),
    delta: delta == null ? null : round2(delta),
    reading: delta == null
      ? "No bank connected — the book balance is the only figure."
      : Math.abs(delta) < 0.01
        ? "Bank and books agree."
        : delta > 0
          ? "The bank holds more than the books: money arrived that isn't recorded, or a recorded expense never actually cleared."
          : "The books hold more than the bank: spending cleared that isn't recorded, or a recorded deposit never landed.",
    // The named half of the drift, straight from the reconciliation pass. Quote
    // these lines rather than the generic causes below whenever they exist.
    reconciliation: recon
      ? {
          explained: recon.explained,
          unexplained: recon.unexplained,
          unmatchedBankLines: recon.bankOnly,
          unclearedEntries: recon.bookOnly,
          readyToMatch: recon.readyToMatch,
          needsAChoice: recon.needsAChoice,
          needsReview: recon.needsReview,
          reading: recon.reading,
        }
      : null,
    thingsThatCauseDrift: [
      "transactions after the anchor date that were never entered (sync or import them)",
      "an entry recorded twice (see find_duplicates)",
      "an AR/AP settled in the app on a date the bank cleared differently",
      "a stale bank balance — check bankBalanceAsOf",
      "an anchor set to the wrong date, so pre-anchor entries are double-counted",
    ],
    bankBalanceAsOf: balance?.balanceAsOf ? String(balance.balanceAsOf).slice(0, 10) : null,
    lastSynced: (bankConns || []).map((c) => c.last_synced).filter(Boolean).sort().pop() || null,
  };
}

/* ---------------- recurring commitments ---------------- */

const MONTHLY_FACTOR = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

export function recurringCosts(data) {
  const flagged = (data.transactions || []).filter((t) => t.recurrence === "recurring" && t.type === "expense");

  // Group flagged entries by merchant so a monthly charge shows as one line
  // with its history, not twelve rows.
  const groups = [];
  for (const t of flagged) {
    const hit = groups.find((g) => similarity(g.name, t.description) >= 0.6);
    if (hit) hit.rows.push(t);
    else groups.push({ name: t.description, rows: [t] });
  }

  const subscriptions = groups
    .map((g) => {
      const rows = [...g.rows].sort((a, b) => (a.date < b.date ? 1 : -1));
      const latest = rows[0];
      const previous = rows.find((r) => Math.abs(r.amount - latest.amount) > 0.01);
      return {
        name: g.name,
        category: latest.category,
        latestAmount: round2(latest.amount),
        latestDate: latest.date,
        occurrences: rows.length,
        priceChanged: previous
          ? { from: round2(previous.amount), on: previous.date, change: round2(latest.amount - previous.amount) }
          : null,
        paidWith: latest.payMethod === "credits" ? "credits" : "cash",
      };
    })
    .sort((a, b) => b.latestAmount - a.latestAmount);

  const scheduled = ["receivables", "payables"].flatMap((kind) =>
    (data[kind] || [])
      .filter((o) => o.recurrence === "recurring" && o.status === "open")
      .map((o) => ({
        kind,
        party: o.party,
        amount: round2(o.amount),
        frequency: o.frequency || "monthly",
        nextDue: o.dueDate || null,
        monthlyEquivalent: round2(o.amount * (MONTHLY_FACTOR[o.frequency || "monthly"] || 1)),
      })),
  );

  return {
    subscriptions,
    subscriptionMonthlyTotal: sum(subscriptions, (s) => s.latestAmount),
    scheduledObligations: scheduled,
    scheduledMonthlyOut: sum(scheduled.filter((s) => s.kind === "payables"), (s) => s.monthlyEquivalent),
    scheduledMonthlyIn: sum(scheduled.filter((s) => s.kind === "receivables"), (s) => s.monthlyEquivalent),
    note: "Subscriptions are transactions the ledger marks recurring, grouped by merchant. They are historical, not scheduled — only AR/AP carry real due dates.",
  };
}

/* ---------------- scheduled items in a window ---------------- */

// Every open obligation occurrence between two dates, expanding recurring ones.
// Shared with the Calendar tab so both project cash the same way.
export function occurrencesBetween(data, startDate, endDate, today) {
  const out = [];
  for (const kind of ["receivables", "payables"]) {
    for (const item of data[kind] || []) {
      if (item.status !== "open") continue;
      let due = item.dueDate || today;
      // overdue base occurrence (shown regardless of window start)
      if (due < today) out.push({ ...item, kind, due, overdue: true });
      if (item.recurrence === "recurring") {
        while (due < today) due = addInterval(due, item.frequency || "monthly");
      } else if ((item.dueDate || today) < startDate || (item.dueDate || today) > endDate) {
        continue;
      }
      let guard = 0;
      while (due <= endDate && guard < 36) {
        if (due >= today && due >= startDate) {
          out.push({ ...item, kind, due, overdue: false, projected: guard > 0 || (item.dueDate || today) < today });
        }
        if (item.recurrence !== "recurring") break;
        due = addInterval(due, item.frequency || "monthly");
        guard += 1;
      }
    }
  }
  return out;
}

/* ---------------- forward cash view ---------------- */

export function cashForecast(data, { days = 60, balance } = {}) {
  const today = todayStr();
  const horizon = addDays(today, Math.min(Math.max(Number(days) || 60, 7), 365));
  const start = round2(balance?.value ?? balance?.book ?? 0);

  const occ = occurrencesBetween(data, today, horizon, today);
  const inflow = sum(occ.filter((o) => o.kind === "receivables"));
  const outflow = sum(occ.filter((o) => o.kind === "payables"));

  // Everything not on a due date — payroll, subscriptions, day-to-day — is
  // estimated from what actually happened, not from the recurring flag.
  const trend = monthlyTotals(data, { months: 4 });
  const burn = trend.averages_excluding_current_month.net;
  const months = daysBetween(today, horizon) / 30.44;
  const scheduledNet = round2(inflow - outflow);
  const projected = round2(start + scheduledNet + burn * months);

  const timeline = [...occ]
    .sort((a, b) => (a.due < b.due ? -1 : 1))
    .slice(0, 25)
    .map((o) => ({
      dueDate: o.due,
      // An overdue item's due date is in the past but its cash is still ahead
      // of us — say so, or it reads as money that already moved.
      expected: o.overdue ? `overdue since ${o.due}, still outstanding` : o.due,
      direction: o.kind === "receivables" ? "in" : "out",
      party: o.party,
      amount: round2(o.amount),
      overdue: !!o.overdue,
      projectedFromRecurrence: !!o.projected,
    }));

  return {
    from: today,
    to: horizon,
    startingBalance: start,
    scheduled: { in: inflow, out: outflow, net: scheduledNet, items: occ.length },
    typicalMonthlyNet: burn,
    typicalNetBasedOn: `${trend.averages_excluding_current_month.basedOnMonths} complete months`,
    projectedBalance: projected,
    runwayMonths: burn < 0 ? round2(start / Math.abs(burn)) : null,
    lowestPointWarning: projected < 0
      ? "The projection goes negative inside this window."
      : scheduledNet < 0 && start + scheduledNet < 0
        ? "Scheduled payables alone exceed the current balance."
        : null,
    timeline,
    caveat: "An estimate: dated AR/AP plus the recent monthly average. It does not know about one-off plans you haven't entered.",
  };
}

/* ---------------- bookkeeping hygiene ---------------- */

export function dataQuality(data, { month, receiptThreshold = 100 } = {}) {
  const txs = (data.transactions || []).filter((t) => !month || monthOf(t.date) === month);
  const catchAll = txs.filter((t) => /^(other|misc|uncategorized)$/i.test(t.category || ""));
  const noReceipt = txs.filter((t) => t.type === "expense" && t.amount >= receiptThreshold && !t.attachmentId && isCash(t));
  const blankDesc = txs.filter((t) => !String(t.description || "").trim());
  const openArNoDue = (data.receivables || []).filter((o) => o.status === "open" && !o.dueDate);
  const openApNoDue = (data.payables || []).filter((o) => o.status === "open" && !o.dueDate);

  return {
    scope: month || "all time",
    catchAllCategory: { count: catchAll.length, total: sum(catchAll), examples: catchAll.slice(0, 8).map(txOut) },
    largeExpensesWithoutReceipt: {
      threshold: receiptThreshold,
      count: noReceipt.length,
      total: sum(noReceipt),
      examples: noReceipt.sort((a, b) => b.amount - a.amount).slice(0, 8).map(txOut),
    },
    blankDescriptions: blankDesc.length,
    obligationsMissingDueDate: openArNoDue.length + openApNoDue.length,
    note: "Catch-all categories and missing receipts are what make a year-end review expensive. They are not errors in the balance.",
  };
}
