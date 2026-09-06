import { useEffect, useState } from "react";

/* ================= proactive messages =================
   Nothing in the app ever makes Tally speak first, which is why it feels
   absent. The material already exists: computeInsights runs on every render
   with live ledger context. This turns the top of that into at most one
   message, and then gets out of the way.

   The rules are what keep it from being annoying:

     dedupe by id      the id embeds the value, so a changed drift speaks again
                       and an unchanged one stays quiet
     one at a time     never a queue of shoulder taps
     cap at two        past that the badge stops counting
     forever quiet     a dismissal is a decision, not a delay */

const SEEN_KEY = "tally:nudges-seen";

const readSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
  catch { return new Set(); }
};
const remember = (id) => {
  try {
    const seen = readSeen();
    seen.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-60)));
  } catch { /* private mode */ }
};

const fmt = (n) => "$" + Math.abs(Number(n) || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Build the candidate list from state the app already computes. */
export function buildNudges({ insights = [], balance, consolidation, obligations = [], today }) {
  const out = [];

  const drift = balance?.source === "bank" ? Number(balance.delta || 0) : 0;
  if (Math.abs(drift) >= 0.01 && !consolidation?.settled) {
    out.push({
      // the amount is in the id, so a drift that changes speaks again
      id: `drift:${balance.balanceAsOf || ""}:${drift.toFixed(2)}`,
      text: `Your bank says ${fmt(balance.bank)} and the books say ${fmt(balance.book)}. Want me to pair them up?`,
      action: { view: "reconcile", label: "Open consolidate" },
    });
  }

  for (const i of insights.filter((x) => x?.severity === "high").slice(0, 2)) {
    out.push({ id: `insight:${i.id ?? i.title}`, text: i.nudge || i.title, action: i.action });
  }

  const soon = obligations.filter((o) => {
    if (o?.status !== "open" || !o.dueDate) return false;
    const days = Math.round((new Date(o.dueDate + "T00:00:00") - new Date((today || new Date().toISOString().slice(0, 10)) + "T00:00:00")) / 86400000);
    return days >= 0 && days <= 3;
  });
  if (soon.length) {
    out.push({
      id: `due:${soon.map((s) => s.id).sort().join(",")}`,
      text: soon.length === 1
        ? "One payable is due within three days."
        : `${soon.length} payables are due within three days.`,
      action: { view: "arap", label: "Show me" },
    });
  }

  return out;
}

/**
 * Returns { peek, unread, dismiss, clear }.
 * `peek` is the single message worth showing, or null.
 */
export function useNudges(ctx, { enabled = true, delay = 1600 } = {}) {
  const [peek, setPeek] = useState(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      const seen = readSeen();
      const next = buildNudges(ctx).find((n) => !seen.has(n.id));
      if (!next) return;
      setPeek(next);
      setUnread((u) => Math.min(u + 1, 2));
    }, delay);
    return () => clearTimeout(t);
    // ctx is rebuilt every render; the id dedupe is what makes this safe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ctx?.balance?.delta, ctx?.consolidation?.settled, ctx?.insights?.length]);

  const dismiss = (n) => { if (n?.id) remember(n.id); setPeek(null); };
  const clear = () => { if (peek?.id) remember(peek.id); setPeek(null); setUnread(0); };

  return { peek, unread, dismiss, clear };
}
