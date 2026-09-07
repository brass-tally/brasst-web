#!/usr/bin/env node
/**
 * A prop handler must point at something that exists in its own component.
 *
 * This is here because of a real failure: a handler in `Ledger` called
 * `setSettleFor`, which lives in `ARList` three components away. The build
 * passed, the check-tdz pass was clean, and the button did nothing until it was
 * clicked. JavaScript has no opinion about an identifier it has never seen
 * until the line runs.
 *
 * Narrow on purpose: only bare identifiers passed as props or called inside a
 * component, checked against declarations in the same component's body. Enough
 * to catch reaching into another component's state, which is the mistake that
 * actually happens.
 *
 *   node scripts/check-handlers.mjs app/src/App.jsx
 */
import { readFileSync } from "node:fs";

const file = process.argv[2] || "app/src/App.jsx";
/* Comments are stripped first. Without this the check reported a setter that
   only appeared in a comment explaining why the setter had been removed, which
   is the sort of false positive that gets a check switched off. */
const raw = readFileSync(file, "utf8");
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
const lines = src.split("\n");

// component boundaries: a top-level function or const at column zero
const bounds = [];
lines.forEach((l, i) => {
  const m = l.match(/^(?:export\s+)?(?:function|const)\s+([A-Z]\w*)/);
  if (m) bounds.push({ name: m[1], start: i });
});
bounds.forEach((b, i) => { b.end = i + 1 < bounds.length ? bounds[i + 1].start : lines.length; });

// identifiers declared anywhere outside a component: helpers, constants, hooks
const moduleScope = new Set(
  [...src.matchAll(/^(?:export\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1])
);
const imported = new Set(
  [...src.matchAll(/import\s+\{([^}]+)\}/g)].flatMap((m) =>
    m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop())
  ).concat([...src.matchAll(/import\s+(\w+)\s+from/g)].map((m) => m[1]))
);

const problems = [];
for (const b of bounds) {
  const body = lines.slice(b.start, b.end).join("\n");

  // declared inside this component: params, const/let, destructured state
  const local = new Set();
  for (const m of body.matchAll(/(?:const|let)\s*\[([^\]]+)\]\s*=/g)) {
    for (const x of m[1].split(",")) local.add(x.trim());
  }
  for (const m of body.matchAll(/(?:const|let|function)\s+(\w+)/g)) local.add(m[1]);
  for (const m of body.matchAll(/\{([^}]*)\}\s*(?:=|\)\s*=>|\)\s*\{)/g)) {
    for (const x of m[1].split(",")) {
      const name = x.split(/[:=]/)[0].trim().replace(/^\.\.\./, "");
      if (/^\w+$/.test(name)) local.add(name);
    }
  }
  for (const m of body.matchAll(/\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    for (const x of m[1].split(",")) {
      const name = x.split(/[:=]/)[0].trim().replace(/^\.\.\./, "");
      if (/^\w+$/.test(name)) local.add(name);
    }
  }

  // setters called in this component
  // Browser globals that happen to match the set* shape.
  const GLOBALS = new Set(["setTimeout", "setInterval", "setImmediate"]);
  for (const m of body.matchAll(/(?<![.\w])(set[A-Z]\w*)\s*\(/g)) {
    const name = m[1];
    if (GLOBALS.has(name) || local.has(name) || moduleScope.has(name) || imported.has(name)) continue;
    const rel = body.slice(0, m.index).split("\n").length;
    problems.push({ component: b.name, name, line: b.start + rel });
  }
}

const seen = new Set();
const unique = problems.filter((p) => {
  const k = `${p.component}:${p.name}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

if (!unique.length) {
  console.log(`  ok    ${bounds.length} components, no state setter used outside its own`);
  process.exit(0);
}
console.error("  FAIL  state setter called in a component that does not own it:");
for (const p of unique) console.error(`          ${p.component} calls ${p.name}() (line ${p.line})`);
process.exit(1);
