#!/usr/bin/env node
/**
 * Temporal dead zone check, narrow on purpose.
 *
 * `const` is hoisted but not initialised, so reading one above its declaration
 * throws at runtime and compiles perfectly. It has bitten this codebase twice:
 * a page component referenced by an array built above it, and a hook reading
 * three values declared below it. A build cannot see either.
 *
 * This checks only the case that caused both: a hook call whose arguments are
 * evaluated immediately. Identifiers inside callbacks are ignored, because
 * those run later and reading a later const from one is legal. Narrow beats
 * thorough here: a check that cries wolf gets switched off.
 *
 *   node scripts/check-tdz.mjs app/src/App.jsx
 */
import { readFileSync } from "node:fs";

const file = process.argv[2] || "app/src/App.jsx";
const lines = readFileSync(file, "utf8").split("\n");

const problems = [];
let scope = new Map();   // name -> line index, for the component being read
let fnStart = 0;

const topLevel = (l) => /^(export\s+)?(async\s+)?(function|const|let|class)\s/.test(l);

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (topLevel(l)) { scope = new Map(); fnStart = i; }

  const decl = l.match(/^ {2}const\s+(\w+)\s*=/);

  // a hook call at component scope: its arguments run now, not later
  const hook = l.match(/^ {2}const\s+\w+\s*=\s*(use[A-Z]\w*)\s*\(/) || l.match(/^ {2}(useEffect|useMemo|useLayoutEffect)\s*\(/);
  if (hook) {
    let depth = 0, body = "";
    for (let j = i; j < lines.length; j++) {
      body += lines[j] + "\n";
      depth += (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length;
      if (depth <= 0) break;
    }
    // drop callback bodies: anything from an arrow or function to the end of its line
    const immediate = body.replace(/=>[\s\S]*?(?=\n)/g, "").replace(/function\s*\([^)]*\)[\s\S]*?(?=\n)/g, "");
    for (const m of immediate.matchAll(/(^|[^\w.$'"`])(\w+)(?=[,\s}\)])/g)) {
      const name = m[2];
      const later = laterDecl(name, i);
      if (later != null) problems.push({ name, usedAt: i + 1, declaredAt: later + 1, code: l.trim().slice(0, 66) });
    }
  }

  if (decl) scope.set(decl[1], i);
}

function laterDecl(name, fromLine) {
  for (let j = fromLine + 1; j < lines.length; j++) {
    if (topLevel(lines[j])) return null;                       // left the component
    if (new RegExp(`^ {2}const\\s+${name}\\s*=`).test(lines[j])) return j;
  }
  return null;
}

const seen = new Set();
const unique = problems.filter((p) => {
  const k = `${p.name}:${p.usedAt}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

if (!unique.length) {
  console.log("  ok    no hook reads a value declared below it");
  process.exit(0);
}
console.error(`  FAIL  ${unique.length} value(s) read before initialisation:\n`);
for (const p of unique) {
  console.error(`        ${p.name}: read on line ${p.usedAt}, declared on line ${p.declaredAt}`);
  console.error(`          ${p.code}\n`);
}
process.exit(1);
