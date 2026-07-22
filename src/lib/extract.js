// Calls the "extract" Edge Function, which holds the Anthropic API key
// server-side. The signed-in user's JWT is attached automatically.

import { supabase } from "./supabase";

export async function askClaude(content) {
  const { data, error } = await supabase.functions.invoke("extract", {
    body: { content },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  const clean = (data?.text || "").replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}
