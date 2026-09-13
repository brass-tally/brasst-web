/* Money you mean to spend.
 *
 * Deliberately not obligations. A payable is somebody else's claim on you; a
 * plan is your own intention and costs nothing to abandon. Keeping them in
 * separate tables is what stops a trip you might take from appearing in the
 * figure you decide against.
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

const rowToPlan = (r) => ({
  id: r.id,
  label: r.label,
  amount: Number(r.amount) || 0,
  category: r.category || undefined,
  bucket: r.bucket || "other",
  expectedOn: r.expected_on || undefined,
  note: r.note || undefined,
  status: r.status,
  obligationId: r.obligation_id || undefined,
});

export async function listPlanned(ledgerId) {
  return soft("planned", async () => {
    const { data, error } = await supabase
      .from("planned_expenses")
      .select("*")
      .eq("ledger_id", ledgerId)
      .order("expected_on", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return (data || []).map(rowToPlan);
  }, []);
}

export async function addPlanned(ledgerId, plan) {
  assertWritable();
  return soft("add plan", async () => {
    const { data, error } = await supabase
      .from("planned_expenses")
      .insert({
        ledger_id: ledgerId,
        label: plan.label,
        amount: Number(plan.amount) || 0,
        category: plan.category || null,
        bucket: plan.bucket || "other",
        expected_on: plan.expectedOn || null,
        note: plan.note || null,
      })
      .select()
      .single();
    if (error) throw error;
    return rowToPlan(data);
  }, null);
}

export async function updatePlanned(id, patch) {
  assertWritable();
  return soft("update plan", async () => {
    const body = {};
    if (patch.label != null) body.label = patch.label;
    if (patch.amount != null) body.amount = Number(patch.amount) || 0;
    if (patch.category !== undefined) body.category = patch.category || null;
    if (patch.bucket) body.bucket = patch.bucket;
    if (patch.expectedOn !== undefined) body.expected_on = patch.expectedOn || null;
    if (patch.note !== undefined) body.note = patch.note || null;
    if (patch.status) body.status = patch.status;
    if (patch.obligationId !== undefined) body.obligation_id = patch.obligationId || null;
    const { error } = await supabase.from("planned_expenses").update(body).eq("id", id);
    if (error) throw error;
    return { ok: true };
  }, { ok: false });
}

export async function dropPlanned(id) {
  assertWritable();
  return soft("drop plan", async () => {
    const { error } = await supabase.from("planned_expenses").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  }, { ok: false });
}

/** What is planned, by when, ignoring anything abandoned or already committed. */
export function plannedTotals(plans = [], withinDays = 90) {
  const open = plans.filter((p) => p.status === "planned");
  const horizon = new Date(Date.now() + withinDays * 864e5).toISOString().slice(0, 10);
  const soon = open.filter((p) => p.expectedOn && p.expectedOn <= horizon);
  return {
    count: open.length,
    total: open.reduce((n, p) => n + Math.abs(p.amount), 0),
    soonCount: soon.length,
    soon: soon.reduce((n, p) => n + Math.abs(p.amount), 0),
  };
}
