/**
 * invoice-mail: everything the intake link needs to send or store.
 *
 * This lives in Supabase rather than Vercel because Vercel's services config,
 * which is what routes brasstally.com to three different roots, does not host
 * serverless functions. Three attempts at placing them proved that rather than
 * fixed it: the last one returned 200 and served index.html, which is the app's
 * own catch-all answering, not a function.
 *
 * An edge function has a URL of its own and needs no routing at all, which
 * removes the entire class of problem.
 *
 * Actions
 *   { action: "info",      token }                  public, names the business
 *   { action: "upload",    token, filename }        public, signs one upload
 *   { action: "notify",    token, id }              public, mails both sides
 *   { action: "test",      token }                  public, proves the mail path
 *   { action: "send-link", token, to, note }        owner only, needs a bearer
 *
 * Secrets, set with `supabase secrets set` or in the dashboard:
 *   SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_URL
 * SUPABASE_URL is provided by the platform.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { invoiceReceivedEmail, invoiceSubmittedEmail, invoiceInviteEmail } from "./emails.ts";

const BUCKET = "receipts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const admin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

/** Resend over its REST API. No package, one fetch, one place to read the error. */
async function sendMail(to: string, subject: string, html: string, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!key || !from) {
    const missing = [!key && "RESEND_API_KEY", !from && "RESEND_FROM_EMAIL"].filter(Boolean);
    return { ok: false, error: `Not set on the function: ${missing.join(", ")}` };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: body?.message || `Resend returned ${r.status}` };
  return { ok: true, id: body?.id };
}

/** The token is the only thing a caller is trusted for, and only this far. */
async function resolveLink(db: ReturnType<typeof admin>, token: unknown) {
  if (typeof token !== "string" || !token || token.length > 64) return null;
  const { data } = await db
    .from("invoice_links")
    .select("id, ledger_id, label, active, ledgers(name, user_id)")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  return data ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Send JSON." }); }

  const action = String(body.action || "");
  const token = body.token;
  const db = admin();

  // health does not need a link, so it answers before the lookup
  if (action === "health") return json({ ok: true, at: new Date().toISOString() });

  const link = await resolveLink(db, token);
  if (!link) return json({ ok: false, error: "This link is not active." });
  const business = (link.ledgers as { name: string }).name;
  const ownerId = (link.ledgers as { user_id: string }).user_id;

  try {
    if (action === "info") {
      return json({ ok: true, business, label: link.label ?? null });
    }

    if (action === "upload") {
      const raw = String(body.filename || "invoice.pdf");
      const ext = (raw.match(/\.(pdf|png|jpe?g|heic|webp)$/i)?.[1] || "pdf").toLowerCase();
      const path = `inbound/${link.ledger_id}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) throw error;
      return json({ ok: true, path, signedUrl: data.signedUrl });
    }

    if (action === "notify" || action === "test") {
      const isTest = action === "test";
      const inv = isTest
        ? { id: "test", party: "Test Supplier", amount: 1250, description: "A test, sent from the invoice link", invoice_no: "TEST-0001", due_date: null, contact_email: null, ledger_id: link.ledger_id }
        : (await db.from("inbound_invoices")
            .select("id, party, amount, description, invoice_no, due_date, contact_email, ledger_id")
            .eq("id", body.id).maybeSingle()).data;

      if (!inv || inv.ledger_id !== link.ledger_id) return json({ ok: false, error: "Not found." });

      /* The supplier's copy goes first. They are the one waiting on a signal,
         and if only one of the two can be sent it should be the one that stops
         somebody emailing the invoice again the old way. */
      if (!isTest && inv.contact_email) {
        const r = await sendMail(
          inv.contact_email,
          `Your invoice reached ${business}`,
          invoiceSubmittedEmail({
            business, party: inv.party, amount: Number(inv.amount),
            description: inv.description, invoiceNo: inv.invoice_no, dueDate: inv.due_date,
          }),
        );
        // A bad address from a form field must not stop the owner being told.
        if (!r.ok) console.warn("supplier copy failed:", r.error);
      }

      const { data: owner } = await db.auth.admin.getUserById(ownerId);
      const to = owner?.user?.email;
      if (!to) return json({ ok: false, error: "No email on the ledger owner." });

      const r = await sendMail(
        to,
        isTest ? "Test: an invoice arrived" : `${inv.party} sent you an invoice`,
        invoiceReceivedEmail({
          business, party: inv.party, amount: Number(inv.amount),
          description: inv.description, invoiceNo: inv.invoice_no, dueDate: inv.due_date,
          appUrl: Deno.env.get("APP_URL") || "https://brasstally.com",
        }),
      );
      return r.ok ? json({ ok: true, to }) : json({ ok: false, error: r.error });
    }

    if (action === "send-link") {
      /* The one action that mails an address the caller chooses, which is a
         spam relay if an intake token is the only guard, and an intake token is
         meant to be handed around. So this one needs the owner's session. */
      const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!bearer) return json({ ok: false, error: "Sign in first." }, 401);

      const { data: caller } = await db.auth.getUser(bearer);
      if (!caller?.user?.id || caller.user.id !== ownerId) {
        return json({ ok: false, error: "That is not your link." }, 403);
      }

      const to = String(body.to || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        return json({ ok: false, error: "That does not look like an email address." });
      }

      // Shown to the supplier, so it is text and never markup.
      const note = String(body.note || "").slice(0, 400)
        .replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));

      const r = await sendMail(
        to,
        `Send your invoice to ${business}`,
        invoiceInviteEmail({
          business,
          fromName: caller.user.email ? caller.user.email.split("@")[0] : null,
          note: note || null,
          link: `${Deno.env.get("APP_URL") || "https://brasstally.com"}/invoice?t=${encodeURIComponent(String(token))}`,
        }),
        caller.user.email ?? undefined,
      );
      return r.ok ? json({ ok: true, to }) : json({ ok: false, error: r.error });
    }

    return json({ ok: false, error: "Unknown action." });
  } catch (e) {
    console.error("invoice-mail:", e);
    return json({ ok: false, error: (e as Error)?.message || "That step did not complete." });
  }
});
