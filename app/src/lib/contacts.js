/* ================= contacts =================
   The people and businesses a ledger deals with, so a name is chosen once and
   then picked rather than retyped.

   Tolerates migration 0029 not having run: without the table every field
   behaves exactly as it did before, as free text. */

import { supabase } from "./supabase";
import { assertWritable } from "./access";

/* The three you asked for, plus two the app already needs.

   `client` because receivables exist: the party on money owed to you is not a
   contractor, an employee or a vendor, and forcing one of those on them makes
   the role field lie.

   `accountant` because the sharing field asks for one by name.

   Both are easy to remove if you would rather have three. */
export const CONTACT_ROLES = [
  { id: "contractor", label: "Contractor", hint: "Paid per job" },
  { id: "vendor",     label: "Vendor",     hint: "Suppliers and services" },
  { id: "employee",   label: "Employee",   hint: "On payroll" },
  { id: "client",     label: "Client",     hint: "Pays you" },
  { id: "accountant", label: "Accountant", hint: "Reads your books" },
];

export const roleLabel = (id) => CONTACT_ROLES.find((r) => r.id === id)?.label || "Contact";

const soft = async (label, fn, fallback) => {
  try { return await fn(); } catch (e) {
    console.warn(`contacts: ${label} unavailable:`, e?.message || e);
    return fallback;
  }
};

const shape = (r) => ({
  id: r.id, name: r.name, email: r.email || undefined, phone: r.phone || undefined,
  role: r.role, note: r.note || undefined, createdAt: r.created_at,
});

export async function listContacts(ledgerId) {
  return soft("list", async () => {
    const { data, error } = await supabase
      .from("contacts").select("*").eq("ledger_id", ledgerId).order("name");
    if (error) throw error;
    return (data || []).map(shape);
  }, []);
}

export async function addContact(ledgerId, { name, email, phone, role, note }) {
  assertWritable();
  const clean = String(name || "").replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, error: "A name is needed." };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) {
    return { ok: false, error: "That does not look like an email address." };
  }
  try {
    const { data, error } = await supabase.from("contacts").insert({
      ledger_id: ledgerId, name: clean,
      email: email ? String(email).trim().toLowerCase() : null,
      phone: phone || null, role: role || "vendor", note: note || null,
    }).select().single();
    if (error) throw error;
    return { ok: true, contact: shape(data) };
  } catch (e) {
    const msg = String(e?.message || e);
    if (e?.code === "23505" || /duplicate key/i.test(msg)) {
      return { ok: false, error: `${clean} is already in your contacts.` };
    }
    if (e?.code === "PGRST205" || /does not exist|schema cache/i.test(msg)) {
      return { ok: false, error: "Contacts need migration 0029. Run it and try again." };
    }
    return { ok: false, error: msg };
  }
}

export async function updateContact(id, patch) {
  assertWritable();
  return soft("update", async () => {
    const { error } = await supabase.from("contacts")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return { ok: true };
  }, { ok: false });
}

export async function deleteContact(id) {
  assertWritable();
  return soft("delete", async () => {
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  }, { ok: false });
}

/* Matching for the picker.

   Ranked rather than filtered: a name that starts with what you typed comes
   before one that merely contains it, because someone typing "ac" wants Acme
   before Pacific Hardware. Email is searched too, since half the fields this
   feeds are email fields. */
export function matchContacts(contacts, query, { field = "name", roles = null, limit = 6 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const pool = roles ? contacts.filter((c) => roles.includes(c.role)) : contacts;
  // Nothing typed: show the most useful few rather than an empty menu.
  if (!q) return pool.slice(0, limit);
  if (field === "email") {
    const withEmail = pool.filter((c) => c.email);
    return rank(withEmail, q, limit);
  }
  return rank(pool, q, limit);
}

function rank(pool, q, limit) {
  const score = (c) => {
    const name = c.name.toLowerCase();
    const email = (c.email || "").toLowerCase();
    if (name.startsWith(q)) return 0;
    if (email.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    if (email.includes(q)) return 3;
    return 99;
  };
  return pool
    .map((c) => [score(c), c])
    .filter(([s]) => s < 99)
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, c]) => c);
}
