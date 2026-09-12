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
 *   { action: "preview-invite", token }             owner only, mails the invite to yourself
 *   { action: "decided",   token, id, outcome }     owner only, tells the supplier
 *   { action: "correct",   token, id, reason }      owner only, asks for a redo
 *   { action: "share-invite", ledgerId, to, note }  owner only, no token needed
 *
 * Secrets, set with `supabase secrets set` or in the dashboard:
 *   SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_URL
 *   INVOICE_LINK_STYLE  optional, "short" (default) or "query". Set it to
 *                       "query" if /i/<token> ever stops resolving.
 * SUPABASE_URL is provided by the platform.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  invoiceReceivedEmail, invoiceSubmittedEmail, invoiceInviteEmail, invoiceDecidedEmail,
  invoiceCorrectionEmail, shareInviteEmail,
} from "./emails.ts";

const BUCKET = "invoices";   // the bucket the app reads from; "receipts" was a guess and nothing could open the file

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
/* The token out of whatever was pasted.

   Three shapes exist in the wild: the bare token, the short link
   /i/<slug>/<token>, and the older /invoice?t=<token>. Stripping the query
   string first turns the third into the word "invoice", which is a wrong
   answer delivered confidently, so the query is checked before the path. */
function takeToken(raw: unknown): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const q = v.match(/[?&]t=([A-Za-z0-9_-]+)/);
  if (q) return q[1];
  return v.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() || "";
}

async function resolveLink(db: ReturnType<typeof admin>, token: unknown) {
  if (typeof token !== "string" || !token || token.length > 400) return null;
  /* Take the last path segment, so pasting the whole link works.

     The address is brasstally.com/i/genie-ai/cr7va67h3she9, and the token is
     only the last part of it. Anyone reading that URL will reasonably paste
     more of it than the token, and "this link is not active" is a confusing
     way to say "you gave me a slug as well". */
  token = takeToken(token);
  if (!token || (token as string).length > 64) return null;
  const { data } = await db
    .from("invoice_links")
    .select("id, ledger_id, label, slug, active, ledgers(name, user_id)")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  return data ?? null;
}


/* Where an intake link points.

   `/i/<token>` is short and reads well, and it depends on a rewrite resolving
   a path segment to a file. `/invoice?t=<token>` is uglier and is proven: it
   is a plain file at a plain path and has worked since the day it shipped.

   INVOICE_LINK_STYLE picks between them, so if the short form does not
   resolve after a deploy this is a secret to change rather than a code
   release. Given how many attempts the routing on this project has taken,
   that switch is worth the four lines. */
function linkFor(token: string, slug?: string | null) {
  const base = Deno.env.get("APP_URL") || "https://brasstally.com";
  const style = (Deno.env.get("INVOICE_LINK_STYLE") || "short").toLowerCase();
  if (style === "query") return `${base}/invoice?t=${encodeURIComponent(token)}`;
  return `${base}/i/${slug ? `${encodeURIComponent(slug)}/` : ""}${encodeURIComponent(token)}`;
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

  /* Sharing has nothing to do with an intake link, so it resolves its own
     ledger and runs before the token lookup. Owner only: this tells somebody
     they have been given access to a set of books, and only the person who
     gave it should be able to say so. */
  if (action === "share-invite") {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ ok: false, error: "Sign in first." }, 401);
    const { data: caller } = await db.auth.getUser(bearer);
    if (!caller?.user?.id) return json({ ok: false, error: "Sign in first." }, 401);

    const { data: ledger } = await db
      .from("ledgers").select("name, user_id").eq("id", body.ledgerId).maybeSingle();
    if (!ledger || ledger.user_id !== caller.user.id) {
      return json({ ok: false, error: "That is not your ledger." }, 403);
    }

    const to = String(body.to || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return json({ ok: false, error: "That does not look like an email address." });
    }
    const note = String(body.note || "").slice(0, 400)
      .replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));

    const r = await sendMail(
      to,
      `You can read ${ledger.name} in Brasstally`,
      shareInviteEmail({
        business: ledger.name,
        fromEmail: caller.user.email ?? null,
        note: note || null,
        /* The link carries who it is for and which books, so the page that
           opens knows both before they type anything. No secret is in it:
           the address is theirs, the ledger id opens nothing on its own, and
           the code that does the work is sent when they press the button. */
        openUrl: `${Deno.env.get("APP_URL") || "https://brasstally.com"}/app` +
          `?share=${encodeURIComponent(body.ledgerId as string)}` +
          `&to=${encodeURIComponent(to)}` +
          `&name=${encodeURIComponent(ledger.name)}`,
      }),
      caller.user.email ?? undefined,
    );
    return r.ok ? json({ ok: true, to }) : json({ ok: false, error: r.error });
  }

  const link = await resolveLink(db, token);
  if (!link) {
    /* Two different problems wore one sentence. A supplier holding a
       cancelled link and an owner pasting a slug both got "not active", and
       only one of those is about the link. */
    const raw = takeToken(token);
    const { data: any } = await db
      .from("invoice_links").select("active").eq("token", raw).maybeSingle();
    return json({
      ok: false,
      error: any
        ? "That link has been turned off."
        : `No intake link with that token. The token is the last part of the address, after the final slash.`,
    });
  }
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

    if (action === "preview-invite") {
      /* Send yourself the exact email a supplier gets.

         Diagnosing "it arrived without a button" from a description is slow
         and usually wrong. This puts the real message in your own inbox,
         rendered by your own client, in one call. */
      const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: caller } = bearer ? await db.auth.getUser(bearer) : { data: null };
      if (!caller?.user?.id || caller.user.id !== ownerId) {
        return json({ ok: false, error: "That is not your link." }, 403);
      }
      const to = caller.user.email;
      if (!to) return json({ ok: false, error: "No email on your account." });

      const r = await sendMail(
        to,
        `Preview: send your invoice to ${business}`,
        invoiceInviteEmail({
          business,
          fromName: to.split("@")[0],
          note: "This is a preview. A supplier sees exactly this.",
          link: linkFor(String(token), link.slug),
        }),
      );
      return r.ok
        ? json({ ok: true, to, link: linkFor(String(token), link.slug) })
        : json({ ok: false, error: r.error });
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

    if (action === "decided") {
      /* Tell the supplier what happened. Owner only, because it speaks on
         their behalf and names their business. */
      const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: caller } = bearer ? await db.auth.getUser(bearer) : { data: null };
      if (!caller?.user?.id || caller.user.id !== ownerId) {
        return json({ ok: false, error: "That is not your ledger." }, 403);
      }

      const outcome = String(body.outcome || "");
      if (!["accepted", "declined", "voided"].includes(outcome)) {
        return json({ ok: false, error: "Unknown outcome." });
      }

      const { data: inv } = await db.from("inbound_invoices")
        .select("party, amount, description, invoice_no, contact_email, recurrence, ledger_id")
        .eq("id", body.id).maybeSingle();

      // A voided row is deleted before this runs, so the caller passes what it
      // had. Falling back to that is the difference between a supplier being
      // told and a supplier wondering.
      const inv2 = inv ?? (body.fallback as Record<string, unknown> | undefined);
      if (!inv2) return json({ ok: true, sent: false, why: "nothing to describe" });
      if (inv && inv.ledger_id !== link.ledger_id) return json({ ok: false, error: "Not found." });

      const to = (inv2.contact_email ?? inv2.contactEmail) as string | undefined;
      if (!to) return json({ ok: true, sent: false, why: "no address was given" });

      const r = await sendMail(
        to,
        outcome === "accepted" ? `${business} accepted your invoice` : `About your invoice to ${business}`,
        invoiceDecidedEmail({
          business,
          party: String(inv2.party ?? ""),
          amount: Number(inv2.amount ?? 0),
          description: (inv2.description ?? null) as string | null,
          invoiceNo: (inv2.invoice_no ?? inv2.invoiceNo ?? null) as string | null,
          outcome: outcome as "accepted" | "declined" | "voided",
          recurring: (inv2.recurrence ?? inv2.recurrence) === "monthly",
        }),
        caller.user.email ?? undefined,
      );
      return r.ok ? json({ ok: true, sent: true }) : json({ ok: false, error: r.error });
    }

    if (action === "correct") {
      const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: caller } = bearer ? await db.auth.getUser(bearer) : { data: null };
      if (!caller?.user?.id || caller.user.id !== ownerId) {
        return json({ ok: false, error: "That is not your ledger." }, 403);
      }

      const { data: inv } = await db.from("inbound_invoices")
        .select("party, amount, description, invoice_no, contact_email, ledger_id")
        .eq("id", body.id).maybeSingle();
      if (!inv || inv.ledger_id !== link.ledger_id) return json({ ok: false, error: "Not found." });
      if (!inv.contact_email) {
        return json({ ok: false, error: "They did not leave an email address, so there is nobody to ask." });
      }

      const reason = String(body.reason || "").slice(0, 400)
        .replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));

      const r = await sendMail(
        inv.contact_email,
        `${business} needs a correction to your invoice`,
        invoiceCorrectionEmail({
          business,
          party: inv.party,
          amount: Number(inv.amount),
          description: inv.description,
          invoiceNo: inv.invoice_no,
          reason: reason || null,
          link: linkFor(String(token), link.slug),
        }),
        caller.user.email ?? undefined,
      );
      return r.ok ? json({ ok: true, to: inv.contact_email }) : json({ ok: false, error: r.error });
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
          link: linkFor(String(token), link.slug),
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
