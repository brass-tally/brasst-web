// Supabase Edge Function: extract
// Proxies receipt/invoice extraction to the Anthropic API so the key
// never ships to the browser. Deployed with verify_jwt on (the default),
// so only signed-in users of your app can call it.
//
// Deploy:   supabase functions deploy extract
// Secret:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Receipt/entry extraction is a reading task — Haiku is fast and cheap enough.
const MODEL = "claude-haiku-4-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const ATTEMPTS = 3;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "ANTHROPIC_API_KEY is not set on the extract function", code: "no_key" }, 500);
  }

  let body: { content?: unknown; max_tokens?: unknown; schema?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "request body must be JSON", code: "bad_request" }, 400);
  }

  const { content, max_tokens, schema } = body ?? {};
  if (!Array.isArray(content) || content.length === 0) {
    return json({ error: "content must be a non-empty array of blocks", code: "bad_request" }, 400);
  }

  // Keep a modest floor so a tight caller cap can't truncate JSON mid-object.
  const maxTokens = Math.min(Math.max(Number(max_tokens) || 1024, 1024), 8192);

  // Structured outputs: when the caller hands us a schema, the response is
  // guaranteed to match it instead of merely asked to.
  let useSchema = !!schema;

  const payload = () => ({
    model: MODEL,
    max_tokens: maxTokens,
    ...(useSchema
      ? { output_config: { format: { type: "json_schema", schema } } }
      : {}),
    messages: [{ role: "user", content }],
  });

  let last = { error: "the Anthropic API did not respond", code: "upstream", status: 502 };

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

    if (!r.ok) {
      const message = data?.error?.message ?? `Anthropic API error ${r.status}`;

      // If this deployment's model doesn't accept the structured-output shape,
      // drop it and let the prompt carry the format instead of failing outright.
      if (r.status === 400 && useSchema && /output_config|json_schema|schema|format/i.test(message)) {
        console.error("structured outputs rejected, retrying without a schema:", message);
        useSchema = false;
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
      continue;
    }

    // Safety classifiers can decline with a 200 — content is empty or partial.
    if (data?.stop_reason === "refusal") {
      return json({ error: "the model declined to read that content", code: "refusal" }, 422);
    }

    const text = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();

    if (!text) {
      last = {
        error: data?.stop_reason === "max_tokens"
          ? "the reply was cut off before any JSON was produced"
          : "the model returned no text",
        code: "empty",
        status: 502,
      };
      if (attempt < ATTEMPTS) continue;
      break;
    }

    return json({ text });
  }

  console.error("extract failed:", last);
  return json({ error: last.error, code: last.code }, last.status);
});
