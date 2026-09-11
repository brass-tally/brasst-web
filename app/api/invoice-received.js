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
 *   { action: "test", token }               -> { ok, to } or the reason not
 *   { action: "send-link", token, to, note } -> { ok }  owner only, needs a bearer
 */

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { invoiceReceivedEmail, invoiceSubmittedEmail, invoiceInviteEmail } from "./lib/email.js";

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

      const resend = new Resend(process.env.RESEND_API_KEY);

      /* The supplier's copy goes first.
         They are the one waiting on a signal, and if only one of these two can
         be sent it should be the one that stops someone emailing the invoice
         again the old way. */
      const { data: full } = await db
        .from("inbound_invoices")
        .select("contact_email")
        .eq("id", inv.id)
        .maybeSingle();
      if (full?.contact_email) {
        try {
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL,
            to: full.contact_email,
            subject: `Your invoice reached ${link.ledgers.name}`,
            html: invoiceSubmittedEmail({
              business: link.ledgers.name,
              party: inv.party,
              amount: Number(inv.amount),
              description: inv.description,
              invoiceNo: inv.invoice_no,
              dueDate: inv.due_date,
            }),
          });
        } catch (e) {
          // A bad address from a form field must not stop the owner being told.
          console.warn("supplier copy failed:", e?.message || e);
        }
      }

      const { data: owner } = await db.auth.admin.getUserById(link.ledgers.user_id);
      const to = owner?.user?.email;
      if (!to) return res.status(200).json({ ok: true, sent: false });

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

    if (action === "send-link") {
      /* This action is different from every other one here, and the difference
         is the point.

         The others are called by an anonymous supplier and are safe because
         the most they can do is put data into one ledger. This one sends mail
         from our domain to an address the caller chooses, which is a spam
         relay if an intake token is the only thing guarding it, and an intake
         token is meant to be handed around.

         So it requires the owner's own session and checks that they own the
         ledger the token belongs to. Holding the link is not enough. */
      const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!bearer) return res.status(401).json({ ok: false, error: "Sign in first." });

      const { data: caller } = await db.auth.getUser(bearer);
      const uid = caller?.user?.id;
      if (!uid || uid !== link.ledgers.user_id) {
        return res.status(403).json({ ok: false, error: "That is not your link." });
      }

      const to = String(req.body.to || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        return res.status(200).json({ ok: false, error: "That does not look like an email address." });
      }

      const missing = ["RESEND_API_KEY", "RESEND_FROM_EMAIL"].filter((k) => !process.env[k]);
      if (missing.length) {
        return res.status(200).json({ ok: false, error: `Not set in Vercel: ${missing.join(", ")}` });
      }

      // The note is shown to the supplier, so it is text and never markup.
      const note = String(req.body.note || "").slice(0, 400)
        .replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

      const resend = new Resend(process.env.RESEND_API_KEY);
      const sent = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to,
        // A supplier replying goes to the person who invited them, not to us.
        replyTo: caller.user.email || undefined,
        subject: `Send your invoice to ${link.ledgers.name}`,
        html: invoiceInviteEmail({
          business: link.ledgers.name,
          fromName: caller.user.email ? caller.user.email.split("@")[0] : null,
          note: note || null,
          link: `${process.env.APP_URL || "https://brasstally.com"}/invoice?t=${encodeURIComponent(token)}`,
        }),
      });
      if (sent?.error) {
        return res.status(200).json({ ok: false, error: `Resend refused it: ${sent.error.message || sent.error}` });
      }
      return res.status(200).json({ ok: true, to });
    }

    if (action === "test") {
      /* Prove the mail path without submitting an invoice.
         Every failure here is a configuration problem rather than a code one,
         so it names the variable that is missing instead of saying it did not
         work. Nothing is written; this only sends. */
      const missing = ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]
        .filter((k) => !process.env[k]);
      if (missing.length) {
        return res.status(200).json({ ok: false, error: `Not set in Vercel: ${missing.join(", ")}` });
      }

      const { data: owner } = await db.auth.admin.getUserById(link.ledgers.user_id);
      const to = owner?.user?.email;
      if (!to) return res.status(200).json({ ok: false, error: "No email on the ledger owner." });

      const resend = new Resend(process.env.RESEND_API_KEY);
      const sent = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to,
        subject: "Test: an invoice arrived",
        html: invoiceReceivedEmail({
          business: link.ledgers.name,
          party: "Test Supplier",
          amount: 1250,
          description: "A test, sent from the invoice link",
          invoiceNo: "TEST-0001",
          dueDate: null,
          appUrl: process.env.APP_URL || "https://brasstally.com",
        }),
      });
      if (sent?.error) {
        return res.status(200).json({ ok: false, error: `Resend refused it: ${sent.error.message || sent.error}` });
      }
      return res.status(200).json({ ok: true, to, id: sent?.data?.id || null });
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
