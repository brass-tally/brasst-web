/* ================= tax treatment =================
   One place that answers, for a single entry: which GIFI line it belongs on,
   how much of it is deductible, how much GST/HST is recoverable, and whether it
   is capital rather than an expense.

   This is preparation, not advice. Every figure here is a starting point for
   you or your accountant, and the summary says so wherever it is shown.

   Two decisions worth knowing about before reading the code:

   1. The GIFI line stays DERIVED, not stored. A code frozen onto a row goes
      stale the moment you recategorise the entry, and then the statement and
      the ledger disagree with no way to tell which is right. What IS stored is
      what cannot be derived: the tax amount printed on the receipt, and whether
      you chose to capitalise it. Facts get stored; conclusions get computed.

   2. Meals carry their limit in the same rule as their line. CRA restricts both
      the deduction and the input tax credit on meals and entertainment to 50%,
      and keeping those two numbers in one place is the only way they cannot
      drift apart. */

export const TAX_POLICY = {
  /* ---- capitalisation policy ----
     CRA sets no threshold; it is an accounting policy you adopt and then apply
     consistently, which is the part that matters. $500 is the common choice for
     a small corporation and it lines up with Class 12, where tools and software
     under $500 are written off in full anyway, so below the line the treatment
     is the same either way and the bookkeeping is simpler.

     Adopt it by writing it down once: "Assets costing $500 or more with a useful
     life beyond one year are capitalised; anything below is expensed in the year
     of purchase." That sentence is what an auditor asks for. */
  capitalThreshold: 500,

  /* Ontario. Change this and the rates follow. */
  province: "ON",

  /* Registered for GST/HST, so the tax paid on business inputs is recoverable
     as an input tax credit rather than part of the cost. */
  gstRegistered: true,
};

/* ---- rates ----
   Only the recoverable portion matters for an ITC. In BC and Saskatchewan the
   provincial sales tax is a real cost and is not recoverable, so it stays in
   the expense; in Quebec the QST is recoverable if you are QST-registered. */
export const TAX_CODES = {
  hst13:  { label: "HST 13%",        rate: 0.13,    recoverable: 0.13,    provinces: ["ON"] },
  hst15:  { label: "HST 15%",        rate: 0.15,    recoverable: 0.15,    provinces: ["NS", "NB", "NL", "PE"] },
  gst5:   { label: "GST 5%",         rate: 0.05,    recoverable: 0.05,    provinces: ["AB", "NT", "NU", "YT"] },
  gstpst: { label: "GST 5% + PST",   rate: 0.12,    recoverable: 0.05,    provinces: ["BC", "SK", "MB"] },
  gstqst: { label: "GST 5% + QST",   rate: 0.14975, recoverable: 0.14975, provinces: ["QC"] },
  zero:   { label: "Zero rated",     rate: 0,       recoverable: 0,       provinces: [] },
  exempt: { label: "Exempt",         rate: 0,       recoverable: 0,       provinces: [] },
  none:   { label: "No tax shown",   rate: 0,       recoverable: 0,       provinces: [] },
};

export const defaultTaxCode = (province = TAX_POLICY.province) =>
  Object.entries(TAX_CODES).find(([, v]) => v.provinces.includes(province))?.[0] || "gst5";

/* ---- capital cost allowance classes ----
   The classes a small business actually meets. Rate is the declining balance
   rate; the half-year rule applies in the year of purchase unless immediate
   expensing applies. */
/* An ordered list, not an object. Object keys that look like integers are
   iterated in ascending numeric order, so a `{50: computers, 8: equipment}`
   map tested class 8 first and a MacBook in the "Equipment" category matched
   /equipment/ before /macbook/ ever ran. Specific before general, and the
   order has to be visible in the source. */
export const CCA_CLASSES = [
  { class: "50",   name: "Computers and systems software",   rate: 0.55, matches: /laptop|macbook|computer|desktop|monitor|server|ssd|gpu|tablet|ipad/i },
  { class: "12",   name: "Tools and software under $500",    rate: 1.00, matches: /hand tool|software licen[cs]e/i },
  { class: "13",   name: "Leasehold improvements",           rate: null, matches: /leasehold|build-?out|renovation/i },
  { class: "14.1", name: "Goodwill and intangibles",         rate: 0.05, matches: /goodwill|trademark|patent/i },
  { class: "8",    name: "Furniture, fixtures, other equipment", rate: 0.20, matches: /desk|chair|furniture|shelf|cabinet|printer|equipment|camera|phone/i },
];

/* ---- GIFI, in the order a real statement reads ----
   Ordered because the first match wins, and the specific lines have to come
   before the general ones: "software subscription" must not be caught by the
   office-expenses rule before the data-processing rule sees it. */
const GIFI_RULES = [
  { re: /meal|entertain|restaurant|client lunch|dining/i, code: "8523", name: "Meals and entertainment", deductible: 0.5 },
  { re: /salar|wage|payroll|contractor|subcontract/i,     code: "9060", name: "Salaries, wages and benefits" },
  { re: /host|cloud|server|aws|vercel|data ?process/i,    code: "8614", name: "Data processing and web hosting" },
  { re: /software|saas|subscri|licen[cs]e/i,              code: "8614", name: "Data processing and web hosting" },
  { re: /market|advert|promo|campaign/i,                  code: "8520", name: "Advertising and promotion" },
  { re: /professional|account|legal|bookkeep|consult/i,   code: "8860", name: "Professional fees" },
  { re: /travel|flight|airfare|hotel|lodging|mileage/i,   code: "9200", name: "Travel expenses" },
  { re: /rent|lease|mortgage/i,                           code: "8910", name: "Rental" },
  { re: /insur/i,                                         code: "8690", name: "Insurance" },
  { re: /bank|interest|merchant fee|stripe fee/i,         code: "8710", name: "Interest and bank charges" },
  { re: /repair|maintenance/i,                            code: "8960", name: "Repairs and maintenance" },
  { re: /util|hydro|electric|internet|telephone|mobile/i, code: "8960", name: "Repairs and maintenance" },
  { re: /office|stationery|supplies|courier|postage/i,    code: "8810", name: "Office expenses" },
  { re: /training|course|conference|dues|membership/i,    code: "8860", name: "Professional fees" },
];

const REVENUE_RULES = [
  { re: /interest|dividend/i, code: "8090", name: "Investment revenue" },
  { re: /grant|subsid|rebate/i, code: "8230", name: "Other revenue" },
];

/* Which CCA class an item looks like, or null if nothing matches. Only asked
   when the amount is at or above the threshold. */
export function ccaClassFor(text) {
  return CCA_CLASSES.find((c) => c.matches.test(text || "")) || null;
}

/* Back the tax out of a gross figure when the receipt did not print it.
   Reading it off the receipt is always better: rounding, mixed-rate baskets and
   zero-rated groceries all make the arithmetic version approximate, which is
   why the result is flagged rather than presented as fact. */
export function estimateTaxFromGross(gross, code) {
  const r = TAX_CODES[code]?.rate || 0;
  if (!r) return { tax: 0, subtotal: gross, estimated: false };
  const subtotal = gross / (1 + r);
  return { tax: round2(gross - subtotal), subtotal: round2(subtotal), estimated: true };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Everything the books and the accountant need about one entry.
 *
 * tx: { type, amount, description, category, subcategory, taxAmount, taxCode,
 *       capital, payMethod }
 */
export function deriveTreatment(tx, policy = TAX_POLICY) {
  const text = `${tx.description || ""} ${tx.subcategory || ""} ${tx.category || ""}`;
  const gross = round2(tx.amount);
  const notes = [];

  if (tx.type === "income") {
    const hit = REVENUE_RULES.find((r) => r.re.test(text));
    return {
      gifi: hit ? { code: hit.code, name: hit.name } : { code: "8000", name: "Trade sales of goods and services" },
      deductible: 1, deductibleAmount: gross,
      tax: round2(tx.taxAmount || 0), recoverable: 0,
      capital: null, notes,
      // GST/HST charged on a sale is collected on CRA's behalf, not revenue.
      collected: round2(tx.taxAmount || 0),
    };
  }

  const rule = GIFI_RULES.find((r) => r.re.test(text));
  let gifi = rule ? { code: rule.code, name: rule.name } : { code: "9270", name: "Other expenses" };
  const deductible = rule?.deductible ?? 1;

  // Capital: the user's choice governs, because only they know the useful life.
  // Where they have not chosen and the amount clears the threshold and the
  // description looks like an asset, this asks rather than deciding.
  let capital = null;
  const cca = ccaClassFor(text);
  if (tx.capital && cca) {
    capital = { class: cca.class, name: cca.name, rate: cca.rate };
    gifi = { code: "1740", name: "Capital assets (balance sheet, not an expense)" };
    notes.push(`Capitalised to CCA class ${cca.class}. It does not reduce this year's income; the claim is depreciation.`);
  } else if (!tx.capital && cca && gross >= policy.capitalThreshold) {
    notes.push(`Looks like a class ${cca.class} asset at ${money(gross)}, which is over your ${money(policy.capitalThreshold)} threshold. Expensed as instructed; worth a second look.`);
  }

  // Input tax credit. Only for registrants, only the recoverable portion, and
  // limited to the same percentage as the deduction for meals.
  const code = tx.taxCode || "none";
  const taxPaid = round2(tx.taxAmount || 0);
  const spec = TAX_CODES[code] || TAX_CODES.none;
  const recoverableShare = spec.rate ? spec.recoverable / spec.rate : 0;
  let recoverable = 0;
  if (policy.gstRegistered && taxPaid > 0) {
    recoverable = round2(taxPaid * recoverableShare * deductible);
    if (recoverableShare < 1) {
      notes.push("Provincial sales tax is not recoverable, so only the federal portion is claimed.");
    }
    if (deductible < 1) {
      notes.push("Meals and entertainment: half the cost and half the tax, per CRA.");
    }
  } else if (!policy.gstRegistered && taxPaid > 0) {
    notes.push("Not registered for GST/HST, so the tax paid stays part of the cost.");
  }

  if (tx.payMethod === "credits") {
    notes.push("Paid from a credit pool, so no cash moved and there is no tax to recover.");
  }

  // The deductible base excludes recoverable tax: you cannot claim it twice.
  const net = round2(gross - recoverable);
  return {
    gifi,
    deductible,
    deductibleAmount: round2(net * deductible),
    tax: taxPaid,
    recoverable: tx.payMethod === "credits" ? 0 : recoverable,
    capital,
    notes,
    collected: 0,
  };
}

const money = (n) =>
  (Number(n) || 0).toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

/**
 * The accountant's page: every entry sorted into the buckets a preparer works
 * in, with the arithmetic already done.
 */
export function summarise(transactions, policy = TAX_POLICY) {
  const lines = new Map();
  let revenue = 0, collected = 0, expensesGross = 0, deductible = 0;
  let itc = 0, capitalTotal = 0, mealsGross = 0, creditsPaid = 0, noTaxShown = 0;
  const capitalItems = [];
  const flags = [];

  for (const tx of transactions) {
    const t = deriveTreatment(tx, policy);
    const key = `${t.gifi.code}`;
    const row = lines.get(key) || { code: t.gifi.code, name: t.gifi.name, gross: 0, deductible: 0, tax: 0, itc: 0, count: 0 };
    row.gross = round2(row.gross + tx.amount);
    row.deductible = round2(row.deductible + t.deductibleAmount);
    row.tax = round2(row.tax + t.tax);
    row.itc = round2(row.itc + t.recoverable);
    row.count += 1;
    lines.set(key, row);

    if (tx.type === "income") {
      revenue = round2(revenue + tx.amount);
      collected = round2(collected + t.collected);
      continue;
    }

    expensesGross = round2(expensesGross + tx.amount);
    deductible = round2(deductible + t.deductibleAmount);
    itc = round2(itc + t.recoverable);
    if (t.deductible < 1) mealsGross = round2(mealsGross + tx.amount);
    if (t.capital) {
      capitalTotal = round2(capitalTotal + tx.amount);
      capitalItems.push({ description: tx.description, amount: tx.amount, class: t.capital.class, name: t.capital.name, rate: t.capital.rate });
    }
    if (tx.payMethod === "credits") creditsPaid = round2(creditsPaid + tx.amount);
    if (!tx.taxAmount && tx.taxCode !== "zero" && tx.taxCode !== "exempt") noTaxShown = round2(noTaxShown + tx.amount);
  }

  if (noTaxShown > 0) {
    flags.push({
      level: "warn",
      text: `${money(noTaxShown)} of expenses have no tax recorded. Any GST/HST on those is unclaimed until the amount is entered.`,
    });
  }
  if (mealsGross > 0) {
    flags.push({
      level: "note",
      text: `${money(mealsGross)} of meals and entertainment is halved for both the deduction and the credit.`,
    });
  }
  if (capitalTotal > 0) {
    flags.push({
      level: "note",
      text: `${money(capitalTotal)} is capitalised, so it does not reduce this year's income. Depreciation is your accountant's call.`,
    });
  }
  if (creditsPaid > 0) {
    flags.push({
      level: "note",
      text: `${money(creditsPaid)} was paid from credit pools, so no cash moved and no tax is recoverable on it.`,
    });
  }

  return {
    policy,
    revenue, collected,
    expensesGross, deductible,
    itc,
    netTaxPosition: round2(collected - itc),   // owing if positive, refund if negative
    mealsGross, capitalTotal, capitalItems, creditsPaid,
    lines: [...lines.values()].sort((a, b) => a.code.localeCompare(b.code)),
    flags,
  };
}
