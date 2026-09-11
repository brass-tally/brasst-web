/* ================= the transcript =================
   Stored per user per ledger, so the phone and the desktop hold one
   conversation rather than two.

   It was in the browser's own storage. That meant a card drawn on one device
   was invisible on the other, and the message saying "the card is above"
   pointed at nothing. */

import { supabase } from "./supabase";

const soft = async (label, fn, fallback) => {
  try { return await fn(); } catch (e) {
    console.warn(`chat: ${label} unavailable:`, e?.message || e);
    return fallback;
  }
};

/* What is worth keeping.

   Attachments and images hold a File and a blob URL, neither of which
   survives leaving the page, so a restored message pointing at a dead blob
   renders a broken image.

   Proposals ARE kept, which reverses an earlier decision. I dropped them on
   the grounds that a card restored days later invites action on stale
   figures. That was wrong in a way the transcript made obvious: the message
   beside it says "the card is above", so removing the card leaves the words
   lying about what is on screen. A card that is still there and no longer
   wanted can be dismissed. One that vanished cannot be anything. */
const strip = (m) => {
  const { att, image, ...rest } = m;
  return rest;
};

export async function loadThread(ledgerId, limit = 80) {
  return soft("load", async () => {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, payload")
      .eq("ledger_id", ledgerId)
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).reverse().map((r) => ({ ...r.payload, _id: r.id }));
  }, null);   // null means "could not load", which is not the same as "empty"
}

export async function appendMessage(ledgerId, message) {
  return soft("append", async () => {
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ ledger_id: ledgerId, payload: strip(message) })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }, null);
}

export async function clearThread(ledgerId) {
  return soft("clear", async () => {
    const { error } = await supabase.from("chat_messages").delete().eq("ledger_id", ledgerId);
    if (error) throw error;
    return true;
  }, false);
}

/* Messages arriving from another device.
   Returns an unsubscribe. Inert without the realtime publication from 0032,
   in which case the other device's messages appear on the next load. */
export function watchThread(ledgerId, onMessage) {
  if (!ledgerId) return () => {};
  try {
    const channel = supabase
      .channel(`chat:${ledgerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `ledger_id=eq.${ledgerId}` },
        (p) => p?.new && onMessage?.({ ...p.new.payload, _id: p.new.id }),
      )
      .subscribe();
    return () => { try { supabase.removeChannel(channel); } catch { /* already gone */ } };
  } catch (e) {
    console.warn("chat realtime unavailable:", e?.message || e);
    return () => {};
  }
}
