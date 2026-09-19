/* Where the money went, arranged so it can be looked at rather than read.
 *
 * A table of categories answers "how much on rent" for somebody who already
 * knows to ask. A picture answers "what is this business actually spending
 * on", which is the question people have and rarely phrase.
 *
 * Pure arithmetic, no drawing. The component decides how it looks; this
 * decides what is true.
 */

/** Spend by category, largest first, with the long tail gathered. */
export function spendByCategory(txs = [], { top = 8 } = {}) {
  const out = new Map();

  for (const t of txs) {
    if (t.type !== "expense") continue;
    const amount = Math.abs(Number(t.amount) || 0);
    if (!amount) continue;
    const key = String(t.category || "Uncategorised").trim() || "Uncategorised";
    const row = out.get(key) || { name: key, total: 0, count: 0, parties: new Map() };
    row.total += amount;
    row.count += 1;
    /* Who inside each category. A category is an answer; the payee behind it
       is the thing you can actually do something about. */
    const who = String(t.party || t.description || "").trim();
    if (who) row.parties.set(who, (row.parties.get(who) || 0) + amount);
    out.set(key, row);
  }

  const rows = [...out.values()]
    .map((r) => ({
      ...r,
      total: Math.round(r.total * 100) / 100,
      parties: [...r.parties.entries()]
        .map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 4),
    }))
    .sort((a, b) => b.total - a.total);

  if (rows.length <= top) return rows;

  /* The tail is gathered rather than dropped. A picture missing a fifth of the
     spend is worse than a plain list, because it looks complete. */
  const head = rows.slice(0, top - 1);
  const tail = rows.slice(top - 1);
  head.push({
    name: `${tail.length} smaller`,
    total: Math.round(tail.reduce((n, r) => n + r.total, 0) * 100) / 100,
    count: tail.reduce((n, r) => n + r.count, 0),
    parties: [],
    isTail: true,
  });
  return head;
}

/** Positions on a circle, sized by share. The component animates from these. */
export function layout(rows = [], { radius = 120, minR = 16, maxR = 44 } = {}) {
  const total = rows.reduce((n, r) => n + r.total, 0) || 1;

  return rows.map((r, i) => {
    const share = r.total / total;
    /* Area, not radius, carries the value. Scaling the radius by share makes a
       category twice as large look four times as large, which is the oldest
       way to mislead with a picture. */
    const area = Math.sqrt(share);
    const angle = (i / rows.length) * Math.PI * 2 - Math.PI / 2;
    return {
      ...r,
      share,
      pct: Math.round(share * 1000) / 10,
      r: Math.max(minR, Math.min(maxR, minR + area * (maxR - minR) * 1.6)),
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      angle,
      /* A beat of its own, so the whole thing does not pulse in unison like a
         loading spinner. */
      delay: (i * 137) % 900,
    };
  });
}

/** Month over month, for the same categories. */
export function monthlyTrend(txs = [], months = 6) {
  const buckets = new Map();
  for (const t of txs) {
    if (t.type !== "expense") continue;
    const m = String(t.date || "").slice(0, 7);
    if (!m) continue;
    buckets.set(m, (buckets.get(m) || 0) + Math.abs(Number(t.amount) || 0));
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-months)
    .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }));
}

/** Everything behind the picture, as rows somebody can take away. */
export function toCsv(rows = []) {
  const out = [["Category", "Total", "Entries", "Share %", "Largest payee"]];
  const total = rows.reduce((n, r) => n + r.total, 0) || 1;
  for (const r of rows) {
    out.push([
      r.name,
      r.total.toFixed(2),
      r.count,
      ((r.total / total) * 100).toFixed(1),
      r.parties?.[0]?.name || "",
    ]);
  }
  return out
    .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
