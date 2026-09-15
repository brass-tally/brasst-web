#!/usr/bin/env node
/**
 * A JSX comment opened with `{` and closed without one.
 *
 * `{/* ... *\/` instead of `{/* ... *\/}` leaves a brace open, and the next
 * element is swallowed into an expression that never closes. The parser then
 * reports a confusing error dozens of lines later, at whatever finally made no
 * sense.
 *
 * I have done this three times in one file, twice in a single session, and
 * each time it cost a round: eslint's message points at the symptom rather
 * than the cause, and the build's own failure line is buried under the
 * linter's summary.
 *
 * This names the line that is actually wrong.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = (process.argv.slice(2).length ? process.argv.slice(2) : ["app/src/App.jsx"])
  .map((f) => (f.startsWith("/") ? f : join(ROOT, f)));

const bad = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  let openedAt = -1;

  lines.forEach((line, i) => {
    const t = line.trim();
    // A comment that both opens and closes on one line is its own business.
    if (openedAt < 0 && /\{\s*\/\*/.test(t)) {
      if (/\*\/\s*\}/.test(t)) return;
      if (/\*\//.test(t)) { bad.push([file, i + 1, t.slice(0, 60)]); return; }
      openedAt = i;
      return;
    }
    if (openedAt >= 0 && /\*\//.test(t)) {
      if (!/\*\/\s*\}/.test(t)) bad.push([file, i + 1, t.slice(0, 60)]);
      openedAt = -1;
    }
  });

  if (openedAt >= 0) bad.push([file, openedAt + 1, "never closed"]);
}

if (bad.length) {
  console.error("  FAIL  a JSX comment opens with { and closes without }:");
  for (const [f, n, t] of bad) console.error(`          ${relative(ROOT, f)}:${n}  ${t}`);
  console.error("        End the comment with */} so the expression closes.");
  process.exit(1);
}
console.log("  ok    every JSX comment closes its own brace");
