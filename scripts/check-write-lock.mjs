#!/usr/bin/env node
/**
 * Every database write asks the lock first.
 *
 * The read-only rule was enforced in the caller: the interface hid a reader's
 * buttons and each mutator returned early. Both were true and neither was
 * enough, because contacts, sharing and the invoice tray call their own
 * libraries directly and never pass a mutator. Each feature added another way
 * round, which is what enforcement in the caller always becomes.
 *
 * This checks the callee. An exported function that inserts, updates, upserts,
 * deletes or uploads must call assertWritable() first, or the build fails.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* Resolved against this file, not the working directory. npm runs it from
   app/, and the first version read paths relative to the repo root, so it
   threw ENOENT and the `&&` chain stopped: the four checks before it printed
   ok and this one never ran. A check that fails to run looks exactly like a
   check that passed. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const files = ["db.js", "contacts.js", "sharing.js", "bank.js"]
  .map((f) => join(ROOT, "app/src/lib", f));
/* Only a write through the client, not any method that shares a name.
   `stripOauthParams` calls searchParams.delete on a URL and was flagged by a
   looser pattern: a check that cries wolf gets switched off, so it has to be
   specific about what it is looking at. */
const WRITES = /(supabase|sb)\s*[\s\S]{0,200}?\.(insert|update|upsert|delete|upload)\s*\(|\.from\([^)]*\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\s*\(|storage[\s\S]{0,120}?\.(upload|remove)\s*\(/;

// Reads that happen to be named like writes, and functions that only compose
// other guarded calls.
const ALLOW = new Set(["setLedgerAccess", "loadAll"]);

const bad = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^export (?:async )?function (\w+)\(/);
    if (!m || ALLOW.has(m[1])) continue;
    let depth = 0, body = [];
    for (let j = i; j < lines.length; j++) {
      body.push(lines[j]);
      depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
      if (j > i && depth <= 0) break;
    }
    const text = body.join("\n");
    if (WRITES.test(text) && !text.includes("assertWritable()")) {
      bad.push(`${file.replace(ROOT + "/", "")}:${i + 1} ${m[1]}`);
    }
  }
}

if (bad.length) {
  console.error("  FAIL  a database write that does not ask the write lock:");
  for (const b of bad) console.error(`          ${b}`);
  console.error("        Add assertWritable() at the top, or a shared reader can change");
  console.error("        somebody else's books through this path.");
  process.exit(1);
}
console.log("  ok    every database write asks the lock first");
