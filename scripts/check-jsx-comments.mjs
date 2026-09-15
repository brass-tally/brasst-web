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

  /* And a comment standing where an element has to stand.
   *
   * `{cond && (` opens an expression that must produce exactly one element. A
   * comment there is a second expression, and the parser complains about the
   * element after it rather than the comment.
   *
   * Twice now, in two different files, and the reported line was never the
   * line at fault. */
  lines.forEach((line, i) => {
    if (!/\{\s*\/\*/.test(line.trim())) return;
    const before = (lines[i - 1] || "").trim();
    if (/(&&|\?|=>|\breturn)\s*\($/.test(before)) {
      bad.push([file, i + 1, "a comment where a single element must go"]);
    }
  });
}

if (bad.length) {
  /* Two faults, two remedies. One message covering both would tell half the
     readers to do the wrong thing. */
  console.error("  FAIL  a JSX comment is in the wrong shape or the wrong place:");
  for (const [f, n, t] of bad) console.error(`          ${relative(ROOT, f)}:${n}  ${t}`);
  console.error("        A comment must end */} and must not stand where a single");
  console.error("        element has to go: put it on the line above instead.");
  process.exit(1);
}
console.log("  ok    every JSX comment closes its own brace");
