import { supabase } from "./supabase";
import { assertWritable } from "./access";

/* Reading a card or account statement exported as CSV.
 *
 * For the accounts Plaid cannot reach. The case that prompted it is a Wise
 * card, which in Canada is prepaid and spends from the Wise balance: the RBC
 * feed only ever sees money going INTO Wise, never what the card then paid
 * for. Every subscription on it was invisible.
 *
 * Read by header name, never by position. Statements gain and reorder columns
 * between exports, and a parser keyed on "the third column" fails silently,
 * which for money is the worst way to fail.
 */

/* A CSV line into fields, honouring quotes and doubled quotes. Merchant names
   contain commas ("NOTION LABS, INC.") and a naive split breaks them. */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/* Find a column by any of the names a bank might give it. */
function findCol(headers, names) {
  const lower = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const n of names) {
    const want = n.toLowerCase().replace(/[^a-z0-9]/g, "");
    const i = lower.indexOf(want);
    if (i >= 0) return i;
  }
  return -1;
}

/* Dates arrive as 2026-09-14, 14-09-2026, 14/09/2026 or 09/14/2026. The
   ambiguous one is resolved by the statement as a whole: if any day exceeds
   twelve, that column is the day. Guessing per row would put the same
   statement's lines in different months. */
function makeDateParser(samples) {
  let dayFirst = true;
  for (const s of samples) {
    const m = String(s).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (!m) continue;
    if (Number(m[2]) > 12) { dayFirst = false; break; }
    if (Number(m[1]) > 12) { dayFirst = true; break; }
  }
  return (raw) => {
    const s = String(raw || "").trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (m) {
      const [d, mo] = dayFirst ? [m[1], m[2]] : [m[2], m[1]];
      return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return null;
  };
}

const num = (v) => {
  const n = Number(String(v || "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Parse a statement into bank lines.
 * Returns { lines, source, skipped, problems } and never throws on a bad row:
 * a statement with one odd line should import the other two hundred.
 */
export function parseStatement(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (raw.length < 2) return { lines: [], source: null, skipped: 0, problems: ["The file is empty."] };

  const headers = splitCsvLine(raw[0]);
  const col = {
    id: findCol(headers, ["TransferWise ID", "Wise ID", "ID", "Transaction ID", "Reference"]),
    date: findCol(headers, ["Date", "Created on", "Transaction Date", "Posted Date", "Date Time"]),
    amount: findCol(headers, ["Amount", "Transaction Amount"]),
    debit: findCol(headers, ["Debit", "Withdrawals", "Money out"]),
    credit: findCol(headers, ["Credit", "Deposits", "Money in"]),
    currency: findCol(headers, ["Currency", "Source currency"]),
    merchant: findCol(headers, ["Merchant", "Payee Name", "Payee"]),
    description: findCol(headers, ["Description", "Details", "Transaction Description", "Narrative"]),
    direction: findCol(headers, ["Direction", "Type"]),
  };

  const source = headers.some((h) => /transferwise|wise/i.test(h)) ? "wise" : "csv";

  const problems = [];
  if (col.date < 0) problems.push("No date column was found.");
  if (col.amount < 0 && col.debit < 0 && col.credit < 0) problems.push("No amount column was found.");
  if (problems.length) return { lines: [], source, skipped: raw.length - 1, problems };

  const rows = raw.slice(1).map(splitCsvLine);
  const parseDate = makeDateParser(rows.map((r) => r[col.date]));

  const lines = [];
  let skipped = 0;

  rows.forEach((r, n) => {
    const date = parseDate(r[col.date]);
    if (!date) { skipped += 1; return; }

    let amount;
    let direction;
    if (col.amount >= 0) {
      const a = num(r[col.amount]);
      if (Number.isNaN(a)) { skipped += 1; return; }
      /* Wise writes outgoing as negative, and a Direction column when it has
         one. Trust the column over the sign when both are present. */
      const d = col.direction >= 0 ? String(r[col.direction]).toUpperCase() : "";
      direction = d.includes("OUT") || d.includes("DEBIT") ? "debit"
        : d.includes("IN") || d.includes("CREDIT") ? "credit"
          : a < 0 ? "debit" : "credit";
      amount = Math.abs(a);
    } else {
      const out = num(r[col.debit]);
      const inn = num(r[col.credit]);
      if (!Number.isNaN(out) && out) { amount = Math.abs(out); direction = "debit"; }
      else if (!Number.isNaN(inn) && inn) { amount = Math.abs(inn); direction = "credit"; }
      else { skipped += 1; return; }
    }
    if (!amount) { skipped += 1; return; }

    /* The merchant when there is one, because "Card transaction of 42.10 CAD
       issued by Google" is a description and "Google" is a name. */
    const merchant = col.merchant >= 0 ? r[col.merchant] : "";
    const description = merchant || (col.description >= 0 ? r[col.description] : "") || "Statement line";

    /* A stable id, so importing the same statement twice changes nothing. The
       bank's own id when it gives one; otherwise built from the line itself,
       which repeats only if the bank really did post an identical line. */
    const id = col.id >= 0 && r[col.id]
      ? `${source}:${r[col.id]}`
      : `${source}:${date}:${direction}:${amount.toFixed(2)}:${description.slice(0, 40)}:${n}`;

    lines.push({
      externalId: id,
      date,
      amount,
      direction,
      currency: col.currency >= 0 ? (r[col.currency] || null) : null,
      description: description.trim(),
    });
  });

  return { lines, source, skipped, problems };
}

/* ---------------- storing them ---------------- */


/**
 * Put parsed lines into the ledger's bank feed, under a connection named for
 * where they came from. Creates the connection the first time.
 *
 * Idempotent: the unique key on (connection, external id) means a statement
 * imported twice, or two overlapping statements, add each line exactly once.
 */
export async function importStatement(ledgerId, label, lines) {
  assertWritable();
  try {
    if (!lines.length) return { ok: false, error: "There were no lines to import." };

    const { data: existing } = await supabase
      .from("bank_connections").select("id")
      .eq("ledger_id", ledgerId).eq("source", "import").eq("institution", label)
      .maybeSingle();

    let connectionId = existing?.id;
    if (!connectionId) {
      const { data: made, error } = await supabase
        .from("bank_connections")
        .insert({ ledger_id: ledgerId, institution: label, source: "import", status: "ok" })
        .select("id").single();
      if (error) throw error;
      connectionId = made.id;
    }

    const rows = lines.map((l) => ({
      ledger_id: ledgerId,
      connection_id: connectionId,
      plaid_txn_id: l.externalId,
      date: l.date,
      amount: l.amount,
      direction: l.direction,
      description: l.description,
      pending: false,
    }));

    /* In batches. A year of card statement is a few hundred rows, and one
       request that size is fine, but a lifetime export is not. */
    let added = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const { data, error } = await supabase
        .from("bank_transactions")
        .upsert(batch, { onConflict: "connection_id,plaid_txn_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      added += (data || []).length;
    }

    await supabase.from("bank_connections").update({
      last_import_at: new Date().toISOString(),
      last_import_lines: added,
      last_synced: new Date().toISOString(),
    }).eq("id", connectionId);

    return { ok: true, added, already: lines.length - added, connectionId };
  } catch (e) {
    console.warn("statement import failed:", e?.message || e);
    return { ok: false, error: e?.message || "The statement could not be imported." };
  }
}
