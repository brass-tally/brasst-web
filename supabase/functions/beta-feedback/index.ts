// Supabase Edge Function: beta-feedback
//
// Rewritten. Three things were wrong with the original:
//
//   1. It ran on the SERVICE ROLE and took `user_id` straight from the request
//      body. The service role bypasses RLS, so any caller could attribute
//      feedback to any account by typing someone else's uuid. Identity now
//      comes from the verified JWT, and the row is written with the caller's
//      own privileges. Nothing here needs to bypass RLS: the
//      "feedback: anyone may submit" policy already permits the insert.
//
//   2. No CORS headers and no OPTIONS handler. A browser calling this from
//      brasstally.com to *.supabase.co is cross origin, so the preflight fails
//      before the POST is ever sent. The other two functions both handle it.
//
//   3. Nothing was bounded. A single request could write megabytes, repeatedly,
//      through a privileged client.
//
// Deploy with verify_jwt OFF, because logged-out visitors need to be able to
// report a problem. The function still reads a JWT when one is present:
//   supabase functions deploy beta-feedback --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const CATEGORIES = new Set(["bug", "feature", "improvement", "other"]);
const MAX_MESSAGE = 4000;
const MAX_URL = 500;

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be JSON" }, 400);
  }

  const category = clean(body.category, 32).toLowerCase();
  const message = clean(body.message, MAX_MESSAGE);
  const url = clean(body.url, MAX_URL);

  if (!CATEGORIES.has(category)) {
    return json({ error: "Unknown category" }, 400);
  }
  if (message.length < 2) {
    return json({ error: "Tell us a little more than that" }, 400);
  }
  if (url && !/^https?:\/\//i.test(url)) {
    return json({ error: "url must be http or https" }, 400);
  }

  // The caller's own client. When a JWT is attached the insert runs as that
  // user; when it is not, it runs as anon. Either way RLS applies, which is the
  // point: this function holds no privilege the caller does not already have.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined,
  );

  // Identity is read, never accepted. A body that carries its own user_id is
  // ignored entirely.
  let userId: string | null = null;
  if (authHeader) {
    const { data } = await supabase.auth.getUser();
    userId = data?.user?.id ?? null;
  }

  const { error } = await supabase.from("beta_feedback").insert({
    category,
    message,
    url: url || null,
    // The client's clock is not evidence of anything. Record ours.
    timestamp: new Date().toISOString(),
    user_id: userId,
    status: "new",
  });

  if (error) {
    // The message can name columns and constraints, so it goes to the log and
    // the caller gets something plain.
    console.error("beta-feedback insert failed:", error);
    return json({ error: "Could not save that. Please try again." }, 500);
  }

  return json({ success: true, message: "Feedback received, thank you." });
});
