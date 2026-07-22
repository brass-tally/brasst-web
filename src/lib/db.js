// Data layer — everything the app knows about Supabase lives here.
// App state keeps the same shapes as before (camelCase, attachmentId, etc.);
// this file maps them to and from database rows.

import { supabase } from "./supabase";

/* ---------------- row <-> app-state mapping ---------------- */

const rowToTx = (r) => ({
  id: r.id,
  date: r.date,
  amount: Number(r.amount),
  type: r.type,
  category: r.category,
  description: r.description,
  account: r.account,
  recurrence: r.recurrence,
  subcategory: r.subcategory || undefined,
  payMethod: r.pay_method || "cash",
  creditId: r.credit_id || undefined,
  attachmentId: r.attachment_path || undefined,
  attachmentName: r.attachment_name || undefined,
});

const txToRow = (t) => ({
  id: t.id,
  date: t.date,
  amount: t.amount,
  type: t.type,
  category: t.category,
  description: t.description || "",
  account: t.account || "business",
  recurrence: t.recurrence === "recurring" ? "recurring" : "once",
  subcategory: t.subcategory || null,
  pay_method: t.payMethod === "credits" ? "credits" : "cash",
  credit_id: t.creditId || null,
  attachment_path: t.attachmentId || null,
  attachment_name: t.attachmentName || null,
});

const rowToOb = (r) => ({
  id: r.id,
  party: r.party,
  description: r.description,
  amount: Number(r.amount),
  dueDate: r.due_date,
  status: r.status,
  settledOn: r.settled_on || undefined,
  account: r.account,
  recurrence: r.recurrence,
  category: r.category || undefined,
  subcategory: r.subcategory || undefined,
  frequency: r.frequency || undefined,
  payMethod: r.pay_method || "cash",
  creditId: r.credit_id || undefined,
  attachmentId: r.attachment_path || undefined,
  attachmentName: r.attachment_name || undefined,
});

const obToRow = (kind, o) => ({
  id: o.id,
  kind: kind === "receivables" ? "receivable" : "payable",
  party: o.party,
  description: o.description || "",
  amount: o.amount,
  due_date: o.dueDate || null,
  status: o.status || "open",
  settled_on: o.settledOn || null,
  account: o.account || "business",
  recurrence: o.recurrence === "recurring" ? "recurring" : "once",
  category: o.category || null,
  subcategory: o.subcategory || null,
  frequency: o.frequency || null,
  pay_method: o.payMethod === "credits" ? "credits" : "cash",
  credit_id: o.creditId || null,
  attachment_path: o.attachmentId || null,
  attachment_name: o.attachmentName || null,
});

/* ---------------- first-run seed (from April_2026_Monthly_budget.xlsx) ---------------- */

// anchor: "$6,622.36 as of Feb 28 2026" — the March seed transactions count from there
const SEED_SETTINGS = { starting_balance: 6622.36, anchor_date: "2026-02-28", currency: "CAD", theme: "dark" };

const SEED_CATEGORIES = [
  ...[
    ["GENIE AI", 1800, "business", ["Software & SaaS", "Hosting & Cloud", "Salaries", "Marketing", "Equipment"]],
    ["Home", 1200, "personal", ["Mortgage", "Utilities", "Maintenance"]], ["Food", 100, "personal"],
    ["Transportation", 50, "personal"], ["Pets", 30, "personal"], ["Travel", 0, "personal"],
    ["Health/medical", 0, "personal"], ["Utilities", 0, "personal"], ["Personal", 0, "personal"],
    ["Gifts", 0, "personal"], ["Debt", 0, "personal"], ["Other", 0, "personal"],
  ].map(([name, planned, account, subs], i) => ({ type: "expense", name, planned, account, subcategories: subs || [], sort: i })),
  ...[
    ["Paycheck", 4614, "personal"], ["Client revenue", 0, "business"], ["Bonus", 0, "personal"],
    ["Interest", 0, "personal"], ["Other", 1000, "personal"],
  ].map(([name, planned, account], i) => ({ type: "income", name, planned, account, sort: i })),
];

const R = "recurring", O = "once";
const SEED_TRANSACTIONS = [
  ["2026-03-01", 1250, "expense", "GENIE AI", "Syed salary", "business", R],
  ["2026-03-09", 24, "expense", "GENIE AI", "Codex (Chat — Syed)", "business", R],
  ["2026-03-09", 68, "expense", "GENIE AI", "LiveKit", "business", R],
  ["2026-03-10", 16.73, "expense", "GENIE AI", "Hostinger", "business", R],
  ["2026-03-10", 30.51, "expense", "GENIE AI", "Figma", "business", R],
  ["2026-03-10", 70, "expense", "GENIE AI", "Vercel", "business", R],
  ["2026-03-10", 45, "expense", "GENIE AI", "Figma", "business", R],
  ["2026-03-10", 40, "expense", "GENIE AI", "Canva", "business", R],
  ["2026-03-10", 37.08, "expense", "GENIE AI", "ALBIS G-suite", "business", R],
  ["2026-03-10", 15, "expense", "GENIE AI", "Sign", "business", R],
  ["2026-03-11", 11.30, "expense", "GENIE AI", "Anthropic (Claude — Syed)", "business", R],
  ["2026-03-13", 56.49, "expense", "GENIE AI", "Amazon (Video)", "business", O],
  ["2026-03-13", 129.24, "expense", "GENIE AI", "Amazon (Video)", "business", O],
  ["2026-03-10", 1200, "expense", "Home", "Mortgage", "personal", R],
  ["2026-03-15", 1100, "expense", "Travel", "Morocco flight ticket", "personal", O],
  ["2026-03-15", 2000, "expense", "Travel", "Morocco hotel stay", "personal", O],
  ["2026-03-15", 400, "expense", "Travel", "Morocco car rental", "personal", O],
  ["2026-03-15", 500, "expense", "Travel", "Morocco activities", "personal", O],
  ["2026-03-02", 4709, "income", "Paycheck", "Salary — P+", "personal", R],
  ["2026-03-02", 1350, "income", "Paycheck", "Salary — P+", "personal", R],
  ["2026-03-02", 1000, "income", "Other", "Gov. payment", "personal", O],
].map(([date, amount, type, category, description, account, recurrence]) => ({
  date, amount, type, category, description, account, recurrence,
}));

async function seed() {
  const { error: e1 } = await supabase.from("settings").insert(SEED_SETTINGS);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("categories").insert(SEED_CATEGORIES);
  if (e2) throw e2;
  const { error: e3 } = await supabase.from("transactions").insert(SEED_TRANSACTIONS);
  if (e3) throw e3;
}

/* ---------------- load everything into app-state shape ---------------- */

export async function loadAll() {
  let { data: settings, error } = await supabase.from("settings").select("*").maybeSingle();
  if (error) throw error;
  if (!settings) {
    await seed();
    ({ data: settings } = await supabase.from("settings").select("*").maybeSingle());
  }

  const [cats, txs, obs] = await Promise.all([
    supabase.from("categories").select("*").order("sort"),
    supabase.from("transactions").select("*").order("date", { ascending: false }),
    supabase.from("obligations").select("*").order("created_at", { ascending: false }),
  ]);
  if (cats.error) throw cats.error;
  if (txs.error) throw txs.error;
  if (obs.error) throw obs.error;

  // credit pools are optional — tolerate a missing table until the migration runs
  let credits = [];
  try {
    const { data: cr } = await supabase.from("credits").select("*").order("created_at");
    credits = (cr || []).map((c) => ({ id: c.id, name: c.name, initial: Number(c.initial) }));
  } catch { /* table not created yet */ }

  // anchor history is optional — tolerate a missing table if the migration hasn't run yet
  let anchorHistory = [];
  try {
    const { data: anchors } = await supabase
      .from("balance_anchors").select("*")
      .order("created_at", { ascending: false }).limit(20);
    anchorHistory = (anchors || []).map((a) => ({
      amount: Number(a.amount),
      date: a.anchor_date,
      source: a.source,
      createdAt: (a.created_at || "").slice(0, 10),
    }));
  } catch { /* table not created yet */ }

  return {
    settings: {
      startingBalance: Number(settings.starting_balance),
      anchorDate: settings.anchor_date || "1970-01-01",
      currency: settings.currency,
      theme: settings.theme,
    },
    categories: {
      expense: cats.data.filter((c) => c.type === "expense").map((c) => ({ name: c.name, planned: Number(c.planned), account: c.account, subs: c.subcategories || [] })),
      income: cats.data.filter((c) => c.type === "income").map((c) => ({ name: c.name, planned: Number(c.planned), account: c.account, subs: c.subcategories || [] })),
    },
    transactions: txs.data.map(rowToTx),
    receivables: obs.data.filter((o) => o.kind === "receivable").map(rowToOb),
    payables: obs.data.filter((o) => o.kind === "payable").map(rowToOb),
    anchorHistory,
    credits,
  };
}

/* ---------------- mutations ---------------- */

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
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) row[col] = patch[k] ?? null;
  }
  const { error } = await supabase.from("transactions").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw error;
}

export async function setPlanned(type, name, planned) {
  const { error } = await supabase.from("categories").update({ planned }).eq("type", type).eq("name", name);
  if (error) throw error;
}

export async function updateSubcategories(type, name, subs) {
  const { error } = await supabase.from("categories").update({ subcategories: subs }).eq("type", type).eq("name", name);
  if (error) throw error;
}

export async function insertObligation(kind, item) {
  const { error } = await supabase.from("obligations").insert(obToRow(kind, item));
  if (error) throw error;
}

export async function updateObligation(id, patch) {
  const map = {
    party: "party", description: "description", amount: "amount", dueDate: "due_date",
    status: "status", settledOn: "settled_on", account: "account", recurrence: "recurrence",
    category: "category", subcategory: "subcategory", frequency: "frequency",
    payMethod: "pay_method", creditId: "credit_id",
  };
  const row = {};
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) row[col] = patch[k] ?? null;
  }
  const { error } = await supabase.from("obligations").update(row).eq("id", id);
  if (error) throw error;
}

export async function insertCredit(credit) {
  const { error } = await supabase.from("credits").insert({ id: credit.id, name: credit.name, initial: credit.initial });
  if (error) throw error;
}

export async function deleteCredit(id) {
  const { error } = await supabase.from("credits").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteObligation(id) {
  const { error } = await supabase.from("obligations").delete().eq("id", id);
  if (error) throw error;
}

// Reconcile: "my real combined balance was `amount` as of `date`".
// Also logs the event to balance_anchors so there's an audit trail.
export async function setAnchor(amount, date, source = "manual") {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("settings")
    .update({ starting_balance: amount, anchor_date: date })
    .eq("user_id", user.id);
  if (error) throw error;
  try {
    await supabase.from("balance_anchors").insert({ amount, anchor_date: date, source });
  } catch { /* history table optional until migration runs */ }
}

export async function setTheme(theme) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("settings").update({ theme }).eq("user_id", user.id);
  if (error) throw error;
}

export async function resetAll() {
  // wipe this user's rows (RLS also scopes every delete to the signed-in user), then reseed
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("transactions").delete().eq("user_id", user.id);
  await supabase.from("obligations").delete().eq("user_id", user.id);
  await supabase.from("categories").delete().eq("user_id", user.id);
  await supabase.from("settings").delete().eq("user_id", user.id);
  await seed();
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
    .from("invoices")
    .createSignedUrl(path, 3600, download ? { download: true } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeAttachment(path) {
  const { error } = await supabase.storage.from("invoices").remove([path]);
  if (error) throw error;
}
