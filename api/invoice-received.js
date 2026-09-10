/**
 * Tell the owner a supplier sent them an invoice, and hand back a signed URL
 * so the supplier can attach the PDF.
 *
 * Two jobs in one route because they share the only thing that matters here:
 * turning an intake token into a ledger without ever trusting the caller for
 * the ledger id. The caller is anonymous, so nothing it sends is believed
 * except the token, and the token is checked against the database every time.
 *
 * Environment (Vercel project settings):
 *   SUPABASE_URL                the project url
 *   SUPABASE_SERVICE_ROLE_KEY   needed to read the owner's address and to sign
 *                               an upload; never exposed to the browser
 *   RESEND_API_KEY              transactional email
 *   RESEND_FROM_EMAIL           a verified sender in Resend
 *   APP_URL                     e.g. https://brasstally.com
 *
 * POST /api/invoice-received
 *   { action: "upload", token, filename }   -> { ok, path, signedUrl }
 *   { action: "notify", token, id }         -> { ok }
 */

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { invoiceReceivedEmail } from "./lib/email.js";

const BUCKET = "receipts";

const admin = () =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

/** The token is the only thing the caller is trusted for, and only this far. */
async function resolveLink(db, token) {
  if (!token || typeof token !== "string" || token.length > 64) return null;
  const { data } = await db
    .from("invoice_links")
    .select("id, ledger_id, active, ledgers(name, user_id)")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  return data || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  const { action, token } = req.body || {};
  const db = admin();
  const link = await resolveLink(db, token);
  if (!link) return res.status(200).json({ ok: false, error: "This link is not active." });

  try {
    if (action === "upload") {
      /* A signed upload URL, scoped to one path this route chooses.
         The supplier never gets write access to the bucket, only permission to
         put one object at one key that expires. The alternative, a public
         bucket anyone can write to, is not worth the convenience. */
      const raw = String(req.body.filename || "invoice.pdf");
      const ext = (raw.match(/\.(pdf|png|jpe?g|heic|webp)$/i)?.[1] || "pdf").toLowerCase();
      const path = `inbound/${link.ledger_id}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) throw error;
      return res.status(200).json({ ok: true, path, signedUrl: data.signedUrl, token: data.token });
    }

    if (action === "notify") {
      const { data: inv } = await db
        .from("inbound_invoices")
        .select("id, party, amount, description, invoice_no, due_date, ledger_id")
        .eq("id", req.body.id)
        .maybeSingle();
      // Belt and braces: the row has to belong to the ledger the token names.
      if (!inv || inv.ledger_id !== link.ledger_id) {
        return res.status(200).json({ ok: false, error: "Not found." });
      }

      const { data: owner } = await db.auth.admin.getUserById(link.ledgers.user_id);
      const to = owner?.user?.email;
      if (!to) return res.status(200).json({ ok: true, sent: false });

      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to,
        subject: `${inv.party} sent you an invoice`,
        html: invoiceReceivedEmail({
          business: link.ledgers.name,
          party: inv.party,
          amount: Number(inv.amount),
          description: inv.description,
          invoiceNo: inv.invoice_no,
          dueDate: inv.due_date,
          appUrl: process.env.APP_URL || "https://brasstally.com",
        }),
      });
      return res.status(200).json({ ok: true, sent: true });
    }

    return res.status(200).json({ ok: false, error: "Unknown action." });
  } catch (e) {
    /* The submission itself already succeeded before this route is called.
       A failed email or a failed upload must not make the supplier think the
       invoice did not arrive, so this reports and does not throw. */
    console.error("invoice-received:", e);
    return res.status(200).json({ ok: false, error: "Could not complete that step." });
  }
}
