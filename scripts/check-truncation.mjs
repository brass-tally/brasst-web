#!/usr/bin/env node
/**
 * A rendered list that quietly drops rows.
 *
 * `rows.slice(0, 40).map(...)` in a detail view is a partial answer wearing
 * the appearance of a complete one. It shipped in the figure trail, hid
 * sixteen bank lines, and was found by a person reading a statement against
 * the screen rather than by anything here.
 *
 * The rule: a slice feeding a render is allowed only when the code
 * immediately says how many were left out. Either show everything, or say
 * what you are not showing.
 *
 * Not a style rule. Every instance of this is a number somebody may act on
 * being smaller than the truth, with nothing on screen to say so.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = (process.argv.slice(2).length ? process.argv.slice(2) : ["app/src/App.jsx"])
  .map((f) => (f.startsWith("/") ? f : join(ROOT, f)));

// .slice(0, N) or .slice(0, someLimit) immediately followed by .map(
const SLICED_RENDER = /\.slice\(\s*0\s*,\s*[^)]+\)\s*\.map\(/g;

const bad = [];
for (const file of files) {
  /* Comments are blanked for finding the slices, because a slice inside an
     example in a comment is not code. But the allowance is written in a
     comment, so the window is read from the raw file.

     I had both reading the stripped copy, which meant the escape hatch was
     invisible to the check that offers it. */
  const raw = readFileSync(file, "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lines = raw.split("\n");

  let m;
  while ((m = SLICED_RENDER.exec(src))) {
    const at = src.slice(0, m.index).split("\n").length;
    /* The window below is where an honest one puts its remainder: a length
       comparison, a "more" label, or an explicit allowance. */
    /* Look behind as well as ahead. A section headed "Uncleared (137)" has
       already told you what it holds, and the count above the list is as
       honest as a note below it. */
    const rawWindow = lines.slice(Math.max(0, at - 8), at + 14).join("\n");
    // Prose cannot satisfy the rule, so the code window has comments removed.
    const codeWindow = src.split("\n").slice(Math.max(0, at - 8), at + 14).join("\n");
    /* Only two things count as admitting it, and neither is prose.

       I first accepted the word "more" anywhere nearby, and then wrote a
       comment explaining the fix that happened to contain it, which switched
       the check off at the exact place it had just caught something. A
       correctness check that can be satisfied by writing about correctness is
       not one.

       So: a length comparison rendered near the list, which is code that puts
       the remainder on screen, or the explicit marker. */
    const admitsInCode = /\{[^}]*\.length\s*[>-]/.test(codeWindow) ||
      /\.length\s*>\s*\w+\s*&&/.test(codeWindow) ||
      /\bof\s*\{[^}]*\.length/.test(codeWindow);
    const marked = /truncation-ok/.test(rawWindow);
    const admits = admitsInCode || marked;
    if (!admits) bad.push(`${relative(ROOT, file)}:${at}  ${m[0].trim()}`);
  }
}

if (bad.length) {
  console.error("  FAIL  a rendered list drops rows without saying so:");
  for (const b of bad) console.error(`          ${b}`);
  console.error("        Show every row, or say how many are missing beside it.");
  console.error("        If the cap is deliberate and stated elsewhere, mark it `truncation-ok`.");
  process.exit(1);
}
console.log("  ok    no rendered list drops rows silently");
