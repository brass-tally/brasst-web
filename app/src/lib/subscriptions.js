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
    .replace(/\b(PAYPAL|SQ|SQUARE|TST|POS|VISA|MC|INTERAC)\s*\*?/g, " ")
    .replace(/[*#,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
     * "GOOGLE CLOUD H XY" and next month's reference made a different name
     * again: every charge grouped on its own and nothing ever repeated.
     *
     * The only things detected were descriptors with no reference at all,
     * which is why a bank fee showed up and the software a business actually
     * pays for did not. */
    if (/\d/.test(token)) continue;
    if (NOISE.has(token)) continue;
    if (token.length < 2) continue;
    words.push(token);
    /* The first word is the merchant, and that is the whole key.
     *
     * Two words looked more precise and grouped worse: the same company
     * appears as "ADOBE", "ADOBE INC" and "ADOBE CREATIVE CLOUD SAN JOSE", and
     * keying on two of them splits one subscription into three.
     *
     * The cost is that "GOOGLE CLOUD" and "GOOGLE ADS" land together. That is
     * caught downstream rather than here: a merged group has amounts that
     * disagree, and the 35% test rejects it. Reporting nothing would be the
     * worse failure, and is what was happening. */
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
