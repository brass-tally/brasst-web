// Data layer — everything the app knows about Supabase lives here.
// Multi-ledger: every row belongs to a ledger; setLedgerId() scopes all reads/writes.

import { supabase } from "./supabase";

let LID = null; // current ledger id — set before any data call
export const setLedgerId = (id) => { LID = id; };

/* ---------------- ledgers ---------------- */

export async function listLedgers() {
  const { data, error } = await supabase.from("ledgers").select("*").order("created_at");
  if (error) {
    // most common cause: multi-ledger migration not run yet
    const e = new Error(error.message);
    e.code = "LEDGERS_MISSING";
    throw e;
  }
  return (data || []).map((l) => ({
    id: l.id, name: l.name, kind: l.kind, currency: l.currency,
    startingBalance: Number(l.starting_balance), anchorDate: l.anchor_date, fye: l.fye || "12-31",
  }));
}

const BUSINESS_CATS = {
  expense: [
    ["Salaries & contractors", ["Salaries", "Contractors"]],
    ["Software & SaaS", []],
    ["Hosting & Cloud", []],
    ["Marketing", []],
    ["Equipment", []],
    ["Office & admin", []],
    ["Professional fees", ["Accounting", "Legal"]],
    ["Travel", []],
    ["Bank fees & interest", []],
    ["Other", []],
  ],
  income: [["Client revenue", []], ["Grants & credits", []], ["Interest", []], ["Other", []]],
};
const PERSONAL_CATS = {
  expense: [
    ["Home", ["Mortgage/Rent", "Utilities", "Maintenance"]],
    ["Food", []], ["Transportation", []], ["Health", []], ["Personal", []],
    ["Gifts", []], ["Travel", []], ["Pets", []], ["Debt", []], ["Other", []],
  ],
  income: [["Paycheck", []], ["Bonus", []], ["Interest", []], ["Other", []]],
};

export async function createLedger({ name, kind, startingBalance = 0, anchorDate }) {
  const { data, error } = await supabase
    .from("ledgers")
    .insert({
      name, kind: kind === "personal" ? "personal" : "business",
      starting_balance: startingBalance, anchor_date: anchorDate || new Date().toISOString().slice(0, 10),
    })
    .select("*").single();
  if (error) throw error;
  const cats = kind === "personal" ? PERSONAL_CATS : BUSINESS_CATS;
  const rows = [];
  for (const type of ["expense", "income"]) {
    cats[type].forEach(([n, subs], i) => rows.push({
      ledger_id: data.id, type, name: n, planned: 0,
      account: kind === "personal" ? "personal" : "business",
      subcategories: subs, sort: i,
    }));
  }
  const { error: e2 } = await supabase.from("categories").insert(rows);
  if (e2) throw e2;
  return {
    id: data.id, name: data.name, kind: data.kind, currency: data.currency,
    startingBalance: Number(data.starting_balance), anchorDate: data.anchor_date, fye: data.fye || "12-31",
  };
}

export async function updateLedger(id, patch) {
  const row = {};
  if ("name" in patch) row.name = patch.name;
  if ("fye" in patch) row.fye = patch.fye;
  if ("startingBalance" in patch) row.starting_balance = patch.startingBalance;
  if ("anchorDate" in patch) row.anchor_date = patch.anchorDate;
  const { error } = await supabase.from("ledgers").update(row).eq("id", id);
  if (error) throw error;
}

/* ---------------- row <-> app-state mapping ---------------- */

const rowToTx = (r) => ({
  id: r.id, date: r.date, amount: Number(r.amount), type: r.type, category: r.category,
  description: r.description, account: r.account, recurrence: r.recurrence,
  subcategory: r.subcategory || undefined,
  payMethod: r.pay_method || "cash", creditId: r.credit_id || undefined,
  transferId: r.transfer_id || undefined, plExclude: !!r.pl_exclude,
  attachmentId: r.attachment_path || undefined, attachmentName: r.attachment_name || undefined,
});

const txToRow = (t) => ({
  id: t.id, ledger_id: LID, date: t.date, amount: t.amount, type: t.type, category: t.category,
  description: t.description || "", account: t.account || "business",
  recurrence: t.recurrence === "recurring" ? "recurring" : "once",
  subcategory: t.subcategory || null,
  pay_method: t.payMethod === "credits" ? "credits" : "cash", credit_id: t.creditId || null,
  transfer_id: t.transferId || null, pl_exclude: !!t.plExclude,
  attachment_path: t.attachmentId || null, attachment_name: t.attachmentName || null,
});

const rowToOb = (r) => ({
  id: r.id, party: r.party, description: r.description, amount: Number(r.amount),
  dueDate: r.due_date, status: r.status, settledOn: r.settled_on || undefined, settledTxId: r.settled_tx_id || undefined,
  account: r.account, recurrence: r.recurrence,
  category: r.category || undefined, subcategory: r.subcategory || undefined,
  frequency: r.frequency || undefined,
  payMethod: r.pay_method || "cash", creditId: r.credit_id || undefined,
  attachmentId: r.attachment_path || undefined, attachmentName: r.attachment_name || undefined,
});

const obToRow = (kind, o) => ({
  id: o.id, ledger_id: LID, kind: kind === "receivables" ? "receivable" : "payable",
  party: o.party, description: o.description || "", amount: o.amount,
  due_date: o.dueDate || null, status: o.status || "open", settled_on: o.settledOn || null, settled_tx_id: o.settledTxId || null,
  account: o.account || "business",
  recurrence: o.recurrence === "recurring" ? "recurring" : "once",
  category: o.category || null, subcategory: o.subcategory || null, frequency: o.frequency || null,
  pay_method: o.payMethod === "credits" ? "credits" : "cash", credit_id: o.creditId || null,
  attachment_path: o.attachmentId || null, attachment_name: o.attachmentName || null,
});

/* ---------------- load everything for the current ledger ---------------- */

export async function loadAll(ledger) {
  setLedgerId(ledger.id);

  // user-level prefs (theme) live in settings; create the row lazily
  let { data: settings } = await supabase.from("settings").select("*").maybeSingle();
  if (!settings) {
    await supabase.from("settings").insert({ starting_balance: 0 }).select().maybeSingle();
    settings = { theme: "dark", currency: "CAD" };
  }

  const [cats, txs, obs] = await Promise.all([
    supabase.from("categories").select("*").eq("ledger_id", ledger.id).order("sort"),
    supabase.from("transactions").select("*").eq("ledger_id", ledger.id).order("date", { ascending: false }),
    supabase.from("obligations").select("*").eq("ledger_id", ledger.id).order("created_at", { ascending: false }),
  ]);
  if (cats.error) throw cats.error;
  if (txs.error) throw txs.error;
  if (obs.error) throw obs.error;

  let credits = [];
  try {
    const { data: cr } = await supabase.from("credits").select("*").eq("ledger_id", ledger.id).order("created_at");
    credits = (cr || []).map((c) => ({ id: c.id, name: c.name, initial: Number(c.initial), usedAdjustment: Number(c.used_adjustment || 0) }));
  } catch { /* optional */ }

  let anchorHistory = [];
  try {
    const { data: anchors } = await supabase
      .from("balance_anchors").select("*").eq("ledger_id", ledger.id)
      .order("created_at", { ascending: false }).limit(20);
    anchorHistory = (anchors || []).map((a) => ({
      amount: Number(a.amount), date: a.anchor_date, source: a.source, createdAt: (a.created_at || "").slice(0, 10),
    }));
  } catch { /* optional */ }

  // Missing table (migration not run) must not break the ledger — without it
  // the app simply falls back to asking about the gap every time.
  const consolidations = await listConsolidations(ledger.id);

  return {
    ledger,
    settings: {
      startingBalance: ledger.startingBalance,
      anchorDate: ledger.anchorDate || "1970-01-01",
      currency: ledger.currency,
      theme: settings.theme || "dark",
    },
    categories: {
      expense: cats.data.filter((c) => c.type === "expense").map((c) => ({ name: c.name, planned: Number(c.planned), account: c.account, subs: c.subcategories || [] })),
      income: cats.data.filter((c) => c.type === "income").map((c) => ({ name: c.name, planned: Number(c.planned), account: c.account, subs: c.subcategories || [] })),
    },
    transactions: txs.data.map(rowToTx),
    receivables: obs.data.filter((o) => o.kind === "receivable").map(rowToOb),
    payables: obs.data.filter((o) => o.kind === "payable").map(rowToOb),
    anchorHistory,
    consolidations,
    credits,
  };
}

/* ---------------- consolidation history ---------------- */

const rowToConsolidation = (r) => ({
  id: r.id,
  createdAt: r.created_at,
  kind: r.kind || "reconcile",
  signature: r.signature || null,
  deltaBefore: r.delta_before == null ? null : Number(r.delta_before),
  deltaAfter: r.delta_after == null ? null : Number(r.delta_after),
  unexplainedBefore: r.unexplained_before == null ? null : Number(r.unexplained_before),
  unexplainedAfter: r.unexplained_after == null ? null : Number(r.unexplained_after),
  matchedCount: r.matched_count || 0,
  createdCount: r.created_count || 0,
  ignoredCount: r.ignored_count || 0,
  unmatchedCount: r.unmatched_count || 0,
  duplicatesRemoved: r.duplicates_removed || 0,
  duplicateAmount: Number(r.duplicate_amount || 0),
  openBank: r.open_bank || 0,
  openBooks: r.open_books || 0,
  items: Array.isArray(r.items) ? r.items : [],
  note: r.note || null,
});

export async function listConsolidations(ledgerId, limit = 30) {
  try {
    const { data, error } = await supabase
      .from("consolidations").select("*").eq("ledger_id", ledgerId)
      .order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(rowToConsolidation);
  } catch (e) {
    console.error("consolidations:", e);
    return [];
  }
}

/** Write one finished run. Throws if the table isn't there — the caller says so,
 *  because a run nobody filed is a run the app will ask for again. */
export async function logConsolidation(ledgerId, run) {
  const { data, error } = await supabase.from("consolidations").insert({
    ledger_id: ledgerId,
    kind: run.kind || "reconcile",
    signature: run.signature || null,
    delta_before: run.deltaBefore ?? null,
    delta_after: run.deltaAfter ?? null,
    unexplained_before: run.unexplainedBefore ?? null,
    unexplained_after: run.unexplainedAfter ?? null,
    matched_count: run.matchedCount || 0,
    created_count: run.createdCount || 0,
    ignored_count: run.ignoredCount || 0,
    unmatched_count: run.unmatchedCount || 0,
    duplicates_removed: run.duplicatesRemoved || 0,
    duplicate_amount: run.duplicateAmount || 0,
    open_bank: run.openBank || 0,
    open_books: run.openBooks || 0,
    items: run.items || [],
    note: run.note || null,
  }).select("*").single();
  if (error) throw error;
  return rowToConsolidation(data);
}

/* ---------------- mutations (all scoped to the current ledger) ---------------- */

export async function insertTransaction(tx) {
  const { error } = await supabase.from("transactions").insert(txToRow(tx));
  if (error) throw error;
}

export async function insertTransactions(txs) {
  if (!txs.length) return;
  const { error } = await supabase.from("transactions").insert(txs.map(txToRow));
  if (error) throw error;
}

export async function updateTransaction(id, patch) {
  const map = {
    date: "date", amount: "amount", type: "type", category: "category",
    description: "description", account: "account", recurrence: "recurrence", subcategory: "subcategory",
    payMethod: "pay_method", creditId: "credit_id",
    attachmentId: "attachment_path", attachmentName: "attachment_name",
  };
  const row = {};
  for (const [k, col] of Object.entries(map)) if (k in patch) row[col] = patch[k] ?? null;
  const { error } = await supabase.from("transactions").update(row).eq("id", id);
  if (error) throw error;
}

// lightweight peek at another ledger's category names (for routing the incoming side of a payment)
export async function fetchCategoryNames(ledgerId, type) {
  const { data, error } = await supabase.from("categories").select("name").eq("ledger_id", ledgerId).eq("type", type).order("sort");
  if (error) throw error;
  return (data || []).map((c) => c.name);
}

// inter-ledger transfer: two linked rows, written atomically enough for our purposes
export async function insertTransfer({ fromId, toId, out, inn }) {
  const outRow = { ...txToRow(out), ledger_id: fromId };
  const inRow = { ...txToRow(inn), ledger_id: toId };
  const { error } = await supabase.from("transactions").insert([outRow, inRow]);
  if (error) throw error;
}

// removes BOTH sides of a transfer (RLS scopes it to this user's rows)
export async function deleteTransfer(transferId) {
  const { error } = await supabase.from("transactions").delete().eq("transfer_id", transferId);
  if (error) throw error;
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw error;
}

/** Duplicate cleanup: one statement for the whole group, so a half-deleted
 *  group can't be left behind if the connection drops mid-way. */
export async function deleteTransactions(ids) {
  if (!ids?.length) return;
  const { error } = await supabase.from("transactions").delete().in("id", ids);
  if (error) throw error;
}

export async function setPlanned(type, name, planned) {
  const { error } = await supabase.from("categories").update({ planned })
    .eq("ledger_id", LID).eq("type", type).eq("name", name);
  if (error) throw error;
}

export async function updateSubcategories(type, name, subs) {
  const { error } = await supabase.from("categories").update({ subcategories: subs })
    .eq("ledger_id", LID).eq("type", type).eq("name", name);
  if (error) throw error;
}

export async function insertObligation(kind, item) {
  const { error } = await supabase.from("obligations").insert(obToRow(kind, item));
  if (error) throw error;
}

export async function updateObligation(id, patch) {
  const map = {
    party: "party", description: "description", amount: "amount", dueDate: "due_date",
    status: "status", settledOn: "settled_on", settledTxId: "settled_tx_id", account: "account", recurrence: "recurrence",
    category: "category", subcategory: "subcategory", frequency: "frequency",
    payMethod: "pay_method", creditId: "credit_id",
  };
  const row = {};
  for (const [k, col] of Object.entries(map)) if (k in patch) row[col] = patch[k] ?? null;
  const { error } = await supabase.from("obligations").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteObligation(id) {
  const { error } = await supabase.from("obligations").delete().eq("id", id);
  if (error) throw error;
}

export async function insertCredit(credit) {
  const { error } = await supabase.from("credits").insert({
    id: credit.id, ledger_id: LID, name: credit.name, initial: credit.initial, used_adjustment: credit.usedAdjustment || 0,
  });
  if (error) throw error;
}

export async function updateCredit(id, patch) {
  const row = {};
  if ("name" in patch) row.name = patch.name;
  if ("initial" in patch) row.initial = patch.initial;
  if ("usedAdjustment" in patch) row.used_adjustment = patch.usedAdjustment;
  const { error } = await supabase.from("credits").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteCredit(id) {
  const { error } = await supabase.from("credits").delete().eq("id", id);
  if (error) throw error;
}

// Reconcile: anchors live on the ledger; history logged per ledger.
export async function setAnchor(amount, date, source = "manual") {
  const { error } = await supabase.from("ledgers").update({ starting_balance: amount, anchor_date: date }).eq("id", LID);
  if (error) throw error;
  try {
    await supabase.from("balance_anchors").insert({ ledger_id: LID, amount, anchor_date: date, source });
  } catch { /* history optional */ }
}

export async function setTheme(theme) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("settings").upsert({ user_id: user.id, theme }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function resetLedger(kind) {
  // wipe the current ledger's rows and reseed its default categories
  await supabase.from("transactions").delete().eq("ledger_id", LID);
  await supabase.from("obligations").delete().eq("ledger_id", LID);
  await supabase.from("credits").delete().eq("ledger_id", LID);
  await supabase.from("categories").delete().eq("ledger_id", LID);
  const cats = kind === "personal" ? PERSONAL_CATS : BUSINESS_CATS;
  const rows = [];
  for (const type of ["expense", "income"]) {
    cats[type].forEach(([n, subs], i) => rows.push({
      ledger_id: LID, type, name: n, planned: 0,
      account: kind === "personal" ? "personal" : "business", subcategories: subs, sort: i,
    }));
  }
  await supabase.from("categories").insert(rows);
}


/* ---------------- filing tracker ---------------- */

export async function getFiling(ledgerId, taxYear, form) {
  const { data, error } = await supabase.from("filings").select("*")
    .eq("ledger_id", ledgerId).eq("tax_year", taxYear).eq("form", form).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveFiling(ledgerId, taxYear, form, patch) {
  const row = { ledger_id: ledgerId, tax_year: taxYear, form, ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("filings")
    .upsert(row, { onConflict: "ledger_id,tax_year,form" }).select().single();
  if (error) throw error;
  return data;
}

/* ---------------- file storage (receipts & invoice PDFs) ---------------- */

export async function uploadAttachment(file, name, contentType) {
  const { data: { user } } = await supabase.auth.getUser();
  const safe = (name || "file").replace(/[^\w.\-]/g, "_");
  const path = `${user.id}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from("invoices").upload(path, file, {
    contentType: contentType || file.type || "application/octet-stream",
  });
  if (error) throw error;
  return path;
}

export async function signedUrl(path, { download = false } = {}) {
  const { data, error } = await supabase.storage
    .from("invoices").createSignedUrl(path, 3600, download ? { download: true } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeAttachment(path) {
  const { error } = await supabase.storage.from("invoices").remove([path]);
  if (error) throw error;
}
