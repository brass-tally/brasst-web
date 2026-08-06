// Plaid proxy: keys stay server-side, the browser only ever sees link tokens.
// Secrets required: PLAID_CLIENT_ID, PLAID_SECRET, optional PLAID_ENV (sandbox | development | production)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

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
  const current_balance = depository.length
    ? depository.reduce((s, b) => s + Number(b.current), 0)
    : null;
  return { balances, current_balance, balance_as_of: new Date().toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { action, ...body } = await req.json();
    const env = Deno.env.get("PLAID_ENV") || "sandbox";
    const base = `https://${env}.plaid.com`;
    const creds = { client_id: Deno.env.get("PLAID_CLIENT_ID"), secret: Deno.env.get("PLAID_SECRET") };
    if (!creds.client_id || !creds.secret) return json({ error: "Plaid keys are not configured yet" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);

    const plaid = async (path: string, payload: Record<string, unknown>) => {
      const r = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...creds, ...payload }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error_message || d.error_code || "Plaid error");
      return d;
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
      };
      if (typeof body.redirect_uri === "string" && body.redirect_uri) {
        payload.redirect_uri = body.redirect_uri;
      }
      try {
        const d = await plaid("/link/token/create", payload);
        return json({ link_token: d.link_token, oauth: Boolean(payload.redirect_uri) });
      } catch (e) {
        // Not allowlisted yet — still open Link without OAuth redirect support.
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
      const { data: inserted, error } = await supabase.from("bank_connections").insert({
        ledger_id: body.ledger_id, item_id: d.item_id, access_token: d.access_token,
        institution: body.institution || "Bank",
      }).select("id").single();
      if (error) throw error;
      let snap = { balances: [] as ReturnType<typeof snapshotBalances>["balances"], current_balance: null as number | null, balance_as_of: null as string | null };
      try {
        snap = await fetchAndStoreBalances(inserted.id, d.access_token);
      } catch (e) {
        // Connection is saved; balances can refresh on the next sync
        console.error("balances after exchange:", e);
      }
      return json({ ok: true, balances: snap.balances, current_balance: snap.current_balance });
    }

    if (action === "sync") {
      const { data: conn, error } = await supabase.from("bank_connections").select("*").eq("id", body.connection_id).single();
      if (error || !conn) throw new Error("Connection not found");

      // Drain every page first, holding the new cursor locally. Nothing is
      // committed until the rows below are stored: if a write fails we throw
      // with the OLD cursor still on the connection, and the next sync replays
      // the same lines. The (connection_id, plaid_txn_id) unique key makes that
      // replay idempotent.
      let cursor = conn.cursor || undefined;
      const added: any[] = [], modified: any[] = [], removed: any[] = [];
      let hasMore = true, guard = 0;
      while (hasMore && guard < 20) {
        const d = await plaid("/transactions/sync", { access_token: conn.access_token, cursor, count: 250 });
        added.push(...(d.added || []));
        modified.push(...(d.modified || []));
        removed.push(...(d.removed || []));
        cursor = d.next_cursor; hasMore = d.has_more; guard += 1;
      }

      const now = new Date().toISOString();
      // Plaid convention: positive amount = money leaving the account
      const toRow = (t: any) => ({
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

      // Everything is durable — only now is it safe to move the cursor past it.
      const { error: curErr } = await supabase.from("bank_connections")
        .update({ cursor, last_synced: now }).eq("id", conn.id);
      if (curErr) throw curErr;

      let snap = { balances: [] as ReturnType<typeof snapshotBalances>["balances"], current_balance: null as number | null, balance_as_of: null as string | null };
      try {
        snap = await fetchAndStoreBalances(conn.id, conn.access_token);
      } catch (e) {
        console.error("balances after sync:", e);
      }
      return json({
        added: added.length,
        modified: modified.length,
        removed: removed.length,
        balances: snap.balances,
        current_balance: snap.current_balance,
        balance_as_of: snap.balance_as_of,
      });
    }

    if (action === "disconnect") {
      const { error } = await supabase.from("bank_connections").delete().eq("id", body.connection_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
