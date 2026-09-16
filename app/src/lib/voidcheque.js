/* A void cheque, as a printable page.
 *
 * The thing a bank or a payroll department asks for when they want to send you
 * money. Photographing a real one means finding a chequebook; most people with
 * a business account no longer have one.
 *
 * This is not a forgery of a negotiable instrument and must not look like one:
 * it is a statement of account details in the shape people recognise, marked
 * VOID across the face, with no signature line and no amount box. A cheque
 * without those cannot be presented.
 *
 * Opened in a window and printed, rather than built as a PDF here. The browser
 * already renders and exports pages perfectly well, and every print dialogue
 * offers "save as PDF": a library to do the same would be a megabyte of
 * dependency for a worse result.
 */

const esc = (v) =>
  String(v ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

/* The line along the bottom of a cheque, which is the part anybody keying in a
 * payment actually reads.
 *
 * Canada and the United States order it differently, so a cheque that looks
 * right to a clerk in one looks wrong in the other. The symbols are the real
 * MICR delimiters, set in a normal font: this is for reading, not for a
 * machine, and pretending otherwise would be the forgery. */
function micrLine(d) {
  const a = esc(d.accountNumber);
  if (d.country === "US") {
    return `⑆${esc(d.routingNumber)}⑆ ${a}⑈`;
  }
  if (d.country === "CA") {
    return `⑈000⑈ ⑆${esc(d.transitNumber)}⑆${esc(d.institutionNumber)}⑆ ${a}⑈`;
  }
  return `${esc(d.iban || a)}${d.swiftCode ? ` · ${esc(d.swiftCode)}` : ""}`;
}

function detailRows(d) {
  const rows = [
    ["Beneficiary", d.beneficiaryName],
    ["Beneficiary address", d.beneficiaryAddress],
    ["Bank", d.bankName],
    ["Branch address", d.branchAddress],
    ["Account number", d.accountNumber],
    ["Account type", d.accountType],
  ];
  if (d.country === "CA") {
    rows.push(["Transit number", d.transitNumber], ["Institution number", d.institutionNumber]);
  }
  if (d.country === "US") rows.push(["Routing number", d.routingNumber]);
  if (d.iban) rows.push(["IBAN", d.iban]);
  if (d.swiftCode) rows.push(["SWIFT / BIC", d.swiftCode]);
  return rows.filter(([, v]) => String(v || "").trim());
}

export function voidChequeHtml(d, business) {
  const rows = detailRows(d);
  const today = new Date().toISOString().slice(0, 10);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Void cheque · ${esc(business || d.beneficiaryName || "")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  @page { size: A4; margin: 18mm; }
  body { margin:0; font-family:'Inter',-apple-system,Helvetica,Arial,sans-serif; color:#1C1917;
    background:#FAF9F7; padding:22px; }
  .sheet { max-width:190mm; margin:0 auto; }
  h1 { font-size:19px; margin:0 0 3px; font-weight:600; letter-spacing:-.01em }
  .sub { color:#5A534E; font-size:14px; margin:0 0 18px }

  /* The cheque face. Deliberately missing an amount box, a payee line and a
     signature line, because those are what make a cheque negotiable. */
  .cheque { position:relative; border:1px solid #E2DDD6; border-radius:10px; background:#fff;
    padding:20px 22px 16px; overflow:hidden; }
  .cheque .bankline { display:flex; justify-content:space-between; align-items:flex-start; gap:20px }
  .who { font-size:15px; font-weight:600 }
  .addr { font-size:12.5px; color:#5A534E; line-height:1.45; margin-top:2px; white-space:pre-line }
  .bank { text-align:right; font-size:13px; color:#5A534E; line-height:1.45 }
  .bank b { display:block; color:#1C1917; font-size:14px; font-weight:600 }

  .void { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    pointer-events:none }
  .void span { font-size:74px; font-weight:700; letter-spacing:.18em; color:rgba(196,68,47,.17);
    transform:rotate(-14deg); }

  .micr { margin-top:34px; padding-top:12px; border-top:1px dashed #E2DDD6;
    font-family:'Geist Mono',ui-monospace,monospace; font-size:16px; letter-spacing:.06em }
  .micrnote { font-size:11.5px; color:#8A827B; margin-top:4px }

  table { border-collapse:collapse; width:100%; margin-top:20px; font-size:14px }
  th { text-align:left; font-weight:500; color:#5A534E; padding:7px 12px 7px 0; width:42%;
    border-bottom:1px solid #EDEAE5; vertical-align:top }
  td { padding:7px 0; border-bottom:1px solid #EDEAE5; font-family:'Geist Mono',ui-monospace,monospace }
  footer { margin-top:18px; font-size:11.5px; color:#8A827B; line-height:1.55 }
  .noprint { margin-bottom:16px }
  button { background:#F59E0B; color:#241703; border:none; border-radius:999px; padding:11px 20px;
    font:inherit; font-weight:600; font-size:15px; cursor:pointer }
  @media print { .noprint { display:none } body { background:#fff; padding:0 } }
</style></head>
<body>
<div class="sheet">
  <div class="noprint"><button onclick="window.print()">Save as PDF or print</button></div>

  <h1>Void cheque</h1>
  <p class="sub">Account details for ${esc(business || d.beneficiaryName || "")}, issued ${today}.</p>

  <div class="cheque">
    <div class="void"><span>VOID</span></div>
    <div class="bankline">
      <span>
        <div class="who">${esc(d.beneficiaryName)}</div>
        <div class="addr">${esc(d.beneficiaryAddress)}</div>
      </span>
      <span class="bank">
        <b>${esc(d.bankName)}</b>
        ${esc(d.branchAddress)}
      </span>
    </div>
    <div class="micr">${micrLine(d)}</div>
    <div class="micrnote">
      ${d.country === "CA" ? "transit · institution · account"
        : d.country === "US" ? "routing · account" : "account"}
    </div>
  </div>

  <table>
    ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}
  </table>

  ${d.note ? `<p class="sub" style="margin-top:14px">${esc(d.note)}</p>` : ""}

  <footer>
    This sheet states account details for receiving payment. It is not a cheque and cannot be
    presented: there is no amount, no payee and no signature. Treat it as you would a void cheque,
    because it carries the same information.<br/>
    Produced by ${esc(business || "Brasstally")} through Brasstally on ${today}.
  </footer>
</div>
</body></html>`;
}

/** Open it in a window, ready to print. */
export function openVoidCheque(d, business) {
  const w = window.open("", "_blank", "noopener,width=880,height=1000");
  if (!w) return { ok: false, error: "Your browser blocked the window. Allow pop-ups for this site and try again." };
  w.document.write(voidChequeHtml(d, business));
  w.document.close();
  return { ok: true };
}
