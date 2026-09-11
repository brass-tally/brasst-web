#!/usr/bin/env node
/**
 * Props left outside the destructuring brace.
 *
 * React calls a component with one argument. A signature like
 *
 *   function Capture({ data, month }, contacts = [], resetAt = 0) {
 *
 * compiles, builds, runs, and silently uses the defaults forever, because
 * nothing is ever passed as a second argument. Nothing throws and nothing
 * warns.
 *
 * This is how Tally came to say there was no email on file for a contact whose
 * email was on the screen behind her: the prop was passed at the call site,
 * read in the body, and never arrived.
 *
 * The quietest failures deserve the loudest checks.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = (process.argv.slice(2).length ? process.argv.slice(2) : ["app/src/App.jsx"])
  .map((f) => (f.startsWith("/") ? f : join(ROOT, f)));

const bad = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const re = /^(?:export )?function ([A-Z]\w*)\(([\s\S]{0,1200}?)\)\s*\{/gm;
  let m;
  while ((m = re.exec(src))) {
    const [, name, params] = m;
    if (!params.includes("{")) continue;          // positional args, not a component
    const after = params.slice(params.lastIndexOf("}") + 1).trim().replace(/^,/, "").trim();
    if (after) {
      bad.push(`${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length} ${name} -> ${after.slice(0, 60)}`);
    }
  }
}

if (bad.length) {
  console.error("  FAIL  props outside the destructuring brace:");
  for (const b of bad) console.error(`          ${b}`);
  console.error("        React passes one object. These will always be their defaults.");
  process.exit(1);
}
console.log("  ok    every component takes one destructured props object");
