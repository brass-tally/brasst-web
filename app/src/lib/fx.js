/* Exchange rates, for converting a supplier's invoice into your books.
 *
 * Not TD. You asked for TD and it is the wrong answer, for two reasons worth
 * saying plainly rather than substituting quietly.
 *
 * TD publishes no public rate API. Reading rates off their website means
 * scraping a page that is not offered for that purpose, which breaks without
 * warning and is not something to build bookkeeping on.
 *
 * More importantly, a bank's posted rate is not the rate you want. It carries
 * a retail spread, so it is neither what the CRA expects for a conversion nor
 * what you were actually charged. For a Canadian ledger there are exactly two
 * defensible figures:
 *
 *   the Bank of Canada daily rate, which the CRA accepts for reporting
 *   the rate implied by your own bank line, which is what you truly paid
 *
 * This provides the first. The second is better still and already available
 * whenever the payment is matched, which is why the dialog prefers it.
 */

const DAY = 24 * 60 * 60 * 1000;
const memory = new Map();

const cacheKey = (from, to) => `bt-fx:${from}-${to}`;

function readCache(from, to) {
  const key = cacheKey(from, to);
  if (memory.has(key)) return memory.get(key);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const hit = JSON.parse(raw);
    // A rate is a daily figure, so a day is how long it is worth keeping.
    if (!hit?.at || Date.now() - hit.at > DAY) return null;
    memory.set(key, hit);
    return hit;
  } catch {
    return null;
  }
}

function writeCache(from, to, hit) {
  memory.set(cacheKey(from, to), hit);
  try { localStorage.setItem(cacheKey(from, to), JSON.stringify(hit)); } catch { /* fine */ }
}

/* The Bank of Canada publishes about two dozen currencies. PKR and AED are not
   among them, so a second source is needed for the rest rather than telling
   somebody their currency is unsupported. */
async function fromBankOfCanada(from) {
  const res = await fetch(
    `https://www.bankofcanada.ca/valet/observations/FX${from}CAD/json?recent=1`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const obs = data?.observations?.[0];
  if (!obs) return null;
  const key = Object.keys(obs).find((k) => k !== "d");
  const value = Number(obs[key]?.v);
  if (!value) return null;
  return { rate: value, source: "Bank of Canada", on: obs.d };
}

async function fromOpenRates(from) {
  const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
  if (!res.ok) return null;
  const data = await res.json();
  const value = Number(data?.rates?.CAD);
  if (!value) return null;
  return {
    rate: value,
    source: "exchangerate-api",
    on: String(data.time_last_update_utc || "").slice(5, 16),
  };
}

/**
 * One unit of `from`, in `to`. Returns null rather than a guess when no source
 * answers: a made-up rate in a ledger is worse than an empty field.
 */
export async function lookupRate(from, to = "CAD") {
  const a = String(from || "").toUpperCase();
  const b = String(to || "CAD").toUpperCase();
  if (!a || a === b) return { rate: 1, source: "same currency", on: "" };

  const cached = readCache(a, b);
  if (cached) return cached;

  // Only CAD is covered here. A ledger in another currency gets the general
  // source, which quotes against anything.
  const tries = b === "CAD" ? [fromBankOfCanada, fromOpenRates] : [fromOpenRates];

  for (const attempt of tries) {
    try {
      const hit = await attempt(a, b);
      if (hit?.rate) {
        const full = { ...hit, at: Date.now(), from: a, to: b };
        writeCache(a, b, full);
        return full;
      }
    } catch {
      // Try the next one. A rate service being down is not an error worth
      // showing somebody who is trying to file an invoice.
    }
  }
  return null;
}

/** The rate your own bank actually used, when the payment is on the feed. */
export function rateFromBankLine(foreignAmount, bankAmount) {
  const f = Math.abs(Number(foreignAmount) || 0);
  const c = Math.abs(Number(bankAmount) || 0);
  if (!f || !c) return null;
  return { rate: c / f, source: "your bank", on: "" };
}
