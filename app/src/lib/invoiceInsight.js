/* What an owner should do about their invoices, worked out rather than listed.
 *
 * A flat list of invoices is a filing cabinet. It answers "what do I have" and
 * the question people actually have is "what needs me". Those are different,
 * and the second one can be computed.
 *
 * Pure. No I/O, no React, so every rule here is testable and the interface
 * only has to draw the answer.
 */

const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / DAY);

/** "2 hours ago", "yesterday", "3 weeks ago". Recency people read without doing arithmetic. */
export function ago(when) {
  if (!when) return "";
  const then = new Date(when).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "month" : "months"} ago`;
}

/* When something is due, in words that imply what to do.
 *
 * "due 2026-09-15" makes somebody compute. "overdue by 6 days" does not, and
 * the difference is whether a list can be skimmed. */
export function dueWords(dueDate) {
  if (!dueDate) return { label: "no date", tone: "quiet", order: 3 };
  const d = daysBetween(today(), dueDate);
  if (d < -1) return { label: `overdue by ${-d} days`, tone: "bad", order: 0 };
  if (d === -1) return { label: "overdue by a day", tone: "bad", order: 0 };
  if (d === 0) return { label: "due today", tone: "warn", order: 0 };
  if (d === 1) return { label: "due tomorrow", tone: "warn", order: 1 };
  if (d <= 7) return { label: `due in ${d} days`, tone: "warn", order: 1 };
  if (d <= 30) return { label: `due in ${Math.round(d / 7)} weeks`, tone: "quiet", order: 2 };
  return { label: `due ${dueDate}`, tone: "quiet", order: 2 };
}

/* Buckets, because a single sorted list hides the shape.
 *
 * Four, not seven: a person can hold four groups in their head and will stop
 * reading at seven. */
export const BUCKETS = [
  { id: "now", label: "Needs you now" },
  { id: "soon", label: "This week" },
  { id: "later", label: "Later" },
  { id: "done", label: "Settled" },
];

export function bucketOf(item) {
  if (item.settled) return "done";
  const { order } = dueWords(item.dueDate);
  return order === 0 ? "now" : order === 1 ? "soon" : "later";
}

/* The same invoice, sent twice.
 *
 * A supplier who resends rather than replying, a scheduled arrangement that
 * fired alongside a manual send, an invoice forwarded by two people at the same
 * company. Paying one twice is the expensive mistake in accounts payable and it
 * is entirely preventable: the invoice number, the party and the amount are all
 * sitting there.
 */
export function findDuplicates(invoices = []) {
  const seen = new Map();
  const pairs = [];

  for (const inv of invoices) {
    if (inv.status === "withdrawn" || inv.status === "declined") continue;
    const party = String(inv.party || "").trim().toLowerCase();
    const amount = Math.round(Math.abs(Number(inv.amount) || 0) * 100);
    const number = String(inv.invoiceNo || "").trim().toLowerCase();

    /* Two ways to be the same thing, and the number is the stronger one: a
       supplier billing the same amount monthly is not a duplicate, but the
       same number twice always is. */
    const keys = [number && `n:${party}|${number}`, `a:${party}|${amount}`].filter(Boolean);

    for (const key of keys) {
      const prior = seen.get(key);
      if (prior && prior.id !== inv.id) {
        const apart = Math.abs(daysBetween(
          String(prior.submittedAt || prior.issuedOn || "").slice(0, 10) || today(),
          String(inv.submittedAt || inv.issuedOn || "").slice(0, 10) || today(),
        ));
        /* Same number, ever. Same amount, only within a fortnight: beyond that
           it is a monthly arrangement, not a mistake. */
        const strong = key.startsWith("n:");
        if (strong || apart <= 14) {
          /* One pair, however many ways it matched.
           *
           * A duplicate with the same number AND the same amount matched both
           * keys and was counted twice, so one mistake was reported as two.
           * The strong reason wins where both apply. */
          const pairKey = [prior.id, inv.id].sort().join("|");
          const existing = pairs.find((x) => x.key === pairKey);
          if (existing) {
            if (strong && !existing.strong) {
              existing.strong = true;
              existing.why = `Both are numbered ${inv.invoiceNo}`;
            }
          } else {
            pairs.push({
              key: pairKey, a: prior, b: inv, strong,
              why: strong
                ? `Both are numbered ${inv.invoiceNo}`
                : `Same party, same amount, ${apart} days apart`,
            });
          }
        }
      }
      if (!prior) seen.set(key, inv);
    }
  }
  return pairs;
}

/* What to do, in priority order, with the reason attached.
 *
 * At most four. A list of everything that could want attention is a list
 * nobody reads, and the fifth item is always the one that gets ignored first.
 */
export function whatNeedsYou({ inbound = [], sent = [], payables = [], receivables = [] }) {
  const out = [];
  const t = today();

  const dupes = findDuplicates(inbound);
  if (dupes.length) {
    out.push({
      id: "duplicates",
      urgency: 0,
      title: dupes.length === 1 ? "Check a possible duplicate" : `Check ${dupes.length} possible duplicates`,
      why: dupes[0].why,
      tone: "bad",
      action: "duplicates",
    });
  }

  const waiting = inbound.filter((i) => i.status === "pending" && !i.correctionAt);
  if (waiting.length) {
    const oldest = waiting.reduce((a, b) =>
      String(a.submittedAt) < String(b.submittedAt) ? a : b);
    out.push({
      id: "review",
      urgency: 1,
      title: `${waiting.length} ${waiting.length === 1 ? "invoice is" : "invoices are"} waiting on you`,
      why: `The oldest arrived ${ago(oldest.submittedAt)}`,
      tone: waiting.length > 3 ? "warn" : "quiet",
      action: "review",
    });
  }

  const latePay = payables.filter((p) => p.status === "open" && p.dueDate && p.dueDate < t);
  if (latePay.length) {
    out.push({
      id: "pay",
      urgency: 0,
      title: `${latePay.length} ${latePay.length === 1 ? "bill is" : "bills are"} past their date`,
      why: latePay.map((p) => p.party).slice(0, 2).join(", ")
        + (latePay.length > 2 ? ` and ${latePay.length - 2} more` : ""),
      tone: "bad",
      action: "pay",
    });
  }

  /* An invoice sent and never opened is a different problem from one opened
     and not paid. The first is probably in a spam folder; the second needs a
     conversation. Saying which saves somebody chasing the wrong way. */
  const unopened = sent.filter((s) =>
    s.status === "sent" && !s.opens && s.sentAt
    && daysBetween(String(s.sentAt).slice(0, 10), t) >= 4);
  if (unopened.length) {
    out.push({
      id: "unopened",
      urgency: 1,
      title: `${unopened.length} sent ${unopened.length === 1 ? "invoice has" : "invoices have"} not been opened`,
      why: `${unopened[0].party} has not looked since you sent it ${ago(unopened[0].sentAt)}`,
      tone: "warn",
      action: "unopened",
    });
  }

  const lateIn = receivables.filter((r) => r.status === "open" && r.dueDate && r.dueDate < t);
  if (lateIn.length) {
    const total = lateIn.reduce((n, r) => n + Math.abs(Number(r.amount) || 0), 0);
    out.push({
      id: "chase",
      urgency: 2,
      title: `${lateIn.length} ${lateIn.length === 1 ? "payment is" : "payments are"} late to you`,
      why: `${total.toLocaleString(undefined, { minimumFractionDigits: 2 })} outstanding past its date`,
      tone: "warn",
      action: "chase",
      amount: total,
    });
  }

  return out.sort((a, b) => a.urgency - b.urgency).slice(0, 4);
}

/* How a sent invoice is actually doing, in one phrase.
 *
 * Status alone says "sent", which is true for an invoice posted an hour ago
 * and one ignored for six weeks. The difference is the whole question. */
export function sentState(inv) {
  if (inv.status === "draft") return { label: "Draft", tone: "quiet", order: 4 };
  if (inv.status === "cancelled") return { label: "Cancelled", tone: "quiet", order: 6 };
  if (inv.status === "paid") return { label: "Paid", tone: "good", order: 5 };

  const t = today();
  const late = inv.dueOn && inv.dueOn < t;
  const days = inv.sentAt ? daysBetween(String(inv.sentAt).slice(0, 10), t) : 0;

  if (late) return { label: dueWords(inv.dueOn).label, tone: "bad", order: 0 };
  if (!inv.opens && days >= 4) {
    return { label: `Not opened, sent ${ago(inv.sentAt)}`, tone: "warn", order: 1 };
  }
  if (!inv.opens) return { label: `Sent ${ago(inv.sentAt)}`, tone: "quiet", order: 3 };
  return {
    label: `Opened${inv.opens > 1 ? ` ${inv.opens} times` : ""}, ${dueWords(inv.dueOn).label}`,
    tone: "quiet",
    order: 2,
  };
}
