import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Camera, Plus, Trash2, Check, Send, Loader2, RotateCcw, X, LogOut, Mail, Pencil,
  ArrowUpRight, ArrowDownRight, Paperclip, FileText, Sun, Moon, Download, MessageSquare, Repeat
} from "lucide-react";
import { supabase } from "./lib/supabase";
import * as db from "./lib/db";
import { askClaude } from "./lib/extract";

/* ================= palettes: midnight & daylight ledger ================= */
const PALETTES = {
  dark: {
    bg: "#101613",
    surface: "#171F1B",
    surface2: "#1D2622",
    line: "#2A3530",
    text: "#EAE7DA",
    muted: "#8B9389",
    faint: "#5E6660",
    credit: "#5CB283",
    debit: "#C4574E",
    brass: "#C9A24B",
    overlay: "rgba(6,10,8,0.75)",
  },
  light: {
    bg: "#F1F0E8",
    surface: "#FBFAF5",
    surface2: "#E9E7DC",
    line: "#D6D3C4",
    text: "#232A21",
    muted: "#5C6459",
    faint: "#989C8E",
    credit: "#1E7A50",
    debit: "#B23E2E",
    brass: "#96761F",
    overlay: "rgba(40,44,36,0.45)",
  },
};
// Mutable palette object — every component reads P at render time, so swapping
// its values and re-rendering the tree re-themes the whole app.
const P = { ...PALETTES.dark };
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SERIF = "ui-serif, Georgia, 'Times New Roman', serif";


/* ================= helpers ================= */
const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);
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
const shiftMonth = (ym, d) => {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(y, m - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
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
  <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs uppercase tracking-widest mb-1">
    {children}
  </div>
);

const Input = (props) => (
  <input
    {...props}
    style={{ background: P.bg, border: `1px solid ${P.line}`, color: P.text, ...props.style }}
    className={"rounded px-2 py-1.5 text-sm w-full outline-none " + (props.className || "")}
  />
);

const Select = ({ children, ...props }) => (
  <select
    {...props}
    style={{ background: P.bg, border: `1px solid ${P.line}`, color: P.text }}
    className="rounded px-2 py-1.5 text-sm w-full outline-none"
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
      style={{ background: bg, color: fg, border: tone === "ghost" ? `1px solid ${P.line}` : "none" }}
      className={"rounded px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-40 " + (props.className || "")}
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

/* subcategory dropdown — lists the category's subs and lets you add a new one inline */
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
      <option value="">{compact ? "— sub —" : "— no subcategory —"}</option>
      {subs.map((s) => <option key={s} value={s}>{s}</option>)}
      {value && !subs.includes(value) && <option value={value}>{value}</option>}
      <option value="__add__">+ add subcategory…</option>
    </select>
  );
}

/* frequency cadences for recurring AR/AP */
const FREQS = [["weekly", "Weekly"], ["biweekly", "Every 2 weeks"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["yearly", "Yearly"]];
const freqLabel = (f) => (FREQS.find(([k]) => k === f) || [null, "Recurring"])[1];
const addInterval = (dateStr, freq) => {
  const d = new Date(dateStr + "T00:00:00");
  if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "biweekly") d.setDate(d.getDate() + 14);
  else if (freq === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly default
  return d.toISOString().slice(0, 10);
};

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
Software/SaaS/cloud/contractor items are business expenses — pick the closest business category (software, hosting, salaries, etc.). If the date is missing, use today's date. Amount is the total paid.
recurrence: "recurring" for subscriptions, SaaS, hosting, rent/mortgage, salaries, retainers, utilities — anything billed on a repeating cycle; "once" for one-off purchases.`;
}

function arExtractionPrompt(kind) {
  const who =
    kind === "receivables"
      ? `This document is an invoice the user's business ISSUED to a client — money owed TO the user. "party" is the client being billed (the bill-to / customer name), NOT the user's own company.`
      : `This document is an invoice or bill the user RECEIVED — money the user owes. "party" is the vendor/company that issued it.`;
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
      <div style={{ background: "#101613", color: "#EAE7DA", minHeight: "100vh", fontFamily: "ui-sans-serif, system-ui, sans-serif" }} className="flex items-center justify-center p-6">
        <div style={{ maxWidth: 480 }}>
          <h1 style={{ fontFamily: "ui-serif, Georgia, serif" }} className="text-xl mb-2">Something broke</h1>
          <p style={{ color: "#8B9389" }} className="text-sm mb-3">
            The app hit an error instead of rendering. Reloading usually clears it — if it keeps happening, send this to whoever maintains the app:
          </p>
          <pre style={{ background: "#171F1B", border: "1px solid #2A3530", color: "#C4574E", whiteSpace: "pre-wrap" }} className="rounded p-3 text-xs mb-4">{String(this.state.err)}</pre>
          <button onClick={() => window.location.reload()} style={{ background: "#C9A24B", color: "#10120C" }} className="rounded px-4 py-2 text-sm font-medium">Reload</button>
        </div>
      </div>
    );
  }
}

/* ================= auth gate ================= */
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined)
    return (
      <div style={{ background: P.bg, color: P.muted, minHeight: "100vh" }} className="flex items-center justify-center">
        <Loader2 className="animate-spin mr-2" size={18} /> Connecting…
      </div>
    );
  if (!session) return <Login />;
  return (
    <Boundary>
      <Ledger key={session.user.id} onSignOut={() => supabase.auth.signOut()} />
    </Boundary>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const send = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  return (
    <div style={{ background: P.bg, color: P.text, minHeight: "100vh", fontFamily: "ui-sans-serif, system-ui, sans-serif" }} className="flex items-center justify-center p-4">
      <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-6 w-full max-w-sm">
        <div style={{ fontFamily: MONO, color: P.brass }} className="text-xs uppercase tracking-widest">Business & personal books</div>
        <h1 style={{ fontFamily: SERIF }} className="text-2xl mb-4">The Ledger</h1>
        {sent ? (
          <p style={{ color: P.muted }} className="text-sm">
            Check <span style={{ color: P.text }}>{email}</span> for a sign-in link. You can close this tab — the link opens the ledger.
          </p>
        ) : (
          <>
            <Label>Email</Label>
            <Input type="email" placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && send()} />
            {err && <p style={{ color: P.debit }} className="text-xs mt-2">{err}</p>}
            <Btn className="w-full justify-center mt-3" onClick={send} disabled={busy || !email.trim()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Send sign-in link
            </Btn>
            <p style={{ color: P.faint }} className="text-xs mt-3">No password — a magic link lands in your inbox.</p>
          </>
        )}
      </div>
    </div>
  );
}

function statementPrompt(cats, ledgerName) {
  return `You parse bank and credit-card statements for a budget app. The ledger is "${ledgerName}".
Extract EVERY transaction line — do not summarize, skip, or merge lines.
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
Ignore running-balance columns, section headers, and totals rows — they are not transactions.`;
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
  const [reconciling, setReconciling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ledgers, setLedgers] = useState(null);          // null = loading list
  const [currentLedger, setCurrentLedger] = useState(null);
  const [fatal, setFatal] = useState(null);              // "migration" | null
  const [newLedgerOpen, setNewLedgerOpen] = useState(false);

  /* ---- 1) list this user's ledgers ---- */
  useEffect(() => {
    (async () => {
      try {
        const list = await db.listLedgers();
        setLedgers(list);
        if (list.length) {
          const last = window.localStorage.getItem("ledger:last");
          setCurrentLedger(list.find((l) => l.id === last) || list[0]);
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
    window.localStorage.setItem("ledger:last", currentLedger.id);
    (async () => {
      try {
        const loaded = await db.loadAll(currentLedger);
        const t = loaded.settings.theme === "light" ? "light" : "dark";
        Object.assign(P, PALETTES[t]);
        setThemeState(t);
        setMonth(thisMonth());
        setTab("overview");
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
      }
    })();
  }, [currentLedger]);

  const createLedgerAndSwitch = async ({ name, kind, startingBalance, anchorDate }) => {
    try {
      const l = await db.createLedger({ name, kind, startingBalance, anchorDate });
      setLedgers((ls) => [...(ls || []), l]);
      setNewLedgerOpen(false);
      setCurrentLedger(l);
    } catch (e) {
      console.error(e);
      setLoadErr(true);
    }
  };

  // local state updates immediately; the matching database write runs behind it
  const dbTry = async (fn) => {
    try { await fn(); setLoadErr(false); } catch (e) { console.error(e); setLoadErr(true); }
  };

  /* ---- derived ---- */
  const monthTx = useMemo(
    () => (data ? data.transactions.filter((t) => t.date && t.date.startsWith(month)) : []),
    [data, month]
  );
  // ledger line shows CASH flow — entries paid/received in credits don't move money
  const sums = useMemo(() => {
    const cash = monthTx.filter((t) => !isCredits(t));
    const inc = cash.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = cash.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { inc, exp, net: inc - exp };
  }, [monthTx]);
  // Balance anchoring: "balance was $X as of anchorDate". Only transactions AFTER the
  // anchor count toward the balance, so untracked earlier months can't distort it.
  const balance = useMemo(() => {
    if (!data) return { value: 0, beforeAnchor: false, anchorAmount: 0, anchorDate: "" };
    const anchorDate = data.settings.anchorDate || "1970-01-01";
    const anchorAmount = data.settings.startingBalance;
    const beforeAnchor = month < anchorDate.slice(0, 7); // viewing a month that ends before the anchor
    const cum = data.transactions
      .filter((t) => t.date && t.date > anchorDate && t.date.slice(0, 7) <= month && !isCredits(t))
      .reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);
    return { value: anchorAmount + cum, beforeAnchor, anchorAmount, anchorDate };
  }, [data, month]);
  const openBooks = useMemo(() => {
    if (!data) return { ar: 0, ap: 0 };
    return {
      ar: data.receivables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0),
      ap: data.payables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0),
    };
  }, [data]);

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
    dbTry(() => db.insertTransaction(rec));
  };
  const delTx = (id) => {
    const t = data.transactions.find((x) => x.id === id);
    if (t?.attachmentId) deleteAttachment(t.attachmentId);
    setData((d) => ({ ...d, transactions: d.transactions.filter((x) => x.id !== id) }));
    dbTry(() => db.deleteTransaction(id));
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
    dbTry(() => db.insertObligation(kind, rec));
  };
  const settleAR = (kind, id) => {
    const item = data[kind].find((x) => x.id === id);
    if (!item) return;
    const tx = {
      id: crypto.randomUUID(),
      date: todayStr(),
      amount: item.amount,
      type: kind === "receivables" ? "income" : "expense",
      category: item.category
        || (kind === "receivables"
          ? (data.categories.income.find((c) => c.name === "Client revenue")?.name || data.categories.income[0]?.name || "Other")
          : (data.categories.expense[0]?.name || "Other")),
      subcategory: item.subcategory,
      description: `${kind === "receivables" ? "Received" : "Paid"}: ${item.party} — ${item.description}`,
      account: item.account || "business",
      recurrence: item.recurrence,
      payMethod: item.payMethod === "credits" ? "credits" : "cash",
      creditId: item.payMethod === "credits" ? item.creditId : undefined,
      attachmentId: item.attachmentId,
      attachmentName: item.attachmentName,
    };
    // recurring obligations respawn with the next due date instead of disappearing
    const next = item.recurrence === "recurring"
      ? { ...item, id: crypto.randomUUID(), dueDate: addInterval(item.dueDate || todayStr(), item.frequency || "monthly"), attachmentId: undefined, attachmentName: undefined }
      : null;
    setData((d) => ({
      ...d,
      [kind]: [
        ...(next ? [next] : []),
        ...d[kind].map((x) => (x.id === id ? { ...x, status: "paid", settledOn: todayStr() } : x)),
      ],
      transactions: [tx, ...d.transactions],
    }));
    setMonth(thisMonth());
    dbTry(async () => {
      await db.updateObligation(id, { status: "paid", settledOn: todayStr() });
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
    dbTry(() => db.insertCredit(rec));
    return rec.id;
  };
  const updateCredit = (id, patch) => {
    setData((d) => ({ ...d, credits: (d.credits || []).map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    dbTry(() => db.updateCredit(id, patch));
  };
  const delCredit = (id) => {
    setData((d) => ({ ...d, credits: (d.credits || []).filter((c) => c.id !== id) }));
    dbTry(() => db.deleteCredit(id));
  };
  const delAR = (kind, id) => {
    const item = data[kind].find((x) => x.id === id);
    // keep the file if it was settled — the transaction still points at it
    if (item?.attachmentId && item.status === "open") deleteAttachment(item.attachmentId);
    setData((d) => ({ ...d, [kind]: d[kind].filter((x) => x.id !== id) }));
    dbTry(() => db.deleteObligation(id));
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
      dbTry(() => db.insertTransactions(recs));
    }
    if (anchor) setAnchor(anchor.amount, anchor.date, "statement");
    const latest = recs.reduce((m, t) => (t.date && t.date > m ? t.date : m), "");
    if (latest) setMonth(latest.slice(0, 7));
    setImporting(false);
  };

  const setAnchor = (amount, date, source = "manual") => {
    setData((d) => ({
      ...d,
      settings: { ...d.settings, startingBalance: amount, anchorDate: date },
      anchorHistory: [{ amount, date, source, createdAt: todayStr() }, ...(d.anchorHistory || [])],
    }));
    setReconciling(false);
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
    ["overview", "Overview"],
    ["transactions", "Transactions"],
    ["pl", "P&L"],
    ["arap", "AR / AP"],
    ["credits", "Credits"],
    ["calendar", "Calendar"],
    ["integrations", "Integrations"],
  ];

  return (
    <div style={{ background: P.bg, color: P.text, minHeight: "100vh", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="max-w-5xl mx-auto px-4 pb-28">
        {/* ===== header ===== */}
        <header className="pt-6 pb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div style={{ fontFamily: MONO, color: P.brass }} className="text-xs uppercase tracking-widest">
              The Ledger · {data.ledger.kind === "personal" ? "personal" : "business"}
            </div>
            <div className="flex items-center gap-2">
              <h1 style={{ fontFamily: SERIF }} className="text-3xl leading-tight">{data.ledger.name}</h1>
              {ledgers.length >= 1 && (
                <select
                  value={data.ledger.id}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__new__") { setNewLedgerOpen(true); return; }
                    const l = ledgers.find((x) => x.id === v);
                    if (l && l.id !== data.ledger.id) setCurrentLedger(l);
                  }}
                  title="Switch ledger"
                  style={{ background: P.surface, border: `1px solid ${P.line}`, color: P.muted, fontFamily: MONO }}
                  className="rounded px-2 py-1 text-xs outline-none"
                >
                  {ledgers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  <option value="__new__">+ new ledger…</option>
                </select>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSignOut}
              title="Sign out"
              style={{ color: P.muted, border: `1px solid ${P.line}` }}
              className="rounded p-2"
            >
              <LogOut size={15} />
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
        <LedgerLine sums={sums} balance={balance} openBooks={openBooks} creditsLeft={(data.credits || []).length ? creditsTotalRemaining(data) : null} onCredits={() => setTab("credits")} onReconcile={() => setReconciling(true)} />

        {/* ===== tabs ===== */}
        <nav className="flex gap-1 mt-6 mb-6 overflow-x-auto" style={{ borderBottom: `1px solid ${P.line}` }}>
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                fontFamily: MONO,
                color: tab === k ? P.text : P.muted,
                borderBottom: tab === k ? `2px solid ${P.brass}` : "2px solid transparent",
              }}
              className="px-3 py-2 text-sm whitespace-nowrap"
            >
              {label}
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={resetAll} title="Reset to spreadsheet data" style={{ color: P.faint }} className="px-2">
            <RotateCcw size={14} />
          </button>
        </nav>

        {loadErr && (
          <div style={{ border: `1px solid ${P.debit}`, color: P.debit }} className="rounded p-2 text-sm mb-4">
            Couldn't reach the database — the last change shows on screen but may not have saved. Check your connection and retry.
          </div>
        )}

        {tab === "overview" && <Overview data={data} monthTx={monthTx} sums={sums} setPlanned={setPlanned} month={month} />}
        {/* subcategory-aware forms need addSub */}
        {tab === "transactions" && <Transactions data={data} monthTx={monthTx} addTx={addTx} delTx={delTx} updateTx={updateTx} setTxAttachment={setTxAttachment} openPreview={openPreview} openImport={() => setImporting(true)} addSub={addSub} addCredit={addCredit} month={month} />}
        {tab === "pl" && <ProfitLoss data={data} month={month} />}
        {tab === "arap" && <ARAP data={data} addAR={addAR} settleAR={settleAR} delAR={delAR} updateAR={updateAR} addSub={addSub} addCredit={addCredit} openPreview={openPreview} />}
        {tab === "credits" && <CreditsCard data={data} addCredit={addCredit} updateCredit={updateCredit} delCredit={delCredit} />}
        {tab === "calendar" && <CashCalendar data={data} />}
        {tab === "integrations" && <IntegrationsTab data={data} updateLedgerMeta={(patch) => {
          setData((d) => ({ ...d, ledger: { ...d.ledger, ...patch } }));
          setLedgers((ls) => ls.map((l) => (l.id === data.ledger.id ? { ...l, ...patch } : l)));
          dbTry(() => db.updateLedger(data.ledger.id, patch));
        }} />}
      </div>

      {/* ===== floating capture chat (stays mounted so the conversation survives closing) ===== */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
        <div style={{ display: chatOpen ? "block" : "none" }} className="w-80 sm:w-96 max-w-full">
          <div
            style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: "0 16px 48px rgba(0,0,0,0.45)" }}
            className="rounded-lg overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${P.line}` }}>
              <MessageSquare size={14} style={{ color: P.brass }} />
              <div style={{ fontFamily: MONO }} className="text-xs uppercase tracking-widest flex-1">Capture</div>
              <button onClick={() => setChatOpen(false)} style={{ color: P.muted }} className="p-1"><X size={15} /></button>
            </div>
            <Capture data={data} addTx={addTx} addAR={addAR} addSub={addSub} month={month} embedded />
          </div>
        </div>
        <button
          onClick={() => setChatOpen(!chatOpen)}
          title={chatOpen ? "Close capture" : "Capture a receipt, invoice, or quick entry"}
          style={{ background: P.brass, color: "#10120C", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
          className="rounded-full p-4"
        >
          {chatOpen ? <X size={20} /> : <MessageSquare size={20} />}
        </button>
      </div>

      <PreviewModal preview={preview} onClose={closePreview} />
      {newLedgerOpen && <NewLedgerModal onCreate={createLedgerAndSwitch} onClose={() => setNewLedgerOpen(false)} />}
      {reconciling && (
        <ReconcileModal
          currentValue={balance.beforeAnchor ? null : balance.value}
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
            Couldn't load this file from storage. It may have been removed — try re-attaching it.
          </p>
        ) : isImage ? (
          <div className="overflow-auto flex items-center justify-center p-4" style={{ background: P.bg, maxHeight: "75vh" }}>
            <img src={preview.url} alt={preview.name} className="max-w-full rounded" style={{ maxHeight: "70vh" }} />
          </div>
        ) : isPdf ? (
          <iframe src={preview.url} title={preview.name} className="w-full" style={{ height: "75vh", border: "none", background: "#525659" }} />
        ) : (
          <p style={{ color: P.muted }} className="text-sm p-6">
            No inline preview for this file type — use the download button above.
          </p>
        )}
      </div>
    </div>
  );
}

/* ================= balance reconciliation ================= */
function ReconcileModal({ currentValue, anchorAmount, anchorDate, anchorHistory = [], onSave, onImportInstead, onClose }) {
  const [amount, setAmount] = useState("");
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
      <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 style={{ fontFamily: SERIF }} className="text-lg">Correct the balance</h3>
          <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
        </div>
        <p style={{ color: P.muted }} className="text-sm mb-4">
          Check your real accounts and enter the combined total. The ledger anchors to that number on that date —
          months you never tracked before it stop affecting the balance, and only entries you log after it count.
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
            That's {fmt(Math.abs(drift))} {drift > 0 ? "more" : "less"} than the ledger currently shows — the gap is what went untracked.
          </p>
        )}
        <p style={{ color: P.faint }} className="text-xs mb-4">
          Currently anchored: {fmt(anchorAmount)} on {anchorDate}. Entries dated on or before the anchor stay in your
          P&L and history — they just don't feed the balance.
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

/* ================= statement import & reconciliation ================= */
function ImportModal({ data, addSub, onImport, onClose }) {
  const [step, setStep] = useState("input"); // input | review
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]); // parsed + { checked, dup }
  const [ending, setEnding] = useState(null); // { amount, date } from the statement
  const [anchorToo, setAnchorToo] = useState(true);
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
          description: t.description || "—",
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
      setErr(`That file is ${(file.size / 1048576).toFixed(1)} MB — max 8 MB. Export a smaller range or paste the text.`);
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
      setErr("Couldn't read that file from your device — try again or paste the text.");
    }
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.checked);
  const dupCount = rows.filter((r) => r.dup).length;
  const netSelected = selected.reduce((s, r) => s + (r.direction === "credit" ? r.amount : -r.amount), 0);

  const doImport = () => {
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
        account: r.account,
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
              Paste the purchases and deposits straight from your online banking — any format, dates and amounts included —
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
                {dupCount > 0 && <> · <span style={{ color: P.brass }}>{dupCount} look like they're already in the ledger</span> (unchecked — tick any that aren't actually duplicates)</>}.
              </p>
              {err && <p style={{ color: P.faint }} className="text-xs">{err}</p>}
              {ending && (
                <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: P.muted }}>
                  <input type="checkbox" checked={anchorToo} onChange={(e) => setAnchorToo(e.target.checked)} className="mt-0.5" />
                  <span>
                    Also anchor the balance to the statement's ending balance:{" "}
                    <span style={{ fontFamily: MONO, color: P.brass }}>{fmt(ending.amount)}</span> on{" "}
                    <span style={{ fontFamily: MONO }}>{ending.date}</span> — after this, Balance to date matches the bank exactly.
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
              <Btn onClick={doImport} disabled={selected.length === 0 && !(anchorToo && ending)}>
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
  return (
    <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
      <div className="flex flex-wrap justify-between gap-4 mb-3">
        <Stat label="Money in" value={fmt(sums.inc)} color={P.credit} />
        <Stat label="Money out" value={fmt(sums.exp)} color={P.debit} />
        <Stat label="Net this month" value={fmt(sums.net)} color={sums.net >= 0 ? P.credit : P.debit} />
        <button onClick={onReconcile} className="text-left" title="Set or correct the balance against your real accounts">
          <Label>Balance to date · fix</Label>
          <div style={{ fontFamily: MONO, color: P.brass }} className="text-xl tabular-nums underline decoration-dotted underline-offset-4" >
            {balance.beforeAnchor ? "—" : fmt(balance.value)}
          </div>
        </button>
        {creditsLeft !== null && (
          <button onClick={onCredits} className="text-left" title="Non-cash credits remaining across all pools — tap to manage">
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
        {balance.beforeAnchor
          ? `this month ends before your balance anchor (${balance.anchorDate}) — no balance shown`
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
function Overview({ data, monthTx, sums, setPlanned, month }) {
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
    <div className="grid md:grid-cols-2 gap-6">
      <BudgetTable title="Expenses" rows={expRows} extra={zeroExp} type="expense" monthTx={monthTx} setPlanned={setPlanned} onDrill={(cat) => setDrill({ type: "expense", category: cat })} />
      <BudgetTable title="Income" rows={incRows} extra={[]} type="income" monthTx={monthTx} setPlanned={setPlanned} onDrill={(cat) => setDrill({ type: "income", category: cat })} />
      {drill && <CategoryDrill drill={drill} monthTx={monthTx} month={month} onClose={() => setDrill(null)} />}
    </div>
  );
}

/* ---- drill-down: every entry behind a category line ---- */
function CategoryDrill({ drill, monthTx, month, onClose }) {
  const [sortBy, setSortBy] = useState("date"); // date | amount
  const [acct, setAcct] = useState("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = monthTx
    .filter((t) => t.type === drill.type && t.category === drill.category)
    .filter((t) => acct === "all" || t.account === acct)
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
          <div className="flex gap-1">
            {[["all", "all"], ["business", "GENIE AI"], ["personal", "personal"]].map(([k, label]) => (
              <button key={k} onClick={() => setAcct(k)}
                style={{ fontFamily: MONO, color: acct === k ? P.brass : P.faint, border: `1px solid ${acct === k ? P.brass : P.line}` }}
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
                      {isRec(t) && <RecMark />} {t.subcategory ? t.subcategory + " · " : ""}{t.account === "business" ? "business" : "personal"}{isRec(t) ? " · recurring" : ""}{t.attachmentId ? " · 📎 filed" : ""}
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

/* ================= Capture (chat) ================= */
function Capture({ data, addTx, addAR, addSub, month, embedded }) {
  const [msgs, setMsgs] = useState([
    {
      role: "assistant",
      text: "Drop a receipt screenshot or an invoice PDF — or just type something like “paid Vercel $70 today”. I'll read it and pre-fill everything; you confirm the category, personal vs. business, one-time vs. recurring, and whether it's paid or owed. Files are filed with the entry for tax time.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const push = (m) => setMsgs((prev) => [...prev, m]);

  const handleFile = async (file) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (file.size > MAX_FILE_BYTES) {
      push({ role: "assistant", text: `That file is ${(file.size / 1048576).toFixed(1)} MB — I can file attachments up to 8 MB. Try exporting a smaller PDF or a screenshot of it.` });
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
      const draft = await askClaude([block, { type: "text", text: extractionPrompt(data.categories, data.ledger.name) }]);
      push({ role: "assistant", text: draft.note || "Here's what I read — confirm or adjust:", draft, att });
    } catch {
      push({ role: "assistant", text: "I couldn't read that one. Try a clearer file, or type the details (e.g. “Figma $45 on March 10”)." });
    }
    setBusy(false);
  };

  const handleText = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    push({ role: "user", text });
    setBusy(true);
    try {
      const draft = await askClaude([{ type: "text", text: `${extractionPrompt(data.categories, data.ledger.name)}\n\nUser message: "${text}"` }]);
      push({ role: "assistant", text: draft.note || "Got it — confirm or adjust:", draft });
    } catch {
      push({ role: "assistant", text: "I couldn't parse that. Try including an amount, e.g. “paid Canva $40 yesterday”." });
    }
    setBusy(false);
  };

  const saveDraft = async (draft, mode, att) => {
    let attachmentId = null;
    if (att) attachmentId = await storeAttachment(att);
    const filed = att ? (attachmentId ? ` ${att.name} is filed with it.` : " (Heads up: the file itself couldn't be saved to storage, but the entry went through.)") : "";
    const recurrence = draft.recurrence === "recurring" ? "recurring" : "once";
    if (mode === "paid") {
      addTx({
        date: draft.date || todayStr(),
        amount: Number(draft.amount) || 0,
        type: draft.type === "income" ? "income" : "expense",
        category: draft.category,
        description: draft.description,
        account: draft.account === "personal" ? "personal" : "business",
        recurrence,
        subcategory: draft.subcategory || undefined,
        attachmentId: attachmentId || undefined,
        attachmentName: attachmentId ? att.name : undefined,
      });
      push({ role: "assistant", text: `Logged ${fmt(Number(draft.amount) || 0)} — ${draft.description} → ${draft.category}${recurrence === "recurring" ? " (recurring)" : ""}. Totals are updated.${filed}`, done: true });
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
      push({ role: "assistant", text: `Added to ${kind === "receivables" ? "receivables (they owe you)" : "payables (you owe)"} — ${fmt(Number(draft.amount) || 0)} · ${draft.description}${recurrence === "recurring" ? " (recurring)" : ""}. Find it in AR / AP.${filed}`, done: true });
    }
  };

  return (
    <div
      style={embedded ? {} : { background: P.surface, border: `1px solid ${P.line}` }}
      className={(embedded ? "" : "rounded-lg ") + "flex flex-col"}
    >
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
              {m.text && <p style={{ color: m.role === "assistant" ? P.muted : P.text }}>{m.text}</p>}
              {m.draft && <DraftCard draft={m.draft} att={m.att} data={data} addSub={addSub} onSave={saveDraft} />}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> reading…
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
          placeholder="e.g. paid Vercel $70 today…"
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
        <Label>2 · Whose money?</Label>
        <div className="flex gap-1">
          {["business", "personal"].map((a) => (
            <button key={a} onClick={() => set("account", a)}
              style={{
                background: d.account === a ? P.surface2 : "transparent",
                border: `1px solid ${d.account === a ? P.brass : P.line}`,
                color: d.account === a ? P.text : P.muted,
              }}
              className="flex-1 rounded px-2 py-1 text-xs capitalize">
              {a === "business" ? "Business" : "Personal"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>3 · One-time or recurring?</Label>
        <RecToggle value={d.recurrence === "recurring" ? "recurring" : "once"} onChange={(v) => set("recurrence", v)} />
      </div>
      <div>
        <Label>4 · Status</Label>
        <div className="flex gap-1">
          <Btn tone={d.type === "income" ? "credit" : "brass"} className="flex-1 justify-center" onClick={() => { onSave(d, "paid", att); setSaved(true); }}>
            <Check size={14} /> {d.type === "income" ? "Received" : "Paid"} — log it
          </Btn>
          <Btn tone="ghost" className="flex-1 justify-center" onClick={() => { onSave(d, "owed", att); setSaved(true); }}>
            {d.type === "income" ? "Owed to me" : "I owe this"}
          </Btn>
        </div>
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
        style={{ color: P.brass }}
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
        style={{ color: state === "error" ? P.debit : P.faint }}
        className={state === "error" ? "" : "opacity-0 group-hover:opacity-100"}
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
      <div>
        <Label>Account</Label>
        <Select value={f.account} onChange={(e) => set("account", e.target.value)}>
          <option value="business">Business</option><option value="personal">Personal</option>
        </Select>
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

function Transactions({ data, monthTx, addTx, delTx, updateTx, setTxAttachment, openPreview, openImport, addSub, addCredit, month }) {
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

  const list = monthTx
    .filter((t) => filter === "all" || t.account === filter)
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
        <h2 style={{ fontFamily: SERIF }} className="text-lg">{monthLabel(month)} — {list.length} entries</h2>
        <div className="flex gap-2 items-center">
          {["all", "business", "personal"].map((f) => (
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
          <Btn tone="ghost" onClick={openImport} title="Import a bank statement — paste text or upload a file">
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
          <div>
            <Label>Account</Label>
            <Select value={form.account} onChange={(e) => set("account", e.target.value)}>
              <option value="business">Business</option><option value="personal">Personal</option>
            </Select>
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
        <p style={{ color: P.faint }} className="text-sm py-8 text-center">{recOnly ? "No recurring entries this month." : "Nothing logged this month yet — add one above or capture a receipt."}</p>
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
              <div key={t.id} className="flex items-center gap-3 py-2" style={{ borderColor: P.line }}>
                <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs w-12 shrink-0">{t.date?.slice(5)}</div>
                <button onClick={() => setEditingId(t.id)} className="flex-1 min-w-0 text-left" title="Edit this entry">
                  <div className="text-sm truncate">{t.description}</div>
                  <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs flex items-center gap-1">
                    {isRec(t) && <RecMark />}
                    {t.category}{t.subcategory ? " / " + t.subcategory : ""} · {t.account === "business" ? "business" : "personal"}{isRec(t) ? " · recurring" : ""}
                  </div>
                </button>
                {isCredits(t) && (
                  <span style={{ fontFamily: MONO, color: P.brass, border: `1px solid ${P.brass}` }} className="text-xs rounded px-1 shrink-0" title="Paid with credits — doesn't affect cash balance">
                    {creditName(data, t.creditId)}
                  </span>
                )}
                <TxAttachment tx={t} setTxAttachment={setTxAttachment} openPreview={openPreview} />
                <div style={{ fontFamily: MONO, color: t.type === "income" ? P.credit : P.text }} className="text-sm tabular-nums">
                  {t.type === "income" ? "+" : "−"}{fmt(t.amount)}
                </div>
                <button onClick={() => setEditingId(t.id)} style={{ color: P.faint }} title="Edit">
                  <Pencil size={14} />
                </button>
                <button onClick={() => delTx(t.id)} style={{ color: P.faint }} title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}

/* ================= P&L ================= */
function ProfitLoss({ data, month }) {
  const [scope, setScope] = useState("business");
  const inScope = (t) => scope === "all" || t.account === scope;

  const monthTx = data.transactions.filter((t) => t.date?.startsWith(month) && inScope(t));
  const revenue = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const costs = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const recCosts = monthTx.filter((t) => t.type === "expense" && isRec(t)).reduce((s, t) => s + t.amount, 0);
  const creditCosts = monthTx.filter((t) => t.type === "expense" && isCredits(t)).reduce((s, t) => s + t.amount, 0);
  const net = revenue - costs;
  const margin = revenue > 0 ? (net / revenue) * 100 : null;

  const byCat = {};
  monthTx.filter((t) => t.type === "expense").forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(...catRows.map(([, v]) => v), 1);

  // last 6 months trend
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(month, -i));
  const trend = months.map((m) => {
    const tx = data.transactions.filter((t) => t.date?.startsWith(m) && inScope(t));
    const inc = tx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = tx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { m, inc, exp, net: inc - exp };
  });
  const maxTrend = Math.max(...trend.flatMap((t) => [t.inc, t.exp]), 1);

  // open AR/AP for context
  const openAR = data.receivables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0);
  const openAP = data.payables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0);

  const scopeLabel = scope === "business" ? "Business" : scope === "personal" ? "Personal" : "Combined";
  const exportCSV = () => {
    downloadCSV(`PL_${scopeLabel.replace(/\s/g, "")}_${month}.csv`, [
      [`Profit & Loss — ${monthLabel(month)}`, scopeLabel],
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
        .map((t) => [t.date, t.description, t.category, t.subcategory || "", t.account === "personal" ? "Personal" : "Business", t.type, isRec(t) ? "Recurring" : "One-time", (t.type === "income" ? t.amount : -t.amount).toFixed(2)]),
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2 items-center">
        {[["business", "Business"], ["personal", "Personal"], ["all", "Combined"]].map(([k, label]) => (
          <button key={k} onClick={() => setScope(k)}
            style={{
              fontFamily: MONO,
              background: scope === k ? P.surface2 : "transparent",
              border: `1px solid ${scope === k ? P.brass : P.line}`,
              color: scope === k ? P.text : P.muted,
            }}
            className="rounded px-3 py-1 text-xs">
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <Btn tone="ghost" onClick={exportCSV} title="Download this statement + underlying transactions as CSV">
          <Download size={14} /> Export CSV
        </Btn>
      </div>

      <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
        <h2 style={{ fontFamily: SERIF }} className="text-lg mb-3">{monthLabel(month)} statement</h2>
        <div className="space-y-2" style={{ fontFamily: MONO }}>
          <PLRow label="Revenue" value={revenue} color={P.credit} />
          <PLRow label="Costs & expenses" value={-costs} color={P.debit} />
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
            </span>
          </div>
        </div>
        {(openAR > 0 || openAP > 0) && (
          <p style={{ color: P.faint }} className="text-xs mt-3">
            Not yet in these numbers: {fmt(openAR)} still owed to you, {fmt(openAP)} you still owe.
          </p>
        )}
      </section>

      <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
        <h2 style={{ fontFamily: SERIF }} className="text-lg mb-3">Where the money went</h2>
        {catRows.length === 0 ? (
          <p style={{ color: P.faint }} className="text-sm">No expenses in this view for {monthLabel(month)}.</p>
        ) : (
          <div className="space-y-2">
            {catRows.map(([cat, v]) => (
              <div key={cat} className="flex items-center gap-3">
                <div className="w-32 text-sm truncate">{cat}</div>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: P.bg }}>
                  <div style={{ width: `${(v / maxCat) * 100}%`, background: P.debit, opacity: 0.8 }} className="h-full" />
                </div>
                <div style={{ fontFamily: MONO }} className="text-sm tabular-nums w-24 text-right">{fmt(v)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
        <h2 style={{ fontFamily: SERIF }} className="text-lg mb-3">Six-month trend</h2>
        <div className="flex items-end gap-3 h-32">
          {trend.map((t) => (
            <div key={t.m} className="flex-1 flex flex-col items-center gap-1">
              <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: 96 }}>
                <div style={{ height: `${(t.inc / maxTrend) * 100}%`, background: P.credit, width: "30%", minHeight: t.inc ? 2 : 0 }} className="rounded-t" />
                <div style={{ height: `${(t.exp / maxTrend) * 100}%`, background: P.debit, width: "30%", minHeight: t.exp ? 2 : 0 }} className="rounded-t" />
              </div>
              <div style={{ fontFamily: MONO, color: t.m === month ? P.brass : P.faint }} className="text-xs">
                {t.m.slice(5)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const PLRow = ({ label, value, color }) => (
  <div className="flex justify-between text-sm">
    <span style={{ color: P.muted }}>{label}</span>
    <span style={{ color }} className="tabular-nums">{fmt(value)}</span>
  </div>
);

/* ================= AR / AP ================= */
function ARAP({ data, addAR, settleAR, delAR, updateAR, addSub, addCredit, openPreview }) {
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
      ["Open — owed to you", openAR.toFixed(2)],
      ["Open — you owe", openAP.toFixed(2)],
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
          <Btn tone="ghost" onClick={exportCSV} title="Download all receivables & payables as CSV">
            <Download size={14} /> Export CSV
          </Btn>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden" style={{ background: P.bg }}>
          <div style={{ width: `${(openAR / (openAR + openAP || 1)) * 100}%`, background: P.credit }} />
          <div style={{ width: `${(openAP / (openAR + openAP || 1)) * 100}%`, background: P.debit }} />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <ARList kind="receivables" title="Receivables — they owe you" items={data.receivables} data={data} addAR={addAR} settleAR={settleAR} delAR={delAR} updateAR={updateAR} addSub={addSub} addCredit={addCredit} openPreview={openPreview} tone={P.credit} action="Mark received" />
        <ARList kind="payables" title="Payables — you owe them" items={data.payables} data={data} addAR={addAR} settleAR={settleAR} delAR={delAR} updateAR={updateAR} addSub={addSub} addCredit={addCredit} openPreview={openPreview} tone={P.debit} action="Mark paid" />
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
          <p style={{ color: P.faint }} className="text-xs mt-1">Settling this moves credits, not cash — your balance won't change.</p>
        )}
      </div>
    </>
  );
}

function ARList({ kind, title, items, data, addAR, settleAR, delAR, updateAR, addSub, addCredit, openPreview, tone, action }) {
  const [adding, setAdding] = useState(false);
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
  const open = items.filter((i) => i.status === "open");
  const settled = items.filter((i) => i.status !== "open");

  const onInvoice = async (file) => {
    if (!file) return;
    setReadErr("");
    if (file.size > MAX_FILE_BYTES) {
      setReadErr(`That file is ${(file.size / 1048576).toFixed(1)} MB — max 8 MB. Try a smaller export or a screenshot.`);
      return;
    }
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    setReading(true);
    try {
      const b64 = await fileToB64(file);
      const block = isPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: file.type || "image/png", data: b64 } };
      const d = await askClaude([block, { type: "text", text: arExtractionPrompt(kind) }]);
      setForm({
        ...blank,
        party: d.party || "",
        description: d.description || "",
        amount: d.amount != null ? String(d.amount) : "",
        dueDate: d.dueDate || todayStr(),
        recurrence: d.recurrence === "recurring" ? "recurring" : "once",
      });
      setAtt({ name: file.name || "invoice.pdf", type: isPdf ? "application/pdf" : (file.type || "image/png"), data: b64, file });
      if (d.note) setReadErr(d.note);
      setAdding(true);
    } catch {
      setReadErr("Couldn't read that invoice — check the fields yourself or try a clearer file.");
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

  return (
    <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
      <div className="flex justify-between items-center mb-3 gap-2">
        <h2 style={{ fontFamily: SERIF }} className="text-lg flex-1">{title}</h2>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={(e) => { onInvoice(e.target.files[0]); e.target.value = ""; }} />
        <Btn tone="ghost" onClick={() => fileRef.current.click()} disabled={reading}
          title={`Upload an invoice — I'll read it and pre-fill this ${kind === "receivables" ? "receivable" : "payable"}`}>
          {reading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
        </Btn>
        <Btn tone="ghost" onClick={() => (adding ? cancelAdd() : setAdding(true))} title="Add manually">
          {adding ? <X size={14} /> : <Plus size={14} />}
        </Btn>
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
          <ARFields kind={kind} f={form} set={set} data={data} addSub={addSub} addCredit={addCredit} />
          {readErr && <p style={{ color: P.brass }} className="text-xs">{readErr}</p>}
          <Btn className="w-full justify-center" onClick={submit}><Check size={14} /> Add</Btn>
        </div>
      )}

      {open.length === 0 && !adding ? (
        <p style={{ color: P.faint }} className="text-sm py-4">Nothing open. Upload an invoice with the file button, add one with +, or capture it in the chat.</p>
      ) : (
        <div className="space-y-2">
          {open.map((i) => {
            const overdue = i.dueDate && i.dueDate < todayStr();
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
              <div key={i.id} style={{ background: P.bg, border: `1px solid ${overdue ? P.debit : P.line}` }} className="rounded-lg p-3 flex items-center gap-2">
                <button onClick={() => { setEditingId(i.id); setEditForm({ ...i, amount: String(i.amount), frequency: i.frequency || "monthly", category: i.category || defaultCat }); }} className="flex-1 min-w-0 text-left" title="Edit">
                  <div className="text-sm truncate">{i.party}</div>
                  <div style={{ fontFamily: MONO, color: overdue ? P.debit : P.faint }} className="text-xs flex items-center gap-1 flex-wrap">
                    {isRec(i) && <RecMark />}
                    {i.description || "—"} · due {i.dueDate}{overdue ? " · overdue" : ""}
                    {isRec(i) ? ` · ${freqLabel(i.frequency || "monthly")}` : ""}
                    {i.subcategory ? ` · ${i.subcategory}` : ""}
                  </div>
                  {isCredits(i) && (
                    <div style={{ fontFamily: MONO, color: P.brass }} className="text-xs">{creditName(data, i.creditId)} credits — no cash moves</div>
                  )}
                </button>
                <div style={{ fontFamily: MONO, color: tone }} className="text-sm tabular-nums">{fmt(i.amount)}</div>
                {i.attachmentId && (
                  <button onClick={() => openPreview(i.attachmentId, i.attachmentName)} title={`View ${i.attachmentName || "invoice"}`} style={{ color: P.brass }}>
                    <Paperclip size={13} />
                  </button>
                )}
                <button onClick={() => { setEditingId(i.id); setEditForm({ ...i, amount: String(i.amount), frequency: i.frequency || "monthly", category: i.category || defaultCat }); }} style={{ color: P.faint }} title="Edit">
                  <Pencil size={13} />
                </button>
                <Btn tone="ghost" onClick={() => settleAR(kind, i.id)} title={`${action} — logs a transaction dated today`}>
                  <Check size={13} />
                </Btn>
                <button onClick={() => delAR(kind, i.id)} style={{ color: P.faint }}><Trash2 size={13} /></button>
              </div>
            );
          })}
        </div>
      )}

      {settled.length > 0 && (
        <div className="mt-3">
          <Label>Settled</Label>
          {settled.slice(0, 5).map((i) => (
            <div key={i.id} style={{ color: P.faint, fontFamily: MONO }} className="text-xs flex justify-between py-0.5">
              <span className="truncate">{i.party}{isCredits(i) ? " (credits)" : ""}</span><span>{fmt(i.amount)} · {i.settledOn}</span>
            </div>
          ))}
        </div>
      )}
    </section>
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
        Non-cash pools — AWS credits, AI compute credits, MongoDB credits, SR&ED. Anything "paid via" a pool draws it
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
        <p style={{ color: P.faint }} className="text-sm py-2">No credit pools yet — add one with +, or pick "+ add a credit pool…" right inside any Paid via dropdown.</p>
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
                    "Used outside the app" covers burn that never went through the ledger — everything you log with
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
                    <button onClick={() => { setEditingId(c.id); setEdit({ name: c.name, initial: String(c.initial), usedAdjustment: String(c.usedAdjustment || 0) }); }} style={{ color: P.faint }} title="Edit"><Pencil size={12} /></button>
                    <button onClick={() => { if (window.confirm(`Remove the ${c.name} pool? Past entries keep their credit tag.`)) delCredit(c.id); }} style={{ color: P.faint }} title="Remove"><Trash2 size={12} /></button>
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
function occurrencesBetween(data, startDate, endDate, today) {
  const out = [];
  for (const kind of ["receivables", "payables"]) {
    for (const item of data[kind]) {
      if (item.status !== "open") continue;
      let due = item.dueDate || today;
      // overdue base occurrence (shown regardless of window start)
      if (due < today) out.push({ ...item, kind, due, overdue: true });
      if (item.recurrence === "recurring") {
        while (due < today) due = addInterval(due, item.frequency || "monthly");
      } else if ((item.dueDate || today) < startDate || (item.dueDate || today) > endDate) {
        continue;
      }
      let guard = 0;
      while (due <= endDate && guard < 36) {
        if (due >= today && due >= startDate) {
          out.push({ ...item, kind, due, overdue: false, projected: guard > 0 || (item.dueDate || today) < today });
        }
        if (item.recurrence !== "recurring") break;
        due = addInterval(due, item.frequency || "monthly");
        guard += 1;
      }
    }
  }
  return out;
}

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
          {o.description || "—"}{isRec(o) ? ` · ${freqLabel(o.frequency || "monthly")}` : ""}{o.projected ? " · projected" : ""}
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
              plus {fmt(creditsOut)} due in credits — not counted in cash impact
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
    <div style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex justify-between items-start mb-1">
        <h3 style={{ fontFamily: SERIF }} className="text-xl">{onboarding ? "Set up your first ledger" : "New ledger"}</h3>
        {!onboarding && <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>}
      </div>
      <p style={{ color: P.muted }} className="text-sm mb-4">
        A ledger is one set of books — a company, or your personal finances. You can add more anytime and switch from the header.
      </p>
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "business" ? "e.g. GENIE AI" : "e.g. Bilal — personal"} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <div>
          <Label>Type</Label>
          <div className="flex gap-1">
            {[["business", "Business"], ["personal", "Personal"]].map(([k, label]) => (
              <button key={k} onClick={() => setKind(k)}
                style={{ background: kind === k ? P.surface2 : "transparent", border: `1px solid ${kind === k ? P.brass : P.line}`, color: kind === k ? P.text : P.muted }}
                className="flex-1 rounded px-2 py-1.5 text-sm">
                {label}
              </button>
            ))}
          </div>
          <p style={{ color: P.faint }} className="text-xs mt-1">
            {kind === "business" ? "Starts with business categories (revenue, salaries, software, hosting…) and unlocks the CRA T2 draft." : "Starts with personal categories (home, food, transport…)."}
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
      <div style={{ background: P.bg, minHeight: "100vh", fontFamily: "ui-sans-serif, system-ui, sans-serif", color: P.text }} className="flex items-center justify-center p-4">
        {body}
      </div>
    );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      {body}
    </div>
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

function fiscalWindow(fye, endYear) {
  // fye "MM-DD"; returns [startDate, endDate] for the fiscal year ending in endYear
  const end = `${endYear}-${fye}`;
  const s = new Date(end + "T00:00:00");
  s.setFullYear(s.getFullYear() - 1);
  s.setDate(s.getDate() + 1);
  return [s.toISOString().slice(0, 10), end];
}
const addMonths = (dateStr, m) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + m);
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
};

function IntegrationsTab({ data, updateLedgerMeta }) {
  const isBiz = data.ledger.kind === "business";
  const bizTx = data.transactions.filter((t) => (isBiz ? true : t.account === "business"));
  const yearsAvail = [...new Set(bizTx.map((t) => Number((t.date || "").slice(0, 4))).filter(Boolean))].sort((a, b) => b - a);
  const [fy, setFy] = useState(yearsAvail[0] || new Date().getFullYear());
  const [draft, setDraft] = useState(false);
  const [path, setPath] = useState("B");
  const [copied, setCopied] = useState(false);
  const [accEmail, setAccEmail] = useState("");
  const [accNote, setAccNote] = useState(`Hi — below is our GIFI-coded T2 draft for ${data.ledger.name}. Balance sheet items still to come from your side. Can you review and let me know what else you need?`);
  const [emailCopied, setEmailCopied] = useState(false);

  const fye = data.ledger.fye || "12-31";
  const [fyStart, fyEnd] = fiscalWindow(fye, fy);
  const fyTx = bizTx.filter((t) => t.date >= fyStart && t.date <= fyEnd);
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
    (creditsCovered > 0 ? `\nNote: ${creditsCovered.toFixed(2)} of expenses covered by vendor credits (non-cash) — flag for SR&ED/ITC review.` : "");

  const copyDraft = () => {
    navigator.clipboard?.writeText(draftText().replace(/\\n/g, "\n")).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const exportGifiCSV = () => {
    downloadCSV(`T2_GIFI_${data.ledger.name.replace(/\s/g, "")}_FY${fy}.csv`, [
      [`T2 draft (GIFI) — ${data.ledger.name}`, `${fyStart} to ${fyEnd}`],
      [],
      ["GIFI code", "Line", "Amount"],
      ...gifiRows.map((r) => [r.code, r.name, r.amount.toFixed(2)]),
      [],
      ["Covered by vendor credits (non-cash)", "", creditsCovered.toFixed(2)],
    ]);
  };
  const mailtoHref = () => {
    const subject = encodeURIComponent(`${data.ledger.name} — T2 draft (GIFI) for review`);
    const body = encodeURIComponent(accNote + "\n\n" + draftText().replace(/\\n/g, "\n"));
    return `mailto:${accEmail}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="space-y-6">
      {/* ---------- bank feed ---------- */}
      <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 style={{ fontFamily: SERIF }} className="text-lg leading-tight">Bank feed</h2>
            <p style={{ color: P.muted }} className="text-sm">Automatic transaction sync via Plaid</p>
          </div>
          <span style={{ fontFamily: MONO, color: P.faint, border: `1px solid ${P.line}` }} className="text-xs rounded-full px-2 py-0.5">not connected</span>
        </div>
        <p style={{ color: P.muted }} className="text-sm mt-3">
          Canadian banks don't expose direct APIs — feeds run through an aggregator. Once keys are in place, new
          purchases and deposits land in the same review queue as statement import: duplicates auto-detected,
          categories pre-assigned, nothing saved until confirmed. Until then, the statement import in Transactions
          covers the same ground manually.
        </p>
        <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-3 mt-3 space-y-1.5">
          {[
            ["1", "Create a Plaid account (plaid.com) — the free tier covers a small number of linked banks"],
            ["2", "Add PLAID_CLIENT_ID and PLAID_SECRET as Supabase Edge Function secrets (same place as the Anthropic key)"],
            ["3", "Ask your developer (or Claude) to deploy the sync function — the app is structured so this slots in without reworking anything"],
          ].map(([n, t]) => (
            <div key={n} className="flex gap-2 text-sm" style={{ color: P.muted }}>
              <span style={{ fontFamily: MONO, color: P.brass }}>{n}.</span><span>{t}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- CRA T2 ---------- */}
      <section style={{ background: P.surface, border: `1px solid ${P.line}` }} className="rounded-lg p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 style={{ fontFamily: SERIF }} className="text-lg leading-tight">CRA — Corporate tax (T2)</h2>
            <p style={{ color: P.muted }} className="text-sm">GIFI-coded draft from {isBiz ? "this ledger" : "this ledger's business entries"}, ready for certified software or your accountant</p>
          </div>
        </div>

        <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-3 mt-3">
          <p style={{ color: P.muted }} className="text-xs">
            Straight talk: the CRA has no public API for T2 filing — returns go through CRA-certified software or an
            accountant's EFILE. This does the 90% before that: your year mapped onto GIFI line codes, so filing becomes
            data entry instead of bookkeeping archaeology.
          </p>
        </div>

        <div className="grid sm:grid-cols-4 gap-3 mt-4 items-end">
          <div>
            <Label>Fiscal year ending</Label>
            <Select value={fy} onChange={(e) => { setFy(Number(e.target.value)); setDraft(false); }}>
              {(yearsAvail.length ? yearsAvail : [new Date().getFullYear()]).map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
          <div>
            <Label>Year-end (FYE)</Label>
            <Select value={fye} onChange={(e) => updateLedgerMeta({ fye: e.target.value })}>
              {["12-31", "01-31", "02-28", "03-31", "04-30", "05-31", "06-30", "07-31", "08-31", "09-30", "10-31", "11-30"].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Btn onClick={() => setDraft(true)}><FileText size={14} /> Generate T2 draft</Btn>
          </div>
        </div>

        {draft && (
          <div className="mt-4 space-y-4">
            <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
              <Label>Deadlines for FYE {fyEnd}</Label>
              <div className="grid sm:grid-cols-3 gap-3 mt-1">
                {[
                  [addMonths(fyEnd, 3), "Balance owing due", "3 months after year-end (CCPC claiming the small business deduction)"],
                  [addMonths(fyEnd, 6), "T2 return due", "6 months after year-end — file even if no tax is owing"],
                  [addMonths(fyEnd, 18), "SR&ED claim cutoff", "T661 within 18 months of year-end — hard deadline, no extensions"],
                ].map(([date, title, sub]) => (
                  <div key={title}>
                    <div style={{ fontFamily: MONO, color: P.brass }} className="text-sm">{date}</div>
                    <div className="text-sm" style={{ color: P.text }}>{title}</div>
                    <div className="text-xs" style={{ color: P.faint }}>{sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
              <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                <Label>Schedule 125 — income statement (GIFI) · {fyStart} → {fyEnd}</Label>
                <div className="flex gap-2">
                  <Btn tone="ghost" onClick={copyDraft}>{copied ? <Check size={13} /> : null} {copied ? "Copied" : "Copy"}</Btn>
                  <Btn tone="ghost" onClick={exportGifiCSV}><Download size={13} /> CSV</Btn>
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
                  note for your accountant: {fmt(creditsCovered)} of expenses were covered by vendor credits (non-cash) — flag for SR&ED/ITC review
                </p>
              )}
              <p style={{ color: P.faint }} className="text-xs mt-2">
                GIFI codes are inferred from your categories/subcategories — have your accountant confirm the mapping.
                Schedule 100 (balance sheet) needs assets/liabilities the ledger doesn't track.
              </p>
            </div>

            <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
              <Label>How to file this</Label>
              <div className="flex gap-1 mt-1 mb-3 flex-wrap">
                {[["A", "File it myself"], ["B", "Through my accountant"], ["C", "After it's filed"]].map(([k, label]) => (
                  <button key={k} onClick={() => setPath(k)}
                    style={{ fontFamily: MONO, background: path === k ? P.surface2 : "transparent", border: `1px solid ${path === k ? P.brass : P.line}`, color: path === k ? P.text : P.muted }}
                    className="rounded px-3 py-1 text-xs">
                    {label}
                  </button>
                ))}
              </div>
              {(path === "A" ? [
                ["Pick CRA-certified T2 software", "UFile T2 (~$200/return), TaxTron T2, or WebTax4B — the certified list is on canada.ca. This CSV pastes into their GIFI screens line-for-line."],
                ["Enter identification + GIFI lines", "BN (9 digits + RC0001), tax year dates, then Schedule 125 from this draft. Schedule 100 needs your bank balance, receivables (AR tab), payables, and share capital."],
                ["Get your Web Access Code", "The software fetches it with your BN, or call CRA business enquiries (1-800-959-5525)."],
                ["Transmit + save the confirmation", "File, save the confirmation number, and attach it to a $0 entry in the ledger so the paper trail lives with the books."],
              ] : path === "B" ? [
                ["Send the package below", "GIFI draft + P&L export + AR/AP export — a complete handoff. Every entry already has its invoice filed in the app."],
                ["Flag the SR&ED angle", "Dev salaries and compute costs are claim material, and credit-covered expenses need specific T661 treatment."],
                ["Authorize them in Represent a Client", "Approve their RepID in CRA My Business Account — they EFILE, you never touch a form."],
                ["Review + sign the T183CORP", "The one thing you personally sign before they transmit."],
              ] : [
                ["Track the return", "CRA My Business Account shows assessment status, balance owing, and instalments."],
                ["Watch for the Notice of Assessment", "Usually 2–6 weeks e-filed — attach it to a $0 entry in the ledger."],
                ["Instalments if owing > $3,000", "Add next year's quarterly instalments as recurring payables so the Calendar warns you."],
                ["Anchor after paying", "When the tax payment clears the bank, log it and re-anchor the balance."],
              ]).map(([t, b], i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <span style={{ fontFamily: MONO, color: P.brass }} className="text-sm shrink-0">{i + 1}.</span>
                  <div><div className="text-sm" style={{ color: P.text }}>{t}</div><div className="text-xs" style={{ color: P.muted }}>{b}</div></div>
                </div>
              ))}
            </div>

            <div style={{ background: P.bg, border: `1px solid ${P.line}` }} className="rounded-lg p-4">
              <Label>Send to your accountant</Label>
              <div className="space-y-2 mt-1">
                <div><Label>Accountant's email</Label><Input type="email" value={accEmail} onChange={(e) => setAccEmail(e.target.value)} placeholder="taxes@yourcpa.ca" /></div>
                <div>
                  <Label>Message</Label>
                  <textarea value={accNote} onChange={(e) => setAccNote(e.target.value)} rows={3}
                    style={{ background: P.surface, border: `1px solid ${P.line}`, color: P.text }}
                    className="rounded px-2 py-1.5 text-sm w-full outline-none" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={accEmail.includes("@") ? mailtoHref() : undefined}
                    style={{ background: accEmail.includes("@") ? P.brass : P.surface2, color: "#10120C", opacity: accEmail.includes("@") ? 1 : 0.4, pointerEvents: accEmail.includes("@") ? "auto" : "none" }}
                    className="rounded px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5">
                    <Mail size={14} /> Open in your email app
                  </a>
                  <Btn tone="ghost" onClick={() => {
                    navigator.clipboard?.writeText(`To: ${accEmail}\nSubject: ${data.ledger.name} — T2 draft (GIFI) for review\n\n${accNote}\n\n${draftText().replace(/\\n/g, "\n")}`).catch(() => {});
                    setEmailCopied(true); setTimeout(() => setEmailCopied(false), 2000);
                  }}>
                    {emailCopied ? <Check size={13} /> : null} {emailCopied ? "Copied" : "Copy as email text"}
                  </Btn>
                </div>
                <p style={{ color: P.faint }} className="text-xs">
                  Opens pre-filled with the GIFI draft in the body. Attach the CSV (button above) plus your P&L and AR/AP exports before sending.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
