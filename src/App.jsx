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
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
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

/* ================= AI extraction prompts ================= */
function extractionPrompt(cats) {
  return `You extract transaction data for a personal + business (GENIE AI) budget app.
Expense categories: ${cats.expense.map((c) => c.name).join(", ")}.
Income categories: ${cats.income.map((c) => c.name).join(", ")}.
Today's date: ${todayStr()}.
Respond ONLY with raw JSON (no markdown, no preamble):
{"type":"expense"|"income","amount":number,"date":"YYYY-MM-DD","description":"vendor/short description","category":"one of the listed categories for that type","account":"business"|"personal","recurrence":"recurring"|"once","note":"one short line on anything you were unsure about, else empty string"}
Software/SaaS/cloud/contractor items are business (GENIE AI category). If the date is missing, use today's date. Amount is the total paid.
recurrence: "recurring" for subscriptions, SaaS, hosting, rent/mortgage, salaries, retainers, utilities — anything billed on a repeating cycle; "once" for one-off purchases.`;
}

function arExtractionPrompt(kind) {
  const who =
    kind === "receivables"
      ? `This document is an invoice the user's business (GENIE AI) ISSUED to a client — money owed TO the user. "party" is the client being billed (the bill-to / customer name), NOT GENIE AI.`
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
        <div style={{ fontFamily: MONO, color: P.brass }} className="text-xs uppercase tracking-widest">GENIE AI · Personal</div>
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

function statementPrompt(cats) {
  return `You parse bank and credit-card statements for a personal + business (GENIE AI) budget app.
Extract EVERY transaction line — do not summarize, skip, or merge lines.
Expense categories (for debits): ${cats.expense.map((c) => c.name).join(", ")}.
Income categories (for credits): ${cats.income.map((c) => c.name).join(", ")}.
Today's date: ${todayStr()}. If the statement omits the year, infer it from context.
Respond ONLY with raw JSON (no markdown, no preamble):
{"transactions":[{"date":"YYYY-MM-DD","amount":number (always positive),"direction":"debit"|"credit","description":"cleaned-up merchant/description","category":"best fit from the matching list","account":"business"|"personal","recurrence":"recurring"|"once"}],
"endingBalance":number or null (the statement's closing/ending balance if shown),
"endingBalanceDate":"YYYY-MM-DD" or null (the statement period end date),
"note":"one short line about anything skipped or ambiguous, else empty string"}
Rules: debit = money leaving the account (purchases, fees, transfers out); credit = money in (deposits, refunds, payroll).
Software/SaaS/cloud/hosting/contractor charges → account "business", category "GENIE AI". Salaries/payroll deposits → "Paycheck".
recurrence: "recurring" for subscriptions, rent/mortgage, utilities, payroll; otherwise "once".
Ignore running-balance columns, section headers, and totals rows — they are not transactions.`;
}

/* ================= main app ================= */
function Ledger({ onSignOut }) {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [tab, setTab] = useState("overview");
  const [month, setMonth] = useState("2026-03");
  const [theme, setThemeState] = useState("dark");
  const [preview, setPreview] = useState(null); // { url, name, type } | { error: true }
  const [chatOpen, setChatOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [importing, setImporting] = useState(false);

  /* ---- load from Supabase (seeds the spreadsheet data on first sign-in) ---- */
  useEffect(() => {
    (async () => {
      try {
        const loaded = await db.loadAll();
        const t = loaded.settings.theme === "light" ? "light" : "dark";
        Object.assign(P, PALETTES[t]);
        setThemeState(t);
        // always open on the current calendar month; history stays one tap away via ‹
        setMonth(thisMonth());
        setData(loaded);
      } catch (e) {
        console.error(e);
        setLoadErr(true);
        setData({
          settings: { startingBalance: 0, anchorDate: "1970-01-01", currency: "CAD", theme: "dark" },
          categories: { expense: [], income: [] },
          transactions: [], receivables: [], payables: [], anchorHistory: [],
        });
      }
    })();
  }, []);

  // local state updates immediately; the matching database write runs behind it
  const dbTry = async (fn) => {
    try { await fn(); setLoadErr(false); } catch (e) { console.error(e); setLoadErr(true); }
  };

  /* ---- derived ---- */
  const monthTx = useMemo(
    () => (data ? data.transactions.filter((t) => t.date && t.date.startsWith(month)) : []),
    [data, month]
  );
  const sums = useMemo(() => {
    const inc = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
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
      .filter((t) => t.date && t.date > anchorDate && t.date.slice(0, 7) <= month)
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
      category: kind === "receivables" ? "Client revenue" : "GENIE AI",
      description: `${kind === "receivables" ? "Received" : "Paid"}: ${item.party} — ${item.description}`,
      account: item.account || "business",
      recurrence: item.recurrence,
      attachmentId: item.attachmentId,
      attachmentName: item.attachmentName,
    };
    setData((d) => ({
      ...d,
      [kind]: d[kind].map((x) => (x.id === id ? { ...x, status: "paid", settledOn: todayStr() } : x)),
      transactions: [tx, ...d.transactions],
    }));
    setMonth(thisMonth());
    dbTry(async () => {
      await db.updateObligation(id, { status: "paid", settledOn: todayStr() });
      await db.insertTransaction(tx);
    });
  };
  const delAR = (kind, id) => {
    const item = data[kind].find((x) => x.id === id);
    // keep the file if it was settled — the transaction still points at it
    if (item?.attachmentId && item.status === "open") deleteAttachment(item.attachmentId);
    setData((d) => ({ ...d, [kind]: d[kind].filter((x) => x.id !== id) }));
    dbTry(() => db.deleteObligation(id));
  };
  const resetAll = async () => {
    if (!window.confirm("Reset the ledger to the original spreadsheet data? Everything you've added will be removed.")) return;
    setData(null);
    try {
      await db.resetAll();
    } catch (e) { console.error(e); }
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
  ];

  return (
    <div style={{ background: P.bg, color: P.text, minHeight: "100vh", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="max-w-5xl mx-auto px-4 pb-28">
        {/* ===== header ===== */}
        <header className="pt-6 pb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div style={{ fontFamily: MONO, color: P.brass }} className="text-xs uppercase tracking-widest">
              GENIE AI · Personal
            </div>
            <h1 style={{ fontFamily: SERIF }} className="text-3xl leading-tight">
              The Ledger
            </h1>
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
        <LedgerLine sums={sums} balance={balance} openBooks={openBooks} onReconcile={() => setReconciling(true)} />

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
        {tab === "transactions" && <Transactions data={data} monthTx={monthTx} addTx={addTx} delTx={delTx} updateTx={updateTx} setTxAttachment={setTxAttachment} openPreview={openPreview} openImport={() => setImporting(true)} month={month} />}
        {tab === "pl" && <ProfitLoss data={data} month={month} />}
        {tab === "arap" && <ARAP data={data} addAR={addAR} settleAR={settleAR} delAR={delAR} openPreview={openPreview} />}
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
            <Capture data={data} addTx={addTx} addAR={addAR} month={month} embedded />
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
        <ImportModal data={data} onImport={importStatement} onClose={() => setImporting(false)} />
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
function ImportModal({ data, onImport, onClose }) {
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
    runParse([{ type: "text", text: `${statementPrompt(data.categories)}\n\nSTATEMENT TEXT:\n${text.slice(0, 60000)}` }]);
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
        runParse([{ type: "text", text: `${statementPrompt(data.categories)}\n\nSTATEMENT TEXT:\n${text.slice(0, 60000)}` }]);
      } else {
        const b64 = await fileToB64(file);
        const block = isPdf
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
          : { type: "image", source: { type: "base64", media_type: file.type || "image/png", data: b64 } };
        runParse([block, { type: "text", text: statementPrompt(data.categories) }]);
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
                        onChange={(e) => setRow(i, { category: e.target.value })}
                        style={{ background: P.bg, border: `1px solid ${P.line}`, color: P.text }}
                        className="rounded px-1 py-0.5 text-xs w-28"
                      >
                        {cats.map((c) => <option key={c}>{c}</option>)}
                      </select>
                      <button
                        onClick={() => setRow(i, { account: r.account === "business" ? "personal" : "business" })}
                        title="Toggle GENIE AI / personal"
                        style={{ fontFamily: MONO, color: P.muted, border: `1px solid ${P.line}` }}
                        className="rounded px-1.5 py-0.5 text-xs w-9 text-center"
                      >
                        {r.account === "business" ? "GA" : "P"}
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
function LedgerLine({ sums, balance, openBooks, onReconcile }) {
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
      <BudgetTable title="Expenses" rows={expRows} extra={zeroExp} type="expense" setPlanned={setPlanned} onDrill={(cat) => setDrill({ type: "expense", category: cat })} />
      <BudgetTable title="Income" rows={incRows} extra={[]} type="income" setPlanned={setPlanned} onDrill={(cat) => setDrill({ type: "income", category: cat })} />
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
                      {isRec(t) && <RecMark />} {t.account === "business" ? "GENIE AI" : "personal"}{isRec(t) ? " · recurring" : ""}{t.attachmentId ? " · 📎 filed" : ""}
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

function BudgetTable({ title, rows, extra, type, setPlanned, onDrill }) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(null);
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
                <button
                  onClick={() => r.actual > 0 && onDrill(r.name)}
                  title={r.actual > 0 ? "View the entries behind this line" : undefined}
                  style={{ color: P.text, cursor: r.actual > 0 ? "pointer" : "default", textDecorationColor: P.faint }}
                  className={"truncate text-left " + (r.actual > 0 ? "underline decoration-dotted underline-offset-2" : "")}
                >
                  {r.name}
                </button>
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
function Capture({ data, addTx, addAR, month, embedded }) {
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
      const draft = await askClaude([block, { type: "text", text: extractionPrompt(data.categories) }]);
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
      const draft = await askClaude([{ type: "text", text: `${extractionPrompt(data.categories)}\n\nUser message: "${text}"` }]);
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
              {m.draft && <DraftCard draft={m.draft} att={m.att} data={data} onSave={saveDraft} />}
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

function DraftCard({ draft, att, data, onSave }) {
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
        <Select value={d.category} onChange={(e) => set("category", e.target.value)}>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </Select>
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
              {a === "business" ? "GENIE AI" : "Personal"}
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
function TxEditor({ tx, data, onSave, onCancel }) {
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
    });
  };

  return (
    <div style={{ background: P.bg, border: `1px solid ${P.brass}` }} className="rounded-lg p-3 my-2 grid sm:grid-cols-6 gap-2 items-end">
      <div><Label>Date</Label><Input type="date" value={f.date || ""} onChange={(e) => set("date", e.target.value)} /></div>
      <div><Label>Amount</Label><Input type="number" value={f.amount} onChange={(e) => set("amount", e.target.value)} style={{ fontFamily: MONO }} /></div>
      <div>
        <Label>Type</Label>
        <Select value={f.type} onChange={(e) => { const t = e.target.value; setF((p) => ({ ...p, type: t, category: data.categories[t][0].name })); }}>
          <option value="expense">Expense</option><option value="income">Income</option>
        </Select>
      </div>
      <div>
        <Label>Category</Label>
        <Select value={cats.includes(f.category) ? f.category : cats[0]} onChange={(e) => set("category", e.target.value)}>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </div>
      <div>
        <Label>Account</Label>
        <Select value={f.account} onChange={(e) => set("account", e.target.value)}>
          <option value="business">GENIE AI</option><option value="personal">Personal</option>
        </Select>
      </div>
      <div><Label>Frequency</Label><RecToggle value={f.recurrence === "recurring" ? "recurring" : "once"} onChange={(v) => set("recurrence", v)} /></div>
      <div className="sm:col-span-4"><Label>Description</Label><Input value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
      <div className="sm:col-span-2 flex gap-2">
        <Btn className="flex-1 justify-center" onClick={save}><Check size={14} /> Save changes</Btn>
        <Btn tone="ghost" onClick={onCancel}><X size={14} /></Btn>
      </div>
    </div>
  );
}

function Transactions({ data, monthTx, addTx, delTx, updateTx, setTxAttachment, openPreview, openImport, month }) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("all");
  const [recOnly, setRecOnly] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const blank = { date: `${month}-15`, amount: "", type: "expense", category: "GENIE AI", description: "", account: "business", recurrence: "once" };
  const [form, setForm] = useState(blank);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const list = monthTx
    .filter((t) => filter === "all" || t.account === filter)
    .filter((t) => !recOnly || isRec(t))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const recTotal = list.filter(isRec).reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);

  const submit = () => {
    if (!form.amount || !form.description) return;
    addTx({ ...form, amount: parseFloat(form.amount) });
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
            <Select value={form.type} onChange={(e) => { const t = e.target.value; setForm((p) => ({ ...p, type: t, category: data.categories[t][0].name })); }}>
              <option value="expense">Expense</option><option value="income">Income</option>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
              {data.categories[form.type].map((c) => <option key={c.name}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Account</Label>
            <Select value={form.account} onChange={(e) => set("account", e.target.value)}>
              <option value="business">GENIE AI</option><option value="personal">Personal</option>
            </Select>
          </div>
          <div className="sm:col-span-4"><Label>Description</Label><Input placeholder="What was it?" value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
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
                    {t.category} · {t.account === "business" ? "GENIE AI" : "personal"}{isRec(t) ? " · recurring" : ""}
                  </div>
                </button>
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

  const scopeLabel = scope === "business" ? "GENIE AI" : scope === "personal" ? "Personal" : "Combined";
  const exportCSV = () => {
    downloadCSV(`PL_${scopeLabel.replace(/\s/g, "")}_${month}.csv`, [
      [`Profit & Loss — ${monthLabel(month)}`, scopeLabel],
      [],
      ["Revenue", revenue.toFixed(2)],
      ["Costs & expenses", (-costs).toFixed(2)],
      ["  of which recurring", (-recCosts).toFixed(2)],
      ["  of which one-time", (-(costs - recCosts)).toFixed(2)],
      [`Net ${net >= 0 ? "profit" : "loss"}`, net.toFixed(2)],
      ["Margin", margin !== null ? `${margin.toFixed(1)}%` : "n/a"],
      [],
      ["Expenses by category"],
      ...catRows.map(([c, v]) => [c, v.toFixed(2)]),
      [],
      ["Open receivables (not included)", openAR.toFixed(2)],
      ["Open payables (not included)", openAP.toFixed(2)],
      [],
      ["Date", "Description", "Category", "Account", "Type", "Frequency", "Amount"],
      ...[...monthTx]
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .map((t) => [t.date, t.description, t.category, t.account === "personal" ? "Personal" : "GENIE AI", t.type, isRec(t) ? "Recurring" : "One-time", (t.type === "income" ? t.amount : -t.amount).toFixed(2)]),
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2 items-center">
        {[["business", "GENIE AI"], ["personal", "Personal"], ["all", "Combined"]].map(([k, label]) => (
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
function ARAP({ data, addAR, settleAR, delAR, openPreview }) {
  const openAR = data.receivables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0);
  const openAP = data.payables.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0);
  const net = openAR - openAP;
  const max = Math.max(openAR, openAP, 1);

  const exportCSV = () => {
    const row = (kind, i) => [kind, i.party, i.description || "", i.amount.toFixed(2), i.dueDate || "", i.status, i.settledOn || "", i.account === "personal" ? "Personal" : "GENIE AI", isRec(i) ? "Recurring" : "One-time"];
    downloadCSV(`AR_AP_${todayStr()}.csv`, [
      [`Receivables & Payables`, `exported ${todayStr()}`],
      [],
      ["Open — owed to you", openAR.toFixed(2)],
      ["Open — you owe", openAP.toFixed(2)],
      ["Net position", net.toFixed(2)],
      [],
      ["Kind", "Party", "For", "Amount", "Due", "Status", "Settled on", "Account", "Frequency"],
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
        <ARList kind="receivables" title="Receivables — they owe you" items={data.receivables} addAR={addAR} settleAR={settleAR} delAR={delAR} openPreview={openPreview} tone={P.credit} action="Mark received" />
        <ARList kind="payables" title="Payables — you owe them" items={data.payables} addAR={addAR} settleAR={settleAR} delAR={delAR} openPreview={openPreview} tone={P.debit} action="Mark paid" />
      </div>
    </div>
  );
}

function ARList({ kind, title, items, addAR, settleAR, delAR, openPreview, tone, action }) {
  const [adding, setAdding] = useState(false);
  const blank = { party: "", description: "", amount: "", dueDate: todayStr(), account: "business", recurrence: "once" };
  const [form, setForm] = useState(blank);
  const [att, setAtt] = useState(null); // pending file to be stored on save
  const [reading, setReading] = useState(false);
  const [readErr, setReadErr] = useState("");
  const fileRef = useRef(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
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
        party: d.party || "",
        description: d.description || "",
        amount: d.amount != null ? String(d.amount) : "",
        dueDate: d.dueDate || todayStr(),
        account: "business",
        recurrence: d.recurrence === "recurring" ? "recurring" : "once",
      });
      setAtt({ name: file.name || "invoice.pdf", type: isPdf ? "application/pdf" : (file.type || "image/png"), data: b64, file });
      if (d.note) setReadErr(d.note); // shown as an info line under the form
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
    addAR(kind, { ...form, amount: parseFloat(form.amount), attachmentId: attachmentId || undefined, attachmentName });
    setForm(blank);
    setAtt(null);
    setAdding(false);
  };

  const cancelAdd = () => {
    setAdding(false);
    setForm(blank);
    setAtt(null);
    setReadErr("");
  };

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
          <div className="grid grid-cols-2 gap-2">
            <div><Label>{kind === "receivables" ? "Who owes you" : "Who you owe"}</Label><Input value={form.party} onChange={(e) => set("party", e.target.value)} placeholder="Client / vendor" /></div>
            <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>For</Label><Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Invoice #, work…" /></div>
            <div><Label>Due</Label><Input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></div>
          </div>
          <div><Label>Frequency</Label><RecToggle value={form.recurrence === "recurring" ? "recurring" : "once"} onChange={(v) => set("recurrence", v)} /></div>
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
            return (
              <div key={i.id} style={{ background: P.bg, border: `1px solid ${overdue ? P.debit : P.line}` }} className="rounded-lg p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{i.party}</div>
                  <div style={{ fontFamily: MONO, color: overdue ? P.debit : P.faint }} className="text-xs flex items-center gap-1">
                    {isRec(i) && <RecMark />}
                    {i.description || "—"} · due {i.dueDate}{overdue ? " · overdue" : ""}{isRec(i) ? " · recurring" : ""}
                  </div>
                </div>
                <div style={{ fontFamily: MONO, color: tone }} className="text-sm tabular-nums">{fmt(i.amount)}</div>
                {i.attachmentId && (
                  <button onClick={() => openPreview(i.attachmentId, i.attachmentName)} title={`View ${i.attachmentName || "invoice"}`} style={{ color: P.brass }}>
                    <Paperclip size={13} />
                  </button>
                )}
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
              <span className="truncate">{i.party}</span><span>{fmt(i.amount)} · {i.settledOn}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
