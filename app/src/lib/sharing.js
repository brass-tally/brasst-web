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
  return soft("invite", async () => {
    const { error } = await supabase.from("ledger_shares").upsert(
      {
        // owner_id is filled by the database from auth.uid().
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
  }, { ok: false, error: "Sharing is not set up on this database yet. Run migration 0022." });
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
  return soft("create link", async () => {
    const token = makeToken();
    const { error } = await supabase
      .from("invoice_links")
      .insert({ ledger_id: ledgerId, token, label: label || null });
    if (error) throw error;
    return { ok: true, token };
  }, { ok: false, error: "Invoice links are not set up on this database yet. Run migration 0022." });
}

export async function revokeInvoiceLink(id) {
  return soft("revoke link", async () => {
    const { error } = await supabase
      .from("invoice_links").update({ active: false, revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return { ok: true };
  }, { ok: false });
}

export async function listInbound(ledgerId, status = "pending") {
  return soft("inbound_invoices", async () => {
    const { data, error } = await supabase
      .from("inbound_invoices").select("*").eq("ledger_id", ledgerId).eq("status", status)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id, party: r.party, contactEmail: r.contact_email || undefined,
      invoiceNo: r.invoice_no || undefined, description: r.description || undefined,
      amount: Number(r.amount), taxAmount: r.tax_amount == null ? undefined : Number(r.tax_amount),
      issueDate: r.issue_date || undefined, dueDate: r.due_date || undefined,
      note: r.note || undefined, filePath: r.file_path || undefined,
      submittedAt: r.submitted_at, status: r.status,
    }));
  }, []);
}

export async function decideInbound(id, status, obligationId) {
  return soft("decide", async () => {
    const { error } = await supabase.from("inbound_invoices").update({
      status, obligation_id: obligationId || null, decided_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) throw error;
    return { ok: true };
  }, { ok: false });
}

export const invoiceLinkUrl = (token) =>
  `${window.location.origin}/invoice?t=${encodeURIComponent(token)}`;
