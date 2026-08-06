// Plaid, via the "plaid" Edge Function. Keys never reach the browser;
// Plaid Link renders as an embedded overlay inside the app.

import { supabase } from "./supabase";

const LINK_SESSION_KEY = "plaid:link_session";

export async function plaid(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("plaid", { body: { action, ...body } });
  if (error) {
    // supabase-js hides non-2xx bodies behind error.context; dig the real message out
    try {
      const detail = await error.context?.json?.();
      if (detail?.error) throw new Error(detail.error);
    } catch (inner) {
      if (inner instanceof Error && inner.message && !/json/i.test(inner.message)) throw inner;
    }
    throw new Error(error.message || "The bank connector didn't respond");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function listConnections(ledgerId) {
  const { data, error } = await supabase
    .from("bank_connections")
    .select("id, institution, last_synced, current_balance, balance_as_of, accounts")
    .eq("ledger_id", ledgerId)
    .order("created_at");
  if (error) throw error;
  return data || [];
}

/** Sum of depository balances across connections (null if none reported yet). */
export function sumBankBalance(connections) {
  if (!connections?.length) return null;
  let total = 0;
  let any = false;
  for (const c of connections) {
    if (c.current_balance == null || Number.isNaN(Number(c.current_balance))) continue;
    total += Number(c.current_balance);
    any = true;
  }
  return any ? total : null;
}

/** Newest balance_as_of across connections, or null. */
export function latestBalanceAsOf(connections) {
  let best = null;
  for (const c of connections || []) {
    if (!c.balance_as_of) continue;
    if (!best || String(c.balance_as_of) > String(best)) best = c.balance_as_of;
  }
  return best;
}

let linkPromise = null;
export function loadPlaidLink() {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  if (!linkPromise) {
    linkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      s.async = true;
      s.onload = () => {
        if (window.Plaid) resolve(window.Plaid);
        else reject(new Error("Couldn't load Plaid Link"));
      };
      s.onerror = () => reject(new Error("Couldn't load Plaid Link"));
      document.head.appendChild(s);
    });
  }
  return linkPromise;
}

/** Exact origin path Plaid must have allowlisted (no query/hash). */
export function plaidRedirectUri() {
  return `${window.location.origin}/`;
}

// Banks that authenticate in their own app send the user back through a fresh
// tab, which has an empty sessionStorage. The link token has to outlive the tab
// that opened it, so localStorage is the source of truth and sessionStorage is
// only a fallback for browsers that block it.
function linkStores() {
  const out = [];
  try { if (window.localStorage) out.push(window.localStorage); } catch { /* blocked */ }
  try { if (window.sessionStorage) out.push(window.sessionStorage); } catch { /* blocked */ }
  return out;
}

export function saveLinkSession({ link_token, ledger_id }) {
  const value = JSON.stringify({ link_token, ledger_id, at: Date.now() });
  for (const store of linkStores()) {
    try { store.setItem(LINK_SESSION_KEY, value); } catch { /* private mode */ }
  }
}

export function loadLinkSession() {
  for (const store of linkStores()) {
    try {
      const raw = store.getItem(LINK_SESSION_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed?.link_token || !parsed?.ledger_id) continue;
      // link tokens expire ~4h; drop stale sessions
      if (parsed.at && Date.now() - parsed.at > 3.5 * 60 * 60 * 1000) {
        clearLinkSession();
        return null;
      }
      return parsed;
    } catch { /* try the next store */ }
  }
  return null;
}

export function clearLinkSession() {
  for (const store of linkStores()) {
    try { store.removeItem(LINK_SESSION_KEY); } catch { /* ignore */ }
  }
}

/** True when returning from a bank OAuth page with ?oauth_state_id=… */
export function oauthReturnUri() {
  const q = new URLSearchParams(window.location.search);
  if (!q.has("oauth_state_id")) return null;
  return window.location.href;
}

export function stripOauthParams() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("oauth_state_id")) return;
  url.searchParams.delete("oauth_state_id");
  const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash;
  window.history.replaceState({}, "", clean);
}

/**
 * Open (or resume) Plaid Link. Callers supply success/error handlers.
 * `receivedRedirectUri` is only set when finishing an OAuth return.
 */
export async function openPlaidLink({
  link_token,
  receivedRedirectUri,
  onSuccess,
  onExit,
  onEvent,
}) {
  const Plaid = await loadPlaidLink();
  const handler = Plaid.create({
    token: link_token,
    ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
    onEvent: (eventName, metadata) => {
      // link_session_id is needed for Plaid support when Link fails (e.g. institution errors)
      console.log("[Plaid Link onEvent]", eventName, metadata);
      onEvent?.(eventName, metadata);
    },
    onSuccess: async (public_token, metadata) => {
      console.log("[Plaid Link onSuccess]", metadata);
      clearLinkSession();
      stripOauthParams();
      await onSuccess?.(public_token, metadata);
    },
    onExit: (err, metadata) => {
      console.log("[Plaid Link onExit]", err, metadata);
      stripOauthParams();
      // Only drop the token when it can't be reused. Bank-app approvals often
      // exit mid-flow, and the same token resumes that session.
      if (err && /INVALID_LINK_TOKEN|TOKEN_EXPIRED|ITEM_LOCKED/i.test(err.error_code || "")) clearLinkSession();
      onExit?.(err, metadata);
    },
  });
  handler.open();
  return handler;
}
