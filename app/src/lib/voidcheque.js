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
  if (d.country === "US") {
    rows.push(["Routing number (ACH)", d.routingNumber]);
    /* The second number, when there is one. A wire sent to the ACH routing
       number is rejected or returned days later minus a fee, and nothing on
       either side explains why. */
    rows.push(["Routing number (wire)", d.wireRoutingNumber]);
  }
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

/* A real PDF, drawn rather than printed.
 *
 * Printing was wrong twice over. The sheet lives inside a modal that is
 * `position: fixed`, and a fixed ancestor repeats on every printed page, which
 * is where the duplicate came from. And a print dialogue is not a download: it
 * asks somebody to find "save as PDF" in a menu that differs on every browser
 * and is missing entirely on some phones.
 *
 * Drawn with jsPDF as vector text and lines, so it is crisp at any zoom and a
 * fraction of the size of a rasterised page. No html2canvas, no screenshot of
 * a web page pretending to be a document.
 */
import { jsPDF } from "jspdf";

const MM = { pageW: 210, pageH: 297, margin: 20 };

function line(doc, y) {
  doc.setDrawColor(228, 224, 217);
  doc.setLineWidth(0.2);
  doc.line(MM.margin, y, MM.pageW - MM.margin, y);
}

/** Build the document. Returns the jsPDF instance so callers can save or blob it. */
export function buildVoidChequePdf(d, business) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = MM.margin;
  const R = MM.pageW - MM.margin;
  const W = R - L;
  const today = new Date().toISOString().slice(0, 10);
  let y = 26;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(28, 25, 23);
  doc.text("Void cheque", L, y);

  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 83, 78);
  doc.text(`Account details for ${business || d.beneficiaryName || ""}, issued ${today}.`, L, y);
  if (d.label) {
    y += 5;
    doc.text(d.label + (d.currency ? ` · receives ${d.currency}` : ""), L, y);
  }

  /* The cheque face. No amount box, no payee line, no signature line: those are
     what make a cheque negotiable, and leaving them out is the point. */
  y += 10;
  const faceTop = y;
  const faceH = 52;
  doc.setDrawColor(226, 221, 214);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(L, faceTop, W, faceH, 3, 3, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text(String(d.beneficiaryName || ""), L + 6, faceTop + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(90, 83, 78);
  const addr = String(d.beneficiaryAddress || "").split(/\n|,\s*/).filter(Boolean).slice(0, 3);
  addr.forEach((l, i) => doc.text(l, L + 6, faceTop + 15.5 + i * 4));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(28, 25, 23);
  doc.text(String(d.bankName || ""), R - 6, faceTop + 10, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(90, 83, 78);
  const branch = String(d.branchAddress || "").split(/\n|,\s*/).filter(Boolean).slice(0, 2);
  branch.forEach((l, i) => doc.text(l, R - 6, faceTop + 15.5 + i * 4, { align: "right" }));

  /* VOID across the face, behind nothing, in a red nobody mistakes for ink. */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(58);
  doc.setTextColor(196, 68, 47);
  if (doc.setGState) doc.setGState(new doc.GState({ opacity: 0.15 }));
  /* Centred on the cheque face rather than the page, and large enough to be
     unmistakable at a glance. A small VOID is a VOID somebody misses. */
  doc.text("VOID", L + W / 2, faceTop + faceH / 2 + 7, { align: "center", angle: 11 });
  if (doc.setGState) doc.setGState(new doc.GState({ opacity: 1 }));

  /* The line along the bottom, which is what anybody keying a payment reads.
     Canada and the US order it differently and one that reads correctly in the
     wrong country is worse than none. */
  doc.setDrawColor(228, 224, 217);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(L + 6, faceTop + faceH - 15, R - 6, faceTop + faceH - 15);
  doc.setLineDashPattern([], 0);

  /* The MICR line, drawn rather than typed.
   *
   * The real delimiters are U+2446 and U+2448, and no font built into a PDF
   * has them: they came out as mojibake. They are simple marks, so they are
   * drawn as rectangles, which also means they look the same in every reader
   * rather than depending on an embedded font.
   *
   * This is for a person reading it, not a machine. Pretending otherwise would
   * be the forgery. */
  doc.setFont("courier", "normal");
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);

  const micrY = faceTop + faceH - 8;
  let mx = L + 6;

  const delim = () => {
    doc.setFillColor(28, 25, 23);
    doc.rect(mx, micrY - 3.4, 0.7, 4, "F");
    doc.rect(mx + 1.5, micrY - 3.4, 0.7, 4, "F");
    mx += 4.2;
  };
  const group = (text) => {
    const t = String(text || "");
    if (!t) return;
    doc.text(t, mx, micrY);
    mx += doc.getTextWidth(t) + 3;
  };

  if (d.country === "CA") {
    delim(); group(d.transitNumber); group(d.institutionNumber); delim(); group(d.accountNumber); delim();
  } else if (d.country === "US") {
    delim(); group(d.routingNumber); delim(); group(d.accountNumber); delim();
  } else {
    group(d.iban || d.accountNumber);
    if (d.swiftCode) { mx += 2; group(d.swiftCode); }
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(138, 130, 123);
  doc.text(
    d.country === "CA" ? "transit  ·  institution  ·  account"
      : d.country === "US" ? "routing  ·  account" : "account",
    L + 6, faceTop + faceH - 3.5,
  );

  /* The details, as rows. */
  y = faceTop + faceH + 12;
  for (const [k, v] of detailRows(d)) {
    line(doc, y - 4.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(90, 83, 78);
    doc.text(String(k), L, y);
    doc.setFont("courier", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(28, 25, 23);
    doc.text(String(v), R, y, { align: "right" });
    y += 7.5;
    if (y > MM.pageH - 50) break;   // one page, always
  }

  if (d.note) {
    y += 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(90, 83, 78);
    doc.text(doc.splitTextToSize(String(d.note), W), L, y);
    y += 6;
  }

  /* The disclaimer, at the foot, because it is what stops this being mistaken
     for an instrument. */
  /* The disclaimer sits under the content, not pinned to the foot of the page.
     Floating alone at the bottom of a half empty sheet it read as boilerplate
     nobody put there on purpose. */
  y += 6;
  doc.setDrawColor(228, 224, 217);
  doc.line(L, y - 3, R, y - 3);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(138, 130, 123);
  const foot = doc.splitTextToSize(
    "This sheet states account details for receiving payment. It is not a cheque and cannot be "
    + "presented: there is no amount, no payee and no signature. Treat it as you would a void cheque, "
    + "because it carries the same information. "
    + `Produced by ${business || "Brasstally"} through Brasstally on ${today}.`,
    W,
  );
  doc.text(foot, L, y + 1);

  doc.setProperties({
    title: `Void cheque · ${business || d.beneficiaryName || ""}`,
    subject: "Account details for receiving payment",
    author: business || "Brasstally",
    creator: "Brasstally",
  });

  return doc;
}

/** Download it. One press, a file, no dialogue to navigate. */
export function downloadVoidCheque(d, business) {
  try {
    const doc = buildVoidChequePdf(d, business);
    const name = `void-cheque-${(d.label || d.country || "account")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.pdf`;
    doc.save(name);
    return { ok: true, name };
  } catch (e) {
    console.warn("void cheque pdf failed:", e?.message || e);
    return { ok: false, error: e?.message || "The PDF could not be made." };
  }
}

/* A pay order as a PDF.
 *
 * The same reasoning as the void cheque: it lived in a fixed-position modal
 * and printed on every page, and a print dialogue is not a download.
 */
export function buildPayOrderPdf(o) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = MM.margin;
  const R = MM.pageW - MM.margin;
  const W = R - L;
  const today = new Date().toISOString().slice(0, 10);
  let y = 26;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(28, 25, 23);
  doc.text("Pay order", L, y);

  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 83, 78);
  doc.text("Pay", L, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(28, 25, 23);
  doc.text(String(o.amount || ""), R, y + 1, { align: "right" });

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(String(o.party || ""), L, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(o.overdue ? 196 : 90, o.overdue ? 68 : 83, o.overdue ? 47 : 78);
  doc.text(String(o.when || ""), R, y, { align: "right" });

  if (o.alreadyPaid) {
    y += 6;
    doc.setFontSize(9.5);
    doc.setTextColor(90, 83, 78);
    doc.text(o.alreadyPaid, L, y);
  }

  y += 10;
  for (const [k, v] of (o.rows || [])) {
    if (!v) continue;
    doc.setDrawColor(228, 224, 217);
    doc.setLineWidth(0.2);
    doc.line(L, y - 4.5, R, y - 4.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(90, 83, 78);
    doc.text(String(k), L, y);
    doc.setTextColor(28, 25, 23);
    doc.text(doc.splitTextToSize(String(v), W * 0.6), R, y, { align: "right" });
    y += 7.5;
  }

  if (o.how) {
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(28, 25, 23);
    doc.text("How they asked to be paid", L, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(90, 83, 78);
    const lines = doc.splitTextToSize(String(o.how), W);
    doc.text(lines, L, y);
    y += lines.length * 4.6;
  }

  y += 8;
  doc.setDrawColor(228, 224, 217);
  doc.line(L, y - 3, R, y - 3);
  doc.setFontSize(7.5);
  doc.setTextColor(138, 130, 123);
  doc.text(doc.splitTextToSize(
    `Raised by ${o.business || "Brasstally"} on ${today}. This is an instruction to pay, `
    + "not a payment: nothing moves until somebody moves it.", W), L, y + 1);

  doc.setProperties({ title: `Pay order · ${o.party || ""}`, author: o.business || "Brasstally" });
  return doc;
}

export function downloadPayOrder(o) {
  try {
    const doc = buildPayOrderPdf(o);
    const who = String(o.party || "payment").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    doc.save(`pay-order-${who}.pdf`);
    return { ok: true };
  } catch (e) {
    console.warn("pay order pdf failed:", e?.message || e);
    return { ok: false, error: e?.message || "The PDF could not be made." };
  }
}
