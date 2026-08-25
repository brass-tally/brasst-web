// Proactive findings for the Overview tab.
//
// Everything here is computed locally from the ledger already in memory — no
// model call, no cost, no waiting. The model's job starts when you tap one:
// each finding carries an `ask`, the question it hands to the agent, which then
// digs with real tools rather than re-deriving the finding from a prompt.
//
// Rules of thumb followed below:
//   · Every finding names a number and a next move. "Spending is up" is noise.
//   · Thresholds are absolute AND relative, so a $4 overrun on a $20 budget
//     doesn't shout as loudly as a $400 overrun on a $2,000 one.
//   · Findings are ordered by how much money is at stake, not by category.

import {
  todayStr, monthOf, round2, daysBetween,
  categoryVariance, categoryShifts, findDuplicates, obligationsView,
  cashForecast, dataQuality, creditPools, recurringCosts,
} from "./analysis";

const money = (n) =>
  (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @returns {Array<{id,severity,title,detail,ask,weight}>} highest stakes first.
 *   severity: "alert" needs a decision · "warn" worth a look · "info" FYI
 */
export function computeInsights(data, { balance, month, bankConns = [], recon = null, consolidation = null, duplicates = [] } = {}) {
  const out = [];
  const today = todayStr();
  const m = month || monthOf(today);
  const add = (f) => out.push(f);
  // A gap that's already been consolidated is a decision, not a finding. It
  // comes back the moment the bank or the books move — see the signature in
  // lib/reconcile.js — so silence here is never silence about something new.
  const settled = Boolean(consolidation?.settled);
  // Categories already spoken for. One card per category, or the strip turns
  // into three ways of saying the same overspend.
  const covered = new Set();

  /* ---- bank vs books ---- */
  const delta = balance?.delta;
  if (balance?.source === "bank" && delta != null && Math.abs(delta) >= 1 && !settled) {
    add({
      id: "drift",
      severity: Math.abs(delta) >= 250 ? "alert" : "warn",
      weight: Math.abs(delta) + 500, // drift outranks a same-sized budget miss
      title: `Bank and books disagree by ${money(Math.abs(delta))}`,
      // Once reconciliation has named the lines, say which lines — a generic
      // "likely income that was never entered" is noise next to a real list.
      detail: recon && (recon.bankOnly.count || recon.bookOnly.count)
        ? `${plural(recon.bankOnly.count, "bank line", "bank lines")} aren't in the books and ${plural(recon.bookOnly.count, "entry hasn't", "entries haven't")} cleared the bank. ${
            recon.unexplained != null && Math.abs(recon.unexplained) >= 1
              ? `That names ${money(Math.abs(recon.explained))} of the gap; ${money(Math.abs(recon.unexplained))} is still unexplained.`
              : "Together they account for the whole gap."
          }`
        : delta > 0
          ? `The bank holds ${money(Math.abs(delta))} more than the ledger accounts for, likely income or refunds that were never entered.`
          : `The ledger expects ${money(Math.abs(delta))} more than the bank holds, likely spending that cleared without being recorded, or an entry made twice.`,
      ask: "Walk me through the gap between my bank balance and my books, line by line, and tell me what to do about it.",
    });
  }

  /* ---- stale bank feed ---- */
  const lastSynced = (bankConns || []).map((c) => c.last_synced).filter(Boolean).sort().pop();
  if (bankConns?.length && lastSynced) {
    const stale = daysBetween(String(lastSynced).slice(0, 10), today);
    if (stale >= 7) {
      add({
        id: "stale-sync",
        severity: "info",
        weight: 40 + stale,
        title: `Bank feed hasn't synced in ${plural(stale, "day", "days")}`,
        detail: "Balances and any new lines are as of the last sync, so drift here may be stale rather than real.",
        ask: "My bank feed hasn't synced in a while. What should I check before I trust the balance?",
      });
    }
  }

  /* ---- matches the reconciler is confident about ---- */
  if (recon?.readyToMatch && !settled) {
    add({
      id: "ready-to-match",
      severity: "info",
      weight: 320,
      title: `${plural(recon.readyToMatch, "bank line", "bank lines")} pair up automatically`,
      detail: "Same amount, same direction, within a day or two of an entry you already made. Confirming them shrinks the gap without adding anything to the books.",
      ask: "Reconcile my bank feed against the books and tell me what's left over.",
    });
  }

  /* ---- the bank restated or reversed something already settled ---- */
  if (recon?.needsReview) {
    add({
      id: "bank-restated",
      severity: "alert",
      weight: 600,
      title: `${plural(recon.needsReview, "matched line", "matched lines")} changed at the bank`,
      detail: "The bank amended or reversed a line after it was reconciled, so an entry in your books may no longer reflect what actually happened.",
      ask: "Which bank lines changed after I matched them, and what should I fix?",
    });
  }

  /* ---- budget overruns this month ---- */
  const variance = categoryVariance(data, m);
  for (const row of variance.expense) {
    if (!row.planned || row.variance >= 0) continue;
    const over = Math.abs(row.variance);
    if (over < 25 && row.pctOfPlan < 150) continue;
    covered.add(row.category);
    add({
      id: `over-${row.category}`,
      severity: over >= 250 || row.pctOfPlan >= 200 ? "warn" : "info",
      weight: over,
      title: `${row.category} is ${money(over)} over budget`,
      detail: `${money(row.actual)} spent against a ${money(row.planned)} plan (${row.pctOfPlan}%) across ${plural(row.entries, "entry", "entries")}.`,
      ask: `Why is ${row.category} over budget this month? Show me the entries and whether it's a one-off.`,
    });
  }

  /* ---- material spend with no budget at all ---- */
  const unbudgeted = variance.expense
    .filter((r) => !r.planned && r.actual >= 150)
    .sort((a, b) => b.actual - a.actual);
  if (unbudgeted.length) {
    const total = round2(unbudgeted.reduce((s, r) => s + r.actual, 0));
    unbudgeted.forEach((r) => covered.add(r.category));
    add({
      id: "unbudgeted",
      severity: "info",
      weight: total * 0.4,
      title: `${money(total)} spent in categories with no budget`,
      detail: `${unbudgeted.slice(0, 3).map((r) => `${r.category} ${money(r.actual)}`).join(", ")}${unbudgeted.length > 3 ? `, +${unbudgeted.length - 3} more` : ""}. Nothing flags an overrun in a category with no plan.`,
      ask: "Suggest monthly budgets for the categories I'm spending in but haven't planned, based on my own history.",
    });
  }

  /* ---- a category that jumped against its own baseline ----
     Only for categories nothing else has flagged: "over budget" and "above its
     usual" are the same news twice. */
  const shifts = categoryShifts(data, { month: m, lookback: 3, minAmount: 75 })
    .filter((s) => s.change > 0 && !covered.has(s.category));
  if (shifts.length) {
    const top = shifts[0];
    add({
      id: `shift-${top.category}`,
      severity: "info",
      weight: top.change * 0.8,
      title: `${top.category} is ${money(top.change)} above its usual`,
      detail: `${money(top.thisMonth)} this month against a ${money(top.baseline)} three-month average${top.pctChange != null ? ` (+${top.pctChange}%)` : ""}.`,
      ask: `${top.category} is running above its usual this month. What changed?`,
    });
  }

  /* ---- overdue receivables ---- */
  const obs = obligationsView(data, { status: "open" });
  const ar = obs.receivables;
  const overdueAr = (ar?.items || []).filter((i) => i.daysOverdue > 0);
  if (overdueAr.length) {
    const total = round2(overdueAr.reduce((s, i) => s + i.amount, 0));
    const worst = overdueAr.sort((a, b) => b.daysOverdue - a.daysOverdue)[0];
    add({
      id: "overdue-ar",
      severity: total >= 1000 || worst.daysOverdue >= 60 ? "alert" : "warn",
      weight: total + worst.daysOverdue * 5,
      title: `${money(total)} owed to you is past due`,
      detail: `${plural(overdueAr.length, "invoice", "invoices")} overdue, the oldest ${plural(worst.daysOverdue, "day", "days")} (${worst.party}, ${money(worst.amount)}).`,
      ask: "Which of my receivables are overdue, and what should I chase first?",
    });
  }

  /* ---- payables landing soon ---- */
  const dueSoon = (obs.payables?.items || []).filter(
    (i) => i.dueDate && i.daysOverdue === 0 && daysBetween(today, i.dueDate) <= 7,
  );
  const overdueAp = (obs.payables?.items || []).filter((i) => i.daysOverdue > 0);
  if (overdueAp.length) {
    const total = round2(overdueAp.reduce((s, i) => s + i.amount, 0));
    add({
      id: "overdue-ap",
      severity: "alert",
      weight: total + 200,
      title: `${money(total)} you owe is past due`,
      detail: `${plural(overdueAp.length, "bill is", "bills are")} past due. If any were actually paid, settling them here keeps the balance honest.`,
      ask: "Show me the payables that are past due and help me settle the ones I've already paid.",
    });
  } else if (dueSoon.length) {
    const total = round2(dueSoon.reduce((s, i) => s + i.amount, 0));
    add({
      id: "due-soon",
      severity: "info",
      weight: total * 0.5,
      title: `${money(total)} due in the next week`,
      detail: `${dueSoon.slice(0, 3).map((i) => `${i.party} ${money(i.amount)} on ${i.dueDate}`).join(", ")}.`,
      ask: "What's due in the next week, and will my balance cover it?",
    });
  }

  /* ---- likely duplicates ----
     The consolidation flow's groups lead when it has them: they know which copy
     a bank line has already vouched for, so they can say what to remove rather
     than only that something looks doubled. */
  if (!settled) {
    // Small change doubled up is a tidy-up, not a finding worth a card.
    const groups = (duplicates || []).filter((g) => g.extraTotal >= 10);
    if (groups.length) {
      const extras = groups.reduce((s, g) => s + g.extras.length, 0);
      const total = round2(groups.reduce((s, g) => s + g.extraTotal, 0));
      const top = groups[0];
      add({
        id: "duplicates",
        severity: total >= 200 ? "warn" : "info",
        weight: total * 0.9 + 100,
        title: `${plural(extras, "duplicate entry", "duplicate entries")} inflating the books by ${money(total)}`,
        detail: `${top.description || top.keep.category} at ${money(top.amount)} is recorded ${top.extras.length + 1} times, ${top.reason}. Consolidate keeps one copy of each and removes the rest.`,
        ask: "Show me the entries that look like duplicates and tell me which one to remove.",
      });
    } else {
      const dupes = findDuplicates(data, { windowDays: 6, minAmount: 10 });
      const solid = dupes.pairs.filter((p) => p.confidence !== "low");
      if (solid.length) {
        const total = round2(solid.reduce((s, p) => s + p.amount, 0));
        add({
          id: "duplicates",
          severity: total >= 200 ? "warn" : "info",
          weight: total * 0.9,
          title: `${plural(solid.length, "possible duplicate", "possible duplicates")}, ${money(total)}`,
          detail: `${solid[0].a.description} at ${money(solid[0].amount)} appears twice ${solid[0].daysApart === 0 ? "on the same day" : `${plural(solid[0].daysApart, "day", "days")} apart`}. Duplicates inflate expenses and push books away from the bank.`,
          ask: "Show me the entries that look like duplicates and tell me which one to remove.",
        });
      }
    }
  }

  /* ---- runway / forward cash ---- */
  const forecast = cashForecast(data, { days: 60, balance });
  if (forecast.projectedBalance < 0 || forecast.lowestPointWarning) {
    add({
      id: "runway",
      severity: "alert",
      weight: 2000,
      title: `Cash runs short by ${forecast.to}`,
      detail: `${money(forecast.startingBalance)} today, ${money(forecast.scheduled.net)} scheduled, and a typical ${money(forecast.typicalMonthlyNet)} a month projects to ${money(forecast.projectedBalance)}.`,
      ask: "Project my cash for the next 60 days and show me where it gets tight.",
    });
  } else if (forecast.runwayMonths != null && forecast.runwayMonths <= 6) {
    add({
      id: "runway-short",
      severity: forecast.runwayMonths <= 3 ? "warn" : "info",
      weight: 900 - forecast.runwayMonths * 100,
      title: `About ${forecast.runwayMonths} months of runway`,
      detail: `Burning roughly ${money(Math.abs(forecast.typicalMonthlyNet))} a month against ${money(forecast.startingBalance)} on hand.`,
      ask: "Break down my monthly burn and where the biggest cuts would come from.",
    });
  }

  /* ---- a subscription that quietly went up ---- */
  const raised = recurringCosts(data).subscriptions.filter((s) => s.priceChanged && s.priceChanged.change > 0);
  if (raised.length) {
    const top = raised.sort((a, b) => b.priceChanged.change - a.priceChanged.change)[0];
    add({
      id: "price-up",
      severity: "info",
      weight: top.priceChanged.change * 12,
      title: `${top.name} went up ${money(top.priceChanged.change)}`,
      detail: `Now ${money(top.latestAmount)}, was ${money(top.priceChanged.from)}. That's ${money(top.priceChanged.change * 12)} a year on a recurring charge.`,
      ask: `Show me the history of my ${top.name} charges and what my recurring costs total.`,
    });
  }

  /* ---- credit pools running out ---- */
  for (const pool of creditPools(data)) {
    if (!pool.granted) continue;
    const pct = pool.remaining / pool.granted;
    if (pct > 0.15 || pool.remaining <= 0) continue;
    add({
      id: `credits-${pool.name}`,
      severity: "info",
      weight: 120,
      title: `${pool.name} is ${Math.round(pct * 100)}% left`,
      detail: `${money(pool.remaining)} of ${money(pool.granted)} remaining. When it runs out, that spend starts hitting cash.`,
      ask: `What happens to my monthly cash when ${pool.name} runs out?`,
    });
  }

  /* ---- bookkeeping hygiene (only once it's material) ---- */
  const quality = dataQuality(data, { month: null, receiptThreshold: 100 });
  if (quality.largeExpensesWithoutReceipt.count >= 3) {
    add({
      id: "receipts",
      severity: "info",
      weight: 60,
      title: `${plural(quality.largeExpensesWithoutReceipt.count, "large expense", "large expenses")} without a receipt`,
      detail: `${money(quality.largeExpensesWithoutReceipt.total)} in expenses over $100 with nothing filed against them. These are the ones an audit or an accountant asks about.`,
      ask: "List my larger expenses that have no receipt attached, biggest first.",
    });
  }
  if (quality.catchAllCategory.count >= 5) {
    add({
      id: "uncategorized",
      severity: "info",
      weight: 50,
      title: `${plural(quality.catchAllCategory.count, "entry", "entries")} sitting in a catch-all category`,
      detail: `${money(quality.catchAllCategory.total)} filed under Other. It flatters every other category and muddies the P&L.`,
      ask: "Go through my entries filed under Other and suggest a better category for each.",
    });
  }

  // Severity leads, money breaks the tie. A $900 nice-to-know should never sit
  // above a $200 thing that needs a decision.
  const rank = { alert: 0, warn: 1, info: 2 };
  return out.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.weight - a.weight));
}

/** The one-line nudge for the header when there's something worth surfacing. */
export function topInsight(insights) {
  return insights.find((i) => i.severity === "alert") || insights[0] || null;
}
