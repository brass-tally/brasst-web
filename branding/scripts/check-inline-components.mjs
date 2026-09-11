#!/usr/bin/env node
/**
 * Components declared inside other components, that render an input.
 *
 * React compares component identity to decide between updating and
 * remounting. A component declared inside another is a new function on every
 * render, so it is always remounted, and an input inside it loses focus after
 * every character typed.
 *
 * This has happened twice on this project: a correction form inside Row, and
 * a field inside ContactsPage. Both looked fine, built fine, and were only
 * found by typing into them. Nothing else catches it, so this does.
 *
 * Only flags ones containing an input, textarea or select. A nested component
 * that renders a button is wasteful and harmless; one that renders a field is
 * broken.
 */
import { readFileSync } from "node:fs";

const file = process.argv[2] || "src/App.jsx";
const src = readFileSync(file, "utf8");
const lines = src.split("\n");

const bad = [];
// `  const Name = (` or `  const Name = ({`, indented, so inside something.
const decl = /^(\s+)const ([A-Z]\w*)\s*=\s*\(?\s*(\{[^}]*\}|\w*)\s*\)?\s*=>/;

for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(decl);
  if (!m) continue;
  const indent = m[1].length;
  if (indent === 0) continue;

  // read to the end of the declaration: the first line at or below this indent
  // that closes it
  let body = "";
  for (let j = i; j < Math.min(i + 120, lines.length); j++) {
    body += lines[j] + "\n";
    const l = lines[j];
    if (j > i && l.length && l.search(/\S/) <= indent && /^\s*\);?\s*$/.test(l)) break;
  }

  if (/<(input|textarea|select)\b/i.test(body)) {
    bad.push({ name: m[2], line: i + 1 });
  }
}

if (bad.length) {
  console.error("  FAIL  component declared inside another, containing a field:");
  for (const b of bad) {
    console.error(`          ${b.name} at line ${b.line}`);
  }
  console.error("        React remounts these every render, so the field loses focus");
  console.error("        after every keystroke. Move it to the top level.");
  process.exit(1);
}
console.log("  ok    no field-bearing component is declared inside another");
