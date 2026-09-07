#!/usr/bin/env node
/** The tax engine. Arithmetic that is wrong is worse than arithmetic that is
 *  missing, because the second kind gets checked. */
import { deriveTreatment, summarise, estimateTaxFromGross, ccaClassFor, TAX_POLICY } from "../app/src/lib/tax.js";

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`}`);
};

console.log("\nGIFI lines");
t("hosting goes to data processing",
  deriveTreatment({ type: "expense", amount: 100, description: "Vercel", category: "Software and SaaS" }).gifi.code, "8614");
t("a subscription is not swept into office expenses",
  deriveTreatment({ type: "expense", amount: 100, description: "Figma subscription", category: "Software" }).gifi.code, "8614");
t("meals get 8523, not 9270",
  deriveTreatment({ type: "expense", amount: 100, description: "Client lunch", category: "Meals" }).gifi.code, "8523");
t("a contractor is salaries and wages",
  deriveTreatment({ type: "expense", amount: 100, description: "M. Osei", category: "Contractors" }).gifi.code, "9060");
t("unmatched falls to other expenses",
  deriveTreatment({ type: "expense", amount: 100, description: "Sundry", category: "Misc" }).gifi.code, "9270");
t("a sale is trade sales",
  deriveTreatment({ type: "income", amount: 100, description: "Stripe payout", category: "Client revenue" }).gifi.code, "8000");

console.log("\nInput tax credits, Ontario, registered");
{
  const r = deriveTreatment({ type: "expense", amount: 113, taxAmount: 13, taxCode: "hst13", description: "Vercel", category: "Software" });
  t("full HST is recoverable", r.recoverable, 13);
  t("the deductible base excludes the recovered tax", r.deductibleAmount, 100);
}
{
  const r = deriveTreatment({ type: "expense", amount: 113, taxAmount: 13, taxCode: "hst13", description: "Client dinner", category: "Meals" });
  t("meals: half the tax", r.recoverable, 6.5);
  t("meals: half the cost, net of the credit", r.deductibleAmount, 53.25);
  t("meals carry the 50% flag", r.deductible, 0.5);
}
{
  const r = deriveTreatment({ type: "expense", amount: 112, taxAmount: 12, taxCode: "gstpst", description: "Supplies", category: "Office" });
  t("BC: only the federal 5 points come back", r.recoverable, 5);
}
{
  const r = deriveTreatment({ type: "expense", amount: 113, taxAmount: 13, taxCode: "hst13", description: "Vercel", category: "Software" }, { ...TAX_POLICY, gstRegistered: false });
  t("unregistered: nothing is recoverable", r.recoverable, 0);
  t("unregistered: the tax stays in the cost", r.deductibleAmount, 113);
}
{
  const r = deriveTreatment({ type: "expense", amount: 310, taxAmount: 0, taxCode: "none", payMethod: "credits", description: "AWS compute", category: "Software" });
  t("credit-paid: no tax to recover", r.recoverable, 0);
}

console.log("\nCapital");
t("a laptop is class 50", ccaClassFor("MacBook Pro")?.class, "50");
t("a desk is class 8", ccaClassFor("standing desk")?.class, "8");
t("hosting is not an asset", ccaClassFor("Vercel hosting"), null);
{
  const r = deriveTreatment({ type: "expense", amount: 2400, taxAmount: 276, taxCode: "hst13", capital: true, description: "MacBook Pro", category: "Equipment" });
  t("capitalised items leave the income statement", r.gifi.code, "1740");
  t("the tax on a capital purchase is still recoverable", r.recoverable, 276);
  t("capital carries its class", r.capital.class, "50");
}
{
  const r = deriveTreatment({ type: "expense", amount: 2400, description: "MacBook Pro", category: "Equipment" });
  t("over the threshold and expensed anyway gets flagged", r.notes.length > 0, true);
}
{
  const r = deriveTreatment({ type: "expense", amount: 120, description: "USB hub", category: "Equipment" });
  t("under the threshold, no flag", r.notes.length, 0);
}

console.log("\nBacking tax out of a gross figure");
t("113 at 13% is 13", estimateTaxFromGross(113, "hst13").tax, 13);
t("and the subtotal is 100", estimateTaxFromGross(113, "hst13").subtotal, 100);
t("it says it is an estimate", estimateTaxFromGross(113, "hst13").estimated, true);
t("no rate, no tax", estimateTaxFromGross(100, "none").tax, 0);

console.log("\nThe accountant's summary");
{
  const s = summarise([
    { type: "income", amount: 11300, taxAmount: 1300, taxCode: "hst13", description: "Retainer", category: "Client revenue" },
    { type: "expense", amount: 113, taxAmount: 13, taxCode: "hst13", description: "Vercel", category: "Software" },
    { type: "expense", amount: 226, taxAmount: 26, taxCode: "hst13", description: "Client dinner", category: "Meals" },
    { type: "expense", amount: 2400, taxAmount: 276, taxCode: "hst13", capital: true, description: "MacBook Pro", category: "Equipment" },
    { type: "expense", amount: 310, taxAmount: 0, taxCode: "none", payMethod: "credits", description: "AWS compute", category: "Software" },
  ]);
  t("revenue", s.revenue, 11300);
  t("HST collected on sales", s.collected, 1300);
  t("credits claimed: 13 + 13 + 276", s.itc, 302);
  t("net tax owing to CRA", s.netTaxPosition, 998);
  t("capital kept out of the expense total", s.capitalTotal, 2400);
  t("meals identified", s.mealsGross, 226);
  t("credit-paid identified", s.creditsPaid, 310);
  t("one line per GIFI code", s.lines.length, 4);
  t("flags raised", s.flags.length >= 3, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
