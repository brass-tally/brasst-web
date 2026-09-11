/* The three invoice emails, shared by the edge function.
   Plain string builders with no dependencies, so they run unchanged under Deno
   and can be read without a build step. Table based and inline styled, because
   that is what mail clients understand. */

/**
 * "A supplier sent you an invoice." Same shell as the approval email, because
 * two transactional emails from one product that look like different companies
 * is worse than either of them looking plain.
 */
export function invoiceReceivedEmail({ business, party, amount, description, invoiceNo, dueDate, appUrl }) {
  const brass = "#A9620A";
  const fill = "#F59E0B";
  const ink = "#1C1917";
  const muted = "#5A534E";
  const paper = "#FAF9F7";
  const money = (n) =>
    (Number(n) || 0).toLocaleString("en-CA", { style: "currency", currency: "CAD" });

  const line = (label, value) => (value
    ? `<tr><td style="padding:4px 0;font-size:15px;color:${muted}">${label}</td>
         <td style="padding:4px 0;font-size:15px;color:${ink};text-align:right">${value}</td></tr>`
    : "");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/>
<title>${party} sent you an invoice</title></head>
<body style="margin:0;padding:0;background:${paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${paper};padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="max-width:520px;background:#FFFFFF;border-radius:20px;padding:32px;
           font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td>
      <div style="font-size:15px;font-weight:600;color:${brass};margin-bottom:14px;">Brasstally</div>
      <h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:${ink};font-weight:600;">
        ${party} sent you an invoice
      </h1>
      <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:${muted};">
        It came in through your intake link for ${business}. Nothing has been added to your books yet.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#F5F3F0;border-radius:14px;padding:16px 18px;margin-bottom:20px;">
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${line("Amount", `<strong>${money(amount)}</strong>`)}
            ${line("For", description)}
            ${line("Invoice", invoiceNo)}
            ${line("Due", dueDate)}
          </table>
        </td></tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
        <tr><td style="border-radius:999px;background:${fill};">
          <a href="${appUrl}/app" style="display:inline-block;padding:14px 28px;font-size:16px;
             font-weight:600;color:#241703;text-decoration:none;border-radius:999px;">
            Review it in AR / AP
          </a>
        </td></tr>
      </table>

      <p style="margin:0;font-size:14px;line-height:1.55;color:#8A827B;">
        Anyone holding your intake link can submit, so this is a request rather than a bill. It becomes
        something you owe only when you accept it. You can turn the link off in Settings.
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/**
 * The copy that goes back to whoever sent the invoice.
 *
 * Sending nothing was the wrong default. A contractor who fills in a form on a
 * domain they have never seen and gets silence has no way to tell the
 * difference between "received" and "lost", and the next thing they do is
 * email the invoice again the old way, which is the entire problem this was
 * meant to remove.
 */
export function invoiceSubmittedEmail({ business, party, amount, description, invoiceNo, dueDate }) {
  const brass = "#A9620A";
  const ink = "#1C1917";
  const muted = "#5A534E";
  const paper = "#FAF9F7";
  const money = (n) =>
    (Number(n) || 0).toLocaleString("en-CA", { style: "currency", currency: "CAD" });

  const line = (label, value) => (value
    ? `<tr><td style="padding:4px 0;font-size:15px;color:${muted}">${label}</td>
         <td style="padding:4px 0;font-size:15px;color:${ink};text-align:right">${value}</td></tr>`
    : "");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/>
<title>Your invoice reached ${business}</title></head>
<body style="margin:0;padding:0;background:${paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${paper};padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="max-width:520px;background:#FFFFFF;border-radius:20px;padding:32px;
           font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td>
      <div style="font-size:15px;font-weight:600;color:${brass};margin-bottom:14px;">Brasstally</div>
      <h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:${ink};font-weight:600;">
        Your invoice reached ${business}
      </h1>
      <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:${muted};">
        Here is what you sent, so you have a copy. Nothing else is needed from you.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#F5F3F0;border-radius:14px;padding:16px 18px;margin-bottom:20px;">
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${line("From", party)}
            ${line("Amount", `<strong>${money(amount)}</strong>`)}
            ${line("For", description)}
            ${line("Invoice", invoiceNo)}
            ${line("Due", dueDate)}
          </table>
        </td></tr>
      </table>

      <p style="margin:0;font-size:14px;line-height:1.55;color:#8A827B;">
        ${business} will review it and pay it their usual way. If something above is wrong, reply to whoever
        sent you the link rather than to this address, which is not monitored.
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/**
 * The invitation a supplier receives: "send me your invoice, here is where".
 *
 * The link is the whole message, so it is a button and a plain URL underneath
 * it. Contractors read mail in clients that strip buttons, and one that
 * cannot be clicked has to still be readable enough to type.
 */
export function invoiceInviteEmail({ business, fromName, note, link }) {
  const brass = "#A9620A";
  const fill = "#F59E0B";
  const ink = "#1C1917";
  const muted = "#5A534E";
  const paper = "#FAF9F7";

  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/>
<title>Send your invoice to ${business}</title></head>
<body style="margin:0;padding:0;background:${paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${paper};padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="max-width:520px;background:#FFFFFF;border-radius:20px;padding:32px;
           font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td>
      <div style="font-size:15px;font-weight:600;color:${brass};margin-bottom:14px;">Brasstally</div>
      <h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:${ink};font-weight:600;">
        Send your invoice to ${business}
      </h1>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${muted};">
        ${fromName ? `${fromName} at ${business}` : business} asked you to send invoices through this link. It
        takes a minute, you can attach the PDF, and you get a copy of what you sent.
      </p>

      ${note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#F5F3F0;border-radius:14px;padding:14px 16px;margin-bottom:20px;">
        <tr><td style="font-size:15px;line-height:1.55;color:${ink};">${note}</td></tr>
      </table>` : ""}

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr><td style="border-radius:999px;background:${fill};">
          <a href="${link}" style="display:inline-block;padding:14px 28px;font-size:16px;
             font-weight:600;color:#241703;text-decoration:none;border-radius:999px;">
            Send your invoice
          </a>
        </td></tr>
      </table>

      <p style="margin:0 0 18px;font-size:13.5px;line-height:1.5;color:#8A827B;word-break:break-all;">
        Or paste this into your browser:<br/><span style="color:${muted}">${link}</span>
      </p>

      <p style="margin:0;font-size:14px;line-height:1.55;color:#8A827B;">
        This is not a payment page and nothing is charged. It sends the details to their bookkeeping so the
        invoice does not sit in an inbox.
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
