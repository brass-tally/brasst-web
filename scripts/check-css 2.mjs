#!/usr/bin/env node
/**
 * Two checks on the stylesheet, both narrow on purpose.
 *
 * 1. Every custom class the app renders exists in index.css.
 * 2. The classes the layout actually depends on exist in BOTH files.
 *
 * The second one is here because of a real failure: a whole block of mobile
 * rules was written against `.inner`, the prototype's class name, and did
 * nothing in this app for a release. Nothing failed, because a stylesheet
 * cannot tell you it is aiming at an element that does not exist.
 *
 * A general "is this selector reached" check sounds better and is not: class
 * names arrive through template literals and conditionals, so it either misses
 * them or flags half the file. A short explicit list of the selectors that
 * carry the layout is boring, exact, and catches the thing that went wrong.
 *
 *   node scripts/check-css.mjs        (run from app/)
 */
import { readFileSync, readdirSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8");

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(`${dir}/${e.name}`) : (/\.jsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [])
);
const sources = walk("src").map((f) => readFileSync(f, "utf8"));
const jsx = sources.join("\n");

const defined = new Set([...css.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));

// class strings, from either quoting style
const used = new Set();
for (const m of jsx.matchAll(/className=(?:"([^"]*)"|\{[^}]*?["`]([^"`]*)["`])/g)) {
  for (const c of (m[1] || m[2] || "").split(/\s+/)) if (c) used.add(c.replace(/^[!-]+/, ""));
}

const TAILWIND = /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|truncate|w|h|p|m|mx|my|gap|text|bg|border|rounded|items|justify|space|min|max|mt|mb|ml|mr|pt|pb|pl|pr|px|py|top|left|right|bottom|inset|z|opacity|outline|cursor|select|whitespace|leading|tracking|font|underline|decoration|col|row|order|self|object|transition|animate|group|pointer|ring|shadow|divide|list|overflow|shrink|grow|basis|backdrop|tabular|aspect|place|content|origin|scale|rotate|translate|will|appearance|resize|snap|touch|scroll|break|line|indent|align|table|filter|blur|invert|sr|duration|ease|delay|placeholder|caret|accent|stroke|fill|antialiased|subpixel|isolate|mix)(-|$)/;
const COMPOUND = new Set(["dock-capture-icon", "dock-capture-badge", "dock-tip", "dock-btn", "skeleton-base", "skeleton-sheen"]);

const missing = [...used].filter(
  (c) => !defined.has(c) && !TAILWIND.test(c) && !COMPOUND.has(c) && !c.includes(":") && /-|^(dock|eyebrow|stagger|rv|skeleton)$/.test(c)
);

/* The selectors that carry the layout. If one of these is styled but not
   rendered, or rendered but not styled, the page silently loses its shape. */
const LOAD_BEARING = [
  "app-inner",      // the content column, and its safe-area padding
  "tally-frame",    // where Tally sits
  "tally-panel",    // and how tall it is
  "tally-composer", // the input clearing the home indicator
  "mini-line",      // the condensing figure bar
  "arap-panel",     // the AR/AP columns
  "arap-scroll",
  "budget-row",
  "capture-pop",
];
const unwired = LOAD_BEARING.filter((c) => !defined.has(c) || !used.has(c)).map(
  (c) => `${c} (${defined.has(c) ? "" : "no CSS rule"}${!defined.has(c) && !used.has(c) ? ", " : ""}${used.has(c) ? "" : "not rendered"})`
);

let failed = false;
if (missing.length) {
  failed = true;
  console.error("  FAIL  used in JSX but missing from index.css:");
  for (const c of missing) console.error(`          .${c}`);
}
if (unwired.length) {
  failed = true;
  console.error("  FAIL  load-bearing class not wired at both ends:");
  for (const c of unwired) console.error(`          .${c}`);
}
if (failed) process.exit(1);

console.log(`  ok    ${used.size} classes defined, ${LOAD_BEARING.length} load-bearing ones wired`);
