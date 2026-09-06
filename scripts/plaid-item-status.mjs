#!/usr/bin/env node
/**
 * Read-only Plaid Item health probe.
 *
 * Answers the one thing the database can't: WHY a connection stopped syncing.
 * `bank_connections` has no item-status column and there's no webhook handler,
 * so a broken Item leaves no trace except a frozen `last_synced`. This asks
 * Plaid directly via /item/get and prints `item.error`.
 *
 * Calls /item/get and /institutions/get_by_id only. Both are reads — this
 * cannot modify an Item, and it never touches the database.
 *
 * ---------------------------------------------------------------------------
 * Usage
 *
 *   1. Get the credentials (Supabase Dashboard -> Edge Functions -> Secrets,
 *      or the Plaid Dashboard):
 *
 *        export PLAID_CLIENT_ID=...
 *        export PLAID_SECRET=...
 *        export PLAID_ENV=production        # sandbox | development | production
 *
 *   2. Get the access tokens (SQL Editor). Treat these like passwords --
 *      they grant full access to the linked bank data. Do NOT paste them
 *      into chat, a ticket, or Slack:
 *
 *        select bc.institution, bc.ledger_id, bc.status, bc.access_token
 *        from public.bank_connections bc
 *        join public.ledgers l on l.id = bc.ledger_id
 *        where l.user_id = '<the affected user id>';
 *
 *   3. Prefer the env var over argv so the tokens stay out of shell history:
 *
 *        PLAID_ACCESS_TOKENS='access-production-aaa,access-production-bbb' \
 *          node scripts/plaid-item-status.mjs
 *
 *      (argv also works: `node scripts/plaid-item-status.mjs <token> <token>`)
 *
 * Output masks every token to an 8-char prefix, so the printed result is safe
 * to paste back.
 * ---------------------------------------------------------------------------
 */

const env = process.env.PLAID_ENV || "production";
const clientId = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_SECRET;

const tokens = (
  process.env.PLAID_ACCESS_TOKENS
    ? process.env.PLAID_ACCESS_TOKENS.split(",")
    : process.argv.slice(2)
)
  .map((t) => t.trim())
  .filter(Boolean);

if (!clientId || !secret) {
  console.error("Missing PLAID_CLIENT_ID / PLAID_SECRET. See the usage block at the top of this file.");
  process.exit(1);
}
if (!tokens.length) {
  console.error("No access tokens given. Set PLAID_ACCESS_TOKENS or pass them as arguments.");
  process.exit(1);
}

const mask = (t) => `${t.slice(0, 8)}...${t.slice(-4)}`;

async function plaid(path, payload) {
  const res = await fetch(`https://${env}.plaid.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, secret, ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  // A broken Item still returns 200 from /item/get with item.error populated.
  // Genuinely bad requests (revoked token, wrong env) come back non-2xx.
  return { ok: res.ok, status: res.status, body };
}

async function institutionName(id) {
  if (!id) return null;
  const { ok, body } = await plaid("/institutions/get_by_id", {
    institution_id: id,
    country_codes: ["CA", "US"],
  });
  return ok ? body?.institution?.name ?? null : null;
}

console.log(`\nPlaid Item status — env: ${env}\n${"=".repeat(60)}`);

for (const token of tokens) {
  console.log(`\ntoken        ${mask(token)}`);

  const { ok, status, body } = await plaid("/item/get", { access_token: token });

  if (!ok) {
    // The call itself failed: revoked token, wrong environment, or bad creds.
    console.log(`  REQUEST FAILED (HTTP ${status})`);
    console.log(`  error_code    ${body?.error_code ?? "?"}`);
    console.log(`  error_type    ${body?.error_type ?? "?"}`);
    console.log(`  message       ${body?.error_message ?? "?"}`);
    continue;
  }

  const item = body.item || {};
  const err = item.error;

  console.log(`  item_id       ${item.item_id ?? "?"}`);
  console.log(`  institution   ${(await institutionName(item.institution_id)) ?? item.institution_id ?? "?"}`);
  console.log(`  products      ${(item.billed_products || []).join(", ") || "none"}`);
  console.log(`  update_type   ${item.update_type ?? "?"}`);
  console.log(`  consent_expires ${item.consent_expiration_time ?? "(none set)"}`);
  console.log(`  last_webhook  ${body.status?.transactions?.last_successful_update ?? "n/a"}`);

  if (!err) {
    console.log(`  STATUS        healthy — no error on this Item`);
    continue;
  }

  console.log(`  STATUS        BROKEN`);
  console.log(`  error_code    ${err.error_code}`);
  console.log(`  error_type    ${err.error_type}`);
  console.log(`  message       ${err.error_message}`);
  if (err.display_message) console.log(`  user-facing   ${err.display_message}`);

  // The two codes that mean "the user must sign in again through Link in
  // update mode" -- i.e. exactly the fix this app is missing.
  if (["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION"].includes(err.error_code)) {
    console.log(`  -> needs Link update mode (create_link_token with access_token)`);
  }
}

console.log(`\n${"=".repeat(60)}\nDone. No data was modified.\n`);
