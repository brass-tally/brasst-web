#!/usr/bin/env node
/**
 * Every custom class the app renders must exist in the stylesheet.
 *
 * Editing a stylesheet by slicing text is how three Tally rules vanished
 * without the build noticing. CSS has no imports to break, so a missing rule is
 * silent: it shows up as an unstyled element in production and nowhere else.
 *
 *   node scripts/check-css.mjs        (run from app/)
 */
import { readFileSync, readdirSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8");
let jsx = readFileSync("src/App.jsx", "utf8");
for (const f of readdirSync("src/shell")) jsx += readFileSync(`src/shell/${f}`, "utf8");

const defined = new Set([...css.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));

// Every class string this project writes, from either quoting style.
const used = new Set();
for (const m of jsx.matchAll(/className=(?:"([^"]*)"|\{[^}]*?["`]([^"`]*)["`])/g)) {
  for (const c of (m[1] || m[2] || "").split(/\s+/)) {
    if (c) used.add(c.replace(/^[!-]+/, ""));   // Tailwind's important and negative prefixes
  }
}

// Tailwind generates its own; only this project's own names are checked.
const TAILWIND = /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|truncate|w|h|p|m|mx|my|gap|text|bg|border|rounded|items|justify|space|min|max|mt|mb|ml|mr|pt|pb|pl|pr|px|py|top|left|right|bottom|inset|z|opacity|outline|cursor|select|whitespace|leading|tracking|font|underline|decoration|col|row|order|self|object|transition|animate|group|pointer|ring|shadow|divide|list|overflow|shrink|backdrop|tabular|aspect|place|content|origin|scale|rotate|translate|will|appearance|resize|snap|touch|scroll|break|line|indent|align|table|filter|blur|invert)(-|$)/;

// Styled through a compound selector rather than a rule of their own.
const COMPOUND = new Set(["dock-capture-icon", "dock-capture-badge", "dock-tip", "dock-btn"]);

const missing = [...used].filter(
  (c) => !defined.has(c) && !TAILWIND.test(c) && !COMPOUND.has(c) && !c.includes(":") && /-|^(dock|eyebrow|stagger|rv|skeleton)$/.test(c)
);

if (!missing.length) {
  console.log(`  ok    ${used.size} classes checked, every custom one is defined`);
  process.exit(0);
}
console.error("  FAIL  used in JSX but missing from index.css:");
for (const c of missing) console.error(`          .${c}`);
process.exit(1);
