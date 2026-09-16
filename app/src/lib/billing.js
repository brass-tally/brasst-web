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

/* How a customer pays you.
 *
 * One set per ledger: it is your bank, not something that changes per invoice.
 * Off until somebody has filled it in and turned it on, so a half-typed
 * account number never reaches a customer.
 */
const rowToPay = (r) => r && ({
  country: r.country || "CA",
  beneficiaryName: r.beneficiary_name || "",
  beneficiaryAddress: r.beneficiary_address || "",
  accountNumber: r.account_number || "",
  accountType: r.account_type || "",
  institutionNumber: r.institution_number || "",
  transitNumber: r.transit_number || "",
  routingNumber: r.routing_number || "",
  iban: r.iban || "",
  swiftCode: r.swift_code || "",
  bankName: r.bank_name || "",
  branchAddress: r.branch_address || "",
  note: r.note || "",
  active: Boolean(r.active),
});

export async function getPayTo(ledgerId) {
  return soft("payment details", async () => {
    const { data, error } = await supabase
      .from("payment_details").select("*").eq("ledger_id", ledgerId).maybeSingle();
    if (error) throw error;
    return rowToPay(data) || null;
  }, null);
}

export async function savePayTo(ledgerId, d) {
  assertWritable();
  /* The reason travels with the failure.
   *
   * `soft` returns null and logs, which is right for a list that can render
   * empty and wrong for a button: pressing it did nothing, said nothing, and
   * the only trace was a console line nobody reads while pressing a button.
   *
   * This is the fourth time this session I have found that shape. It is the
   * one to watch for rather than fix case by case: a swallowed error behind a
   * control is indistinguishable from a control that does not work. */
  try {
    const body = {
      ledger_id: ledgerId,
      country: d.country || "CA",
      beneficiary_name: d.beneficiaryName || null,
      beneficiary_address: d.beneficiaryAddress || null,
      account_number: d.accountNumber || null,
      account_type: d.accountType || null,
      institution_number: d.institutionNumber || null,
      transit_number: d.transitNumber || null,
      routing_number: d.routingNumber || null,
      iban: d.iban || null,
      swift_code: d.swiftCode || null,
      bank_name: d.bankName || null,
      branch_address: d.branchAddress || null,
      note: d.note || null,
      active: Boolean(d.active),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("payment_details").upsert(body, { onConflict: "ledger_id" }).select().single();
    if (error) throw error;
    return { ok: true, saved: rowToPay(data) };
  } catch (e) {
    console.warn("save payment details failed:", e?.message || e);
    return { ok: false, error: e?.message || "It did not save." };
  }
}

/** What a given country actually needs, so the form asks for that and no more. */
export function payFieldsFor(country) {
  const common = ["beneficiaryName", "beneficiaryAddress", "accountNumber", "accountType",
                  "bankName", "branchAddress"];
  if (country === "US") return [...common, "routingNumber", "swiftCode"];
  if (country === "OTHER") return [...common, "iban", "swiftCode"];
  return [...common, "transitNumber", "institutionNumber", "swiftCode"];
}

/** Whether it is complete enough to put in front of a customer. */
export function payToReady(d) {
  if (!d) return false;
  if (!d.beneficiaryName || !d.accountNumber || !d.bankName) return false;
  if (d.country === "CA") return Boolean(d.transitNumber && d.institutionNumber);
  if (d.country === "US") return Boolean(d.routingNumber);
  return Boolean(d.iban || d.swiftCode);
}

/* ---------------- card payments ---------------- */

/* Which ways of paying this ledger offers, and which the project can support.
 *
 * Two different questions: a provider with no key on the project cannot be
 * switched on however much somebody wants it, and a provider with a key is
 * still off until the owner says otherwise. */
export async function listProviders(ledgerId) {
  return soft("payment providers", async () => {
    const [{ data: rows }, health] = await Promise.all([
      supabase.from("payment_providers").select("*").eq("ledger_id", ledgerId),
      supabase.functions.invoke("payments", { body: { action: "health" } }).catch(() => null),
    ]);
    const configured = health?.data?.configured || {};
    return ["stripe", "paypal", "square"].map((k) => {
      const row = (rows || []).find((r) => r.provider === k);
      return {
        provider: k,
        enabled: Boolean(row?.enabled),
        feesTo: row?.fees_to || "me",
        configured: Boolean(configured[k]),
      };
    });
  }, []);
}

export async function setProvider(ledgerId, provider, patch) {
  assertWritable();
  try {
    const { error } = await supabase.from("payment_providers").upsert({
      ledger_id: ledgerId,
      provider,
      enabled: patch.enabled ?? false,
      fees_to: patch.feesTo || "me",
      updated_at: new Date().toISOString(),
    }, { onConflict: "ledger_id,provider" });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn("set provider failed:", e?.message || e);
    return { ok: false, error: e?.message || "That did not save." };
  }
}

/* Card payments that have arrived and not yet been put in the books.
 *
 * The webhook records the money; it does not touch the ledger. Turning one
 * into a transaction is a decision made in front of the figures, because a
 * payment can be refunded, can be for the wrong invoice, and can arrive net of
 * a fee nobody has accounted for. */
export async function listUnconfirmed(ledgerId) {
  return soft("card payments", async () => {
    const { data, error } = await supabase
      .from("invoice_payments")
      .select("*, sent_invoices(number, party, obligation_id)")
      .eq("ledger_id", ledgerId).eq("status", "paid").is("confirmed_at", null)
      .order("paid_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      provider: r.provider,
      amount: Number(r.amount) || 0,
      fee: Number(r.fee) || 0,
      net: Number(r.net) || 0,
      currency: r.currency || "CAD",
      paidAt: r.paid_at,
      invoiceId: r.invoice_id || undefined,
      number: r.sent_invoices?.number,
      party: r.sent_invoices?.party,
      obligationId: r.sent_invoices?.obligation_id || undefined,
    }));
  }, []);
}

export async function markConfirmed(paymentId, transactionId) {
  assertWritable();
  try {
    const { error } = await supabase.from("invoice_payments").update({
      confirmed_at: new Date().toISOString(),
      transaction_id: transactionId || null,
    }).eq("id", paymentId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Could not record that." };
  }
}
