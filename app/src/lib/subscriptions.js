import { identify } from "./catalogue";

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
  const raw = String(text || "").toUpperCase();

  /* Strip the payment rails first: "SQ *", "PAYPAL *", "TST*" tell you how it
     was charged, not by whom. */
  const cleaned = raw
    /* Bounded at both ends. Without the trailing boundary, "POS" matched
       inside POSTMARKAPP and left "TMARKAPP", which is how a real
       subscription appeared in the list under a name nobody could recognise
       and nothing could match to a known service. */
    .replace(/\b(PAYPAL|SQ|SQUARE|TST|POS|VISA|MC|INTERAC)\b\s*\*?/g, " ")
    .replace(/[*#,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  /* Words that name the product, not the place.
   *
   * "Amazon.ca Prime" and "AMZN Mktp CA" are one merchant and two entirely
   * different things: a subscription and a shop. Keying on the first word
   * alone merged them, so a Prime membership was buried inside a year of
   * marketplace orders.
   *
   * A list rather than "take two words", because a city or a store number
   * earns no second token and taking two of everything splits one
   * subscription into three. */
  const QUALIFIERS = new Set([
    "PRIME", "WORKSPACE", "GSUITE", "CLOUD", "ONE", "PLUS", "PRO", "MUSIC",
    "TV", "DRIVE", "PHOTOS", "STORAGE", "BUSINESS", "TEAM", "TEAMS", "PREMIUM",
  ]);

  const NOISE = new Set([
    "INC", "LLC", "LTD", "CORP", "CO", "GMBH", "PLC", "LIMITED", "COMPANY",
    "SUBSCRIPTION", "MONTHLY", "ANNUAL", "RECURRING", "PAYMENT", "PURCHASE",
    "CA", "US", "USA", "UK", "USD", "CAD", "EUR", "GBP", "HTTP", "HTTPS", "COM",
    /* Leading articles, which are never the merchant. "THE COFFEE SHOP"
       keying on "THE" would put every such business in one group. */
    "THE", "A", "AN", "AND",
  ]);

  const words = [];
  for (const token of cleaned.split(" ")) {
    if (!token) continue;

    /* A token with a digit in it is a reference, not a name.
     *
     * This is the bug that made the whole feature look broken. Only runs of
     * three or more digits were stripped, so "GOOGLE *CLOUD 2H4XY1" became
     * "GOOGLE CLOUD H XY", and next month's reference made a different name
     * again: every charge grouped on its own and nothing ever repeated. */
    if (/\d/.test(token)) continue;
    if (token.length < 2) continue;

    /* Noise is skipped wherever it falls, not only at the start.
       "Amazon.ca Prime" puts the country code between the merchant and the
       product. */
    if (NOISE.has(token)) continue;

    if (words.length === 0) {
      /* The merchant. Almost always the first real word. */
      words.push(token);
      continue;
    }

    /* Past the merchant, only a product word counts, and it ends the scan
       either way.
     *
     * "Amazon.ca Prime" and "AMZN Mktp CA" are one merchant and two entirely
     * different things: a subscription and a shop. Keying on the first word
     * alone buried a Prime membership inside a year of marketplace orders.
     *
     * A list rather than "take two words", because a city or a store number
     * earns no second token and taking two of everything splits one
     * subscription into three. */
    if (QUALIFIERS.has(token)) words.push(token);
    break;
  }

  return words.join(" ");
}

/* What to call it on screen.
 *
 * The bank's descriptor is not a name, and the key is a shout. Known merchants
 * get the name they trade under; a generic word keeps the whole descriptor,
 * because "Account" tells nobody anything and "Monthly account fee" does.
 */
const ALIASES = {
  MSFT: "Microsoft", MICROSOFT: "Microsoft", AMZN: "Amazon", AWS: "Amazon Web Services",
  GOOGLE: "Google", GSUITE: "Google Workspace", ADOBE: "Adobe", FIGMA: "Figma",
  SLACK: "Slack", NOTION: "Notion", DROPBOX: "Dropbox", ZOOM: "Zoom", CANVA: "Canva",
  GITHUB: "GitHub", VERCEL: "Vercel", SUPABASE: "Supabase", OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic", CLOUDFLARE: "Cloudflare", SHOPIFY: "Shopify",
  SQUARESPACE: "Squarespace", GODADDY: "GoDaddy", MAILCHIMP: "Mailchimp",
  HUBSPOT: "HubSpot", ATLASSIAN: "Atlassian", ASANA: "Asana", AIRTABLE: "Airtable",
  QUICKBOOKS: "QuickBooks", INTUIT: "Intuit", XERO: "Xero", APPLE: "Apple",
  SPOTIFY: "Spotify", NETFLIX: "Netflix", LINKEDIN: "LinkedIn",
};

/* Words that are a category rather than a merchant. */
const GENERIC = new Set([
  "ACCOUNT", "SERVICE", "BANK", "INTEREST", "FEE", "CHARGE", "OVERDRAFT",
  "TRANSFER", "WITHDRAWAL", "DEPOSIT", "INSURANCE", "PREMIUM", "RENT", "LEASE",
]);

export function displayName(key, descriptor) {
  /* The catalogue already knows what these companies call themselves, and it
     is the list that gets maintained. Keeping a second spelling here was how
     "ElevenLabs" came out as "Elevenlabs" on a row whose own catalogue entry
     had it right. */
  const known = identify(key);
  if (known?.name) return known.name;
  if (ALIASES[key]) return ALIASES[key];

  if (GENERIC.has(key)) {
    /* Keep the bank's own words, tidied. A fee is better described by the
       whole phrase than by its first word. */
    const whole = String(descriptor || key)
      .replace(/[*#]/g, " ").replace(/\b\w*\d\w*\b/g, " ")
      .replace(/\s+/g, " ").trim().toLowerCase();
    return whole ? whole[0].toUpperCase() + whole.slice(1) : key;
  }

  return key.split(" ")
    .map((w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()))
    .join(" ");
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
       would drag the average away from what is actually charged.
     *
     * Two shapes arrive here and both have to work. A ledger transaction is
     * signed, negative for spending. A BANK line is stored as an absolute
     * amount with the direction in its own field, which is how Plaid's rows
     * land in this project.
     *
     * The original test was `amount >= 0`, which on bank rows is every line,
     * every time: nothing was ever detected and it looked like a data problem.
     * It was not. */
    const raw = Number(t.amount) || 0;
    const outgoing = t.direction
      ? t.direction === "debit"
      : t.type
        ? t.type === "expense"
        : raw < 0;
    if (!outgoing) continue;
    const amount = Math.abs(raw);
    if (!amount) continue;
    const name = normalisePayee(t.description || t.name);
    if (name.length < 3) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ d: day(t.date), amount, raw: t });
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

    /* A name somebody recognises, not the bank's descriptor.
       "ADOBE  *800-833-6687 CA" is what the bank wrote; "Adobe" is what the
       person pays. The raw one is kept, because when a name is wrong the
       descriptor is how anybody works out why. */
    const pretty = displayName(name, last.raw.description);

    found.push({
      name: pretty,
      descriptor: last.raw.description || name,
      key: name,
      amount: Math.round(typical * 100) / 100,
      monthly: Math.round(monthly * 100) / 100,
      every: cadence.every,
      days: cadence.days,
      charges: rows.length,
      lastCharged: new Date(last.d * MS_DAY).toISOString().slice(0, 10),
      nextDue: new Date(nextDay * MS_DAY).toISOString().slice(0, 10),
      ...activePeriod(rows.map((r) => r.raw), cadence.days),
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

/* Merchants you pay every month, whatever the amount.
 *
 * The test above looks for the same amount at a regular gap, which is what a
 * seat-based subscription looks like. Plenty of the most expensive things a
 * business pays for do not look like that at all:
 *
 *   Anthropic     48 charges in five months, every amount different
 *   Google        28 charges, between $4.80 and $45.43
 *   Apple         13 charges, $14.68 to $134.47
 *
 * Usage billing, several seats bought separately, top-ups. Checked against
 * five real RBC statements, where the strict test found a Netflix and a bank
 * fee and missed a $414 a month API bill, which is the largest recurring cost
 * on the account.
 *
 * So: a merchant charging in most of the months we can see is recurring,
 * whatever the amounts. The figure reported is what it actually costs per
 * month, which is the number somebody wants anyway.
 */
export function findRecurring(lines = [], { minMonths = 3 } = {}) {
  const months = new Set();
  const byPayee = new Map();

  for (const t of lines) {
    const raw = Number(t.amount) || 0;
    const outgoing = t.direction ? t.direction === "debit"
      : t.type ? t.type === "expense" : raw < 0;
    if (!outgoing || !raw) continue;

    const month = String(t.date || "").slice(0, 7);
    if (!month) continue;
    months.add(month);

    const key = normalisePayee(t.description || t.name);
    if (key.length < 3) continue;

    const row = byPayee.get(key) || { key, months: new Map(), lines: [], last: null };
    row.months.set(month, (row.months.get(month) || 0) + Math.abs(raw));
    row.lines.push(t);
    if (!row.last || String(t.date) > String(row.last.date)) row.last = t;
    byPayee.set(key, row);
  }

  const span = months.size || 1;
  const out = [];

  /* Things that repeat and are not subscriptions.
   *
   * Money moved between your own accounts, wages, and tax. All of these
   * repeat beautifully and none of them is something you could cancel, which
   * is the point of this list. */
  const NOT_A_SUBSCRIPTION = /\b(TRANSFER|E-?TRANSFER|SAVE|SAVINGS|PAYROLL|WAGE|SALARY|DEPOSIT|WITHDRAWAL|ATM|CRA|REVENUE|TAX|MORTGAGE|LOAN|CREDIT CARD|VISA PAYMENT|MASTERCARD)\b/i;

  for (const row of byPayee.values()) {
    const seen = row.months.size;
    if (NOT_A_SUBSCRIPTION.test(row.key) || NOT_A_SUBSCRIPTION.test(row.last?.description || "")) {
      continue;
    }

    /* A subscription bills on a schedule. Sixteen charges in a month is
       somewhere you shop, and a coffee shop appearing in every month of the
       year is not a recurring cost you can do anything about.
     *
     * Found on real statements: a doughnut shop at 83 charges outranked a
     * genuine $100 a month hosting bill. */
    /* Matched on the normalised key, not the raw descriptor.
     *
     * The descriptor carries the payment rail: "SQ *SHAWARMA AL" contains
     * "SQ ", which is Square's prefix, so a lunch place was recognised as a
     * payment processor and exempted from every check. The key has the rail
     * already stripped. */
    const known = Boolean(identify(row.key));
    const perMonth = row.lines.length / seen;

    /* A subscription bills on a schedule. Sixteen charges in a month is
       somewhere you shop.
     *
     * But frequency alone is the wrong test, and the real statements proved
     * it: the cap that correctly removed a doughnut shop at 83 charges also
     * removed a $414 a month API bill at 48, because usage billing tops up
     * whenever you run out.
     *
     * So a recognised software merchant is exempt. We know what Anthropic and
     * Google are; we do not know what the shop on the corner is, and for
     * those the rhythm is the only signal available. */
    if (!known && perMonth > 5) continue;
    /* In most of the months we can see, and at least three. Two months is a
       coincidence; "most" rather than "all" because a subscription started in
       June should not be missed in a feed that begins in May. */
    if (seen < minMonths || seen < Math.min(3, span - 1)) continue;

    const dates = row.lines.map((l) => String(l.date).slice(0, 10)).sort();
    const lastSeen = dates[dates.length - 1];
    const totals = [...row.months.values()];
    const spendPerMonth = totals.reduce((a, b) => a + b, 0) / totals.length;
    const low = Math.min(...totals);
    const high = Math.max(...totals);
    const varies = high > low * 1.35;

    out.push({
      key: row.key,
      name: displayName(row.key, row.last?.description),
      descriptor: row.last?.description || row.key,
      kind: varies ? "varies" : "fixed",
      /* How sure we are, so the interface can lead with the ones it is sure
         about and let somebody judge the rest rather than hiding them. */
      confidence: known ? "known" : varies ? "maybe" : "likely",
      known,
      monthly: Math.round(spendPerMonth * 100) / 100,
      amount: Math.round(spendPerMonth * 100) / 100,
      low: Math.round(low * 100) / 100,
      high: Math.round(high * 100) / 100,
      every: "month",
      days: 30,
      charges: row.lines.length,
      monthsSeen: seen,
      monthsPossible: span,
      lastCharged: lastSeen,
      nextDue: null,
      ...activePeriod(row.lines, 30),
      lines: row.lines,
    });
  }

  return out.sort((a, b) => b.monthly - a.monthly);
}

/* Both kinds, merged, with the precise one winning where they overlap.
 *
 * A subscription found by the strict test has a real next-charge date and a
 * real amount, which is better information than a monthly average. The loose
 * test fills in everything the strict one cannot see.
 */
export function findAll(lines = [], opts = {}) {
  const strict = findSubscriptions(lines, opts);
  const loose = findRecurring(lines, opts);
  const have = new Set(strict.map((s) => s.key));
  return [...strict.map((s) => ({ ...s, kind: s.kind || "fixed" })),
          ...loose.filter((r) => !have.has(r.key))]
    .sort((a, b) => b.monthly - a.monthly);
}

/* When it started, when it last charged, and whether it is still running.
 *
 * A list of subscriptions with no dates answers "what do I pay for" and not
 * "am I still paying for it", which is the question that saves money. A
 * service cancelled in July should say so rather than sitting in the total
 * forever, and one that quietly stopped charging is worth noticing: either it
 * lapsed, or the card on file expired and something is about to break.
 *
 * Nothing here guesses at a cancellation date. It reports the last charge and
 * how overdue the next one is, and lets the person say what happened.
 */
export function activePeriod(lines = [], cadenceDays = 30) {
  if (!lines.length) return { firstCharged: null, lastCharged: null, status: "unknown" };

  const dates = lines.map((l) => String(l.date).slice(0, 10)).sort();
  const firstCharged = dates[0];
  const lastCharged = dates[dates.length - 1];

  const sinceLast = Math.round(
    (Date.now() - new Date(`${lastCharged}T00:00:00`).getTime()) / MS_DAY,
  );

  /* Two cycles of silence, or forty days, whichever is longer. One missed
     cycle is a card retry or a weekend; two is a decision. */
  const patience = Math.max(40, cadenceDays * 2);

  return {
    firstCharged,
    lastCharged,
    monthsRunning: Math.max(1, Math.round(
      (new Date(`${lastCharged}T00:00:00`) - new Date(`${firstCharged}T00:00:00`)) / MS_DAY / 30,
    ) + 1),
    daysSinceLast: sinceLast,
    status: sinceLast > patience ? "stopped" : "active",
    /* Said in words, because "47" is a number and "last charged seven weeks
       ago" is an answer. */
    statusWhy: sinceLast > patience
      ? `nothing since ${lastCharged}`
      : `charging since ${firstCharged}`,
  };
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

/* ---------------- the person's judgement ---------------- */

/* Detection proposes; the person decides. What they decide is stored, because
 * it is the part a computer cannot work out and the part that has to survive
 * the next sync.
 */
import { supabase } from "./supabase";
import { assertWritable } from "./access";

const softly = async (what, run, fallback) => {
  try { return await run(); } catch (e) {
    console.warn(`${what} unavailable:`, e?.message || e);
    return fallback;
  }
};

const rowToTag = (r) => ({
  id: r.id,
  ledgerId: r.ledger_id,
  payeeKey: r.payee_key,
  label: r.label || "",
  side: r.side || "unset",
  chargedTo: r.charged_to || null,
  businessShare: r.business_share == null ? null : Number(r.business_share),
  category: r.category || "",
  note: r.note || "",
  hidden: Boolean(r.hidden),
  cancelledOn: r.cancelled_on || null,
});

export async function listTags(ledgerId) {
  return softly("subscription tags", async () => {
    const { data, error } = await supabase
      .from("subscription_tags").select("*").eq("ledger_id", ledgerId);
    if (error) throw error;
    return (data || []).map(rowToTag);
  }, []);
}

/** Tags on other ledgers that point at this one. */
export async function listChargedHere(ledgerId) {
  return softly("subscriptions charged elsewhere", async () => {
    const { data, error } = await supabase
      .rpc("subscriptions_charged_to", { p_ledger_id: ledgerId });
    if (error) throw error;
    return (data || []).map(rowToTag);
  }, []);
}

export async function saveTag(ledgerId, tag) {
  assertWritable();
  try {
    const body = {
      ledger_id: ledgerId,
      payee_key: tag.payeeKey,
      label: tag.label || null,
      side: tag.side || "unset",
      charged_to: tag.chargedTo || null,
      business_share: tag.businessShare ?? null,
      category: tag.category || null,
      note: tag.note || null,
      hidden: Boolean(tag.hidden),
      cancelled_on: tag.cancelledOn || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("subscription_tags").upsert(body, { onConflict: "ledger_id,payee_key" })
      .select().single();
    if (error) throw error;
    return { ok: true, saved: rowToTag(data) };
  } catch (e) {
    console.warn("save subscription tag failed:", e?.message || e);
    return { ok: false, error: e?.message || "That did not save." };
  }
}

/** Detection and judgement, merged. What the interface actually draws. */
export function applyTags(subs = [], tags = []) {
  const byKey = new Map(tags.map((t) => [t.payeeKey, t]));
  return subs
    .map((s) => {
      const tag = byKey.get(s.key) || null;
      if (!tag) return { ...s, side: "unset", tagged: false };
      return {
        ...s,
        name: tag.label || s.name,
        side: tag.side,
        chargedTo: tag.chargedTo,
        businessShare: tag.businessShare,
        category: tag.category || s.category,
        note: tag.note,
        hidden: tag.hidden,
        cancelledOn: tag.cancelledOn,
        tagged: true,
      };
    })
    .filter((s) => !s.hidden);
}

/** What the business is actually paying, including anything on a personal card. */
export function businessTotals(subs = []) {
  let monthly = 0;
  for (const s of subs) {
    if (s.side === "business") monthly += s.monthly;
    else if (s.side === "mixed" && s.businessShare != null) monthly += s.monthly * s.businessShare;
  }
  return {
    monthly: Math.round(monthly * 100) / 100,
    yearly: Math.round(monthly * 12 * 100) / 100,
  };
}
