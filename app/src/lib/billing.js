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
  cancelledAt: r.cancelled_at || undefined,
  cancelledBy: r.cancelled_by || undefined,
  cancelReason: r.cancel_reason || undefined,
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

/* Cancelling, which retires what the invoice raised.
 *
 * This used to mark the document and leave the receivable, so the books went
 * on claiming money from somebody who had been told the bill was withdrawn.
 *
 * One call, because two calls from a browser that closes between them leave
 * exactly that state. The database decides, and refuses when part of it has
 * already been paid. */
export async function cancel(invoiceId, reason = null) {
  assertWritable();
  try {
    const { data, error } = await supabase.rpc("cancel_sent_invoice", {
      p_invoice_id: invoiceId,
      p_reason: reason,
    });
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn("cancel invoice failed:", e?.message || e);
    return { ok: false, error: e?.message || "It could not be cancelled." };
  }
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


/* Several accounts, not one.
 *
 * A business billing in two currencies has two, and they are not
 * interchangeable: a US customer paying a Canadian account by wire loses money
 * to conversion and a correspondent fee, and a Canadian customer sent a routing
 * number has nothing to type it into.
 */
const rowToPay = (r) => r && ({
  id: r.id,
  label: r.label || "",
  currency: r.currency || "",
  isDefault: Boolean(r.is_default),
  country: r.country || "CA",
  beneficiaryName: r.beneficiary_name || "",
  beneficiaryAddress: r.beneficiary_address || "",
  accountNumber: r.account_number || "",
  accountType: r.account_type || "",
  institutionNumber: r.institution_number || "",
  transitNumber: r.transit_number || "",
  routingNumber: r.routing_number || "",
  wireRoutingNumber: r.wire_routing_number || "",
  iban: r.iban || "",
  swiftCode: r.swift_code || "",
  bankName: r.bank_name || "",
  branchAddress: r.branch_address || "",
  note: r.note || "",
  active: Boolean(r.active),
});

export async function listPayTo(ledgerId) {
  return soft("payment details", async () => {
    const { data, error } = await supabase
      .from("payment_details").select("*").eq("ledger_id", ledgerId)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToPay);
  }, []);
}

/** What a blank one looks like, with the currency implied by the country. */
export function blankPayTo(country = "CA") {
  return {
    id: null,
    label: country === "CA" ? "Canadian account" : country === "US" ? "US account" : "International account",
    currency: country === "CA" ? "CAD" : country === "US" ? "USD" : "",
    isDefault: false,
    country,
    beneficiaryName: "", beneficiaryAddress: "", accountNumber: "", accountType: "chequing",
    institutionNumber: "", transitNumber: "", routingNumber: "", wireRoutingNumber: "",
    iban: "", swiftCode: "",
    bankName: "", branchAddress: "", note: "", active: false,
  };
}

export async function savePayTo(ledgerId, d) {
  assertWritable();
  try {
    if (typeof supabase?.from !== "function") {
      throw new Error("This build is missing part of the billing library. Deploy app/src/lib/billing.js alongside App.jsx.");
    }
    const body = {
      ledger_id: ledgerId,
      label: d.label || null,
      currency: d.currency || null,
      country: d.country || "CA",
      beneficiary_name: d.beneficiaryName || null,
      beneficiary_address: d.beneficiaryAddress || null,
      account_number: d.accountNumber || null,
      account_type: d.accountType || null,
      institution_number: d.institutionNumber || null,
      transit_number: d.transitNumber || null,
      routing_number: d.routingNumber || null,
      wire_routing_number: d.wireRoutingNumber || null,
      iban: d.iban || null,
      swift_code: d.swiftCode || null,
      bank_name: d.bankName || null,
      branch_address: d.branchAddress || null,
      note: d.note || null,
      active: Boolean(d.active),
      updated_at: new Date().toISOString(),
    };

    const q = d.id
      ? supabase.from("payment_details").update(body).eq("id", d.id).select().single()
      : supabase.from("payment_details").insert(body).select().single();

    const { data, error } = await q;
    if (error) throw error;

    /* The first account to be switched on becomes the default, because an
       invoice needs one and nobody should have to know that. */
    if (body.active) {
      const { count } = await supabase
        .from("payment_details").select("id", { count: "exact", head: true })
        .eq("ledger_id", ledgerId).eq("is_default", true);
      if (!count) await setDefaultPayTo(ledgerId, data.id);
    }

    return { ok: true, saved: rowToPay(data) };
  } catch (e) {
    console.warn("save payment details failed:", e?.message || e);
    return { ok: false, error: e?.message || "It did not save." };
  }
}

/* Exactly one default. Cleared first, because the partial unique index refuses
   two and the failure would otherwise land on the person pressing the button. */
export async function setDefaultPayTo(ledgerId, id) {
  assertWritable();
  try {
    const { error: clearErr } = await supabase
      .from("payment_details").update({ is_default: false })
      .eq("ledger_id", ledgerId).eq("is_default", true);
    if (clearErr) throw clearErr;

    const { error } = await supabase
      .from("payment_details").update({ is_default: true, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Could not set that as the default." };
  }
}

export async function removePayTo(id) {
  assertWritable();
  try {
    const { error } = await supabase.from("payment_details").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Could not remove it." };
  }
}

/** Which account a customer billed in this currency should be shown. */
export function payToFor(accounts = [], currency) {
  const live = accounts.filter((a) => a.active);
  return live.find((a) => a.currency === currency) || live.find((a) => a.isDefault) || live[0] || null;
}

/* The form, in groups, with what a transfer will not go without at the top.
 *
 * It used to be one flat list in an order nobody chose: the two numbers a
 * Canadian transfer actually needs sat seventh and eighth, under an optional
 * branch address, which on a phone is below the fold of a form nobody scrolls
 * twice. The owner reported them as missing, and that is the correct reading
 * of a field you cannot find.
 *
 * Three groups, named, required first.
 */
export function payGroupsFor(country) {
  const numbers = country === "US" ? ["routingNumber", "accountNumber", "wireRoutingNumber"]
    : country === "OTHER" ? ["iban", "accountNumber", "swiftCode"]
      : ["transitNumber", "institutionNumber", "accountNumber"];

  return [
    {
      id: "numbers",
      title: country === "US" ? "The numbers a US transfer needs"
        : country === "OTHER" ? "The numbers an international transfer needs"
          : "The numbers a Canadian transfer needs",
      note: country === "CA"
        ? "Transit, institution and account are the three along the bottom of a cheque."
        : country === "US"
          ? "Routing and account are the two along the bottom of a cheque. Most US banks use a different routing number for wires, so add that too if you have one."
          : "An IBAN, or an account number with a SWIFT code.",
      fields: numbers,
    },
    {
      id: "who",
      title: "Who is being paid",
      fields: ["beneficiaryName", "beneficiaryAddress"],
    },
    {
      id: "bank",
      title: "Which bank",
      fields: country === "CA" || country === "US"
        ? ["bankName", "branchAddress", "accountType", "swiftCode"]
        : ["bankName", "branchAddress", "accountType"],
    },
  ];
}

/** Flat, for anything that wants the whole list. */
export function payFieldsFor(country) {
  return payGroupsFor(country).flatMap((g) => g.fields);
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
      /* Quietly, because this runs on every visit to the Invoices page and a
         project with no payments function should not fill a console with
         failures for a feature nobody has switched on. The card already says
         "no keys on this project", which covers both cases. */
      supabase.functions.invoke("payments", { body: { action: "health" } }).catch(() => null),
    ]);
    /* Three states, not two.
     *
     * "No keys on this project" was shown whenever the health check failed,
     * which is also what happens when the payments function has never been
     * deployed. Those are different problems with different fixes, and telling
     * somebody to add keys they may already have added is worse than saying
     * nothing.
     */
    const reachable = Boolean(health?.data?.ok);
    const configured = health?.data?.configured || {};
    return ["stripe", "paypal", "square"].map((k) => {
      const row = (rows || []).find((r) => r.provider === k);
      return {
        provider: k,
        enabled: Boolean(row?.enabled),
        feesTo: row?.fees_to || "me",
        configured: reachable && Boolean(configured[k]),
        reachable,
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
