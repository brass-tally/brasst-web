// Offline parsing for the capture box.
//
// Two jobs:
//   parseEntryText — turns "just paid for a yearly Claude Subscription for
//     $316.26" into a draft without touching the network. It is the floor the
//     capture box always has: if the extract function is down, misconfigured,
//     or answers with something unusable, the user still gets a filled-in card.
//   normalizeDraft — coerces whatever came back from the model into the exact
//     shape DraftCard expects: a real number, a real date, a category that
//     actually exists in this ledger.

/* ================= dates ================= */

// Local date, not UTC. `new Date().toISOString()` rolls to tomorrow after
// 7pm Eastern, which would file entries a day ahead.
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const monthIndex = (word) => MONTHS.findIndex((m) => m.startsWith(word.toLowerCase().slice(0, 3)));

const shiftDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const ymd = (y, m, d) => {
  const dt = new Date(y, m, d);
  if (dt.getMonth() !== m || dt.getDate() !== d) return null; // Feb 31 and friends
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

// A bare month/day with no year means the most recent one that has already
// happened — "on March 10" in July is this year, in February it's last year.
const nearestPast = (month, day) => {
  const now = new Date();
  const thisYear = ymd(now.getFullYear(), month, day);
  if (thisYear && thisYear <= todayLocal()) return thisYear;
  return ymd(now.getFullYear() - 1, month, day);
};

const lastWeekday = (name) => {
  const target = WEEKDAYS.indexOf(name.toLowerCase());
  if (target < 0) return null;
  const now = new Date();
  const back = (now.getDay() - target + 7) % 7 || 7;
  return shiftDays(-back);
};

// Returns { date, start, end } so the caller can strip the phrase out of the
// description, or null when the text carries no date at all.
export function findDate(text) {
  const rules = [
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => ymd(+m[1], +m[2] - 1, +m[3])],
    [new RegExp(String.raw`\b(${MONTH_RE})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b`, "i"),
      (m) => (m[3] ? ymd(+m[3], monthIndex(m[1]), +m[2]) : nearestPast(monthIndex(m[1]), +m[2]))],
    [new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_RE})\.?(?:,?\s*(\d{4}))?\b`, "i"),
      (m) => (m[3] ? ymd(+m[3], monthIndex(m[2]), +m[1]) : nearestPast(monthIndex(m[2]), +m[1]))],
    // month/day first: matches how amounts are usually typed alongside ($ implies US-style)
    [/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
      const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
      return year ? ymd(year, +m[1] - 1, +m[2]) : nearestPast(+m[1] - 1, +m[2]);
    }],
    [/\btoday\b/i, () => todayLocal()],
    [/\b(?:yesterday|last night)\b/i, () => shiftDays(-1)],
    [/\btomorrow\b/i, () => shiftDays(1)],
    [/\b(\d{1,3})\s*(?:days?|d)\s+ago\b/i, (m) => shiftDays(-+m[1])],
    [/\b(\d{1,2})\s*(?:weeks?|wks?)\s+ago\b/i, (m) => shiftDays(-7 * +m[1])],
    [/\blast\s+week\b/i, () => shiftDays(-7)],
    [/\blast\s+month\b/i, () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }],
    [new RegExp(String.raw`\b(?:last\s+|this\s+past\s+|on\s+)?(${WEEKDAYS.join("|")})\b`, "i"), (m) => lastWeekday(m[1])],
  ];
  for (const [re, build] of rules) {
    const m = re.exec(text);
    if (!m) continue;
    const date = build(m);
    if (date) return { date, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/* ================= amounts ================= */

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const toNum = (s) => Number(String(s).replace(/,/g, ""));

// Ordered strongest signal first. A currency mark beats "for 40", which beats a
// bare number floating in the sentence.
const AMOUNT_RULES = [
  new RegExp(String.raw`(?:[$€£]|\b(?:cad|usd|eur|gbp)\s*\$?)\s*(${NUM})`, "i"),
  new RegExp(String.raw`(${NUM})\s*(?:dollars?|bucks?|cad|usd|eur|gbp)\b`, "i"),
  new RegExp(String.raw`\b(?:for|of|at|costs?|cost\s+me|totall?ing|total|paid|spent|charged|billed|=|:)\s*(${NUM})\b`, "i"),
];

// "2200/mo" is one phrase: swallow the rate suffix so it doesn't land in the
// description. The cadence itself is read separately by RECURRING_RE.
const withRate = (value, start, end, text) => {
  const suffix = /^\s*\/\s*(?:mo|month|yr|year|wk|week|q)\b/i.exec(text.slice(end));
  return { value, start, end: end + (suffix?.[0].length || 0) };
};

export function findAmount(text) {
  for (const re of AMOUNT_RULES) {
    const m = re.exec(text);
    if (m) {
      const value = toNum(m[1]);
      if (value > 0) return withRate(value, m.index, m.index + m[0].length, text);
    }
  }
  // Last resort: any bare number that clearly isn't part of a date, a
  // percentage, a quantity, or a time.
  const re = new RegExp(`(${NUM})`, "g");
  let m;
  while ((m = re.exec(text))) {
    const value = toNum(m[1]);
    const before = text.slice(Math.max(0, m.index - 14), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (!(value > 0)) continue;
    if (/^\s*(?:%|x\b|am\b|pm\b|st\b|nd\b|rd\b|th\b|:)/i.test(after)) continue;
    // 3/10 or 2025-03-10, but not a rate like 2200/mo
    if (/\d[/\-.]$/.test(before) || /^\s*[/\-]\s*\d/.test(after)) continue;
    if (new RegExp(`(?:${MONTH_RE})\\.?\\s*$`, "i").test(before)) continue; // March 10
    if (new RegExp(`^\\s*(?:${MONTH_RE})\\b`, "i").test(after)) continue;   // 10 March
    if (/^\s*(?:days?|weeks?|months?|years?|hours?|min)\b/i.test(after)) continue;
    if (/^\d{4}$/.test(m[1]) && value >= 1900 && value <= 2099) continue;   // a year
    return withRate(value, m.index, m.index + m[0].length, text);
  }
  return null;
}

/* ================= classification ================= */

const INCOME_RE = /\b(?:got\s+paid|received|deposit(?:ed)?|paid\s+me|paid\s+us|invoice\s+(?:was\s+)?paid|refund(?:ed)?|earned|revenue|income|payout|client\s+paid)\b/i;
const RECURRING_RE = /\b(?:subscription|subscribed|renew(?:al|ed|s)?|recurring|retainer|membership|plan|monthly|month(?:ly)?\s+fee|yearly|annual(?:ly)?|weekly|quarterly|per\s+(?:month|year|week)|\/(?:mo|yr|month|year))\b/i;

// vendor / keyword → the category names worth looking for, best guess first.
const CATEGORY_HINTS = [
  [/\b(?:claude|anthropic|openai|chatgpt|gpt|copilot|midjourney|cursor|figma|canva|notion|slack|linear|adobe|jetbrains|zoom|dropbox|1password|airtable|framer|sketch|licen[cs]e|saas|software|app\s+store)\b/i,
    ["software", "subscriptions", "tools", "apps", "saas"]],
  [/\b(?:vercel|aws|amazon\s+web|netlify|heroku|cloudflare|supabase|railway|render|digitalocean|linode|fly\.io|mongodb|planetscale|firebase|hosting|server|domain|namecheap|godaddy|cloud)\b/i,
    ["hosting", "cloud", "infrastructure", "software"]],
  [/\b(?:coffee|starbucks|tim\s*hortons|lunch|dinner|breakfast|restaurant|cafe|uber\s*eats|doordash|skip\s*the|grocer(?:y|ies)|food|meal)\b/i,
    ["meals", "food", "groceries", "dining", "meals & entertainment"]],
  [/\b(?:uber|lyft|flight|airline|air\s*canada|hotel|airbnb|taxi|train|via\s*rail|gas|fuel|petrol|parking|transit|presto|mileage)\b/i,
    ["travel", "transport", "transportation", "auto", "vehicle"]],
  [/\b(?:ads?|advertis\w+|marketing|google\s+ads|meta\s+ads|facebook\s+ads|sponsorship|promo)\b/i,
    ["marketing", "advertising", "ads", "growth"]],
  [/\b(?:salar(?:y|ies)|payroll|wages|contractor|freelancer|subcontractor|bonus)\b/i,
    ["salaries", "payroll", "contractors", "wages"]],
  [/\b(?:rent|mortgage|lease|office\s+space|coworking|wework)\b/i, ["rent", "office", "housing", "facilities"]],
  [/\b(?:hydro|electric\w*|water\s+bill|internet|wifi|phone\s+bill|rogers|bell|telus|utilit\w+)\b/i, ["utilities", "internet", "phone", "bills"]],
  [/\b(?:accountant|bookkeep\w+|lawyer|legal|consultant|audit|cpa)\b/i, ["professional fees", "legal", "accounting", "services"]],
  [/\b(?:insurance|premium)\b/i, ["insurance"]],
  [/\b(?:laptop|macbook|monitor|keyboard|hardware|printer|desk|chair|equipment)\b/i, ["equipment", "hardware", "supplies", "office"]],
  [/\b(?:client|invoice|retainer|consulting|project\s+payment|contract)\b/i, ["client revenue", "revenue", "sales", "consulting", "services"]],
];

const norm = (s) => String(s || "").trim().toLowerCase();

// Snaps an arbitrary label onto a category that exists in this ledger. Exact
// match, then containment either way, then word overlap.
export function matchCategory(label, list) {
  const want = norm(label);
  if (!want || !list?.length) return null;
  const exact = list.find((c) => norm(c.name) === want);
  if (exact) return exact.name;
  const contains = list.find((c) => norm(c.name).includes(want) || want.includes(norm(c.name)));
  if (contains) return contains.name;
  const words = want.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const overlap = list.find((c) => words.some((w) => norm(c.name).includes(w)));
  return overlap ? overlap.name : null;
}

export function guessCategory(text, list) {
  if (!list?.length) return null;
  for (const [re, candidates] of CATEGORY_HINTS) {
    if (!re.test(text)) continue;
    for (const candidate of candidates) {
      const hit = matchCategory(candidate, list);
      if (hit) return hit;
    }
  }
  return null;
}

/* ================= description ================= */

const LEAD_RULES = [
  /^[\s,.\-–—]+/,
  /^(?:just|already|i|we|i've|ive|we've|weve|so|ok|okay|hey)\b[\s,]*/i,
  /^(?:paid(?:\s+for)?|pay|bought|buy|purchase[ds]?|spent(?:\s+on)?|spend|got(?:\s+paid)?|received|renewed|subscribed(?:\s+to)?|charged(?:\s+for)?|billed(?:\s+for)?|invoiced|expensed|added|log(?:ged)?)\b[\s,]*/i,
  /^(?:for|on|to|from|by|of|at|with|a|an|the|my|our|this|that|another)\b[\s,]*/i,
  /^(?:yearly|annual|monthly|weekly|quarterly|new|recurring)\b[\s,]*/i,
];
const TRAIL_RE = /[\s,.!;:\-–—]*\b(?:for|on|at|to|of|from|by|in|with|the|a|an|and|plus|about)\b[\s,.!;:]*$/i;

function cleanDescription(text) {
  let s = text.replace(/\s+/g, " ").trim();
  for (let pass = 0; pass < 8; pass++) {
    const before = s;
    for (const re of LEAD_RULES) s = s.replace(re, "");
    s = s.replace(TRAIL_RE, "").replace(/[\s,.!;:\-–—]+$/, "");
    if (s === before) break;
  }
  s = s.trim();
  if (s.length > 64) s = s.slice(0, 64).replace(/\s+\S*$/, "");
  // "claude subscription" reads better as "Claude subscription" on the card
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/* ================= the parser ================= */

/**
 * Reads a typed capture line into a draft. Returns null only when there is no
 * amount to be found — without one there is nothing worth pre-filling.
 */
export function parseEntryText(text, { categories = { expense: [], income: [] }, ledgerKind = "business" } = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const amount = findAmount(raw);
  if (!amount) return null;

  const date = findDate(raw);
  const type = INCOME_RE.test(raw) && !/\bi\s+paid\b/i.test(raw) ? "income" : "expense";
  const list = categories[type] || [];

  // Strip the amount and date phrases out before reading the vendor, so
  // "$316.26" and "on March 10" don't end up in the description.
  const spans = [amount, date].filter(Boolean).sort((a, b) => b.start - a.start);
  let rest = raw;
  for (const s of spans) rest = rest.slice(0, s.start) + " " + rest.slice(s.end);

  const description = cleanDescription(rest) || "Entry";
  const category = guessCategory(raw, list) || list[0]?.name || "Other";

  return {
    type,
    amount: Math.round(amount.value * 100) / 100,
    date: date?.date || todayLocal(),
    description,
    category,
    subcategory: "",
    account: ledgerKind === "personal" ? "personal" : "business",
    recurrence: RECURRING_RE.test(raw) ? "recurring" : "once",
    note: "",
    source: "local",
  };
}

/* ================= normalizing model output ================= */

export function coerceAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(Math.round(value * 100) / 100);
  const n = toNum(String(value ?? "").replace(/[^0-9.,-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? Math.abs(Math.round(n * 100) / 100) : 0;
}

export function coerceDate(value) {
  const s = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return ymd(y, m - 1, d);
  }
  return s ? findDate(s)?.date || null : null;
}

/**
 * Takes whatever the model returned and makes it safe to hand to DraftCard:
 * a positive number, a real calendar date, and a category that exists in this
 * ledger. `fallback` is the locally parsed draft, used to fill any hole the
 * model left.
 */
export function normalizeDraft(raw, { categories = { expense: [], income: [] }, ledgerKind = "business", fallback = null } = {}) {
  const d = raw && typeof raw === "object" ? raw : {};
  const type = d.type === "income" ? "income" : fallback?.type === "income" && d.type == null ? "income" : "expense";
  const list = categories[type] || [];

  const amount = coerceAmount(d.amount) || fallback?.amount || 0;
  const description = String(d.description || "").trim() || fallback?.description || "Entry";
  const category =
    matchCategory(d.category, list) ||
    matchCategory(fallback?.category, list) ||
    guessCategory(description, list) ||
    list[0]?.name ||
    "Other";

  const subs = list.find((c) => c.name === category)?.subs || [];
  const wanted = norm(d.subcategory);
  const subcategory = subs.find((s) => norm(s) === wanted) || "";

  return {
    type,
    amount,
    date: coerceDate(d.date) || fallback?.date || todayLocal(),
    description,
    category,
    subcategory,
    account: d.account === "personal" || d.account === "business" ? d.account : ledgerKind === "personal" ? "personal" : "business",
    recurrence: d.recurrence === "recurring" ? "recurring" : d.recurrence === "once" ? "once" : fallback?.recurrence || "once",
    note: String(d.note || "").trim(),
    source: "model",
  };
}
