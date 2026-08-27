import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Camera, Plus, Trash2, Check, Send, Loader2, RotateCcw, X, LogOut, Mail, Pencil, ArrowLeftRight, ChevronDown, User,
  ArrowUpRight, ArrowDownRight, Paperclip, FileText, Sun, Moon, Download, MessageSquare, Repeat,
  LayoutGrid, Receipt, TrendingUp, FileClock, Coins, CalendarDays, Plug, Lock, StickyNote,
  Search, Sparkles, AlertTriangle, Info, ChevronRight, ChevronLeft, Copy, History
} from "lucide-react";
import { supabase } from "./lib/supabase";
import * as db from "./lib/db";
import * as bank from "./lib/bank";
import { jsPDF } from "jspdf";
import { askClaude, friendlyError } from "./lib/extract";
import { parseEntryText, normalizeDraft, coerceAmount, coerceDate, todayLocal } from "./lib/parse";
import { addInterval, occurrencesBetween } from "./lib/analysis";
import {
  proposeMatches, explainDelta, clearedIndex, consolidationPlan,
  findDuplicateEntries, findDuplicateBankLines, likelyAlreadyInBooks, signatureOf,
} from "./lib/reconcile";
import { runAgent, trimHistory } from "./lib/agent";
import { computeInsights } from "./lib/insights";
import {
  t2PackageFor, stackDiff, t2Deadlines, t1Deadlines, nextDeadline, countdown, longDate,
  T2_COMPANION_FORMS, T1_PACKAGE, PROVINCES, SEPARATE_PROVINCIAL_RETURN, CRA_FORMS_INDEX,
} from "./lib/cra";
import { GUIDES, guideOpener } from "./lib/guides";
import { ToastContainer } from "./components/Toast";
import { notify, createNotification } from "./lib/notifications";

/* ================= palettes: midnight & daylight ledger ================= */
const PALETTES = {
  dark: {
    bg: "#101613",
    surface: "#171F1B",
    surface2: "#1D2622",
    line: "#2A3530",
    text: "#F3F1E7",
    muted: "#AEB5A9",
    faint: "#7C847B",
    credit: "#6FCB97",
    debit: "#E0705F",
    brass: "#F2B94A",
    overlay: "rgba(6,10,8,0.75)",
  },
  light: {
    bg: "#F5F3EC",            // warm paper, a touch brighter so cards don't glare against it
    surface: "#FAF8F1",       // soft cream instead of near-white
    surface2: "#EDEAE0",
    line: "#E0DCCE",          // hairlines recede instead of gridding the page
    text: "#2A2F27",          // soft ink, not black
    muted: "#59604F",
    faint: "#83887A",
    credit: "#2E7D54",        // calmer green
    debit: "#B0523F",         // terracotta instead of alarm red
    brass: "#B8860B",
    overlay: "rgba(52,56,46,0.38)",
  },
};
// Mutable palette object, every component reads P at render time, so swapping
// its values and re-rendering the tree re-themes the whole app.
const P = { ...PALETTES.dark };
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "'Geist', 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
// Headings use the same grotesque as the UI — weight and tracking carry the
// hierarchy instead of a second, more traditional-looking family.
const SERIF = SANS;


/* ================= helpers ================= */
const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = todayLocal; // local calendar day, not UTC (see lib/parse.js)
const thisMonth = () => new Date().toISOString().slice(0, 7);
const fmt = (n) =>
  (n < 0 ? "−$" : "$") +
  Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) =>
  (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-CA", { maximumFractionDigits: 0 });
const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
};
// Time-of-day an entry was recorded (from its DB created_at), for telling apart
// same-day duplicates that otherwise look identical down to the date.
const fmtEntryTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
};
// "today" / "yesterday" / a date. For history lines, where the point is how
// long ago something happened rather than the exact stamp.
const relDay = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const days = Math.round((new Date(todayLocal() + "T00:00:00") - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
};
const shiftMonth = (ym, d) => {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(y, m - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
// Date and clock time, in the reader's own timezone. "Last synced" is a
// question about how stale the figure is, and a bare date can't answer it: a
// sync at 08:00 and one at 23:50 read identically.
const stamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const day = relDay(iso);
  const time = d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
};

/* ================= attachments (receipts / invoice PDFs) ================= */
const MAX_FILE_BYTES = 8 * 1024 * 1024; // extraction payload cap; Supabase Storage itself allows more

const fileToB64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(file);
  });

const attTypeFromName = (name = "") =>
  /\.pdf$/i.test(name) ? "application/pdf"
  : /\.(png|gif|webp)$/i.test(name) ? `image/${name.split(".").pop().toLowerCase()}`
  : /\.(jpe?g)$/i.test(name) ? "image/jpeg"
  : "application/octet-stream";

// Uploads the file to the private "invoices" bucket; returns its storage path (or null on failure).
async function storeAttachment(att) {
  try {
    return await db.uploadAttachment(att.file, att.name, att.type);
  } catch {
    return null;
  }
}

async function attachmentToBlobURL(attachmentId, name) {
  const url = await db.signedUrl(attachmentId);
  return { url, name, type: attTypeFromName(name) };
}

async function downloadAttachment(attachmentId, fallbackName) {
  try {
    const url = await db.signedUrl(attachmentId, { download: true });
    const a = document.createElement("a");
    a.href = url;
    a.download = fallbackName || "receipt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

const deleteAttachment = async (path) => {
  try { await db.removeAttachment(path); } catch { /* already gone */ }
};

/* ================= CSV export ================= */
function downloadCSV(filename, rows) {
  const csv = rows
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ================= tiny UI atoms ================= */
const Label = ({ children }) => (
  <div style={{ color: P.muted, letterSpacing: "0.07em" }} className="text-xs uppercase font-medium mb-1.5">
    {children}
  </div>
);

// Controls share one shape: a soft rectangle with room to breathe and a focus
// ring that reads as a ring rather than a browser outline.
const CONTROL = "rounded-lg px-3 py-2.5 text-sm w-full outline-none transition-shadow duration-150 focus:shadow-[0_0_0_3px_var(--focus-ring)]";

const Input = (props) => (
  <input
    {...props}
    style={{ background: P.bg, border: `1px solid ${P.line}`, color: P.text, "--focus-ring": P.brass + "33", ...props.style }}
    className={CONTROL + " " + (props.className || "")}
  />
);

const Select = ({ children, ...props }) => (
  <select
    {...props}
    style={{ background: P.bg, border: `1px solid ${P.line}`, color: P.text, "--focus-ring": P.brass + "33" }}
    className={CONTROL}
  >
    {children}
  </select>
);

const Btn = ({ children, tone = "brass", ...props }) => {
  const bg = tone === "brass" ? P.brass : tone === "credit" ? P.credit : tone === "debit" ? P.debit : P.surface2;
  const fg = tone === "ghost" ? P.text : "#10120C";
  return (
    <button
      {...props}
      style={{
        background: bg,
        color: fg,
        border: tone === "ghost" ? `1px solid ${P.line}` : "1px solid transparent",
        ...props.style,
      }}
      className={
        "rounded-lg px-3.5 py-2 text-sm font-medium inline-flex items-center gap-1.5 " +
        "transition-[transform,opacity] duration-150 active:scale-[.97] disabled:opacity-40 disabled:active:scale-100 " +
        (props.className || "")
      }
    >
      {children}
    </button>
  );
};

/* one-time vs recurring */
const isRec = (x) => x?.recurrence === "recurring";
const RecToggle = ({ value, onChange }) => (
  <div className="flex gap-1">
    {[["once", "One-time"], ["recurring", "Recurring"]].map(([k, label]) => (
      <button
        key={k}
        type="button"
        onClick={() => onChange(k)}
        style={{
          background: value === k ? P.surface2 : "transparent",
          border: `1px solid ${value === k ? P.brass : P.line}`,
          color: value === k ? P.text : P.muted,
        }}
        className="flex-1 rounded px-2 py-1 text-xs inline-flex items-center justify-center gap-1"
      >
        {k === "recurring" && <Repeat size={11} />} {label}
      </button>
    ))}
  </div>
);
const RecMark = () => <Repeat size={11} style={{ color: P.brass, display: "inline", verticalAlign: "-1px" }} title="Recurring" />;

/* subcategory dropdown, lists the category's subs and lets you add a new one inline */
const subsFor = (data, type, category) =>
  (data.categories[type]?.find((c) => c.name === category)?.subs) || [];

function SubPicker({ data, type, category, value, onChange, addSub, compact }) {
  const subs = subsFor(data, type, category);
  const handle = (v) => {
    if (v === "__add__") {
      const name = window.prompt(`New subcategory under ${category}:`);
      if (name && name.trim()) {
        addSub(type, category, name.trim());
        onChange(name.trim());
      }
      return;
    }
    onChange(v);
  };
  return (
    <select
      value={value && subs.includes(value) ? value : value || ""}
      onChange={(e) => handle(e.target.value)}
      style={{ background: P.bg, border: `1px solid ${P.line}`, color: value ? P.text : P.faint }}
      className={compact ? "rounded px-1 py-0.5 text-xs w-24" : "rounded px-2 py-1.5 text-sm w-full outline-none"}
      title="Subcategory"
    >
      <option value="">{compact ? "sub" : "no subcategory"}</option>
      {subs.map((s) => <option key={s} value={s}>{s}</option>)}
      {value && !subs.includes(value) && <option value={value}>{value}</option>}
      <option value="__add__">+ add subcategory…</option>
    </select>
  );
}

/* frequency cadences for recurring AR/AP */
const FREQS = [["weekly", "Weekly"], ["biweekly", "Every 2 weeks"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["yearly", "Yearly"]];
const freqLabel = (f) => (FREQS.find(([k]) => k === f) || [null, "Recurring"])[1];
const kindLabel = (k) => (k === "personal" ? "Personal Ledger" : "Business Ledger");
// addInterval + occurrencesBetween live in lib/analysis.js so the agent's cash
// forecast and the Calendar tab project scheduled items identically.

/* credits: remaining = initial + credit-denominated income − credit-denominated spend */
const creditRemaining = (data, creditId) => {
  const pool = (data.credits || []).find((c) => c.id === creditId);
  if (!pool) return 0;
  const spent = data.transactions.filter((t) => t.creditId === creditId && t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const earned = data.transactions.filter((t) => t.creditId === creditId && t.type === "income").reduce((s, t) => s + t.amount, 0);
  return pool.initial - (pool.usedAdjustment || 0) + earned - spent;
};
const creditsTotalRemaining = (data) => (data.credits || []).reduce((s, c) => s + creditRemaining(data, c.id), 0);

/* one "Paid via" selector everywhere: cash, each pool (with remaining), or create a pool inline */
function PayViaSelect({ data, payMethod, creditId, onChange, addCredit }) {
  const handle = (v) => {
    if (v === "cash") return onChange("cash", null);
    if (v === "__addpool__") {
      const name = window.prompt("Credit pool name (e.g. MongoDB credits):");
      if (!name || !name.trim()) return;
      const amt = parseFloat(window.prompt(`How many credits did ${name.trim()} grant? (number)`) || "");
      if (Number.isNaN(amt)) return;
      const id = addCredit(name.trim(), Math.abs(amt));
      onChange("credits", id);
      return;
    }
    onChange("credits", v);
  };
  return (
    <Select value={payMethod === "credits" ? creditId || "" : "cash"} onChange={(e) => handle(e.target.value)}>
      <option value="cash">Cash / bank</option>
      {(data.credits || []).map((c) => (
        <option key={c.id} value={c.id}>{c.name} ({fmt0(creditRemaining(data, c.id))} left)</option>
      ))}
      <option value="__addpool__">+ add a credit pool…</option>
    </Select>
  );
}
const creditName = (data, creditId) => (data.credits || []).find((c) => c.id === creditId)?.name || "credits";
const isCredits = (x) => x?.payMethod === "credits";

/* ================= AI extraction prompts ================= */
const subPromptInfo = (cats) => {
  const lines = [...cats.expense, ...cats.income]
    .filter((c) => (c.subs || []).length)
    .map((c) => `${c.name}: ${c.subs.join(", ")}`);
  return lines.length ? lines.join(" | ") : "none defined";
};

function extractionPrompt(cats, ledgerName) {
  return `You extract transaction data for a budget app. The ledger is "${ledgerName}".
Expense categories: ${cats.expense.map((c) => c.name).join(", ")}.
Income categories: ${cats.income.map((c) => c.name).join(", ")}.
Subcategories per category (use only if clearly applicable, else null): ${subPromptInfo(cats)}.
Today's date: ${todayStr()}.
Respond ONLY with raw JSON (no markdown, no preamble):
{"type":"expense"|"income","amount":number,"date":"YYYY-MM-DD","description":"vendor/short description","category":"one of the listed categories for that type","subcategory":"one of that category's subcategories or null","account":"business"|"personal","recurrence":"recurring"|"once","note":"one short line on anything you were unsure about, else empty string"}
Software/SaaS/cloud/contractor items are business expenses, pick the closest business category (software, hosting, salaries, etc.). If the date is missing, use today's date. Amount is the total paid.
recurrence: "recurring" for subscriptions, SaaS, hosting, rent/mortgage, salaries, retainers, utilities, anything billed on a repeating cycle; "once" for one-off purchases.`;
}

// Structured outputs: the response is constrained to this shape, so the field
// set and the category names come back valid instead of merely requested.
const nullableString = (values) => ({
  anyOf: [values?.length ? { type: "string", enum: values } : { type: "string" }, { type: "null" }],
});

function extractionSchema(cats) {
  const all = [...cats.expense, ...cats.income];
  const names = all.map((c) => c.name);
  const subs = [...new Set(all.flatMap((c) => c.subs || []))];
  return {
    type: "object",
    additionalProperties: false,
    required: ["type", "amount", "date", "description", "category", "subcategory", "account", "recurrence", "note"],
    properties: {
      type: { type: "string", enum: ["expense", "income"] },
      amount: { type: "number" },
      date: { type: "string", format: "date" },
      description: { type: "string" },
      category: names.length ? { type: "string", enum: names } : { type: "string" },
      subcategory: nullableString(subs),
      account: { type: "string", enum: ["business", "personal"] },
      recurrence: { type: "string", enum: ["recurring", "once"] },
      note: { type: "string" },
    },
  };
}

const AR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["party", "description", "amount", "dueDate", "recurrence", "note"],
  properties: {
    party: { type: "string" },
    description: { type: "string" },
    amount: { type: "number" },
    dueDate: { type: "string", format: "date" },
    recurrence: { type: "string", enum: ["recurring", "once"] },
    note: { type: "string" },
  },
};

function arExtractionPrompt(kind) {
  const who =
    kind === "receivables"
      ? `This document is an invoice the user's business ISSUED to a client, money owed TO the user. "party" is the client being billed (the bill-to / customer name), NOT the user's own company.`
      : `This document is an invoice or bill the user RECEIVED, money the user owes. "party" is the vendor/company that issued it.`;
  return `You extract accounts-${kind === "receivables" ? "receivable" : "payable"} data from an invoice for a budget app.
${who}
Today's date: ${todayStr()}.
Respond ONLY with raw JSON (no markdown, no preamble):
{"party":"who ${kind === "receivables" ? "owes the user" : "the user owes"}","description":"invoice number and/or 2-4 word summary of what it's for","amount":number (total due),"dueDate":"YYYY-MM-DD","recurrence":"recurring"|"once","note":"one short line on anything unclear, else empty string"}
For dueDate: use the stated payment due date; if only an invoice date and payment terms (e.g. Net 30) are given, add the terms to the invoice date; if nothing is stated, use the invoice date; if there's no date at all, use today's date. If a balance/amount due differs from the total, use the amount still due.
recurrence: "recurring" if the invoice is clearly part of a repeating cycle (subscription, retainer, monthly service); otherwise "once".`;
}

/* ================= error boundary: crashes show a message, never a blank page ================= */
class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ background: "#101613", color: "#EAE7DA", minHeight: "100vh", fontFamily: SANS }} className="flex items-center justify-center p-6">
        <div style={{ maxWidth: 480 }}>
          <h1 style={{ fontFamily: SANS }} className="text-xl mb-2">Something broke</h1>
          <p style={{ color: "#8B9389" }} className="text-sm mb-3">
            The app hit an error instead of rendering. Reloading usually clears it, if it keeps happening, send this to whoever maintains the app:
          </p>
          <pre style={{ background: "#171F1B", border: "1px solid #2A3530", color: "#C4574E", whiteSpace: "pre-wrap" }} className="rounded p-3 text-xs mb-4">{String(this.state.err)}</pre>
          <button onClick={() => window.location.reload()} style={{ background: "#F2B94A", color: "#10120C" }} className="rounded px-4 py-2 text-sm font-medium">Reload</button>
        </div>
      </div>
    );
  }
}

/* ================= auth gate ================= */
// Where a sign-in email has to land. The books live under /app/, so the redirect
// must name that path: pointing it at the bare origin drops people on the
// marketing page holding the token, which is why signing in took two clicks.
const appUrl = () => `${window.location.origin}/app/`;

// An installed PWA gets its own storage jar on iOS, so a link opened from Mail
// signs you in inside Safari while the home-screen app still looks signed out.
// A typed code is the only handoff that crosses that boundary.
const isInstalledApp = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true || window.navigator?.standalone === true;
};

// Supabase returns the session in the URL (hash for magic links, ?code= for
// PKCE). Read any failure it reports, then scrub the params once the client has
// consumed them so a refresh or a shared URL can't replay a spent token.
const readLinkError = () => {
  if (typeof window === "undefined") return "";
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search || "");
  const raw = hash.get("error_description") || query.get("error_description") || "";
  if (!raw) return "";
  return /expired|invalid/i.test(raw)
    ? "That sign-in link has already been used or has expired. Enter your email below and we'll send a fresh code."
    : raw;
};

const scrubAuthParams = () => {
  if (typeof window === "undefined") return;
  const hash = window.location.hash || "";
  const query = new URLSearchParams(window.location.search || "");
  const hadHash = /access_token|refresh_token|error_description|error_code/.test(hash);
  const hadQuery = ["code", "error_description", "error", "error_code", "token_hash"].some((k) => query.has(k));
  if (!hadHash && !hadQuery) return;
  ["code", "error_description", "error", "error_code", "token_hash", "type"].forEach((k) => query.delete(k));
  const search = query.toString();
  window.history.replaceState({}, "", window.location.pathname + (search ? `?${search}` : ""));
};

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [recovery, setRecovery] = useState(false);   // arrived via a password-reset link
  const [linkError, setLinkError] = useState(readLinkError);

  useEffect(() => {
    // getSession() waits on the client's own init, which is what parses the URL,
    // so by the time it resolves the token in the address bar is already spent.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      scrubAuthParams();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (s) { setLinkError(""); scrubAuthParams(); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined)
    return (
      <div style={{ background: P.bg, color: P.muted, minHeight: "100vh" }} className="flex items-center justify-center">
        <Loader2 className="animate-spin mr-2" size={18} /> Connecting…
      </div>
    );
  if (!session) return <AuthScreen linkError={linkError} />;
  if (recovery) return <SetNewPassword onDone={() => setRecovery(false)} />;
  return (
    <Boundary>
      <Ledger key={session.user.id} onSignOut={() => supabase.auth.signOut()} />
    </Boundary>
  );
}

function AuthCard({ children }) {
  return (
    <div style={{ background: P.bg, color: P.text, minHeight: "100vh", fontFamily: SANS }} className="flex items-center justify-center p-4">
      <div style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: "0 1px 2px rgba(0,0,0,.04), 0 24px 60px -24px rgba(0,0,0,.35)" }} className="rounded-2xl p-7 w-full max-w-sm">
        <div style={{ fontFamily: MONO, color: P.brass, letterSpacing: "0.1em" }} className="text-xs uppercase mb-2">Down to brass tacks</div>
        <img src="/app/brasstally-wordmark.png" alt="Brasstally" style={{ height: 26, width: "auto", display: "block" }} />
        {children}
      </div>
    </div>
  );
}

function AuthScreen({ linkError = "" }) {
  // step: email → code is the default road. Password is kept as a side door for
  // people who already set one, and forgot hangs off it.
  const [step, setStep] = useState("email"); // email | code | password | signup | forgot
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(linkError);
  const [notice, setNotice] = useState("");
  const [resentAt, setResentAt] = useState(0);
  const installed = useMemo(isInstalledApp, []);

  const goTo = (s) => { setStep(s); setErr(""); setNotice(""); setCode(""); setPw(""); setPw2(""); };

  // One request sends both halves: a tappable link for whoever is reading mail
  // on the same browser, and a six-digit code for everyone else — the installed
  // app, a desktop inbox, a phone that opens links in a different browser.
  const sendCode = async (resend = false) => {
    const em = email.trim();
    if (!em || busy) return;
    setErr(""); setNotice(""); setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: em,
        options: { emailRedirectTo: appUrl(), shouldCreateUser: true },
      });
      if (error) { setErr(error.message); return; }
      setStep("code");
      setCode("");
      if (resend) { setResentAt(Date.now()); setNotice(`A fresh code is on its way to ${em}.`); }
    } finally { setBusy(false); }
  };

  const verifyCode = async () => {
    const token = code.replace(/\D/g, "");
    if (token.length < 6 || busy) return;
    setErr(""); setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
      if (error) {
        setErr(/expired/i.test(error.message)
          ? "That code has expired. Send a new one and try again."
          : "That code doesn't match. Check the last email — codes expire after an hour.");
      }
      // On success the auth listener in App() swaps this screen out.
    } finally { setBusy(false); }
  };

  const passwordGo = async () => {
    const em = email.trim();
    if (!em || busy) return;
    setErr(""); setNotice(""); setBusy(true);
    try {
      if (step === "signup") {
        if (pw.length < 8) { setErr("Use at least 8 characters for your password."); return; }
        if (pw !== pw2) { setErr("The two passwords don't match."); return; }
        const { data, error } = await supabase.auth.signUp({
          email: em, password: pw, options: { emailRedirectTo: appUrl() },
        });
        if (error) setErr(error.message);
        else if (!data.session) setNotice(`Almost there. A verification link is on its way to ${em}. Tap it to confirm your email, then sign in here.`);
      } else if (step === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw });
        if (error) {
          setErr(/confirm/i.test(error.message)
            ? "This email isn't verified yet. Check your inbox for the verification link, then try again."
            : "That email and password don't match. Reset it below, or go back and use a code instead.");
        }
      } else if (step === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: appUrl() });
        if (error) setErr(error.message);
        else setNotice(`A password reset link is on its way to ${em}. It brings you back here to set a new one.`);
      }
    } finally { setBusy(false); }
  };

  // Utility links read as text, not as terminal output — the mono face made
  // them look like a config file.
  const linkStyle = { color: P.muted };
  const emailValid = /\S+@\S+\.\S+/.test(email.trim());

  if (notice && step !== "code") {
    return (
      <AuthCard>
        <p style={{ color: P.muted }} className="text-sm">{notice}</p>
        <button onClick={() => goTo("email")} style={linkStyle} className="text-xs underline decoration-dotted underline-offset-2 mt-3">back</button>
      </AuthCard>
    );
  }

  /* ---- step 2: type the code ---- */
  if (step === "code") {
    return (
      <AuthCard>
        <p style={{ color: P.text }} className="text-sm mt-3">
          Enter the 6-digit code we sent to <span style={{ fontFamily: MONO }}>{email.trim()}</span>.
        </p>
        <p style={{ color: P.muted }} className="text-xs mt-1">
          {installed
            ? "Typing the code signs you in right here in the app — tapping the link in your email would open a browser instead, and that signs in the browser, not the app."
            : "The same email also has a one-tap link, if you'd rather use that."}
        </p>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && verifyCode()}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          aria-label="Six-digit sign-in code"
          style={{ background: P.bg, border: `1px solid ${P.line}`, color: P.text, fontFamily: MONO, letterSpacing: "0.4em" }}
          className="rounded-lg px-3 py-3 w-full outline-none text-center text-xl mt-4"
        />

        {err && <p style={{ color: P.debit }} className="text-xs mt-2">{err}</p>}
        {notice && <p style={{ color: P.credit }} className="text-xs mt-2">{notice}</p>}

        <Btn className="w-full justify-center mt-3" onClick={verifyCode} disabled={busy || code.length < 6}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Sign in
        </Btn>

        <div className="flex justify-between mt-3">
          <button onClick={() => sendCode(true)} disabled={busy || Date.now() - resentAt < 20000}
            style={linkStyle} className="text-xs underline decoration-dotted underline-offset-2 disabled:opacity-40">Send a new code</button>
          <button onClick={() => goTo("email")} style={linkStyle} className="text-xs underline decoration-dotted underline-offset-2">Use a different email</button>
        </div>
      </AuthCard>
    );
  }

  /* ---- password side door ---- */
  if (step === "password" || step === "signup" || step === "forgot") {
    return (
      <AuthCard>
        <div className="flex gap-1 mt-3 mb-4">
          {[["password", "Sign in"], ["signup", "Create account"]].map(([k, label]) => (
            <button key={k} onClick={() => goTo(k)}
              style={{ fontFamily: MONO, background: step === k ? P.surface2 : "transparent", border: `1px solid ${step === k ? P.brass : P.line}`, color: step === k ? P.text : P.muted }}
              className="flex-1 rounded-lg px-2 py-2 text-xs">
              {label}
            </button>
          ))}
        </div>

        <Label>Email</Label>
        <Input type="email" placeholder="you@example.com" value={email} autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && step === "forgot" && passwordGo()} />

        {step !== "forgot" && (
          <div className="mt-2">
            <Label>Password</Label>
            <Input type="password" placeholder={step === "signup" ? "At least 8 characters" : "Your password"} value={pw}
              autoComplete={step === "signup" ? "new-password" : "current-password"}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && step === "password" && passwordGo()} />
          </div>
        )}
        {step === "signup" && (
          <div className="mt-2">
            <Label>Password, again</Label>
            <Input type="password" placeholder="Same password" value={pw2} autoComplete="new-password"
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && passwordGo()} />
          </div>
        )}
        {step === "forgot" && (
          <p style={{ color: P.muted }} className="text-xs mt-2">Enter your email and we'll send a link to set a new password.</p>
        )}

        {err && <p style={{ color: P.debit }} className="text-xs mt-2">{err}</p>}

        <Btn className="w-full justify-center mt-3" onClick={passwordGo}
          disabled={busy || !emailValid || (step !== "forgot" && !pw)}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
          {step === "password" ? "Sign in" : step === "signup" ? "Create account" : "Send reset link"}
        </Btn>

        <div className="flex justify-between mt-3">
          <button onClick={() => goTo("email")} style={linkStyle} className="text-xs underline decoration-dotted underline-offset-2">Email me a code instead</button>
          {step === "password" && (
            <button onClick={() => goTo("forgot")} style={linkStyle} className="text-xs underline decoration-dotted underline-offset-2">Forgot password?</button>
          )}
          {step === "forgot" && (
            <button onClick={() => goTo("password")} style={linkStyle} className="text-xs underline decoration-dotted underline-offset-2">Back to sign in</button>
          )}
        </div>
      </AuthCard>
    );
  }

  /* ---- step 1: email ---- */
  return (
    <AuthCard>
      <p style={{ color: P.muted }} className="text-sm mt-3 mb-4">
        Enter your email and we'll send a 6-digit code. New here? The same code creates your account.
      </p>

      <Label>Email</Label>
      <Input type="email" placeholder="you@example.com" value={email} autoComplete="email" autoFocus
        inputMode="email"
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && emailValid && sendCode()} />

      {err && <p style={{ color: P.debit }} className="text-xs mt-2">{err}</p>}

      <Btn className="w-full justify-center mt-3" onClick={() => sendCode()} disabled={busy || !emailValid}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
        Email me a code
      </Btn>

      <div className="flex justify-between mt-3">
        <button onClick={() => goTo("password")} style={linkStyle} className="text-xs underline decoration-dotted underline-offset-2">Use a password instead</button>
      </div>

      <p style={{ color: P.faint }} className="text-xs mt-4">
        Verified email, encrypted connection, and your books are isolated to your account.
      </p>
    </AuthCard>
  );
}

function SetNewPassword({ onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    if (pw.length < 8) { setErr("Use at least 8 characters."); return; }
    if (pw !== pw2) { setErr("The two passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(error.message);
    else onDone();
  };

  return (
    <AuthCard>
      <p style={{ color: P.muted }} className="text-sm mb-3">You followed a password reset link. Set the new password for this account.</p>
      <Label>New password</Label>
      <Input type="password" value={pw} autoComplete="new-password" placeholder="At least 8 characters" onChange={(e) => setPw(e.target.value)} />
      <div className="mt-2">
        <Label>New password, again</Label>
        <Input type="password" value={pw2} autoComplete="new-password" placeholder="Same password" onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      </div>
      {err && <p style={{ color: P.debit }} className="text-xs mt-2">{err}</p>}
      <Btn className="w-full justify-center mt-3" onClick={save} disabled={busy || !pw || !pw2}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save new password
      </Btn>
    </AuthCard>
  );
}



function statementPrompt(cats, ledgerName) {
  return `You parse bank and credit-card statements for a budget app. The ledger is "${ledgerName}".
Extract EVERY transaction line, do not summarize, skip, or merge lines.
Expense categories (for debits): ${cats.expense.map((c) => c.name).join(", ")}.
Income categories (for credits): ${cats.income.map((c) => c.name).join(", ")}.
Subcategories per category (use only if clearly applicable, else null): ${subPromptInfo(cats)}.
Today's date: ${todayStr()}. If the statement omits the year, infer it from context.
Respond ONLY with raw JSON (no markdown, no preamble):
{"transactions":[{"date":"YYYY-MM-DD","amount":number (always positive),"direction":"debit"|"credit","description":"cleaned-up merchant/description","category":"best fit from the matching list","subcategory":"one of that category's subcategories or null","account":"business"|"personal","recurrence":"recurring"|"once"}],
"endingBalance":number or null (the statement's closing/ending balance if shown),
"endingBalanceDate":"YYYY-MM-DD" or null (the statement period end date),
"note":"one short line about anything skipped or ambiguous, else empty string"}
Rules: debit = money leaving the account (purchases, fees, transfers out); credit = money in (deposits, refunds, payroll).
Software/SaaS/cloud/hosting/contractor charges → account "business" with the closest business category. Payroll deposits → the paycheck/salary income category if one exists.
recurrence: "recurring" for subscriptions, rent/mortgage, utilities, payroll; otherwise "once".
Ignore running-balance columns, section headers, and totals rows, they are not transactions.`;
}

/* ================= main app ================= */
function Ledger({ onSignOut }) {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [tab, setTab] = useState("overview");
  const [month, setMonth] = useState(thisMonth());
  const [theme, setThemeState] = useState("dark");
  const [preview, setPreview] = useState(null); // { url, name, type } | { error: true }
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSeed, setChatSeed] = useState(null); // { question, at } queued from an insight
  const [chatGuide, setChatGuide] = useState(null); // { id, at } a section handing over its brief
  const [chatNudge, setChatNudge] = useState(null); // { at, received, total } money landed, say so
  const [chatUnread, setChatUnread] = useState(false); // Brasstally spoke proactively and nobody has looked yet
  // Read by callbacks that fire after an await, when the closure's copy of
  // state is already a render behind.
  const dataRef = useRef(null);
  const balanceRef = useRef(null);
  const [reconciling, setReconciling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ledgers, setLedgers] = useState(null);          // null = loading list
  const [currentLedger, setCurrentLedger] = useState(null);
  const [fatal, setFatal] = useState(null);              // "migration" | null
  const [newLedgerOpen, setNewLedgerOpen] = useState(false);
  const [ledgerMenuOpen, setLedgerMenuOpen] = useState(false);
  const [bankTxns, setBankTxns] = useState([]); // every line Plaid has sent, with its match state
  const [matchOpen, setMatchOpen] = useState(false); // the two-column reconcile view
  const [bankConns, setBankConns] = useState([]); // Plaid connections for this ledger (balances)
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const inFlight = useRef(new Set()); // synchronous double-tap lock for settle/remove

  const addNotification = (notif) => {
    setNotifications((prev) => [...prev, notif]);
  };

  const dismissNotification = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };
  const [transferOpen, setTransferOpen] = useState(false);
  const [seenTours, setSeenTours] = useState({}); // session mirror of localStorage tour flags
  const [setupHidden, setSetupHidden] = useState(() => Boolean(window.localStorage.getItem("setup:hidden")));

  /* ---- 1) list this user's ledgers ---- */
  useEffect(() => {
    (async () => {
      try {
        const list = await db.listLedgers();
        setLedgers(list);
        if (list.length) {
          // Prefer the ledger that started a Plaid OAuth redirect, else last-used
          const oauthSession = bank.oauthReturnUri() ? bank.loadLinkSession() : null;
          const last = window.localStorage.getItem("ledger:last");
          setCurrentLedger(
            (oauthSession?.ledger_id && list.find((l) => l.id === oauthSession.ledger_id))
            || list.find((l) => l.id === last)
            || list[0]
          );
        }
        // empty list -> onboarding renders below
      } catch (e) {
        console.error(e);
        setFatal("migration");
        setLedgers([]);
      }
    })();
  }, []);

  /* ---- 2) load the selected ledger's data ---- */
  useEffect(() => {
    if (!currentLedger) return;
    setData(null);
    setBankConns([]);
    setBankTxns([]);
    setMatchOpen(false);
    window.localStorage.setItem("ledger:last", currentLedger.id);
    (async () => {
      try {
        const loaded = await db.loadAll(currentLedger);
        const t = loaded.settings.theme === "light" ? "light" : "dark";
        Object.assign(P, PALETTES[t]);
        setThemeState(t);
        setMonth(thisMonth());
        // OAuth banks bounce back to origin/; BankFeedCard only mounts on Connectors
        setTab(bank.oauthReturnUri() ? "integrations" : "overview");
        setData(loaded);
      } catch (e) {
        console.error(e);
        setLoadErr(true);
        setData({
          ledger: currentLedger,
          settings: { startingBalance: 0, anchorDate: "1970-01-01", currency: "CAD", theme: "dark" },
          categories: { expense: [], income: [] },
          transactions: [], receivables: [], payables: [], anchorHistory: [], credits: [],
        });
        if (bank.oauthReturnUri()) setTab("integrations");
      }
      try { setBankConns(await bank.listConnections(currentLedger.id)); }
      catch { setBankConns([]); }
      // Missing table (migration not run yet) must not break the ledger — the
      // app simply falls back to anchor-only reconciliation.
      try { setBankTxns(await bank.listBankTransactions(currentLedger.id)); }
      catch (e) { console.error("bank transactions:", e); setBankTxns([]); }
    })();
  }, [currentLedger]);

  const refreshBankTxns = async () => {
    if (!currentLedger) return [];
    try {
      const list = await bank.listBankTransactions(currentLedger.id);
      setBankTxns(list);
      return list;
    } catch (e) { console.error("bank transactions:", e); return []; }
  };

  /* ---- what a sync actually landed ----
     Pressing Sync is a request for new lines, not a request to be handed a
     screenful of decisions. So the sync reports back: here is what arrived, and
     here is whether any of it needs you. Opening the review is then a choice.

     The plan is computed from the rows just fetched rather than from state,
     because state has not re-rendered yet at this point. */
  const afterSync = async () => {
    const rows = await refreshBankTxns();
    if (!dataRef.current) return null;
    const txs = dataRef.current.transactions;
    const plan = consolidationPlan({
      bankTxns: rows,
      txs,
      duplicates: findDuplicateEntries(txs, { bankTxns: rows }),
      dupBankLines: findDuplicateBankLines(rows),
      balance: balanceRef.current,
    });
    // Money landing is worth saying out loud, whether or not the books need work.
    const arrived = plan.ask.unrecorded.filter((b) => b.direction === "credit");
    if (arrived.length) {
      const total = arrived.reduce((s, b) => s + Number(b.amount || 0), 0);
      addNotification(notify.success(`Money received: ${fmt(total)}`));
      setChatNudge({
        at: Date.now(),
        received: arrived.slice(0, 5).map((b) => ({ id: b.id, description: b.description, amount: b.amount, date: b.date })),
        total,
      });
      setChatUnread(true);
    } else {
      addNotification(notify.info("Bank sync complete"));
    }
    return plan;
  };

  const createLedgerAndSwitch = async ({ name, kind, startingBalance, anchorDate }) => {
    try {
      const l = await db.createLedger({ name, kind, startingBalance, anchorDate });
      setLedgers((ls) => [...(ls || []), l]);
      setNewLedgerOpen(false);
      setCurrentLedger(l);
      addNotification(notify.success(`"${name}" ledger created`));
    } catch (e) {
      console.error(e);
      setLoadErr(true);
      addNotification(notify.error("Couldn't create ledger"));
    }
  };

  // local state updates immediately; the matching database write runs behind it
  // Background writes should never blow away the UI. Log, surface a soft toast, keep going.
  const dbTry = async (fn) => {
    try { await fn(); } catch (e) { console.error("save failed:", e); addNotification(notify.error("Couldn't reach the server, your last change may not have saved. Check your connection.")); }
  };

  /* ---- derived ---- */
  const monthTx = useMemo(
    () => (data ? data.transactions.filter((t) => t.date && t.date.startsWith(month)) : []),
    [data, month]
  );
  // ledger line shows CASH flow, entries paid/received in credits don't move money
  const sums = useMemo(() => {
    const cash = monthTx.filter((t) => !isCredits(t));
    const inc = cash.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = cash.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { inc, exp, net: inc - exp };
  }, [monthTx]);
  // Balance anchoring: "balance was $X as of anchorDate". Only transactions AFTER the
  // anchor count toward the balance, so untracked earlier months can't distort it.
  // Connected ledgers show the bank figure as Balance to date; books stay for delta.
  const balance = useMemo(() => {
    if (!data) {
      return {
        value: 0, book: 0, bank: null, delta: null, source: "books",
        beforeAnchor: false, anchorAmount: 0, anchorDate: "", balanceAsOf: null,
      };
    }
    const anchorDate = data.settings.anchorDate || "1970-01-01";
    const anchorAmount = data.settings.startingBalance;
    const beforeAnchor = month < anchorDate.slice(0, 7); // viewing a month that ends before the anchor
    const cum = data.transactions
      .filter((t) => t.date && t.date > anchorDate && t.date.slice(0, 7) <= month && !isCredits(t))
      .reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);
    const book = anchorAmount + cum;
    const bankTotal = bank.sumBankBalance(bankConns);
    const balanceAsOf = bank.latestBalanceAsOf(bankConns);
    const connected = bankTotal != null;
    const delta = connected ? bankTotal - book : null;
    return {
      value: connected ? bankTotal : book,
      book,
      bank: bankTotal,
      delta,
      source: connected ? "bank" : "books",
      beforeAnchor: connected ? false : beforeAnchor,
      anchorAmount,
      anchorDate,
      balanceAsOf,
    };
  }, [data, month, bankConns]);
  const openBooks = useMemo(() => {
    if (!data) return { ar: 0, ap: 0 };
    return {
      ar: data.receivables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0),
      ap: data.payables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0),
    };
  }, [data]);
  // What the agent would tell you if you asked — worked out locally, for free,
  // before you ask. Tapping one hands the question to the agent, which then
  // goes and gets the entries behind it.
  // The delta broken into named lines. This is what makes "bank and books
  // disagree" actionable instead of just true.
  const recon = useMemo(
    () => (data ? explainDelta(bankTxns, data.transactions, { balance }) : null),
    [data, bankTxns, balance],
  );
  const cleared = useMemo(() => clearedIndex(bankTxns), [bankTxns]);
  // Entries recorded twice, and bank lines delivered twice. Both inflate the
  // gap and both are found before anything is matched, so a reconciliation
  // never pairs a bank line against a copy.
  const duplicates = useMemo(
    () => (data ? findDuplicateEntries(data.transactions, { bankTxns }) : []),
    [data, bankTxns],
  );
  const dupBankLines = useMemo(() => findDuplicateBankLines(bankTxns), [bankTxns]);
  /* ---- have we already done this exact piece of work? ----
     Matching a bank line to an entry explains the gap without closing it, so
     "bank ≠ books" stays true forever and can't be the thing that decides
     whether to ask. What can decide it is whether anything has moved since the
     last finished run: same open lines, same residue, same duplicates → the
     work is done, stay quiet. Anything new → ask again. */
  const consolidation = useMemo(() => {
    const signature = signatureOf([
      recon?.openSignature || "none",
      duplicates.flatMap((g) => g.extras.map((e) => e.id)).sort().join(","),
      dupBankLines.flatMap((g) => g.extras.map((e) => e.id)).sort().join(","),
    ]);
    const history = data?.consolidations || [];
    const last = history.find((c) => c.signature) || null;
    return { signature, history, last, settled: Boolean(last && last.signature === signature) };
  }, [recon, duplicates, dupBankLines, data]);
  const insights = useMemo(
    () => (data ? computeInsights(data, { balance, month, bankConns, recon, consolidation, duplicates }) : []),
    [data, balance, month, bankConns, recon, consolidation, duplicates],
  );
  dataRef.current = data;
  balanceRef.current = balance;
  // A question queued for the chat panel by something else in the app.
  const askAgent = (question) => { setChatSeed({ question, at: Date.now() }); setChatOpen(true); };
  // A section handing the chat its own brief, so help arrives already knowing
  // which screen you were on.
  const openGuide = (id) => {
    try { window.localStorage.setItem("guide:used", "1"); } catch { /* private mode */ }
    setChatGuide({ id, at: Date.now() });
    setChatOpen(true);
  };

  if (fatal === "migration")
    return (
      <div style={{ background: P.bg, color: P.text, minHeight: "100vh" }} className="flex items-center justify-center p-6">
        <div style={{ maxWidth: 460 }}>
          <h1 style={{ fontFamily: SERIF }} className="text-xl mb-2">One migration to run</h1>
          <p style={{ color: P.muted }} className="text-sm">
            This version stores everything in ledgers, and the database doesn't have the ledgers table yet.
            Run <span style={{ fontFamily: MONO, color: P.brass }}>supabase/migration-multi-ledger.sql</span> in the
            Supabase SQL Editor, then reload. Your existing data is moved into a "GENIE AI" ledger automatically.
          </p>
        </div>
      </div>
    );

  if (ledgers === null)
    return (
      <div style={{ background: P.bg, color: P.muted, minHeight: "100vh" }} className="flex items-center justify-center">
        <Loader2 className="animate-spin mr-2" size={18} /> Finding your ledgers…
      </div>
    );

  if (ledgers.length === 0)
    return <NewLedgerModal onboarding onCreate={createLedgerAndSwitch} onClose={() => {}} onSignOut={onSignOut} />;

  if (!data)
    return (
      <div style={{ background: P.bg, color: P.muted, minHeight: "100vh" }} className="flex items-center justify-center">
        <Loader2 className="animate-spin mr-2" size={18} /> Opening the ledger…
      </div>
    );

  /* ---- mutations: update state, then write through to Supabase ---- */
  // Adding an entry moves the view to that entry's month, so the ledger line,
  // Overview, and P&L visibly reflect it the moment it's saved.
  const addTx = (tx) => {
    const rec = { ...tx, id: crypto.randomUUID(), recurrence: tx.recurrence === "recurring" ? "recurring" : "once" };
    setData((d) => ({ ...d, transactions: [rec, ...d.transactions] }));
    if (tx.date) setMonth(tx.date.slice(0, 7));
    const isRecurring = tx.recurrence === "recurring";
    const label = tx.type === "income" ? "Income" : "Expense";
    addNotification(notify.success(`${label}${isRecurring ? " (recurring)" : ""} recorded`));
    dbTry(() => db.insertTransaction(rec));
  };
  // Deleting an entry dissolves any bank match pointing at it. The database
  // does this itself (FK + trigger); this keeps the on-screen copy in step so
  // the line reappears as unmatched without a reload.
  const dropMatchesFor = (ids) =>
    setBankTxns((rows) => rows.map((b) =>
      b.matchedTxId && ids.includes(b.matchedTxId)
        ? { ...b, status: "unmatched", matchedTxId: null, matchSource: null }
        : b));

  const delTx = (id) => {
    const t = data.transactions.find((x) => x.id === id);
    if (t?.transferId) {
      if (!window.confirm("This entry is one side of an inter-ledger transfer. Removing it deletes BOTH sides (here and in the other ledger). Continue?")) return;
      const gone = data.transactions.filter((x) => x.transferId === t.transferId).map((x) => x.id);
      setData((d) => ({ ...d, transactions: d.transactions.filter((x) => x.transferId !== t.transferId) }));
      dropMatchesFor(gone);
      addNotification(notify.info("Transfer removed"));
      dbTry(() => db.deleteTransfer(t.transferId));
      return;
    }
    if (t?.attachmentId) deleteAttachment(t.attachmentId);
    setData((d) => ({ ...d, transactions: d.transactions.filter((x) => x.id !== id) }));
    dropMatchesFor([id]);
    addNotification(notify.info("Entry removed"));
    dbTry(() => db.deleteTransaction(id));
  };

  const makeTransfer = async ({ toLedger, amount, date, description, mode, srcCategory, srcSub }) => {
    const transferId = crypto.randomUUID();
    const excl = mode === "transfer";
    const out = {
      id: crypto.randomUUID(), date, amount, type: "expense",
      category: excl ? "Transfer out" : srcCategory,
      subcategory: excl ? undefined : (srcSub || undefined),
      description: description || `To ${toLedger.name}`,
      account: data.ledger.kind === "personal" ? "personal" : "business",
      recurrence: "once", payMethod: "cash", transferId, plExclude: excl,
    };
    let destCat = "Transfer in";
    if (!excl) {
      try {
        const names = await db.fetchCategoryNames(toLedger.id, "income");
        destCat = names.includes("Paycheck") ? "Paycheck"
          : names.includes("Client revenue") ? "Client revenue"
          : (names[0] || "Other");
      } catch { destCat = "Other"; }
    }
    const inn = {
      id: crypto.randomUUID(), date, amount, type: "income", category: destCat,
      description: description || `From ${data.ledger.name}`,
      account: toLedger.kind === "personal" ? "personal" : "business",
      recurrence: "once", payMethod: "cash", transferId, plExclude: excl,
    };
    setData((d) => ({ ...d, transactions: [out, ...d.transactions] }));
    if (date) setMonth(date.slice(0, 7));
    setTransferOpen(false);
    addNotification(notify.success(`Transfer to ${toLedger.name} created`));
    dbTry(() => db.insertTransfer({ fromId: data.ledger.id, toId: toLedger.id, out, inn }));
  };
  const updateTx = (id, patch) => {
    setData((d) => ({
      ...d,
      transactions: d.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
    dbTry(() => db.updateTransaction(id, patch));
  };
  const setTxAttachment = (id, attachmentId, attachmentName) => {
    setData((d) => ({
      ...d,
      transactions: d.transactions.map((t) => (t.id === id ? { ...t, attachmentId, attachmentName } : t)),
    }));
    dbTry(() => db.updateTransaction(id, { attachmentId, attachmentName }));
  };
  const addSub = (type, catName, sub) => {
    const cat = data.categories[type].find((c) => c.name === catName);
    if (!cat || (cat.subs || []).includes(sub)) return;
    const next = [...(cat.subs || []), sub];
    setData((d) => ({
      ...d,
      categories: { ...d.categories, [type]: d.categories[type].map((c) => (c.name === catName ? { ...c, subs: next } : c)) },
    }));
    dbTry(() => db.updateSubcategories(type, catName, next));
  };
  const setPlanned = (type, name, planned) => {
    setData((d) => ({
      ...d,
      categories: { ...d.categories, [type]: d.categories[type].map((c) => (c.name === name ? { ...c, planned } : c)) },
    }));
    dbTry(() => db.setPlanned(type, name, planned));
  };
  const addAR = (kind, item) => {
    const rec = { ...item, id: crypto.randomUUID(), status: "open", recurrence: item.recurrence === "recurring" ? "recurring" : "once" };
    setData((d) => ({ ...d, [kind]: [rec, ...d[kind]] }));
    const label = kind === "receivables" ? "Invoice" : "Bill";
    const recurring = item.recurrence === "recurring" ? " (recurring)" : "";
    addNotification(notify.info(`${label} added${recurring}`));
    dbTry(() => db.insertObligation(kind, rec));
  };
  const settleAR = (kind, id, actual = {}) => {
    const item = data[kind].find((x) => x.id === id);
    if (!item || item.status !== "open") return;         // already settled: nothing to do
    if (inFlight.current.has(id)) return;                 // double-tap within the same tick
    inFlight.current.add(id);
    setTimeout(() => inFlight.current.delete(id), 1500);

    // the actuals: what was really paid, when, and how
    const amount = actual.amount != null && !Number.isNaN(actual.amount) && actual.amount > 0 ? Math.abs(actual.amount) : item.amount;
    const settledOn = actual.date || todayStr();
    const payMethod = actual.payMethod === "credits" ? "credits" : actual.payMethod === "cash" ? "cash" : (item.payMethod === "credits" ? "credits" : "cash");
    const creditId = payMethod === "credits" ? (actual.creditId ?? item.creditId) : undefined;
    // Evidence. A receipt captured at settle time rides on the transaction it writes.
    // The obligation keeps the invoice it was filed with (so neither file is orphaned),
    // and adopts the receipt only when it had nothing on file.
    const receiptId = actual.attachmentId || undefined;
    const receiptName = receiptId ? actual.attachmentName : undefined;
    const obDoc = receiptId && !item.attachmentId ? { attachmentId: receiptId, attachmentName: receiptName } : null;
    const tx = {
      id: crypto.randomUUID(),
      date: settledOn,
      amount,
      type: kind === "receivables" ? "income" : "expense",
      category: item.category
        || (kind === "receivables"
          ? (data.categories.income.find((c) => c.name === "Client revenue")?.name || data.categories.income[0]?.name || "Other")
          : (data.categories.expense[0]?.name || "Other")),
      subcategory: item.subcategory,
      description: `${kind === "receivables" ? "Received" : "Paid"}: ${item.party}${item.description ? ", " + item.description : ""}`,
      account: item.account || "business",
      recurrence: item.recurrence,
      payMethod,
      creditId,
      attachmentId: receiptId || item.attachmentId,
      attachmentName: receiptId ? receiptName : item.attachmentName,
    };
    // recurring: queue the NEXT occurrence; the settled one locks in Settled
    const next = item.recurrence === "recurring"
      ? { ...item, id: crypto.randomUUID(), status: "open", settledOn: undefined, settledTxId: undefined, dueDate: addInterval(item.dueDate || settledOn, item.frequency || "monthly"), attachmentId: undefined, attachmentName: undefined }
      : null;

    setData((d) => {
      const fresh = d[kind].find((x) => x.id === id);
      if (!fresh || fresh.status !== "open") return d;    // belt and suspenders
      return {
        ...d,
        [kind]: [
          ...(next ? [next] : []),
          ...d[kind].map((x) => (x.id === id ? { ...x, status: "paid", settledOn, settledTxId: tx.id, amount, payMethod, creditId, ...(obDoc || {}) } : x)),
        ],
        transactions: [tx, ...d.transactions],
      };
    });
    setMonth(settledOn.slice(0, 7));
    const label = kind === "receivables" ? "Payment received" : "Payment sent";
    const recurring = item.recurrence === "recurring" ? " (next due in " + addInterval(item.dueDate || settledOn, item.frequency || "monthly") + ")" : "";
    addNotification(notify.success(`${label}${recurring}`));
    dbTry(async () => {
      await db.updateObligation(id, { status: "paid", settledOn, settledTxId: tx.id, amount, payMethod, creditId: creditId || null, ...(obDoc || {}) });
      await db.insertTransaction(tx);
      if (next) await db.insertObligation(kind, next);
    });
  };
  const updateAR = (kind, id, patch) => {
    setData((d) => ({ ...d, [kind]: d[kind].map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    dbTry(() => db.updateObligation(id, patch));
  };
  const addCredit = (name, initial) => {
    const rec = { id: crypto.randomUUID(), name, initial, usedAdjustment: 0 };
    setData((d) => ({ ...d, credits: [...(d.credits || []), rec] }));
    addNotification(notify.info(`Credit pool "${name}" created`));
    dbTry(() => db.insertCredit(rec));
    return rec.id;
  };
  const updateCredit = (id, patch) => {
    setData((d) => ({ ...d, credits: (d.credits || []).map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    dbTry(() => db.updateCredit(id, patch));
  };
  const delCredit = (id) => {
    const credit = (data.credits || []).find((c) => c.id === id);
    setData((d) => ({ ...d, credits: (d.credits || []).filter((c) => c.id !== id) }));
    addNotification(notify.info(`Credit pool removed`));
    dbTry(() => db.deleteCredit(id));
  };
  const delAR = (kind, id) => {
    const item = data[kind].find((x) => x.id === id);
    // keep the file if it was settled, the transaction still points at it
    if (item?.attachmentId && item.status === "open") deleteAttachment(item.attachmentId);
    setData((d) => ({ ...d, [kind]: d[kind].filter((x) => x.id !== id) }));
    const label = kind === "receivables" ? "Invoice" : "Bill";
    addNotification(notify.info(`${label} removed`));
    dbTry(() => db.deleteObligation(id));
  };
  // Undo a settlement: remove the settled obligation AND the transaction it created.
  const removeSettled = (kind, item) => {
    if (inFlight.current.has(item.id)) return;
    if (!window.confirm(`Remove this settled ${kind === "receivables" ? "receivable" : "payable"} and the transaction it logged? Use this to clear a mistaken or duplicate settlement.`)) return;
    inFlight.current.add(item.id);
    setTimeout(() => inFlight.current.delete(item.id), 1500);

    // Find the transaction to remove NOW, from current data: linked id first, legacy match second.
    let tx = item.settledTxId ? data.transactions.find((t) => t.id === item.settledTxId) : null;
    if (!tx) {
      const verb = kind === "receivables" ? "Received" : "Paid";
      const candidates = data.transactions.filter((t) =>
        Math.abs(t.amount - item.amount) < 0.005 &&
        typeof t.description === "string" &&
        t.description.startsWith(`${verb}: ${item.party}`)
      );
      // prefer one dated the day it was settled, else take any match
      tx = candidates.find((t) => t.date === item.settledOn) || candidates[0] || null;
    }
    const killedTxId = tx?.id || null;

    setData((d) => ({
      ...d,
      [kind]: d[kind].filter((x) => x.id !== item.id),
      transactions: killedTxId ? d.transactions.filter((t) => t.id !== killedTxId) : d.transactions,
    }));
    if (killedTxId) dropMatchesFor([killedTxId]);
    addNotification(notify.info("Settlement reversed"));
    dbTry(async () => {
      await db.deleteObligation(item.id);
      if (killedTxId) await db.deleteTransaction(killedTxId);
    });
  };
  const resetAll = async () => {
    if (!window.confirm(`Wipe "${data.ledger.name}" and start it fresh? Every entry, receivable, and credit pool in THIS ledger will be removed. Other ledgers are untouched.`)) return;
    setData(null);
    try { await db.resetLedger(data.ledger.kind); } catch (e) { console.error(e); }
    window.location.reload();
  };

  const importStatement = (txs, anchor) => {
    const recs = txs.map((t) => ({ ...t, id: crypto.randomUUID() }));
    if (recs.length) {
      setData((d) => ({ ...d, transactions: [...recs, ...d.transactions] }));
      addNotification(notify.success(`${recs.length} transaction${recs.length === 1 ? "" : "s"} imported`));
      dbTry(() => db.insertTransactions(recs));
    }
    if (anchor) setAnchor(anchor.amount, anchor.date, "statement");
    const latest = recs.reduce((m, t) => (t.date && t.date > m ? t.date : m), "");
    if (latest) setMonth(latest.slice(0, 7));
    setImporting(false);
    setBankReview(null);
    // An import folds outside lines into the books, so it belongs in the same
    // history as a reconciliation — it's the other way the books change without
    // anyone typing an entry.
    if (recs.length) {
      recordConsolidation({
        kind: "import",
        createdCount: recs.length,
        deltaBefore: balance.delta,
        unexplainedBefore: recon?.unexplained ?? null,
        note: anchor ? `statement import, anchored to ${fmt(anchor.amount)} on ${anchor.date}` : "statement import",
        items: recs.slice(0, 200).map((t) => ({
          kind: "created", date: t.date, amount: t.amount,
          description: t.description || t.category,
          detail: `${t.type === "income" ? "+" : "−"}${fmt(t.amount)} · ${t.category}`,
        })),
      });
    }
  };

  /* ---- reconciliation: bank line ↔ ledger entry ---- */

  // Optimistic on the client, written behind it, same as every other mutation.
  const patchBankTxn = (id, patch) =>
    setBankTxns((rows) => rows.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const matchBankTxn = (bankId, txId, source = "manual") => {
    patchBankTxn(bankId, { status: "matched", matchedTxId: txId, matchSource: source, reviewReason: null });
    dbTry(() => bank.matchBankTxn(bankId, txId, source));
  };

  const unmatchBankTxn = (bankId) => {
    patchBankTxn(bankId, { status: "unmatched", matchedTxId: null, matchSource: null });
    dbTry(() => bank.unmatchBankTxn(bankId));
  };

  const ignoreBankTxn = (bankId) => {
    patchBankTxn(bankId, { status: "ignored", matchedTxId: null, matchSource: null });
    dbTry(() => bank.setBankTxnStatus(bankId, "ignored"));
  };

  const unignoreBankTxn = (bankId) => {
    patchBankTxn(bankId, { status: "unmatched" });
    dbTry(() => bank.setBankTxnStatus(bankId, "unmatched"));
  };

  const dismissReviewFlag = (bankId) => {
    patchBankTxn(bankId, { reviewReason: null });
    dbTry(() => bank.clearReviewFlag(bankId));
  };

  const applyAutoMatches = (pairs) => {
    if (!pairs.length) return;
    setBankTxns((rows) => rows.map((b) => {
      const hit = pairs.find((p) => p.bankId === b.id);
      return hit ? { ...b, status: "matched", matchedTxId: hit.txId, matchSource: "auto" } : b;
    }));
    // No toast here: the consolidate screen is the only caller and it reports
    // what the approved plan did, in place. Two announcements of one action
    // reads like two actions.
    dbTry(() => bank.matchMany(pairs.map((p) => ({ bankId: p.bankId, txId: p.txId })), "auto"));
  };

  // Turn a bank line the books never recorded into a real entry, already linked
  // to the line that proves it happened.
  const createFromBankTxn = (bankTxn, { category, subcategory, account }) => {
    const tx = {
      id: crypto.randomUUID(),
      date: bankTxn.date,
      amount: Math.abs(Number(bankTxn.amount)) || 0,
      type: bankTxn.direction === "credit" ? "income" : "expense",
      category,
      subcategory: subcategory || "",
      description: bankTxn.description || "Bank transaction",
      account: account || (data.ledger.kind === "personal" ? "personal" : "business"),
      recurrence: "once",
    };
    setData((d) => ({ ...d, transactions: [tx, ...d.transactions] }));
    patchBankTxn(bankTxn.id, { status: "matched", matchedTxId: tx.id, matchSource: "created", reviewReason: null });
    dbTry(async () => {
      await db.insertTransaction(tx);
      await bank.matchBankTxn(bankTxn.id, tx.id, "created");
    });
    return tx;
  };

  /* ---- duplicates ---- */

  // Drops the extra copies of one group and keeps the entry the group named.
  // Returns what went, so the consolidation log can say what it removed.
  const removeDuplicateGroup = (group) => {
    const ids = group.extras.map((e) => e.id);
    if (!ids.length) return [];
    const gone = data.transactions.filter((t) => ids.includes(t.id));
    for (const t of gone) if (t.attachmentId) deleteAttachment(t.attachmentId);
    setData((d) => ({ ...d, transactions: d.transactions.filter((t) => !ids.includes(t.id)) }));
    dropMatchesFor(ids);
    dbTry(() => db.deleteTransactions(ids));
    return gone;
  };

  // The bank's own copies are never deleted — the rows are the record of what
  // it sent, and the next sync would only bring them back. Ignoring takes them
  // out of the gap and leaves the audit trail intact.
  const ignoreDuplicateBankLines = (group) => {
    const ids = group.extras.map((e) => e.id);
    if (!ids.length) return [];
    setBankTxns((rows) => rows.map((b) => (ids.includes(b.id) ? { ...b, status: "ignored", matchedTxId: null, matchSource: null } : b)));
    dbTry(() => Promise.all(ids.map((id) => bank.setBankTxnStatus(id, "ignored"))));
    return group.extras;
  };

  /* ---- consolidation history ---- */

  // One row per finished run: what it matched, what it created, what it
  // removed, and the fingerprint of what was still open when it ended.
  const recordConsolidation = (run) => {
    const row = {
      ...run,
      signature: run.kind === "import" ? null : consolidation.signature,
      openBank: recon?.bankOnly.count || 0,
      openBooks: recon?.bookOnly.count || 0,
      deltaAfter: balance.delta,
      unexplainedAfter: recon?.unexplained ?? null,
    };
    setData((d) => ({
      ...d,
      consolidations: [{ ...row, id: crypto.randomUUID(), createdAt: new Date().toISOString(), items: row.items || [] }, ...(d.consolidations || [])],
    }));
    const msgs = [];
    if (run.matched) msgs.push(`${run.matched} matched`);
    if (run.created) msgs.push(`${run.created} created`);
    if (run.removed) msgs.push(`${run.removed} removed`);
    const msg = msgs.length ? `Reconciliation: ${msgs.join(", ")}` : "Reconciliation complete";
    addNotification(notify.success(msg));
    // A failed write here is worth naming precisely: the run still shows as
    // done on screen, but nothing will remember it after a reload — which is
    // the exact complaint this whole record exists to fix.
    db.logConsolidation(data.ledger.id, row).catch((e) => {
      console.error("consolidation log failed:", e);
      addNotification(notify.error("This consolidation was applied but couldn't be filed. Run supabase/migration-consolidations.sql so it's remembered next time."));
    });
  };

  const setAnchor = (amount, date, source = "manual") => {
    setData((d) => ({
      ...d,
      settings: { ...d.settings, startingBalance: amount, anchorDate: date },
      anchorHistory: [{ amount, date, source, createdAt: todayStr() }, ...(d.anchorHistory || [])],
    }));
    setReconciling(false);
    addNotification(notify.success(`Balance anchored at ${fmt(amount)}`));
    dbTry(() => db.setAnchor(amount, date, source));
  };

  const setTheme = (t) => {
    Object.assign(P, PALETTES[t]);
    setThemeState(t);
    setData((d) => ({ ...d, settings: { ...d.settings, theme: t } }));
    dbTry(() => db.setTheme(t));
  };

  const openPreview = async (attachmentId, fallbackName) => {
    try {
      const att = await attachmentToBlobURL(attachmentId, fallbackName);
      setPreview({ ...att, attachmentId });
    } catch {
      setPreview({ error: true, name: fallbackName });
    }
  };
  const closePreview = () => setPreview(null); // signed URLs expire on their own

  const tabs = [
    ["overview", "Overview", LayoutGrid],
    ["transactions", "Transactions", Receipt],
    ["pl", "P&L", TrendingUp],
    ["arap", "AR / AP", FileClock],
    ["credits", "Credits", Coins],
    ["calendar", "Calendar", CalendarDays],
    ["integrations", "Connectors", Plug],
  ];

  return (
    <div style={{ background: P.bg, color: P.text, minHeight: "100vh", fontFamily: SANS }}>
      <div className="px-4" style={{ paddingBottom: "calc(112px + env(safe-area-inset-bottom, 0px))" }}>
        {/* ===== header ===== */}
        <header className="pt-6 pb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div style={{ fontFamily: MONO, color: P.text }} className="text-xs uppercase tracking-widest">
              Brasstally
            </div>
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative min-w-0">
                <button
                  onClick={() => setLedgerMenuOpen((o) => !o)}
                  title="Switch ledger"
                  className="flex items-center gap-1.5 text-left min-w-0 max-w-[70vw] sm:max-w-xs"
                >
                  <h1 style={{ fontFamily: SERIF }} className="text-3xl leading-tight truncate">{data.ledger.name}</h1>
                  <ChevronDown size={20} style={{ color: P.brass, transform: ledgerMenuOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} className="shrink-0" />
                </button>
                {ledgerMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setLedgerMenuOpen(false)} />
                    <div
                      style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: "0 12px 32px rgba(0,0,0,0.35)" }}
                      className="absolute left-0 top-full mt-2 rounded-lg z-50 min-w-56 overflow-hidden py-1"
                    >
                      {ledgers.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => { setLedgerMenuOpen(false); if (l.id !== data.ledger.id) setCurrentLedger(l); }}
                          style={{ color: l.id === data.ledger.id ? P.text : P.muted }}
                          className="w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 hover:opacity-80"
                        >
                          <span className="truncate">{l.name}</span>
                          {l.id === data.ledger.id
                            ? <Check size={14} style={{ color: P.brass }} className="shrink-0" />
                            : <span style={{ fontFamily: MONO, color: P.faint }} className="text-xs shrink-0">{kindLabel(l.kind).split(" ")[0]}</span>}
                        </button>
                      ))}
                      <div style={{ borderTop: `1px solid ${P.line}` }} className="mt-1 pt-1">
                        <button
                          onClick={() => { setLedgerMenuOpen(false); setNewLedgerOpen(true); }}
                          style={{ color: P.brass, fontFamily: MONO }}
                          className="w-full text-left px-3 py-2 text-xs"
                        >
                          + new ledger…
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <span style={{ fontFamily: MONO, color: P.brass, border: `1px solid ${P.brass}` }} className="rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
                {kindLabel(data.ledger.kind)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAccountOpen(true)}
              title="Profile, membership, and settings"
              style={{ color: P.muted, border: `1px solid ${P.line}` }}
              className="rounded p-2"
            >
              <User size={15} />
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Switch to light" : "Switch to dark"}
              style={{ color: P.muted, border: `1px solid ${P.line}` }}
              className="rounded p-2"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <Btn tone="ghost" onClick={() => setMonth(shiftMonth(month, -1))}>‹</Btn>
            <div style={{ fontFamily: MONO }} className="text-sm w-40 text-center">{monthLabel(month)}</div>
            <Btn tone="ghost" onClick={() => setMonth(shiftMonth(month, 1))}>›</Btn>
          </div>
        </header>

        {/* ===== signature ledger line ===== */}
        <LedgerLine
          sums={sums}
          balance={balance}
          openBooks={openBooks}
          creditsLeft={(data.credits || []).length ? creditsTotalRemaining(data) : null}
          onCredits={() => setTab("credits")}
          onReconcile={() => (balance.source === "bank" ? setMatchOpen(true) : setReconciling(true))}
        />

        {/* ===== tabs ===== */}
        <div className="mt-6 mb-6">
          <h2 style={{ fontFamily: SERIF }} className="text-xl fade-in-key" key={tab}>
            {tabs.find(([k]) => k === tab)?.[1]}
          </h2>
        </div>

        {false && (
          <div style={{ border: `1px solid ${P.debit}`, color: P.debit }} className="rounded p-2 text-sm mb-4">
            Couldn't reach the database, the last change shows on screen but may not have saved. Check your connection and retry.
          </div>
        )}

        {/* The gap is worth shouting about until it's been worked through, and
            no longer once it has. A finished consolidation stays finished
            across ledger switches and reloads — until the bank or the books
            move, at which point this turns loud again by itself. */}
        {balance.source === "bank" && balance.delta != null && Math.abs(balance.delta) >= 0.01 && (
          <button
            type="button"
            onClick={() => setMatchOpen(true)}
            style={{
              border: `1px solid ${consolidation.settled ? P.line : P.debit}`,
              color: consolidation.settled ? P.muted : P.debit,
              background: "transparent",
            }}
            className="rounded p-2 text-sm mb-4 w-full text-left"
          >
            <span style={{ fontFamily: MONO }} className="text-xs">
              Bank {fmt(balance.bank)} · books {fmt(balance.book)} · Δ {fmt(balance.delta)}
              {balance.balanceAsOf ? ` as of ${String(balance.balanceAsOf).slice(0, 10)}` : ""}
            </span>
            <span className="block text-xs mt-0.5" style={{ color: consolidation.settled ? P.faint : P.muted }}>
              {consolidation.settled
                ? `Consolidated ${relDay(consolidation.last.createdAt)}. The gap is ${recon?.unexplained != null && Math.abs(recon.unexplained) >= 0.01 ? "as explained as it can be" : "fully accounted for"} by ${recon?.bankOnly.count || 0} bank ${(recon?.bankOnly.count || 0) === 1 ? "line" : "lines"} and ${recon?.bookOnly.count || 0} ${(recon?.bookOnly.count || 0) === 1 ? "entry" : "entries"} still open. Tap to review.`
                : duplicates.length
                  ? `${duplicates.length} possible ${duplicates.length === 1 ? "duplicate" : "duplicates"} in the books${recon ? `, ${recon.bankOnly.count} bank ${recon.bankOnly.count === 1 ? "line isn't" : "lines aren't"} recorded` : ""}. Tap to consolidate.`
                  : recon && (recon.bankOnly.count || recon.bookOnly.count)
                    ? `${recon.bankOnly.count} bank ${recon.bankOnly.count === 1 ? "line isn't" : "lines aren't"} in the books, ${recon.bookOnly.count} ${recon.bookOnly.count === 1 ? "entry hasn't" : "entries haven't"} cleared. Tap to pair them up.`
                    : "Books and bank disagree. Tap to consolidate line by line."}
            </span>
          </button>
        )}

        {!seenTours[tab] && !window.localStorage.getItem(`tour:${tab}`) && (
          <TourCard tab={tab} onDismiss={() => {
            window.localStorage.setItem(`tour:${tab}`, "1");
            setSeenTours((s) => ({ ...s, [tab]: true }));
          }} />
        )}
        <div key={tab} className="tab-enter">
        {tab === "overview" && !setupHidden && (
          <SetupChecklist
            data={data}
            bankConns={bankConns}
            openGuide={openGuide}
            onGo={(where) => {
              if (where === "capture") return setChatOpen(true);
              setTab(where);
            }}
            onDismiss={() => { window.localStorage.setItem("setup:hidden", "1"); setSetupHidden(true); }}
          />
        )}
        {tab === "overview" && <Overview data={data} monthTx={monthTx} sums={sums} setPlanned={setPlanned} month={month} insights={insights} onAsk={askAgent} />}
        {/* subcategory-aware forms need addSub */}
        {tab === "transactions" && <Transactions data={data} monthTx={monthTx} addTx={addTx} delTx={delTx} updateTx={updateTx} setTxAttachment={setTxAttachment} openPreview={openPreview} openImport={() => setImporting(true)} openTransfer={() => setTransferOpen(true)} addSub={addSub} addCredit={addCredit} month={month} cleared={cleared} />}
        {tab === "pl" && <ProfitLoss data={data} month={month} />}
        {tab === "arap" && <ARAP openGuide={openGuide} data={data} addAR={addAR} settleAR={settleAR} delAR={delAR} removeSettled={removeSettled} updateAR={updateAR} addSub={addSub} addCredit={addCredit} openPreview={openPreview} />}
        {tab === "credits" && <CreditsCard data={data} addCredit={addCredit} updateCredit={updateCredit} delCredit={delCredit} />}
        {tab === "calendar" && <CashCalendar data={data} />}
        {tab === "integrations" && <IntegrationsTab data={data} openGuide={openGuide} onReview={() => setMatchOpen(true)} onSynced={afterSync} onConnectionsChange={setBankConns} updateLedgerMeta={(patch) => {
          setData((d) => ({ ...d, ledger: { ...d.ledger, ...patch } }));
          setLedgers((ls) => ls.map((l) => (l.id === data.ledger.id ? { ...l, ...patch } : l)));
          dbTry(() => db.updateLedger(data.ledger.id, patch));
        }} />}
        </div>
      </div>

      {/* ===== floating Brasstally chat (stays mounted so the conversation survives closing) ===== */}
      {/* capture panel floats above the dock */}
      <div className="fixed z-40" style={{ right: "12px", bottom: "84px", width: "min(24rem, calc(100vw - 24px))", pointerEvents: chatOpen ? "auto" : "none" }}>
        <div className={"capture-pop " + (chatOpen ? "open" : "")}>
          <div
            style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: "0 16px 48px rgba(0,0,0,0.45)" }}
            className="rounded-lg overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${P.line}` }}>
              <MessageSquare size={14} style={{ color: P.brass }} />
              <div style={{ fontFamily: MONO }} className="text-xs uppercase tracking-widest flex-1">Brasstally</div>
              <button onClick={() => setChatOpen(false)} style={{ color: P.muted }} className="p-1"><X size={15} /></button>
            </div>
            <Capture
              key={data.ledger.id}
              data={data}
              addTx={addTx}
              addAR={addAR}
              addSub={addSub}
              month={month}
              balance={balance}
              openBooks={openBooks}
              recon={recon}
              consolidation={consolidation}
              bankConns={bankConns}
              insights={insights}
              seed={chatSeed}
              onSeedUsed={() => setChatSeed(null)}
              guide={chatGuide}
              onGuideUsed={() => setChatGuide(null)}
              nudge={chatNudge}
              onNudgeUsed={() => setChatNudge(null)}
              apply={{ addTx, addAR, settleAR, setPlanned, setAnchor }}
              onGo={(view) => {
                setChatOpen(false);
                if (view === "reconcile") return setMatchOpen(true);
                if (view === "anchor") return setReconciling(true);
                if (view === "import") return setImporting(true);
                setTab(view === "bank" ? "integrations" : view);
              }}
              embedded
            />
          </div>
        </div>
      </div>

      {/* ===== floating dock: all sections, capture lives on the right ===== */}
      <nav className="fixed z-40 left-1/2 bottom-4" style={{ transform: "translateX(-50%)", maxWidth: "calc(100vw - 20px)" }}>
        <div
          className="dock flex items-center gap-0.5 px-2 py-1.5 rounded-full"
          style={{ background: theme === "dark" ? "rgba(23,31,27,0.72)" : "rgba(251,250,245,0.78)", border: `1px solid ${P.line}`, backdropFilter: "blur(18px) saturate(1.4)", WebkitBackdropFilter: "blur(18px) saturate(1.4)", boxShadow: "0 10px 34px rgba(0,0,0,0.30)" }}
        >
          {tabs.map(([k, label, Icon]) => (
            <DockBtn key={k} label={label} active={tab === k} onClick={() => { setTab(k); setChatOpen(false); }}><Icon size={19} /></DockBtn>
          ))}

          {/* divider */}
          <span aria-hidden style={{ width: 1, height: 24, background: P.line, margin: "0 4px", flexShrink: 0 }} />

          {/* capture button, frosted brass, on the right */}
          <button
            onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) setChatUnread(false); }}
            title={chatOpen ? "Close Brasstally" : chatUnread ? "Brasstally has something to tell you" : "Message Brasstally, capture a receipt or ask about the ledger"}
            aria-label="Brasstally"
            className="dock-capture rounded-full flex items-center justify-center shrink-0"
            style={{ position: "relative", background: theme === "dark" ? "rgba(242,185,74,0.22)" : "rgba(184,134,11,0.16)", color: P.brass, border: `1px solid ${theme === "dark" ? "rgba(242,185,74,0.5)" : "rgba(184,134,11,0.4)"}`, width: 44, height: 44, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
          >
            <span className="dock-capture-icon" style={{ display: "inline-flex", transform: chatOpen ? "rotate(45deg)" : "none", transition: "transform .28s cubic-bezier(.2,.8,.2,1)" }}>
              <Plus size={22} />
            </span>
            {chatUnread && !chatOpen && (
              <span
                aria-hidden
                className="dock-capture-badge"
                style={{
                  position: "absolute", top: 2, right: 2, width: 10, height: 10, borderRadius: "50%",
                  background: P.debit, border: `2px solid ${theme === "dark" ? "#171f1b" : "#fbfaf5"}`,
                }}
              />
            )}
          </button>
        </div>
      </nav>

      <ToastContainer notifications={notifications} onDismiss={dismissNotification} palette={P} />

      <PreviewModal preview={preview} onClose={closePreview} />
      {accountOpen && <AccountModal theme={theme} setTheme={setTheme} onSignOut={onSignOut} onResetLedger={resetAll} ledgerName={data.ledger.name} onClose={() => setAccountOpen(false)} />}
      {newLedgerOpen && <NewLedgerModal onCreate={createLedgerAndSwitch} onClose={() => setNewLedgerOpen(false)} />}
      {matchOpen && (
        <MatchView
          openGuide={openGuide}
          data={data}
          bankTxns={bankTxns}
          balance={balance}
          recon={recon}
          duplicates={duplicates}
          dupBankLines={dupBankLines}
          consolidation={consolidation}
          actions={{
            match: matchBankTxn,
            unmatch: unmatchBankTxn,
            ignore: ignoreBankTxn,
            unignore: unignoreBankTxn,
            dismissFlag: dismissReviewFlag,
            applyAuto: applyAutoMatches,
            createFrom: createFromBankTxn,
            removeDuplicates: removeDuplicateGroup,
            ignoreDupBank: ignoreDuplicateBankLines,
            record: recordConsolidation,
          }}
          onAnchorInstead={() => { setMatchOpen(false); setReconciling(true); }}
          onClose={() => setMatchOpen(false)}
        />
      )}
      {transferOpen && (
        <TransferModal
          data={data}
          others={ledgers.filter((l) => l.id !== data.ledger.id)}
          addSub={addSub}
          onNewLedger={() => { setTransferOpen(false); setNewLedgerOpen(true); }}
          onSubmit={makeTransfer}
          onClose={() => setTransferOpen(false)}
        />
      )}
      {reconciling && (
        <ReconcileModal
          currentValue={balance.beforeAnchor ? null : balance.book}
          initialAmount={balance.source === "bank" && balance.bank != null ? balance.bank : null}
          anchorAmount={balance.anchorAmount}
          anchorDate={balance.anchorDate}
          onSave={setAnchor}
          anchorHistory={data.anchorHistory || []}
          onImportInstead={() => { setReconciling(false); setImporting(true); }}
          onClose={() => setReconciling(false)}
        />
      )}
      {importing && (
        <ImportModal data={data} addSub={addSub} onImport={importStatement} onClose={() => setImporting(false)} />
      )}
    </div>
  );
}

/* ================= attachment preview modal ================= */
function PreviewModal({ preview, onClose }) {
  useEffect(() => {
    if (!preview) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, onClose]);
  if (!preview) return null;
  const isImage = preview.type?.startsWith("image/");
  const isPdf = preview.type === "application/pdf";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div
        style={{ background: P.surface, border: `1px solid ${P.line}` }}
        className="rounded-lg w-full max-w-3xl max-h-full flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: `1px solid ${P.line}` }}>
          <FileText size={14} style={{ color: P.brass }} />
          <div className="text-sm truncate flex-1" style={{ color: P.text }}>{preview.name || "Filed document"}</div>
          {!preview.error && (
            <button
              onClick={() => downloadAttachment(preview.attachmentId, preview.name)}
              title="Download"
              style={{ color: P.muted }}
              className="p-1"
            >
              <Download size={15} />
            </button>
          )}
          <button onClick={onClose} title="Close" style={{ color: P.muted }} className="p-1">
            <X size={16} />
          </button>
        </div>
        {preview.error ? (
          <p style={{ color: P.debit }} className="text-sm p-6">
            Couldn't load this file from storage. It may have been removed, try re-attaching it.
          </p>
        ) : isImage ? (
          <div className="overflow-auto flex items-center justify-center p-4" style={{ background: P.bg, maxHeight: "75vh" }}>
            <img src={preview.url} alt={preview.name} className="max-w-full rounded" style={{ maxHeight: "70vh" }} />
          </div>
        ) : isPdf ? (
          <iframe src={preview.url} title={preview.name} className="w-full" style={{ height: "75vh", border: "none", background: "#525659" }} />
        ) : (
          <p style={{ color: P.muted }} className="text-sm p-6">
            No inline preview for this file type, use the download button above.
          </p>
        )}
      </div>
    </div>
  );
}

/* ================= balance reconciliation ================= */
function ReconcileModal({ currentValue, initialAmount, anchorAmount, anchorDate, anchorHistory = [], onSave, onImportInstead, onClose }) {
  const [amount, setAmount] = useState(
    initialAmount != null && !Number.isNaN(Number(initialAmount)) ? String(Number(initialAmount)) : ""
  );
  const [date, setDate] = useState(todayStr());

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = parseFloat(amount);
  const valid = !Number.isNaN(parsed) && date;
  const drift = valid && currentValue != null ? parsed - currentValue : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 style={{ fontFamily: SERIF }} className="text-lg">Correct the balance</h3>
          <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
        </div>
        <p style={{ color: P.muted }} className="text-sm mb-4">
          {initialAmount != null
            ? "Prefilled from your bank feed. Anchoring aligns the ledger books to that number on this date. It does not invent missing transactions."
            : "Check your real accounts and enter the combined total. The ledger anchors to that number on that date , months you never tracked before it stop affecting the balance, and only entries you log after it count."}
        </p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <Label>Actual balance</Label>
            <Input type="number" autoFocus placeholder="0.00" value={amount}
              onChange={(e) => setAmount(e.target.value)} style={{ fontFamily: MONO }} />
          </div>
          <div>
            <Label>As of</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {drift !== null && Math.abs(drift) > 0.005 && (
          <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs mb-3">
            That's {fmt(Math.abs(drift))} {drift > 0 ? "more" : "less"} than the books currently show ({fmt(currentValue)}), the gap is what went untracked.
          </p>
        )}
        <p style={{ color: P.faint }} className="text-xs mb-4">
          Currently anchored: {fmt(anchorAmount)} on {anchorDate}. Entries dated on or before the anchor stay in your
          P&L and history, they just don't feed the books balance.
        </p>
        {anchorHistory.length > 0 && (
          <div className="mb-4">
            <Label>Balance history</Label>
            <div className="divide-y" style={{ borderColor: P.line }}>
              {anchorHistory.slice(0, 8).map((h, i) => (
                <div key={i} className="flex justify-between gap-3 py-1.5 text-xs" style={{ fontFamily: MONO, borderColor: P.line }}>
                  <span style={{ color: P.text }}>{fmt(h.amount)} <span style={{ color: P.faint }}>as of {h.date}</span></span>
                  <span style={{ color: P.faint }}>{h.source === "statement" ? "statement import" : "manual fix"} · {h.createdAt}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <Btn className="w-full justify-center" disabled={!valid} onClick={() => onSave(parsed, date)}>
          <Check size={14} /> Anchor balance here
        </Btn>
        <button onClick={onImportInstead} style={{ color: P.brass, fontFamily: MONO }} className="w-full text-center text-xs mt-3 underline decoration-dotted underline-offset-2">
          or import a bank statement to reconcile line by line →
        </button>
      </div>
    </div>
  );
}

/* ================= line-by-line reconciliation: bank ↔ books ================= */

const BankLine = ({ b, selected, onSelect, right }) => (
  <div
    onClick={onSelect}
    style={{
      background: selected ? P.surface2 : "transparent",
      border: `1px solid ${selected ? P.brass : P.line}`,
    }}
    className="rounded p-2 flex items-center gap-2 cursor-pointer"
  >
    <div className="flex-1 min-w-0">
      <div className="text-sm truncate">{b.description}</div>
      <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
        {b.date}{b.pending ? " · pending" : ""}
      </div>
    </div>
    <div style={{ fontFamily: MONO, color: b.direction === "credit" ? P.credit : P.debit }} className="text-sm tabular-nums shrink-0">
      {b.direction === "credit" ? "+" : "−"}{fmt(b.amount)}
    </div>
    {right}
  </div>
);

const BookLine = ({ t, selected, onSelect }) => (
  <div
    onClick={onSelect}
    style={{
      background: selected ? P.surface2 : "transparent",
      border: `1px solid ${selected ? P.brass : P.line}`,
    }}
    className="rounded p-2 flex items-center gap-2 cursor-pointer"
  >
    <div className="flex-1 min-w-0">
      <div className="text-sm truncate">{t.description || t.category}</div>
      <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
        {t.date} · {t.category}
      </div>
    </div>
    <div style={{ fontFamily: MONO, color: t.type === "income" ? P.credit : P.debit }} className="text-sm tabular-nums shrink-0">
      {t.type === "income" ? "+" : "−"}{fmt(t.amount)}
    </div>
  </div>
);

/**
 * The consolidation workbench, in the order the work actually has to happen:
 * throw out the copies, pair what's left, add what was never recorded, then
 * record the run. Nothing here rewrites the balance — re-anchoring is still
 * available behind a link, but it's the escape hatch, not the front door:
 * anchoring sets the gap to zero without explaining a cent of it.
 *
 * Recording the run is what stops the app asking again. Matching explains the
 * gap without closing it, so the delta alone can never tell anyone whether the
 * work is done; the run stores a fingerprint of what was still open when it
 * finished, and the ask only comes back when that changes.
 */
/* ================= consolidate =================
   A review, not a chore. The engine works the books first and arrives with a
   plan: here is what I am sure about, approve it; here is what I am not, one
   question at a time. The two-column pairing screen is still here, because
   sometimes you do want to drive, but it is behind a link rather than being
   the first thing you meet. */

function PlanLine({ children, tone = "muted" }) {
  return (
    <div className="flex items-start gap-2 text-sm" style={{ color: P[tone] }}>
      <span style={{ color: P.brass }} className="shrink-0">·</span>
      <span>{children}</span>
    </div>
  );
}

/** One thing the engine could not settle, phrased as a question with answers. */
function AskCard({ title, detail, amount, date, children, tone = "line" }) {
  return (
    <div style={{ border: `1px solid ${P[tone]}` }} className="rounded-lg p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm" style={{ color: P.text }}>{title}</div>
          {detail && <div style={{ color: P.muted }} className="text-xs mt-0.5">{detail}</div>}
        </div>
        {amount != null && (
          <div className="shrink-0 text-right">
            <div style={{ fontFamily: MONO }} className="text-sm tabular-nums">{fmt(amount)}</div>
            {date && <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">{date}</div>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mt-2">{children}</div>
    </div>
  );
}

function MatchView({
  data, bankTxns, balance, recon, duplicates = [], dupBankLines = [], consolidation,
  actions, onAnchorInstead, onClose, openGuide,
}) {
  const [pickedBank, setPickedBank] = useState(null);
  const [pickedTx, setPickedTx] = useState(null);
  const [adding, setAdding] = useState(null);   // bank line being turned into an entry
  const [showManual, setShowManual] = useState(false);
  const [showMatched, setShowMatched] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [openRun, setOpenRun] = useState(null); // history row expanded to its items
  const [openDup, setOpenDup] = useState(null); // duplicate group expanded to its copies
  const [fixing, setFixing] = useState(false);
  const [fixedSummary, setFixedSummary] = useState(null); // what the approved plan actually did
  const [skipped, setSkipped] = useState([]);   // keys pushed to the back, in skip order
  const [showAllAsks, setShowAllAsks] = useState(false);   // the old wall, on request
  // Everything this session did, in order. It becomes the history record on the
  // way out, so a consolidation can be read back line by line months later.
  const [log, setLog] = useState([]);
  const opened = useRef({ delta: balance.delta, unexplained: recon?.unexplained ?? null });

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const plan = useMemo(
    () => consolidationPlan({ bankTxns, txs: data.transactions, duplicates, dupBankLines, balance }),
    [bankTxns, data.transactions, duplicates, dupBankLines, balance],
  );
  const matched = bankTxns.filter((b) => b.status === "matched");
  const ignored = bankTxns.filter((b) => b.status === "ignored");
  const txById = useMemo(() => new Map(data.transactions.map((t) => [t.id, t])), [data.transactions]);

  /* ---- the questions, as a queue rather than a wall ----
     Answering one changes the books, which recomputes the plan, which drops the
     answered item out of this list. So "what to ask next" is always the head of
     what is still open — there is no cursor to keep in sync, and nothing can be
     asked twice. Skipped items go to the back instead of disappearing, so
     finishing the easy ones never loses the hard ones. */
  const asks = useMemo(() => [
    ...plan.ask.changed.map((b) => ({ key: `changed:${b.id}`, kind: "changed", item: b })),
    ...plan.ask.maybeDuplicates.map((g) => ({ key: `dup:${g.id}`, kind: "dup", item: g })),
    ...plan.ask.pairs.map((p) => ({ key: `pair:${p.bankId}`, kind: "pair", item: p })),
    ...plan.ask.unrecorded.map((b) => ({ key: `new:${b.id}`, kind: "new", item: b })),
  ], [plan]);

  // Every question this session has ever put up, so progress counts against the
  // pile someone actually walked in with and doesn't shrink as they answer.
  const seen = useRef(new Set());
  for (const a of asks) seen.current.add(a.key);
  const totalAsked = seen.current.size;
  const answered = Math.max(0, totalAsked - asks.length);

  // Skipped keys are held in the order they were skipped, not as a set: once
  // everything else is answered the only way to move off a card is to send it
  // to the back, and a set has no back.
  const byKey = useMemo(() => new Map(asks.map((a) => [a.key, a])), [asks]);
  const pending = asks.filter((a) => !skipped.includes(a.key));
  const deferred = skipped.map((k) => byKey.get(k)).filter(Boolean);
  // Skipped items come back once everything else is done, rather than being a
  // way to never deal with them.
  const current = pending[0] || deferred[0] || null;
  const onLastLap = !pending.length && deferred.length > 0;

  // Sending the current card to the back covers both laps: on the first it
  // leaves `pending`, on the last it moves behind the other skipped ones.
  const skipCurrent = () => {
    if (!current) return;
    setSkipped((s) => [...s.filter((k) => k !== current.key), current.key]);
  };

  // Stale keys pile up as the books change underneath the queue; drop the ones
  // that no longer name a live question so `deferred` can actually empty out.
  useEffect(() => {
    setSkipped((s) => (s.every((k) => byKey.has(k)) ? s : s.filter((k) => byKey.has(k))));
  }, [byKey]);

  /* ---- every action goes through here, so nothing happens off the record ---- */
  const note = (entry) => setLog((l) => [...l, { at: new Date().toISOString(), ...entry }]);

  const doMatch = (bankId, txId, source = "manual") => {
    const b = bankTxns.find((x) => x.id === bankId);
    const t = txById.get(txId);
    actions.match(bankId, txId, source);
    note({
      kind: "matched", bankId, date: b?.date, amount: b?.amount,
      description: b?.description || "bank line",
      detail: `paired with ${t?.description || t?.category || "an entry"}${t?.date && t.date !== b?.date ? ` dated ${t.date}` : ""}`,
    });
  };

  const doUnmatch = (bankId) => {
    const b = bankTxns.find((x) => x.id === bankId);
    actions.unmatch(bankId);
    note({ kind: "unmatched", date: b?.date, amount: b?.amount, description: b?.description || "bank line", detail: "pairing undone" });
  };

  const doIgnore = (bankId) => {
    const b = bankTxns.find((x) => x.id === bankId);
    actions.ignore(bankId);
    note({ kind: "ignored", bankId, date: b?.date, amount: b?.amount, description: b?.description || "bank line", detail: "set aside, it will never have an entry" });
  };

  /* ---- taking the last answer back ----
     Only pairing and setting aside are genuinely reversible. Removing a
     duplicate deletes rows and adding an entry creates one, so neither is
     offered here: the button disappears rather than promising an undo it
     cannot honour. Undoing also drops the entry from the log, so the run
     that gets filed is what was actually decided, not a decision and its
     retraction. */
  const undoable = (() => {
    const last = log[log.length - 1];
    if (!last || !last.bankId) return null;
    if (last.kind === "matched") return { last, verb: "pairing" };
    if (last.kind === "ignored") return { last, verb: "set-aside" };
    return null;
  })();

  const undoLast = () => {
    if (!undoable) return;
    const { last } = undoable;
    if (last.kind === "matched") actions.unmatch(last.bankId);
    else actions.unignore(last.bankId);
    setLog((l) => l.slice(0, -1));
    // It came back as a question; don't let a stale skip bury it at the back.
    setSkipped((s) => s.filter((k) => k !== `pair:${last.bankId}` && k !== `new:${last.bankId}`));
  };

  const doCreate = (b, opts) => {
    const t = actions.createFrom(b, opts);
    note({
      kind: "created", date: b.date, amount: b.amount,
      description: b.description || "bank line",
      detail: `added to the books as ${opts.category}${opts.subcategory ? ` / ${opts.subcategory}` : ""}`,
    });
    return t;
  };

  const doRemoveDup = (g) => {
    const gone = actions.removeDuplicates(g);
    if (!gone.length) return 0;
    note({
      kind: "duplicate", date: g.date, amount: g.extraTotal,
      description: g.description || g.keep.category,
      detail: `${gone.length} duplicate ${gone.length === 1 ? "copy" : "copies"} removed, kept the one from ${g.keep.date}`,
    });
    return gone.length;
  };

  const doIgnoreDupBank = (g) => {
    const gone = actions.ignoreDupBank(g);
    if (!gone.length) return 0;
    note({
      kind: "duplicate", date: g.date, amount: 0,
      description: g.description || "bank line",
      detail: `${gone.length} repeated bank ${gone.length === 1 ? "line" : "lines"} set aside, ${g.reason}`,
    });
    return gone.length;
  };

  /* ---- the approved plan, run in one go ---- */
  const runPlan = () => {
    setFixing(true);
    let paired = 0, removed = 0, setAside = 0;

    if (plan.fix.matches.length) {
      const pairs = plan.fix.matches.map((p) => ({ bankId: p.bankId, txId: p.txId }));
      actions.applyAuto(pairs);
      for (const p of plan.fix.matches) {
        const t = txById.get(p.txId);
        note({
          kind: "matched", date: p.bank?.date, amount: p.bank?.amount,
          description: p.bank?.description || "bank line",
          detail: `paired with ${t?.description || t?.category || "an entry"}, found by the engine`,
        });
      }
      paired = pairs.length;
    }
    for (const g of plan.fix.duplicates) removed += doRemoveDup(g);
    for (const g of plan.fix.dupBank) setAside += doIgnoreDupBank(g);

    setFixedSummary({ paired, removed, setAside });
    setFixing(false);
  };

  const pairSelected = () => {
    if (!pickedBank || !pickedTx) return;
    doMatch(pickedBank, pickedTx, "manual");
    setPickedBank(null);
    setPickedTx(null);
  };

  /* ---- finishing ---- */
  const count = (kind) => log.filter((l) => l.kind === kind).length;

  const record = () => actions.record({
    kind: log.length ? "reconcile" : "reviewed",
    matchedCount: count("matched"),
    createdCount: count("created"),
    ignoredCount: count("ignored"),
    unmatchedCount: count("unmatched"),
    duplicatesRemoved: log.filter((l) => l.kind === "duplicate").length,
    duplicateAmount: log.filter((l) => l.kind === "duplicate").reduce((s, l) => s + (Number(l.amount) || 0), 0),
    deltaBefore: opened.current.delta,
    unexplainedBefore: opened.current.unexplained,
    items: log.slice(0, 300),
    note: log.length ? null : "looked through it, nothing needed changing",
  });

  const finish = () => { record(); onClose(); };
  // Work that was actually done is never lost to a stray Escape or a tap on the
  // backdrop. Leaving without touching anything records nothing: that's a look,
  // not a decision.
  const closeView = () => { if (log.length) record(); onClose(); };
  const closeRef = useRef(closeView);
  closeRef.current = closeView;

  const connected = balance.source === "bank" && balance.bank != null;
  const nothingToDo = plan.fix.count === 0 && plan.ask.count === 0;

  // The opening line, in the register someone would actually use out loud.
  const headline = !connected
    ? "No bank connected yet, so there is nothing to compare the books against."
    : nothingToDo
      ? "Everything lines up. Every bank line has an entry behind it and there are no duplicates."
      : plan.fix.count && plan.ask.count
        ? `I went through ${plan.scanned.bank} bank ${plan.scanned.bank === 1 ? "line" : "lines"} and ${plan.scanned.books} ${plan.scanned.books === 1 ? "entry" : "entries"}. I can sort out ${plan.fix.count} of them myself. ${plan.ask.count} ${plan.ask.count === 1 ? "needs" : "need"} you.`
        : plan.fix.count
          ? `I went through ${plan.scanned.bank} bank ${plan.scanned.bank === 1 ? "line" : "lines"} and found ${plan.fix.count} ${plan.fix.count === 1 ? "thing" : "things"} I can sort out myself. Nothing else needs you.`
          : `Nothing for me to fix automatically. ${plan.ask.count} ${plan.ask.count === 1 ? "thing needs" : "things need"} a decision from you.`;

  /* ---- one question, drawn the same whether it arrives alone or in a list ----
     The stepper and the show-everything view render from this, so the wording
     and the buttons can never drift apart between the two. */
  const renderAsk = (a) => {
    const { kind, item } = a;

    if (kind === "changed") return (
      <AskCard key={a.key} tone="debit" amount={item.amount} date={item.date}
        title={`The bank changed this after you had already dealt with it: ${item.description}`}
        detail={item.reviewReason}>
        {item.matchedTxId && <Btn tone="ghost" onClick={() => doUnmatch(item.id)}>Undo the pairing</Btn>}
        <Btn tone="ghost" onClick={() => actions.dismissFlag(item.id)}>It is fine, leave it</Btn>
      </AskCard>
    );

    if (kind === "dup") return (
      <AskCard key={a.key} tone="brass" amount={item.amount} date={item.date}
        title={`Did you pay ${item.description || item.keep.category} once or ${item.extras.length + 1} times?`}
        detail={`${item.extras.length + 1} entries, ${item.reason}. A copy counts twice in the profit and loss, the budget, and the difference against the bank.`}>
        <Btn onClick={() => doRemoveDup(item)}><Trash2 size={13} /> Once, remove the {item.extras.length === 1 ? "other" : `other ${item.extras.length}`}</Btn>
        <button onClick={() => setOpenDup(openDup === item.id ? null : item.id)} style={{ color: P.brass, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">
          {openDup === item.id ? "hide" : "show me"} the copies
        </button>
        {openDup === item.id && (
          <div className="w-full mt-1 space-y-1">
            {[item.keep, ...item.extras].map((t, i) => (
              <div key={t.id} className="flex items-center gap-2 text-xs" style={{ fontFamily: MONO, color: i === 0 ? P.text : P.faint }}>
                <span className="shrink-0" style={{ color: i === 0 ? P.credit : P.debit }}>{i === 0 ? "keep" : "drop"}</span>
                <span className="flex-1 truncate">
                  {t.date}{fmtEntryTime(t.createdAt) ? ` ${fmtEntryTime(t.createdAt)}` : ""} · {t.description || t.category}{t.subcategory ? ` / ${t.subcategory}` : ""}
                </span>
                {t.attachmentId && <Paperclip size={11} className="shrink-0" />}
                <span className="tabular-nums shrink-0">{fmt(t.amount)}</span>
              </div>
            ))}
            <div style={{ color: P.faint }} className="text-xs">Keeping the wrong one? Delete the other from Transactions instead.</div>
          </div>
        )}
      </AskCard>
    );

    if (kind === "pair") return (
      <AskCard key={a.key} amount={item.bank.amount} date={item.bank.date}
        title={`Is "${item.bank.description}" the same thing as "${item.tx.description || item.tx.category}"?`}
        detail={item.ambiguous
          ? "Another entry fits this line just as well, so I will not guess. Check which one it is."
          : `${item.gap === 0 ? "Same day" : `${item.gap} ${item.gap === 1 ? "day" : "days"} apart`}, and the descriptions ${item.text >= 0.5 ? "roughly agree" : "do not agree"}.`}>
        <Btn onClick={() => doMatch(item.bankId, item.txId, "manual")}><Check size={13} /> Yes, same thing</Btn>
        <Btn tone="ghost" onClick={() => setAdding(adding?.id === item.bank.id ? null : item.bank)}>No, it is new</Btn>
        <Btn tone="ghost" onClick={() => doIgnore(item.bankId)}>Not mine, set it aside</Btn>
        {adding?.id === item.bank.id && (
          <div className="w-full">
            <AddFromBank
              bankTxn={item.bank} data={data} bankTxns={bankTxns}
              onMatchInstead={(txId) => { doMatch(item.bank.id, txId, "manual"); setAdding(null); }}
              onCancel={() => setAdding(null)}
              onAdd={(opts) => { doCreate(item.bank, opts); setAdding(null); }}
            />
          </div>
        )}
      </AskCard>
    );

    return (
      <AskCard key={a.key} amount={item.amount} date={item.date}
        title={`${item.direction === "credit" ? "Money came in" : "Money went out"} and the books have nothing for it: ${item.description}`}
        detail={item.pending ? "Still pending at the bank, so it may change." : "Add it to the books, or set it aside if it belongs to another ledger."}>
        <Btn onClick={() => setAdding(adding?.id === item.id ? null : item)}><Plus size={13} /> Add it to the books</Btn>
        <Btn tone="ghost" onClick={() => doIgnore(item.id)}>Set it aside</Btn>
        {adding?.id === item.id && (
          <div className="w-full">
            <AddFromBank
              bankTxn={item} data={data} bankTxns={bankTxns}
              onMatchInstead={(txId) => { doMatch(item.id, txId, "manual"); setAdding(null); }}
              onCancel={() => setAdding(null)}
              onAdd={(opts) => { doCreate(item, opts); setAdding(null); }}
            />
          </div>
        )}
      </AskCard>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 overflow-y-auto" style={{ background: P.overlay }} onClick={closeView}>
      <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg w-full max-w-3xl p-5 my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 style={{ fontFamily: SERIF }} className="text-xl">Consolidate</h3>
            {consolidation?.last && (
              <div style={{ color: P.faint }} className="text-xs">
                Last done {relDay(consolidation.last.createdAt)}. {runSummary(consolidation.last)}.
                {consolidation.settled ? " Nothing has moved since." : ""}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <GuideAnchor id="consolidate" onOpen={openGuide} label="What is this?" />
            <button onClick={closeView} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
          </div>
        </div>

        {/* ---- what I found ---- */}
        <p className="text-sm mb-1" style={{ color: P.text }}>{headline}</p>
        {connected && (
          <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs tabular-nums mb-4">
            bank {fmt(balance.bank)} · books {fmt(balance.book)} · difference{" "}
            <span style={{ color: Math.abs(balance.delta) < 0.01 ? P.credit : P.brass }}>{fmt(balance.delta)}</span>
          </div>
        )}

        {/* ---- the plan, written out before it runs ---- */}
        {plan.fix.count > 0 && !fixedSummary && (
          <div style={{ background: P.bg, border: `1px solid ${P.brass}` }} className="rounded-lg p-4 mb-4">
            <div style={{ color: P.brass, fontFamily: MONO }} className="text-xs uppercase tracking-wider mb-2">
              What I would do
            </div>
            <div className="space-y-1.5">
              {plan.fix.lines.map((l, i) => <PlanLine key={i}>{l}</PlanLine>)}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Btn onClick={runPlan} disabled={fixing}>
                {fixing ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Go ahead
              </Btn>
              <button onClick={() => setShowManual(true)} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">
                let me look at each one first
              </button>
            </div>
            <p style={{ color: P.faint }} className="text-xs mt-2">
              Pairing is reversible from this screen. Removing a duplicate deletes the extra copy, and every removal is written into the history below with the copy that was kept.
            </p>
          </div>
        )}

        {fixedSummary && (
          <div style={{ background: P.bg, border: `1px solid ${P.credit}` }} className="rounded-lg p-3 mb-4">
            <div style={{ color: P.credit }} className="text-sm">
              <Check size={13} className="inline mb-0.5" /> Done.{" "}
              {[
                fixedSummary.paired ? `${fixedSummary.paired} paired up` : null,
                fixedSummary.removed ? `${fixedSummary.removed} duplicate ${fixedSummary.removed === 1 ? "entry" : "entries"} removed` : null,
                fixedSummary.setAside ? `${fixedSummary.setAside} repeated bank ${fixedSummary.setAside === 1 ? "line" : "lines"} set aside` : null,
              ].filter(Boolean).join(", ") || "nothing needed changing"}.
            </div>
            <div style={{ color: P.faint }} className="text-xs mt-1">
              The difference against the bank does not go to zero from pairing. Pairing explains it, which is what makes the remainder meaningful.
            </div>
          </div>
        )}

        {/* ---- the questions, one at a time ----
             The pile is the thing that makes people close this screen, so only
             the question at the head of the queue is on screen. Everything
             behind it is a count, not a wall. The full list is still one tap
             away for anyone who would rather triage than answer. */}
        {asks.length > 0 && (
          <div className="mb-4">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <Label>Over to you</Label>
              <span style={{ fontFamily: MONO, color: P.faint }} className="text-xs tabular-nums">
                {showAllAsks
                  ? `${asks.length} left`
                  : `question ${Math.min(answered + 1, totalAsked)} of ${totalAsked}`}
              </span>
            </div>

            {/* how far along, without a number to decode */}
            {!showAllAsks && totalAsked > 1 && (
              <div className="flex gap-1 mb-3" aria-hidden="true">
                {Array.from({ length: Math.min(totalAsked, 24) }, (_, i) => (
                  <div key={i} className="h-1 flex-1 rounded-full"
                    style={{ background: i < answered ? P.brass : P.line }} />
                ))}
              </div>
            )}

            {showAllAsks ? (
              <div className="space-y-2">
                {asks.slice(0, 50).map(renderAsk)}
                {asks.length > 50 && (
                  <div style={{ color: P.faint }} className="text-xs">
                    and {asks.length - 50} more. Deal with these first and the rest will still be here.
                  </div>
                )}
              </div>
            ) : current ? (
              <>
                {onLastLap && (
                  <p style={{ color: P.faint }} className="text-xs mb-2">
                    That is everything else dealt with. These are the {deferred.length} you passed on.
                  </p>
                )}
                {renderAsk(current)}
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {undoable && (
                    <button onClick={undoLast} style={{ color: P.brass, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">
                      <ChevronLeft size={11} className="inline mb-0.5" /> undo the last {undoable.verb}
                    </button>
                  )}
                  {asks.length > 1 && (
                    <button onClick={skipCurrent} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">
                      {onLastLap ? "still not sure, next one" : "skip for now"}
                    </button>
                  )}
                  <button onClick={() => setShowAllAsks(true)} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2 ml-auto">
                    show all {asks.length} at once
                  </button>
                </div>
              </>
            ) : null}

            {showAllAsks && (
              <button onClick={() => setShowAllAsks(false)} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2 mt-3">
                back to one at a time
              </button>
            )}
          </div>
        )}

        {/* ---- the queue just emptied ----
             Only worth saying if there was a queue to empty: someone who opened
             a clean ledger already read that in the headline. */}
        {asks.length === 0 && answered > 0 && (
          <div style={{ background: P.bg, border: `1px solid ${P.credit}` }} className="rounded-lg p-3 mb-4">
            <div style={{ color: P.credit }} className="text-sm">
              <Check size={13} className="inline mb-0.5" /> That is all of them. You answered {answered} {answered === 1 ? "question" : "questions"}.
            </div>
            <div style={{ color: P.faint }} className="text-xs mt-1">
              Nothing else is waiting on you. Save below and the app stops asking until the bank or the books move.
            </div>
          </div>
        )}

        {/* ---- entries the bank has not cleared: information, not a task ---- */}
        {plan.uncleared.length > 0 && (
          <p style={{ color: P.faint }} className="text-xs mb-4">
            {plan.uncleared.length} {plan.uncleared.length === 1 ? "entry has" : "entries have"} not cleared the bank yet.
            That is normal for a cheque or a recent charge, and nothing needs doing about it.
          </p>
        )}

        {/* ---- the old two-column screen, for when you do want to drive ---- */}
        <button onClick={() => setShowManual(!showManual)} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">
          {showManual ? "hide" : "show"} everything line by line
        </button>

        {showManual && (
          <div className="mt-3">
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <Label>On the bank, not in the books ({plan.ask.unrecorded.length})</Label>
                <div className="space-y-2">
                  {plan.ask.unrecorded.length === 0 && (
                    <p style={{ color: P.faint }} className="text-sm py-3">Every bank line is accounted for.</p>
                  )}
                  {plan.ask.unrecorded.map((b) => (
                    <div key={b.id}>
                      <BankLine b={b} selected={pickedBank === b.id} onSelect={() => setPickedBank(pickedBank === b.id ? null : b.id)} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label>In the books, not on the bank ({plan.uncleared.length})</Label>
                <div className="space-y-2">
                  {plan.uncleared.length === 0 && (
                    <p style={{ color: P.faint }} className="text-sm py-3">Every entry has cleared.</p>
                  )}
                  {plan.uncleared.slice(0, 60).map((t) => (
                    <BookLine key={t.id} t={t} selected={pickedTx === t.id} onSelect={() => setPickedTx(pickedTx === t.id ? null : t.id)} />
                  ))}
                </div>
              </div>
            </div>

            {(pickedBank || pickedTx) && (
              <div style={{ background: P.bg, border: `1px solid ${P.brass}` }} className="rounded p-2 mb-4 flex items-center gap-3">
                <span style={{ color: P.muted }} className="text-xs flex-1">
                  {pickedBank && pickedTx ? "Pair these two." : "Now pick the other side."}
                </span>
                <Btn disabled={!pickedBank || !pickedTx} onClick={pairSelected}><Check size={13} /> Pair them</Btn>
                <button onClick={() => { setPickedBank(null); setPickedTx(null); }} style={{ color: P.faint }} className="text-xs">clear</button>
              </div>
            )}

            {(matched.length > 0 || ignored.length > 0) && (
              <div className="mb-4">
                <button onClick={() => setShowMatched(!showMatched)} style={{ color: P.brass, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2 underline-offset-2">
                  {showMatched ? "hide" : "show"} {matched.length} already paired, {ignored.length} set aside
                </button>
                {showMatched && (
                  <div className="space-y-1 mt-2">
                    {matched.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 text-xs" style={{ fontFamily: MONO, color: P.faint }}>
                        <Check size={11} style={{ color: P.credit }} className="shrink-0" />
                        <span className="flex-1 truncate">{b.date} {b.description} → {txById.get(b.matchedTxId)?.description || "entry"}</span>
                        <span className="tabular-nums shrink-0">{fmt(b.amount)}</span>
                        <button onClick={() => doUnmatch(b.id)} style={{ color: P.brass }}>undo</button>
                      </div>
                    ))}
                    {ignored.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 text-xs" style={{ fontFamily: MONO, color: P.faint }}>
                        <X size={11} className="shrink-0" />
                        <span className="flex-1 truncate">{b.date} {b.description}</span>
                        <span className="tabular-nums shrink-0">{fmt(b.amount)}</span>
                        <button onClick={() => actions.unignore(b.id)} style={{ color: P.brass }}>bring it back</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button onClick={onAnchorInstead} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2 underline-offset-2">
              or force the books to the bank balance, which sets the difference to zero without explaining it
            </button>
          </div>
        )}

        {/* ---- what past consolidations did, in sentences ---- */}
        {consolidation?.history?.length > 0 && (
          <div className="mt-4">
            <button onClick={() => setShowHistory(!showHistory)} style={{ color: P.brass, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2 underline-offset-2">
              <History size={11} className="inline mb-0.5" /> {showHistory ? "hide" : "show"} what past consolidations did
            </button>
            {showHistory && (
              <div className="mt-2 space-y-1">
                {consolidation.history.slice(0, 12).map((run) => (
                  <div key={run.id} style={{ border: `1px solid ${P.line}` }} className="rounded p-2">
                    <button onClick={() => setOpenRun(openRun === run.id ? null : run.id)} className="w-full text-left flex items-start gap-2">
                      <ChevronRight size={13} style={{ color: P.faint, transform: openRun === run.id ? "rotate(90deg)" : "none", transition: "transform .15s" }} className="shrink-0 mt-0.5" />
                      <span className="text-xs flex-1 min-w-0" style={{ color: P.muted }}>{runStory(run)}</span>
                    </button>
                    {openRun === run.id && (
                      <div className="mt-2 space-y-1 pl-5">
                        {(run.items || []).length === 0 && (
                          <div style={{ color: P.faint }} className="text-xs">{run.note || "Nothing was changed in this one."}</div>
                        )}
                        {(run.items || []).map((it, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs" style={{ color: P.faint }}>
                            <span className="shrink-0" style={{ color: RUN_ITEM_COLOR[it.kind] ? P[RUN_ITEM_COLOR[it.kind]] : P.faint }}>·</span>
                            <span className="flex-1 min-w-0">
                              {itemStory(it)}
                            </span>
                          </div>
                        ))}
                        <div style={{ color: P.faint }} className="text-xs pt-1">
                          Left open afterwards: {run.openBank} bank {run.openBank === 1 ? "line" : "lines"} and {run.openBooks} {run.openBooks === 1 ? "entry" : "entries"}.
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- close the run ----
             Pairing explains the difference but never closes it, so "the gap is
             zero" cannot be what tells the app you are finished. Recording the
             run is. Until the bank or the books move, nothing asks again. */}
        <div style={{ borderTop: `1px solid ${P.line}` }} className="pt-3 mt-4 flex items-center gap-3 flex-wrap">
          <div style={{ color: P.faint }} className="text-xs flex-1 min-w-[12rem]">
            {log.length
              ? `This time: ${runSummary({
                  matchedCount: count("matched"), createdCount: count("created"),
                  ignoredCount: count("ignored"), unmatchedCount: count("unmatched"),
                  duplicatesRemoved: log.filter((l) => l.kind === "duplicate").length,
                })}.`
              : consolidation?.settled
                ? "Already done, and nothing has moved since."
                : "Say you are finished and the app stops asking, until the bank or the books actually move."}
          </div>
          <Btn onClick={finish} disabled={!log.length && consolidation?.settled}>
            <Check size={13} /> {log.length ? "Save and close" : consolidation?.settled ? "Nothing to save" : "I am finished"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

const RUN_ITEM_COLOR = { matched: "credit", created: "brass", duplicate: "debit", ignored: "faint", unmatched: "muted" };

/** One line describing what a consolidation run did. */
function runSummary(run) {
  if (run.kind === "import") {
    return `statement imported, ${run.createdCount} ${run.createdCount === 1 ? "line" : "lines"} added to the books`;
  }
  const parts = [];
  if (run.matchedCount) parts.push(`${run.matchedCount} paired up`);
  if (run.createdCount) parts.push(`${run.createdCount} added to the books`);
  if (run.duplicatesRemoved) parts.push(`${run.duplicatesRemoved} duplicate ${run.duplicatesRemoved === 1 ? "group" : "groups"} removed`);
  if (run.ignoredCount) parts.push(`${run.ignoredCount} set aside`);
  if (run.unmatchedCount) parts.push(`${run.unmatchedCount} unpaired`);
  if (!parts.length) return run.kind === "import" ? "statement imported" : "looked through it, nothing needed changing";
  return parts.join(", ");
}

/* A run, read back as a sentence.
   The old history said things like "reviewed, nothing changed", which is true
   and tells you nothing. What someone wants months later is what happened to
   their money: what got joined up, what got deleted, and whether the books
   ended up closer to the bank than they started. */
function runStory(run) {
  const when = relDay(run.createdAt);
  const day = when.charAt(0).toUpperCase() + when.slice(1);
  if (run.kind === "import") {
    return `${day}: you imported a statement and ${run.createdCount || 0} ${run.createdCount === 1 ? "line" : "lines"} went into the books.`;
  }

  const did = [];
  if (run.matchedCount) did.push(`joined ${run.matchedCount} bank ${run.matchedCount === 1 ? "line" : "lines"} to ${run.matchedCount === 1 ? "the entry" : "the entries"} behind ${run.matchedCount === 1 ? "it" : "them"}`);
  if (run.createdCount) did.push(`added ${run.createdCount} ${run.createdCount === 1 ? "entry" : "entries"} the books had missed`);
  if (run.duplicatesRemoved) {
    const amt = Number(run.duplicateAmount) || 0;
    did.push(`removed ${run.duplicatesRemoved} thing${run.duplicatesRemoved === 1 ? "" : "s"} recorded twice${amt ? `, worth ${fmt(amt)}` : ""}`);
  }
  if (run.ignoredCount) did.push(`set ${run.ignoredCount} ${run.ignoredCount === 1 ? "line" : "lines"} aside as not yours`);
  if (run.unmatchedCount) did.push(`undid ${run.unmatchedCount} ${run.unmatchedCount === 1 ? "pairing" : "pairings"}`);

  const moved = run.deltaBefore != null && run.deltaAfter != null && Math.abs(run.deltaBefore - run.deltaAfter) >= 0.01
    ? ` The difference against the bank went from ${fmt(run.deltaBefore)} to ${fmt(run.deltaAfter)}.`
    : "";
  const left = (run.openBank || 0) + (run.openBooks || 0) === 0
    ? " Nothing was left open."
    : ` ${run.openBank || 0} bank ${run.openBank === 1 ? "line" : "lines"} and ${run.openBooks || 0} ${run.openBooks === 1 ? "entry" : "entries"} were still open at the end.`;

  if (!did.length) {
    return `${day}: you went through the books and everything was already right, so nothing changed.${left}`;
  }
  const list = did.length === 1 ? did[0] : `${did.slice(0, -1).join(", ")} and ${did[did.length - 1]}`;
  return `${day}: ${list}.${moved}${left}`;
}

/** One logged action, as a sentence rather than a table row. */
function itemStory(it) {
  const money = it.amount ? fmt(Number(it.amount)) : "";
  const what = it.description || "a line";
  const on = it.date ? ` on ${it.date}` : "";
  switch (it.kind) {
    case "matched": return `${money} ${what}${on}, ${it.detail || "paired with its entry"}.`;
    case "created": return `${money} ${what}${on} was not in the books, so it ${it.detail || "was added"}.`;
    case "duplicate": return `${what}${on}: ${it.detail || "duplicate removed"}${money ? `, ${money}` : ""}.`;
    case "ignored": return `${money} ${what}${on} was set aside, ${it.detail || "it will never have an entry"}.`;
    case "unmatched": return `${money} ${what}${on}: ${it.detail || "pairing undone"}.`;
    default: return `${what}${on} ${it.detail || ""}`.trim() + ".";
  }
}

/** Inline form to turn a bank line into a ledger entry. Amount, date and
 *  description come from the bank; only the coding is a decision. */
function AddFromBank({ bankTxn, data, bankTxns = [], onAdd, onMatchInstead, onCancel }) {
  const type = bankTxn.direction === "credit" ? "income" : "expense";
  const cats = data.categories[type] || [];
  const [category, setCategory] = useState(cats[0]?.name || "Other");
  const [subcategory, setSubcategory] = useState("");
  const subs = cats.find((c) => c.name === category)?.subs || [];
  // The matcher only looks a few days out, so an entry dated a fortnight from
  // the bank line never surfaces as a suggestion — and adding this line anyway
  // is exactly how the books end up with two of everything.
  const already = useMemo(
    () => likelyAlreadyInBooks(bankTxn, data.transactions, bankTxns),
    [bankTxn, data.transactions, bankTxns],
  );

  return (
    <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded p-2 mb-2">
      {already && (
        <div style={{ border: `1px solid ${P.brass}` }} className="rounded p-2 mb-2">
          <div style={{ color: P.brass, fontFamily: MONO }} className="text-xs uppercase tracking-wider mb-1">
            <AlertTriangle size={11} className="inline mb-0.5" /> possibly already recorded
          </div>
          <div className="text-xs" style={{ color: P.muted }}>
            {already.tx.date} · {already.tx.description || already.tx.category} · {fmt(already.tx.amount)}
            {" · "}same amount {already.gap === 0 ? "on the same day" : `${already.gap} ${already.gap === 1 ? "day" : "days"} away`}.
            Adding this line would record it twice.
          </div>
          {onMatchInstead && (
            <div className="mt-2">
              <Btn tone="ghost" onClick={() => onMatchInstead(already.tx.id)}>
                <Check size={13} /> Match to it instead
              </Btn>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <Label>Category</Label>
          <Select value={category} onChange={(e) => { setCategory(e.target.value); setSubcategory(""); }}>
            {cats.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </Select>
        </div>
        <div>
          <Label>Subcategory</Label>
          <Select value={subcategory} onChange={(e) => setSubcategory(e.target.value)} disabled={!subs.length}>
            <option value="">{subs.length ? "·" : "none"}</option>
            {subs.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Btn onClick={() => onAdd({ category, subcategory })}>
          <Plus size={13} /> Add {fmt(bankTxn.amount)} {type === "income" ? "in" : "out"}
        </Btn>
        <Btn tone="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

/* ================= statement import & reconciliation ================= */
// Pasted / uploaded statements only. Bank-feed lines no longer come through
// here — they are stored as bank_transactions and reconciled in MatchView.
function ImportModal({ data, addSub, onImport, onClose }) {
  const [step, setStep] = useState("input"); // input | review
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]); // parsed + { checked, dup }
  const [ending, setEnding] = useState(null); // { amount, date } from the statement
  const [anchorToo, setAnchorToo] = useState(true);
  const [imported, setImported] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* a parsed line is a duplicate if the ledger already has an entry with the
     same amount + direction within 3 days of it */
  const markDuplicates = (parsed) => {
    const day = 86400000;
    return parsed.map((r) => {
      const dup = data.transactions.some((t) => {
        if (Math.abs(t.amount - r.amount) > 0.005) return false;
        if (t.type !== (r.direction === "credit" ? "income" : "expense")) return false;
        if (!t.date || !r.date) return false;
        return Math.abs(new Date(t.date) - new Date(r.date)) <= 3 * day;
      });
      return { ...r, dup, checked: !dup };
    });
  };

  const runParse = async (content) => {
    setBusy(true);
    setErr("");
    try {
      const out = await askClaude(content, 8000);
      const parsed = (out.transactions || [])
        .map((t) => ({
          date: t.date,
          amount: Math.abs(Number(t.amount)) || 0,
          direction: t.direction === "credit" ? "credit" : "debit",
          description: t.description || "·",
          category: t.category,
          subcategory: t.subcategory || "",
          account: t.account === "personal" ? "personal" : "business",
          recurrence: t.recurrence === "recurring" ? "recurring" : "once",
        }))
        .filter((t) => t.amount > 0 && t.date);
      if (!parsed.length) throw new Error("no transactions found");
      setRows(markDuplicates(parsed));
      setEnding(
        out.endingBalance != null && !Number.isNaN(Number(out.endingBalance))
          ? { amount: Number(out.endingBalance), date: out.endingBalanceDate || parsed.reduce((m, t) => (t.date > m ? t.date : m), "") || todayStr() }
          : null
      );
      if (out.note) setErr(out.note);
      setStep("review");
    } catch (e) {
      setErr("Couldn't read that statement. Try pasting the transaction lines as text, or import one month at a time.");
    }
    setBusy(false);
  };

  const handlePaste = () => {
    const text = pasted.trim();
    if (!text) return;
    runParse([{ type: "text", text: `${statementPrompt(data.categories, data.ledger.name)}\n\nSTATEMENT TEXT:\n${text.slice(0, 60000)}` }]);
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setErr(`That file is ${(file.size / 1048576).toFixed(1)} MB, max 8 MB. Export a smaller range or paste the text.`);
      return;
    }
    const name = file.name || "";
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
    const isText = /\.(csv|txt|tsv)$/i.test(name) || (file.type || "").startsWith("text/") || file.type === "text/csv";
    try {
      if (isText) {
        const text = await file.text();
        runParse([{ type: "text", text: `${statementPrompt(data.categories, data.ledger.name)}\n\nSTATEMENT TEXT:\n${text.slice(0, 60000)}` }]);
      } else {
        const b64 = await fileToB64(file);
        const block = isPdf
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
          : { type: "image", source: { type: "base64", media_type: file.type || "image/png", data: b64 } };
        runParse([block, { type: "text", text: statementPrompt(data.categories, data.ledger.name) }]);
      }
    } catch {
      setErr("Couldn't read that file from your device, try again or paste the text.");
    }
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.checked);
  const dupCount = rows.filter((r) => r.dup).length;
  const netSelected = selected.reduce((s, r) => s + (r.direction === "credit" ? r.amount : -r.amount), 0);

  const doImport = () => {
    // Without this, a double-click (or a slow network retry) fires onImport
    // twice, and every checked row goes in a second time as brand-new rows —
    // the app has no server-side dedupe, so that's a silent, exact-copy
    // duplicate import worth however much the statement was.
    if (imported) return;
    setImported(true);
    const txs = selected.map((r) => {
      const type = r.direction === "credit" ? "income" : "expense";
      const list = data.categories[type].map((c) => c.name);
      return {
        date: r.date,
        amount: r.amount,
        type,
        category: list.includes(r.category) ? r.category : list[0],
        subcategory: r.subcategory || undefined,
        description: r.description,
        account: data.ledger.kind === "personal" ? "personal" : "business",
        recurrence: r.recurrence,
      };
    });
    onImport(txs, anchorToo && ending ? { amount: ending.amount, date: ending.date } : null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div
        style={{ background: P.surface, border: `1px solid ${P.line}` }}
        className="rounded-lg w-full max-w-2xl max-h-full flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3" style={{ borderBottom: `1px solid ${P.line}` }}>
          <h3 style={{ fontFamily: SERIF }} className="text-lg">Import a statement</h3>
          <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
        </div>

        {step === "input" && (
          <div className="p-5 space-y-3 overflow-y-auto">
            <p style={{ color: P.muted }} className="text-sm">
              Paste the purchases and deposits straight from your online banking, any format, dates and amounts included ,
              or upload the statement itself (PDF, CSV, or a screenshot). Every line gets read, matched against what's
              already in the ledger, and queued for your review before anything is saved.
            </p>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"Mar 10  MORTGAGE PAYMENT        -1,200.00\nMar 10  VERCEL INC              -70.00\nMar 02  PAYROLL DEPOSIT       +4,709.00\n…"}
              rows={8}
              style={{ background: P.bg, border: `1px solid ${P.line}`, color: P.text, fontFamily: MONO }}
              className="w-full rounded p-3 text-xs outline-none"
            />
            <div className="flex items-center gap-3">
              <Btn onClick={handlePaste} disabled={busy || !pasted.trim()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Read pasted text
              </Btn>
              <span style={{ color: P.faint, fontFamily: MONO }} className="text-xs">or</span>
              <input ref={fileRef} type="file" accept=".pdf,.csv,.txt,.tsv,image/*,application/pdf,text/csv" className="hidden"
                onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ""; }} />
              <Btn tone="ghost" onClick={() => fileRef.current.click()} disabled={busy}>
                <FileText size={14} /> Upload statement
              </Btn>
            </div>
            {busy && (
              <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> reading every line… longer statements take a moment
              </div>
            )}
            {err && <p style={{ color: P.debit }} className="text-xs">{err}</p>}
          </div>
        )}

        {step === "review" && (
          <>
            <div className="px-5 py-3 space-y-2" style={{ borderBottom: `1px solid ${P.line}` }}>
              <p style={{ color: P.muted }} className="text-sm">
                Found <span style={{ color: P.text }}>{rows.length}</span> lines
                {dupCount > 0 && <> · <span style={{ color: P.brass }}>{dupCount} look like they're already in the ledger</span> (unchecked, tick any that aren't actually duplicates)</>}.
              </p>
              {err && <p style={{ color: P.faint }} className="text-xs">{err}</p>}
              {ending && (
                <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: P.muted }}>
                  <input type="checkbox" checked={anchorToo} onChange={(e) => setAnchorToo(e.target.checked)} className="mt-0.5" />
                  <span>
                    Also anchor the balance to the statement's ending balance:{" "}
                    <span style={{ fontFamily: MONO, color: P.brass }}>{fmt(ending.amount)}</span> on{" "}
                    <span style={{ fontFamily: MONO }}>{ending.date}</span>, after this, Balance to date matches the bank exactly.
                  </span>
                </label>
              )}
            </div>
            <div className="overflow-y-auto px-5 py-2" style={{ maxHeight: "45vh" }}>
              <div className="divide-y" style={{ borderColor: P.line }}>
                {rows.map((r, i) => {
                  const type = r.direction === "credit" ? "income" : "expense";
                  const cats = data.categories[type].map((c) => c.name);
                  return (
                    <div key={i} className="flex items-center gap-2 py-2" style={{ borderColor: P.line, opacity: r.checked ? 1 : 0.45 }}>
                      <input type="checkbox" checked={r.checked} onChange={(e) => setRow(i, { checked: e.target.checked })} />
                      <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs w-12 shrink-0">{r.date?.slice(5)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{r.description}</div>
                        {r.dup && <div style={{ color: P.brass, fontFamily: MONO }} className="text-xs">possible duplicate</div>}
                      </div>
                      <select
                        value={cats.includes(r.category) ? r.category : cats[0]}
                        onChange={(e) => setRow(i, { category: e.target.value, subcategory: "" })}
                        style={{ background: P.bg, border: `1px solid ${P.line}`, color: P.text }}
                        className="rounded px-1 py-0.5 text-xs w-28"
                      >
                        {cats.map((c) => <option key={c}>{c}</option>)}
                      </select>
                      {subsFor(data, type, cats.includes(r.category) ? r.category : cats[0]).length > 0 && (
                        <SubPicker compact data={data} type={type}
                          category={cats.includes(r.category) ? r.category : cats[0]}
                          value={r.subcategory} onChange={(v) => setRow(i, { subcategory: v })} addSub={addSub} />
                      )}
                      <button
                        onClick={() => setRow(i, { account: r.account === "business" ? "personal" : "business" })}
                        title="Toggle business / personal"
                        style={{ fontFamily: MONO, color: P.muted, border: `1px solid ${P.line}` }}
                        className="rounded px-1.5 py-0.5 text-xs w-9 text-center"
                      >
                        {r.account === "business" ? "B" : "P"}
                      </button>
                      <div style={{ fontFamily: MONO, color: r.direction === "credit" ? P.credit : P.debit }} className="text-sm tabular-nums w-24 text-right">
                        {r.direction === "credit" ? "+" : "−"}{fmt(r.amount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="px-5 py-3 flex items-center gap-3" style={{ borderTop: `1px solid ${P.line}` }}>
              <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs flex-1">
                importing {selected.length} · net <span style={{ color: netSelected >= 0 ? P.credit : P.debit }}>{fmt(netSelected)}</span>
              </div>
              <Btn tone="ghost" onClick={() => { setStep("input"); setErr(""); }}>Back</Btn>
              <Btn onClick={doImport} disabled={imported || (selected.length === 0 && !(anchorToo && ending))}>
                <Check size={14} /> Import{anchorToo && ending ? " & anchor" : ""}
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================= signature: the ledger line ================= */
function LedgerLine({ sums, balance, openBooks, creditsLeft, onCredits, onReconcile }) {
  const max = Math.max(sums.inc, sums.exp, 1);
  const fromBank = balance.source === "bank";
  return (
    <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
      <div className="flex flex-wrap justify-between gap-4 mb-3">
        <Stat label="Money in" value={fmt(sums.inc)} color={P.credit} />
        <Stat label="Money out" value={fmt(sums.exp)} color={P.debit} />
        <Stat label="Net this month" value={fmt(sums.net)} color={sums.net >= 0 ? P.credit : P.debit} />
        <button onClick={onReconcile} className="text-left" title={fromBank ? "Bank balance · tap to align books" : "Set or correct the balance against your real accounts"}>
          <Label>{fromBank ? "Balance to date · bank" : "Balance to date · fix"}</Label>
          <div style={{ fontFamily: MONO, color: P.brass }} className="text-xl tabular-nums underline decoration-dotted underline-offset-4" >
            {balance.beforeAnchor ? "·" : fmt(balance.value)}
          </div>
        </button>
        {creditsLeft !== null && (
          <button onClick={onCredits} className="text-left" title="Non-cash credits remaining across all pools, tap to manage">
            <Label>Credits left</Label>
            <div style={{ fontFamily: MONO, color: creditsLeft > 0 ? P.credit : P.debit }} className="text-xl tabular-nums underline decoration-dotted underline-offset-4">
              {fmt(creditsLeft)}
            </div>
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div style={{ fontFamily: MONO, color: P.credit }} className="text-xs w-8">IN</div>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: P.bg }}>
            <div style={{ width: `${(sums.inc / max) * 100}%`, background: P.credit }} className="h-full" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ fontFamily: MONO, color: P.debit }} className="text-xs w-8">OUT</div>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: P.bg }}>
            <div style={{ width: `${(sums.exp / max) * 100}%`, background: P.debit }} className="h-full" />
          </div>
        </div>
      </div>
      {(openBooks.ar > 0 || openBooks.ap > 0) && (
        <div style={{ fontFamily: MONO, color: P.faint, borderTop: `1px solid ${P.line}` }} className="text-xs mt-3 pt-2 flex flex-wrap gap-x-4">
          <span>open books:</span>
          {openBooks.ar > 0 && <span style={{ color: P.credit }}>+{fmt(openBooks.ar)} owed to you</span>}
          {openBooks.ap > 0 && <span style={{ color: P.debit }}>−{fmt(openBooks.ap)} you owe</span>}
          <span>settle in AR / AP to count them</span>
        </div>
      )}
      <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs mt-2">
        {fromBank
          ? `Bank as of ${balance.balanceAsOf ? String(balance.balanceAsOf).slice(0, 10) : "today"} · books ${fmt(balance.book)}${balance.delta != null && Math.abs(balance.delta) >= 0.01 ? ` · Δ ${fmt(balance.delta)}` : " · matched"} · tap to re-anchor`
          : balance.beforeAnchor
            ? `this month ends before your balance anchor (${balance.anchorDate}), no balance shown`
            : `anchored: ${fmt(balance.anchorAmount)} on ${balance.anchorDate} · tap the balance to correct it`}
      </div>
    </div>
  );
}

const Stat = ({ label, value, color }) => (
  <div>
    <Label>{label}</Label>
    <div style={{ fontFamily: MONO, color }} className="text-xl tabular-nums">{value}</div>
  </div>
);

/* ================= Overview ================= */
function Overview({ data, monthTx, sums, setPlanned, month, insights = [], onAsk }) {
  const [drill, setDrill] = useState(null); // { type, category }
  const rows = (type) =>
    data.categories[type].map((c) => {
      const actual = monthTx.filter((t) => t.type === type && t.category === c.name).reduce((s, t) => s + t.amount, 0);
      return { ...c, actual, diff: type === "expense" ? c.planned - actual : actual - c.planned };
    });
  const expRows = rows("expense").filter((r) => r.planned || r.actual);
  const incRows = rows("income").filter((r) => r.planned || r.actual);
  const zeroExp = rows("expense").filter((r) => !r.planned && !r.actual);

  return (
    <>
      <InsightsStrip insights={insights} onAsk={onAsk} />
      <div className="grid md:grid-cols-2 gap-6">
        <BudgetTable title="Expenses" rows={expRows} extra={zeroExp} type="expense" monthTx={monthTx} setPlanned={setPlanned} onDrill={(cat) => setDrill({ type: "expense", category: cat })} />
        <BudgetTable title="Income" rows={incRows} extra={[]} type="income" monthTx={monthTx} setPlanned={setPlanned} onDrill={(cat) => setDrill({ type: "income", category: cat })} />
        {drill && <CategoryDrill drill={drill} monthTx={monthTx} month={month} onClose={() => setDrill(null)} />}
      </div>
    </>
  );
}

/* ---- what the agent noticed without being asked ----
   Computed locally on every render of the ledger (see lib/insights.js), so it
   costs nothing and is never stale. Tapping one hands that exact question to
   the agent, which goes and gets the entries behind it. */
function InsightsStrip({ insights = [], onAsk }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(window.sessionStorage.getItem("insights:dismissed") || "[]"); }
    catch { return []; }
  });
  const live = insights.filter((i) => !dismissed.includes(i.id));
  if (!live.length) return null;

  const drop = (id) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try { window.sessionStorage.setItem("insights:dismissed", JSON.stringify(next)); } catch { /* private mode */ }
  };

  const shown = open ? live : live.slice(0, 2);
  const TONE = {
    alert: { color: P.debit, Icon: AlertTriangle },
    warn: { color: P.brass, Icon: AlertTriangle },
    info: { color: P.faint, Icon: Info },
  };

  return (
    <section className="mb-6">
      <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs uppercase tracking-widest mb-2 flex items-center gap-1.5">
        <Sparkles size={11} style={{ color: P.brass }} /> Worth a look
      </div>
      <div className="space-y-2">
        {shown.map((i) => {
          const { color, Icon } = TONE[i.severity] || TONE.info;
          return (
            <div
              key={i.id}
              style={{ background: P.surface, border: `1px solid ${i.severity === "alert" ? color + "66" : P.line}` }}
              className="rounded-lg p-3 flex items-start gap-2.5"
            >
              <Icon size={14} style={{ color, flexShrink: 0, marginTop: 2 }} />
              <div className="flex-1 min-w-0">
                <div style={{ color: P.text }} className="text-sm">{i.title}</div>
                <p style={{ color: P.muted }} className="text-xs mt-0.5">{i.detail}</p>
                <div className="flex gap-1.5 mt-2">
                  <Btn tone="ghost" onClick={() => onAsk?.(i.ask)}>
                    <MessageSquare size={12} /> Look into it
                  </Btn>
                  <button
                    type="button"
                    onClick={() => drop(i.id)}
                    style={{ color: P.faint, fontFamily: MONO }}
                    className="text-xs px-2"
                  >
                    dismiss
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {live.length > 2 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{ color: P.faint, fontFamily: MONO }}
          className="text-xs mt-2 inline-flex items-center gap-1"
        >
          <ChevronRight size={11} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
          {open ? "show less" : `${live.length - 2} more`}
        </button>
      )}
    </section>
  );
}

/* ---- drill-down: every entry behind a category line ---- */
function CategoryDrill({ drill, monthTx, month, onClose }) {
  const [sortBy, setSortBy] = useState("date"); // date | amount
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = monthTx
    .filter((t) => t.type === drill.type && t.category === drill.category)
    .filter((t) => !q || t.description?.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sortBy === "date" ? (b.date || "").localeCompare(a.date || "") : b.amount - a.amount));
  const total = list.reduce((s, t) => s + t.amount, 0);
  const tone = drill.type === "expense" ? P.debit : P.credit;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div
        style={{ background: P.surface, border: `1px solid ${P.line}` }}
        className="rounded-lg w-full max-w-xl max-h-full flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${P.line}` }}>
          <div className="flex-1 min-w-0">
            <h3 style={{ fontFamily: SERIF }} className="text-lg truncate">{drill.category}</h3>
            <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
              {monthLabel(month)} · {list.length} {list.length === 1 ? "entry" : "entries"} ·{" "}
              <span style={{ color: tone }}>{fmt(total)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-2" style={{ borderBottom: `1px solid ${P.line}` }}>
          <div className="flex gap-1">
            {[["date", "by date"], ["amount", "by amount"]].map(([k, label]) => (
              <button key={k} onClick={() => setSortBy(k)}
                style={{ fontFamily: MONO, color: sortBy === k ? P.brass : P.faint, border: `1px solid ${sortBy === k ? P.brass : P.line}` }}
                className="rounded px-2 py-0.5 text-xs">
                {label}
              </button>
            ))}
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search…"
            style={{ background: P.bg, border: `1px solid ${P.line}`, color: P.text, fontFamily: MONO }}
            className="rounded px-2 py-0.5 text-xs flex-1 outline-none"
            
          />
        </div>

        <div className="overflow-y-auto p-4" style={{ maxHeight: "55vh" }}>
          {list.length === 0 ? (
            <p style={{ color: P.faint }} className="text-sm py-6 text-center">No matching entries.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: P.line }}>
              {list.map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-2" style={{ borderColor: P.line }}>
                  <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs w-12 shrink-0">{t.date?.slice(5)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{t.description}</div>
                    <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
                      {isRec(t) && <RecMark />} {t.transferId ? "transferred · " : ""}{t.subcategory ? t.subcategory + " · " : ""}{isRec(t) ? " · recurring" : ""}{t.attachmentId ? " · 📎 filed" : ""}
                    </div>
                  </div>
                  <div style={{ fontFamily: MONO, color: tone }} className="text-sm tabular-nums">
                    {drill.type === "income" ? "+" : "−"}{fmt(t.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BudgetTable({ title, rows, extra, type, monthTx, setPlanned, onDrill }) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(null); // category name whose sub-breakdown is open

  const subBreakdown = (catName) => {
    const groups = {};
    monthTx
      .filter((t) => t.type === type && t.category === catName)
      .forEach((t) => {
        const key = t.subcategory || "unassigned";
        groups[key] = (groups[key] || 0) + t.amount;
      });
    return Object.entries(groups).sort((a, b) => b[1] - a[1]);
  };
  const list = showAll ? [...rows, ...extra] : rows;
  const tone = type === "expense" ? P.debit : P.credit;
  return (
    <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
      <div className="flex justify-between items-baseline mb-3">
        <h2 style={{ fontFamily: SERIF }} className="text-lg">{title}</h2>
        <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">planned / actual</div>
      </div>
      <div className="space-y-3">
        {list.map((r) => {
          const pct = r.planned > 0 ? Math.min((r.actual / r.planned) * 100, 100) : r.actual > 0 ? 100 : 0;
          const over = type === "expense" && r.actual > r.planned;
          return (
            <div key={r.name}>
              <div className="flex justify-between text-sm mb-1 gap-2">
                <span className="flex items-center gap-1 min-w-0">
                  {((r.subs || []).length > 0 || subBreakdown(r.name).length > 1) && r.actual > 0 && (
                    <button
                      onClick={() => setExpanded(expanded === r.name ? null : r.name)}
                      title="Show subcategory breakdown"
                      style={{ color: expanded === r.name ? P.brass : P.faint, fontFamily: MONO }}
                      className="shrink-0"
                    >
                      {expanded === r.name ? "▾" : "▸"}
                    </button>
                  )}
                  <button
                    onClick={() => r.actual > 0 && onDrill(r.name)}
                    title={r.actual > 0 ? "View the entries behind this line" : undefined}
                    style={{ color: P.text, cursor: r.actual > 0 ? "pointer" : "default", textDecorationColor: P.faint }}
                    className={"truncate text-left " + (r.actual > 0 ? "underline decoration-dotted underline-offset-2" : "")}
                  >
                    {r.name}
                  </button>
                </span>
                <span style={{ fontFamily: MONO }} className="tabular-nums flex items-center gap-1">
                  {editing === r.name ? (
                    <input
                      autoFocus
                      defaultValue={r.planned}
                      onBlur={(e) => { setPlanned(type, r.name, parseFloat(e.target.value) || 0); setEditing(null); }}
                      onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                      style={{ background: P.bg, border: `1px solid ${P.brass}`, color: P.text, width: 70 }}
                      className="rounded px-1 text-right text-sm"
                    />
                  ) : (
                    <button onClick={() => setEditing(r.name)} style={{ color: P.muted }} title="Edit planned amount">
                      {fmt0(r.planned)}
                    </button>
                  )}
                  <span style={{ color: P.faint }}>/</span>
                  <span style={{ color: over ? P.debit : P.text }}>{fmt0(r.actual)}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: P.bg }}>
                <div style={{ width: `${pct}%`, background: over ? P.debit : tone, opacity: over ? 1 : 0.75 }} className="h-full" />
              </div>
              {expanded === r.name && (
                <div className="mt-1.5 pl-4 space-y-1" style={{ borderLeft: `2px solid ${P.line}` }}>
                  {subBreakdown(r.name).map(([sub, v]) => {
                    const subMax = subBreakdown(r.name)[0]?.[1] || 1;
                    return (
                      <div key={sub} className="flex items-center gap-2">
                        <span style={{ fontFamily: MONO, color: sub === "unassigned" ? P.faint : P.muted }} className="text-xs w-32 truncate">{sub}</span>
                        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: P.bg }}>
                          <div style={{ width: `${(v / subMax) * 100}%`, background: tone, opacity: 0.5 }} className="h-full" />
                        </div>
                        <span style={{ fontFamily: MONO, color: P.muted }} className="text-xs tabular-nums w-16 text-right">{fmt0(v)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {extra.length > 0 && (
        <button onClick={() => setShowAll(!showAll)} style={{ color: P.faint, fontFamily: MONO }} className="text-xs mt-3">
          {showAll ? "hide" : `+ ${extra.length} unused categories`}
        </button>
      )}
      <p style={{ color: P.faint }} className="text-xs mt-3">Tap a planned amount to change it · tap a category name to see the entries behind it.</p>
    </section>
  );
}

/* ================= Brasstally chat (capture + the finance agent) =================
   Two modes share one transcript. Capture reads a receipt into a draft entry.
   Ask runs the agent in lib/agent.js, which works the ledger with tools and can
   propose changes — never make them. */

// What each tool is doing, in words, for the activity line under a question.
const TOOL_LABEL = {
  ledger_overview: "reading the ledger",
  list_transactions: "searching transactions",
  category_variance: "checking budget variance",
  monthly_trend: "comparing months",
  category_shifts: "looking for what changed",
  obligations: "checking AR / AP",
  balance_breakdown: "breaking down the balance",
  find_duplicates: "scanning for duplicates",
  consolidation_history: "reading past consolidations",
  recurring_costs: "listing recurring costs",
  cash_forecast: "projecting cash forward",
  data_quality: "checking for bookkeeping gaps",
  propose_transaction: "drafting an entry",
  propose_obligation: "drafting a receivable / payable",
  propose_settle: "drafting a settlement",
  propose_budget: "drafting a budget",
  propose_anchor: "drafting a re-anchor",
  open_view: "finding the right screen",
};

const DEFAULT_ASKS = [
  "Where did my money go this month?",
  "What's my cash position over the next 60 days?",
  "Is anything in my books off?",
];

function Capture({
  data, addTx, addAR, addSub, month, embedded, balance, openBooks, recon, consolidation, bankConns,
  insights = [], seed, onSeedUsed, guide, onGuideUsed, nudge, onNudgeUsed, apply, onGo,
}) {
  // A gap that's already been consolidated isn't news — opening the panel on a
  // ledger you reconciled yesterday should not greet you with it again.
  const drift = balance?.source === "bank" && balance.delta != null
    && Math.abs(balance.delta) >= 0.01 && !consolidation?.settled;
  const opener = drift
    ? `Bank is ${fmt(balance.bank)}, books are ${fmt(balance.book)} (Δ ${fmt(balance.delta)}). Ask me to walk through it and I'll go through the entries. You can also drop a receipt or type an entry anytime.`
    : "Drop a receipt or invoice, type something like “paid Vercel $70 today”, or ask me about the books. I can dig through your transactions, budgets, AR/AP, and cash to answer.";
  const [mode, setMode] = useState(drift ? "help" : "capture"); // capture | help
  const [msgs, setMsgs] = useState([{ role: "assistant", text: opener }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Which section's brief the agent is carrying, if any. Cleared when the user
  // moves on to something the guide has nothing to say about.
  const [guideId, setGuideId] = useState(null);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const greetedDrift = useRef(false);
  // The agent's own message history, in Anthropic shape. Separate from `msgs`,
  // which is what the panel draws — tool traffic belongs in one and not the other.
  const convo = useRef([]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  // Surface a fresh drift notice once when balances first disagree after mount
  useEffect(() => {
    if (!drift || greetedDrift.current) return;
    greetedDrift.current = true;
    setMode("help");
  }, [drift]);

  const push = (m) => setMsgs((prev) => [...prev, m]);

  // Tool calls collapse into a single activity line rather than one bubble each.
  const pushStep = (name) =>
    setMsgs((prev) => {
      const last = prev[prev.length - 1];
      if (last?.steps) return [...prev.slice(0, -1), { ...last, steps: [...last.steps, name] }];
      return [...prev, { role: "assistant", steps: [name] }];
    });

  const runTurn = async (question, useGuide = guideId) => {
    setMode("help");
    setBusy(true);
    const before = convo.current;
    const history = trimHistory([...before, { role: "user", content: question }]);
    try {
      const { text, messages } = await runAgent({
        history,
        // Rebuilt every turn from live state, so the agent reads what's on screen.
        ctx: { data, balance, month, bankConns, recon, consolidation, guide: useGuide },
        onEvent: (ev) => {
          if (ev.type === "tool") pushStep(ev.name);
          else if (ev.type === "text") push({ role: "assistant", text: ev.text });
          else if (ev.type === "proposal") push({ role: "assistant", proposal: ev.proposal });
          else if (ev.type === "link") push({ role: "assistant", link: ev.link });
        },
      });
      convo.current = trimHistory(messages);
      if (text) push({ role: "assistant", text });
    } catch (e) {
      convo.current = before; // drop the failed turn so the next one isn't malformed
      push({
        role: "assistant",
        text: `${friendlyError(e)}. From what's on screen: ${
          balance?.source === "bank"
            ? `bank ${fmt(balance.bank)} vs books ${fmt(balance.book)} (Δ ${fmt(balance.delta)})`
            : `balance ${fmt(balance?.book ?? 0)}`
        }, ${fmt(openBooks?.ar || 0)} owed to you, ${fmt(openBooks?.ap || 0)} owed out.`,
        link: drift ? { view: "reconcile", label: "Open consolidate" } : null,
      });
    }
    setBusy(false);
  };

  // `withGuide` is passed explicitly by the guide's own step buttons: setState
  // has not flushed by the time the handler calls this, so reading guideId off
  // state here would send the first question of a guide without its brief.
  const ask = (question, withGuide) => {
    push({ role: "user", text: question });
    runTurn(question, withGuide === undefined ? guideId : withGuide);
  };

  // A question handed over from an insight card on the Overview tab.
  useEffect(() => {
    if (!seed?.question) return;
    onSeedUsed?.();
    if (busy) return;
    ask(seed.question);
  }, [seed?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- a section handing over its brief ----
     Nothing is sent upstream yet. The guide introduces itself with the opener
     written for that section and offers the questions people actually have
     there, so the first turn costs nothing and still lands somewhere useful. */
  useEffect(() => {
    if (!guide?.id || !GUIDES[guide.id]) return;
    onGuideUsed?.();
    setGuideId(guide.id);
    setMode("help");
    push({ role: "assistant", text: guideOpener(guide.id), guideId: guide.id });
  }, [guide?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- money landed, so say so before being asked ----
     The whole point of a proactive message is that it arrives without a
     question. It states what came in, then puts the payments that are actually
     due in front of the user with one tap to settle each. */
  useEffect(() => {
    if (!nudge?.received?.length) return;
    onNudgeUsed?.();
    const due = (data.payables || [])
      .filter((p) => p.status === "open")
      .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")))
      .slice(0, 3);
    const one = nudge.received.length === 1 ? nudge.received[0] : null;
    push({
      role: "assistant",
      text: one
        ? `Heads up, ${fmt(one.amount)} came in from ${one.description} on ${one.date}.`
        : `Heads up, ${fmt(nudge.total)} came in across ${nudge.received.length} payments.`,
      nudge: { received: nudge.received, due },
    });
    setMode("help");
  }, [nudge?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = async (file) => {
    if (!file) return;
    setMode("capture");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (file.size > MAX_FILE_BYTES) {
      push({ role: "assistant", text: `That file is ${(file.size / 1048576).toFixed(1)} MB, I can file attachments up to 8 MB. Try exporting a smaller PDF or a screenshot of it.` });
      return;
    }
    let b64;
    try {
      b64 = await fileToB64(file);
    } catch {
      push({ role: "assistant", text: "I couldn't read that file from your device. Try picking it again." });
      return;
    }
    if (isPdf) {
      push({ role: "user", pdfName: file.name, text: "" });
    } else {
      push({ role: "user", image: URL.createObjectURL(file), text: "" });
    }
    setBusy(true);
    const att = { name: file.name || (isPdf ? "invoice.pdf" : "receipt.png"), type: isPdf ? "application/pdf" : (file.type || "image/png"), data: b64, file };
    try {
      const block = isPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: att.type, data: b64 } };
      const raw = await askClaude(
        [block, { type: "text", text: extractionPrompt(data.categories, data.ledger.name) }],
        { maxTokens: 2048, schema: extractionSchema(data.categories) }
      );
      const draft = normalizeDraft(raw, { categories: data.categories, ledgerKind: data.ledger.kind });
      push({ role: "assistant", text: draft.note || "Here's what I read, confirm or adjust:", draft, att });
    } catch (e) {
      push({ role: "assistant", text: `I couldn't read that one. ${friendlyError(e)}. Try a clearer file, or type the details (e.g. “Figma $45 on March 10”).` });
    }
    setBusy(false);
  };

  // Capture mode files what you type; Ask mode answers it. The one crossover
  // that matters is a question typed into Capture — "did I already pay Vercel?"
  // should never become a $0 draft entry.
  const looksLikeQuestion = (text) =>
    /\?/.test(text) ||
    /^\s*(why|how|what|when|which|where|who|should|can|could|would|do i|did i|am i|is my|are my|show|list|tell|explain|compare|find|check|help)\b/i.test(text);

  const handleText = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    push({ role: "user", text });
    if (mode === "help" || looksLikeQuestion(text)) {
      await runTurn(text);
      return;
    }
    setMode("capture");
    setBusy(true);
    // Parsed on-device first. It costs nothing, and it's the draft we fall back
    // to when the reader is unreachable — a typed line with an amount in it
    // should never come back empty-handed.
    const local = parseEntryText(text, { categories: data.categories, ledgerKind: data.ledger.kind });
    try {
      const raw = await askClaude(
        [{ type: "text", text: `${extractionPrompt(data.categories, data.ledger.name)}\n\nUser message: "${text}"` }],
        { schema: extractionSchema(data.categories) }
      );
      const draft = normalizeDraft(raw, { categories: data.categories, ledgerKind: data.ledger.kind, fallback: local });
      push({ role: "assistant", text: draft.note || "Got it, confirm or adjust:", draft });
    } catch (e) {
      if (local) {
        push({ role: "assistant", text: `${friendlyError(e)}, so I filled this in from your message. Check the category before saving.`, draft: local });
      } else {
        push({ role: "assistant", text: "I couldn't find an amount in that. Try including one, e.g. “paid Canva $40 yesterday”." });
      }
    }
    setBusy(false);
  };

  const saveDraft = async (draft, modeSave, att) => {
    let attachmentId = null;
    if (att) attachmentId = await storeAttachment(att);
    const filed = att ? (attachmentId ? ` ${att.name} is filed with it.` : " (Heads up: the file itself couldn't be saved to storage, but the entry went through.)") : "";
    const recurrence = draft.recurrence === "recurring" ? "recurring" : "once";
    if (modeSave === "paid") {
      addTx({
        date: draft.date || todayStr(),
        amount: Number(draft.amount) || 0,
        type: draft.type === "income" ? "income" : "expense",
        category: draft.category,
        description: draft.description,
        account: data.ledger.kind === "personal" ? "personal" : "business",
        recurrence,
        subcategory: draft.subcategory || undefined,
        attachmentId: attachmentId || undefined,
        attachmentName: attachmentId ? att.name : undefined,
      });
      push({ role: "assistant", text: `Logged ${fmt(Number(draft.amount) || 0)}, ${draft.description} → ${draft.category}${recurrence === "recurring" ? " (recurring)" : ""}. Totals are updated.${filed}`, done: true });
    } else {
      const kind = draft.type === "income" ? "receivables" : "payables";
      addAR(kind, {
        party: draft.description,
        description: draft.category,
        amount: Number(draft.amount) || 0,
        dueDate: draft.date || todayStr(),
        account: draft.account,
        recurrence,
        attachmentId: attachmentId || undefined,
        attachmentName: attachmentId ? att.name : undefined,
      });
      push({ role: "assistant", text: `Added to ${kind === "receivables" ? "receivables (they owe you)" : "payables (you owe)"}, ${fmt(Number(draft.amount) || 0)} · ${draft.description}${recurrence === "recurring" ? " (recurring)" : ""}. Find it in AR / AP.${filed}`, done: true });
    }
  };

  return (
    <div
      style={embedded ? {} : { background: P.surface, border: `1px solid ${P.line}` }}
      className={(embedded ? "" : "rounded-lg ") + "flex flex-col"}
    >
      {guideId && GUIDES[guideId] && (
        <div className="flex items-center gap-2 px-3 pt-2">
          <span style={{ background: P.brass + "22", border: `1px solid ${P.brass}`, color: P.brass, fontFamily: MONO, width: 22, height: 22 }}
            className="rounded-full text-xs flex items-center justify-center shrink-0">
            {GUIDES[guideId].avatar}
          </span>
          <span style={{ fontFamily: MONO, color: P.muted }} className="text-xs flex-1 truncate">{GUIDES[guideId].title}</span>
          <button onClick={() => setGuideId(null)} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">
            leave the guide
          </button>
        </div>
      )}
      <div className="flex gap-1 px-3 pt-2">
        {[
          ["capture", "Capture"],
          ["help", "Ask"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            style={{
              fontFamily: MONO,
              color: mode === id ? P.brass : P.faint,
              border: `1px solid ${mode === id ? P.brass : P.line}`,
              background: mode === id ? (P.brass + "18") : "transparent",
            }}
            className="rounded-full px-2.5 py-0.5 text-xs"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: embedded ? "45vh" : "55vh", minHeight: embedded ? 240 : 320 }}>
        {msgs.map((m, i) => (
          <div key={i} className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              style={{
                background: m.role === "user" ? P.surface2 : "transparent",
                border: m.role === "user" ? `1px solid ${P.line}` : "none",
                maxWidth: "85%",
              }}
              className="rounded-lg px-3 py-2 text-sm"
            >
              {m.image && <img src={m.image} alt="receipt" className="rounded mb-2 max-h-48" />}
              {m.pdfName && (
                <div style={{ border: `1px solid ${P.line}`, color: P.text }} className="rounded px-2 py-1.5 mb-1 text-xs inline-flex items-center gap-1.5">
                  <FileText size={13} style={{ color: P.brass }} /> {m.pdfName}
                </div>
              )}
              {m.text && <p style={{ color: m.role === "assistant" ? P.muted : P.text }} className="whitespace-pre-wrap">{m.text}</p>}
              {m.steps && (
                <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs space-y-0.5">
                  {m.steps.map((name, k) => (
                    <div key={k} className="flex items-center gap-1.5">
                      <Search size={10} style={{ color: P.brass, flexShrink: 0 }} />
                      {TOOL_LABEL[name] || name.replace(/_/g, " ")}
                    </div>
                  ))}
                </div>
              )}
              {m.guideId && GUIDES[m.guideId] && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {GUIDES[m.guideId].steps.map((q) => (
                    <button key={q} type="button" onClick={() => { setGuideId(m.guideId); ask(q, m.guideId); }}
                      style={{ border: `1px solid ${P.line}`, color: P.muted, fontFamily: MONO }}
                      className="rounded-full px-2.5 py-1 text-xs text-left">
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {m.nudge && <NudgeCard nudge={m.nudge} data={data} apply={apply} onDone={(line) => push({ role: "assistant", text: line, done: true })} />}
              {m.draft && <DraftCard draft={m.draft} att={m.att} data={data} addSub={addSub} onSave={saveDraft} />}
              {m.proposal && <ProposalCard proposal={m.proposal} data={data} apply={apply} />}
              {m.link && (
                <div className="mt-2">
                  <Btn tone="ghost" onClick={() => onGo?.(m.link.view)}>{m.link.label || "Open"}</Btn>
                </div>
              )}
            </div>
          </div>
        ))}
        {/* Openers, drawn from what the local insight pass already found. */}
        {msgs.length === 1 && !busy && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[...insights.slice(0, 2).map((i) => i.ask), ...DEFAULT_ASKS]
              .slice(0, 3)
              .map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => ask(q)}
                  style={{ border: `1px solid ${P.line}`, color: P.muted, fontFamily: MONO }}
                  className="rounded-full px-2.5 py-1 text-xs text-left"
                >
                  {q}
                </button>
              ))}
          </div>
        )}
        {busy && (
          <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> {mode === "help" ? "working through the ledger…" : "reading…"}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="p-3 flex gap-2" style={{ borderTop: `1px solid ${P.line}` }}>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ""; }} />
        <Btn tone="ghost" onClick={() => fileRef.current.click()} title="Attach a receipt screenshot or invoice PDF">
          <Camera size={16} />
        </Btn>
        <Input
          placeholder={mode === "help" ? "Ask about your books…" : "e.g. paid Vercel $70 today…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && handleText()}
        />
        <Btn onClick={handleText} disabled={busy || !input.trim()}>
          <Send size={15} />
        </Btn>
      </div>
    </div>
  );
}

/* ================= the proactive card =================
   Money arriving is the one moment when "what should I pay now" is a live
   question, so this is the moment to ask it. Nothing here is clever: what came
   in, what is due, and one tap per bill to settle it or leave it. */

function NudgeCard({ nudge, data, apply, onDone }) {
  const [settled, setSettled] = useState({});
  const [dismissed, setDismissed] = useState(false);
  const due = nudge.due || [];
  const today = todayStr();
  const outstanding = due.filter((d) => !settled[d.id]);

  if (dismissed) {
    return <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs mt-2">Fine, I will leave those for now.</p>;
  }

  const pay = (item) => {
    apply?.settleAR?.("payables", item.id, { date: today });
    setSettled((s) => ({ ...s, [item.id]: true }));
    onDone?.(`Marked ${item.party || item.description} paid, ${fmt(item.amount)}. The transaction is in the books.`);
  };

  return (
    <div className="mt-2 space-y-2">
      {nudge.received.length > 1 && (
        <div className="space-y-0.5">
          {nudge.received.map((r) => (
            <div key={r.id} style={{ fontFamily: MONO, color: P.faint }} className="text-xs flex items-center gap-2">
              <span className="flex-1 truncate">{r.date} {r.description}</span>
              <span style={{ color: P.credit }} className="tabular-nums shrink-0">{fmt(r.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {due.length === 0 ? (
        <p style={{ color: P.muted }} className="text-sm">Nothing is due right now, so it is yours to keep.</p>
      ) : (
        <>
          <p style={{ color: P.muted }} className="text-sm">
            {outstanding.length ? "Here is what is due. Want to pay any of it now?" : "That clears everything that was due."}
          </p>
          {due.map((d) => {
            const late = d.dueDate && d.dueDate < today;
            const isDone = settled[d.id];
            return (
              <div key={d.id} style={{ border: `1px solid ${isDone ? P.credit : late ? P.debit : P.line}` }} className="rounded-lg p-2.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: isDone ? P.faint : P.text }}>{d.party || d.description}</div>
                    <div style={{ fontFamily: MONO, color: late ? P.debit : P.faint }} className="text-xs">
                      {d.dueDate ? (late ? `overdue since ${d.dueDate}` : `due ${d.dueDate}`) : "no due date"}
                    </div>
                  </div>
                  <div style={{ fontFamily: MONO }} className="text-sm tabular-nums shrink-0">{fmt(d.amount)}</div>
                </div>
                {!isDone && (
                  <div className="flex gap-2 mt-2">
                    <Btn onClick={() => pay(d)}><Check size={13} /> Paid it</Btn>
                  </div>
                )}
                {isDone && (
                  <div style={{ color: P.credit, fontFamily: MONO }} className="text-xs mt-1">
                    marked paid today · file the receipt against it from AR / AP whenever you have it
                  </div>
                )}
              </div>
            );
          })}
          {outstanding.length > 0 && (
            <button onClick={() => setDismissed(true)} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">
              later
            </button>
          )}
        </>
      )}
    </div>
  );
}

function DraftCard({ draft, att, data, addSub, onSave }) {
  const [d, setD] = useState({ ...draft, date: draft.date || todayStr() });
  const [saved, setSaved] = useState(false);
  const cats = data.categories[d.type === "income" ? "income" : "expense"].map((c) => c.name);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
  if (saved) return <div style={{ color: P.credit, fontFamily: MONO }} className="text-xs mt-1">✓ saved{att ? " · file attached" : ""}</div>;
  return (
    <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-3 mt-2 space-y-2 w-72 max-w-full">
      {att && (
        <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs flex items-center gap-1.5">
          <Paperclip size={11} /> {att.name} will be filed with this entry
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Amount</Label>
          <Input type="number" value={d.amount} onChange={(e) => set("amount", e.target.value)} style={{ fontFamily: MONO }} />
        </div>
        <div>
          <Label>Date</Label>
          <Input type="date" value={d.date} onChange={(e) => set("date", e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Description</Label>
        <Input value={d.description} onChange={(e) => set("description", e.target.value)} />
      </div>
      <div>
        <Label>1 · Category</Label>
        <Select value={d.category} onChange={(e) => { set("category", e.target.value); set("subcategory", ""); }}>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <div className="mt-1">
          <SubPicker data={data} type={d.type === "income" ? "income" : "expense"} category={d.category}
            value={d.subcategory || ""} onChange={(v) => set("subcategory", v)} addSub={addSub} />
        </div>
      </div>
      <div>
        <Label>2 · One-time or recurring?</Label>
        <RecToggle value={d.recurrence === "recurring" ? "recurring" : "once"} onChange={(v) => set("recurrence", v)} />
      </div>
      <div>
        <Label>3 · Status</Label>
        <div className="flex gap-1">
          <Btn tone={d.type === "income" ? "credit" : "brass"} className="flex-1 justify-center" onClick={() => { onSave(d, "paid", att); setSaved(true); }}>
            <Check size={14} /> {d.type === "income" ? "Received" : "Paid"}, log it
          </Btn>
          <Btn tone="ghost" className="flex-1 justify-center" onClick={() => { onSave(d, "owed", att); setSaved(true); }}>
            {d.type === "income" ? "Owed to me" : "I owe this"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ================= agent proposals =================
   The agent can't write. It draws one of these instead, and nothing reaches the
   ledger until it's tapped. The money fields stay editable — the agent read
   your books to build this, but it didn't live them. */
function ProposalCard({ proposal, data, apply }) {
  const { kind, input } = proposal;
  const [v, setV] = useState(() => ({
    ...input,
    // One date field on the card, but the tools name it per what it means:
    // a due date on an obligation, a settlement or entry date elsewhere.
    date: input.date || input.dueDate || todayStr(),
    amount: input.amount != null ? String(input.amount) : "",
    planned: input.planned != null ? String(input.planned) : "",
  }));
  const [state, setState] = useState("open"); // open | applied | dismissed
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  const amount = Number(v.amount) || 0;
  const account = data.ledger.kind === "personal" ? "personal" : "business";

  if (state === "dismissed")
    return <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs mt-1">dismissed</div>;
  if (state === "applied")
    return <div style={{ color: P.credit, fontFamily: MONO }} className="text-xs mt-1">✓ applied</div>;

  const SPECS = {
    propose_transaction: {
      title: v.type === "income" ? "Log money in" : "Log money out",
      confirm: "Save entry",
      tone: v.type === "income" ? "credit" : "brass",
      run: () => apply.addTx({
        date: v.date, amount, type: v.type === "income" ? "income" : "expense",
        category: v.category, subcategory: v.subcategory || undefined,
        description: v.description || "", account,
        recurrence: v.recurrence === "recurring" ? "recurring" : "once",
      }),
    },
    propose_obligation: {
      title: v.kind === "receivables" ? "Add a receivable" : "Add a payable",
      confirm: "Add it",
      tone: v.kind === "receivables" ? "credit" : "brass",
      run: () => apply.addAR(v.kind === "receivables" ? "receivables" : "payables", {
        party: v.party, description: v.description || "", amount,
        dueDate: v.date, account,
        recurrence: v.recurrence === "recurring" ? "recurring" : "once",
        frequency: v.frequency || undefined,
      }),
    },
    propose_settle: {
      title: proposal.item
        ? `Settle ${proposal.item.party} · ${fmt(proposal.item.amount)}`
        : "Settle",
      confirm: v.kind === "receivables" ? "Mark received" : "Mark paid",
      tone: v.kind === "receivables" ? "credit" : "brass",
      note: "Marks it settled and writes the matching transaction.",
      run: () => apply.settleAR(v.kind, v.id, { date: v.date, amount: amount || undefined }),
    },
    propose_budget: {
      title: `Budget ${v.category}`,
      confirm: "Set budget",
      tone: "brass",
      run: () => apply.setPlanned(v.type === "income" ? "income" : "expense", v.category, Number(v.planned) || 0),
    },
    propose_anchor: {
      title: "Re-anchor the balance",
      confirm: "Re-anchor",
      tone: "brass",
      note: "Sets the balance as of that date. Entries on or before it stop counting toward it.",
      run: () => apply.setAnchor(amount, v.date, "agent"),
    },
  };
  const spec = SPECS[kind];
  if (!spec || !apply) return null;

  const money = kind === "propose_budget"
    ? { label: "Planned per month", key: "planned", value: v.planned }
    : { label: kind === "propose_anchor" ? "True balance" : "Amount", key: "amount", value: v.amount };
  const dateLabel = kind === "propose_obligation" ? "Due" : kind === "propose_anchor" ? "As of" : "Date";

  return (
    <div style={{ background: P.bg, border: `1px solid ${P.brass}55` }} className="rounded-lg p-3 mt-2 space-y-2 w-72 max-w-full">
      <div style={{ fontFamily: MONO, color: P.brass }} className="text-xs uppercase tracking-widest flex items-center gap-1.5">
        <Sparkles size={11} /> {spec.title}
      </div>
      {(input.reason || spec.note) && (
        <p style={{ color: P.faint }} className="text-xs">{input.reason || spec.note}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{money.label}</Label>
          <Input type="number" value={money.value} onChange={(e) => set(money.key, e.target.value)} style={{ fontFamily: MONO }} />
        </div>
        {kind !== "propose_budget" && (
          <div>
            <Label>{dateLabel}</Label>
            <Input type="date" value={v.date} onChange={(e) => set("date", e.target.value)} />
          </div>
        )}
      </div>

      {kind === "propose_transaction" && (
        <>
          <div>
            <Label>Description</Label>
            <Input value={v.description || ""} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={v.category} onChange={(e) => set("category", e.target.value)}>
              {data.categories[v.type === "income" ? "income" : "expense"].map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </Select>
          </div>
        </>
      )}
      {kind === "propose_obligation" && (
        <>
          <div>
            <Label>{v.kind === "receivables" ? "Who owes you" : "Who you owe"}</Label>
            <Input value={v.party || ""} onChange={(e) => set("party", e.target.value)} />
          </div>
          <div>
            <Label>For</Label>
            <Input value={v.description || ""} onChange={(e) => set("description", e.target.value)} />
          </div>
        </>
      )}

      <div className="flex gap-1 pt-0.5">
        <Btn tone={spec.tone} className="flex-1 justify-center" onClick={() => { spec.run(); setState("applied"); }}>
          <Check size={14} /> {spec.confirm}
        </Btn>
        <Btn tone="ghost" onClick={() => setState("dismissed")}>Not now</Btn>
      </div>
    </div>
  );
}

/* ================= Transactions ================= */
function TxAttachment({ tx, setTxAttachment, openPreview }) {
  const fileRef = useRef(null);
  const [state, setState] = useState("idle"); // idle | busy | error
  const onPick = async (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setState("error"); setTimeout(() => setState("idle"), 2500); return; }
    setState("busy");
    try {
      const key = await storeAttachment({
        name: file.name,
        type: file.type || attTypeFromName(file.name),
        file,
      });
      if (!key) throw new Error("store failed");
      setTxAttachment(tx.id, key, file.name);
      setState("idle");
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  };
  if (tx.attachmentId)
    return (
      <button
        onClick={() => openPreview(tx.attachmentId, tx.attachmentName)}
        title={`View ${tx.attachmentName || "filed document"}`}
        style={{ color: P.brass, padding: 6, margin: -6 }}
        className="shrink-0"
      >
        <Paperclip size={14} />
      </button>
    );
  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={(e) => { onPick(e.target.files[0]); e.target.value = ""; }} />
      <button
        onClick={() => fileRef.current.click()}
        title={state === "error" ? "Couldn't save that file (max 8 MB)" : "Attach invoice / receipt"}
        style={{ color: state === "error" ? P.debit : P.faint, padding: 6, margin: -6 }}
        className="shrink-0"
      >
        {state === "busy" ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
      </button>
    </>
  );
}

/* inline editor for an existing transaction row */
function TxEditor({ tx, data, addSub, addCredit, onSave, onCancel }) {
  const [f, setF] = useState({ ...tx, amount: String(tx.amount) });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const cats = data.categories[f.type].map((c) => c.name);

  const save = () => {
    const amount = parseFloat(f.amount);
    onSave({
      date: f.date,
      amount: Number.isNaN(amount) ? tx.amount : Math.abs(amount),
      type: f.type,
      category: cats.includes(f.category) ? f.category : cats[0],
      description: f.description,
      account: f.account,
      recurrence: f.recurrence === "recurring" ? "recurring" : "once",
      subcategory: f.subcategory || null,
      payMethod: f.payMethod === "credits" ? "credits" : "cash",
      creditId: f.payMethod === "credits" ? f.creditId : null,
    });
  };

  return (
    <div style={{ background: P.bg, border: `1px solid ${P.brass}` }} className="rounded-lg p-3 my-2 grid sm:grid-cols-6 gap-2 items-end">
      <div><Label>Date</Label><Input type="date" value={f.date || ""} onChange={(e) => set("date", e.target.value)} /></div>
      <div><Label>Amount</Label><Input type="number" value={f.amount} onChange={(e) => set("amount", e.target.value)} style={{ fontFamily: MONO }} /></div>
      <div>
        <Label>Type</Label>
        <Select value={f.type} onChange={(e) => { const t = e.target.value; setF((p) => ({ ...p, type: t, category: data.categories[t][0].name, subcategory: "" })); }}>
          <option value="expense">Expense</option><option value="income">Income</option>
        </Select>
      </div>
      <div>
        <Label>Category</Label>
        <Select value={cats.includes(f.category) ? f.category : cats[0]} onChange={(e) => { const v = e.target.value; setF((p) => ({ ...p, category: v, subcategory: "" })); }}>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </div>
      <div>
        <Label>Subcategory</Label>
        <SubPicker data={data} type={f.type} category={cats.includes(f.category) ? f.category : cats[0]}
          value={f.subcategory || ""} onChange={(v) => set("subcategory", v)} addSub={addSub} />
      </div>
      <div><Label>Frequency</Label><RecToggle value={f.recurrence === "recurring" ? "recurring" : "once"} onChange={(v) => set("recurrence", v)} /></div>
      <div>
        <Label>Paid via</Label>
        <PayViaSelect data={data} payMethod={f.payMethod} creditId={f.creditId} addCredit={addCredit}
          onChange={(pm, cid) => setF((p) => ({ ...p, payMethod: pm, creditId: cid }))} />
      </div>
      <div className="sm:col-span-3"><Label>Description</Label><Input value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
      <div className="sm:col-span-2 flex gap-2">
        <Btn className="flex-1 justify-center" onClick={save}><Check size={14} /> Save changes</Btn>
        <Btn tone="ghost" onClick={onCancel}><X size={14} /></Btn>
      </div>
    </div>
  );
}

function Transactions({ data, monthTx, addTx, delTx, updateTx, setTxAttachment, openPreview, openImport, openTransfer, addSub, addCredit, month, cleared }) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("all");
  const [recOnly, setRecOnly] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const blank = {
    date: `${month}-15`, amount: "", type: "expense",
    category: data.categories.expense[0]?.name || "Other", subcategory: "",
    description: "", account: data.ledger.kind === "personal" ? "personal" : "business",
    recurrence: "once", payMethod: "cash", creditId: null,
  };
  const [form, setForm] = useState(blank);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // A Personal Ledger has one account, so splitting it by business/personal
  // offers a choice with no meaning behind it. The filter only appears on a
  // Business Ledger, where personal entries genuinely do sit alongside business ones.
  const showAccountFilter = data.ledger.kind !== "personal";
  const list = monthTx
    .filter((t) => !showAccountFilter || filter === "all" || t.account === filter)
    .filter((t) => !recOnly || isRec(t))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const recTotal = list.filter(isRec).reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);

  const submit = () => {
    if (!form.amount || !form.description) return;
    addTx({ ...form, subcategory: form.subcategory || undefined, creditId: form.payMethod === "credits" ? form.creditId : undefined, amount: parseFloat(form.amount) });
    setForm(blank);
    setAdding(false);
  };

  return (
    <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <h2 style={{ fontFamily: SERIF }} className="text-lg">{monthLabel(month)}, {list.length} entries</h2>
        <div className="flex gap-2 items-center">
          {showAccountFilter && ["all", "business", "personal"].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ fontFamily: MONO, color: filter === f ? P.brass : P.faint }} className="text-xs uppercase tracking-wider">
              {f}
            </button>
          ))}
          <button onClick={() => setRecOnly(!recOnly)}
            title="Show recurring entries only"
            style={{ fontFamily: MONO, color: recOnly ? P.brass : P.faint, border: `1px solid ${recOnly ? P.brass : P.line}` }}
            className="text-xs uppercase tracking-wider rounded px-2 py-0.5 inline-flex items-center gap-1">
            <Repeat size={10} /> recurring
          </button>
          <Btn tone="ghost" onClick={openTransfer} title="Move money between your ledgers">
            <ArrowLeftRight size={14} /> Transfer
          </Btn>
          <Btn tone="ghost" onClick={openImport} title="Import a bank statement, paste text or upload a file">
            <FileText size={14} /> Import
          </Btn>
          <Btn onClick={() => setAdding(!adding)}><Plus size={14} /> Add</Btn>
        </div>
      </div>
      <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs mb-3">tap any entry to change its category, account, or anything else</p>
      {recOnly && (
        <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs mb-3">
          Recurring net this month: <span style={{ color: recTotal >= 0 ? P.credit : P.debit }}>{fmt(recTotal)}</span>
        </p>
      )}

      {adding && (
        <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-3 mb-4 grid sm:grid-cols-6 gap-2 items-end">
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div><Label>Amount</Label><Input type="number" placeholder="0.00" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          <div>
            <Label>Type</Label>
            <Select value={form.type} onChange={(e) => { const t = e.target.value; setForm((p) => ({ ...p, type: t, category: data.categories[t][0].name, subcategory: "" })); }}>
              <option value="expense">Expense</option><option value="income">Income</option>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onChange={(e) => { const v = e.target.value; setForm((p) => ({ ...p, category: v, subcategory: "" })); }}>
              {data.categories[form.type].map((c) => <option key={c.name}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Subcategory</Label>
            <SubPicker data={data} type={form.type} category={form.category}
              value={form.subcategory} onChange={(v) => set("subcategory", v)} addSub={addSub} />
          </div>
          <div className="sm:col-span-2">
            <Label>Paid via</Label>
            <PayViaSelect data={data} payMethod={form.payMethod} creditId={form.creditId} addCredit={addCredit}
              onChange={(pm, cid) => setForm((p) => ({ ...p, payMethod: pm, creditId: cid }))} />
          </div>
          <div className="sm:col-span-2"><Label>Description</Label><Input placeholder="What was it?" value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Frequency</Label><RecToggle value={form.recurrence} onChange={(v) => set("recurrence", v)} /></div>
          <div className="sm:col-span-6 flex gap-2">
            <Btn className="flex-1 justify-center" onClick={submit}><Check size={14} /> Save entry</Btn>
            <Btn tone="ghost" onClick={() => setAdding(false)}><X size={14} /></Btn>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <p style={{ color: P.faint }} className="text-sm py-8 text-center">{recOnly ? "No recurring entries this month." : "Nothing logged this month yet, add one above or capture a receipt."}</p>
      ) : (
        <div className="divide-y" style={{ borderColor: P.line }}>
          {list.map((t) =>
            editingId === t.id ? (
              <TxEditor
                key={t.id}
                tx={t}
                data={data}
                addSub={addSub}
                addCredit={addCredit}
                onSave={(patch) => { updateTx(t.id, patch); setEditingId(null); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div key={t.id} className="flex items-center gap-2 sm:gap-3 py-2.5" style={{ borderColor: P.line }}>
                <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs w-10 sm:w-12 shrink-0">{t.date?.slice(5)}</div>
                <button onClick={() => setEditingId(t.id)} className="flex-1 min-w-0 text-left" title="Edit this entry">
                  <div className="text-sm truncate">{t.description}</div>
                  <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs flex items-center gap-1 flex-wrap">
                    {isRec(t) && <RecMark />}
                    {t.category}{t.subcategory ? " / " + t.subcategory : ""}{isRec(t) ? " · recurring" : ""}{t.plExclude ? " · transfer (not in P&L)" : ""}
                    {t.transferId && (
                      <span
                        style={{ fontFamily: MONO, color: P.bg, background: P.brass }}
                        className="rounded px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1"
                        title={t.plExclude ? "Transferred between your ledgers. Excluded from P&L." : "Paid across ledgers as a real expense/income. Counted in P&L."}
                      >
                        <ArrowLeftRight size={10} /> {t.type === "expense" ? "transferred out" : "transferred in"}
                      </span>
                    )}
                    {isCredits(t) && (
                      <span style={{ color: P.brass, border: `1px solid ${P.brass}` }} className="rounded px-1 shrink-0" title="Paid with credits, doesn't affect cash balance">
                        {creditName(data, t.creditId)}
                      </span>
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                  {cleared?.has(t.id) && (
                    <span style={{ color: P.credit }} className="shrink-0" title={`Cleared the bank on ${cleared.get(t.id).date}`}>
                      <Check size={13} />
                    </span>
                  )}
                  <TxAttachment tx={t} setTxAttachment={setTxAttachment} openPreview={openPreview} />
                  <div style={{ fontFamily: MONO, color: t.type === "income" ? P.credit : P.text }} className="text-sm tabular-nums">
                    {t.type === "income" ? "+" : "−"}{fmt(t.amount)}
                  </div>
                  <button onClick={() => setEditingId(t.id)} style={{ color: P.faint, padding: 6, margin: -6 }} title="Edit">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => delTx(t.id)} style={{ color: P.faint, padding: 6, margin: -6 }} title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}

/* A small value tooltip that follows hover on desktop and tap on touch,
   used by the P&L bars so a number is always one interaction away. */
function ChartTip({ show, children }) {
  if (!show) return null;
  return (
    <div
      role="tooltip"
      className="absolute z-10 pointer-events-none"
      style={{
        bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 6,
        background: P.text, color: P.surface, fontFamily: MONO, whiteSpace: "nowrap",
        padding: "3px 7px", borderRadius: 5, fontSize: 11, boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
      }}
    >
      {children}
    </div>
  );
}

/* ================= P&L ================= */
function ProfitLoss({ data, month }) {
  const inScope = () => true; // a ledger is its own scope now

  const monthTx = data.transactions.filter((t) => t.date?.startsWith(month) && inScope(t) && !t.plExclude);
  const revenue = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const costs = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const recCosts = monthTx.filter((t) => t.type === "expense" && isRec(t)).reduce((s, t) => s + t.amount, 0);
  const creditCosts = monthTx.filter((t) => t.type === "expense" && isCredits(t)).reduce((s, t) => s + t.amount, 0);
  const net = revenue - costs;
  const margin = revenue > 0 ? (net / revenue) * 100 : null;

  // prior month, for a plain "up or down" read on the headline numbers
  const prevMonth = shiftMonth(month, -1);
  const prevTx = data.transactions.filter((t) => t.date?.startsWith(prevMonth) && inScope(t) && !t.plExclude);
  const prevRevenue = prevTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const prevCosts = prevTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const prevNet = prevRevenue - prevCosts;
  const pctChange = (curr, prev) => (prev === 0 ? null : ((curr - prev) / Math.abs(prev)) * 100);
  const revenueChange = pctChange(revenue, prevRevenue);
  const costsChange = pctChange(costs, prevCosts);
  const netChange = pctChange(net, prevNet);

  // how many days of this month have actually happened, for a burn-rate read
  const [yy, mm] = month.split("-").map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const isCurrentMonth = month === thisMonth();
  const daysElapsed = isCurrentMonth ? Math.min(new Date().getDate(), daysInMonth) : daysInMonth;
  const avgDailyCost = daysElapsed > 0 ? costs / daysElapsed : 0;
  const avgDailyRevenue = daysElapsed > 0 ? revenue / daysElapsed : 0;

  const byCat = {};
  const catCount = {};
  monthTx.filter((t) => t.type === "expense").forEach((t) => {
    byCat[t.category] = (byCat[t.category] || 0) + t.amount;
    catCount[t.category] = (catCount[t.category] || 0) + 1;
  });
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(...catRows.map(([, v]) => v), 1);
  const topCatShare = catRows.length && costs > 0 ? (catRows[0][1] / costs) * 100 : null;

  // last 6 months trend
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(month, -i));
  const trend = months.map((m) => {
    const tx = data.transactions.filter((t) => t.date?.startsWith(m) && inScope(t) && !t.plExclude);
    const inc = tx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = tx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { m, inc, exp, net: inc - exp };
  });
  const maxTrend = Math.max(...trend.flatMap((t) => [t.inc, t.exp]), 1);

  // open AR/AP for context
  const openAR = data.receivables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0);
  const openAP = data.payables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0);

  const scopeLabel = data.ledger.name;
  const exportCSV = () => {
    downloadCSV(`PL_${scopeLabel.replace(/\s/g, "")}_${month}.csv`, [
      [`Profit & Loss, ${monthLabel(month)}`, scopeLabel],
      [],
      ["Revenue", revenue.toFixed(2)],
      ["Costs & expenses", (-costs).toFixed(2)],
      ["  of which recurring", (-recCosts).toFixed(2)],
      ["  of which one-time", (-(costs - recCosts)).toFixed(2)],
      ["  of which covered by credits (non-cash)", (-creditCosts).toFixed(2)],
      [`Net ${net >= 0 ? "profit" : "loss"}`, net.toFixed(2)],
      ["Margin", margin !== null ? `${margin.toFixed(1)}%` : "n/a"],
      [],
      ["Expenses by category"],
      ...catRows.map(([c, v]) => [c, v.toFixed(2)]),
      [],
      ["Open receivables (not included)", openAR.toFixed(2)],
      ["Open payables (not included)", openAP.toFixed(2)],
      [],
      ["Date", "Description", "Category", "Subcategory", "Account", "Type", "Frequency", "Amount"],
      ...[...monthTx]
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .map((t) => [t.date, t.description, t.category, t.subcategory || "", data.ledger.kind === "personal" ? "Personal" : "Business", t.type, isRec(t) ? "Recurring" : "One-time", (t.type === "income" ? t.amount : -t.amount).toFixed(2)]),
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2 items-center">
        <div className="flex-1" />
        <Btn tone="ghost" onClick={exportCSV} title="Download this statement + underlying transactions as CSV">
          <Download size={14} /> Export CSV
        </Btn>
      </div>

      <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
        <h2 style={{ fontFamily: SERIF }} className="text-lg mb-3">{monthLabel(month)} statement</h2>
        <div className="space-y-2" style={{ fontFamily: MONO }}>
          <PLRow label="Revenue" value={revenue} color={P.credit} change={revenueChange} />
          <PLRow label="Costs & expenses" value={-costs} color={P.debit} change={costsChange} invertChange />
          {recCosts > 0 && (
            <div style={{ color: P.faint }} className="flex justify-between text-xs pl-4">
              <span className="inline-flex items-center gap-1"><Repeat size={10} /> recurring / one-time</span>
              <span className="tabular-nums">{fmt(-recCosts)} / {fmt(-(costs - recCosts))}</span>
            </div>
          )}
          {creditCosts > 0 && (
            <div style={{ color: P.faint }} className="flex justify-between text-xs pl-4">
              <span>covered by credits (no cash out)</span>
              <span className="tabular-nums" style={{ color: P.brass }}>{fmt(-creditCosts)}</span>
            </div>
          )}
          <div style={{ borderTop: `1px double ${P.brass}` }} className="pt-2 flex justify-between text-base">
            <span style={{ color: P.text }}>Net {net >= 0 ? "profit" : "loss"}</span>
            <span style={{ color: net >= 0 ? P.credit : P.debit }} className="tabular-nums flex items-center gap-1">
              {net >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{fmt(net)}
              {margin !== null && <span style={{ color: P.faint }} className="text-xs ml-1">({margin.toFixed(0)}%)</span>}
              <PLChange value={netChange} />
            </span>
          </div>
        </div>
        {(openAR > 0 || openAP > 0) && (
          <p style={{ color: P.faint }} className="text-xs mt-3">
            Not yet in these numbers: {fmt(openAR)} still owed to you, {fmt(openAP)} you still owe.
          </p>
        )}
      </section>

      {/* at-a-glance stats: burn rate, top category concentration, txn count — the numbers behind the statement above */}
      <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
        <h2 style={{ fontFamily: SERIF }} className="text-lg mb-3">At a glance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Avg. daily spend" value={fmt(avgDailyCost)} hint={`over ${daysElapsed} ${daysElapsed === 1 ? "day" : "days"}`} />
          <StatTile label="Avg. daily revenue" value={fmt(avgDailyRevenue)} hint={`over ${daysElapsed} ${daysElapsed === 1 ? "day" : "days"}`} />
          <StatTile
            label="Top category share"
            value={topCatShare !== null ? `${topCatShare.toFixed(0)}%` : "—"}
            hint={catRows.length ? catRows[0][0] : "no expenses"}
          />
          <StatTile label="Transactions" value={String(monthTx.length)} hint={`${monthTx.filter((t) => t.type === "expense").length} out · ${monthTx.filter((t) => t.type === "income").length} in`} />
        </div>
      </section>

      <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
        <h2 style={{ fontFamily: SERIF }} className="text-lg mb-3">Where the money went</h2>
        {catRows.length === 0 ? (
          <p style={{ color: P.faint }} className="text-sm">No expenses in this view for {monthLabel(month)}.</p>
        ) : (
          <div className="space-y-2">
            {catRows.map(([cat, v]) => (
              <CatBarRow key={cat} cat={cat} value={v} max={maxCat} count={catCount[cat]} shareOfCosts={costs > 0 ? (v / costs) * 100 : null} />
            ))}
          </div>
        )}
      </section>

      <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 style={{ fontFamily: SERIF }} className="text-lg">Six-month trend</h2>
          <div className="flex items-center gap-3 text-xs" style={{ color: P.faint, fontFamily: MONO }}>
            <span className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 2, background: P.credit, display: "inline-block" }} /> income</span>
            <span className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 2, background: P.debit, display: "inline-block" }} /> expense</span>
          </div>
        </div>
        <div className="flex items-end gap-3 h-32">
          {trend.map((t) => (
            <TrendBar key={t.m} t={t} maxTrend={maxTrend} active={t.m === month} />
          ))}
        </div>
      </section>
    </div>
  );
}

// invertChange: for cost rows, a rise is bad (red) and a fall is good (green) — the opposite of revenue/net
const PLChange = ({ value, invert = false }) => {
  if (value === null || !Number.isFinite(value)) return null;
  const good = invert ? value <= 0 : value >= 0;
  return (
    <span style={{ color: good ? P.credit : P.debit }} className="text-xs inline-flex items-center gap-0.5">
      {value >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {Math.abs(value).toFixed(0)}%
    </span>
  );
};

const PLRow = ({ label, value, color, change, invertChange }) => (
  <div className="flex justify-between items-center text-sm">
    <span style={{ color: P.muted }}>{label}</span>
    <span className="flex items-center gap-2">
      {change !== undefined && <PLChange value={change} invert={invertChange} />}
      <span style={{ color }} className="tabular-nums">{fmt(value)}</span>
    </span>
  </div>
);

function StatTile({ label, value, hint }) {
  return (
    <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-md p-2.5">
      <div style={{ color: P.faint }} className="text-xs mb-1 truncate">{label}</div>
      <div style={{ fontFamily: MONO, color: P.text }} className="text-base tabular-nums">{value}</div>
      {hint && <div style={{ color: P.faint }} className="text-xs mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

function CatBarRow({ cat, value, max, count, shareOfCosts }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="relative flex items-center gap-3"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onTouchStart={() => setHover((h) => !h)}
    >
      <div className="w-32 text-sm truncate">{cat}</div>
      <div className="flex-1 h-2 rounded-full overflow-hidden relative" style={{ background: P.bg }}>
        <div style={{ width: `${(value / max) * 100}%`, background: P.debit, opacity: 0.8 }} className="h-full">
          <ChartTip show={hover}>
            {fmt(value)}{shareOfCosts !== null ? ` · ${shareOfCosts.toFixed(0)}% of costs` : ""} · {count} {count === 1 ? "txn" : "txns"}
          </ChartTip>
        </div>
      </div>
      <div style={{ fontFamily: MONO }} className="text-sm tabular-nums w-24 text-right">{fmt(value)}</div>
    </div>
  );
}

function TrendBar({ t, maxTrend, active }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="flex-1 flex flex-col items-center gap-1 relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onTouchStart={() => setHover((h) => !h)}
    >
      <ChartTip show={hover}>
        {monthLabel(t.m)}: +{fmt(t.inc)} / −{fmt(t.exp)} · net {fmt(t.net)}
      </ChartTip>
      <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: 96 }}>
        <div style={{ height: `${(t.inc / maxTrend) * 100}%`, background: P.credit, width: "30%", minHeight: t.inc ? 2 : 0 }} className="rounded-t" />
        <div style={{ height: `${(t.exp / maxTrend) * 100}%`, background: P.debit, width: "30%", minHeight: t.exp ? 2 : 0 }} className="rounded-t" />
      </div>
      <div style={{ fontFamily: MONO, color: active ? P.brass : P.faint }} className="text-xs">
        {t.m.slice(5)}
      </div>
    </div>
  );
}

/* ================= AR / AP ================= */
function ARAP({ data, addAR, settleAR, delAR, removeSettled, updateAR, addSub, addCredit, openPreview, openGuide }) {
  const openAR = data.receivables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0);
  const openAP = data.payables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0);
  const net = openAR - openAP;

  const exportCSV = () => {
    const row = (kind, i) => [kind, i.party, i.description || "", i.amount.toFixed(2), i.dueDate || "", i.status, i.settledOn || "",
      i.account === "personal" ? "Personal" : "Business", isRec(i) ? `Recurring (${freqLabel(i.frequency || "monthly")})` : "One-time",
      i.category || "", i.subcategory || "", isCredits(i) ? creditName(data, i.creditId) : "Cash"];
    downloadCSV(`AR_AP_${todayStr()}.csv`, [
      [`Receivables & Payables`, `exported ${todayStr()}`],
      [],
      ["Open, owed to you", openAR.toFixed(2)],
      ["Open, you owe", openAP.toFixed(2)],
      ["Net position", net.toFixed(2)],
      [],
      ["Kind", "Party", "For", "Amount", "Due", "Status", "Settled on", "Account", "Frequency", "Category", "Subcategory", "Paid via"],
      ...data.receivables.map((i) => row("Receivable", i)),
      ...data.payables.map((i) => row("Payable", i)),
    ]);
  };

  return (
    <div className="space-y-6">
      <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
        <div className="flex flex-wrap justify-between items-start gap-4 mb-3">
          <Stat label="Owed to you" value={fmt(openAR)} color={P.credit} />
          <Stat label="You owe" value={fmt(openAP)} color={P.debit} />
          <Stat label="Net position" value={fmt(net)} color={net >= 0 ? P.credit : P.debit} />
          <div className="flex items-center gap-2">
            <GuideAnchor id="ar-ap" onOpen={openGuide} label="Help me chase" />
            <Btn tone="ghost" onClick={exportCSV} title="Download all receivables and payables as CSV">
              <Download size={14} /> Export CSV
            </Btn>
          </div>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden" style={{ background: P.bg }}>
          <div style={{ width: `${(openAR / (openAR + openAP || 1)) * 100}%`, background: P.credit }} />
          <div style={{ width: `${(openAP / (openAR + openAP || 1)) * 100}%`, background: P.debit }} />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <ARList kind="receivables" title="Receivables · they owe you" items={data.receivables} data={data} addAR={addAR} settleAR={settleAR} delAR={delAR} removeSettled={removeSettled} updateAR={updateAR} addSub={addSub} addCredit={addCredit} openPreview={openPreview} tone={P.credit} action="Mark received" />
        <ARList kind="payables" title="Payables · you owe them" items={data.payables} data={data} addAR={addAR} settleAR={settleAR} delAR={delAR} removeSettled={removeSettled} updateAR={updateAR} addSub={addSub} addCredit={addCredit} openPreview={openPreview} tone={P.debit} action="Mark paid" />
      </div>
    </div>
  );
}

/* ---------- shared field block for AR/AP add + edit forms ---------- */
function ARFields({ kind, f, set, data, addSub, addCredit }) {
  const type = kind === "receivables" ? "income" : "expense";
  const cats = data.categories[type].map((c) => c.name);
  const catVal = f.category && cats.includes(f.category) ? f.category : (kind === "receivables" ? "Client revenue" : "GENIE AI");
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>{kind === "receivables" ? "Who owes you" : "Who you owe"}</Label><Input value={f.party} onChange={(e) => set("party", e.target.value)} placeholder="Client / vendor" /></div>
        <div><Label>Amount</Label><Input type="number" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>For</Label><Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Invoice #, work…" /></div>
        <div><Label>Due</Label><Input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Category</Label>
          <Select value={catVal} onChange={(e) => { set("category", e.target.value); set("subcategory", ""); }}>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </div>
        <div>
          <Label>Subcategory</Label>
          <SubPicker data={data} type={type} category={catVal} value={f.subcategory || ""} onChange={(v) => set("subcategory", v)} addSub={addSub} />
        </div>
      </div>
      <div><Label>Frequency</Label><RecToggle value={f.recurrence === "recurring" ? "recurring" : "once"} onChange={(v) => set("recurrence", v)} /></div>
      {f.recurrence === "recurring" && (
        <div>
          <Label>Repeats</Label>
          <Select value={f.frequency || "monthly"} onChange={(e) => set("frequency", e.target.value)}>
            {FREQS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </Select>
          <p style={{ color: P.faint }} className="text-xs mt-1">When you settle it, the next occurrence is queued automatically.</p>
        </div>
      )}
      <div>
        <Label>{kind === "receivables" ? "Received as" : "Paid via"}</Label>
        <PayViaSelect data={data} payMethod={f.payMethod} creditId={f.creditId} addCredit={addCredit}
          onChange={(pm, cid) => { set("payMethod", pm); set("creditId", cid); }} />
        {f.payMethod === "credits" && (
          <p style={{ color: P.faint }} className="text-xs mt-1">Settling this moves credits, not cash, your balance won't change.</p>
        )}
      </div>
    </>
  );
}

function ARList({ kind, title, items, data, addAR, settleAR, delAR, removeSettled, updateAR, addSub, addCredit, openPreview, tone, action }) {
  const [adding, setAdding] = useState(false);
  const [settleFor, setSettleFor] = useState(null);   // item awaiting the confirm dialog
  const [openGroups, setOpenGroups] = useState({});   // party -> expanded?
  const [noteFor, setNoteFor] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const incomeCats = data.categories.income.map((c) => c.name);
  const expenseCats = data.categories.expense.map((c) => c.name);
  const defaultCat = kind === "receivables"
    ? (incomeCats.includes("Client revenue") ? "Client revenue" : incomeCats[0] || "Other")
    : (expenseCats[0] || "Other");
  const blank = { party: "", description: "", amount: "", dueDate: todayStr(), account: data.ledger.kind === "personal" ? "personal" : "business", recurrence: "once", frequency: "monthly", category: defaultCat, subcategory: "", payMethod: "cash", creditId: null };
  const [form, setForm] = useState(blank);
  const [editForm, setEditForm] = useState(null);
  const [att, setAtt] = useState(null);
  const [reading, setReading] = useState(false);
  const [readErr, setReadErr] = useState("");
  const fileRef = useRef(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const eset = (k, v) => setEditForm((p) => ({ ...p, [k]: v }));
  const settled = items.filter((i) => i.status !== "open");
  // ALL open items are listed (the summary sums them, so the list must match).
  // Items due beyond ~35 days render subdued with an "upcoming" tag, so a freshly
  // respawned recurring bill reads as future, not as something demanding settlement.
  const horizon = (() => { const d = new Date(); d.setDate(d.getDate() + 35); return d.toISOString().slice(0, 10); })();
  const open = [...items.filter((i) => i.status === "open")]
    .sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31"));
  const daysUntil = (d) => Math.max(0, Math.round((new Date(d + "T00:00:00") - new Date(todayStr() + "T00:00:00")) / 86400000));

  // group open items by party (2+ under the same name collapse into one card)
  const groupSeq = (list) => {
    const seq = [], seen = {};
    list.forEach((i) => {
      const key = (i.party || "").trim() || "·";
      if (!seen[key]) { seen[key] = { party: key, items: [] }; seq.push(seen[key]); }
      seen[key].items.push(i);
    });
    return seq;
  };
  const openSeq = groupSeq(open);
  const settledSeq = groupSeq(settled);
  const toggleGroup = (k) => setOpenGroups((g) => ({ ...g, [k]: !g[k] }));

  const onInvoice = async (file) => {
    if (!file) return;
    setReadErr("");
    if (file.size > MAX_FILE_BYTES) {
      setReadErr(`That file is ${(file.size / 1048576).toFixed(1)} MB, max 8 MB. Try a smaller export or a screenshot.`);
      return;
    }
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    setReading(true);
    try {
      const b64 = await fileToB64(file);
      const block = isPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: file.type || "image/png", data: b64 } };
      const d = await askClaude([block, { type: "text", text: arExtractionPrompt(kind) }], { maxTokens: 2048, schema: AR_SCHEMA });
      const amount = coerceAmount(d.amount);
      setForm({
        ...blank,
        party: String(d.party || "").trim(),
        description: String(d.description || "").trim(),
        amount: amount ? String(amount) : "",
        dueDate: coerceDate(d.dueDate) || todayStr(),
        recurrence: d.recurrence === "recurring" ? "recurring" : "once",
      });
      setAtt({ name: file.name || "invoice.pdf", type: isPdf ? "application/pdf" : (file.type || "image/png"), data: b64, file });
      if (d.note) setReadErr(d.note);
      setAdding(true);
    } catch (e) {
      setReadErr(`Couldn't read that invoice. ${friendlyError(e)}. Fill the fields in yourself, or try a clearer file.`);
      setAdding(true);
    }
    setReading(false);
  };

  const submit = async () => {
    if (!form.party || !form.amount) return;
    let attachmentId, attachmentName;
    if (att) {
      attachmentId = await storeAttachment(att);
      attachmentName = attachmentId ? att.name : undefined;
      if (!attachmentId) setReadErr("The entry was added, but the file itself couldn't be saved to storage.");
    }
    addAR(kind, {
      ...form,
      amount: parseFloat(form.amount),
      subcategory: form.subcategory || undefined,
      creditId: form.payMethod === "credits" ? form.creditId : undefined,
      attachmentId: attachmentId || undefined,
      attachmentName,
    });
    setForm(blank);
    setAtt(null);
    setAdding(false);
  };

  const saveEdit = () => {
    const amount = parseFloat(editForm.amount);
    updateAR(kind, editingId, {
      party: editForm.party,
      description: editForm.description,
      amount: Number.isNaN(amount) ? undefined : Math.abs(amount),
      dueDate: editForm.dueDate,
      recurrence: editForm.recurrence === "recurring" ? "recurring" : "once",
      frequency: editForm.recurrence === "recurring" ? (editForm.frequency || "monthly") : null,
      category: editForm.category || defaultCat,
      subcategory: editForm.subcategory || null,
      payMethod: editForm.payMethod === "credits" ? "credits" : "cash",
      creditId: editForm.payMethod === "credits" ? editForm.creditId : null,
    });
    setEditingId(null);
    setEditForm(null);
  };

  const cancelAdd = () => { setAdding(false); setForm(blank); setAtt(null); setReadErr(""); };

  const SettledLine = ({ i, indent }) => (
    <div style={{ color: P.muted, fontFamily: MONO, paddingLeft: indent ? "18px" : 0 }} className="text-xs flex justify-between items-center gap-2 py-1">
      <span className="truncate flex items-center gap-1.5">
        <Lock size={10} style={{ color: P.faint }} />
        {i.party}{isCredits(i) ? " (credits)" : ""}
        {(i.description || i.attachmentId) && (
          <button
            onClick={() => setNoteFor(noteFor?.id === i.id ? null : i)}
            title="View note / history"
            style={{ color: noteFor?.id === i.id ? P.brass : P.faint }}
          >
            <StickyNote size={11} />
          </button>
        )}
      </span>
      <span className="shrink-0 flex items-center gap-2">
        {fmt(i.amount)} · {kind === "receivables" ? "received" : "paid"} {i.settledOn}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeSettled(kind, i); }}
          title="Remove this settlement (and its transaction)"
          aria-label="Remove settlement"
          style={{ color: P.faint, padding: "4px", margin: "-4px", cursor: "pointer" }}
          className="hover:opacity-100"
          onMouseEnter={(e) => (e.currentTarget.style.color = P.debit)}
          onMouseLeave={(e) => (e.currentTarget.style.color = P.faint)}
        >
          <Trash2 size={13} />
        </button>
      </span>
    </div>
  );

  const renderRow = (i, inGroup) => {
    const overdue = i.dueDate && i.dueDate < todayStr();
    const future = !overdue && i.dueDate && i.dueDate > horizon;

    if (editingId === i.id && editForm) {
      return (
        <div key={i.id} style={{ background: P.bg, border: `1px solid ${P.brass}` }} className="rounded-lg p-3 space-y-2">
          <ARFields kind={kind} f={editForm} set={eset} data={data} addSub={addSub} addCredit={addCredit} />
          <div className="flex gap-2">
    <Btn className="flex-1 justify-center" onClick={saveEdit}><Check size={14} /> Save changes</Btn>
    <Btn tone="ghost" onClick={() => { setEditingId(null); setEditForm(null); }}><X size={14} /></Btn>
          </div>
        </div>
      );
    }
    return (
      <div key={i.id} style={{ background: inGroup ? P.surface : P.bg, border: `1px solid ${overdue ? P.debit : P.line}`, opacity: future ? 0.7 : 1 }} className="rounded-lg p-3 flex items-center gap-2">
        <button onClick={() => { setEditingId(i.id); setEditForm({ ...i, amount: String(i.amount), frequency: i.frequency || "monthly", category: i.category || defaultCat }); }} className="flex-1 min-w-0 text-left" title="Edit">
          <div className="text-sm truncate">{i.party}</div>
          <div style={{ fontFamily: MONO, color: overdue ? P.debit : P.faint }} className="text-xs flex items-center gap-1 flex-wrap" data-meta>
    {isRec(i) && <RecMark />}
    {i.description || "·"} · due {i.dueDate}{overdue ? " · overdue" : ""}{future ? ` · upcoming in ${daysUntil(i.dueDate)}d` : ""}
    {isRec(i) ? ` · ${freqLabel(i.frequency || "monthly")}` : ""}
    {i.subcategory ? ` · ${i.subcategory}` : ""}
          </div>
          {isCredits(i) && (
    <div style={{ fontFamily: MONO, color: P.brass }} className="text-xs">{creditName(data, i.creditId)} credits, no cash moves</div>
          )}
        </button>
        <div style={{ fontFamily: MONO, color: tone }} className="text-sm tabular-nums">{fmt(i.amount)}</div>
        {i.attachmentId && (
          <button onClick={() => openPreview(i.attachmentId, i.attachmentName)} title={`View ${i.attachmentName || "invoice"}`} style={{ color: P.brass, padding: 6, margin: -6 }}>
    <Paperclip size={13} />
          </button>
        )}
        <button onClick={() => { setEditingId(i.id); setEditForm({ ...i, amount: String(i.amount), frequency: i.frequency || "monthly", category: i.category || defaultCat }); }} style={{ color: P.faint, padding: 6, margin: -6 }} title="Edit">
          <Pencil size={13} />
        </button>
        <Btn tone="ghost" onClick={() => setSettleFor(i)} title={`${action}: confirm the actual amount, date, payment, and file the receipt`}>
          <Check size={13} />
        </Btn>
        <button onClick={() => delAR(kind, i.id)} style={{ color: P.faint, padding: 6, margin: -6 }}><Trash2 size={13} /></button>
      </div>
    );
  };

  return (
    <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
      <div className="flex justify-between items-center mb-3 gap-2">
        <h2 style={{ fontFamily: SERIF }} className="text-lg flex-1">{title}</h2>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={(e) => { onInvoice(e.target.files[0]); e.target.value = ""; }} />
        {adding
          ? <button onClick={cancelAdd} style={{ color: P.muted }} className="text-sm px-1" title="Close">Cancel</button>
          : <button onClick={() => setAdding(true)} style={{ color: P.brass }} className="text-sm px-1 inline-flex items-center gap-1">
              <Plus size={15} /> Add
            </button>}
      </div>

      {reading && (
        <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs mb-3 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> reading the invoice…
        </div>
      )}

      {adding && (
        <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-3 mb-3 space-y-2">
          {att && (
            <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs flex items-center gap-1.5">
              <Paperclip size={11} /> {att.name} will be filed with this entry
            </div>
          )}
          <button onClick={() => fileRef.current.click()} disabled={reading}
            style={{ color: P.muted, border: `1px dashed ${P.line}` }}
            className="w-full rounded-lg py-2 text-sm inline-flex items-center justify-center gap-2">
            {reading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            {reading ? "reading the invoice…" : "Upload an invoice to fill this automatically"}
          </button>
          <ARFields kind={kind} f={form} set={set} data={data} addSub={addSub} addCredit={addCredit} />
          {readErr && <p style={{ color: P.brass }} className="text-xs">{readErr}</p>}
          <Btn className="w-full justify-center" onClick={submit}><Check size={14} /> Add</Btn>
        </div>
      )}

      {open.length === 0 && !adding ? (
        <p style={{ color: P.faint }} className="text-sm py-3">Nothing open.</p>
      ) : (
        <div className="space-y-2">
          {openSeq.map((g) => {
            if (g.items.length === 1) return renderRow(g.items[0]);
            const total = g.items.reduce((s, x) => s + x.amount, 0);
            const nextDue = g.items[0].dueDate;
            const expanded = !!openGroups[g.party];
            return (
              <div key={"g:" + g.party} style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg overflow-hidden">
                <button onClick={() => toggleGroup(g.party)} className="w-full p-3 flex items-center gap-2 text-left">
                  <ChevronDown size={15} style={{ color: P.brass, transform: expanded ? "none" : "rotate(-90deg)", transition: "transform .18s" }} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{g.party}</div>
                    <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
                      {g.items.length} items · next due {nextDue}
                    </div>
                  </div>
                  <div style={{ fontFamily: MONO, color: tone }} className="text-sm tabular-nums">{fmt(total)}</div>
                </button>
                {expanded && (
                  <div className="px-3 pb-3 space-y-2">
                    {g.items.map((i) => renderRow(i, true))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {settleFor && (
        <SettleModal
          kind={kind}
          item={settleFor}
          data={data}
          addCredit={addCredit}
          action={action}
          onConfirm={async ({ att, ...actual }) => {
            let attachmentId, attachmentName;
            if (att) {
              attachmentId = await storeAttachment(att);
              // evidence is the point of the dialog: if the file didn't land, nothing settles
              if (!attachmentId) throw new Error("The receipt couldn't be saved to storage. Check your connection and try again.");
              attachmentName = att.name;
            }
            settleAR(kind, settleFor.id, { ...actual, attachmentId, attachmentName });
            setSettleFor(null);
          }}
          onClose={() => setSettleFor(null)}
        />
      )}


      {settled.length > 0 && (
        <div className="mt-4" style={{ borderTop: `1px solid ${P.line}`, paddingTop: "12px" }}>
          <Label>Settled · locked</Label>
          {settledSeq.slice(0, 6).map((g) => {
            if (g.items.length > 1) {
              const gTotal = g.items.reduce((s, x) => s + x.amount, 0);
              const gk = "s:" + g.party;
              return (
                <div key={gk}>
                  <button onClick={() => toggleGroup(gk)} style={{ color: P.muted, fontFamily: MONO }} className="text-xs flex justify-between items-center gap-2 py-1 w-full">
                    <span className="truncate flex items-center gap-1.5">
                      <ChevronDown size={11} style={{ color: P.brass, transform: openGroups[gk] ? "none" : "rotate(-90deg)", transition: "transform .18s" }} />
                      <Lock size={10} style={{ color: P.faint }} />
                      {g.party}
                    </span>
                    <span className="shrink-0">{g.items.length} {kind === "receivables" ? "received" : "paid"} · {fmt(gTotal)} total</span>
                  </button>
                  {openGroups[gk] && g.items.map((i) => <SettledLine key={i.id} i={i} indent />)}
                </div>
              );
            }
            return <SettledLine key={g.items[0].id} i={g.items[0]} />;
          })}
          {noteFor && (
            <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-3 mt-2">
              <div className="flex justify-between items-start gap-2">
                <Label>Note · {noteFor.party}</Label>
                <button onClick={() => setNoteFor(null)} style={{ color: P.faint }}><X size={12} /></button>
              </div>
              <p style={{ color: P.text }} className="text-sm">{noteFor.description || "No note recorded."}</p>
              <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs mt-2">
                {kind === "receivables" ? "received" : "paid"} {noteFor.settledOn}
                {isRec(noteFor) ? ` · was ${freqLabel(noteFor.frequency || "monthly")}` : ""}
                {isCredits(noteFor) ? ` · via ${creditName(data, noteFor.creditId)} credits` : ""}
              </p>
              {noteFor.attachmentId && (
                <button onClick={() => openPreview(noteFor.attachmentId, noteFor.attachmentName)}
                  style={{ color: P.brass }} className="text-xs inline-flex items-center gap-1 mt-2">
                  <Paperclip size={11} /> View filed invoice
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ================= settle confirm: the actuals ================= */
function SettleModal({ kind, item, data, addCredit, action, onConfirm, onClose }) {
  const [amount, setAmount] = useState(String(item.amount));
  const [date, setDate] = useState(todayStr());
  const [payMethod, setPayMethod] = useState(item.payMethod === "credits" ? "credits" : "cash");
  const [creditId, setCreditId] = useState(item.creditId || null);
  const [doc, setDoc] = useState(null);        // the receipt being attached to this settlement
  const [docErr, setDocErr] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = parseFloat(amount);
  const differs = !Number.isNaN(parsed) && parsed > 0 && Math.abs(parsed - item.amount) > 0.005;
  // Nothing settles without paper: either the invoice already filed against this
  // entry, or a receipt attached right here.
  const filedName = item.attachmentId ? (item.attachmentName || "the filed invoice") : null;
  const valid = !Number.isNaN(parsed) && parsed > 0 && date && (doc || filedName);

  const pickDoc = (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setDocErr(`That file is ${(file.size / 1048576).toFixed(1)} MB, max 8 MB. Try a smaller export or a screenshot.`);
      return;
    }
    setDocErr("");
    setDoc({ name: file.name || "receipt.png", type: file.type || attTypeFromName(file.name), file });
  };

  const confirm = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setDocErr("");
    try {
      await onConfirm({ amount: parsed, date, payMethod, creditId, att: doc });
    } catch (e) {
      setDocErr(e?.message || "Something went wrong filing that. Try again.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg w-full max-w-sm p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-1">
          <h3 style={{ fontFamily: SERIF }} className="text-lg">{action}</h3>
          <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
        </div>
        <p style={{ color: P.muted }} className="text-sm mb-3 truncate">{item.party}{item.description ? ` · ${item.description}` : ""}</p>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Actual amount</Label>
            <Input type="number" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} style={{ fontFamily: MONO }} />
          </div>
          <div>
            <Label>{kind === "receivables" ? "Received on" : "Paid on"}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="mt-2">
          <Label>{kind === "receivables" ? "Received as" : "Paid via"}</Label>
          <PayViaSelect data={data} payMethod={payMethod} creditId={creditId} addCredit={addCredit}
            onChange={(pm, cid) => { setPayMethod(pm); setCreditId(cid); }} />
        </div>

        <div className="mt-2">
          <Label>{kind === "receivables" ? "Proof of payment · required" : "Receipt · required"}</Label>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { pickDoc(e.target.files[0]); e.target.value = ""; }} />
          {doc ? (
            <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg px-3 py-2 flex items-center gap-2">
              <Paperclip size={12} style={{ color: P.brass }} className="shrink-0" />
              <span style={{ fontFamily: MONO }} className="text-xs truncate flex-1">{doc.name}</span>
              <button onClick={() => setDoc(null)} style={{ color: P.faint }} title="Remove"><X size={12} /></button>
            </div>
          ) : (
            <button onClick={() => fileRef.current.click()} disabled={saving}
              style={{ color: P.muted, border: `1px dashed ${P.line}` }}
              className="w-full rounded-lg py-2 text-sm inline-flex items-center justify-center gap-2">
              <FileText size={14} />
              {filedName ? "Attach the payment receipt" : "Attach the receipt · photo or PDF"}
            </button>
          )}
          {filedName && !doc && (
            <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs mt-1.5 truncate">
              📎 {filedName} is already filed against this entry, that counts as evidence.
            </p>
          )}
        </div>

        {differs && (
          <p style={{ color: P.brass, fontFamily: MONO }} className="text-xs mt-2">
            estimated {fmt(item.amount)} → actual {fmt(parsed)}; the books record the actual
          </p>
        )}
        {docErr && <p style={{ color: P.brass }} className="text-xs mt-2">{docErr}</p>}

        <Btn className="w-full justify-center mt-4" disabled={!valid || saving} onClick={confirm}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? "filing the receipt…" : `${action} · ${!Number.isNaN(parsed) && parsed > 0 ? fmt(parsed) : "…"}`}
        </Btn>
        <p style={{ color: P.faint }} className="text-xs mt-2">
          {doc || filedName
            ? <>Files the document, logs the transaction, locks this entry{item.recurrence === "recurring" ? ", and queues the next occurrence" : ""}.</>
            : <>A receipt or invoice is required, nothing settles without paper behind it.</>}
        </p>
      </div>
    </div>
  );
}

/* ================= credit pools (AWS, compute, SR&ED, etc.) ================= */
function CreditsCard({ data, addCredit, updateCredit, delCredit }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [used, setUsed] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState(null);
  const pools = data.credits || [];

  const committedFor = (creditId) =>
    data.payables.filter((p) => p.status === "open" && p.creditId === creditId).reduce((s, p) => s + p.amount, 0);
  const trackedSpend = (creditId) =>
    data.transactions.filter((t) => t.creditId === creditId && t.type === "expense").reduce((s, t) => s + t.amount, 0);

  const submit = () => {
    const v = parseFloat(amount);
    if (!name.trim() || Number.isNaN(v)) return;
    const id = addCredit(name.trim(), Math.abs(v));
    const u = parseFloat(used);
    if (!Number.isNaN(u) && u > 0) updateCredit(id, { usedAdjustment: Math.abs(u) });
    setName(""); setAmount(""); setUsed(""); setAdding(false);
  };

  const saveEdit = () => {
    const initial = parseFloat(edit.initial);
    const adj = parseFloat(edit.usedAdjustment);
    updateCredit(editingId, {
      name: edit.name.trim() || "Credits",
      initial: Number.isNaN(initial) ? 0 : Math.abs(initial),
      usedAdjustment: Number.isNaN(adj) ? 0 : Math.abs(adj),
    });
    setEditingId(null); setEdit(null);
  };

  return (
    <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
      <div className="flex justify-between items-center mb-1 gap-2">
        <h2 style={{ fontFamily: SERIF }} className="text-lg">Credits</h2>
        <Btn tone="ghost" onClick={() => setAdding(!adding)}>{adding ? <X size={14} /> : <Plus size={14} />}</Btn>
      </div>
      <p style={{ color: P.faint }} className="text-xs mb-3">
        Non-cash pools, AWS credits, AI compute credits, MongoDB credits, SR&ED. Anything "paid via" a pool draws it
        down instead of your bank balance; the total left shows next to Balance to date up top.
      </p>

      {adding && (
        <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-3 mb-3 grid sm:grid-cols-4 gap-2 items-end">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="MongoDB credits" /></div>
          <div><Label>Granted</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" /></div>
          <div><Label>Already used (before the app)</Label><Input type="number" value={used} onChange={(e) => setUsed(e.target.value)} placeholder="0" /></div>
          <Btn className="justify-center" onClick={submit}><Check size={14} /> Add pool</Btn>
        </div>
      )}

      {pools.length === 0 && !adding ? (
        <p style={{ color: P.faint }} className="text-sm py-2">No credit pools yet, add one with +, or pick "+ add a credit pool…" right inside any Paid via dropdown.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {pools.map((c) => {
            if (editingId === c.id && edit) {
              return (
                <div key={c.id} style={{ background: P.bg, border: `1px solid ${P.brass}` }} className="rounded-lg p-3 space-y-2">
                  <div><Label>Name</Label><Input value={edit.name} onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Granted</Label><Input type="number" value={edit.initial} onChange={(e) => setEdit((p) => ({ ...p, initial: e.target.value }))} /></div>
                    <div><Label>Used outside the app</Label><Input type="number" value={edit.usedAdjustment} onChange={(e) => setEdit((p) => ({ ...p, usedAdjustment: e.target.value }))} /></div>
                  </div>
                  <p style={{ color: P.faint }} className="text-xs">
                    "Used outside the app" covers burn that never went through the ledger, everything you log with
                    "Paid via {c.name}" is subtracted automatically on top of it.
                  </p>
                  <div className="flex gap-2">
                    <Btn className="flex-1 justify-center" onClick={saveEdit}><Check size={14} /> Save</Btn>
                    <Btn tone="ghost" onClick={() => { setEditingId(null); setEdit(null); }}><X size={14} /></Btn>
                  </div>
                </div>
              );
            }
            const remaining = creditRemaining(data, c.id);
            const committed = committedFor(c.id);
            const tracked = trackedSpend(c.id);
            const usedPct = c.initial > 0 ? Math.min(Math.max(((c.initial - remaining) / c.initial) * 100, 0), 100) : 0;
            return (
              <div key={c.id} style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-3">
                <div className="flex justify-between items-baseline gap-2">
                  <button onClick={() => { setEditingId(c.id); setEdit({ name: c.name, initial: String(c.initial), usedAdjustment: String(c.usedAdjustment || 0) }); }} className="text-sm truncate text-left underline decoration-dotted underline-offset-2" style={{ color: P.text, textDecorationColor: P.faint }} title="Edit this pool">
                    {c.name}
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setEditingId(c.id); setEdit({ name: c.name, initial: String(c.initial), usedAdjustment: String(c.usedAdjustment || 0) }); }} style={{ color: P.faint, padding: 6, margin: -6 }} title="Edit"><Pencil size={12} /></button>
                    <button onClick={() => { if (window.confirm(`Remove the ${c.name} pool? Past entries keep their credit tag.`)) delCredit(c.id); }} style={{ color: P.faint, padding: 6, margin: -6 }} title="Remove"><Trash2 size={12} /></button>
                  </div>
                </div>
                <div style={{ fontFamily: MONO, color: remaining > 0 ? P.credit : P.debit }} className="text-lg tabular-nums">
                  {fmt(remaining)} <span style={{ color: P.faint }} className="text-xs">/ {fmt0(c.initial)} left</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: P.surface2 }}>
                  <div style={{ width: `${100 - usedPct}%`, background: P.brass, opacity: 0.8 }} className="h-full" />
                </div>
                <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs mt-1">
                  used: {fmt0((c.usedAdjustment || 0) + tracked)}
                  {(c.usedAdjustment || 0) > 0 ? ` (${fmt0(c.usedAdjustment)} pre-app + ${fmt0(tracked)} tracked)` : ""}
                  {committed > 0 ? ` · ${fmt0(committed)} committed in open payables` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ================= cash calendar: list + month-grid views ================= */
function CashCalendar({ data }) {
  const [view, setView] = useState("list"); // list | grid
  const [span, setSpan] = useState(30);
  const [gridMonth, setGridMonth] = useState(thisMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const today = todayStr();

  const Row = ({ o }) => (
    <div className="flex items-center gap-2 py-1.5">
      {o.kind === "receivables"
        ? <ArrowDownRight size={13} style={{ color: P.credit }} className="shrink-0" />
        : <ArrowUpRight size={13} style={{ color: P.debit }} className="shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{o.party}</div>
        <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
          {o.description || "·"}{isRec(o) ? ` · ${freqLabel(o.frequency || "monthly")}` : ""}{o.projected ? " · projected" : ""}
        </div>
      </div>
      {isCredits(o) && <span style={{ fontFamily: MONO, color: P.brass, border: `1px solid ${P.brass}` }} className="text-xs rounded px-1">{creditName(data, o.creditId)}</span>}
      <div style={{ fontFamily: MONO, color: o.kind === "receivables" ? P.credit : P.debit }} className="text-sm tabular-nums">
        {o.kind === "receivables" ? "+" : "−"}{fmt(o.amount)}
      </div>
    </div>
  );

  const ViewToggle = () => (
    <div className="flex gap-1">
      {[["list", "List"], ["grid", "Calendar"]].map(([k, label]) => (
        <button key={k} onClick={() => setView(k)}
          style={{ fontFamily: MONO, background: view === k ? P.surface2 : "transparent", border: `1px solid ${view === k ? P.brass : P.line}`, color: view === k ? P.text : P.muted }}
          className="rounded px-3 py-1 text-xs">
          {label}
        </button>
      ))}
    </div>
  );

  /* ---------- LIST VIEW ---------- */
  if (view === "list") {
    const end = (() => { const d = new Date(); d.setDate(d.getDate() + span); return d.toISOString().slice(0, 10); })();
    const occ = occurrencesBetween(data, today, end, today);
    const overdue = occ.filter((o) => o.overdue).sort((a, b) => a.due.localeCompare(b.due));
    const upcoming = occ.filter((o) => !o.overdue).sort((a, b) => a.due.localeCompare(b.due));
    const cashIn = upcoming.filter((o) => o.kind === "receivables" && !isCredits(o)).reduce((s, o) => s + o.amount, 0);
    const cashOut = upcoming.filter((o) => o.kind === "payables" && !isCredits(o)).reduce((s, o) => s + o.amount, 0);
    const creditsOut = upcoming.filter((o) => o.kind === "payables" && isCredits(o)).reduce((s, o) => s + o.amount, 0);
    const byDate = upcoming.reduce((m, o) => { (m[o.due] = m[o.due] || []).push(o); return m; }, {});
    const dates = Object.keys(byDate).sort();
    const prettyDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });

    return (
      <div className="space-y-6">
        <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
          <div className="flex flex-wrap justify-between items-start gap-4 mb-3">
            <Stat label={`Expected in · ${span}d`} value={fmt(cashIn)} color={P.credit} />
            <Stat label={`Expected out · ${span}d`} value={fmt(cashOut)} color={P.debit} />
            <Stat label="Net cash impact" value={fmt(cashIn - cashOut)} color={cashIn - cashOut >= 0 ? P.credit : P.debit} />
            <div className="flex flex-col items-end gap-2">
              <ViewToggle />
              <div className="flex gap-1">
                {[30, 90].map((s) => (
                  <button key={s} onClick={() => setSpan(s)}
                    style={{ fontFamily: MONO, background: span === s ? P.surface2 : "transparent", border: `1px solid ${span === s ? P.brass : P.line}`, color: span === s ? P.text : P.muted }}
                    className="rounded px-3 py-1 text-xs">
                    {s} days
                  </button>
                ))}
              </div>
            </div>
          </div>
          {creditsOut > 0 && (
            <p style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
              plus {fmt(creditsOut)} due in credits, not counted in cash impact
            </p>
          )}
        </div>

        {overdue.length > 0 && (
          <section style={{ background: P.surface, border: `1px solid ${P.debit}` }} className="rounded-lg p-4">
            <h2 style={{ fontFamily: SERIF, color: P.debit }} className="text-lg mb-1">Overdue</h2>
            <div className="divide-y" style={{ borderColor: P.line }}>
              {overdue.map((o, i) => <div key={i} style={{ borderColor: P.line }}><Row o={o} /></div>)}
            </div>
          </section>
        )}

        <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
          <h2 style={{ fontFamily: SERIF }} className="text-lg mb-2">Next {span} days</h2>
          {dates.length === 0 ? (
            <p style={{ color: P.faint }} className="text-sm py-4">Nothing due in this window. Recurring receivables and payables you add will project here automatically.</p>
          ) : (
            <div className="space-y-3">
              {dates.map((d) => (
                <div key={d}>
                  <div style={{ fontFamily: MONO, color: d === today ? P.brass : P.faint, borderBottom: `1px solid ${P.line}` }} className="text-xs uppercase tracking-widest pb-1 mb-1">
                    {prettyDate(d)}{d === today ? " · today" : ""}
                  </div>
                  {byDate[d].map((o, i) => <Row key={i} o={o} />)}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  /* ---------- GRID (month calendar) VIEW ---------- */
  const [gy, gm] = gridMonth.split("-").map(Number);
  const first = new Date(gy, gm - 1, 1);
  const daysInMonth = new Date(gy, gm, 0).getDate();
  const startPad = first.getDay(); // 0 = Sunday
  const monthStart = `${gridMonth}-01`;
  const monthEnd = `${gridMonth}-${String(daysInMonth).padStart(2, "0")}`;
  const occ = occurrencesBetween(data, monthStart, monthEnd, today).filter((o) => !o.overdue || (o.due >= monthStart && o.due <= monthEnd));
  const byDay = occ.reduce((m, o) => { (m[o.due] = m[o.due] || []).push(o); return m; }, {});
  const monthIn = occ.filter((o) => !o.overdue && o.kind === "receivables" && !isCredits(o)).reduce((s, o) => s + o.amount, 0);
  const monthOut = occ.filter((o) => !o.overdue && o.kind === "payables" && !isCredits(o)).reduce((s, o) => s + o.amount, 0);

  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${gridMonth}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);

  const dayItems = selectedDay ? byDay[selectedDay] || [] : [];

  return (
    <div className="space-y-6">
      <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Btn tone="ghost" onClick={() => { setGridMonth(shiftMonth(gridMonth, -1)); setSelectedDay(null); }}>‹</Btn>
            <div style={{ fontFamily: MONO }} className="text-sm w-36 text-center">{monthLabel(gridMonth)}</div>
            <Btn tone="ghost" onClick={() => { setGridMonth(shiftMonth(gridMonth, 1)); setSelectedDay(null); }}>›</Btn>
          </div>
          <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
            <span style={{ color: P.credit }}>+{fmt0(monthIn)}</span> / <span style={{ color: P.debit }}>−{fmt0(monthOut)}</span> expected
          </div>
          <ViewToggle />
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} style={{ fontFamily: MONO, color: P.faint }} className="text-xs text-center uppercase tracking-wider">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <div key={i} className="rounded" style={{ background: "transparent", minHeight: 64 }} />;
            const items = byDay[date] || [];
            const dayIn = items.filter((o) => o.kind === "receivables").reduce((s, o) => s + o.amount, 0);
            const dayOut = items.filter((o) => o.kind === "payables").reduce((s, o) => s + o.amount, 0);
            const isToday = date === today;
            const isSel = date === selectedDay;
            const isPast = date < today;
            return (
              <button
                key={i}
                onClick={() => setSelectedDay(isSel ? null : date)}
                style={{
                  background: isSel ? P.surface2 : P.bg,
                  border: `1px solid ${isSel ? P.brass : isToday ? P.brass : P.line}`,
                  opacity: isPast && !items.length ? 0.45 : 1,
                  minHeight: 64,
                }}
                className="rounded p-1 text-left flex flex-col"
              >
                <div style={{ fontFamily: MONO, color: isToday ? P.brass : P.faint }} className="text-xs">{Number(date.slice(8))}</div>
                <div className="flex-1 flex flex-col justify-end gap-0.5">
                  {dayIn > 0 && <div style={{ fontFamily: MONO, color: P.credit, background: P.surface }} className="text-xs rounded px-1 truncate tabular-nums">+{fmt0(dayIn)}</div>}
                  {dayOut > 0 && <div style={{ fontFamily: MONO, color: P.debit, background: P.surface }} className="text-xs rounded px-1 truncate tabular-nums">−{fmt0(dayOut)}</div>}
                  {items.some(isCredits) && <div style={{ background: P.brass }} className="h-0.5 rounded-full w-1/2" title="includes credits" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDay && (
        <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
          <h2 style={{ fontFamily: SERIF }} className="text-lg mb-1">
            {new Date(selectedDay + "T00:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}
          </h2>
          {dayItems.length === 0 ? (
            <p style={{ color: P.faint }} className="text-sm py-2">Nothing due this day.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: P.line }}>
              {dayItems.map((o, i) => <div key={i} style={{ borderColor: P.line }}><Row o={o} /></div>)}
            </div>
          )}
        </section>
      )}
      {!selectedDay && (
        <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs text-center">tap a day to see what's due · brass underline = credits involved</p>
      )}
    </div>
  );
}


/* ================= floating dock button ================= */
function DockBtn({ label, active, onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={label}
      aria-label={label}
      className="dock-btn relative rounded-full flex items-center justify-center shrink-0"
      style={{
        color: active ? "#10120C" : P.muted,
        background: active ? P.brass : "transparent",
        transform: hover && !active ? "translateY(-2px)" : "none",
        transition: "background .25s ease, color .25s ease, transform .18s cubic-bezier(.2,.8,.2,1)",
      }}
    >
      {children}
      {hover && !active && (
        <span
          className="dock-tip"
          style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: P.text, color: P.bg, fontFamily: MONO, fontSize: 11, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none" }}
        >
          {label}
        </span>
      )}
    </button>
  );
}

/* ================= first-visit tutorials ================= */
const TOUR_COPY = {
  overview: ["Your month at a glance", "Planned versus actual, per category. Tap a planned amount to set a budget, tap a category name to see the entries behind it, and use the Brasstally bubble in the corner to capture receipts or ask about balance drift."],
  transactions: ["Every entry lives here", "Add one manually, import a whole bank statement, or use Transfer to move money between your ledgers. Tap the pencil on any row to edit it, and the paperclip to file its receipt."],
  pl: ["Your profit and loss", "Switch between business, personal, and combined scope. Owner draws are excluded, credit-paid costs get their own line, and Export produces a CSV your accountant can use as is."],
  arap: ["Who owes you, who you owe", "Upload an invoice and the fields fill themselves. Recurring items queue their next occurrence automatically when you settle them. Tap any open item to edit everything about it."],
  credits: ["Money that isn't cash", "Pools for AWS credits, compute credits, and the like. Anything paid via a pool draws the pool down instead of your bank balance. Tap a pool to edit it, including credits used before you started tracking."],
  calendar: ["What's coming due", "List view shows the next 30 or 90 days. Calendar view is a month grid, and recurring items are projected onto their future dates. Tap a day to see what lands on it."],
  integrations: ["The outside world", "Connect your bank with Plaid right here, and new transactions arrive in a review you confirm. Tax drafts map your year onto CRA's forms, compute deadlines, and prep the accountant email."],
};

function TourCard({ tab, onDismiss }) {
  const copy = TOUR_COPY[tab];
  if (!copy) return null;
  return (
    <div style={{ background: P.surface, border: `1px solid ${P.line}`, borderLeft: `3px solid ${P.brass}` }} className="rounded-lg p-4 mb-5 flex items-start gap-3">
      <div className="flex-1">
        <div style={{ fontFamily: MONO, color: P.brass }} className="text-xs uppercase tracking-widest mb-1">First time here</div>
        <div style={{ fontFamily: SERIF }} className="text-base mb-1">{copy[0]}</div>
        <p style={{ color: P.muted }} className="text-sm">{copy[1]}</p>
      </div>
      <Btn tone="ghost" onClick={onDismiss} title="Hide this tip"><Check size={14} /> Got it</Btn>
    </div>
  );
}

/* ================= new ledger (onboarding + switcher) ================= */
function NewLedgerModal({ onboarding, onCreate, onClose, onSignOut }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("business");
  const [bal, setBal] = useState("");
  const [asOf, setAsOf] = useState(todayStr());
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await onCreate({ name: name.trim(), kind, startingBalance: parseFloat(bal) || 0, anchorDate: asOf });
    setBusy(false);
  };

  const body = (
    <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="flex justify-between items-start mb-1">
        <h3 style={{ fontFamily: SERIF }} className="text-xl">{onboarding ? "Set up your first ledger" : "New ledger"}</h3>
        {!onboarding && <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>}
      </div>
      <p style={{ color: P.muted }} className="text-sm mb-4">
        Brasstally is built from ledgers. A Business Ledger keeps a company's books; a Personal Ledger keeps yours. Add as many as you run and switch from the header.
      </p>
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "business" ? "e.g. GENIE AI" : "e.g. Bilal, personal"} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <div>
          <Label>Type</Label>
          <div className="flex gap-1">
            {[["business", "Business Ledger"], ["personal", "Personal Ledger"]].map(([k, label]) => (
              <button key={k} onClick={() => setKind(k)}
                style={{ background: kind === k ? P.surface2 : "transparent", border: `1px solid ${kind === k ? P.brass : P.line}`, color: kind === k ? P.text : P.muted }}
                className="flex-1 rounded px-2 py-1.5 text-sm">
                {label}
              </button>
            ))}
          </div>
          <p style={{ color: P.faint }} className="text-xs mt-1">
            {kind === "business" ? "A Business Ledger starts with revenue, salaries, software, and hosting categories, and unlocks the CRA T2 draft." : "A Personal Ledger starts with home, food, and transport categories, and keeps your own money out of the company's books."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Current balance</Label><Input type="number" value={bal} onChange={(e) => setBal(e.target.value)} placeholder="0.00" /></div>
          <div><Label>As of</Label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
        </div>
        <Btn className="w-full justify-center" disabled={busy || !name.trim()} onClick={submit}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create ledger
        </Btn>
        {onboarding && (
          <button onClick={onSignOut} style={{ color: P.faint, fontFamily: MONO }} className="w-full text-center text-xs underline decoration-dotted">sign out</button>
        )}
      </div>
    </div>
  );

  if (onboarding)
    return (
      <div style={{ background: P.bg, minHeight: "100vh", fontFamily: SANS, color: P.text }} className="flex items-center justify-center p-4">
        {body}
      </div>
    );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      {body}
    </div>
  );
}

/* ================= getting started =================
   Four things have to be true before the app is worth anything: a ledger, a
   bank feed, an entry, and something to compare spending against. Nobody reads
   a welcome tour, so this is not one. It is the four things, each a button that
   does the thing, and it disappears on its own once they are done. */

function SetupChecklist({ data, bankConns, onGo, openGuide, onDismiss }) {
  const hasBank = (bankConns?.length || 0) > 0;
  const hasEntry = (data.transactions?.length || 0) > 0;
  const hasBudget = ["expense", "income"].some((t) => (data.categories?.[t] || []).some((c) => Number(c.planned) > 0));
  const metGuide = Boolean(window.localStorage.getItem("guide:used"));

  const steps = [
    {
      id: "ledger", done: true,
      title: `${data.ledger.name} is set up`,
      sub: `A ${kindLabel(data.ledger.kind)}. You can add more and switch from the title at the top.`,
    },
    {
      id: "bank", done: hasBank,
      title: "Connect your bank",
      sub: "You sign in on your bank's own screen. Brasstally never sees the password and cannot move money. This is what makes the balance real instead of typed.",
      action: ["Connect it", () => onGo("integrations")],
      help: "bank-feed",
    },
    {
      id: "entry", done: hasEntry,
      title: "Put something in the books",
      sub: "Photograph a receipt, or just type what you paid. Either way it reads the amount, the merchant, and the date for you.",
      action: ["Capture something", () => onGo("capture")],
    },
    {
      id: "budget", done: hasBudget,
      title: "Say what you expect to spend",
      sub: "Set a monthly figure on a category or two. Without one, over budget has nothing to mean.",
      action: ["Set a budget", () => onGo("overview")],
    },
    {
      id: "guide", done: metGuide,
      title: "Meet your guides",
      sub: "Every section has a help anchor that already knows what that screen is for. Tax, bank, consolidating, money owed.",
      action: ["Try one", () => openGuide("bank-feed")],
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <section style={{ background: P.surface, border: `1px solid ${P.brass}` }} className="rounded-lg p-5 mb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 style={{ fontFamily: SERIF }} className="text-lg leading-tight">Getting set up</h2>
          <p style={{ color: P.muted }} className="text-sm">{doneCount} of {steps.length} done. This card goes away by itself.</p>
        </div>
        <button onClick={onDismiss} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2 shrink-0">
          hide it
        </button>
      </div>

      <div className="mt-4 space-y-1">
        {steps.map((s) => (
          <div key={s.id} className="flex items-start gap-3 py-2" style={{ borderTop: `1px solid ${P.line}` }}>
            <span style={{ color: s.done ? P.credit : P.faint, border: `1px solid ${s.done ? P.credit : P.line}` }}
              className="rounded-full shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center">
              {s.done ? <Check size={12} /> : null}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm" style={{ color: s.done ? P.faint : P.text }}>{s.title}</div>
              {!s.done && <div style={{ color: P.muted }} className="text-xs mt-0.5">{s.sub}</div>}
            </div>
            {!s.done && s.action && (
              <div className="flex items-center gap-2 shrink-0">
                {s.help && <GuideAnchor id={s.help} onOpen={openGuide} label="Guide me" />}
                <Btn onClick={s.action[1]}>{s.action[0]}</Btn>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ================= Integrations: bank feed + CRA T2 ================= */
const GIFI_RULES = [
  [/salar|wage|contractor|payroll/i, "9060", "Salaries and wages"],
  [/host|cloud|server|data/i, "8614", "Data processing"],
  [/software|saas|subscri|office/i, "8810", "Office expenses"],
  [/market|advert|promo/i, "8520", "Advertising and promotion"],
  [/professional|account|legal/i, "8860", "Professional fees"],
  [/travel/i, "9200", "Travel expenses"],
  [/rent/i, "8910", "Rental"],
  [/insur/i, "8690", "Insurance"],
  [/bank|interest|fee/i, "8710", "Interest and bank charges"],
  [/equip|repair/i, "8960", "Repairs and maintenance"],
];
const gifiFor = (category, subcategory) => {
  const key = `${subcategory || ""} ${category || ""}`;
  for (const [re, code, name] of GIFI_RULES) if (re.test(key)) return { code, name };
  return { code: "9270", name: "Other expenses" };
};

/* CRA-form-styled PDF: line codes, right-ruled amounts, parenthesized negatives, draft banner */
const pdfMoney = (n) => (n < 0 ? "(" : "") + Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (n < 0 ? ")" : "");

function taxPdf({ filename, formTitle, formSub, ident, columns, rows, note }) {
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const W = 215.9, L = 16, R = W - 16;
  let y = 18;
  const hr = (yy, dark) => { doc.setDrawColor(dark ? 60 : 150); doc.setLineWidth(dark ? 0.4 : 0.2); doc.line(L, yy, R, yy); };
  const pageBreak = () => { if (y > 260) { doc.addPage(); y = 18; } };

  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(formTitle, L, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text("DRAFT · for preparation only", R, y, { align: "right" });
  y += 5.5;
  doc.setFontSize(10);
  doc.text(formSub, L, y);
  y += 3; hr(y, true); y += 6;

  doc.setFontSize(9);
  ident.forEach(([k, v]) => {
    pageBreak();
    doc.setFont("helvetica", "normal"); doc.text(k, L, y);
    doc.setFont("helvetica", "bold"); doc.text(String(v), L + 48, y);
    y += 5;
  });
  y += 1.5; hr(y); y += 6;

  doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.text(columns[0], L, y);
  doc.text(columns[1], L + 24, y);
  doc.text(columns[2], R, y, { align: "right" });
  y += 2.5; hr(y, true); y += 5.5;

  doc.setFontSize(9.5);
  rows.forEach((r) => {
    pageBreak();
    if (r.section) {
      y += 1;
      doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(r.section.toUpperCase(), L, y);
      doc.setFontSize(9.5);
      y += 5.5;
      return;
    }
    doc.setFont("helvetica", r.strong ? "bold" : "normal");
    if (r.final) { doc.setDrawColor(40); doc.setLineWidth(0.3); doc.line(L + 128, y - 4.4, R, y - 4.4); doc.line(L + 128, y - 3.6, R, y - 3.6); }
    if (r.code) doc.text(String(r.code), L, y);
    doc.text(doc.splitTextToSize(r.name, 116)[0], L + 24, y);
    if (r.amount !== null && r.amount !== undefined) doc.text(pdfMoney(r.amount), R, y, { align: "right" });
    y += 5.5;
    if (r.strong && !r.final) hr(y - 4);
  });
  y += 0.5; hr(y, true); y += 5.5;

  if (note) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8.5);
    doc.splitTextToSize(note, R - L).forEach((t) => { pageBreak(); doc.text(t, L, y); y += 4; });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(`Prepared in Brasstally · ${todayStr()} · draft for use with CRA-certified software, not a filed return`, L, 279);
    doc.text(`Page ${i} of ${pages}`, R, 279, { align: "right" });
    doc.setTextColor(0);
  }
  doc.save(filename);
}

function fiscalWindow(fye, endYear) {
  // fye "MM-DD"; returns [startDate, endDate] for the fiscal year ending in endYear
  const end = `${endYear}-${fye}`;
  const s = new Date(end + "T00:00:00");
  s.setFullYear(s.getFullYear() - 1);
  s.setDate(s.getDate() + 1);
  return [s.toISOString().slice(0, 10), end];
}

/** FY end years that contain at least one transaction, given ledger FYE (MM-DD). */
function fyEndYearsFromTxs(txs, fye) {
  const years = new Set();
  for (const t of txs) {
    const date = t.date || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const y = Number(date.slice(0, 4));
    const mmdd = date.slice(5);
    // After the FYE calendar day, the tx belongs to the next FY end year
    years.add(mmdd <= fye ? y : y + 1);
  }
  return [...years].sort((a, b) => b - a);
}

const addMonths = (dateStr, m) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + m);
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
};

/* ================= the guide anchor =================
   A section-sized invitation to be helped. It opens the same chat panel, but
   hands over the brief for the section it sits in, so the first message already
   knows what the user was looking at. Purpose built beats general purpose:
   "walk me through my T1" answered by something that already knows what a T1
   section is for reads very differently from the same question typed cold. */

function GuideAnchor({ id, onOpen, label }) {
  const g = GUIDES[id];
  const [hover, setHover] = useState(false);
  if (!g || !onOpen) return null;
  return (
    <button
      onClick={() => onOpen(id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={g.blurb}
      style={{
        border: `1px solid ${hover ? P.brass : P.line}`,
        background: hover ? P.brass + "18" : "transparent",
        color: hover ? P.brass : P.muted,
      }}
      className="rounded-full pl-1 pr-3 py-1 inline-flex items-center gap-2 shrink-0 transition-colors"
    >
      <span
        style={{ background: P.brass + "22", border: `1px solid ${P.brass}`, color: P.brass, fontFamily: MONO, width: 24, height: 24 }}
        className="rounded-full text-xs flex items-center justify-center shrink-0"
      >
        {g.avatar}
      </span>
      <span style={{ fontFamily: MONO }} className="text-xs whitespace-nowrap">{label || "Need a hand?"}</span>
    </button>
  );
}

/* ================= filing deadlines =================
   The question a tax section has to answer before any other is "how long have
   I got". It goes at the top and it is always visible, draft or no draft. */

const TONE = { late: "debit", soon: "brass", ok: "credit", far: "muted" };

function DeadlineStrip({ rows, title = "Deadlines" }) {
  if (!rows?.length) return null;
  const next = nextDeadline(rows);
  const c = countdown(next.days);
  return (
    <div style={{ background: P.bg, border: `1px solid ${P[TONE[c.tone]] || P.line}` }} className="rounded-lg p-4 mt-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs uppercase tracking-wider">Next up</div>
          <div style={{ fontFamily: SERIF }} className="text-lg leading-tight">{next.title}</div>
          <div style={{ fontFamily: MONO, color: P.brass }} className="text-sm">{longDate(next.date)}</div>
        </div>
        <div style={{ color: P[TONE[c.tone]] || P.text, border: `1px solid ${P[TONE[c.tone]] || P.line}`, fontFamily: MONO }}
          className="rounded-full px-3 py-1 text-sm whitespace-nowrap">
          {c.text}
        </div>
      </div>
      <div style={{ color: P.muted }} className="text-xs mt-1">{next.sub}</div>

      {rows.length > 1 && (
        <div style={{ borderTop: `1px solid ${P.line}` }} className="mt-3 pt-2 space-y-1">
          <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs uppercase tracking-wider mb-1">{title}</div>
          {rows.map((r) => {
            const rc = countdown(r.days);
            return (
              <div key={r.id} className="flex items-center gap-3 text-xs">
                <span style={{ fontFamily: MONO, color: P.muted }} className="w-28 shrink-0">{longDate(r.date)}</span>
                <span style={{ color: P.text }} className="flex-1 min-w-0 truncate">{r.title}</span>
                <span style={{ fontFamily: MONO, color: P[TONE[rc.tone]] || P.faint }} className="shrink-0">{rc.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================= the filing package =================
   Which forms the return is actually made of, and which issue of each one this
   tax year files on. The version matters: CRA reissues a schedule when the law
   behind it changes and heads the new one "20XX and later tax years", so a 2023
   return and a 2025 return are assembled from different stacks. */

const NEED_LABEL = {
  always: ["Always file", "Every T2 return includes these."],
  usually: ["Almost certainly you", "Standard for a small Canadian corporation. Confirm each one applies."],
  if: ["Only if it applies", "Skip anything that isn't true of your corporation."],
};

function FormRow({ f, checked, onToggle }) {
  return (
    <div className="flex items-start gap-2 py-1.5" style={{ borderTop: `1px solid ${P.line}` }}>
      <button onClick={onToggle} title={checked ? "Mark as still to do" : "Mark as done"}
        style={{ color: checked ? P.credit : P.faint, border: `1px solid ${checked ? P.credit : P.line}` }}
        className="rounded shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center">
        {checked ? <Check size={11} /> : null}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span style={{ fontFamily: MONO, color: P.brass }} className="text-xs">{f.code}</span>
          <span className="text-sm" style={{ color: checked ? P.faint : P.text }}>{f.name}</span>
          {f.fromLedger && (
            <span style={{ fontFamily: MONO, color: P.credit, border: `1px solid ${P.credit}` }} className="text-xs rounded px-1">
              drafted here
            </span>
          )}
        </div>
        <div style={{ color: P.muted }} className="text-xs mt-0.5">{f.when}</div>
      </div>
      <div className="shrink-0 text-right">
        {f.notYet ? (
          <span style={{ fontFamily: MONO, color: P.faint }} className="text-xs">not in this year</span>
        ) : (
          <a href={f.url} target="_blank" rel="noreferrer"
            style={{ fontFamily: MONO, color: P.brass }} className="text-xs underline decoration-dotted underline-offset-2 whitespace-nowrap">
            {f.version} issue ↗
          </a>
        )}
      </div>
    </div>
  );
}

function FilingPackage({ taxYear, province, done, setDone }) {
  const [openGroup, setOpenGroup] = useState({ always: true, usually: true, if: false });
  const [showDiff, setShowDiff] = useState(false);
  const pkg = useMemo(() => t2PackageFor(taxYear, province), [taxYear, province]);
  const groups = { always: [], usually: [], if: [] };
  for (const f of pkg) (groups[f.need] || groups.if).push(f);

  // The stack this year files on, against the one before it. Computed from the
  // version lists rather than asserted, so it stays right as CRA reissues forms.
  const diff = useMemo(() => stackDiff(taxYear - 1, taxYear, province), [taxYear, province]);
  const changed = diff.added.length + diff.dropped.length + diff.moved.length;
  const separate = province ? SEPARATE_PROVINCIAL_RETURN[province] : null;

  const requiredDone = groups.always.filter((f) => done[f.code]).length;

  return (
    <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Label>The {taxYear} filing package</Label>
          <p style={{ color: P.muted }} className="text-xs">
            Every form CRA expects with a T2, on the issue that {taxYear} files on. Tick them off as they are done.
          </p>
        </div>
        <span style={{ fontFamily: MONO, color: requiredDone === groups.always.length ? P.credit : P.faint }} className="text-xs whitespace-nowrap">
          {requiredDone} / {groups.always.length} required
        </span>
      </div>

      {separate && (
        <p style={{ color: P.brass }} className="text-xs mt-2">{separate.note}</p>
      )}

      {changed > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowDiff(!showDiff)} style={{ color: P.brass, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">
            {showDiff ? "hide" : "show"} what changed from {taxYear - 1} to {taxYear} ({changed})
          </button>
          {showDiff && (
            <div className="mt-2 space-y-1">
              {diff.added.map((f) => (
                <div key={"a" + f.code} style={{ fontFamily: MONO, color: P.credit }} className="text-xs">
                  new · {f.code} {f.name} first appears in the {f.version} issue
                </div>
              ))}
              {diff.moved.map((f) => (
                <div key={"m" + f.code} style={{ fontFamily: MONO, color: P.brass }} className="text-xs">
                  reissued · {f.code} moves from the {f.from} issue to the {f.version} issue
                </div>
              ))}
              {diff.dropped.map((f) => (
                <div key={"d" + f.code} style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
                  gone · {f.code} is not part of the {taxYear} stack
                </div>
              ))}
              <p style={{ color: P.faint }} className="text-xs pt-1">
                Filing an older year on the current PDF is a real error. Each link above already points at the issue for {taxYear}.
              </p>
            </div>
          )}
        </div>
      )}

      {["always", "usually", "if"].map((k) => {
        const [title, sub] = NEED_LABEL[k];
        const list = groups[k];
        if (!list.length) return null;
        const open = openGroup[k];
        return (
          <div key={k} className="mt-4">
            <button onClick={() => setOpenGroup((g) => ({ ...g, [k]: !g[k] }))} className="w-full text-left">
              <div className="flex items-center gap-2">
                <ChevronRight size={13} style={{ color: P.faint, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                <span style={{ fontFamily: MONO, color: P.brass }} className="text-xs uppercase tracking-wider">{title}</span>
                <span style={{ fontFamily: MONO, color: P.faint }} className="text-xs">({list.length})</span>
              </div>
              <div style={{ color: P.faint }} className="text-xs ml-5">{sub}</div>
            </button>
            {open && (
              <div className="mt-1">
                {list.map((f) => (
                  <FormRow key={f.code} f={f} checked={Boolean(done[f.code])}
                    onToggle={() => setDone({ ...done, [f.code]: !done[f.code] })} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ borderTop: `1px solid ${P.line}` }} className="mt-4 pt-3">
        <Label>Forms that travel with the return</Label>
        {T2_COMPANION_FORMS.map((f) => (
          <div key={f.code} className="flex items-start gap-2 text-xs py-1">
            <span style={{ fontFamily: MONO, color: P.brass }} className="w-20 shrink-0">{f.code}</span>
            <span className="flex-1 min-w-0"><span style={{ color: P.text }}>{f.name}</span> <span style={{ color: P.muted }}>{f.when}</span></span>
          </div>
        ))}
      </div>

      <p style={{ color: P.faint }} className="text-xs mt-3">
        Version list read from CRA's own form pages. <a href={CRA_FORMS_INDEX} target="_blank" rel="noreferrer" style={{ color: P.brass }} className="underline decoration-dotted">CRA forms and publications ↗</a>
      </p>
    </div>
  );
}

/* ================= sending the package to an accountant =================
   A mailto link cannot carry a file and quietly truncates a long body, which is
   why the old version looked like it worked and didn't. So: write the files to
   disk first, keep the body short enough that every mail client survives it,
   and say plainly that the two files have to be dragged into the draft. */

const MAILTO_BODY_LIMIT = 1400;

function SendToAccountant({ subject, shortBody, fullText, files, email, setEmail, note, setNote, guide }) {
  const [stage, setStage] = useState("idle"); // idle | prepared
  const [copied, setCopied] = useState("");
  const valid = /.+@.+\..+/.test(email.trim());

  const body = (() => {
    const composed = `${note.trim()}\n\n${shortBody}`;
    return composed.length > MAILTO_BODY_LIMIT
      ? `${composed.slice(0, MAILTO_BODY_LIMIT)}\n\n(The full figures are in the attached files.)`
      : composed;
  })();

  // Staggered on purpose. Two downloads fired in the same tick is the pattern
  // browsers treat as a multiple-download prompt, and one of the two files
  // quietly not arriving is exactly the failure this flow exists to prevent.
  const prepare = () => {
    files.forEach((f, i) => setTimeout(() => f.download(), i * 350));
    setStage("prepared");
  };

  const copy = (what, text) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(""), 2000);
  };

  return (
    <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <Label>Send it to your accountant</Label>
        {guide}
      </div>

      <div className="space-y-2 mt-1">
        <div><Label>Accountant's email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="taxes@yourcpa.ca" /></div>
        <div>
          <Label>Message</Label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            style={{ background: P.surface, border: `1px solid ${P.line}`, color: P.text }}
            className="rounded px-2 py-1.5 text-sm w-full outline-none" />
        </div>

        {stage === "idle" ? (
          <>
            <Btn className="w-full justify-center" onClick={prepare}>
              <Download size={14} /> Prepare the package ({files.length} {files.length === 1 ? "file" : "files"})
            </Btn>
            <p style={{ color: P.faint }} className="text-xs">
              Downloads {files.map((f) => f.label).join(" and ")}, then opens your email app with the message ready. Email links cannot attach files by themselves, so the last step is dragging those two in.
            </p>
          </>
        ) : (
          <div style={{ border: `1px solid ${P.credit}` }} className="rounded-lg p-3 space-y-2">
            <div style={{ color: P.credit, fontFamily: MONO }} className="text-xs">
              <Check size={12} className="inline mb-0.5" /> {files.length} {files.length === 1 ? "file is" : "files are"} in your Downloads folder
            </div>
            {files.map((f) => (
              <div key={f.name} style={{ fontFamily: MONO, color: P.muted }} className="text-xs flex items-center gap-1.5">
                <Paperclip size={11} style={{ color: P.brass }} /> {f.name}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a href={valid ? `mailto:${email.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : undefined}
                style={{ background: valid ? P.brass : P.surface2, color: "#10120C", opacity: valid ? 1 : 0.4, pointerEvents: valid ? "auto" : "none" }}
                className="rounded px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5">
                <Mail size={14} /> Open the draft
              </a>
              <Btn tone="ghost" onClick={() => copy("email", `To: ${email}\nSubject: ${subject}\n\n${note}\n\n${fullText}`)}>
                {copied === "email" ? <Check size={13} /> : null} {copied === "email" ? "Copied" : "Copy the whole email instead"}
              </Btn>
              <Btn tone="ghost" onClick={() => setStage("idle")}>Start over</Btn>
            </div>
            <p style={{ color: P.faint }} className="text-xs">
              Then drag {files.length === 1 ? "the file" : "both files"} into the draft before you send. If your email app did not open, use Copy and paste it into webmail.
            </p>
            {!valid && <p style={{ color: P.brass }} className="text-xs">Add their email address above to open the draft.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function IntegrationsTab({ data, updateLedgerMeta, onSynced, onConnectionsChange, openGuide, onReview }) {
  const isBiz = data.ledger.kind === "business";
  const bizTx = data.transactions.filter((t) => (isBiz ? true : t.account === "business"));
  const fye = data.ledger.fye || "12-31";
  const yearsAvail = fyEndYearsFromTxs(bizTx, fye);
  const [fy, setFy] = useState(yearsAvail[0] || new Date().getFullYear());
  const [draft, setDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [accEmail, setAccEmail] = useState("");
  const [accNote, setAccNote] = useState(`Hi, attached is our GIFI coded T2 draft for ${data.ledger.name}. Balance sheet items still to come from our side. Can you review and let me know what else you need?`);
  // Province drives which provincial tax calculation schedule belongs in the
  // package, and whether the province collects its own corporate tax at all.
  // Kept on the device rather than in a new column, so no migration is needed
  // to answer a question that only shapes a checklist.
  const provKey = `ledger:${data.ledger.id}:province`;
  const [province, setProvince] = useState(() => window.localStorage.getItem(provKey) || "ON");
  const setProv = (v) => { setProvince(v); window.localStorage.setItem(provKey, v); };
  const [sbd, setSbd] = useState(true);   // claiming the small business deduction
  const [sred, setSred] = useState(false);
  const doneKey = `ledger:${data.ledger.id}:T2:${fy}:done`;
  const [pkgDone, setPkgDone] = useState({});
  useEffect(() => {
    try { setPkgDone(JSON.parse(window.localStorage.getItem(doneKey) || "{}")); }
    catch { setPkgDone({}); }
  }, [doneKey]);
  const savePkgDone = (next) => {
    setPkgDone(next);
    try { window.localStorage.setItem(doneKey, JSON.stringify(next)); } catch { /* private mode */ }
  };

  // Keep selected FY valid when FYE or txs change
  useEffect(() => {
    if (yearsAvail.length && !yearsAvail.includes(fy)) setFy(yearsAvail[0]);
  }, [fye, yearsAvail.join(","), fy]);

  const [fyStart, fyEnd] = fiscalWindow(fye, fy);
  const fyTx = bizTx.filter((t) => t.date >= fyStart && t.date <= fyEnd && !t.plExclude);
  const revenue = fyTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const byGifi = {};
  fyTx.filter((t) => t.type === "expense").forEach((t) => {
    const g = gifiFor(t.category, t.subcategory);
    const k = g.code + "|" + g.name;
    byGifi[k] = (byGifi[k] || 0) + t.amount;
  });
  const totalExp = Object.values(byGifi).reduce((s, v) => s + v, 0);
  const net = revenue - totalExp;
  const creditsCovered = fyTx.filter((t) => t.type === "expense" && isCredits(t)).reduce((s, t) => s + t.amount, 0);

  const gifiRows = [
    { code: "8000", name: "Trade sales of goods and services", amount: revenue },
    { code: "8299", name: "Total revenue", amount: revenue, strong: true },
    ...Object.entries(byGifi).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const [code, name] = k.split("|");
      return { code, name, amount: -v };
    }),
    { code: "9368", name: "Total expenses", amount: -totalExp, strong: true },
    { code: "9999", name: "Net income / (loss) before taxes", amount: net, strong: true, final: true },
  ];

  const draftText = () =>
    `T2 DRAFT · ${data.ledger.name} · FY ${fyStart} to ${fyEnd}\n` +
    gifiRows.map((r) => `${r.code}  ${r.name}: ${r.amount.toFixed(2)}`).join("\n") +
    (creditsCovered > 0 ? `\nNote: ${creditsCovered.toFixed(2)} of expenses covered by vendor credits (non-cash), flag for SR&ED/ITC review.` : "");

  const copyDraft = () => {
    navigator.clipboard?.writeText(draftText().replace(/\\n/g, "\n")).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const exportGifiPDF = () => {
    taxPdf({
      filename: `T2_S125_GIFI_${data.ledger.name.replace(/\s/g, "")}_FY${fy}.pdf`,
      formTitle: "Schedule 125 · Income Statement Information",
      formSub: `General Index of Financial Information (GIFI) · draft prepared from the ${data.ledger.name} ledger`,
      ident: [
        ["Corporation's name", data.ledger.name],
        ["Business number (BN)", "_________ RC0001 (to be completed)"],
        ["Tax year", `${fyStart} to ${fyEnd}`],
        ["Currency", data.ledger.currency || "CAD"],
      ],
      columns: ["GIFI code", "Description", "Amount"],
      rows: gifiRows.map((r) => ({ code: r.code, name: r.name, amount: r.amount, strong: r.strong, final: r.final })),
      note: (creditsCovered > 0 ? `Note for the preparer: ${pdfMoney(creditsCovered)} of expenses were covered by vendor credits (non-cash); review treatment for SR&ED / ITC purposes. ` : "")
        + "GIFI codes were inferred from ledger categories; confirm mappings before filing. Schedule 100 (balance sheet) items are not tracked in this ledger.",
    });
  };
  const exportGifiCSV = () => {
    downloadCSV(`T2_GIFI_${data.ledger.name.replace(/\s/g, "")}_FY${fy}.csv`, [
      [`T2 draft (GIFI) · ${data.ledger.name}`, `${fyStart} to ${fyEnd}`],
      [],
      ["GIFI code", "Line", "Amount"],
      ...gifiRows.map((r) => [r.code, r.name, r.amount.toFixed(2)]),
      [],
      ["Covered by vendor credits (non-cash)", "", creditsCovered.toFixed(2)],
    ]);
  };
  const deadlines = t2Deadlines(fyEnd, { smallBusinessDeduction: sbd, sred });
  const emailSubject = `${data.ledger.name}, T2 draft for FY ${fy}`;
  // Short enough that every mail client survives it. The figures ride in the
  // files, which is the only way they arrive intact anyway.
  const emailShortBody =
    `T2 draft, ${data.ledger.name}\n` +
    `Fiscal year: ${fyStart} to ${fyEnd}\n` +
    `Revenue: ${fmt(revenue)}\n` +
    `Expenses: ${fmt(totalExp)}\n` +
    `Net before taxes: ${fmt(net)}\n` +
    (creditsCovered > 0 ? `Of the expenses, ${fmt(creditsCovered)} was covered by vendor credits and never moved cash.\n` : "") +
    `\nAttached: the GIFI coded Schedule 125 working paper (PDF) and the same figures as a CSV.\n` +
    `Balance sheet items for Schedule 100 are not tracked in this ledger and still need to come from us.`;

  return (
    <div className="space-y-6">
      <BankFeedCard data={data} onSynced={onSynced} onConnectionsChange={onConnectionsChange} openGuide={openGuide} onReview={onReview} />

      {/* ---------- CRA: T2 for business ledgers, T1 for personal ---------- */}
      {!isBiz ? <PersonalTaxCard data={data} openGuide={openGuide} /> : (
      <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 style={{ fontFamily: SERIF }} className="text-lg leading-tight">Corporate tax (T2)</h2>
            <p style={{ color: P.muted }} className="text-sm">Your year, mapped onto the forms CRA expects</p>
          </div>
          <GuideAnchor id="filing-t2" onOpen={openGuide} label="Walk me through it" />
        </div>

        <DeadlineStrip rows={deadlines} title={`All deadlines for the year ending ${longDate(fyEnd)}`} />

        <div className="grid sm:grid-cols-4 gap-3 mt-4 items-end">
          <div>
            <Label>Fiscal year ending</Label>
            <Select value={fy} onChange={(e) => { setFy(Number(e.target.value)); setDraft(false); }}>
              {(yearsAvail.length ? yearsAvail : [new Date().getFullYear()]).map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
          <div>
            <Label>Year-end date</Label>
            <Select value={fye} onChange={(e) => updateLedgerMeta({ fye: e.target.value })}>
              {["12-31", "01-31", "02-28", "03-31", "04-30", "05-31", "06-30", "07-31", "08-31", "09-30", "10-31", "11-30"].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Province</Label>
            <Select value={province} onChange={(e) => setProv(e.target.value)}>
              {PROVINCES.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
            </Select>
          </div>
          <div>
            <Btn className="w-full justify-center" onClick={() => setDraft(true)}><FileText size={14} /> Build the package</Btn>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mt-3">
          {[
            [sbd, setSbd, "Claiming the small business deduction", "Moves the balance due date from 2 months after year end to 3."],
            [sred, setSred, "Claiming SR&ED", "Adds the T661 cutoff, 18 months after year end and not extendable."],
          ].map(([on, set, label, why]) => (
            <button key={label} onClick={() => set(!on)} className="flex items-start gap-2 text-left">
              <span style={{ color: on ? P.credit : P.faint, border: `1px solid ${on ? P.credit : P.line}` }}
                className="rounded shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center">
                {on ? <Check size={11} /> : null}
              </span>
              <span>
                <span className="text-xs" style={{ color: P.text }}>{label}</span>
                <span className="block text-xs" style={{ color: P.faint }}>{why}</span>
              </span>
            </button>
          ))}
        </div>

        {draft && (
          <div className="mt-4 space-y-4">
            <FilingPackage taxYear={fy} province={province} done={pkgDone} setDone={savePkgDone} />

            <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
              <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                <Label>Schedule 125 · income statement (GIFI) · {fyStart} → {fyEnd}</Label>
                <div className="flex gap-2">
                  <Btn tone="ghost" onClick={copyDraft}>{copied ? <Check size={13} /> : null} {copied ? "Copied" : "Copy"}</Btn>
                  <Btn tone="ghost" onClick={exportGifiCSV}><Download size={13} /> CSV</Btn>
                  <Btn tone="ghost" onClick={exportGifiPDF}><FileText size={13} /> PDF</Btn>
                </div>
              </div>
              {fyTx.length === 0 ? (
                <p style={{ color: P.faint }} className="text-sm py-3">No business activity recorded in this fiscal year.</p>
              ) : (
                <div className="divide-y" style={{ borderColor: P.line }}>
                  {gifiRows.map((r) => (
                    <div key={r.code + r.name} className="flex items-center gap-3 py-1.5" style={{ borderColor: P.line }}>
                      <span style={{ fontFamily: MONO, color: P.brass }} className="text-xs w-12 shrink-0">{r.code}</span>
                      <span className={"flex-1 text-sm truncate " + (r.strong ? "font-medium" : "")} style={{ color: r.strong ? P.text : P.muted }}>{r.name}</span>
                      <span style={{ fontFamily: MONO, color: r.final ? (r.amount >= 0 ? P.credit : P.debit) : r.amount >= 0 ? P.credit : P.text, borderTop: r.final ? `1px double ${P.brass}` : "none" }} className="text-sm tabular-nums">{fmt(r.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {creditsCovered > 0 && (
                <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs mt-2">
                  note for your accountant: {fmt(creditsCovered)} of expenses were covered by vendor credits (non-cash), flag for SR&ED/ITC review
                </p>
              )}
              <p style={{ color: P.faint }} className="text-xs mt-2">
                GIFI codes are inferred from your categories and subcategories, so have your accountant confirm the mapping.
                Schedule 100 needs assets and liabilities this ledger does not track.
              </p>
            </div>
            <FilingConnector data={data} form="T2" taxYear={fy} accountantEmail={accEmail} />

            <SendToAccountant
              subject={emailSubject}
              shortBody={emailShortBody}
              fullText={draftText()}
              email={accEmail}
              setEmail={setAccEmail}
              note={accNote}
              setNote={setAccNote}
              guide={<GuideAnchor id="filing-t2" onOpen={openGuide} label="What do they need?" />}
              files={[
                { name: `T2_S125_GIFI_${data.ledger.name.replace(/\s/g, "")}_FY${fy}.pdf`, label: "the working paper PDF", download: exportGifiPDF },
                { name: `T2_GIFI_${data.ledger.name.replace(/\s/g, "")}_FY${fy}.csv`, label: "the CSV", download: exportGifiCSV },
              ]}
            />
          </div>
        )}
      </section>
      )}
    </div>
  );
}


/* ================= inter-ledger transfer ================= */
function TransferModal({ data, others, addSub, onNewLedger, onSubmit, onClose }) {
  const [toId, setToId] = useState(others[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [desc, setDesc] = useState("");
  const [mode, setMode] = useState("transfer"); // transfer | payment
  const [srcCategory, setSrcCategory] = useState(data.categories.expense[0]?.name || "Other");
  const [srcSub, setSrcSub] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toLedger = others.find((l) => l.id === toId);
  const valid = toLedger && parseFloat(amount) > 0 && date;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    await onSubmit({
      toLedger, amount: Math.abs(parseFloat(amount)), date, description: desc.trim(),
      mode, srcCategory, srcSub,
    });
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-1">
          <h3 style={{ fontFamily: SERIF }} className="text-xl">Move money between ledgers</h3>
          <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
        </div>

        {others.length === 0 ? (
          <div className="py-2">
            <p style={{ color: P.muted }} className="text-sm mb-3">You only have one ledger, create a second one (e.g. your personal books) and transfers unlock.</p>
            <Btn className="w-full justify-center" onClick={onNewLedger}><Plus size={14} /> Create another ledger</Btn>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Label>From</Label>
                <div style={{ background: P.bg, border: `1px solid ${P.line}`, fontFamily: MONO }} className="rounded px-2 py-1.5 text-sm truncate">{data.ledger.name} <span style={{ color: P.faint }}>· {kindLabel(data.ledger.kind)}</span></div>
              </div>
              <ArrowLeftRight size={16} style={{ color: P.brass }} className="mt-4 shrink-0" />
              <div className="flex-1">
                <Label>To</Label>
                <Select value={toId} onChange={(e) => setToId(e.target.value)}>
                  {others.map((l) => <option key={l.id} value={l.id}>{l.name} · {kindLabel(l.kind)}</option>)}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><Label>Amount</Label><Input type="number" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={{ fontFamily: MONO }} /></div>
              <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <div><Label>Description</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={mode === "payment" ? "July salary" : "Owner draw"} /></div>

            <div>
              <Label>What kind of movement?</Label>
              <div className="space-y-1.5">
                {[
                  ["transfer", "Transfer / owner draw", "Moves cash between balances. Excluded from both P&L, like chequing → savings."],
                  ["payment", "Payment (salary, invoice)", `A real expense for ${data.ledger.name} and real income for the other ledger, shows in both P&L (and the T2 draft).`],
                ].map(([k, title, sub]) => (
                  <button key={k} onClick={() => setMode(k)}
                    style={{ background: mode === k ? P.surface2 : P.bg, border: `1px solid ${mode === k ? P.brass : P.line}` }}
                    className="w-full rounded-lg p-2.5 text-left">
                    <div className="text-sm" style={{ color: P.text }}>{title}</div>
                    <div className="text-xs" style={{ color: P.faint }}>{sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {mode === "payment" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Expense category ({data.ledger.name})</Label>
                  <Select value={srcCategory} onChange={(e) => { setSrcCategory(e.target.value); setSrcSub(""); }}>
                    {data.categories.expense.map((c) => <option key={c.name}>{c.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Subcategory</Label>
                  <SubPicker data={data} type="expense" category={srcCategory} value={srcSub} onChange={setSrcSub} addSub={addSub} />
                </div>
              </div>
            )}

            <Btn className="w-full justify-center" disabled={!valid || busy} onClick={submit}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
              {" "}Move {amount ? fmt(Math.abs(parseFloat(amount)) || 0) : "money"} to {toLedger?.name || "…"}
            </Btn>
            <p style={{ color: P.faint }} className="text-xs">
              Both sides are written together and stay linked, deleting one removes the other, so the books can't drift.
              {mode === "payment" && " The receiving side lands in that ledger's Paycheck/revenue category, adjust it there if needed."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}


/* ================= live bank feed (Plaid) ================= */
function BankFeedCard({ data, onSynced, onConnectionsChange, openGuide, onReview }) {
  const [conns, setConns] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(null);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [resumable, setResumable] = useState(false);
  const [afterSync, setAfterSync] = useState(null); // { label, plan } once a sync brings something in
  const oauthHandled = useRef(false);

  const refreshConns = async () => {
    const list = await bank.listConnections(data.ledger.id);
    setConns(list);
    onConnectionsChange?.(list);
    return list;
  };

  // Ask Plaid whether each Item is still signed in, then re-read. Runs in the
  // background: a dropped sign-in should announce itself here rather than
  // waiting for the user to press Sync and watch it fail.
  const refreshHealth = async () => {
    try {
      await bank.checkStatus(data.ledger.id);
      await refreshConns();
    } catch { /* health is a nicety; never block the card on it */ }
  };

  const finishConnect = async (public_token, metadata, ledgerId) => {
    // No institution name in update mode — send null rather than "Bank" so the
    // server keeps the name already stored instead of overwriting it.
    const res = await bank.plaid("exchange", {
      public_token,
      ledger_id: ledgerId,
      institution: metadata?.institution?.name || null,
    });
    setResumable(false);
    await refreshConns();
    setNotice(res?.reconnected
      ? "Bank sign-in restored. Tap Sync now to pick up everything since the last sync."
      : "Bank connected. Tap Sync now to pull transactions into review.");
  };

  const handleLinkExit = (exitErr, metadata) => {
    setResumable(Boolean(bank.loadLinkSession()));
    if (!exitErr) return;
    const msg = exitErr.display_message || exitErr.error_message || exitErr.error_code || String(exitErr);
    // Ignore user-initiated closes; surface real Link / institution failures
    if (/INSTITUTION_NOT_RESPONDING|INVALID_CREDENTIALS|USER_SETUP_REQUIRED|ITEM_LOCKED|PENDING_EXPIRATION/i.test(msg)
      || exitErr.error_type || exitErr.error_code) {
      const sessionId = metadata?.link_session_id;
      setErr(sessionId ? `${msg} (link_session_id: ${sessionId})` : msg);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const list = await refreshConns();
        if (list.length) refreshHealth();
      }
      catch { setConns([]); setShowSetup(true); onConnectionsChange?.([]); }
    })();
  }, [data.ledger.id]);

  // Resume Plaid Link after a bank OAuth redirect (?oauth_state_id=…)
  useEffect(() => {
    if (oauthHandled.current) return;
    const receivedRedirectUri = bank.oauthReturnUri();
    if (!receivedRedirectUri) {
      // Bank-app approvals can reload the page out from under Link; the saved
      // token still resumes that sign-in.
      setResumable(Boolean(bank.loadLinkSession()));
      return;
    }
    const session = bank.loadLinkSession();
    if (!session) {
      bank.stripOauthParams();
      setErr("Your bank sent you back to a new window, so the sign-in couldn't be picked up. Tap Connect a bank and try again in this window.");
      return;
    }
    oauthHandled.current = true;
    setBusy(true);
    setErr("");
    (async () => {
      try {
        await bank.openPlaidLink({
          link_token: session.link_token,
          receivedRedirectUri,
          onSuccess: async (public_token, metadata) => {
            try { await finishConnect(public_token, metadata, session.ledger_id); }
            catch (e) { setErr(String(e.message || e)); }
          },
          onExit: handleLinkExit,
        });
      } catch (e) {
        setErr(String(e.message || e));
        bank.clearLinkSession();
        bank.stripOauthParams();
      }
      setBusy(false);
    })();
  }, [data.ledger.id]);

  const connect = async () => {
    setErr(""); setNotice(""); setBusy(true);
    try {
      const redirect_uri = bank.plaidRedirectUri();
      const { link_token, oauth } = await bank.plaid("create_link_token", { redirect_uri });
      bank.saveLinkSession({ link_token, ledger_id: data.ledger.id });
      setResumable(true);
      if (oauth === false) {
        // Without an allowlisted redirect URI, Link can open but any bank that
        // authenticates in its own app or site dead-ends on the way back.
        setErr(`Banks that make you approve in their own app (RBC, TD, Scotiabank) can't finish yet: add ${redirect_uri} as an Allowed redirect URI in the Plaid Dashboard.`);
        setShowSetup(true);
      }
      await bank.openPlaidLink({
        link_token,
        onSuccess: async (public_token, metadata) => {
          try { await finishConnect(public_token, metadata, data.ledger.id); }
          catch (e) { setErr(String(e.message || e)); }
        },
        onExit: handleLinkExit,
      });
    } catch (e) {
      const msg = String(e.message || e);
      setErr(/configured|PLAID|client_id|secret/i.test(msg)
        ? "Plaid isn't set up on the server yet. Open the setup steps below."
        : msg);
      setShowSetup(true);
    }
    setBusy(false);
  };

  // Update mode: re-authenticate the Item the ledger already holds. Distinct
  // from connect() on purpose — linking the bank again would create a second
  // connection, which double-counts the balance and re-imports every line.
  const reconnect = async (id) => {
    setErr(""); setNotice(""); setBusy(true);
    try {
      const redirect_uri = bank.plaidRedirectUri();
      const { link_token } = await bank.plaid("create_link_token", { redirect_uri, connection_id: id });
      bank.saveLinkSession({ link_token, ledger_id: data.ledger.id, connection_id: id });
      setResumable(true);
      await bank.openPlaidLink({
        link_token,
        onSuccess: async (public_token, metadata) => {
          try { await finishConnect(public_token, metadata, data.ledger.id); }
          catch (e) { setErr(String(e.message || e)); }
        },
        onExit: handleLinkExit,
      });
    } catch (e) {
      setErr(String(e.message || e));
    }
    setBusy(false);
  };

  const resume = async () => {
    const session = bank.loadLinkSession();
    if (!session) { setResumable(false); return; }
    setErr(""); setNotice(""); setBusy(true);
    try {
      await bank.openPlaidLink({
        link_token: session.link_token,
        onSuccess: async (public_token, metadata) => {
          try { await finishConnect(public_token, metadata, session.ledger_id); }
          catch (e) { setErr(String(e.message || e)); }
        },
        onExit: handleLinkExit,
      });
    } catch (e) {
      setErr(String(e.message || e));
      bank.clearLinkSession();
      setResumable(false);
    }
    setBusy(false);
  };

  const startOver = async () => {
    bank.clearLinkSession();
    setResumable(false);
    setErr("");
    setNotice("Starting a fresh bank connection…");
    await connect();
  };

  const sync = async (id) => {
    setErr(""); setNotice(""); setSyncing(id);
    try {
      const res = await bank.plaid("sync", { connection_id: id });
      await refreshConns();
      // The old function returned { transactions } and stored nothing. If it's
      // still deployed, its cursor has already moved past these lines — say so
      // loudly rather than reporting "up to date" over lost transactions.
      if (typeof res.added !== "number") {
        setErr("This bank feed is running an older sync function that doesn't store lines. Redeploy the `plaid` Edge Function (and run migration-bank-transactions.sql) before syncing again.");
        setSyncing(null);
        return;
      }
      const { added = 0, modified = 0, removed = 0 } = res;
      if (!added && !modified && !removed) {
        setNotice("Up to date. Nothing new since the last sync.");
        setAfterSync(null);
      } else {
        const parts = [];
        if (added) parts.push(`${added} new`);
        if (modified) parts.push(`${modified} updated`);
        if (removed) parts.push(`${removed} reversed`);
        // Syncing used to throw the consolidate screen at you, which is a
        // question ("what do I do here?") in answer to a button you pressed for
        // a different reason. Say what arrived and what, if anything, it needs.
        const plan = await onSynced?.();
        setAfterSync({ label: parts.join(", "), plan: plan || null });
        setNotice("");
      }
    } catch (e) {
      const msg = String(e.message || e);
      // The server has just recorded why this failed; re-read so the row shows
      // its Reconnect button instead of only a raw Plaid string in the banner.
      await refreshConns().catch(() => {});
      setErr(/ITEM_LOGIN_REQUIRED|PENDING_EXPIRATION|login is required/i.test(msg)
        ? "This bank needs you to sign in again. Use Reconnect on the connection below. It restores this connection in place and keeps your matched lines."
        : msg);
    }
    setSyncing(null);
  };

  const connected = (conns?.length || 0) > 0;

  const disconnect = async (id) => {
    if (!window.confirm("Disconnect this bank? Entries you already imported stay in the ledger.")) return;
    try {
      await bank.plaid("disconnect", { connection_id: id });
      const next = (conns || []).filter((x) => x.id !== id);
      setConns(next);
      onConnectionsChange?.(next);
    } catch (e) { setErr(String(e.message || e)); }
  };

  return (
    <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 style={{ fontFamily: SERIF }} className="text-lg leading-tight">Bank feed</h2>
          <p style={{ color: P.muted }} className="text-sm">Connections belong to this ledger ({data.ledger.name}). Each ledger links its own bank accounts.</p>
        </div>
        <div className="flex items-center gap-2">
          <GuideAnchor id="bank-feed" onOpen={openGuide} label={connected ? "Something wrong?" : "Help me connect"} />
          <span style={{ fontFamily: MONO, color: conns?.length ? P.credit : P.faint, border: `1px solid ${conns?.length ? P.credit : P.line}` }} className="text-xs rounded-full px-2 py-0.5 whitespace-nowrap">
            {conns === null ? "checking…" : conns.length ? `${conns.length} connected` : "not connected"}
          </span>
        </div>
      </div>

      {conns?.length > 0 && (
        <div className="mt-4 space-y-2">
          {conns.map((c) => {
            const stale = bank.needsReconnect(c);
            return (
            <div key={c.id} style={{ background: P.bg, border: `1px solid ${stale ? P.debit : P.line}` }} className="rounded-lg p-3 flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{c.institution || "Bank"}</div>
                <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
                  {c.current_balance != null ? `${fmt(Number(c.current_balance))} · ` : ""}
                  {c.last_synced ? `last synced ${stamp(c.last_synced)}` : "never synced"}
                </div>
                {stale && (
                  <div style={{ color: P.debit }} className="text-xs mt-1">
                    Sign-in expired. Balance and transactions have been frozen since the last sync. Reconnect to resume.
                  </div>
                )}
              </div>
              {stale
                ? <Btn onClick={() => reconnect(c.id)} disabled={busy}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Reconnect
                  </Btn>
                : <Btn tone="ghost" onClick={() => sync(c.id)} disabled={syncing === c.id}>
                    {syncing === c.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Sync now
                  </Btn>}
              <button onClick={() => disconnect(c.id)} style={{ color: P.faint, padding: 6, margin: -6 }} title="Disconnect"><Trash2 size={13} /></button>
            </div>
            );
          })}
        </div>
      )}

      {/* Connecting is a one-time act. Once a bank is on the card, offering
          "Connect a bank" again reads as "add another account" and is the
          fastest way to end up with the same account linked twice, which
          double-counts the balance. It comes back when the last one is removed. */}
      <div className="flex flex-wrap items-center gap-3 mt-4">
        {connected ? (
          <span style={{ color: P.faint, fontFamily: MONO }} className="text-xs">
            {conns.length === 1 ? "This ledger is connected to your bank." : `This ledger is connected to ${conns.length} banks.`} Remove one with the bin icon to connect a different bank.
          </span>
        ) : (
          <>
            <Btn onClick={connect} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Connect a bank
            </Btn>
            <span style={{ color: P.faint, fontFamily: MONO }} className="text-xs">no signup needed · you sign in with your own bank · Brasstally never sees the password</span>
          </>
        )}
        {resumable && !connected && (
          <>
            <Btn tone="ghost" onClick={resume} disabled={busy}>
              <RotateCcw size={13} /> Resume bank sign-in
            </Btn>
            <Btn tone="ghost" onClick={startOver} disabled={busy} title="Clear the saved session and create a fresh link token">
              Start over
            </Btn>
          </>
        )}
      </div>
      {notice && <p style={{ color: P.credit, fontFamily: MONO }} className="text-xs mt-2">{notice}</p>}
      {err && <p style={{ color: P.debit }} className="text-xs mt-2">{err}</p>}

      {/* What the sync actually brought in, and whether it needs anything. */}
      {afterSync && (() => {
        const p = afterSync.plan;
        const needs = p ? p.ask.count : 0;
        const canFix = p ? p.fix.count : 0;
        return (
          <div style={{ background: P.bg, border: `1px solid ${needs ? P.brass : P.credit}` }} className="rounded-lg p-3 mt-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-[14rem]">
                <div className="text-sm" style={{ color: P.text }}>{afterSync.label} from your bank.</div>
                <div style={{ color: P.muted }} className="text-xs mt-0.5">
                  {!p
                    ? "They are in the books now."
                    : needs === 0 && canFix === 0
                      ? "Everything already lines up with what you had recorded. Nothing for you to do."
                      : needs === 0
                        ? `I can sort out all ${canFix} of them without you. Open it and press one button.`
                        : canFix
                          ? `I can sort out ${canFix} on my own. ${needs} ${needs === 1 ? "needs" : "need"} a decision from you.`
                          : `${needs} ${needs === 1 ? "needs" : "need"} a decision from you.`}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(needs > 0 || canFix > 0) && (
                  <Btn onClick={() => { setAfterSync(null); onReview?.(); }}>Open it</Btn>
                )}
                <button onClick={() => setAfterSync(null)} style={{ color: P.faint }} className="p-1" title="Dismiss"><X size={14} /></button>
              </div>
            </div>
          </div>
        );
      })()}

      {!connected && (
        <button onClick={() => setShowSetup(!showSetup)} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2 mt-4">
          {showSetup ? "hide" : "show"} one-time server setup
        </button>
      )}
      {showSetup && !connected && (
        <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-3 mt-2 space-y-1.5">
          {[
            ["1", "Run supabase/migration-bank-connections.sql and supabase/migration-bank-balances.sql in the SQL Editor"],
            ["2", "Edge Functions: add secrets PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV (sandbox to test, production when approved)"],
            ["3", "Deploy the function: Edge Functions, New function, name it exactly \"plaid\", paste supabase/functions/plaid/index.ts, Deploy"],
            ["4", `In the Plaid Dashboard → Team Settings → API, add Allowed redirect URI: ${typeof window !== "undefined" ? window.location.origin + "/" : "https://your-site/"}`],
            ["5", "Reload this page and tap Connect a bank. Console warnings about WebGPU/WASM from Plaid's own scripts are harmless, so ignore them."],
          ].map(([n, t]) => (
            <div key={n} className="flex gap-2 text-sm" style={{ color: P.muted }}>
              <span style={{ fontFamily: MONO, color: P.brass }}>{n}.</span><span>{t}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ================= personal tax (T1) for Personal Ledgers ================= */
function PersonalTaxCard({ data, openGuide }) {
  const yearsAvail = [...new Set(data.transactions.map((t) => Number((t.date || "").slice(0, 4))).filter(Boolean))].sort((a, b) => b - a);
  const [ty, setTy] = useState(yearsAvail[0] || new Date().getFullYear());
  const [draft, setDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showForms, setShowForms] = useState(false);
  const [accEmail, setAccEmail] = useState("");
  const [accNote, setAccNote] = useState(`Hi, attached is my personal tax summary from Brasstally. Slips such as T4s and T5s will come through CRA auto-fill. Can you review and let me know what else you need?`);

  const yrTx = data.transactions.filter((t) => (t.date || "").startsWith(String(ty)) && !t.plExclude);
  const incomeByCat = {};
  yrTx.filter((t) => t.type === "income").forEach((t) => { incomeByCat[t.category] = (incomeByCat[t.category] || 0) + t.amount; });
  const totalIncome = Object.values(incomeByCat).reduce((s, v) => s + v, 0);

  // self-employment slice: business-account entries inside a personal ledger
  const seTx = yrTx.filter((t) => t.account === "business");
  const seIncome = seTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const seExpByCat = {};
  seTx.filter((t) => t.type === "expense").forEach((t) => { seExpByCat[t.category] = (seExpByCat[t.category] || 0) + t.amount; });
  const seExpenses = Object.values(seExpByCat).reduce((s, v) => s + v, 0);
  const hasSE = seIncome > 0 || seExpenses > 0;

  // deduction and credit candidates, straight from categories
  const catSum = (name) => yrTx.filter((t) => t.type === "expense" && t.category === name).reduce((s, t) => s + t.amount, 0);
  const medical = catSum("Health");
  const donations = catSum("Gifts");

  const lines = [
    ["Income", null, null],
    ...Object.entries(incomeByCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => ["  " + c, v, null]),
    ["Total income recorded", totalIncome, "strong"],
    ...(hasSE ? [
      ["Self-employment (T2125)", null, null],
      ["  Gross self-employment income", seIncome, null],
      ...Object.entries(seExpByCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => ["  " + c, -v, null]),
      ["  Net self-employment income", seIncome - seExpenses, "strong"],
    ] : []),
    ["Possible deductions and credits", null, null],
    ...(medical > 0 ? [["  Medical expenses (line 33099)", medical, null]] : []),
    ...(donations > 0 ? [["  Charitable donations (line 34900)", donations, null]] : []),
    ...(medical === 0 && donations === 0 ? [["  None detected from your categories this year", null, null]] : []),
  ];

  const draftText = () =>
    `T1 PREP · ${data.ledger.name} · tax year ${ty}\n` +
    lines.map(([label, v]) => v === null ? label.toUpperCase() : `${label}: ${v.toFixed(2)}`).join("\n") +
    "\nNote: T4/T5 slips come from CRA auto-fill; this covers what CRA can't see.";

  const copyDraft = () => {
    navigator.clipboard?.writeText(draftText()).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const exportPDF = () => {
    taxPdf({
      filename: `T1_prep_${ty}_${data.ledger.name.replace(/\s/g, "")}.pdf`,
      formTitle: "T1 Preparation Summary",
      formSub: `Personal income tax working paper · draft prepared from the ${data.ledger.name} ledger`,
      ident: [
        ["Taxpayer", data.ledger.name],
        ["Social insurance number", "___ ___ ___ (to be completed)"],
        ["Tax year", String(ty)],
        ["Slips (T4/T5/RRSP)", "via CRA Auto-fill; not included here"],
      ],
      columns: ["Line", "Description", "Amount"],
      rows: lines.map(([label, v, strong]) => {
        if (v === null) return { section: label.trim() };
        const m = label.match(/line (\d{5})/i);
        return { code: m ? m[1] : "", name: label.trim().replace(/\s*\(line \d{5}\)/i, ""), amount: v, strong: strong === "strong" };
      }),
      note: "Deduction lines are candidates drawn from ledger categories; confirm eligibility before claiming. "
        + (hasSE ? "Self-employment figures feed form T2125 inside the T1 return. " : "")
        + "File via NETFILE-certified software or a representative's EFILE.",
    });
  };
  const exportCSV = () => {
    downloadCSV(`T1_prep_${ty}.csv`, [
      [`T1 prep · ${data.ledger.name}`, `tax year ${ty}`],
      [],
      ["Line", "Amount"],
      ...lines.map(([label, v]) => [label.trim(), v === null ? "" : v.toFixed(2)]),
    ]);
  };
  const deadlines = t1Deadlines(ty, { selfEmployed: hasSE });
  const emailSubject = `Personal tax ${ty}, summary for review`;
  const emailShortBody =
    `Personal tax summary, ${ty}\n` +
    `Total income recorded in my ledger: ${fmt(totalIncome)}\n` +
    (hasSE ? `Self employment: ${fmt(seIncome)} in, ${fmt(seExpenses)} of expenses, net ${fmt(seIncome - seExpenses)} (form T2125)\n` : "") +
    (medical > 0 ? `Medical: ${fmt(medical)}\n` : "") +
    (donations > 0 ? `Donations: ${fmt(donations)}\n` : "") +
    `\nAttached: the working paper PDF and the same figures as a CSV.\n` +
    `T4, T5 and RRSP slips are not in here. They come through CRA auto-fill.`;

  return (
    <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 style={{ fontFamily: SERIF }} className="text-lg leading-tight">Personal tax (T1)</h2>
          <p style={{ color: P.muted }} className="text-sm">Everything CRA cannot see, ready for your software or your accountant</p>
        </div>
        <GuideAnchor id="filing-t1" onOpen={openGuide} label="Walk me through it" />
      </div>

      <DeadlineStrip rows={deadlines} title={`All deadlines for tax year ${ty}`} />

      <div className="grid sm:grid-cols-4 gap-3 mt-4 items-end">
        <div>
          <Label>Tax year</Label>
          <Select value={ty} onChange={(e) => { setTy(Number(e.target.value)); setDraft(false); }}>
            {(yearsAvail.length ? yearsAvail : [new Date().getFullYear()]).map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </div>
        <div className="sm:col-span-3">
          <Btn onClick={() => setDraft(true)}><FileText size={14} /> Build my summary</Btn>
        </div>
      </div>

      {draft && (
        <div className="mt-4 space-y-4">
          <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
            <button onClick={() => setShowForms(!showForms)} className="w-full text-left flex items-center gap-2">
              <ChevronRight size={13} style={{ color: P.faint, transform: showForms ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
              <Label>What a T1 is made of</Label>
            </button>
            {showForms ? (
              <div className="mt-1">
                {T1_PACKAGE.map((f) => (
                  <div key={f.code} className="flex items-start gap-2 py-1.5" style={{ borderTop: `1px solid ${P.line}` }}>
                    <span style={{ fontFamily: MONO, color: P.brass }} className="text-xs w-24 shrink-0">{f.code}</span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm" style={{ color: P.text }}>{f.name}</span>
                      <span className="block text-xs" style={{ color: P.muted }}>{f.when}</span>
                    </span>
                    <span style={{ fontFamily: MONO, color: f.need === "always" ? P.credit : P.faint }} className="text-xs shrink-0">
                      {f.need === "always" ? "always" : f.need === "usually" ? "likely" : "if it applies"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: P.muted }} className="text-xs ml-5">
                Your software fills most of this in for you once CRA auto-fill runs. Open it if you want to know what is going where.
              </p>
            )}
          </div>

          <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
            <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
              <Label>T1 prep · {ty}</Label>
              <div className="flex gap-2">
                <Btn tone="ghost" onClick={copyDraft}>{copied ? <Check size={13} /> : null} {copied ? "Copied" : "Copy"}</Btn>
                <Btn tone="ghost" onClick={exportCSV}><Download size={13} /> CSV</Btn>
                <Btn tone="ghost" onClick={exportPDF}><FileText size={13} /> PDF</Btn>
              </div>
            </div>
            {yrTx.length === 0 ? (
              <p style={{ color: P.faint }} className="text-sm py-3">Nothing recorded in {ty} yet.</p>
            ) : (
              <div className="divide-y" style={{ borderColor: P.line }}>
                {lines.map(([label, v, strong], idx) => (
                  <div key={idx} className="flex items-center gap-3 py-1.5" style={{ borderColor: P.line }}>
                    <span className={"flex-1 text-sm truncate " + (v === null ? "uppercase tracking-widest text-xs" : strong ? "font-medium" : "")}
                      style={{ color: v === null ? P.faint : strong ? P.text : P.muted, fontFamily: v === null ? MONO : undefined }}>
                      {label.trim()}
                    </span>
                    {v !== null && (
                      <span style={{ fontFamily: MONO, color: strong ? (v >= 0 ? P.credit : P.debit) : v >= 0 ? P.text : P.muted }} className="text-sm tabular-nums">{fmt(v)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p style={{ color: P.faint }} className="text-xs mt-2">
              Deduction lines are candidates from your categories. Eligibility rules apply, so confirm before claiming.
            </p>
          </div>
            <FilingConnector data={data} form="T1" taxYear={ty} accountantEmail={accEmail} />

          <SendToAccountant
            subject={emailSubject}
            shortBody={emailShortBody}
            fullText={draftText()}
            email={accEmail}
            setEmail={setAccEmail}
            note={accNote}
            setNote={setAccNote}
            guide={<GuideAnchor id="filing-t1" onOpen={openGuide} label="What do they need?" />}
            files={[
              { name: `T1_prep_${ty}_${data.ledger.name.replace(/\s/g, "")}.pdf`, label: "the working paper PDF", download: exportPDF },
              { name: `T1_prep_${ty}.csv`, label: "the CSV", download: exportCSV },
            ]}
          />
        </div>
      )}
    </section>
  );
}

/* ================= filing connector: certified software or accountant ================= */
const FILING_SOFTWARE = {
  T2: [
    { id: "taxtron", name: "TaxTron T2", platform: "Windows, Mac", note: "Free tier covers a single small corporation; paid above that.", gifiImport: false },
    { id: "ufile", name: "UFile T2", platform: "Windows", note: "Guided interview, roughly $200 per return.", gifiImport: false },
    { id: "futuretax", name: "FutureTax T2", platform: "Windows", note: "Low cost per return, no frills.", gifiImport: false },
    { id: "taxcycle", name: "TaxCycle T2", platform: "Windows", note: "Professional subscription, supports spreadsheet GIFI import.", gifiImport: true },
    { id: "profile", name: "ProFile T2", platform: "Windows", note: "Intuit's practitioner package, imports from spreadsheets.", gifiImport: true },
    { id: "other", name: "Something else", platform: "", note: "Any package on the CRA certified list.", gifiImport: false },
  ],
  T1: [
    { id: "wealthsimple", name: "Wealthsimple Tax", platform: "Web", note: "Pay what you want, CRA Auto-fill pulls your slips.", gifiImport: false },
    { id: "turbotax", name: "TurboTax", platform: "Web, Windows", note: "Tiered pricing, strong self-employment guidance.", gifiImport: false },
    { id: "ufile1", name: "UFile", platform: "Web, Windows", note: "Long-standing Canadian package.", gifiImport: false },
    { id: "hrblock", name: "H&R Block Online", platform: "Web", note: "Free tier for simple returns.", gifiImport: false },
    { id: "studiotax", name: "StudioTax", platform: "Windows, Mac", note: "Small licence fee, minimal hand-holding.", gifiImport: false },
    { id: "other", name: "Something else", platform: "", note: "Any package on the CRA certified list.", gifiImport: false },
  ],
};

const FILING_STATUSES = [["draft", "Draft"], ["package_sent", "Package sent"], ["filed", "Filed"], ["assessed", "Assessed"]];

const softwareSteps = (form, sw) => form === "T2" ? [
  ["Start a new T2 return", `Open ${sw.name} and create the return for this fiscal year.`],
  ["Enter identification", "Corporation name, business number with the RC0001 suffix, and the tax year dates from the draft above."],
  sw.gifiImport
    ? ["Import the GIFI spreadsheet", "Use the package's GIFI or spreadsheet import and point it at the CSV exported above."]
    : ["Key in the GIFI lines", "Open the working paper PDF beside the software and enter each code and amount on Schedule 125."],
  ["Complete Schedule 100", "Balance sheet items this ledger does not track: bank balance, receivables from the AR tab, payables, and share capital."],
  ["Get the Web Access Code and transmit", "The software can fetch the code with your business number, or call CRA business enquiries. File, then record the confirmation below."],
] : [
  ["Start the return and run Auto-fill", `In ${sw.name}, connect CRA Auto-fill so every T4, T5, and RRSP slip loads itself.`],
  ["Add what CRA cannot see", "The figures in the summary above: self-employment income and expenses, medical, donations."],
  ["Check the self-employment section", "Self-employment figures belong on form T2125 inside the return."],
  ["NETFILE and record it", "Transmit, then save the confirmation number below so next year starts organised."],
];

const accountantSteps = (form) => [
  ["Send the package", `Use "Send to your accountant" below: the ${form} draft, the CSV, and the working paper PDF.`],
  ["Authorise them once", "They request access with their RepID in Represent a Client; you approve it in CRA My Account. That lets them pull slips and transmit."],
  [form === "T2" ? "Review and sign the T183CORP" : "Review and sign the T183", "The one form you personally sign before they transmit."],
  ["Record the confirmation", "When they confirm the filing, log the number below so the paper trail lives with the books."],
];

function FilingConnector({ data, form, taxYear, accountantEmail }) {
  const [rec, setRec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [conf, setConf] = useState("");
  const [filedOn, setFiledOn] = useState(todayStr());
  const [err, setErr] = useState("");
  const list = FILING_SOFTWARE[form];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const r = await db.getFiling(data.ledger.id, taxYear, form);
        if (alive) { setRec(r); setConf(r?.confirmation_number || ""); }
      } catch (e) { if (alive) setErr("Run the filings migration to enable tracking."); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [data.ledger.id, taxYear, form]);

  const save = async (patch) => {
    setErr("");
    try {
      const r = await db.saveFiling(data.ledger.id, taxYear, form, { ...patch });
      setRec(r);
    } catch (e) { setErr(String(e.message || e)); }
  };

  const sw = rec?.software ? list.find((s) => s.id === rec.software) : null;
  const route = rec?.route || null;
  const status = rec?.status || "draft";
  const statusIdx = Math.max(0, FILING_STATUSES.findIndex(([k]) => k === status));

  if (loading) {
    return (
      <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
        <Label>Filing</Label>
        <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs">checking…</p>
      </div>
    );
  }

  return (
    <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <Label>Filing {form} · {taxYear}</Label>
        <span style={{ fontFamily: MONO, color: route ? P.credit : P.faint, border: `1px solid ${route ? P.credit : P.line}` }} className="text-xs rounded-full px-2 py-0.5 whitespace-nowrap">
          {route === "software" ? (sw?.name || "software") : route === "accountant" ? "accountant" : "not set up"}
        </span>
      </div>

      <p style={{ color: P.muted }} className="text-xs mb-3">
        No Canadian tax software exposes a filing API, so nothing transmits from here. This connects your books to the
        package or person who does file, and keeps the return on track.
      </p>

      {/* status pipeline */}
      <div className="flex items-center gap-1 mb-4">
        {FILING_STATUSES.map(([k, label], i) => (
          <button key={k} onClick={() => save({ status: k })} className="flex-1 text-left" title={`Mark as ${label}`}>
            <div style={{ height: 4, borderRadius: 99, background: i <= statusIdx ? P.brass : P.line }} />
            <div style={{ fontFamily: MONO, color: i <= statusIdx ? P.text : P.faint }} className="text-xs mt-1 truncate">{label}</div>
          </button>
        ))}
      </div>

      {!route || picking ? (
        <>
          <div className="flex gap-1 mb-3">
            {[["software", "I file it myself"], ["accountant", "My accountant files"]].map(([k, label]) => (
              <button key={k} onClick={() => { save({ route: k }); setPicking(k === "software"); }}
                style={{ fontFamily: MONO, background: route === k ? P.surface2 : "transparent", border: `1px solid ${route === k ? P.brass : P.line}`, color: route === k ? P.text : P.muted }}
                className="flex-1 rounded px-3 py-2 text-xs">
                {label}
              </button>
            ))}
          </div>
          {(route === "software" || picking) && (
            <div className="grid sm:grid-cols-2 gap-2">
              {list.map((s) => (
                <button key={s.id}
                  onClick={() => { save({ route: "software", software: s.id }); setPicking(false); }}
                  style={{ background: P.surface, border: `1px solid ${rec?.software === s.id ? P.brass : P.line}` }}
                  className="rounded-lg p-3 text-left">
                  <div className="text-sm">{s.name}</div>
                  <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">{s.platform}</div>
                  <div style={{ color: P.muted }} className="text-xs mt-1">{s.note}</div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {route === "software" && sw && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{sw.name}</div>
                <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">{sw.platform || "certified software"}{sw.gifiImport ? " · spreadsheet import" : " · manual GIFI entry"}</div>
              </div>
              <button onClick={() => setPicking(true)} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">change</button>
            </div>
          )}
          {route === "accountant" && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm">Filed by your accountant</div>
                <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs truncate">{accountantEmail || "add their email below"}</div>
              </div>
              <button onClick={() => save({ route: null, software: null })} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">change</button>
            </div>
          )}

          {(route === "software" ? softwareSteps(form, sw || list[0]) : accountantSteps(form)).map(([t, b], i) => (
            <div key={i} className="flex gap-2 mb-2">
              <span style={{ fontFamily: MONO, color: P.brass }} className="text-sm shrink-0">{i + 1}.</span>
              <div><div className="text-sm" style={{ color: P.text }}>{t}</div><div className="text-xs" style={{ color: P.muted }}>{b}</div></div>
            </div>
          ))}

          <div style={{ borderTop: `1px solid ${P.line}` }} className="mt-3 pt-3">
            {rec?.confirmation_number && !recording ? (
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div style={{ fontFamily: MONO, color: P.credit }} className="text-xs">filed {rec.filed_on || ""}</div>
                  <div style={{ fontFamily: MONO, color: P.text }} className="text-sm">confirmation {rec.confirmation_number}</div>
                </div>
                <button onClick={() => setRecording(true)} style={{ color: P.faint, fontFamily: MONO }} className="text-xs underline decoration-dotted underline-offset-2">edit</button>
              </div>
            ) : recording ? (
              <div className="grid sm:grid-cols-3 gap-2 items-end">
                <div><Label>Confirmation number</Label><Input value={conf} onChange={(e) => setConf(e.target.value)} placeholder="from the transmission" /></div>
                <div><Label>Filed on</Label><Input type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} /></div>
                <Btn className="justify-center" onClick={() => { save({ confirmation_number: conf.trim(), filed_on: filedOn, status: "filed" }); setRecording(false); }}>
                  <Check size={14} /> Record
                </Btn>
              </div>
            ) : (
              <Btn tone="ghost" onClick={() => setRecording(true)}><Check size={14} /> Record the filing</Btn>
            )}
          </div>
        </>
      )}

      {err && <p style={{ color: P.debit }} className="text-xs mt-2">{err}</p>}
    </div>
  );
}

/* ================= account: profile, membership, billing, settings ================= */
function AccountModal({ theme, setTheme, onSignOut, onResetLedger, ledgerName, onClose }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data?.user?.email || "");
      setName(data?.user?.user_metadata?.name || "");
    });
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveName = async () => {
    setSaving(true); setMsg("");
    const { error } = await supabase.auth.updateUser({ data: { name: name.trim() } });
    setSaving(false);
    setMsg(error ? error.message : "Saved.");
  };
  const sendReset = async () => {
    setMsg("");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setMsg(error ? error.message : `Password link sent to ${email}.`);
  };
  const replayTours = () => {
    Object.keys(window.localStorage).filter((k) => k.startsWith("tour:")).forEach((k) => window.localStorage.removeItem(k));
    setMsg("Tutorials will show again on each tab.");
  };

  const Section = ({ title, children }) => (
    <div style={{ borderTop: `1px solid ${P.line}` }} className="pt-4 mt-4">
      <div style={{ fontFamily: MONO, color: P.brass }} className="text-xs uppercase tracking-widest mb-2">{title}</div>
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <h3 style={{ fontFamily: SERIF }} className="text-xl">Account</h3>
          <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
        </div>

        <Section title="Profile">
          <Label>Email</Label>
          <div style={{ fontFamily: MONO, color: P.muted, border: `1px solid ${P.line}`, background: P.bg }} className="rounded px-2 py-1.5 text-sm mb-2">{email || "…"}</div>
          <Label>Name</Label>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="How should we address you?" />
            <Btn onClick={saveName} disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</Btn>
          </div>
        </Section>

        <Section title="Membership">
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: MONO, color: P.bg, background: P.brass }} className="text-xs rounded px-2 py-0.5">Early access</span>
            <span style={{ color: P.muted }} className="text-sm">Free · founding member</span>
          </div>
          <p style={{ color: P.faint }} className="text-xs mt-2">Unlimited ledgers while Brasstally is in early access. When paid plans arrive, founding members hear first, and your books stay yours either way.</p>
        </Section>

        <Section title="Billing">
          <p style={{ color: P.muted }} className="text-sm">Nothing to bill yet. Cards, invoices, and receipts will live here when plans launch.</p>
        </Section>

        <Section title="Settings">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: P.muted }} className="text-sm">Appearance</span>
              <Btn tone="ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />} {theme === "dark" ? "Switch to daylight" : "Switch to midnight"}
              </Btn>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: P.muted }} className="text-sm">Tab tutorials</span>
              <Btn tone="ghost" onClick={replayTours}><RotateCcw size={13} /> Show again</Btn>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: P.muted }} className="text-sm">Password</span>
              <Btn tone="ghost" onClick={sendReset}><Mail size={13} /> Send reset link</Btn>
            </div>
          </div>
        </Section>

        {msg && <p style={{ color: P.credit, fontFamily: MONO }} className="text-xs mt-3">{msg}</p>}

        <div style={{ borderTop: `1px solid ${P.line}` }} className="pt-4 mt-4 space-y-2">
          <button
            onClick={() => { onClose(); onResetLedger(); }}
            style={{ color: P.debit, border: `1px solid ${P.debit}` }}
            className="w-full rounded px-3 py-2 text-sm inline-flex items-center justify-center gap-2"
            title="Erase everything in this ledger and start it fresh"
          >
            <RotateCcw size={14} /> Reset "{ledgerName}" ledger
          </button>
          <Btn tone="ghost" className="w-full justify-center" onClick={onSignOut}><LogOut size={14} /> Sign out</Btn>
        </div>
      </div>
    </div>
  );
}
