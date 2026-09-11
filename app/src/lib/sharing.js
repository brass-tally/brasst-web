/* ================= sharing and invoice intake =================
   Two things an owner does from Settings: let an accountant read a ledger, and
   hand a supplier a link to send an invoice through.

   Every call tolerates migration 0022 not having run. Without it the features
   are simply absent rather than the app failing to load, which matters because
   a ledger is useful without either of them. */

import { supabase } from "./supabase";

const soft = async (label, fn, fallback) => {
  try {
    return await fn();
  } catch (e) {
    console.warn(`${label} unavailable:`, e?.message || e);
    return fallback;
  }
};

/* Say what actually went wrong.
   These calls used to report "run migration 0022" for every failure, so a
   not-null violation, a permission problem and a genuinely missing table all
   produced the same sentence, and the one instruction it gave was the one
   thing that would not help. A wrong diagnosis stated confidently costs more
   than no diagnosis. */
function explain(e) {
  const msg = String(e?.message || e || "");
  const code = e?.code || "";

  // The table is not there. PostgREST says PGRST205, Postgres says 42P01.
  if (code === "PGRST205" || code === "42P01" || /does not exist|schema cache/i.test(msg)) {
    return "This needs migration 0022. Run it in the Supabase SQL editor and try again.";
  }
  // The column exists but has no default, which is the shape 0022 shipped in
  // first. 0024 is the repair.
  if (code === "23502" || /null value in column "owner_id"|violates not-null/i.test(msg)) {
    return "Your database has an older version of this table. Run migration 0024, it takes a second.";
  }
  if (code === "23505" || /duplicate key/i.test(msg)) {
    return "That address already has access to this ledger.";
  }
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return "The database refused that. You can only share a ledger you own.";
  }
  return msg ? `That did not save: ${msg}` : "That did not save.";
}

/* ---------------- read access ---------------- */

export async function listShares(ledgerId) {
  return soft("ledger_shares", async () => {
    const { data, error } = await supabase
      .from("ledger_shares").select("*").eq("ledger_id", ledgerId)
      .neq("status", "revoked").order("invited_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id, email: r.email, role: r.role, status: r.status,
      invitedAt: r.invited_at, acceptedAt: r.accepted_at, note: r.note || undefined,
    }));
  }, []);
}

export async function inviteViewer(ledgerId, email, note) {
  const clean = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { ok: false, error: "That does not look like an email address." };
  }
  try {
    const { error } = await supabase.from("ledger_shares").upsert(
      {
        /* owner_id is filled by the database from auth.uid(). If your
           ledger_shares predates that default, migration 0024 adds it. */
        ledger_id: ledgerId, email: clean, role: "viewer",
        /* Active immediately, not on acceptance.
           The check that matters happens at read time: a policy compares this
           address to the one in their token, so the row grants nothing until
           somebody signs in as that person. Making them accept an invitation
           first would add a step that protects nobody. */
        status: "active", note: note || null,
      },
      { onConflict: "ledger_id,email" },
    );
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn("invite failed:", e);
    return { ok: false, error: explain(e) };
  }
}

export async function revokeShare(id) {
  return soft("revoke", async () => {
    const { error } = await supabase
      .from("ledger_shares")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return { ok: true };
  }, { ok: false });
}

/** Ledgers someone else has shared with me, for the switcher. */
export async function listSharedWithMe() {
  return soft("shared ledgers", async () => {
    const { data, error } = await supabase
      .from("ledger_shares").select("ledger_id, status, ledgers(id, name, kind)")
      .eq("status", "active");
    if (error) throw error;
    return (data || [])
      .filter((r) => r.ledgers)
      .map((r) => ({ ...r.ledgers, readOnly: true }));
  }, []);
}

/* ---------------- invoice intake ---------------- */

/* A token that is awkward to guess and readable enough to be read down a
   phone. No ambiguous characters, because someone will. */
function makeToken(len = 22) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export async function listInvoiceLinks(ledgerId) {
  return soft("invoice_links", async () => {
    const { data, error } = await supabase
      .from("invoice_links").select("*").eq("ledger_id", ledgerId).eq("active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id, token: r.token, label: r.label || undefined,
      createdAt: r.created_at, submissions: r.submissions || 0,
    }));
  }, []);
}

export async function createInvoiceLink(ledgerId, label) {
  try {
    const token = makeToken();
    const { error } = await supabase
      .from("invoice_links")
      .insert({ ledger_id: ledgerId, token, label: label || null });
    if (error) throw error;
    return { ok: true, token };
  } catch (e) {
    console.warn("create link failed:", e);
    return { ok: false, error: explain(e) };
  }
}

export async function revokeInvoiceLink(id) {
  return soft("revoke link", async () => {
    const { error } = await supabase
      .from("invoice_links").update({ active: false, revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return { ok: true };
  }, { ok: false });
}

/** status: "pending", "accepted", "declined", or "all" for the history. */
export async function listInbound(ledgerId, status = "pending") {
  return soft("inbound_invoices", async () => {
    let q = supabase.from("inbound_invoices").select("*").eq("ledger_id", ledgerId);
    if (status !== "all") q = q.eq("status", status);
    const { data, error } = await q.order("submitted_at", { ascending: false }).limit(200);
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id, party: r.party, contactEmail: r.contact_email || undefined,
      invoiceNo: r.invoice_no || undefined, description: r.description || undefined,
      amount: Number(r.amount), taxAmount: r.tax_amount == null ? undefined : Number(r.tax_amount),
      issueDate: r.issue_date || undefined, dueDate: r.due_date || undefined,
      note: r.note || undefined, filePath: r.file_path || undefined,
      submittedAt: r.submitted_at, decidedAt: r.decided_at || undefined,
      obligationId: r.obligation_id || undefined, status: r.status,
    }));
  }, []);
}

/* Mark a submission decided.
   The obligation_id column has a foreign key to obligations, and the payable
   is written to the database asynchronously by addAR. So this can arrive
   before the row it points at exists, the key is rejected, and the submission
   silently stays pending: the confirmation says it was filed and the card is
   still sitting there.

   Two answers, both needed. The link is worth having, so it is attempted. But
   leaving the queue is worth more than the link, so a failure retries without
   it rather than giving up. */
export async function decideInbound(id, status, obligationId) {
  const patch = { status, decided_at: new Date().toISOString() };

  if (obligationId) {
    try {
      const { error } = await supabase
        .from("inbound_invoices").update({ ...patch, obligation_id: obligationId }).eq("id", id);
      if (!error) return { ok: true, linked: true };
      console.warn("could not link the payable, deciding without it:", error.message);
    } catch (e) {
      console.warn("could not link the payable, deciding without it:", e?.message || e);
    }
  }

  try {
    const { error } = await supabase.from("inbound_invoices").update(patch).eq("id", id);
    if (error) throw error;
    return { ok: true, linked: false };
  } catch (e) {
    console.error("could not decide the invoice:", e);
    return { ok: false, error: e?.message || "That did not save." };
  }
}

export const invoiceLinkUrl = (token) =>
  `${window.location.origin}/invoice?t=${encodeURIComponent(token)}`;

/* Void removes the submission outright.
   Not a status change: the row goes. "Void" should leave nothing behind in the
   list, and a declined row that still shows up under history is the thing this
   was asked to stop.

   The payable it created is deleted by the caller, which has the ledger in
   hand. This returns the id so the caller knows what to remove, and returns it
   even though the row is already gone, because losing the link and then being
   unable to clean up the payable is the worst of both. */
export async function voidInbound(id) {
  return soft("void", async () => {
    const { data: row } = await supabase
      .from("inbound_invoices").select("obligation_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("inbound_invoices").delete().eq("id", id);
    if (error) throw error;
    return { ok: true, obligationId: row?.obligation_id || null };
  }, { ok: false });
}

/* Tell me when an invoice arrives, without asking every two minutes.

   Postgres changes are pushed over a websocket, so a submission shows up in
   the tray about as fast as the supplier sees their own confirmation. The
   poll stays as a floor: a socket can be dropped by a proxy, a phone that has
   been asleep reconnects on its own schedule, and a feature whose only
   delivery path is a live connection is a feature that quietly stops working
   on hotel wifi.

   Returns an unsubscribe. Realtime has to be enabled for the table in the
   Supabase dashboard; without it this is inert and the poll carries it. */
export function watchInbound(ledgerId, onChange) {
  if (!ledgerId) return () => {};
  try {
    const channel = supabase
      .channel(`inbound:${ledgerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inbound_invoices", filter: `ledger_id=eq.${ledgerId}` },
        (payload) => onChange?.(payload),
      )
      .subscribe();
    return () => { try { supabase.removeChannel(channel); } catch { /* already gone */ } };
  } catch (e) {
    console.warn("realtime unavailable, falling back to polling:", e?.message || e);
    return () => {};
  }
}

/* Calls to the invoice-mail edge function.

   Not /api/... any more. Vercel's services config, which is what puts the
   landing site and the app on one domain, does not host serverless functions:
   three placements of the same file all resolved to the app's own catch-all
   rather than to a function. An edge function has its own URL and needs no
   routing, so the whole class of problem is gone.

   supabase.functions.invoke attaches the session automatically, which
   send-link needs and the public actions ignore. */
async function callMail(action, payload = {}) {
  try {
    const { data, error } = await supabase.functions.invoke("invoice-mail", {
      body: { action, ...payload },
    });
    if (error) {
      const msg = String(error.message || error);
      if (/not found|404/i.test(msg)) {
        return { ok: false, error: "The invoice-mail function is not deployed yet." };
      }
      return { ok: false, error: msg };
    }
    return data || { ok: false, error: "No answer from the mail service." };
  } catch (e) {
    return { ok: false, error: e?.message || "That did not send." };
  }
}

export const mailHealth = () => callMail("health");

export const emailInvoiceLink = (token, to, note) =>
  callMail("send-link", { token, to, note });

export const notifyInvoiceArrived = (token, id) => callMail("notify", { token, id });

export const testInvoiceMail = (token) => callMail("test", { token });
