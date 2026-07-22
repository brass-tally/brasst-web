import { createClient } from "@supabase/supabase-js";

// The publishable key is safe to ship in frontend code (that's its purpose);
// row-level security + auth are what protect your data.
// Env vars override these if you ever move projects.
const url = import.meta.env.VITE_SUPABASE_URL || "https://xwoccmgppjmgficvmogr.supabase.co";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_KYf7h0SuGIIDM7Fj_L0fWw_xbinzUC_";

export const supabase = createClient(url, key);
