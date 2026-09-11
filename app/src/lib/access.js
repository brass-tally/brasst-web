/* ================= the write lock =================
   One flag, set when a ledger loads, checked by every write in every module.

   The interface already hides a reader's buttons and every mutator in the app
   returns early. Both were true and neither was enough: contacts, sharing and
   the invoice tray call their own libraries directly, so a path that never
   touches a mutator never meets the guard. Each new feature added another way
   round, which is what a policy enforced in the caller always ends up meaning.

   This is enforced in the callee. A write cannot run without passing it,
   because the write itself is what asks.

   It is not the security boundary. Row level security is, and it holds
   whatever the browser believes. This stops a reader watching an edit appear
   to work and then vanish on reload, which is the part that made the app look
   broken and made a visitor think they had changed somebody's books. */

let readOnly = false;
let reason = "";

export function setLedgerAccess({ readOnly: ro, ledgerName }) {
  readOnly = Boolean(ro);
  reason = ro
    ? `${ledgerName || "This ledger"} is shared with you to read. Ask the owner if something needs an edit.`
    : "";
}

export const isReadOnly = () => readOnly;
export const readOnlyReason = () => reason;

/* Throws, rather than returning false.
   A write that silently does nothing is the failure this exists to prevent,
   so the call has to end. Callers that already catch will report it; the
   message is written to be shown to a person. */
export function assertWritable() {
  if (readOnly) {
    const e = new Error(reason || "This ledger is read only.");
    e.code = "READ_ONLY";
    throw e;
  }
}

/** For callers that would rather branch than catch. */
export function refuseIfReadOnly() {
  return readOnly ? { ok: false, error: reason, code: "READ_ONLY" } : null;
}
