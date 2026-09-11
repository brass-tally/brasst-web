#!/usr/bin/env node
/* Remembered filing rules.
 *
 * The signature strips reference numbers, which is the exact opposite of what
 * the duplicate detector needs. Both behaviours are correct in their own place,
 * so both are tested, and these two files should be read together.
 *
 *   node scripts/tests-rules.mjs
 */
import { ruleSignature, signatureIsUseful, ruleFor, plannedByRules } from "../app/src/lib/rules.js";

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log("\nsignatures");
t("a bank fee keeps its shape", ruleSignature("e-Transfer Request Fulfilled fee"), "e transfer request fulfilled fee");
t("a reference is dropped", ruleSignature("Online transfer sent - 7098 Bilal Shafi"), "online transfer sent bilal shafi");
t("two references give one signature",
  ruleSignature("Online transfer sent - 7098 Bilal Shafi") === ruleSignature("Online transfer sent - 4773 Bilal Shafi"), true);
t("a trailing date is dropped", ruleSignature("MONTHLY PLAN FEE 08/13"), "monthly plan fee");
t("a bare cheque is too weak to learn from", signatureIsUseful(ruleSignature("Cheque 1021")), false);
t("one word is too weak", signatureIsUseful(ruleSignature("sent")), false);
t("a real description is usable", signatureIsUseful(ruleSignature("e-Transfer Request Fulfilled fee")), true);

console.log("\nmatching");
const rules = [{
  id: "r1", signature: ruleSignature("e-Transfer Request Fulfilled fee"),
  direction: "debit", category: "GENIE AI", subcategory: "Bank fees",
}];
t("a later fee matches", ruleFor({ description: "e-Transfer Request Fulfilled fee", direction: "debit" }, rules)?.id, "r1");
t("the amount does not have to match",
  ruleFor({ description: "e-Transfer Request Fulfilled fee", amount: 2.75, direction: "debit" }, rules)?.id, "r1");
t("money in is not money out",
  ruleFor({ description: "e-Transfer Request Fulfilled fee", direction: "credit" }, rules), null);
t("an unrelated line does not match",
  ruleFor({ description: "Online transfer sent - 0488 Bilal Shafi", direction: "debit" }, rules), null);
t("no rules, no match", ruleFor({ description: "anything", direction: "debit" }, []), null);

console.log("\nplanning a run");
{
  const lines = [
    { id: "b1", description: "e-Transfer Request Fulfilled fee", amount: 1.5, direction: "debit" },
    { id: "b2", description: "e-Transfer Request Fulfilled fee", amount: 1.5, direction: "debit" },
    { id: "b3", description: "e-Transfer Request Fulfilled fee", amount: 2.0, direction: "debit" },
    { id: "b4", description: "Online transfer sent - 0488 Bilal Shafi", amount: 31, direction: "debit" },
    { id: "b5", description: "e-Transfer Request Fulfilled fee", amount: 1.5, direction: "debit", ignored: true },
    { id: "b6", description: "e-Transfer Request Fulfilled fee", amount: 1.5, direction: "debit", matchedTxId: "t9" },
  ];
  const planned = plannedByRules(lines, rules);
  t("one group", planned.length, 1);
  t("three lines, not the set-aside or the already-matched one", planned[0].lines.length, 3);
  t("the total adds up", planned[0].total, 5);
  t("the unrelated transfer is untouched", planned.some((g) => g.lines.some((l) => l.id === "b4")), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
