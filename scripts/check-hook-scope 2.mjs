#!/usr/bin/env node
/**
 * A hook that reads a value declared below it, in the same component.
 *
 * `const a = useMemo(() => f(b), [b])` above `const b` crashes on render with
 * "Cannot access 'b' before initialization", and the whole app fails rather
 * than one section. It has now happened twice.
 *
 * eslint's no-use-before-define sees this but cannot tell a reference that
 * runs during render from one inside a handler that runs later, and the file
 * has 45 of the harmless kind. So this narrows to the case that crashes:
 * a top-level useMemo or useCallback in a component, reading a name declared
 * further down that component's own body. The dependency array counts, because
 * it is evaluated immediately too.
 *
 * Comments are stripped first. Two earlier checks were fooled by prose that
 * happened to contain the right words, and a check that can be satisfied or
 * broken by a comment is not measuring the code.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = (process.argv.slice(2).length ? process.argv.slice(2) : ["app/src/App.jsx"])
  .map((f) => (f.startsWith("/") ? f : join(ROOT, f)));

const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(Math.max(0, m.length - p.length)));

const bad = [];
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const lines = strip(raw).split("\n");

  const starts = [];
  lines.forEach((l, i) => {
    const m = /^function ([A-Z]\w+)\(/.exec(l);
    if (m) starts.push([i, m[1]]);
  });

  starts.forEach(([start, name], idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1][0] : lines.length;
    const body = lines.slice(start, end);

    // Names declared at the top level of this component, and where.
    const declared = new Map();
    body.forEach((l, n) => {
      const m = /^ {2}(?:const|let) (?:\[)?(\w+)/.exec(l);
      if (m && !declared.has(m[1])) declared.set(m[1], n);
    });

    /* Helpers defined at the top level of the component, and their bodies.
     *
     * The crash that prompted this was one hop away: a memo called a small
     * helper, and the helper read a value declared further down. Looking only
     * at the hook's own text found nothing, because the hook's own text was
     * innocent. One level of indirection is where these hide, so it is
     * followed. */
    const helpers = new Map();
    body.forEach((l, n) => {
      const h = /^ {2}const (\w+) = (?:async )?\(?[\w\s,{}]*\)?\s*=>/.exec(l);
      if (!h) return;
      let k = n + 1;
      for (; k < body.length; k += 1) {
        if (/^ {2}(const|let|return|function) /.test(body[k])) break;
      }
      helpers.set(h[1], body.slice(n, k).join("\n"));
    });

    body.forEach((l, n) => {
      /* useEffect counts, for its dependency array alone.
       *
       * The body runs after the component is evaluated, so a name read inside
       * it is safe however it looks. The array is different: it is an ordinary
       * expression, evaluated during render, and reading a value declared
       * below it crashes the page exactly like a memo would.
       *
       * I excluded effects entirely on the grounds that they run later, which
       * is true of the half that does not matter. */
      const m = /^ {2}const (\w+) = use(?:Memo|Callback)\(/.exec(l)
        || (/^ {2}useEffect\(/.test(l) ? ["", "an effect"] : null);
      if (!m) return;
      /* Bounded by the next top-level statement, not by parentheses alone.
       *
       * Counting brackets overran the end of the hook and swallowed the very
       * declaration that follows it, so every memo appeared to read the name
       * declared on the next line. Five false alarms from one loose edge. */
      let k = n + 1;
      for (; k < body.length; k += 1) {
        /* A hook ends at its own closing line, which is `}` followed by its
         * dependency array. Without this the scan ran to the next top-level
         * statement, swallowed everything between, and then read some later
         * hook's array as though it belonged to this one: the check passed a
         * file that crashed on load. */
        if (/^ {2}\}\s*,\s*\[/.test(body[k]) || /^ {2}\}\s*\)\s*;/.test(body[k])) { k += 1; break; }
        if (/^ {2}(const|let|return|function) /.test(body[k])) break;
      }
      /* Property names are not references.
       *
       * `out.push(x)` matched the local named `push` and reported a crash that
       * cannot happen: a member access reads a property of an object, not a
       * binding in scope. Same for object keys. */
      const isEffect = m[1] === "an effect";
      const raw = body.slice(n, k).join("\n");
      /* Everything between `}, [` and `]);` is what runs now. */
      const deps = (raw.match(/\}\s*,\s*\[([^\]]*)\]/) || [])[1] || "";
      const chunk = (isEffect ? deps : raw)
        .replace(/\.\s*\w+/g, ".")
        .replace(/\b\w+\s*:/g, ":");
      // Anything the hook calls, brought in so its reads count as the hook's.
      let widened = chunk;
      if (!isEffect) {
        for (const [hname, hbody] of helpers) {
          if (new RegExp(`\\b${hname}\\s*\\(`).test(chunk)) widened += "\n" + hbody;
        }
      }

      for (const ident of new Set(widened.match(/\b[a-zA-Z_]\w*\b/g) || [])) {
        const at = declared.get(ident);
        if (at != null && at > n) {
          bad.push(
            `${relative(ROOT, file)}:${start + n + 1}  ${m[1]} reads ${ident}, ` +
            `declared on line ${start + at + 1}`,
          );
        }
      }
    });
  });
}

if (bad.length) {
  console.error("  FAIL  a hook reads a value declared below it:");
  for (const b of bad) console.error(`          ${b}`);
  console.error("        Move the declaration above the hook, or read the prop it comes from.");
  process.exit(1);
}
console.log("  ok    no hook reads a value declared below it in its component");
