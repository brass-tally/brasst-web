/* Invoices you send.
 *
 * The mirror of the intake tray. The receivable in your books stays the source
 * of truth for what you are owed; this holds the document that asked for it.
 * Keeping them apart means an invoice can be reissued, corrected or cancelled
 * without touching the figure, and the figure can be settled from the bank
 * without the document having to know how.
 */
import { supabase } from "./supabase";
import { assertWritable } from "./access";

const soft = async (what, run, fallback) => {
  try {
    return await run();
  } catch (e) {
    console.warn(`${what} unavailable:`, e?.message || e);
    return fallback;
  }
};

const rowToInvoice = (r) => ({
  id: r.id,
  number: r.number,
  party: r.party,
  contactId: r.contact_id || undefined,
  contactEmail: r.contact_email || undefined,
  issuedOn: r.issued_on,
  dueOn: r.due_on || undefined,
  currency: r.currency || "CAD",
  amount: Number(r.amount) || 0,
  taxAmount: Number(r.tax_amount) || 0,
  note: r.note || undefined,
  lines: r.line_items || undefined,
  status: r.status,
  token: r.token || undefined,
  sentAt: r.sent_at || undefined,
  openedAt: r.opened_at || undefined,
  opens: r.opens || 0,
  obligationId: r.obligation_id || undefined,
});

export async function listSent(ledgerId) {
  return soft("sent invoices", async () => {
    const { data, error } = await supabase
      .from("sent_invoices").select("*").eq("ledger_id", ledgerId)
      .order("issued_on", { ascending: false }).limit(200);
    if (error) throw error;
    return (data || []).map(rowToInvoice);
  }, []);
}

export async function nextNumber(ledgerId, prefix = "INV") {
  return soft("invoice number", async () => {
    const { data, error } = await supabase.rpc("next_invoice_number", {
      p_ledger_id: ledgerId, p_prefix: prefix,
    });
    if (error) throw error;
    return data;
  }, null);
}

/** Totals from the lines, so the figure can never disagree with what is listed. */
export function totalOf(lines = [], taxRate = 0) {
  const net = lines.reduce((n, l) => {
    const qty = Number(l.qty ?? 1) || 0;
    const rate = Number(l.rate ?? 0) || 0;
    return n + qty * rate;
  }, 0);
  const tax = Math.round(net * (Number(taxRate) || 0) * 100) / 100;
  return { net: Math.round(net * 100) / 100, tax, total: Math.round((net + tax) * 100) / 100 };
}

export async function saveDraft(ledgerId, inv) {
  assertWritable();
  return soft("save invoice", async () => {
    const body = {
      ledger_id: ledgerId,
      contact_id: inv.contactId || null,
      number: inv.number,
      party: inv.party,
      contact_email: inv.contactEmail || null,
      issued_on: inv.issuedOn || new Date().toISOString().slice(0, 10),
      due_on: inv.dueOn || null,
      currency: inv.currency || "CAD",
      amount: Number(inv.amount) || 0,
      tax_amount: Number(inv.taxAmount) || 0,
      note: inv.note || null,
      line_items: inv.lines || null,
    };
    const q = inv.id
      ? supabase.from("sent_invoices").update(body).eq("id", inv.id).select().single()
      : supabase.from("sent_invoices").insert(body).select().single();
    const { data, error } = await q;
    if (error) throw error;
    return rowToInvoice(data);
  }, null);
}

/* Sending is what raises the receivable.
 *
 * A draft owes you nothing: it is a document in progress, and counting it
 * would overstate what you are owed on the strength of something nobody has
 * seen. The moment it goes out, it becomes a figure in the books. */
export async function send(invoiceId, { addAR }) {
  assertWritable();
  return soft("send invoice", async () => {
    const { data: row, error: readErr } = await supabase
      .from("sent_invoices").select("*").eq("id", invoiceId).single();
    if (readErr) throw readErr;
    const inv = rowToInvoice(row);

    let obligationId = inv.obligationId;
    if (!obligationId && addAR) {
      const made = await addAR("receivables", {
        party: inv.party,
        description: `${inv.number}${inv.note ? ` · ${inv.note}` : ""}`,
        amount: inv.amount,
        dueDate: inv.dueOn || inv.issuedOn,
      });
      obligationId = made?.id || null;
    }

    const { data, error } = await supabase.functions.invoke("invoice-mail", {
      body: { action: "send-invoice", invoice_id: invoiceId, obligation_id: obligationId },
    });
    if (error) throw error;
    if (data?.ok === false) return data;
    return { ok: true, ...data };
  }, { ok: false, error: "Could not send it." });
}

export async function cancel(invoiceId) {
  assertWritable();
  return soft("cancel invoice", async () => {
    const { error } = await supabase
      .from("sent_invoices").update({ status: "cancelled" }).eq("id", invoiceId);
    if (error) throw error;
    return { ok: true };
  }, { ok: false });
}

export async function removeDraft(invoiceId) {
  assertWritable();
  return soft("delete draft", async () => {
    const { error } = await supabase
      .from("sent_invoices").delete().eq("id", invoiceId).eq("status", "draft");
    if (error) throw error;
    return { ok: true };
  }, { ok: false });
}
