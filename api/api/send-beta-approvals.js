/**
 * Cron: approve beta signups that have waited long enough, and email them a way in.
 *
 * Vercel calls this on the schedule in vercel.json. It is the only thing that
 * moves a row out of `pending`, so if it is not deployed, nobody is ever
 * approved and the table just fills up quietly.
 *
 * Environment (Vercel project settings):
 *   SUPABASE_URL                the project url
 *   SUPABASE_SERVICE_ROLE_KEY   admin access; this endpoint mints sign-in links
 *   RESEND_API_KEY              transactional email
 *   RESEND_FROM_EMAIL           a verified sender in Resend
 *   APP_URL                     e.g. https://brasstally.com
 *   CRON_SECRET                 required. See the note below.
 */

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { approvalEmail } from "./lib/email.js";

const WAIT_MINUTES = 7;   // long enough to feel considered, short enough to be remembered
const BATCH = 50;         // bounds a runaway table, and the email bill with it

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // This endpoint mints authentication links and sends them. Unauthenticated,
  // it is a way for anyone to drain the Resend quota and to approve every
  // pending signup on demand. So it fails closed: no secret configured means
  // no runs, rather than an open door.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set; refusing to run");
    return res.status(500).json({ error: "CRON_SECRET is not configured" });
  }
  const auth = req.headers.authorization || "";
  const header = req.headers["x-cron-secret"] || "";
  if (auth !== `Bearer ${secret}` && header !== secret) {
    return res.status(401).json({ error: "Not authorized" });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_URL } = process.env;
  const missing = Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_URL })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error("missing environment:", missing.join(", "));
    return res.status(500).json({ error: "Missing environment", missing });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const resend = new Resend(RESEND_API_KEY);
  const redirectTo = `${APP_URL.replace(/\/$/, "")}/app`;
  const cutoff = new Date(Date.now() - WAIT_MINUTES * 60_000).toISOString();

  const { data: due, error } = await supabase
    .from("beta_signups")
    .select("id, email, created_at")
    .eq("status", "pending")
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error("could not read beta_signups:", error);
    return res.status(500).json({ error: "Database read failed" });
  }
  if (!due?.length) return res.status(200).json({ approved: 0, checked: 0 });

  const results = [];
  for (const row of due) {
    try {
      // An invite creates the account and returns a link without sending
      // anything, which is what we want: Resend does the sending, so the email
      // matches the rest of the brand. An address that already has an account
      // cannot be invited again, so it falls through to a magic link.
      let link = await supabase.auth.admin.generateLink({
        type: "invite",
        email: row.email,
        options: { redirectTo },
      });
      if (link.error && /already|registered|exists/i.test(link.error.message || "")) {
        link = await supabase.auth.admin.generateLink({
          type: "magiclink",
          email: row.email,
          options: { redirectTo },
        });
      }
      if (link.error) throw link.error;

      const actionLink = link.data?.properties?.action_link;
      // The app's sign-in screen accepts a six digit code, so the email carries
      // one too. Mail clients that rewrite links, and anyone opening the email
      // on a different device, still have a way in.
      const code = link.data?.properties?.email_otp || null;
      if (!actionLink) throw new Error("no action link returned");

      const { error: sendError } = await resend.emails.send({
        from: RESEND_FROM_EMAIL,
        to: row.email,
        subject: "Your Brasstally access is ready",
        html: approvalEmail({ actionLink, code, appUrl: APP_URL }),
        text:
          `Your Brasstally access is ready.\n\nOpen your books: ${actionLink}\n` +
          (code ? `\nOr enter this code in the app: ${code}\n` : "") +
          `\nThe link works once and expires in 24 hours.\n`,
      });
      if (sendError) throw sendError;

      // Only now. A row marked approved before the email lands is a person who
      // never hears from us and cannot be found again by the next run.
      const { error: updateError } = await supabase
        .from("beta_signups")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending");          // no double send if two runs overlap
      if (updateError) throw updateError;

      results.push({ email: row.email, ok: true });
    } catch (e) {
      // Left pending on purpose, so the next run picks it up. A transient
      // Resend hiccup should not cost someone their invitation.
      console.error(`approval failed for ${row.email}:`, e?.message || e);
      results.push({ email: row.email, ok: false, error: String(e?.message || e) });
    }
  }

  const approved = results.filter((r) => r.ok).length;
  console.log(`beta approvals: ${approved} of ${results.length}`);
  return res.status(200).json({ approved, checked: results.length, results });
}
