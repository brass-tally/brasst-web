/* Taking a card payment on an invoice.
 *
 * Secrets required, and only the ones for providers actually used:
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *   PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_ENV
 *   SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_SIGNATURE_KEY, SQUARE_ENV
 *
 * No key is ever stored in a row or returned to a browser. This function is
 * the only place they are read.
 *
 * Two halves that must not be confused:
 *
 *   `checkout`  owner or customer asks for somewhere to pay. Creates the
 *               session at the provider and hands back a URL.
 *   `webhook`   the provider says what happened. Verified by signature,
 *               recorded, and never trusted because it arrived.
 *
 * JWT verification is off on this function by necessity: a provider posting a
 * webhook has no session, and a customer opening a payment link has no
 * account. Each path authorises itself, which is narrower than a blanket check
 * rather than wider.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature, paypal-transmission-id, x-square-hmacsha256-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);

/* ---------------- providers ---------------- */

/* Stripe. A Checkout Session rather than a Payment Link, because a session
   carries the invoice id in its metadata and a link does not: without that the
   webhook knows money arrived and not what it was for. */
async function stripeCheckout(inv: Record<string, any>, back: string) {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Stripe is not configured on this project.");

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${back}?paid=1`);
  form.set("cancel_url", back);
  form.set("client_reference_id", String(inv.id));
  form.set("metadata[invoice_id]", String(inv.id));
  form.set("metadata[ledger_id]", String(inv.ledger_id));
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", String(inv.currency || "CAD").toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(cents(inv.amount)));
  form.set("line_items[0][price_data][product_data][name]", `Invoice ${inv.number}`);
  if (inv.contact_email) form.set("customer_email", String(inv.contact_email));

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || "Stripe refused the request.");
  return { url: d.url as string, ref: d.id as string };
}

async function paypalToken() {
  const id = Deno.env.get("PAYPAL_CLIENT_ID");
  const secret = Deno.env.get("PAYPAL_SECRET");
  if (!id || !secret) throw new Error("PayPal is not configured on this project.");
  const base = (Deno.env.get("PAYPAL_ENV") || "sandbox") === "live"
    ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error_description || "PayPal refused the credentials.");
  return { token: d.access_token as string, base };
}

async function paypalCheckout(inv: Record<string, any>, back: string) {
  const { token, base } = await paypalToken();
  const r = await fetch(`${base}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        /* Their reference is where the invoice id travels. The webhook reads it
           back, and without it a captured order is money with no invoice. */
        custom_id: String(inv.id),
        invoice_id: `${inv.number}-${String(inv.id).slice(0, 8)}`,
        amount: { currency_code: String(inv.currency || "CAD"), value: money(inv.amount).toFixed(2) },
      }],
      application_context: { return_url: `${back}?paid=1`, cancel_url: back, user_action: "PAY_NOW" },
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.message || "PayPal refused the request.");
  const approve = (d.links || []).find((l: Record<string, string>) => l.rel === "approve" || l.rel === "payer-action");
  return { url: approve?.href as string, ref: d.id as string };
}

async function squareCheckout(inv: Record<string, any>, back: string) {
  const token = Deno.env.get("SQUARE_ACCESS_TOKEN");
  const location = Deno.env.get("SQUARE_LOCATION_ID");
  if (!token || !location) throw new Error("Square is not configured on this project.");
  const base = (Deno.env.get("SQUARE_ENV") || "sandbox") === "production"
    ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";

  const r = await fetch(`${base}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": "2024-06-04",
    },
    body: JSON.stringify({
      idempotency_key: `${inv.id}-${Date.now()}`,
      quick_pay: {
        name: `Invoice ${inv.number}`,
        price_money: { amount: cents(inv.amount), currency: String(inv.currency || "CAD") },
        location_id: location,
      },
      /* Square returns this on the payment, which is how the webhook finds the
         invoice again. */
      payment_note: String(inv.id),
      checkout_options: { redirect_url: `${back}?paid=1` },
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.errors?.[0]?.detail || "Square refused the request.");
  return { url: d?.payment_link?.url as string, ref: d?.payment_link?.id as string };
}

/* ---------------- recording what happened ---------------- */

/* One place where a payment becomes a row.
 *
 * Every provider funnels through this, so the shape of the record cannot drift
 * between them, and the unique key on (provider, provider_ref) makes a webhook
 * delivered twice harmless. Providers retry, so this will happen. */
async function recordPayment(p: {
  ledger_id: string; invoice_id: string | null; provider: string; provider_ref: string;
  session_ref?: string | null; amount: number; fee?: number; currency: string;
  status: string; raw: unknown;
}) {
  const net = money(p.amount) - money(p.fee || 0);
  const { error } = await db.from("invoice_payments").upsert({
    ledger_id: p.ledger_id,
    invoice_id: p.invoice_id,
    provider: p.provider,
    provider_ref: p.provider_ref,
    session_ref: p.session_ref || null,
    amount: money(p.amount),
    fee: money(p.fee || 0),
    net,
    currency: p.currency,
    status: p.status,
    paid_at: p.status === "paid" ? new Date().toISOString() : null,
    raw: p.raw as Record<string, unknown>,
  }, { onConflict: "provider,provider_ref" });
  if (error) console.error("recordPayment:", error.message);

  /* The invoice is marked paid only when the money is actually paid, and the
     books are left alone: turning this into a transaction is a decision the
     owner makes, in front of the figures, not something a webhook does while
     nobody is looking. */
  if (p.status === "paid" && p.invoice_id) {
    await db.from("sent_invoices").update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", p.invoice_id);
  }
}

/* ---------------- the function ---------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const hook = url.searchParams.get("hook");

  try {
    /* A provider telling us something. Signature first: an unverified webhook
       is an anonymous stranger claiming you have been paid. */
    if (hook) {
      const body = await req.text();

      if (hook === "stripe") {
        const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
        const sig = req.headers.get("stripe-signature") || "";
        if (!secret || !(await stripeSigned(body, sig, secret))) {
          return json({ error: "Bad signature" }, 400);
        }
        const e = JSON.parse(body);
        const o = e?.data?.object || {};
        if (e.type === "checkout.session.completed" && o.payment_status === "paid") {
          await recordPayment({
            ledger_id: o.metadata?.ledger_id,
            invoice_id: o.metadata?.invoice_id || null,
            provider: "stripe",
            provider_ref: String(o.payment_intent || o.id),
            session_ref: String(o.id),
            amount: (Number(o.amount_total) || 0) / 100,
            currency: String(o.currency || "cad").toUpperCase(),
            status: "paid",
            raw: e,
          });
        }
        return json({ ok: true });
      }

      if (hook === "paypal") {
        /* PayPal verifies by asking PayPal, which is slower than a local HMAC
           and the only method they offer. */
        if (!(await paypalVerified(req.headers, body))) return json({ error: "Bad signature" }, 400);
        const e = JSON.parse(body);
        const r = e?.resource || {};
        if (e.event_type === "PAYMENT.CAPTURE.COMPLETED") {
          const invoiceId = r.custom_id || r?.supplementary_data?.related_ids?.order_id || null;
          const { data: inv } = invoiceId
            ? await db.from("sent_invoices").select("id, ledger_id").eq("id", invoiceId).maybeSingle()
            : { data: null };
          await recordPayment({
            ledger_id: inv?.ledger_id,
            invoice_id: inv?.id || null,
            provider: "paypal",
            provider_ref: String(r.id),
            amount: Number(r?.amount?.value) || 0,
            fee: Number(r?.seller_receivable_breakdown?.paypal_fee?.value) || 0,
            currency: String(r?.amount?.currency_code || "CAD"),
            status: "paid",
            raw: e,
          });
        }
        return json({ ok: true });
      }

      if (hook === "square") {
        const key = Deno.env.get("SQUARE_SIGNATURE_KEY");
        const sig = req.headers.get("x-square-hmacsha256-signature") || "";
        const notifyUrl = Deno.env.get("SQUARE_WEBHOOK_URL") || req.url;
        if (!key || !(await squareSigned(notifyUrl, body, sig, key))) {
          console.warn("square signature failed against", notifyUrl);
          return json({ error: "Bad signature" }, 400);
        }
        const e = JSON.parse(body);
        const pay = e?.data?.object?.payment || {};
        if (e.type === "payment.updated" && pay.status === "COMPLETED") {
          const invoiceId = String(pay.note || "").trim() || null;
          const { data: inv } = invoiceId
            ? await db.from("sent_invoices").select("id, ledger_id").eq("id", invoiceId).maybeSingle()
            : { data: null };
          await recordPayment({
            ledger_id: inv?.ledger_id,
            invoice_id: inv?.id || null,
            provider: "square",
            provider_ref: String(pay.id),
            amount: (Number(pay?.amount_money?.amount) || 0) / 100,
            fee: (Number(pay?.processing_fee?.[0]?.amount_money?.amount) || 0) / 100,
            currency: String(pay?.amount_money?.currency || "CAD"),
            status: "paid",
            raw: e,
          });
        }
        return json({ ok: true });
      }

      return json({ ok: true, ignored: hook });
    }

    const { action, ...body } = await req.json();

    if (action === "health") {
      /* Which providers this project could use. Not which are switched on:
         that is per ledger and lives in a table. */
      return json({
        ok: true,
        configured: {
          stripe: Boolean(Deno.env.get("STRIPE_SECRET_KEY")),
          paypal: Boolean(Deno.env.get("PAYPAL_CLIENT_ID") && Deno.env.get("PAYPAL_SECRET")),
          square: Boolean(Deno.env.get("SQUARE_ACCESS_TOKEN") && Deno.env.get("SQUARE_LOCATION_ID")),
        },
      });
    }

    /* Somewhere to pay. Asked for by the customer's own page, which has the
       invoice token and no account, so the token is the authorisation. */
    if (action === "checkout") {
      const token = String(body.token || "");
      const provider = String(body.provider || "stripe");

      const { data: inv } = await db
        .from("sent_invoices").select("*").eq("token", token).eq("status", "sent").maybeSingle();
      if (!inv) return json({ ok: false, error: "This invoice is not available." });

      const { data: on } = await db
        .from("payment_providers").select("enabled")
        .eq("ledger_id", inv.ledger_id).eq("provider", provider).maybeSingle();
      if (!on?.enabled) return json({ ok: false, error: "That way of paying is not switched on." });

      const base = (Deno.env.get("APP_URL") || "https://www.brasstally.com").replace(/\/+$/, "");
      const back = `${base}/v/${token}`;

      const made = provider === "paypal" ? await paypalCheckout(inv, back)
        : provider === "square" ? await squareCheckout(inv, back)
          : await stripeCheckout(inv, back);

      if (!made.url) return json({ ok: false, error: "That provider did not return a payment page." });

      await db.from("sent_invoices")
        .update({ pay_url: made.url, pay_provider: provider, updated_at: new Date().toISOString() })
        .eq("id", inv.id);

      return json({ ok: true, url: made.url, ref: made.ref });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("payments:", e);
    return json({ ok: false, error: (e as Error)?.message || "That step did not complete." });
  }
});

/* ---------------- signatures ---------------- */

const enc = new TextEncoder();

async function hmac(key: string, data: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Stripe signs the timestamp and the body together. Comparing the whole
   header rather than the digest would pass anything with the right shape. */
async function stripeSigned(body: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")) as [string, string][]);
  if (!parts.t || !parts.v1) return false;
  /* Five minutes, so a captured request cannot be replayed tomorrow. */
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = await hmac(secret, `${parts.t}.${body}`);
  return timingSafe(expected, parts.v1);
}

/* Square signs the notification URL followed by the body, and the URL has to
 * match what is configured at Square byte for byte.
 *
 * `req.url` is what the runtime received, which is not reliably that: a proxy
 * can normalise a trailing slash, change the host, or add a query string, and
 * any of those makes every signature fail with nothing to say why.
 *
 * So the URL is taken from a secret that holds exactly what was typed into
 * Square's dashboard, and `req.url` is only the fallback.
 */
async function squareSigned(url: string, body: string, sig: string, key: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const out = await crypto.subtle.sign("HMAC", k, enc.encode(url + body));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(out)));
  return timingSafe(b64, sig);
}

async function paypalVerified(headers: Headers, body: string) {
  const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
  if (!webhookId) return false;
  const { token, base } = await paypalToken();
  const r = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: JSON.parse(body),
    }),
  });
  const d = await r.json();
  return d?.verification_status === "SUCCESS";
}

/* Comparing byte by byte, in constant time. A normal comparison returns early
   on the first difference, which leaks how much of a guess was right. */
function timingSafe(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
