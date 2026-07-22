// Plaid, via the "plaid" Edge Function. Keys never reach the browser;
// Plaid Link renders as an embedded overlay inside the app.

import { supabase } from "./supabase";

export async function plaid(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("plaid", { body: { action, ...body } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function listConnections(ledgerId) {
  const { data, error } = await supabase
    .from("bank_connections")
    .select("id, institution, last_synced")
    .eq("ledger_id", ledgerId)
    .order("created_at");
  if (error) throw error;
  return data || [];
}

let linkPromise = null;
export function loadPlaidLink() {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  if (!linkPromise) {
    linkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      s.onload = () => resolve(window.Plaid);
      s.onerror = () => reject(new Error("Couldn't load Plaid Link"));
      document.head.appendChild(s);
    });
  }
  return linkPromise;
}
