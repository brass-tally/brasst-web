// Calls the "extract" Edge Function, which holds the Anthropic API key
// server-side. The signed-in user's JWT is attached automatically.

import { supabase } from "./supabase";

export class ExtractError extends Error {
  constructor(message, code = "unknown") {
    super(message);
    this.name = "ExtractError";
    this.code = code;
  }
}

// One short sentence a person can act on. The raw error goes to the console,
// not into the chat bubble.
export function friendlyError(err) {
  switch (err?.code) {
    case "no_key": return "the reader isn't set up yet (no API key on the server)";
    case "auth": return "your session expired, sign in again";
    case "network": return "I couldn't reach the reader";
    case "rate_limit": return "the reader is busy right now";
    case "upstream": return "the reader had a problem on its end";
    case "refusal": return "the reader declined to read that";
    case "empty": return "the reader came back empty";
    case "parse": return "the reader sent something I couldn't read";
    default: return "the reader didn't respond";
  }
}

// Walks the string once and returns the first complete JSON object or array,
// brace-matched and string-aware. Models occasionally wrap JSON in prose or a
// code fence even when told not to; a bare JSON.parse throws on both.
function firstJsonValue(text) {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export function parseModelJson(text) {
  const clean = String(text || "").replace(/```(?:json)?/gi, "").trim();
  if (!clean) throw new ExtractError("empty response", "empty");
  const candidates = [clean, firstJsonValue(clean)].filter(Boolean);
  for (const candidate of candidates) {
    for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, "$1")]) {
      try { return JSON.parse(attempt); } catch { /* try the next shape */ }
    }
  }
  throw new ExtractError("response was not JSON", "parse");
}

/**
 * @param content  Anthropic content blocks (text / image / document).
 * @param options  { maxTokens, schema } — schema turns on structured outputs,
 *                 which makes the response shape guaranteed rather than hoped
 *                 for. A bare number is still accepted for older call sites.
 */
export async function askClaude(content, options = {}) {
  const { maxTokens = 1024, schema = null } =
    typeof options === "number" ? { maxTokens: options } : options;

  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await supabase.functions.invoke("extract", {
      body: { content, max_tokens: maxTokens, ...(schema ? { schema } : {}) },
    });

    if (error) {
      // supabase-js surfaces non-2xx as a FunctionsHttpError whose body carries
      // our own { error, code }. Read it so the UI can say something useful.
      const body = await error.context?.json?.().catch(() => null);
      last = new ExtractError(body?.error || error.message || "request failed", body?.code || "network");
    } else if (data?.error) {
      last = new ExtractError(data.error, data.code || "upstream");
    } else {
      return parseModelJson(data?.text);
    }

    console.error("extract failed:", last);
    if (!["network", "rate_limit", "upstream"].includes(last.code)) throw last;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 700));
  }
  throw last;
}
