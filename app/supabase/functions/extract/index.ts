// Supabase Edge Function: extract
// Proxies Anthropic API calls so the key never ships to the browser. Deployed
// with verify_jwt on (the default), so only signed-in users of your app can
// call it.
//
// Two shapes, one function (one deploy):
//   1. extraction — { content, max_tokens, schema }        -> { text }
//      A single reading turn. Used for receipts, invoices, statements.
//   2. agent      — { messages, system, tools, max_tokens } -> { content, stop_reason }
//      One turn of a tool-using conversation. The loop itself runs in the
//      browser, where the ledger already lives, so tools never need a server
//      round trip and the raw ledger never has to leave the client wholesale.
//
// Deploy:   supabase functions deploy extract
// Secret:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Reading a receipt is a transcription task — Haiku is fast and cheap enough.
// Reasoning over a whole ledger is not, so the agent turn gets a bigger model.
const EXTRACT_MODEL = "claude-haiku-4-5";
const AGENT_MODEL = "claude-sonnet-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const ATTEMPTS = 3;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Failure = { error: string; code: string; status: number };

/**
 * Posts to Anthropic with retries, and hands back either the parsed body or a
 * described failure. `onBadRequest` lets a caller salvage a 400 by mutating its
 * own payload (we use it to drop structured outputs) — return true to retry.
 */
async function callAnthropic(
  apiKey: string,
  payload: () => unknown,
  onBadRequest?: (message: string) => boolean,
): Promise<{ data: Record<string, unknown> } | { failure: Failure }> {
  let last: Failure = { error: "the Anthropic API did not respond", code: "upstream", status: 502 };

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let r: Response;
    try {
      r = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload()),
      });
    } catch (e) {
      last = { error: `could not reach the Anthropic API: ${e}`, code: "network", status: 502 };
      if (attempt < ATTEMPTS) await sleep(400 * attempt);
      continue;
    }

    const data = await r.json().catch(() => null);

    if (r.ok) return { data: data ?? {} };

    const message = data?.error?.message ?? `Anthropic API error ${r.status}`;

    if (r.status === 400 && onBadRequest?.(message)) {
      console.error("retrying after a 400:", message);
      continue;
    }

    const retryable = r.status === 429 || r.status >= 500;
    last = {
      error: message,
      code: r.status === 401 || r.status === 403 ? "auth" : r.status === 429 ? "rate_limit" : "upstream",
      status: retryable ? 503 : 502,
    };
    if (!retryable) break;
    const after = Number(r.headers.get("retry-after"));
    if (attempt < ATTEMPTS) await sleep(after > 0 ? Math.min(after * 1000, 4000) : 500 * attempt);
  }

  return { failure: last };
}

/* ---------------- agent turn: tools in, content blocks out ---------------- */

async function agentTurn(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const { messages, system, tools, max_tokens } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "messages must be a non-empty array", code: "bad_request" }, 400);
  }
  if (tools !== undefined && !Array.isArray(tools)) {
    return json({ error: "tools must be an array", code: "bad_request" }, 400);
  }

  const maxTokens = Math.min(Math.max(Number(max_tokens) || 2048, 512), 8192);

  const payload = () => ({
    model: AGENT_MODEL,
    max_tokens: maxTokens,
    ...(typeof system === "string" && system ? { system } : {}),
    ...(Array.isArray(tools) && tools.length ? { tools } : {}),
    messages,
  });

  const out = await callAnthropic(apiKey, payload);
  if ("failure" in out) {
    console.error("agent turn failed:", out.failure);
    return json({ error: out.failure.error, code: out.failure.code }, out.failure.status);
  }

  const { data } = out;
  if (data?.stop_reason === "refusal") {
    return json({ error: "the model declined to answer that", code: "refusal" }, 422);
  }

  const content = Array.isArray(data?.content) ? data.content : [];
  if (!content.length) {
    return json({ error: "the model returned nothing", code: "empty" }, 502);
  }

  return json({ content, stop_reason: data?.stop_reason ?? "end_turn" });
}

/* ---------------- extraction turn: one read, JSON text out ---------------- */

async function extractTurn(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const { content, max_tokens, schema } = body;

  if (!Array.isArray(content) || content.length === 0) {
    return json({ error: "content must be a non-empty array of blocks", code: "bad_request" }, 400);
  }

  // Keep a modest floor so a tight caller cap can't truncate JSON mid-object.
  const maxTokens = Math.min(Math.max(Number(max_tokens) || 1024, 1024), 8192);

  // Structured outputs: when the caller hands us a schema, the response is
  // guaranteed to match it instead of merely asked to.
  let useSchema = !!schema;

  const payload = () => ({
    model: EXTRACT_MODEL,
    max_tokens: maxTokens,
    ...(useSchema
      ? { output_config: { format: { type: "json_schema", schema } } }
      : {}),
    messages: [{ role: "user", content }],
  });

  // If this deployment's model doesn't accept the structured-output shape, drop
  // it and let the prompt carry the format instead of failing outright.
  const salvage = (message: string) => {
    if (!useSchema || !/output_config|json_schema|schema|format/i.test(message)) return false;
    useSchema = false;
    return true;
  };

  const out = await callAnthropic(apiKey, payload, salvage);
  if ("failure" in out) {
    console.error("extract failed:", out.failure);
    return json({ error: out.failure.error, code: out.failure.code }, out.failure.status);
  }

  const { data } = out;

  // Safety classifiers can decline with a 200 — content is empty or partial.
  if (data?.stop_reason === "refusal") {
    return json({ error: "the model declined to read that content", code: "refusal" }, 422);
  }

  const text = ((data?.content ?? []) as Array<{ type: string; text: string }>)
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) {
    return json({
      error: data?.stop_reason === "max_tokens"
        ? "the reply was cut off before any JSON was produced"
        : "the model returned no text",
      code: "empty",
    }, 502);
  }

  return json({ text });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "ANTHROPIC_API_KEY is not set on the extract function", code: "no_key" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "request body must be JSON", code: "bad_request" }, 400);
  }

  return body?.messages ? agentTurn(apiKey, body ?? {}) : extractTurn(apiKey, body ?? {});
});
