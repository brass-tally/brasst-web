/* What repeats, found in money that has already moved.
 *
 * A subscription is not a category of vendor, it is a shape: the same payee,
 * about the same amount, at about the same interval. That shape is visible in
 * the bank feed you already have, which means no new permission, no OAuth app
 * per vendor, and — the part that matters — it finds the ones nobody
 * remembers, precisely because it does not need to know the vendor exists.
 *
 * Nothing here writes. It reads bank lines and reports what it sees, because a
 * guess about a recurring charge should never become an entry in the books on
 * its own.
 */

const MS_DAY = 86400000;
const day = (d) => Math.floor(new Date(`${String(d).slice(0, 10)}T00:00:00`).getTime() / MS_DAY);

/* Payees as a human would group them.
 *
 * Card descriptors are noisy: "GOOGLE *CLOUD 4Q7", "GOOGLE*CLOUD_8812". The
 * store number changes every month and the name does not, so the trailing
 * reference is dropped rather than treated as part of the name. */
export function normalisePayee(text) {
  return String(text || "")
    .toUpperCase()
    .replace(/\b(PAYPAL|SQ|SQUARE|TST)\s*\*/g, "")
    .replace(/[*#]/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/\b(INC|LLC|LTD|COM|CA|US|USD|CAD|SUBSCRIPTION|MONTHLY|RECURRING)\b/g, " ")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* How often, in plain words, and only when the gaps agree.
 *
 * Two charges 30 days apart could be a coincidence; four charges 30 days apart
 * are an arrangement. The spread has to be tight, because a payee you happen
 * to buy from monthly is not a subscription and calling it one would put a
 * number in front of somebody that they cannot act on. */
function cadenceOf(gaps) {
  if (gaps.length < 2) return null;
  const mid = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const spread = Math.max(...gaps) - Math.min(...gaps);

  if (mid >= 6 && mid <= 8 && spread <= 3) return { every: "week", days: 7 };
  if (mid >= 13 && mid <= 16 && spread <= 4) return { every: "two weeks", days: 14 };
  if (mid >= 26 && mid <= 35 && spread <= 8) return { every: "month", days: 30 };
  if (mid >= 85 && mid <= 95 && spread <= 12) return { every: "quarter", days: 91 };
  if (mid >= 350 && mid <= 380 && spread <= 25) return { every: "year", days: 365 };
  return null;
}

/**
 * Recurring charges in a list of bank lines.
 *
 * @param {Array} lines  bank transactions: { date, amount, description }
 * @param {object} opts  { minCharges }
 */
export function findSubscriptions(lines = [], { minCharges = 3 } = {}) {
  const groups = new Map();

  for (const t of lines) {
    /* Money going out only. A refund or an incoming payment from the same name
       would drag the average away from what is actually charged. */
    const amount = Number(t.amount) || 0;
    if (amount >= 0) continue;
    const name = normalisePayee(t.description || t.name);
    if (name.length < 3) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ d: day(t.date), amount: Math.abs(amount), raw: t });
  }

  const found = [];

  for (const [name, all] of groups) {
    let rows = all;
    if (rows.length < minCharges) continue;
    rows.sort((a, b) => a.d - b.d);

    /* Two charges on one day are one event.
     *
     * A retried card, a split charge, a correction and a re-charge all produce
     * a gap of zero, which destroys the spread and drops a real subscription.
     * Found while testing: a genuine monthly Adobe charge was rejected because
     * one month it appeared twice. */
    const byDay = [];
    for (const r of rows) {
      const prev = byDay[byDay.length - 1];
      if (prev && r.d - prev.d <= 2) {
        /* Keep the larger: a partial charge followed by the rest should count
           as the amount actually charged, not the first instalment. */
        if (r.amount > prev.amount) byDay[byDay.length - 1] = r;
      } else {
        byDay.push(r);
      }
    }
    if (byDay.length < minCharges) continue;
    rows = byDay;

    const gaps = [];
    for (let i = 1; i < rows.length; i += 1) gaps.push(rows[i].d - rows[i - 1].d);
    const cadence = cadenceOf(gaps);
    if (!cadence) continue;

    /* The amounts have to agree too. A payee charged monthly at wildly
       different amounts is a supplier, not a subscription. */
    const amounts = rows.map((r) => r.amount);
    const typical = [...amounts].sort((a, b) => a - b)[Math.floor(amounts.length / 2)];
    const drift = Math.max(...amounts) - Math.min(...amounts);
    if (typical > 0 && drift / typical > 0.35) continue;

    const last = rows[rows.length - 1];
    const nextDay = last.d + cadence.days;

    /* A monthly figure everything can be compared on. Annual subscriptions
       look cheap next to monthly ones until they are on the same footing. */
    const monthly = typical * (30 / cadence.days);

    found.push({
      name: last.raw.description || name,
      key: name,
      amount: Math.round(typical * 100) / 100,
      monthly: Math.round(monthly * 100) / 100,
      every: cadence.every,
      days: cadence.days,
      charges: rows.length,
      lastCharged: new Date(last.d * MS_DAY).toISOString().slice(0, 10),
      nextDue: new Date(nextDay * MS_DAY).toISOString().slice(0, 10),
      /* Rising, and by how much. A price increase on something nobody looks at
         is the most common way a subscription becomes expensive. */
      rose: amounts.length > 2 && amounts[amounts.length - 1] > amounts[0] * 1.05
        ? { from: Math.round(amounts[0] * 100) / 100, to: Math.round(amounts[amounts.length - 1] * 100) / 100 }
        : null,
      lines: rows.map((r) => r.raw),
    });
  }

  return found.sort((a, b) => b.monthly - a.monthly);
}

/** What they cost together, on one footing. */
export function subscriptionTotals(subs = []) {
  const monthly = subs.reduce((n, s) => n + s.monthly, 0);
  return {
    count: subs.length,
    monthly: Math.round(monthly * 100) / 100,
    yearly: Math.round(monthly * 12 * 100) / 100,
  };
}

/** Anything charging again within the next `days` days. */
export function dueSoon(subs = [], days = 14) {
  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date(Date.now() + days * MS_DAY).toISOString().slice(0, 10);
  return subs.filter((s) => s.nextDue >= today && s.nextDue <= limit)
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}
