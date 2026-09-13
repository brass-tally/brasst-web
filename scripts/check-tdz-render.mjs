#!/usr/bin/env node
/**
 * A value read during render, before it exists.
 *
 * `const a = useMemo(() => sums.inc, [sums])` placed above `const sums` is
 * valid JavaScript and crashes on mount: "Cannot access 'sums' before
 * initialization". It shipped, and the hand-written ordering check did not
 * see it because that check drops callback bodies, which is exactly where a
 * useMemo keeps its work.
 *
 * Rather than write a third regex, this leans on eslint's real scope
 * analysis: it runs `no-use-before-define` and keeps only the reports that
 * sit inside a useMemo or useState initialiser. Those run while the component
 * renders. Everything else is a handler referring to a later handler, which
 * is fine, because nothing calls it until the component is fully evaluated.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "app");
const target = process.argv[2] || "src";

let report = [];
try {
  const out = execFileSync(
    "npx",
    ["eslint", target, "--no-color", "--format", "json"],
    { cwd: APP, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  report = JSON.parse(out);
} catch (e) {
  // eslint exits non-zero when it finds problems; the JSON is still on stdout.
  try { report = JSON.parse(e.stdout || "[]"); } catch { report = []; }
}

const bad = [];
for (const file of report) {
  const hits = (file.messages || []).filter((m) => m.ruleId === "no-use-before-define");
  if (!hits.length) continue;
  const lines = readFileSync(file.filePath, "utf8").split("\n");

  for (const m of hits) {
    /* Walk back to whichever comes first: a hook initialiser, which runs now,
       or a handler, which does not. */
    let verdict = null;
    for (let i = m.line - 1; i >= Math.max(0, m.line - 300); i -= 1) {
      const t = lines[i];
      /* An effect runs after the component is evaluated, so anything inside
         one is safe however it looks. Checked before the hook initialiser
         test, because an effect body often sits below a useState line and the
         walk would otherwise attribute it to the wrong hook. */
      if (/useEffect\(/.test(t)) break;
      if (/=\s*use(Memo|State)\(/.test(t)) { verdict = t.trim(); break; }
      if (/=\s*(async\s*)?\(?[\w\s,{}]*\)?\s*=>/.test(t) && !/use(Memo|State)\(/.test(t)) break;
      if (/^\s*(function|const .* = function)/.test(t)) break;
    }
    if (verdict) {
      bad.push(`${relative(ROOT, file.filePath)}:${m.line}  ${m.message}\n            in ${verdict.slice(0, 70)}`);
    }
  }
}

if (bad.length) {
  console.error("  FAIL  a value is read during render before it exists:");
  for (const b of bad) console.error(`          ${b}`);
  console.error("        Move the declaration above the hook that reads it.");
  process.exit(1);
}
console.log("  ok    nothing is read during render before it exists");
