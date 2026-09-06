#!/usr/bin/env node
/**
 * QA for the marketing site. Structure, links, forms, and a WCAG pass over
 * both themes. Exits non-zero on anything blocking.
 *   node qa.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const s = readFileSync("index.html", "utf8");
let bad = 0, warn = 0;
const fail = (m, d) => { bad++; console.error(`  FAIL  ${m}${d ? `\n        ${d}` : ""}`); };
const note = (m) => { warn++; console.warn(`  warn  ${m}`); };
const ok = (m) => console.log(`  ok    ${m}`);
const head = (m) => console.log(`\n${m}\n${"-".repeat(m.length)}`);

head("Structure");
const markup = s.slice(0, s.indexOf('<script type="module">'));
const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dupes = [...new Set(ids.filter((i) => ids.filter((x) => x === i).length > 1))];
dupes.length ? fail(`duplicate ids: ${dupes.join(", ")}`) : ok(`${ids.length} unique element ids`);

const js = s.slice(s.indexOf('<script type="module">'));
const looked = [...new Set([...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]))];
const ghosts = looked.filter((t) => !ids.includes(t));
ghosts.length ? fail(`script looks up missing elements: ${ghosts.join(", ")}`)
              : ok(`${looked.length} element lookups all resolve`);

head("Links and assets");
const anchors = [...new Set([...s.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]))];
const broken = anchors.filter((a) => !new RegExp(`id="${a}"`).test(s));
broken.length ? fail(`anchors with no target: ${broken.join(", ")}`) : ok(`${anchors.length} in-page anchors resolve`);

const assets = [...new Set([...s.matchAll(/(?:href|src)="\/([\w.-]+\.(?:png|ico|webmanifest))"/g)].map((m) => m[1]))];
const missing = assets.filter((f) => !existsSync(f));
missing.length ? fail(`referenced but not in the repo: ${missing.join(", ")}`)
               : ok(`${assets.length} local assets present`);
/href="\/app"/.test(s) ? ok("app links point at /app, the sibling service") : note("no link into the app");

head("Sign-in");
const forms = (s.match(/data-magic/g) || []).length - 1;   // one is the querySelectorAll
forms >= 2 ? ok(`${forms} magic-link forms wired`) : fail(`expected 2 sign-in forms, found ${forms}`);
/signInWithOtp/.test(s) ? ok("uses signInWithOtp") : fail("sign-in call missing");
/sb_secret|service_role|sk-ant/.test(s) ? fail("a server-side secret is in the page") : ok("no server-side secrets");
/emailRedirectTo/.test(s) ? ok("sign-in redirects back into the app") : fail("no emailRedirectTo, the link would land nowhere");

head("Theme");
/localStorage.getItem\("bt-theme"\)/.test(s) ? ok("reads the theme key shared with the app") : fail("theme key missing");
/data-t", t === "dark" \? "dark" : "light"/.test(s)
  ? ok("everyone starts on light, dark is a stored choice")
  : note("check the default theme logic");
/localStorage.setItem\("bt-palette/.test(s) ? fail("the site is writing a palette nobody chose") : ok("does not seed a palette");

head("House rules");
s.includes("\u2014") ? fail("em dashes present") : ok("no em dashes");
/<meta name="description"/.test(s) ? ok("meta description present") : note("no meta description");
/<html lang=/.test(s) ? ok("document language set") : fail("no lang attribute");
console.log(`  ok    ${(s.length / 1024).toFixed(1)} KB, single file, no build step`);

head("Production");
for (const [f, why] of [["robots.txt", "crawlers need direction"],
                        ["sitemap.xml", "listed in robots.txt"],
                        ["og-image.png", "referenced by og:image"],
                        ["vercel.json", "security headers live here"]]) {
  existsSync(f) ? ok(`${f} present`) : fail(`${f} missing, ${why}`);
}
/rel="canonical"/.test(s) ? ok("canonical url set") : fail("no canonical url");
/property="og:image"/.test(s) ? ok("open graph image set") : fail("no og:image, links will preview bare");
/application\/ld\+json/.test(s) ? ok("structured data present") : note("no structured data");
if (existsSync("vercel.json")) {
  const v = readFileSync("vercel.json", "utf8");
  for (const h of ["X-Content-Type-Options", "Referrer-Policy", "Strict-Transport-Security"]) {
    v.includes(h) ? ok(`${h} header set`) : fail(`${h} header missing`);
  }
}
if (existsSync("robots.txt")) {
  const r = readFileSync("robots.txt", "utf8");
  /Disallow: \/app/.test(r) ? ok("the app path is kept out of the index") : note("app path is crawlable");
  /Sitemap:/.test(r) ? ok("sitemap declared") : note("no sitemap line");
}

head("Contrast, both themes");
const lum = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};
const FLOOR = { text: 4.5, muted: 4.5, credit: 4.5, debit: 4.5, accentText: 4.5, faint: 3.0 };
let themes = 0;
for (const m of s.matchAll(/html\[data-t="(\w+)"\]\{([\s\S]*?)\n\}/g)) {
  const [, mode, body] = m;
  const tok = Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((x) => [x[1], x[2]]));
  if (!tok.surface) continue;
  themes++;
  for (const [k, floor] of Object.entries(FLOOR)) {
    if (!tok[k]) continue;
    const r = ratio(tok[k], tok.surface);
    if (r < floor) fail(`${mode}: ${k} is ${r}:1 on surface, needs ${floor}`);
  }
  const label = ratio(tok.onAccent, tok.accent);
  if (label < 4.5) fail(`${mode}: button label is ${label}:1 on the fill, needs 4.5`);
}
ok(`${themes} themes audited`);

console.log(`\n${"=".repeat(52)}`);
if (bad) { console.error(`FAILED  ${bad} blocking, ${warn} warnings`); process.exit(1); }
console.log(`PASSED  ${warn} warning${warn === 1 ? "" : "s"}`);
