#!/usr/bin/env node
/* The duplicate matcher, against the cases that broke it.
 *
 * It grouped 103 separate e-transfers as copies of one payment and offered to
 * delete 102 of them in a single tap, because the similarity scorer strips
 * three-digit-and-longer runs from a description as "reference numbers, not part
 * of the name". A reference number is exactly what distinguishes two transfers.
 *
 * Needs a bundle, because the module uses extensionless imports:
 *   npx esbuild app/src/lib/reconcile.js --bundle --format=esm --outfile=/tmp/rec.mjs
 *   node scripts/tests-duplicates.mjs
 */
import { findDuplicateEntries } from "/tmp/rec.mjs";

let id = 0;
const tx = (date, desc, amount, type = "expense") => ({ id: `t${++id}`, date, description: desc, amount, type });

console.log("\nthe case from the screenshot: 103 e-transfers, distinct references");
{
  const refs = ["7098", "4773", "4593", "5277", "0653"];
  const rows = [];
  for (let i = 0; i < 103; i++)
    rows.push(tx("2026-05-19", `Online transfer sent - ${refs[i % refs.length]} Bilal Shafi`, 20));
  const r = findDuplicateEntries(rows);
  const biggest = Math.max(0, ...r.map((g) => g.extras.length + 1));
  console.log(`  groups offered for deletion: ${r.length}, largest ${biggest} members`);
  console.log(`  patterns flagged instead: ${r.patterns.length}`);
  console.log(`  rows a single tap could delete: ${Math.max(0, ...r.map((g) => g.extras.length))}`);
}

console.log("\na real double import: every row duplicated once, same reference");
{
  const rows = [];
  for (const [d, desc, amt] of [["2026-05-01","Vercel #A1001",70],["2026-05-02","Rogers #B2002",120],["2026-05-03","Stripe fee #C3003",14]]) {
    rows.push(tx(d, desc, amt)); rows.push(tx(d, desc, amt));
  }
  const r = findDuplicateEntries(rows);
  console.log(`  groups found: ${r.length} (want 3), each with ${r.map((g)=>g.extras.length).join(",")} extra`);
  console.log(`  confidence: ${r.map((g)=>g.confidence).join(", ")}`);
}

console.log("\ntwo cheques with different numbers, same amount, same week");
{
  const r = findDuplicateEntries([tx("2026-05-01","Cheque 1021",500), tx("2026-05-02","Cheque 1044",500)]);
  console.log(`  groups: ${r.length} (want 0)`);
}

console.log("\nan imported line beside a hand-typed one, only one has a reference");
{
  const r = findDuplicateEntries([tx("2026-05-01","Vercel hosting #99123",70), tx("2026-05-01","Vercel hosting",70)]);
  console.log(`  groups: ${r.length} (want 1)`);
}

console.log("\nfive weekly payments of the same amount to the same payee, no references");
{
  const rows = ["2026-05-01","2026-05-08","2026-05-15","2026-05-22","2026-05-29"].map((d)=>tx(d,"Cleaner",150));
  const r = findDuplicateEntries(rows);
  console.log(`  groups: ${r.length} (want 0, they are 7 days apart)`);
}
