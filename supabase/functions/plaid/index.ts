// Plaid proxy: keys stay server-side, the browser only ever sees link tokens.
// Secrets required: PLAID_CLIENT_ID, PLAID_SECRET, optional PLAID_ENV (sandbox | development | production)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type PlaidError = Error & { code?: string | null };

// Codes that no amount of retrying clears: the bank has dropped the session and
// only the user signing in again through Link update mode can restore it.
const NEEDS_REAUTH = ["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT"];
const statusFor = (code?: string | null) =>
  !code ? "ok" : NEEDS_REAUTH.includes(code) ? "login_required" : "error";

/** Snapshot depository balances; credit cards are excluded from the cash total. */
function snapshotBalances(accounts: any[]) {
  const balances = (accounts || []).map((a) => ({
    account_id: a.account_id,
    name: a.name || a.official_name || "Account",
    mask: a.mask || null,
    type: a.type || null,
    subtype: a.subtype || null,
    current: a.balances?.current ?? null,
    available: a.balances?.available ?? null,
  }));
  const depository = balances.filter(
    (b) => b.type === "depository" && b.current != null && !Number.isNaN(Number(b.current)),
  );
  // Rounded: summing floats stores things like 274.48999999999995 into a
  // numeric column, which then shows up as a phantom one-cent reconciliation gap.
  const current_balance = depository.length
    ? Math.round(depository.reduce((s, b) => s + Number(b.current), 0) * 100) / 100
    : null;
  return { balances, current_balance, balance_as_of: new Date().toISOString() };
}

function makePlaid(base: string, creds: { client_id?: string; secret?: string }) {
  return async (path: string, payload: Record<string, unknown>) => {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...creds, ...payload }),
    });
    const d = await r.json();
    if (!r.ok) {
      const err = new Error(d.error_message || d.error_code || "Plaid error") as PlaidError;
      err.code = d.error_code || null;
      throw err;
    }
    return d;
  };
}

/**
 * Drain /transactions/sync for one connection and store the result. Shared by
 * the user-triggered "sync" action and the nightly cron_sync_all sweep, so a
 * scheduled refresh behaves identically to pressing "Sync now".
 */
async function syncOne(
  supabase: ReturnType<typeof createClient>,
  plaid: ReturnType<typeof makePlaid>,
  conn: Record<string, any>,
) {
  const markStatus = async (connectionId: string, code: string | null, message: string | null) => {
    await supabase.from("bank_connections").update({
      status: statusFor(code),
      status_code: code,
      status_error: message,
      status_at: new Date().toISOString(),
    }).eq("id", connectionId);
  };

  const fetchAndStoreBalances = async (connectionId: string, accessToken: string) => {
    const acct = await plaid("/accounts/get", { access_token: accessToken });
    const snap = snapshotBalances(acct.accounts || []);
    await supabase.from("bank_connections").update({
      current_balance: snap.current_balance,
      balance_as_of: snap.balance_as_of,
      accounts: snap.balances,
    }).eq("id", connectionId);
    return snap;
  };

  // Drain every page first, holding the new cursor locally. Nothing is
  // committed until the rows below are stored: if a write fails we throw
  // with the OLD cursor still on the connection, and the next sync replays
  // the same lines. The (connection_id, plaid_txn_id) unique key makes that
  // replay idempotent.
  let cursor = conn.cursor || undefined;
  const added: any[] = [], modified: any[] = [], removed: any[] = [];
  let hasMore = true, guard = 0;
  try {
    while (hasMore && guard < 20) {
      const d = await plaid("/transactions/sync", { access_token: conn.access_token, cursor, count: 250 });
      added.push(...(d.added || []));
      modified.push(...(d.modified || []));
      removed.push(...(d.removed || []));
      cursor = d.next_cursor; hasMore = d.has_more; guard += 1;
    }
  } catch (e) {
    // Persist the reason before rethrowing. Otherwise a dropped sign-in is
    // invisible in the data, last_synced simply stops moving, and only
    // whoever happens to read the table ever finds out.
    const code = (e as PlaidError).code || null;
    await markStatus(conn.id, code, String((e as Error).message || e));
    throw e;
  }

  const now = new Date().toISOString();
  // Plaid convention: positive amount = money leaving the account
  //
  // user_id is set explicitly rather than left to its `default auth.uid()`:
  // cron_sync_all runs as the service role with no signed-in user, so the
  // default would insert null and violate the not-null constraint. conn's
  // own user_id (set correctly when the connection was created) is the
  // right owner for every row synced under it either way.
  const toRow = (t: any) => ({
    user_id: conn.user_id,
    ledger_id: conn.ledger_id,
    connection_id: conn.id,
    plaid_txn_id: t.transaction_id,
    account_id: t.account_id || null,
    date: t.date,
    amount: Math.abs(Number(t.amount)),
    direction: Number(t.amount) > 0 ? "debit" : "credit",
    description: t.merchant_name || t.name || "Bank transaction",
    pending: Boolean(t.pending),
    updated_at: now,
  });

  // Upserting only these columns leaves status/matched_tx_id untouched, so a
  // line the user already reconciled survives the bank restating it.
  const rows = [...added, ...modified]
    .filter((t) => t?.transaction_id && t?.date)
    .map(toRow);
  for (let i = 0; i < rows.length; i += 200) {
    const { error: upErr } = await supabase
      .from("bank_transactions")
      .upsert(rows.slice(i, i + 200), { onConflict: "connection_id,plaid_txn_id" });
    if (upErr) throw upErr;
  }

  // A restated or reversed line that was already matched is the one case
  // where a settled reconciliation silently goes wrong. Flag those.
  const modifiedIds = modified.map((t) => t?.transaction_id).filter(Boolean);
  if (modifiedIds.length) {
    const { error: modErr } = await supabase.from("bank_transactions")
      .update({ review_reason: "the bank restated this line after it was matched" })
      .eq("connection_id", conn.id).eq("status", "matched").in("plaid_txn_id", modifiedIds);
    if (modErr) throw modErr;
  }

  const removedIds = removed.map((t) => t?.transaction_id).filter(Boolean);
  if (removedIds.length) {
    const { error: remErr } = await supabase.from("bank_transactions")
      .update({ removed_at: now, review_reason: "the bank reversed or withdrew this line" })
      .eq("connection_id", conn.id).in("plaid_txn_id", removedIds);
    if (remErr) throw remErr;
  }

  // Everything is durable: only now is it safe to move the cursor past it.
  // A sync that got this far proves the Item is healthy, so clear any stale
  // failure recorded against it in the same write.
  const { error: curErr } = await supabase.from("bank_connections")
    .update({
      cursor, last_synced: now,
      status: "ok", status_code: null, status_error: null, status_at: now,
    }).eq("id", conn.id);
  if (curErr) throw curErr;

  let snap = { balances: [] as ReturnType<typeof snapshotBalances>["balances"], current_balance: null as number | null, balance_as_of: null as string | null };
  try {
    snap = await fetchAndStoreBalances(conn.id, conn.access_token);
  } catch (e) {
    console.error("balances after sync:", e);
  }
  return {
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    balances: snap.balances,
    current_balance: snap.current_balance,
    balance_as_of: snap.balance_as_of,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { action, ...body } = await req.json();

    /* Plaid telling us something happened, rather than us asking.
     *
     * We polled once a day, which meant a transaction could sit in Plaid for
     * twenty-three hours before this application knew about it. A webhook
     * fires the moment Plaid has something, and the sync runs then.
     *
     * This is as close to live as anybody can get. It does not make a bank
     * release its data sooner: Plaid can only tell us what the bank has given
     * it, so if RBC holds a transfer for a day, the webhook arrives a day
     * later and is still instant with respect to the thing it is reporting.
     *
     * No session here, because Plaid has none. The item_id is the credential:
     * it is issued by Plaid, stored by us, and a caller who does not know one
     * cannot cause any work to happen.
     */
    if (body.webhook_type || body.webhook_code) {
      const itemId = String(body.item_id || "");
      const code = String(body.webhook_code || "");
      const type = String(body.webhook_type || "");
      if (!itemId) return json({ ok: true, ignored: "no item" });

      const { data: conn } = await supabase
        .from("bank_connections").select("*").eq("item_id", itemId).maybeSingle();
      if (!conn) return json({ ok: true, ignored: "unknown item" });

      if (type === "TRANSACTIONS" && (code === "SYNC_UPDATES_AVAILABLE" || code === "DEFAULT_UPDATE" || code === "INITIAL_UPDATE" || code === "HISTORICAL_UPDATE")) {
        const result = await syncOne(supabase, plaid, conn);
        return json({ ok: true, synced: result.added });
      }

      /* A sign-in that has expired, or is about to. Recorded rather than
         acted on: reconnecting needs the person, and knowing early is what
         lets the app say so before a figure goes stale. */
      if (type === "ITEM" && (code === "ERROR" || code === "PENDING_EXPIRATION" || code === "USER_PERMISSION_REVOKED" || code === "LOGIN_REPAIRED")) {
        const errCode = code === "LOGIN_REPAIRED" ? null : (body.error?.error_code || code);
        await markStatus(conn.id, errCode, body.error?.error_message || null);
        return json({ ok: true, status: errCode || "ok" });
      }

      return json({ ok: true, ignored: `${type}/${code}` });
    }
    const env = Deno.env.get("PLAID_ENV") || "sandbox";
    const base = `https://${env}.plaid.com`;
    const creds = { client_id: Deno.env.get("PLAID_CLIENT_ID"), secret: Deno.env.get("PLAID_SECRET") };
    if (!creds.client_id || !creds.secret) return json({ error: "Plaid keys are not configured yet" }, 400);

    // The nightly autorefresh has no signed-in user, pg_cron calls this action
    // with a shared secret instead of a user JWT, so it needs the service-role
    // client (bypasses RLS) rather than the per-request anon client below.
    if (action === "cron_sync_all") {
      const cronSecret = Deno.env.get("CRON_SECRET");
      if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
        return json({ error: "Not authorized" }, 401);
      }

      // pg_cron has no DST-aware scheduling, so it ticks hourly and leaves the
      // "is it actually 8am Eastern right now" check to us. Every other hour
      // this is a fast no-op.
      if (typeof body.only_if_hour_ny === "number") {
        const nyHour = Number(
          new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date()),
        );
        if (nyHour !== body.only_if_hour_ny) return json({ skipped: true, nyHour });
      }

      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const plaid = makePlaid(base, creds);
      const { data: conns, error } = await admin.from("bank_connections").select("*");
      if (error) throw error;

      const results: Array<Record<string, unknown>> = [];
      for (const conn of conns || []) {
        try {
          const r = await syncOne(admin, plaid, conn);
          results.push({ id: conn.id, ok: true, ...r });
        } catch (e) {
          results.push({ id: conn.id, ok: false, error: String((e as Error).message || e) });
        }
      }
      return json({ synced: results.length, results });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);

    const plaid = makePlaid(base, creds);

    /** Record how an Item is doing, so the UI can say so before a sync fails. */
    const markStatus = async (connectionId: string, code: string | null, message: string | null) => {
      await supabase.from("bank_connections").update({
        status: statusFor(code),
        status_code: code,
        status_error: message,
        status_at: new Date().toISOString(),
      }).eq("id", connectionId);
    };

    const fetchAndStoreBalances = async (connectionId: string, accessToken: string) => {
      const acct = await plaid("/accounts/get", { access_token: accessToken });
      const snap = snapshotBalances(acct.accounts || []);
      await supabase.from("bank_connections").update({
        current_balance: snap.current_balance,
        balance_as_of: snap.balance_as_of,
        accounts: snap.balances,
      }).eq("id", connectionId);
      return snap;
    };

    if (action === "create_link_token") {
      // redirect_uri enables OAuth banks (US) and mobile-webview resumes.
      // Must exactly match an Allowed redirect URI in the Plaid Dashboard.
      const payload: Record<string, unknown> = {
        user: { client_user_id: user.id },
        client_name: "Brasstally",
        products: ["transactions"],
        country_codes: ["CA", "US"],
        language: "en",
        /* Where Plaid should tell us about new transactions. Set at creation
           because an Item's webhook is fixed when it is made; existing ones
           are updated by the `set_webhook` action below. */
        webhook: `${Deno.env.get("SUPABASE_URL") || ""}/functions/v1/plaid`,
      };

      // Update mode: hand Link the existing access_token and it re-authenticates
      // the Item the user already has instead of creating a rival one. Plaid
      // rejects `products` here, the Item's products are already fixed.
      if (body.connection_id) {
        const { data: conn, error } = await supabase
          .from("bank_connections").select("access_token")
          .eq("id", body.connection_id).single();
        if (error || !conn?.access_token) throw new Error("Connection not found");
        payload.access_token = conn.access_token;
        delete payload.products;
      }
      if (typeof body.redirect_uri === "string" && body.redirect_uri) {
        payload.redirect_uri = body.redirect_uri;
      }
      try {
        const d = await plaid("/link/token/create", payload);
        return json({ link_token: d.link_token, oauth: Boolean(payload.redirect_uri) });
      } catch (e) {
        // Not allowlisted yet: still open Link without OAuth redirect support.
        // Banks that authenticate in their own app can't finish in this mode,
        // so pass the reason back for the UI to surface.
        if (payload.redirect_uri && /redirect/i.test(String((e as Error).message || e))) {
          const oauth_error = String((e as Error).message || e);
          delete payload.redirect_uri;
          const d = await plaid("/link/token/create", payload);
          return json({ link_token: d.link_token, oauth: false, oauth_error });
        }
        throw e;
      }
    }

    if (action === "exchange") {
      const d = await plaid("/item/public_token/exchange", { public_token: body.public_token });

      // Same Item coming back (an update-mode reconnect, or the user linking the
      // same bank twice) must repair the row we already have. A second row would
      // double-count the balance in sumBankBalance() and, because bank_transactions
      // is unique on (connection_id, plaid_txn_id), replay the whole history as
      // new unmatched lines under the new id.
      let { data: existing } = await supabase
        .from("bank_connections").select("id, institution")
        .eq("ledger_id", body.ledger_id).eq("item_id", d.item_id).maybeSingle();

      /* A new Item for a bank this ledger already has.
       *
       * Update mode returns the same item_id and matches above. Linking the
       * same bank afresh does not: Plaid issues a new Item, nothing matches,
       * and a second row appears. The balance then doubles, the whole history
       * replays as unmatched lines under the new id, and the row holding
       * every match you have made is orphaned.
       *
       * So a lone existing connection for this ledger is adopted: it keeps its
       * id, its transactions and its matches, and takes the new token. The
       * cursor is cleared because a new Item has no memory of the old one's
       * position, so the next sync reads the account from the start, which is
       * safe: lines are keyed on (connection_id, plaid_txn_id).
       */
      if (!existing) {
        const { data: sameLedger } = await supabase
          .from("bank_connections").select("id, institution")
          .eq("ledger_id", body.ledger_id);
        if ((sameLedger || []).length === 1) {
          existing = sameLedger[0];
          await supabase.from("bank_connections")
            .update({ item_id: d.item_id, cursor: null })
            .eq("id", existing.id);
          console.log("adopted the existing connection for a re-linked bank:", existing.id);
        }
      }

      const now = new Date().toISOString();
      let connectionId: string;

      if (existing) {
        // `cursor` is deliberately absent: keeping it is what makes the next
        // sync resume where it left off instead of re-importing everything.
        // The institution name only moves if Link actually supplied one 
        // update mode often omits it, and "Bank" is worse than what's stored.
        const { error } = await supabase.from("bank_connections").update({
          access_token: d.access_token,
          institution: body.institution || existing.institution,
          status: "ok", status_code: null, status_error: null, status_at: now,
        }).eq("id", existing.id);
        if (error) throw error;
        connectionId = existing.id;
      } else {
        const { data: inserted, error } = await supabase.from("bank_connections").insert({
          ledger_id: body.ledger_id, item_id: d.item_id, access_token: d.access_token,
          institution: body.institution || "Bank",
          status: "ok", status_at: now,
        }).select("id").single();
        if (error) throw error;
        connectionId = inserted.id;
      }

      let snap = { balances: [] as ReturnType<typeof snapshotBalances>["balances"], current_balance: null as number | null, balance_as_of: null as string | null };
      try {
        snap = await fetchAndStoreBalances(connectionId, d.access_token);
      } catch (e) {
        // Connection is saved; balances can refresh on the next sync
        console.error("balances after exchange:", e);
      }
      return json({
        ok: true,
        connection_id: connectionId,
        reconnected: Boolean(existing),
        balances: snap.balances,
        current_balance: snap.current_balance,
      });
    }

    // Ask Plaid how each Item in this ledger is actually doing. Without this the
    // app only discovers a dropped sign-in when a sync throws, which means the
    // user finds out by pressing a button that then fails.
    if (action === "check_status") {
      const { data: conns, error } = await supabase
        .from("bank_connections").select("id, access_token").eq("ledger_id", body.ledger_id);
      if (error) throw error;

      const out: Array<Record<string, unknown>> = [];
      for (const c of conns || []) {
        try {
          const d = await plaid("/item/get", { access_token: c.access_token });
          const itemErr = d.item?.error || null;
          await markStatus(c.id, itemErr?.error_code || null, itemErr?.error_message || null);
          out.push({ id: c.id, status: statusFor(itemErr?.error_code), code: itemErr?.error_code || null });
        } catch (e) {
          // One unreachable Item shouldn't blank the health of the others.
          const code = (e as PlaidError).code || null;
          await markStatus(c.id, code, String((e as Error).message || e));
          out.push({ id: c.id, status: statusFor(code), code });
        }
      }
      /* The environment travels with the answer.

         How long a sign-in lasts depends on it: a development Item is
         short-lived by design, so an owner watching RBC expire repeatedly
         needs to know whether that is their bank or their Plaid tier before
         they go looking for a fault that is not there. */
      return json({ connections: out, env: Deno.env.get("PLAID_ENV") || "sandbox" });
    }

    if (action === "sync") {
      const { data: conn, error } = await supabase.from("bank_connections").select("*").eq("id", body.connection_id).single();
      if (error || !conn) throw new Error("Connection not found");
      const result = await syncOne(supabase, plaid, conn);
      return json(result);
    }

    /* Point an existing Item at the webhook.
     *
     * Connections made before this existed have no webhook and would keep
     * being polled. One call each fixes them, and running it twice is
     * harmless. */
    if (action === "set_webhook") {
      const { data: conns } = await supabase
        .from("bank_connections").select("id, access_token").eq("ledger_id", body.ledger_id);
      const url = `${Deno.env.get("SUPABASE_URL") || ""}/functions/v1/plaid`;
      let done = 0;
      for (const c of conns || []) {
        try {
          await plaid("/item/webhook/update", { access_token: c.access_token, webhook: url });
          done += 1;
        } catch (e) {
          console.warn("webhook update failed for", c.id, (e as Error).message);
        }
      }
      return json({ ok: true, updated: done, webhook: url });
    }

    /* Forget the cursor and read the account again from the beginning.
     *
     * `/transactions/sync` is incremental: it returns what has changed since a
     * cursor, and the cursor is stored on the connection. A cursor that has
     * gone stale returns an empty page and reports success, so every check
     * says the sync worked, because it did. The feed simply stops moving and
     * nothing anywhere says why.
     *
     * Clearing it makes the next sync re-read the account from the start.
     * That is safe: every line is keyed on (connection_id, plaid_txn_id), so
     * a replay updates what is there rather than duplicating it, which is the
     * same property that makes a failed sync safe to retry.
     */
    if (action === "reset_cursor") {
      const { data: conns } = await supabase
        .from("bank_connections").select("id").eq("ledger_id", body.ledger_id);
      const ids = (conns || []).map((c) => c.id);
      if (!ids.length) return json({ ok: true, reset: 0 });

      const { error } = await supabase
        .from("bank_connections").update({ cursor: null }).in("id", ids);
      if (error) throw error;

      // Re-read immediately, so the answer arrives with the request.
      let added = 0;
      for (const id of ids) {
        const { data: conn } = await supabase
          .from("bank_connections").select("*").eq("id", id).single();
        if (!conn) continue;
        const r = await syncOne(supabase, plaid, conn);
        added += Number(r.added) || 0;
      }
      return json({ ok: true, reset: ids.length, added });
    }

    /* Ask Plaid what it has, without our cursor in the way.
     *
     * `/transactions/sync` is incremental and depends on state we store.
     * `/transactions/get` takes a date range and depends on nothing: it is
     * Plaid answering "what do you hold for this account between these
     * dates", which is the question nobody has actually put to it yet.
     *
     * Stores nothing. This exists to tell two possibilities apart:
     *
     *   Plaid has the 12th and our sync is not delivering it, which is ours
     *   Plaid does not have it, which is the bank's
     */
    if (action === "probe") {
      /* Every ledger when none is named, so two Items on the same bank can be
         compared side by side. One working and one not is the most useful
         evidence there is, and it is invisible while you look at them one at a
         time. */
      let q = supabase
        .from("bank_connections")
        .select("id, institution, access_token, ledger_id, last_synced, cursor, status, status_code");
      if (body.ledger_id) q = q.eq("ledger_id", body.ledger_id);
      const { data: conns } = await q;

      const { data: ledgerRows } = await supabase.from("ledgers").select("id, name");
      const ledgerName = new Map((ledgerRows || []).map((l) => [l.id, l.name]));

      const days = Number(body.days) || 10;
      const end = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

      const out: Array<Record<string, unknown>> = [];
      for (const c of conns || []) {
        try {
          /* The Item first: its status, its products, and what consent it
             holds. A transactions product that was never granted, or an Item
             in an error state, explains an empty range better than anything
             the range itself can say. */
          let item: Record<string, unknown> = {};
          try {
            const it = await plaid("/item/get", { access_token: c.access_token });
            item = {
              item_id: it.item?.item_id,
              error: it.item?.error?.error_code || null,
              available_products: it.item?.available_products,
              billed_products: it.item?.billed_products,
              consent_expiration: it.item?.consent_expiration_time || null,
              update_type: it.item?.update_type,
            };
          } catch (e) {
            item = { item_error: String((e as Error).message || e) };
          }

          let accounts: unknown[] = [];
          try {
            const a = await plaid("/accounts/get", { access_token: c.access_token });
            accounts = (a.accounts || []).map((x: Record<string, unknown>) => ({
              name: x.name,
              type: x.type,
              subtype: x.subtype,
              current: (x.balances as Record<string, unknown>)?.current,
              last_updated: (x.balances as Record<string, unknown>)?.last_updated_datetime || null,
            }));
          } catch { /* balances are a nicety here */ }

          const d = await plaid("/transactions/get", {
            access_token: c.access_token,
            start_date: start,
            end_date: end,
            options: { count: 100, offset: 0 },
          });
          const txns = (d.transactions || []) as Array<Record<string, unknown>>;
          const dates = [...new Set(txns.map((t) => String(t.date)))].sort().reverse();
          out.push({
            ledger: ledgerName.get(c.ledger_id) || c.ledger_id,
            institution: c.institution,
            stored_status: c.status,
            stored_status_code: c.status_code,
            last_synced: c.last_synced,
            has_cursor: Boolean(c.cursor),
            item,
            accounts,
            window: `${start} to ${end}`,
            total_available: d.total_transactions ?? txns.length,
            returned: txns.length,
            newest: dates[0] || null,
            dates: dates.slice(0, 6),
            sample: txns.slice(0, 5).map((t) => ({
              date: t.date,
              name: String(t.name || "").slice(0, 40),
              amount: t.amount,
              pending: t.pending,
            })),
          });
        } catch (e) {
          out.push({
            ledger: ledgerName.get(c.ledger_id) || c.ledger_id,
            institution: c.institution,
            error: String((e as Error).message || e),
          });
        }
      }
      /* The environment travels with the answer.

         Supabase masks a secret's value in the dashboard, so PLAID_ENV cannot
         be read by looking at it, and the tier changes how long a sign-in
         lasts. Reporting it here is not a leak: it is one of three known
         words, and the caller has already proved they own the ledger. */
      return json({
        ok: true,
        env: Deno.env.get("PLAID_ENV") || "sandbox (not set)",
        accounts: out,
      });
    }

    /* Make Plaid go and ask the bank, now.
     *
     * Everything so far has read what Plaid already had. `/transactions/refresh`
     * is different: it tells Plaid to fetch from the institution on demand
     * rather than waiting for its own schedule.
     *
     * This is the remaining explanation for two healthy Items on one bank
     * disagreeing. Plaid refreshes an Item on its own cadence, and an Item
     * whose cadence has stalled looks exactly like a bank holding data back:
     * the Item is fine, the product is granted, and the data is simply old.
     *
     * It returns before the fetch completes, so the sync runs after a pause
     * and the webhook covers anything that lands later.
     */
    if (action === "force_refresh") {
      const { data: conns } = await supabase
        .from("bank_connections").select("id, institution, access_token")
        .eq("ledger_id", body.ledger_id);

      const out: Array<Record<string, unknown>> = [];
      for (const c of conns || []) {
        try {
          await plaid("/transactions/refresh", { access_token: c.access_token });
          // Plaid returns immediately and fetches behind it. A short wait
          // catches the common case; the webhook catches the rest.
          await new Promise((r) => setTimeout(r, 6000));
          const { data: fresh } = await supabase
            .from("bank_connections").select("*").eq("id", c.id).single();
          const r = fresh ? await syncOne(supabase, plaid, fresh) : { added: 0 };
          out.push({ institution: c.institution, asked: true, added: r.added });
        } catch (e) {
          /* A plan without on-demand refresh says so plainly, and that is
             worth reporting rather than swallowing: it is the difference
             between "we cannot ask" and "we asked and the bank said no". */
          out.push({ institution: c.institution, asked: false, error: String((e as Error).message || e) });
        }
      }
      return json({ ok: true, results: out });
    }

    /* Removing a bank has to tell Plaid, not just forget it here.
     *
     * This deleted our row and stopped there. The Item carried on existing at
     * Plaid: still live, still refreshing on their schedule, still signing in
     * to the bank. At an institution that permits one session per login, those
     * orphans knock out whichever Item is currently yours, which looks exactly
     * like a connection that will not stay signed in.
     *
     * Plaid offers no way to list the Items you have lost track of, so every
     * one of these is permanent until somebody asks their support to find
     * them. Removing on the way out is the only moment it can be done.
     *
     * The row is deleted whatever Plaid says. A failed removal should not
     * leave somebody stuck with a bank they have asked to be rid of.
     */
    if (action === "disconnect") {
      const { data: conn } = await supabase
        .from("bank_connections").select("access_token, item_id")
        .eq("id", body.connection_id).maybeSingle();

      let removed = false;
      if (conn?.access_token) {
        try {
          await plaid("/item/remove", { access_token: conn.access_token });
          removed = true;
        } catch (e) {
          console.warn("could not remove the item at Plaid:", (e as Error).message);
        }
      }

      const { error } = await supabase.from("bank_connections").delete().eq("id", body.connection_id);
      if (error) throw error;
      return json({ ok: true, removed_at_plaid: removed, item_id: conn?.item_id ?? null });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
