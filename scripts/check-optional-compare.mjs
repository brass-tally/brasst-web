#!/usr/bin/env node
/**
 * Two optional chains compared with each other.
 *
 *   correcting?.id === row.invoice?.id
 *
 * When both sides are absent this is `undefined === undefined`, which is
 * true. So a branch meant for "this is the one being edited" fires for every
 * row that has nothing, and the body then reads a property off null.
 *
 * That shipped, crashed a whole section, and passed six checks and a linter,
 * because every line of it is valid and the mistake is in what the values
 * mean rather than in what they are.
 *
 * One optional side is fine: comparing `a?.id` with a definite `b.id` cannot
 * be accidentally true, because `b.id` exists. Both sides optional is the
 * trap.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = (process.argv.slice(2).length ? process.argv.slice(2) : ["app/src/App.jsx"])
  .map((f) => (f.startsWith("/") ? f : join(ROOT, f)));

// left?.x === right?.y, either side allowed leading whitespace
const BOTH = /(\w+)\?\.(\w+)\s*(===|!==|==|!=)\s*([\w.]+)\?\.(\w+)/g;

const bad = [];
for (const file of files) {
  const src = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  let m;
  while ((m = BOTH.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    bad.push(`${relative(ROOT, file)}:${line}  ${m[0]}`);
  }
}

if (bad.length) {
  console.error("  FAIL  both sides of a comparison are optional:");
  for (const b of bad) console.error(`          ${b}`);
  console.error("        When both are absent this is undefined === undefined, which is true.");
  console.error("        Guard the object first: `row.invoice && a?.id === row.invoice.id`.");
  process.exit(1);
}
console.log("  ok    no comparison can be true because both sides are missing");
