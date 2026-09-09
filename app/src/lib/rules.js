/* ================= remembered filing rules =================
   A bank line with no entry behind it gets categorised once, and the same line
   arrives again next month. This turns that into a rule.

   The signature strips the parts that change between two instances of the same
   recurring thing: reference numbers, dates, and trailing amounts.

   Note that this is the exact opposite of what the duplicate detector needs. It
   compares two entries to decide whether they are the same event, so a
   reference number is the thing that proves they are not, and stripping it is
   what made it group a hundred separate transfers as copies. Here we are
   comparing two instances of a recurring line, where the reference is the noise
   and the wording is the signal. Same digits, opposite meaning, which is why
   these live in two functions rather than one shared helper. */

export function ruleSignature(description) {
  return String(description || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    // reference and cheque numbers, account fragments
    .replace(/\b\d{3,}\b/g, " ")
    // dates in any of the shapes a bank writes them
    .replace(/\b\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b/g, " ")
    // a trailing amount, which some banks append to the description
    .replace(/\b\d+\s*\d{2}\b$/g, " ")
    .replace(/\b(?:inc|llc|ltd|corp|co)\b/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .trim();
}

/* A signature has to carry enough words to be worth acting on. "sent" would
   match half a statement; "e transfer request fulfilled fee" is a thing. */
export function signatureIsUseful(sig) {
  const words = sig.split(" ").filter((w) => w.length > 2);
  return words.length >= 2 && sig.length >= 8;
}

export const directionOf = (bankTxn) => (bankTxn.direction === "credit" ? "credit" : "debit");

/** The rule that applies to a bank line, or null. */
export function ruleFor(bankTxn, rules) {
  if (!bankTxn || !rules?.length) return null;
  const sig = ruleSignature(bankTxn.description);
  if (!signatureIsUseful(sig)) return null;
  const dir = directionOf(bankTxn);
  return rules.find((r) => r.signature === sig && r.direction === dir) || null;
}

/**
 * Unmatched bank lines a rule can file, grouped by rule so the plan can say
 * "12 lines, all bank fees" rather than listing twelve identical sentences.
 */
export function plannedByRules(unmatched, rules) {
  const groups = new Map();
  for (const line of unmatched || []) {
    if (line.ignored || line.matchedTxId) continue;
    const rule = ruleFor(line, rules);
    if (!rule) continue;
    if (!groups.has(rule.id)) groups.set(rule.id, { rule, lines: [] });
    groups.get(rule.id).lines.push(line);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      total: Math.round(g.lines.reduce((s, l) => s + Math.abs(Number(l.amount) || 0), 0) * 100) / 100,
    }))
    .sort((a, b) => b.lines.length - a.lines.length);
}
