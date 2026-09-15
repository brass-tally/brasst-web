import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Camera, Plus, Trash2, Check, Send, Loader2, RotateCcw, X, LogOut, Mail, Pencil, ArrowLeftRight, ChevronDown, User,
  ArrowUpRight, ArrowDownRight, Paperclip, FileText, Sun, Moon, Download, MessageSquare, Repeat,
  LayoutGrid, Receipt, TrendingUp, FileClock, Coins, CalendarDays, Plug, Lock, StickyNote,
  Search, Sparkles, AlertTriangle, Info, ChevronRight, ChevronLeft, Copy, History, SlidersHorizontal as Sliders, HelpCircle, Settings as SettingsIcon, Menu as MenuIcon, Shield, ExternalLink, Landmark, Eye, Inbox, Link2 as LinkIcon, RefreshCw, Users,
  MessageCircle, BarChart3
} from "lucide-react";
import { supabase } from "./lib/supabase";
import * as db from "./lib/db";
import * as bank from "./lib/bank";
import { jsPDF } from "jspdf";
import { askClaude, friendlyError } from "./lib/extract";
import { parseEntryText, normalizeDraft, coerceAmount, coerceDate, todayLocal } from "./lib/parse";
import { deriveTreatment, summarise, TAX_CODES, TAX_POLICY, estimateTaxFromGross } from "./lib/tax";
import { LEGAL, LEGAL_UPDATED } from "./lib/legal";
import { ruleSignature, signatureIsUseful, directionOf, plannedByRules } from "./lib/rules";
import { lookupRate } from "./lib/fx";
import { listPlanned, addPlanned, updatePlanned, dropPlanned, plannedTotals } from "./lib/planned";
import * as billing from "./lib/billing";
import * as share from "./lib/sharing";
import * as chat from "./lib/chat";
import { isReadOnly } from "./lib/access";
import {
  listContacts as contacts_list, addContact as contacts_add, updateContact as contacts_update,
  deleteContact as contacts_delete, matchContacts as contacts_matchContacts,
  roleLabel as contacts_roleLabel, CONTACT_ROLES,
} from "./lib/contacts";
import { addInterval, occurrencesBetween, obligationsView, recurringCosts } from "./lib/analysis";
import {
  proposeMatches, incomingSettlements, arrivalTolerance, explainDelta, clearedIndex, consolidationPlan,
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
import { Rail } from "./shell/Rail";
import { TallyPeek } from "./shell/Peek";
import { useNudges } from "./shell/useNudges";
import { notify, createNotification } from "./lib/notifications";
import {
  P, PALETTES, THEMES, PALETTE_NAMES, currentPalette, setPalette, systemTheme, onSystemThemeChange,
  elev, R, MONO, SANS, SERIF, applyThemeVars, THEME_KEY,
  Card, cardStyle, Panel, SectionHeading, Stat,
  Btn, IconButton,
  Label, Input, CodeInput, Textarea, Select, Checkbox, CONTROL,
  Modal, ModalBody,
  Pill, Segmented,
  EmptyState,
  Bone, LedgerSkeleton, Spinner, LoadingLine,
  Reveal,
} from "./ui";

/* Palette, elevation, radii, and type all live in src/ui/tokens.js now, and
   the primitives that read them live alongside. This file imports both. */

/* ================= helpers ================= */
const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = todayLocal; // local calendar day, not UTC (see lib/parse.js)
const thisMonth = () => new Date().toISOString().slice(0, 7);
const fmt = (n) =>
  (n < 0 ? "−$" : "$") +
  Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) =>
  (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-CA", { maximumFractionDigits: 0 });

/* An amount in somebody else's currency.
 *
 * `fmt` puts a dollar sign on everything, so prefixing a code produced
 * "PKR $385,000.00": two currencies on one figure, one of them wrong. The code
 * is the symbol here, and there should be only one.
 */
const fmtIn = (n, ccy, ledgerCcy = "CAD") => {
  const value = Math.abs(Number(n) || 0).toLocaleString("en-CA", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const sign = Number(n) < 0 ? "−" : "";
  if (!ccy || ccy === ledgerCcy) return fmt(n);
  return `${sign}${ccy} ${value}`;
};
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

/* Returns null rather than a fallback when it cannot tell, so a caller can
   try somewhere else before giving up. The old version answered
   "application/octet-stream" with confidence, which reads as an answer and
   ends the search. */
const attTypeFromName = (name = "") =>
  /\.pdf(\?|$)/i.test(name) ? "application/pdf"
  : /\.(png|gif|webp)(\?|$)/i.test(name)
    ? `image/${name.replace(/\?.*$/, "").split(".").pop().toLowerCase()}`
  : /\.(jpe?g)(\?|$)/i.test(name) ? "image/jpeg"
  : null;

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
  /* The type comes from the stored path, not the display name.

     A supplier invoice is shown as "INV-002", which has no extension, so the
     viewer decided it could not preview a perfectly ordinary PDF and offered
     a download button instead. The name is for people; the path is what
     actually ends in .pdf. */
  return { url, name, type: attTypeFromName(attachmentId) || attTypeFromName(name) || "application/octet-stream" };
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

/* ================= confirm =================
   Replaces window.confirm, which drops an unstyled OS dialog on top of the
   ledger and cannot say which ledger it is about to wipe. Promise-based so
   callers keep reading top-to-bottom: `if (!(await askConfirm(...))) return;`. */
let confirmHandler = null;
const askConfirm = (opts) =>
  new Promise((resolve) => {
    // No host mounted (an early-boot path, say), fall back rather than hang.
    if (!confirmHandler) return resolve(window.confirm(opts.body || opts.title));
    confirmHandler({ ...opts, resolve });
  });

/* The same dialog, with a number in it.

   Used where a decision needs a figure rather than a yes: accepting an
   invoice in a currency the books are not kept in. Resolves to a number, or
   null if they backed out, so a caller reads the same way as askConfirm. */
const askAmount = (opts) =>
  new Promise((resolve) => {
    if (!confirmHandler) {
      const typed = window.prompt(opts.body || opts.title, opts.placeholder || "");
      const n = Number(String(typed ?? "").replace(/[^0-9.-]/g, ""));
      return resolve(typed == null || !Number.isFinite(n) || n <= 0 ? null : n);
    }
    confirmHandler({ ...opts, amount: true, resolve });
  });

function ConfirmHost() {
  const [req, setReq] = useState(null);
  const [value, setValue] = useState("");
  const confirmRef = useRef(null);

  /* A dialog that suggests a figure should arrive with it in the box, so
     accepting the suggestion costs nothing and changing it costs one edit. */
  useEffect(() => {
    if (req?.prefill != null && req.prefill !== "") setValue(String(req.prefill));
  }, [req]);

  useEffect(() => {
    confirmHandler = setReq;
    return () => { confirmHandler = null; };
  }, []);

  useEffect(() => {
    if (req) confirmRef.current?.focus();
  }, [req]);

  if (!req) return null;

  /* One settle for both kinds of dialog. A yes/no resolves true or false; one
     that asked for a figure resolves the number, or null when they backed out,
     so a caller can tell "they said no" from "they said nothing". */
  const settle = (answer) => {
    if (req.amount) {
      const n = Number(String(value).replace(/[^0-9.-]/g, ""));
      req.resolve(answer && Number.isFinite(n) && n > 0 ? n : null);
    } else {
      req.resolve(answer);
    }
    setValue("");
    setReq(null);
  };
  // Destructive is the common case here, but a dialog asking for a figure is
  // a question rather than a warning, so it does not wear the red triangle.
  const danger = req.tone !== "normal" && !req.amount;

  return (
    <Modal
      onClose={() => settle(false)}
      size="sm"
      showClose={false}
      labelledBy="confirm-title"
      footer={
        <>
          <Btn tone="ghost" onClick={() => settle(false)}>{req.cancelLabel || "Cancel"}</Btn>
          <Btn
            ref={confirmRef}
            tone={danger ? "debit" : "brass"}
            onClick={() => settle(true)}
            disabled={req.amount && !(Number(String(value).replace(/[^0-9.-]/g, "")) > 0)}
          >
            {req.confirmLabel || "Confirm"}
          </Btn>
        </>
      }
    >
      <ModalBody className="flex items-start gap-3.5 pt-5">
        <div
          className="shrink-0 flex items-center justify-center"
          style={{
            width: 38, height: 38, borderRadius: R.control,
            background: (danger ? P.debit : P.brass) + "1f",
            color: danger ? P.debit : P.brass,
          }}
        >
          <AlertTriangle size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="confirm-title" style={{ fontFamily: SERIF, color: P.text }} className="text-xl mb-1 text-balance">
            {req.title}
          </h2>
          {req.body && (
            <p style={{ color: P.muted, maxWidth: "58ch" }} className="text-sm text-pretty">
              {req.body}
            </p>
          )}

          {/* A figure, when the decision needs one. Focused on open, and
              Enter commits, because a dialog asking for one number should not
              need the mouse. */}
          {req.amount && (
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const n = Number(String(value).replace(/[^0-9.-]/g, ""));
                if (Number.isFinite(n) && n > 0) { req.resolve(n); setValue(""); setReq(null); }
              }}
              inputMode="decimal"
              placeholder={req.placeholder || "0.00"}
              style={{ background: P.surface2, color: P.text, borderRadius: 13, fontFamily: MONO }}
              className="w-full h-11 px-3.5 text-[15px] outline-none border-none mt-3"
            />
          )}

          {/* Where the figure came from, small, under the field.

              A prefilled number with no provenance is a number somebody has to
              defend from memory later. Two words and a date are enough to make
              it checkable. */}
          {req.amount && req.note && (
            <p style={{ color: P.faint }} className="text-[12.5px] mt-1.5">
              {req.note}
            </p>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}

/* one-time vs recurring */
const isRec = (x) => x?.recurrence === "recurring";
const RecToggle = ({ value, onChange }) => (
  <Segmented
    full
    size="sm"
    value={value}
    onChange={onChange}
    options={[
      { value: "once", label: "One-time" },
      { value: "recurring", label: "Recurring", icon: <Repeat size={11} /> },
    ]}
  />
);
const RecMark = () => <Repeat size={11} style={{ color: P.brassText, display: "inline", verticalAlign: "-1px" }} title="Recurring" />;

/* subcategory dropdown, lists the category's subs and lets you add a new one inline */
const subsFor = (data, type, category) =>
  (data.categories[type]?.find((c) => c.name === category)?.subs) || [];

function SubPicker({ data, type, category, value, onChange, addSub, compact }) {
  const subs = subsFor(data, type, category);
  // Adding a subcategory happens in place: the select becomes a text field
  // right where it stood, instead of throwing an OS prompt over the ledger.
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const cancel = () => { setAdding(false); setDraft(""); };
  const commit = () => {
    const name = draft.trim();
    if (!name) return cancel();
    if (!subs.includes(name)) addSub(type, category, name);
    onChange(name);
    cancel();
  };

  const handle = (v) => {
    if (v === "__add__") { setDraft(""); setAdding(true); return; }
    onChange(v);
  };

  const shape = compact ? "rounded px-1 py-0.5 text-xs w-24" : "rounded px-2 py-1.5 text-sm w-full outline-none";

  if (adding) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        placeholder={compact ? "name" : `new subcategory under ${category}`}
        aria-label={`New subcategory under ${category}`}
        style={{ background: P.bg, border: `1px solid ${P.brass}`, color: P.text }}
        className={shape + " outline-none"}
      />
    );
  }

  return (
    <select
      value={value && subs.includes(value) ? value : value || ""}
      onChange={(e) => handle(e.target.value)}
      style={{ background: P.bg, border: `1px solid ${P.line}`, color: value ? P.text : P.faint }}
      className={shape}
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
  // A new pool needs two answers, so it expands into a two-field row under the
  // select rather than firing two OS prompts back to back.
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const nameRef = useRef(null);

  useEffect(() => { if (adding) nameRef.current?.focus(); }, [adding]);

  const cancel = () => { setAdding(false); setName(""); setAmount(""); };
  const amt = parseFloat(amount);
  const valid = name.trim() && !Number.isNaN(amt);
  const commit = () => {
    if (!valid) return;
    const id = addCredit(name.trim(), Math.abs(amt));
    onChange("credits", id);
    cancel();
  };

  const handle = (v) => {
    if (v === "cash") return onChange("cash", null);
    if (v === "__addpool__") return setAdding(true);
    onChange("credits", v);
  };

  if (adding) {
    return (
      <div
        style={{ background: P.bg, border: `1px solid ${P.brass}` }}
        className="rounded-lg p-2.5 space-y-2"
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
      >
        <div className="flex gap-2">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pool name"
            aria-label="Credit pool name"
            style={{ background: P.surface, border: `1px solid ${P.line}`, color: P.text }}
            className="rounded px-2 py-1.5 text-sm flex-1 min-w-0 outline-none"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Granted"
            aria-label="Credits granted"
            style={{ background: P.surface, border: `1px solid ${P.line}`, color: P.text, fontFamily: MONO }}
            className="rounded px-2 py-1.5 text-sm w-28 tabular-nums outline-none"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cancel} style={{ color: P.muted }} className="text-xs px-2 py-1">
            Cancel
          </button>
          <Btn type="button" onClick={commit} disabled={!valid} className="!px-2.5 !py-1 !text-xs">
            <Check size={12} /> Add pool
          </Btn>
        </div>
      </div>
    );
  }

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

/* What one entry means once tax is applied. Shown under a receipt draft, so
   the tax consequence is visible at the moment of filing rather than found in
   March. Every line is derived by lib/tax.js, and the wording says what it is:
   preparation, not advice. */
function TaxLine({ draft, policy }) {
  const t = deriveTreatment(draft, policy);
  const code = TAX_CODES[draft.taxCode] || TAX_CODES.none;
  const rows = [
    ["Tax line", `${t.gifi.code} · ${t.gifi.name}`],
    draft.taxAmount > 0 ? [`${code.label} paid`, fmt(draft.taxAmount)] : null,
    t.recoverable > 0 ? ["Recoverable as a credit", fmt(t.recoverable)] : null,
    t.deductible < 1 ? ["Deductible share", `${Math.round(t.deductible * 100)}%`] : null,
    t.capital ? ["Capitalised", `CCA class ${t.capital.class}`] : null,
    ["Reduces taxable income by", fmt(t.deductibleAmount)],
  ].filter(Boolean);

  return (
    <div style={{ background: P.surface2, borderRadius: 14 }} className="p-3.5 mt-3">
      <div style={{ color: P.muted }} className="text-[13.5px] mb-2">For your accountant</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 py-1 text-[14px]">
          <span style={{ color: P.muted }}>{k}</span>
          <span style={{ color: P.text, fontFamily: MONO }} className="tabular-nums shrink-0">{v}</span>
        </div>
      ))}
      {t.notes.map((n) => (
        <div key={n} style={{ color: P.faint }} className="text-[13px] mt-2 leading-snug">{n}</div>
      ))}
      {!draft.taxAmount && draft.taxCode === "none" && (
        <div style={{ color: P.brassText }} className="text-[13px] mt-2 leading-snug">
          No tax line was printed on this one. If there was GST or HST on it, adding the amount is what makes it claimable.
        </div>
      )}
    </div>
  );
}

/* An open payable this receipt probably pays.
   Party is matched loosely, because a receipt says "VERCEL INC." where the
   payable says "Vercel". The amount has to be close, because a payable is
   often entered from an estimate. Deliberately conservative: settling the
   wrong bill is worse than not offering, so no match is the safer failure. */
function findOpenPayable(data, draft) {
  const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const needle = norm(draft.description);
  if (needle.length < 3) return null;
  const scored = (data.payables || [])
    .filter((p) => p.status === "open")
    .map((p) => {
      const party = norm(p.party);
      const desc = norm(p.description);
      const hit = party && (party.includes(needle) || needle.includes(party) || (desc && desc.includes(needle)));
      return hit ? { p, gap: Math.abs(Number(p.amount) - Number(draft.amount)) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.gap - b.gap);
  if (!scored.length) return null;
  const best = scored[0];
  const tolerance = Math.max(1, Number(best.p.amount) * 0.05);
  return best.gap <= tolerance ? best.p : null;
}

function extractionPrompt(cats, ledgerName) {
  return `You extract transaction data for a budget app. The ledger is "${ledgerName}".
Expense categories: ${cats.expense.map((c) => c.name).join(", ")}.
Income categories: ${cats.income.map((c) => c.name).join(", ")}.
Subcategories per category (use only if clearly applicable, else null): ${subPromptInfo(cats)}.
Today's date: ${todayStr()}.
Respond ONLY with raw JSON (no markdown, no preamble):
{"type":"expense"|"income","amount":number,"date":"YYYY-MM-DD","description":"vendor/short description","category":"one of the listed categories for that type","subcategory":"one of that category's subcategories or null","account":"business"|"personal","recurrence":"recurring"|"once","taxAmount":number,"taxCode":"hst13"|"hst15"|"gst5"|"gstpst"|"gstqst"|"zero"|"exempt"|"none","subtotal":number,"note":"one short line on anything you were unsure about, else empty string"}
taxAmount: the GST/HST/QST actually printed on the receipt, as a number. Read it, do not calculate it: receipts round, and a basket can mix rates or include zero-rated items. If no tax line is printed, use 0 and set taxCode to "none".
taxCode: which regime the printed tax matches. 13% is hst13 (Ontario), 15% is hst15 (Atlantic), 5% alone is gst5, 5% plus a separate provincial line is gstpst (BC, SK, MB), 5% plus QST is gstqst (Quebec), a zero-rated item is zero, an exempt service like most financial or medical is exempt.
subtotal: the amount before tax. amount stays the total paid including tax.
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
    required: ["type", "amount", "date", "description", "category", "subcategory", "account", "recurrence", "taxAmount", "taxCode", "subtotal", "note"],
    properties: {
      type: { type: "string", enum: ["expense", "income"] },
      amount: { type: "number" },
      date: { type: "string", format: "date" },
      description: { type: "string" },
      category: names.length ? { type: "string", enum: names } : { type: "string" },
      subcategory: nullableString(subs),
      account: { type: "string", enum: ["business", "personal"] },
      recurrence: { type: "string", enum: ["recurring", "once"] },
      taxAmount: { type: "number" },
      taxCode: { type: "string", enum: ["hst13", "hst15", "gst5", "gstpst", "gstqst", "zero", "exempt", "none"] },
      subtotal: { type: "number" },
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
    // Reads the palette like everything else. It used to hardcode the dark
    // hexes, so the one screen someone sees on their worst day was the one
    // screen that ignored their theme.
    return (
      <div style={{ background: P.bg, color: P.text, minHeight: "100dvh", fontFamily: SANS }} className="flex items-center justify-center p-6">
        <Card level={3} className="w-full" style={{ maxWidth: 480 }}>
          <div className="eyebrow mb-2">Unhandled error</div>
          <h1 style={{ fontFamily: SERIF }} className="text-xl mb-2">Something broke</h1>
          <p style={{ color: P.muted }} className="text-sm mb-4">
            The app hit an error instead of rendering. Reloading usually clears it. If it keeps happening, send this to whoever maintains the app:
          </p>
          <Panel
            as="pre"
            className="text-xs mb-5 overflow-x-auto"
            style={{ color: P.debit, whiteSpace: "pre-wrap", fontFamily: MONO }}
          >
            {String(this.state.err)}
          </Panel>
          <Btn onClick={() => window.location.reload()}>Reload</Btn>
        </Card>
      </div>
    );
  }
}

/* ================= auth gate ================= */
// Where a sign-in email has to land. The books live under /app/, so the redirect
// must name that path: pointing it at the bare origin drops people on the
// marketing page holding the token, which is why signing in took two clicks.
const appUrl = () => {
  const prodUrl = "https://brasstally.com";
  const isDev = window.location.origin !== prodUrl && !window.location.hostname.includes("brasstally.com");
  const baseUrl = isDev ? prodUrl : window.location.origin;
  return `${baseUrl}/app/`;
};

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

  // The same skeleton the ledger uses, rather than a spinner on an empty page:
  // whichever way this resolves, the shape on screen is the one being filled.
  if (session === undefined) return <LedgerSkeleton label="Connecting…" />;
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
    <div style={{ background: P.bg, color: P.text, minHeight: "100dvh", fontFamily: SANS }} className="flex items-center justify-center p-4">
      <div
        style={{ background: P.surface, boxShadow: elev(3), borderRadius: R.panel }}
        className="p-8 w-full max-w-md auth-card"
      >
        {/* The mark leads, then the name. The old eyebrow above the wordmark was
            two pieces of branding stacked before anyone had done anything. */}
        <div
          style={{ background: P.surface2, borderRadius: R.control, width: 44, height: 44 }}
          className="flex items-center justify-center mb-5"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 9.5h11" stroke={P.credit} strokeWidth="2.6" strokeLinecap="round" />
            <path d="M4 15h8" stroke={P.debit} strokeWidth="2.6" strokeLinecap="round" />
            <path d="M18.5 6.5l-1.4 11" stroke={P.brass} strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </div>
        {/* Set rather than placed: the wordmark artwork is cream, drawn for the
            dark ledger, and disappeared into the paper of the light theme.
            Typed in the heading face it follows the palette either way. */}
        <div style={{ fontFamily: SERIF, color: P.text }} className="text-2xl leading-none">
          Brass<span style={{ color: P.brassText }}>t</span>ally
        </div>
        <div style={{ color: P.muted }} className="text-sm mt-1.5 mb-1">
          Books for people who run a company and a life.
        </div>
        {children}
      </div>
    </div>
  );
}

/* An accountant arriving from a share invitation.

   The invitation links to /app?share=<ledger>&to=<address>&name=<business>,
   so the address is known before they type anything and the screen can say
   whose books they are opening. Without this they met a generic sign-in and a
   choice of password or code, which reads as "create an account with a
   company you have never heard of" rather than "open the file your client
   sent you".

   The code is emailed when they press the button, not carried in the
   invitation. An invitation gets forwarded, sits in an inbox for months and
   is sometimes printed. A code requested at that moment expires, and proves
   they hold the mailbox now rather than that somebody once did. */
function readShareInvite() {
  try {
    const q = new URLSearchParams(window.location.search);
    const to = (q.get("to") || "").trim().toLowerCase();
    if (!q.get("share") || !to) return null;
    return { ledgerId: q.get("share"), email: to, business: q.get("name") || "" };
  } catch { return null; }
}

function AuthScreen({ linkError = "" }) {
  const invite = useMemo(readShareInvite, []);
  // step: email → code is the default road. Password is kept as a side door for
  // people who already set one, and forgot hangs off it.
  const [step, setStep] = useState("email"); // email | code | password | signup | forgot
  const [email, setEmail] = useState(invite?.email || "");
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
  // on the same browser, and a six-digit code for everyone else, the installed
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
          : "That code doesn't match. Check the last email. Codes expire after an hour.");
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

  // Utility links read as text, not as terminal output, the mono face made
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
          Enter the code we sent to <span style={{ fontFamily: MONO }}>{email.trim()}</span>.
        </p>
        <p style={{ color: P.muted }} className="text-xs mt-1">
          {installed
            ? "Typing the code signs you in right here in the app. Tapping the link in your email would open a browser instead, and that signs in the browser, not the app."
            : "The same email also has a one-tap link, if you'd rather use that."}
        </p>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
          onKeyDown={(e) => e.key === "Enter" && verifyCode()}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={10}
          aria-label="Sign-in code"
          style={{ background: P.bg, border: `1px solid ${P.line}`, color: P.text, fontFamily: MONO, letterSpacing: "0.4em" }}
          className="rounded-lg px-3 py-3 w-full outline-none text-center text-xl mt-4"
        />

        {err && <p style={{ color: P.debit }} className="text-xs mt-2">{err}</p>}
        {notice && <p style={{ color: P.credit }} className="text-xs mt-2">{notice}</p>}

        <Btn className="w-full justify-center mt-3" onClick={verifyCode} loading={busy} disabled={code.length < 6}>
          {!busy && <Check size={14} />}
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
          loading={busy} disabled={!emailValid || (step !== "forgot" && !pw)}>
          {!busy && <Lock size={14} />}
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
      {invite ? (
        <>
          <div
            style={{ background: P.brass + "1a", borderRadius: 14 }}
            className="p-3.5 mt-3 mb-3"
          >
            <div style={{ color: P.text }} className="text-[15px]">
              {invite.business ? `${invite.business} shared their books with you` : "Someone shared their books with you"}
            </div>
            <div style={{ color: P.muted }} className="text-[13.5px] mt-0.5 leading-snug">
              You will be able to read everything and change nothing. No account to set up.
            </div>
          </div>
          <p style={{ color: P.muted }} className="text-sm mb-4">
            We will send a 6-digit code to <strong style={{ color: P.text }}>{invite.email}</strong>, because
            the access is tied to that address.
          </p>
        </>
      ) : (
        <p style={{ color: P.muted }} className="text-sm mt-3 mb-4">
          Enter your email and we'll send a 6-digit code. New here? The same code creates your account.
        </p>
      )}

      {!invite && <Label>Email</Label>}
      {!invite && (
        <Input type="email" placeholder="you@example.com" value={email} autoComplete="email" autoFocus
          inputMode="email"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && emailValid && sendCode()} />
      )}

      {err && <p style={{ color: P.debit }} className="text-xs mt-2">{err}</p>}

      <Btn className="w-full justify-center mt-3" onClick={() => sendCode()} loading={busy} disabled={!emailValid}>
        {!busy && <Mail size={14} />}
        {invite ? "Send me the code" : "Email me a code"}
      </Btn>

      <div className={`flex justify-between mt-3 ${invite ? "hidden" : ""}`}>
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
      <Btn className="w-full justify-center mt-3" onClick={save} loading={busy} disabled={!pw || !pw2}>
        {!busy && <Check size={14} />} Save new password
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
  const [chatBrief, setChatBrief] = useState(null); // { at, insight } Tally opening the conversation unprompted
  const [chatUnread, setChatUnread] = useState(false); // Tally spoke proactively and nobody has looked yet
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
  /* null until they have been read.

     It was an empty array from the first render, so "not loaded yet" and "no
     bank connected" were the same value. The balance fell back to the book
     figure, drew it, and then jumped to the bank figure a moment later. The
     first number was never wrong exactly, it was just not the one being
     asked for, which is worse: a figure that changes while you look at it is
     a figure you stop trusting. */
  const [bankConns, setBankConns] = useState(null);

  /* Null is the loading signal and it stops here.

     Every consumer below wants a list, and threading "or it might be null"
     through nine components to express one moment of uncertainty is how a
     small distinction becomes everybody's problem. The balance reads the raw
     value, everything else gets a list. */
  const conns = bankConns || []; // Plaid connections for this ledger (balances)
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
  // Your capitalisation policy and registration status live on the ledger, so
  // a second ledger in another province is a column rather than a fork.
  const taxPolicy = useMemo(() => ({
    capitalThreshold: Number(data?.ledger?.capitalThreshold ?? TAX_POLICY.capitalThreshold),
    province: data?.ledger?.province || TAX_POLICY.province,
    gstRegistered: data?.ledger?.gstRegistered ?? TAX_POLICY.gstRegistered,
  }), [data?.ledger?.capitalThreshold, data?.ledger?.province, data?.ledger?.gstRegistered]);

  const [receiptSettle, setReceiptSettle] = useState(null);

  /* Invoices a supplier sent in, loaded at the top rather than inside AR / AP.
     The section that displays them is not the only thing that needs to know:
     Tally mentions them, the dock marks them, and neither can wait for someone
     to visit the page that would have told them. */
  const [inbound, setInbound] = useState([]);

  /* Contacts, loaded once per ledger and passed to every picker. One list in
     one place: a field that fetched its own would be a field that disagrees
     with the one above it after you add somebody. */
  const [contacts, setContacts] = useState([]);
  /* Whether an intake link exists at all. The invite tool refuses to propose
     without one, because a supplier cannot be invited through a link that has
     not been made. */
  const [hasInvoiceLink, setHasInvoiceLink] = useState(false);
  const refreshContacts = async () => {
    if (!data?.ledger?.id) return;
    const [list, links] = await Promise.all([
      contacts_list(data.ledger.id),
      share.listInvoiceLinks(data.ledger.id),
    ]);
    setContacts(list);
    setHasInvoiceLink(links.length > 0);
  };
  useEffect(() => { refreshContacts(); /* eslint-disable-next-line */ }, [data?.ledger?.id]);
  /* One refresh the section can call, so accepting an invoice clears the dot
     on the dock immediately instead of at the next poll. Two counts from two
     fetches that disagree for two minutes is worse than one that is slightly
     late. */
  /* The morning pass.

     After a sync brings lines in, the pairs the reconciler is certain about
     are made without being asked, once per day, and Tally says what she did.

     Only pairing. Not duplicate removal, not creating entries, not settling
     anything. A pairing is reversible from the Consolidate screen in one tap
     and changes no figure in the books: it records that a bank line and an
     entry are the same event. Deleting a row while nobody is watching is a
     different promise and this does not make it.

     Once a day, keyed on the date, so opening the app four times before
     lunch does not produce four announcements. */
  /* Bring the banks up to date before anything reads them.

     The scheduled job needs three configuration rows that are easy to miss,
     and a missing one fails silently, so the balance quietly becomes a day
     old and nothing says so. This checks: any connection not synced since
     this morning's 7am Eastern boundary is synced now.

     Every ledger, not just the one on screen. The balance you will be
     surprised by is the one on the ledger you were not looking at, and there
     are two of them by design. */
  const syncedToday = useRef("");
  useEffect(() => {
    /* At most one attempt per day, per device, and Plaid is charged per call.

       This was a ref, which lives for one page load, so every refresh was a
       fresh attempt. A sync that failed, or a connection whose timestamp did
       not move, would be tried again on the next reload and again on the one
       after. That is a bill, not a bug report, and it is the kind that
       arrives at the end of the month.

       The marker is the morning it belongs to, written before the work
       starts. If the attempt fails, it fails until tomorrow: a failed sync is
       a stale balance, which is visible and survivable, and a retry loop
       against a metered API is neither.

       The scheduled job is the real path. This is the fallback for a device
       that opens the app before the job has run, or on a project where the
       job has never been configured. */
    const morning = bank.lastMorningBoundary().toISOString().slice(0, 10);
    const key = `bt-bank-pass:${morning}`;
    if (!ledgers?.length || syncedToday.current === morning) return;
    try { if (localStorage.getItem(key)) { syncedToday.current = morning; return; } } catch { /* no store */ }
    syncedToday.current = morning;
    try { localStorage.setItem(key, String(Date.now())); } catch { /* no store */ }

    (async () => {
      const { synced: n, skipped } = await bank.refreshStale(ledgers.map((l) => l.id));

      /* If anything was skipped, the day's attempt was not really taken.

         A pass that reached no connection has done no work and should not
         consume the one chance to do it. That is how a bank repaired at
         lunchtime sat until the next morning: the marker had been spent at
         breakfast by a pass that skipped it for needing a sign-in. */
      if (skipped > 0) {
        try { localStorage.removeItem(key); } catch { /* no store */ }
        syncedToday.current = "";
      }

      if (!n) return;
      addNotification(notify.info(
        n === 1 ? "Bank refreshed." : `${n} bank connections refreshed.`,
      ));
      /* The figures on screen were read before the sync, so read them again.
         Connections carry the balance, and the bank lines are what the
         reconciler compares against, so both are reloaded rather than just
         the one that shows a number. */
      if (!currentLedger?.id) return;
      try { setBankConns(await bank.listConnections(currentLedger.id)); } catch { /* leave what is there */ }
      try { setBankTxns(await bank.listBankTransactions(currentLedger.id)); } catch { /* same */ }
      setSyncedAt(Date.now());
    })();
    /* eslint-disable-next-line */
  }, [ledgers?.length]);

  /* New bank lines, while you are looking at the screen.
   *
   * The webhook makes the database current the moment Plaid has something.
   * This is the other half: without it the figures still wait for a reload,
   * which is a strange thing to ask of somebody watching for a payment to
   * land.
   *
   * Only the bank lines are subscribed to. Everything else in the books
   * changes because you changed it, and re-reading those on every keystroke
   * from another device would be a lot of noise for no gain. */
  useEffect(() => {
    if (!currentLedger?.id) return;
    const channel = supabase
      .channel(`bank:${currentLedger.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bank_transactions", filter: `ledger_id=eq.${currentLedger.id}` },
        async () => {
          try {
            setBankTxns(await bank.listBankTransactions(currentLedger.id));
            setBankConns(await bank.listConnections(currentLedger.id));
            setSyncedAt(Date.now());
          } catch { /* a failed refresh is not worth interrupting anybody over */ }
        },
      )
      /* Entries and obligations too, so a phone shows what a laptop just did.
         Debounced together: settling a bill writes a transaction and an
         obligation within milliseconds of each other, and reloading the whole
         ledger twice for one action is waste nobody sees but everybody pays
         for. */
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions", filter: `ledger_id=eq.${currentLedger.id}` },
        () => bumpLedgerReload(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "obligations", filter: `ledger_id=eq.${currentLedger.id}` },
        () => bumpLedgerReload(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentLedger?.id]);

  /* Follow the device, while it is set to follow.
     Nothing is stored on a change: the preference is still "system", and what
     it resolves to is a fact about the phone rather than a decision. */
  useEffect(() => {
    if (theme !== "system") return;
    return onSystemThemeChange((next) => setPalette(currentPalette(), next));
  }, [theme]);

  /* Come back to the app and it is current, without being asked.
   *
   * How this is normally done, and why:
   *
   *   on focus and on becoming visible again. This is the one that matters.
   *   You look at a phone in the morning, the tab has been asleep for eight
   *   hours, and the moment you look is the moment the figures should be
   *   right. Every app you would compare this to does exactly this.
   *
   *   when the network comes back, because anything that failed while you
   *   were on a train should not stay failed.
   *
   *   on a quiet interval while you are actually looking, for the case where
   *   you leave it open on a desk all afternoon.
   *
   * What it does NOT do is poll the bank. This re-reads what is already
   * stored, which is a database query and costs nothing. Plaid is still
   * fetched once a morning, because those calls are metered and refreshing a
   * screen is not a reason to pay for one.
   *
   * Throttled so a tab switched between twice in ten seconds does not reload
   * twice, and skipped entirely while a dialog is open: reloading data under
   * somebody who is halfway through a form is worse than being slightly
   * stale.
   */
  const lastReload = useRef(0);

  /* One reload for a burst of changes.

     A single action often writes to two tables, and a subscription fires per
     table. Without this, settling one bill would reload the whole ledger
     twice. */
  const reloadTimer = useRef(null);
  const bumpLedgerReload = () => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(async () => {
      if (!currentLedger?.id) return;
      if (document.querySelector("[role=dialog]")) return;
      try { setData(await db.loadAll(currentLedger)); } catch { /* leave what is there */ }
    }, 400);
  };
  useEffect(() => {
    if (!currentLedger?.id) return;

    const reload = async (why) => {
      if (Date.now() - lastReload.current < 20000) return;
      if (document.querySelector("[role=dialog]")) return;
      lastReload.current = Date.now();
      try {
        const fresh = await db.loadAll(currentLedger);
        setData(fresh);
        setBankTxns(await bank.listBankTransactions(currentLedger.id));
        setBankConns(await bank.listConnections(currentLedger.id));
        setSyncedAt(Date.now());
      } catch (e) {
        console.warn("background reload failed:", why, e?.message || e);
      }
    };

    const onVisible = () => { if (document.visibilityState === "visible") reload("visible"); };
    const onFocus = () => reload("focus");
    const onOnline = () => reload("online");
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") reload("interval");
    }, 5 * 60 * 1000);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [currentLedger?.id]);

  const morningRan = useRef("");
  const runMorningPass = async () => {
    const today = todayStr();
    if (!data?.ledger?.id || morningRan.current === `${data.ledger.id}:${today}`) return;
    if (!bankTxns.length || !recon) return;

    const { auto } = proposeMatches(bankTxns, data.transactions, {
      anchorDate: balance?.anchorDate || "1970-01-01",
    });
    morningRan.current = `${data.ledger.id}:${today}`;
    if (!auto.length) return;

    applyAutoMatches(auto.map((p) => ({ bankId: p.bank.id, txId: p.tx.id })));
    await dbTry(() => bank.matchMany(auto.map((p) => ({ bankId: p.bank.id, txId: p.tx.id }))));

    recordConsolidation({
      kind: "auto",
      matched: auto.length,
      created: 0,
      removed: 0,
      // truncation-ok: a payload cap for the agent, not a rendered list.
      items: auto.slice(0, 300).map((p) => ({
        kind: "matched", date: p.bank.date, amount: p.bank.amount,
        description: p.bank.description || "bank line", detail: "paired automatically",
      })),
    });

    /* Told in the chat, because that is where the app already speaks and an
       alert nobody opens is not a notification. */
    setChatNudge({ at: Date.now(), paired: auto, total: auto.reduce((n, p) => n + Math.abs(p.bank.amount), 0) });
    setChatUnread(true);
  };

  useEffect(() => {
    if (!data?.ledger?.id || !bankTxns.length) return;
    const t = setTimeout(runMorningPass, 1200);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [data?.ledger?.id, bankTxns.length]);

  const refreshInbound = async () => {
    if (!data?.ledger?.id) return;
    setInbound(await share.listInbound(data.ledger.id, "pending"));
  };
  useEffect(() => {
    if (!data?.ledger?.id || data.ledger.readOnly) { setInbound([]); return; }
    let alive = true;
    const load = async () => {
      const rows = await share.listInbound(data.ledger.id, "pending");
      if (alive) setInbound(rows);
    };

    /* Raise anything a monthly arrangement owes, then look.
       Generation runs in the database and is idempotent, so calling it on
       every load is safe and means there is no scheduler to be down. A ledger
       nobody opened for a quarter catches up on all three months rather than
       quietly skipping two. */
    (async () => {
      const made = await share.generateDueInvoices(data.ledger.id);
      await load();
      if (made > 0) console.info(`raised ${made} invoice(s) from monthly arrangements`);
    })();

    /* Three ways to find out, in order of how fast they are.

       The socket is the one that makes it feel live. The other two are not
       redundancy for its own sake: a websocket is the first thing a captive
       portal drops and the last thing a sleeping phone restores, and an
       invoice that arrives during either is one nobody is told about. */
    const stop = share.watchInbound(data.ledger.id, load);
    const timer = setInterval(load, 45000);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      alive = false;
      stop();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [data?.ledger?.id, data?.ledger?.readOnly]);
  const [menuOpen, setMenuOpen] = useState(false);
  // The same arithmetic the checklist does, so the dot on the icon and the
  // panel underneath it can never disagree.
  const setupProgress = useMemo(() => {
    if (!data) return { done: 0, total: 5 };
    const done = [
      true,
      (bankConns?.length || 0) > 0,
      (data.transactions?.length || 0) > 0,
      ["expense", "income"].some((t) => (data.categories?.[t] || []).some((c) => Number(c.planned) > 0)),
      Boolean(window.localStorage.getItem("guide:used")),
    ].filter(Boolean).length;
    return { done, total: 5 };
  }, [data, conns]);

  /* ---- 1) list this user's ledgers ---- */
  useEffect(() => {
    (async () => {
      try {
        const list = await db.listLedgers();
        setLedgers(list);
        if (list.length) {
          /* Whichever ledger they came here for.

             An accountant following a share invitation lands on the books
             they were sent, not on whatever they happened to open last. That
             was the other half of the complaint: they signed in and arrived
             somewhere generic, having been told they were being given access
             to a specific set of books. */
          const invited = readShareInvite();
          const oauthSession = bank.oauthReturnUri() ? bank.loadLinkSession() : null;
          const last = window.localStorage.getItem("ledger:last");
          setCurrentLedger(
            (invited?.ledgerId && list.find((l) => l.id === invited.ledgerId))
            || (oauthSession?.ledger_id && list.find((l) => l.id === oauthSession.ledger_id))
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
      /* null, not an empty list.

         Clearing to [] says "this ledger has no bank", so the balance answers
         from the books, draws that figure, and corrects itself when the real
         connections arrive a moment later. That is the flash, and it survived
         the last two fixes because this line runs before either of them. */
      setBankConns(null);
    setBankTxns([]);
    setMatchOpen(false);
    window.localStorage.setItem("ledger:last", currentLedger.id);
    /* The invitation has done its job. Clearing it means a refresh does not
       drag them back to the shared ledger after they have switched away, and
       an address does not sit in the URL bar for the next person who borrows
       the laptop. */
    if (new URLSearchParams(window.location.search).get("share")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    (async () => {
      try {
        const loaded = await db.loadAll(currentLedger);
        const t = loaded.settings.theme === "light" ? "light" : "dark";
        // The palette is a separate choice from the mode, so both are applied
        // together. Doing only the mode is how a chosen palette silently
        // reverted to Ember on every reload.
        setPalette(currentPalette(), t === "system" ? systemTheme() : t);
        try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
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
      // Missing table (migration not run yet) must not break the ledger, the
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
        // truncation-ok: a nudge names a few examples, the count sits beside it.
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
    /* Is this somebody else's ledger, shared with me to read? */
  const readOnly = Boolean(data?.ledger?.readOnly);

  /* Deposits that look like invoices being paid.

     Recomputed from live state rather than stored, so dismissing one only has
     to remember the bank line rather than keep a table in step with the
     books. */
  const [notArrival, setNotArrival] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("bt-not-arrival") || "[]")); }
    catch { return new Set(); }
  });
  const [arrivedBusy, setArrivedBusy] = useState("");
  /* Bumped after a background sync, so views holding their own copy of the
     connections know to read them again. */
  const [syncedAt, setSyncedAt] = useState(0);
  // Which figure the reader has asked to see the workings of.
  const [explaining, setExplaining] = useState(null);

  const arrived = useMemo(() => {
    if (!data || readOnly) return [];
    return incomingSettlements(bankTxns, data.receivables || [])
      .filter((h) => !notArrival.has(h.bank.id));
  }, [data, bankTxns, notArrival, readOnly]);

  const approveArrival = async (h) => {
    setArrivedBusy(h.bank.id);
    /* The bank line is the evidence, which is better than a photograph of
       one. Settling normally asks for a document; a statement entry showing
       the money arriving is the document. */
    const tx = settleAR("receivables", h.obligation.id, {
      amount: Math.abs(h.bank.amount),
      date: h.bank.date,
      payMethod: "cash",
    });

    /* Pair the deposit with the entry settling it, so consolidating does not
       ask about it again and the trail from the bank line to the invoice it
       paid is there to follow. */
    if (tx?.id) {
      applyAutoMatches([{ bankId: h.bank.id, txId: tx.id }]);
      await dbTry(() => bank.matchBankTxn(h.bank.id, tx.id, "auto"));
    }
    setArrivedBusy("");
    addNotification(notify.info(`${h.obligation.party} marked received.`));
  };

  /* Join a deposit to the entry that explains it.
     Used when somebody marks an invoice received by hand and the bank already
     shows the money arriving. */
  const pairBankWithTx = async (bankId, txId) => {
    if (!bankId || !txId) return;
    applyAutoMatches([{ bankId, txId }]);
    await dbTry(() => bank.matchBankTxn(bankId, txId, "auto"));
  };

  const dismissArrival = (h) => {
    setNotArrival((prev) => {
      const next = new Set(prev);
      next.add(h.bank.id);
      try { localStorage.setItem("bt-not-arrival", JSON.stringify([...next])); } catch { /* fine */ }
      return next;
    });
  };


  /* One gate in front of every write.

     The banner and the hidden buttons were the whole defence, and neither is
     a defence: a mutator updates local state before it touches the database,
     so a reader pressing something they were not meant to see watched it
     work. It only came back on the next load.

     This returns true and says so, before any state changes. Hiding a control
     is courtesy; this is the rule. */
  const blockedByReadOnly = () => {
    if (!readOnly) return false;
    addNotification(notify.error("You can read this ledger, not change it. Ask the owner if something needs an edit."));
    return true;
  };

  const dbTry = async (fn) => {
    if (readOnly) {
      /* The database refuses these anyway: the shared policy grants select and
         nothing else. Catching it here is about the message. A row level
         security failure reads as "new row violates row-level security policy",
         which tells a visiting accountant nothing except that something is
         broken. */
      addNotification(notify.error("You can read this ledger, but not change it. Ask the owner if you need an edit."));
      return;
    }
    try { await fn(); } catch (e) {
      console.error("save failed:", e);
      const denied = e?.code === "READ_ONLY"
        || /row-level security|permission denied|violates/i.test(e?.message || "");
      addNotification(notify.error(denied
        ? "You can read this ledger, but not change it."
        : "Couldn't reach the server, your last change may not have saved. Check your connection."));
    }
  };

  /* ---- derived ---- */
  const monthTx = useMemo(
    () => (data ? data.transactions.filter((t) => t.date && t.date.startsWith(month)) : []),
    [data, month]
  );
  // ledger line shows CASH flow, entries paid/received in credits don't move money
  /* How far the books are behind the bank, this month.

     An unmatched, unignored line is money that moved and has not been written
     down. Split by direction so each card can speak for itself. */
  const unrecordedThisMonth = useMemo(() => {
    const rows = (bankTxns || []).filter(
      (b) => b.status !== "matched" && b.status !== "ignored" && String(b.date || "").startsWith(month),
    );
    /* The amount, not only the count.

       "16 more on the bank" leaves you to wonder whether that is $50 or
       $5,000, which is the difference between a tidy-up and a wrong month.
       September read $700.83 while the bank had taken over $2,000, and the
       card could not say where the rest was.

       Pending lines are excluded, because the bank has not settled them and
       they are not part of the month. */
    const settled = rows.filter((b) => !b.pending);
    const sum = (list) => list.reduce((n, b) => n + Math.abs(Number(b.amount) || 0), 0);
    const ins = settled.filter((b) => b.direction === "credit");
    const outs = settled.filter((b) => b.direction !== "credit");

    /* And what the bank itself says the month was.

       Not the unrecorded part, the whole of it: every settled line that month,
       matched or not. This is the figure a statement would give you, computed
       from the same feed the statement comes from, so the card can be checked
       without opening one. */
    const all = (bankTxns || []).filter(
      (b) => !b.pending && b.status !== "ignored" && String(b.date || "").startsWith(month),
    );

    // The most recent day the bank has given us anything at all.
    const newest = (bankTxns || []).map((b) => b.date).filter(Boolean).sort().pop() || "";

    // Entries this month that no bank line is paired with.
    const paired = new Set((bankTxns || []).map((b) => b.matchedTxId).filter(Boolean));
    const bookOnly = (monthTx || []).filter((t) => !isCredits(t) && !paired.has(t.id));
    const allIn = all.filter((b) => b.direction === "credit");
    const allOut = all.filter((b) => b.direction !== "credit");

    return {
      in: ins.length, inAmount: sum(ins),
      out: outs.length, outAmount: sum(outs),
      pending: rows.length - settled.length,
      bankIn: sum(allIn), bankInCount: allIn.length,
      bankOut: sum(allOut), bankOutCount: allOut.length,
      hasBank: all.length > 0,
      /* Entries with no bank line behind them: cash, credits, anything typed
         in that the bank never saw. Added to the bank's own figure, because
         the bank cannot know about them and they are still money that moved. */
      bookOnlyIn: bookOnly.filter((t) => t.type === "income").reduce((n, t) => n + Math.abs(t.amount), 0),
      bookOnlyOut: bookOnly.filter((t) => t.type === "expense").reduce((n, t) => n + Math.abs(t.amount), 0),

      /* Whether the feed has fallen behind.

         A figure computed from a feed that stopped two days ago is not wrong,
         it is out of date, and those need different reactions. Two days of
         slack, because a bank releasing yesterday's transfers this afternoon
         is ordinary and saying so every day would be noise. */
      /* The count of what the figure is made of, computed here so it cannot
         disagree with it.

         The foot was counting book entries while the figure counted bank lines
         plus entries the bank never saw. On a ledger where those differ, the
         card said one thing and the sentence under it counted another. */
      countIn: allIn.length + bookOnly.filter((t) => t.type === "income").length,
      countOut: allOut.length + bookOnly.filter((t) => t.type === "expense").length,

      newestLine: newest,
      feedBehind: Boolean(newest) && newest < new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10),
    };
  }, [bankTxns, month, monthTx]);

  const sums = useMemo(() => {
    const cash = monthTx.filter((t) => !isCredits(t));
    const inc = cash.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = cash.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { inc, exp, net: inc - exp };
  }, [monthTx]);

  /* What the cards are actually displaying, in one place, so the detail view
     can be checked against it. Two copies of an arithmetic is how they drift;
     one copy read by both is how they cannot. */
  const cardFigures = useMemo(() => {
    const u = unrecordedThisMonth;
    if (!u?.hasBank) return { in: sums.inc, out: sums.exp, net: sums.inc - sums.exp };
    const i = u.bankIn + (u.bookOnlyIn || 0);
    const o = u.bankOut + (u.bookOnlyOut || 0);
    return { in: i, out: o, net: i - o };
    /* eslint-disable-next-line */
  }, [unrecordedThisMonth, sums]);


  /* What the month opened with, and what it closed at.

     A month had a total in and a total out and no relationship to the month
     before it, so money received on 31 August simply stopped existing on 1
     September. That is not how a set of books works: every period opens with
     what the last one left.

     Opening is the anchor plus everything dated after the anchor and before
     this month began. Closing is opening plus the month's own movement, which
     is what carries into the next one. Credits are excluded from both, the
     same way they are excluded from the month totals, because they never
     touched cash. */
  const carry = useMemo(() => {
    if (!data) return { opening: 0, closing: 0, known: false };
    const anchorDate = data.settings?.anchorDate || "1970-01-01";
    const anchorAmount = Number(data.settings?.startingBalance) || 0;
    const firstOfMonth = `${month}-01`;

    const before = (data.transactions || [])
      .filter((t) => !isCredits(t) && t.date && t.date > anchorDate && t.date < firstOfMonth)
      .reduce((n, t) => n + (t.type === "income" ? t.amount : -t.amount), 0);

    const opening = anchorAmount + before;
    return {
      opening,
      closing: opening + sums.net,
      /* Only meaningful once the month being viewed starts after the anchor.
         Before that the opening figure is a fragment of a period the books do
         not cover, and showing it would invite arithmetic that does not hold. */
      known: firstOfMonth >= anchorDate,
    };
  }, [data, month, sums.net]);
  // The month before, computed the same way, so each figure can say which
  // direction it is moving rather than sitting there as a bare total.
  const prevSums = useMemo(() => {
    if (!data) return null;
    const prev = shiftMonth(month, -1);
    const cash = data.transactions.filter((t) => (t.date || "").startsWith(prev) && !isCredits(t));
    const inc = cash.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = cash.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { inc, exp, net: inc - exp, count: cash.length };
  }, [data, month]);

  // Balance anchoring: "balance was $X as of anchorDate". Only transactions AFTER the
  // anchor count toward the balance, so untracked earlier months can't distort it.
  // Connected ledgers show the bank figure as Balance to date; books stay for delta.
  const balance = useMemo(() => {
    /* No ledger yet is not a balance of zero.

       This returned zero with source "books", so the card drew $0.00 with
       every appearance of certainty and then replaced it with the real
       figure. That is the flash, and it happens before the bank is even
       reached: gating on the connections alone could never have fixed it,
       because the first wrong number arrives one step earlier. */
    if (!data) {
      return {
        value: null, book: 0, bank: null, delta: null, source: "loading",
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
    /* Still reading. Say so rather than answering from the books and
       correcting yourself. */
    if (bankConns === null) {
      return {
        value: null, book, bank: null, delta: null, source: "loading",
        beforeAnchor, anchorAmount, anchorDate, balanceAsOf: null,
      };
    }
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
    /* What is still owed, not what was originally billed.

       A bill half paid still owes half, and a total that counts the whole of
       it overstates the position. The rows show the remainder, so the totals
       have to as well or the section will not add up to itself. */
    const still = (o) => Math.max(0, Math.abs(o.amount) - (Number(o.paidAmount) || 0));
    return {
      ar: data.receivables.filter((r) => r.status === "open").reduce((s, r) => s + still(r), 0),
      ap: data.payables.filter((r) => r.status === "open").reduce((s, r) => s + still(r), 0),
    };
  }, [data]);
  // What the agent would tell you if you asked: worked out locally, for free,
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
    () => (data ? computeInsights(data, { balance, month, bankConns: conns, recon, consolidation, duplicates }) : []),
    [data, balance, month, conns, recon, consolidation, duplicates],
  );

  // One message, at most, and only when the conversation is closed. The queue
  // dedupes on an id that embeds the value, so a drift that changes speaks
  // again while an unchanged one stays quiet.
  const nudges = useNudges(
    {
      insights,
      balance,
      consolidation,
      obligations: data ? [...data.receivables, ...data.payables] : [],
      inbound,
      today: todayStr(),
    },
    { enabled: !chatOpen }
  );

  useEffect(() => {
    if (nudges.peek && !chatOpen) setChatUnread(true);
  }, [nudges.peek, chatOpen]);
  dataRef.current = data;
  balanceRef.current = balance;

  /* ---- Tally opening the conversation ----
     The findings in lib/insights.js are worked out on every render whether or
     not anyone asks. If one of them needs a decision, saying so unprompted is
     the entire difference between an assistant and a search box. One per
     ledger per day, and only for something that actually needs the user: an
     assistant that greets you every reload is noise, not help. */
  const briefedFor = useRef(null);
  const briefTimer = useRef(null);
  const chatOpenRef = useRef(false);
  chatOpenRef.current = chatOpen;
  useEffect(() => () => clearTimeout(briefTimer.current), []);
  useEffect(() => {
    if (!data || briefedFor.current === data.ledger.id) return;
    // insights arrive sorted by severity, then by money at stake, so the first
    // one is the thing most worth saying without being asked.
    const top = insights[0];
    if (!top) return;
    briefedFor.current = data.ledger.id;
    const key = `tally:brief:${data.ledger.id}`;
    const stamp = `${todayStr()}:${top.id}`;
    try {
      if (window.localStorage.getItem(key) === stamp) return; // already said this today
      window.localStorage.setItem(key, stamp);
    } catch { /* private mode: speak anyway */ }
    // Let the ledger finish painting first, so this reads as Tally noticing
    // something rather than as part of the page loading. The timer is not tied
    // to this effect's lifetime: insights recompute the moment the bank feed
    // lands, and a cleanup here would swallow the message before it arrives.
    briefTimer.current = setTimeout(() => {
      setChatBrief({ at: Date.now(), insight: top });
      if (!chatOpenRef.current) setChatUnread(true);
    }, 1400);
  }, [data?.ledger.id, insights]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div style={{ background: P.bg, color: P.text, minHeight: "100dvh" }} className="flex items-center justify-center p-6">
        <Card level={3} className="w-full" style={{ maxWidth: 460 }}>
          <div className="eyebrow mb-2">Setup</div>
          <h1 style={{ fontFamily: SERIF }} className="text-xl mb-2">One migration to run</h1>
          <p style={{ color: P.muted }} className="text-sm">
            This version stores everything in ledgers, and the database doesn't have the ledgers table yet.
            Run <span style={{ fontFamily: MONO, color: P.brassText }}>supabase/migration-multi-ledger.sql</span> in the
            Supabase SQL Editor, then reload. Your existing data is moved into a "GENIE AI" ledger automatically.
          </p>
          <Btn className="mt-5" onClick={() => window.location.reload()}>Reload</Btn>
        </Card>
      </div>
    );

  if (ledgers === null) return <LedgerSkeleton label="Finding your ledgers…" />;

  if (ledgers.length === 0)
    return <NewLedgerModal onboarding onCreate={createLedgerAndSwitch} onClose={() => {}} onSignOut={onSignOut} />;

  if (!data) return <LedgerSkeleton label="Opening the ledger…" />;

  /* ---- mutations: update state, then write through to Supabase ---- */
  // Adding an entry moves the view to that entry's month, so the ledger line,
  // Overview, and P&L visibly reflect it the moment it's saved.
  const addTx = (tx) => {
    if (blockedByReadOnly()) return;
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

  const delTx = async (id) => {
    if (blockedByReadOnly()) return;
    const t = data.transactions.find((x) => x.id === id);
    if (t?.transferId) {
      const ok = await askConfirm({
        title: "Remove both sides of this transfer?",
        body: "This entry is one side of an inter-ledger transfer. Removing it deletes the matching entry in the other ledger too.",
        confirmLabel: "Remove both",
      });
      if (!ok) return;
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
    if (blockedByReadOnly()) return;
    setData((d) => ({
      ...d,
      transactions: d.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
    dbTry(() => db.updateTransaction(id, patch));
  };
  const setTxAttachment = (id, attachmentId, attachmentName) => {
    if (blockedByReadOnly()) return;
    setData((d) => ({
      ...d,
      transactions: d.transactions.map((t) => (t.id === id ? { ...t, attachmentId, attachmentName } : t)),
    }));
    dbTry(() => db.updateTransaction(id, { attachmentId, attachmentName }));
  };
  const addSub = (type, catName, sub) => {
    if (blockedByReadOnly()) return;
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
    if (blockedByReadOnly()) return;
    setData((d) => ({
      ...d,
      categories: { ...d.categories, [type]: d.categories[type].map((c) => (c.name === name ? { ...c, planned } : c)) },
    }));
    dbTry(() => db.setPlanned(type, name, planned));
  };
  const addAR = (kind, item) => {
    if (blockedByReadOnly()) return;
    const rec = { ...item, id: crypto.randomUUID(), status: "open", recurrence: item.recurrence === "recurring" ? "recurring" : "once" };
    setData((d) => ({ ...d, [kind]: [rec, ...d[kind]] }));
    const label = kind === "receivables" ? "Invoice" : "Bill";
    const recurring = item.recurrence === "recurring" ? " (recurring)" : "";
    addNotification(notify.info(`${label} added${recurring}`));
    /* The write is returned, not just started.
       A caller that needs the row to exist in the database, rather than just
       on screen, can await it. The invoice inbox does: it writes a foreign key
       pointing at this payable, and doing that before the insert lands means
       the key is rejected and the invoice never leaves the queue. */
    const saved = dbTry(() => db.insertObligation(kind, rec));
    return Object.assign(rec, { saved });
  };
  const settleAR = (kind, id, actual = {}) => {
    if (blockedByReadOnly()) return;
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
    /* The money may already be in the books.

       A wire lands, the bank feed records it, consolidation files it as
       Client revenue, and then somebody marks the invoice received. Settling
       always wrote a second entry, so the same money was counted twice and
       income was overstated by the amount of every invoice settled this way.

       When the caller has found the entry that already accounts for it, that
       entry is adopted: the obligation points at it, and nothing new is
       written. */
    const adopted = actual.existingTxId
      ? (data.transactions || []).find((t) => t.id === actual.existingTxId)
      : null;

    const tx = adopted || {
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
      /* A payment for less than what is owed leaves the bill open.

         Marking the whole thing paid when half has gone is a lie; leaving it
         untouched is also a lie once half has gone. The obligation carries
         what has been paid so far and closes itself when that reaches the
         total. */
      const owed = Math.abs(Number(fresh.amount) || 0);
      const paidSoFar = Math.round(((Number(fresh.paidAmount) || 0) + Math.abs(amount)) * 100) / 100;
      const closes = paidSoFar >= owed - 0.005;

      return {
        ...d,
        [kind]: [
          // The next instance of a recurring bill is only due once this one is done.
          ...(next && closes ? [next] : []),
          ...d[kind].map((x) => (x.id === id
            ? {
                ...x,
                paidAmount: paidSoFar,
                // Cleared when the bill closes: a settled bill has no remainder
                // to expect, and a date left on it would show up in what is due.
                balanceDue: closes ? undefined : (actual.balanceDue || x.balanceDue),
                ...(closes
                  ? { status: "paid", settledOn, settledTxId: tx.id, payMethod, creditId, ...(obDoc || {}) }
                  : {}),
              }
            : x)),
        ],
        // Adopted entries are already in the list, so adding would duplicate.
        transactions: adopted ? d.transactions : [tx, ...d.transactions],
      };
    });
    /* Tell whoever sent the invoice.

       Fired without waiting: the books are already right, and a mail service
       being slow should not hold up the interface. The function is quiet when
       the payable did not come from an invitation, which is most of them, so
       there is no need to work out here whether it applies. */
    if (kind === "payables") {
      // Worked out here rather than borrowed from the database block below,
      // where these names also exist and are not in scope.
      const billed = Math.abs(Number(item.amount) || 0);
      const paidTotal = Math.round(((Number(item.paidAmount) || 0) + Math.abs(amount)) * 100) / 100;
      const left = Math.max(0, Math.round((billed - paidTotal) * 100) / 100);

      share.notifyPayment(id, {
        paid: Math.abs(amount),
        total: billed,
        outstanding: left,
        balanceDue: left > 0 ? (actual.balanceDue || item.balanceDue || null) : null,
        when: settledOn,
        /* The receipt filed against this payment, whichever it was: one
           attached just now, or the one already on the obligation. */
        receiptPath: actual.shareReceipt === false ? null : (receiptId || item.attachmentId || null),
      });
    }

    setMonth(settledOn.slice(0, 7));
    const label = kind === "receivables" ? "Payment received" : "Payment sent";
    const recurring = item.recurrence === "recurring" ? " (next due in " + addInterval(item.dueDate || settledOn, item.frequency || "monthly") + ")" : "";
    addNotification(notify.success(`${label}${recurring}`));
    dbTry(async () => {
      // The same decision, written through. A bill still owed on stays open.
      const owedDb = Math.abs(Number(item.amount) || 0);
      const paidDb = Math.round(((Number(item.paidAmount) || 0) + Math.abs(amount)) * 100) / 100;
      const closesDb = paidDb >= owedDb - 0.005;
      await db.updateObligation(id, closesDb
        ? { status: "paid", settledOn, settledTxId: tx.id, paidAmount: paidDb, balanceDue: null, payMethod, creditId: creditId || null, ...(obDoc || {}) }
        : { paidAmount: paidDb, balanceDue: actual.balanceDue || item.balanceDue || null, ...(obDoc || {}) });
      if (!adopted) await db.insertTransaction(tx);
      if (next && closesDb) await db.insertObligation(kind, next);
    });

    /* The entry this created, so a caller can point at it.

       Approving an arrival pairs the bank line with the settlement, and
       pairing it to nothing would mark the line handled while leaving no
       trail from the deposit to the invoice it paid. */
    return tx;
  };
  const updateAR = (kind, id, patch) => {
    if (blockedByReadOnly()) return;
    setData((d) => ({ ...d, [kind]: d[kind].map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    dbTry(() => db.updateObligation(id, patch));
  };
  const addCredit = (name, initial) => {
    if (blockedByReadOnly()) return;
    const rec = { id: crypto.randomUUID(), name, initial, usedAdjustment: 0 };
    setData((d) => ({ ...d, credits: [...(d.credits || []), rec] }));
    addNotification(notify.info(`Credit pool "${name}" created`));
    dbTry(() => db.insertCredit(rec));
    return rec.id;
  };
  const updateCredit = (id, patch) => {
    if (blockedByReadOnly()) return;
    setData((d) => ({ ...d, credits: (d.credits || []).map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    dbTry(() => db.updateCredit(id, patch));
  };
  const delCredit = (id) => {
    if (blockedByReadOnly()) return;
    const credit = (data.credits || []).find((c) => c.id === id);
    setData((d) => ({ ...d, credits: (d.credits || []).filter((c) => c.id !== id) }));
    addNotification(notify.info(`Credit pool removed`));
    dbTry(() => db.deleteCredit(id));
  };
  const delAR = (kind, id) => {
    if (blockedByReadOnly()) return;
    const item = data[kind].find((x) => x.id === id);
    // keep the file if it was settled, the transaction still points at it
    if (item?.attachmentId && item.status === "open") deleteAttachment(item.attachmentId);
    setData((d) => ({ ...d, [kind]: d[kind].filter((x) => x.id !== id) }));
    const label = kind === "receivables" ? "Invoice" : "Bill";
    addNotification(notify.info(`${label} removed`));
    dbTry(() => db.deleteObligation(id));
  };
  // Undo a settlement: remove the settled obligation AND the transaction it created.
  const removeSettled = async (kind, item) => {
    if (blockedByReadOnly()) return;
    if (inFlight.current.has(item.id)) return;
    const noun = kind === "receivables" ? "receivable" : "payable";
    const ok = await askConfirm({
      title: `Reverse this settled ${noun}?`,
      body: `Removes the ${noun} and the transaction it logged. Use this to clear a mistaken or duplicate settlement.`,
      confirmLabel: "Reverse settlement",
    });
    if (!ok) return;
    if (inFlight.current.has(item.id)) return; // a second click may have landed while the dialog was open
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
  /* A receipt that pays a bill settles the bill, with the receipt filed as the
     evidence. This is the path that stops the double count: one settled
     obligation and one transaction, linked, instead of an open payable sitting
     beside a duplicate entry. */
  const settleFromReceipt = ({ item, draft }, att) => {
    if (blockedByReadOnly()) return;
    // Ledger cannot reach ARList's dialog state, so it asks rather than
    // reaching in: the request is put down here, AR/AP picks it up, opens the
    // confirm with the receipt already attached, and clears it.
    setReceiptSettle({ item, draft, att });
    setChatOpen(false);
    setTab("arap");
    window.scrollTo({ top: 0 });
  };

  /* Learning, counting and forgetting a filing rule.
     Each one refreshes only the rule list, not the whole ledger. A full reload
     would work and would also reset the tab and the month you were looking at,
     which is a strange thing to have happen because you categorised a bank
     line. */
  const refreshRules = async () => {
    if (!data?.ledger?.id) return;
    const importRules = await db.listImportRules(data.ledger.id);
    setData((d) => (d ? { ...d, importRules } : d));
  };

  const rememberFilingRule = async (rule) => {
    if (!data?.ledger?.id) return;
    const id = await db.saveImportRule(data.ledger.id, rule);
    if (id) await refreshRules();
  };

  const bumpFilingRule = async (id, by) => {
    await db.bumpImportRule(id, by);
    await refreshRules();
  };

  const forgetFilingRule = async (id) => {
    if (blockedByReadOnly()) return;
    const ok = await db.deleteImportRule(id);
    if (ok) await refreshRules();
    return ok;
  };

  const resetAll = async () => {
    if (blockedByReadOnly()) return;
    const ok = await askConfirm({
      title: `Wipe "${data.ledger.name}" and start it fresh?`,
      body: "Every entry, receivable, and credit pool in this ledger will be removed. Your other ledgers are untouched. This cannot be undone.",
      confirmLabel: "Wipe this ledger",
    });
    if (!ok) return;
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
    // `setBankReview(null)` used to sit here. That setter does not exist in this
    // component, or anywhere: the bank review state lives in the match modal.
    // Every statement import threw a ReferenceError at this line and lost the
    // consolidation record that follows it, silently, because the rows had
    // already been written by then.
    // An import folds outside lines into the books, so it belongs in the same
    // history as a reconciliation. It's the other way the books change without
    // anyone typing an entry.
    if (recs.length) {
      recordConsolidation({
        kind: "import",
        createdCount: recs.length,
        deltaBefore: balance.delta,
        unexplainedBefore: recon?.unexplained ?? null,
        note: anchor ? `statement import, anchored to ${fmt(anchor.amount)} on ${anchor.date}` : "statement import",
        // truncation-ok: a payload cap for the agent, not something rendered.
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
    if (blockedByReadOnly()) return;
    // reviewReason goes too: see the note in lib/bank.js. Undoing a pairing is
    // an answer to the review question, not a way of dodging it.
    patchBankTxn(bankId, { status: "unmatched", matchedTxId: null, matchSource: null, reviewReason: null });
    dbTry(() => bank.unmatchBankTxn(bankId));
  };

  const ignoreBankTxn = (bankId) => {
    if (blockedByReadOnly()) return;
    patchBankTxn(bankId, { status: "ignored", matchedTxId: null, matchSource: null });
    dbTry(() => bank.setBankTxnStatus(bankId, "ignored"));
  };

  const unignoreBankTxn = (bankId) => {
    if (blockedByReadOnly()) return;
    patchBankTxn(bankId, { status: "unmatched" });
    dbTry(() => bank.setBankTxnStatus(bankId, "unmatched"));
  };

  const dismissReviewFlag = (bankId) => {
    if (blockedByReadOnly()) return;
    patchBankTxn(bankId, { reviewReason: null });
    dbTry(() => bank.clearReviewFlag(bankId));
  };

  const applyAutoMatches = (pairs) => {
    if (blockedByReadOnly()) return;
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
    if (blockedByReadOnly()) return;
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
    if (blockedByReadOnly()) return;
    const ids = group.extras.map((e) => e.id);
    if (!ids.length) return [];
    const gone = data.transactions.filter((t) => ids.includes(t.id));
    for (const t of gone) if (t.attachmentId) deleteAttachment(t.attachmentId);
    setData((d) => ({ ...d, transactions: d.transactions.filter((t) => !ids.includes(t.id)) }));
    dropMatchesFor(ids);
    dbTry(() => db.deleteTransactions(ids));
    return gone;
  };

  // The bank's own copies are never deleted: the rows are the record of what
  // it sent, and the next sync would only bring them back. Ignoring takes them
  // out of the gap and leaves the audit trail intact.
  const ignoreDuplicateBankLines = (group) => {
    if (blockedByReadOnly()) return;
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
    // done on screen, but nothing will remember it after a reload, which is
    // the exact complaint this whole record exists to fix.
    db.logConsolidation(data.ledger.id, row).catch((e) => {
      console.error("consolidation log failed:", e);
      addNotification(notify.error("This consolidation was applied but couldn't be filed. Run supabase/migration-consolidations.sql so it's remembered next time."));
    });
  };

  const setAnchor = (amount, date, source = "manual") => {
    if (blockedByReadOnly()) return;
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
    setPalette(currentPalette(), t);
    // Mirror onto the document root so stylesheet rules follow the swap, and
    // into storage so the next load, and the landing page, which reads the
    // same key, paints the right theme before any JS runs.
    applyThemeVars(P);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
    setThemeState(t);
    setData((d) => ({ ...d, settings: { ...d.settings, theme: t } }));
    dbTry(() => db.setTheme(t));
  };

  // The third argument is the entry the file belongs to. A receipt on its own
  // is a picture; a receipt beside its tax treatment is a record.
  const openPreview = async (attachmentId, fallbackName, entry = null) => {
    try {
      const att = await attachmentToBlobURL(attachmentId, fallbackName);
      setPreview({ ...att, attachmentId, entry });
    } catch {
      setPreview({ error: true, name: fallbackName, entry });
    }
  };
  const closePreview = () => setPreview(null); // signed URLs expire on their own

  // Six sections on the rail and the dock. Connectors and Reports are places
  // you visit occasionally, not places you live, so they moved into the menu
  // and the dock got two fewer targets to divide 390px between.
  /* Seven sections on the rail. The dock shows the same seven, and at 320px
     seven icons plus Tally needed 363px of 288px, so the dock tightens on the
     narrowest screens rather than dropping one of them: a section that is on
     the rail and not on the dock is a section phone users cannot find. */
  const tabs = [
    ["overview", "Snapshot", LayoutGrid],
    /* Second, under Snapshot. What is owed and owing is the thing with a
       decision attached, so it belongs where the eye lands after the
       headline figures rather than behind two sections of history. */
    ["arap", "AR / AP", FileClock],
    ["transactions", "Transactions", Receipt],
    ["pl", "P&L", TrendingUp],
    ["credits", "Credits", Coins],
    ["calendar", "Calendar", CalendarDays],
    ["contacts", "Contacts", Users],
  ];
  const TAB_TITLES = {
    overview: "Snapshot", transactions: "Transactions", pl: "P&L", arap: "AR / AP",
    credits: "Credits", calendar: "Calendar", integrations: "Connectors",
    reports: "Reports", settings: "Settings", profile: "Profile", taxpack: "Tax pack", contacts: "Contacts",
    "legal-data": "Your data", "legal-privacy": "Privacy", "legal-terms": "Terms",
  };

  return (
    <div style={{ background: P.bg, color: P.text, minHeight: "100dvh", fontFamily: SANS, "--ring": P.brass }}
         className="flex">
      {/* Navigation lives in a rail on desktop, so it stops competing with the
          ledger. Below lg it disappears and the dock at the bottom takes over,
          because a 74px column on a phone eats a fifth of the width and puts
          the sections out of thumb reach. */}
      <Rail
        tabs={tabs}
        tab={tab}
        setTab={(k) => { setTab(k); setChatOpen(false); }}
        ledgers={ledgers || []}
        ledger={data.ledger}
        onPickLedger={(l) => { if (l.id !== data.ledger.id) setCurrentLedger(l); }}
        onNewLedger={() => setNewLedgerOpen(true)}
        onAccount={() => { setTab("settings"); setChatOpen(false); }}
        accountActive={tab === "settings"}
        dots={{ arap: inbound.length > 0 }}
      />
      <div className="flex-1 min-w-0">
      {/* The ledger is a reading surface, so it stops widening past the point
          where a row's date and its amount stop being one glance apart. */}
      <div className="app-inner w-full mx-auto max-w-[1180px]">
        {/* ===== header ===== */}
        {/* The brand eyebrow above the ledger name was two pieces of branding
            stacked before anything useful, and on a phone it landed under the
            status bar. The ledger name is enough; the mark is on the dock. */}
        <header className="pt-1 pb-4 lg:pt-4 lg:pb-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 min-w-0 lg:hidden">
              <div className="relative min-w-0">
                <button
                  onClick={() => setLedgerMenuOpen((o) => !o)}
                  title="Switch ledger"
                  disabled={typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches}
                  className="flex items-center gap-1.5 text-left min-w-0 max-w-[70vw] sm:max-w-xs lg:pointer-events-none"
                >
                  <h1 style={{ fontFamily: SERIF }} className="text-[22px] lg:text-xl leading-tight truncate">{data.ledger.name}</h1>
                  <ChevronDown size={20} style={{ color: P.brassText, transform: ledgerMenuOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} className="shrink-0 lg:hidden" />
                </button>
                {ledgerMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-50" onClick={() => setLedgerMenuOpen(false)} />
                    {/* Two lines per ledger, an initials tile, and a check on
                        the open one. The old version was a 14px row with the
                        kind in tracked mono and "+ new ledger…" in 12px, which
                        is a desktop context menu wearing the app's colours. */}
                    {/* An absolutely positioned child is sized by its
                        containing block, and this one's is the ledger name
                        button, which is itself truncated. So the menu inherited
                        a narrow column and every row wrapped: "Business ledger"
                        onto two lines, the second name down to "B...".

                        The blanket `.app-inner * { max-width: 100% }` from the
                        mobile pass was clamping it to that width too, which is
                        why setting a width alone would not have been enough.
                        `data-popover` opts out of that rule. */}
                    <div
                      data-popover
                      style={{
                        background: P.surface,
                        boxShadow: elev(3),
                        borderRadius: R.panel,
                        width: "min(300px, calc(100vw - 32px))",
                        maxWidth: "none",
                      }}
                      className="absolute left-0 top-full mt-2 z-[60] p-2"
                      role="menu"
                    >
                      {ledgers.map((l) => {
                        const on = l.id === data.ledger.id;
                        return (
                          <button
                            key={l.id}
                            role="menuitem"
                            onClick={() => { setLedgerMenuOpen(false); if (!on) setCurrentLedger(l); }}
                            style={{ background: on ? P.surface2 : "transparent", borderRadius: 14 }}
                            className="w-full flex items-center gap-3 p-3 text-left press"
                          >
                            <span
                              aria-hidden
                              style={{
                                background: on ? P.brass : P.surface2, color: on ? P.onbrass : P.muted,
                                width: 38, height: 38, borderRadius: 12,
                              }}
                              className="flex items-center justify-center shrink-0 text-[13px] font-semibold"
                            >
                              {/* truncation-ok: initials, two letters by design. */}
                              {l.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase()}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span style={{ color: P.text }} className="text-[16px] block truncate">{l.name}</span>
                              <span style={{ color: P.faint }} className="text-[13.5px] block whitespace-nowrap">
                                {l.kind === "personal" ? "Personal ledger" : "Business ledger"}
                              </span>
                            </span>
                            {on && <Check size={18} style={{ color: P.brassText }} className="shrink-0" />}
                          </button>
                        );
                      })}
                      <div style={{ borderTop: `1px solid ${P.line}` }} className="mt-1 pt-1">
                        <button
                          onClick={() => { setLedgerMenuOpen(false); setNewLedgerOpen(true); }}
                          style={{ color: P.brassText, borderRadius: 14 }}
                          className="w-full flex items-center gap-3 p-3 text-left press"
                        >
                          <span
                            aria-hidden
                            style={{ background: P.surface2, color: P.muted, width: 38, height: 38, borderRadius: 12 }}
                            className="flex items-center justify-center shrink-0"
                          >
                            <Plus size={18} />
                          </span>
                          <span className="text-[16px] whitespace-nowrap">New ledger</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <span
                style={{ background: P.brass + "1f", color: P.brassText, borderRadius: R.pill }}
                className="text-[13px] px-2.5 py-1 shrink-0 whitespace-nowrap hidden sm:inline"
              >
                {kindLabel(data.ledger.kind).split(" ")[0]}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* An account button and a theme button used to sit here, both left
                on `className="hidden"` when the menu took over their jobs.
                Hidden is not removed: they were still in the tree, still
                holding a handler, and still the thing a future reader would
                have to work out. The menu has Profile; Settings has the theme.

                The month stepper reads as one control rather than three: the
                label sits between its arrows inside a single well, and the menu
                follows it at the end of the row. */}
            <div
              className="flex items-center shrink-0"
              style={{ background: P.surface, boxShadow: elev(1), borderRadius: R.pill }}
            >
              <IconButton label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} style={{ margin: 0, padding: "12px 14px", color: P.text }} className="press">
                <ChevronLeft size={17} />
              </IconButton>
              {/* The year is only worth the width when it is not this year. */}
              <div style={{ color: P.text }} className="text-[14px] text-center px-1 whitespace-nowrap">
                <span className="hidden sm:inline">{monthLabel(month)}</span>
                <span className="sm:hidden">
                  {month.slice(0, 4) === String(new Date().getFullYear())
                    ? monthLabel(month).split(" ")[0]
                    : `${monthLabel(month).split(" ")[0].slice(0, 3)} ${month.slice(2, 4)}`}
                </span>
              </div>
              <IconButton label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} style={{ margin: 0, padding: "12px 14px", color: P.text }} className="press">
                <ChevronRight size={17} />
              </IconButton>
            </div>

            {/* Last in the row, so it sits on the right edge of the header. */}
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Menu"
              title="Reports, connectors, profile, and settings"
              style={{ background: P.surface, color: P.text, boxShadow: elev(1), borderRadius: 14 }}
              className="relative w-11 h-11 flex items-center justify-center shrink-0 press"
            >
              <MenuIcon size={21} />
              {!setupHidden && setupProgress.done < setupProgress.total && (
                <span aria-hidden style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: "50%", background: P.brass }} />
              )}
            </button>
          </div>
        </header>

        {readOnly && (
          <div
            style={{ background: P.brass + "1f", borderRadius: 16 }}
            className="flex items-start gap-3 p-4 mb-4"
          >
            <Eye size={17} style={{ color: P.brassText }} className="shrink-0 mt-0.5" />
            <div>
              <div style={{ color: P.text }} className="text-[15px]">
                You are reading {data.ledger.name}, not keeping it
              </div>
              <div style={{ color: P.muted }} className="text-[14px] leading-snug">
                Shared with you by its owner. Everything is here to look at and export. Nothing can be changed
                from this side, including by mistake.
              </div>
            </div>
          </div>
        )}

        {/* The page says its name once, small, on the same line as the month,
            and then hands the screen to the content. A 28px title above every
            section spent the first inch of every page telling you where you
            already knew you were. The rail is lit, and the bar names the
            section again the moment the figures scroll away. */}
        {/* The stepper above already names the month, and it is the thing that
            changes it. Saying "September 2026" again underneath was the same
            fact twice in two different type sizes. */}
        <div className="mb-4 fade-in-key" key={`head:${tab}`}>
          <span style={{ color: P.text }} className="text-[15px] font-semibold">
            {TAB_TITLES[tab] || ""}
          </span>
        </div>

        {/* ===== signature ledger line ===== */}
        {tab === "overview" && (
        <LedgerLine
          sectionName="Snapshot"
          counts={{
            inCount: monthTx.filter((t) => t.type === "income" && !isCredits(t)).length,
            outCount: monthTx.filter((t) => t.type === "expense" && !isCredits(t)).length,
            arFoot: (() => {
              const open = data.receivables.filter((r) => r.status === "open");
              if (!open.length) return "nothing outstanding";
              const next = [...open].sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")))[0];
              return `${open.length} ${open.length === 1 ? "invoice" : "invoices"}${next?.dueDate ? `, due ${next.dueDate}` : ""}`;
            })(),
            apFoot: (() => {
              const open = data.payables.filter((r) => r.status === "open");
              if (!open.length) return "nothing outstanding";
              const next = [...open].sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")))[0];
              return `${open.length} ${open.length === 1 ? "payable" : "payables"}${next?.dueDate ? `, next due ${next.dueDate}` : ""}`;
            })(),
          }}
          sums={sums}
          prevSums={prevSums}
          entryCount={monthTx.length}
          balance={balance}
          openBooks={openBooks}
          creditsLeft={(data.credits || []).length ? creditsTotalRemaining(data) : null}
          onCredits={() => setTab("credits")}
          onReconcile={readOnly ? null : () => (balance.source === "bank" ? setMatchOpen(true) : setReconciling(true))}
          needsConsolidation={balance.source === "bank" && balance.delta != null && Math.abs(balance.delta) >= 0.01}
          consolidationSettled={consolidation.settled}
          /* Consolidating is a write flow from the first tap, so a reader is
             not offered it at all. The banner already says why. */
          onConsolidate={readOnly ? null : () => setMatchOpen(true)}
          /* Bank lines in the month on screen that nothing in the books
             accounts for. Counted here because the cards show the month, and
             a count from another month would be worse than none. */
          unrecorded={unrecordedThisMonth}
          carry={carry}
          onExplain={setExplaining}
        />
        )}

        <div key={`panel:${tab}`} className="tab-enter">
        {tab === "overview" && (
          <Overview
            data={data} monthTx={monthTx} sums={sums} setPlanned={setPlanned} month={month}
            insights={insights} onAsk={askAgent} balance={balance} consolidation={consolidation}
            onGo={(where) => {
              if (where === "reconcile") return balance.source === "bank" ? setMatchOpen(true) : setReconciling(true);
              setTab(where);
            }}
          />
        )}
        {/* subcategory-aware forms need addSub */}
        {tab === "transactions" && <Transactions readOnly={readOnly} data={data} monthTx={monthTx} addTx={addTx} delTx={delTx} updateTx={updateTx} setTxAttachment={setTxAttachment} openPreview={openPreview} openImport={() => setImporting(true)} openTransfer={() => setTransferOpen(true)} addSub={addSub} addCredit={addCredit} month={month} cleared={cleared} />}
        {tab === "pl" && <ProfitLoss data={data} month={month} />}
        {tab === "arap" && (
          <ARAP
            openGuide={openGuide} data={data} addAR={addAR} settleAR={settleAR} delAR={delAR}
            removeSettled={removeSettled} updateAR={updateAR} addSub={addSub} addCredit={addCredit}
            openPreview={openPreview}
            receiptSettle={receiptSettle} onReceiptSettleUsed={() => setReceiptSettle(null)}
            readOnly={readOnly}
            contacts={contacts}
            bankTxns={bankTxns}
            onPairBank={pairBankWithTx}
            arrived={arrived}
            onApproveArrived={approveArrival}
            onDismissArrived={dismissArrival}
            arrivedBusy={arrivedBusy}
            onInboundChange={refreshInbound}
          onContactsChange={refreshContacts} />
        )}
        {tab === "credits" && <CreditsCard readOnly={readOnly} data={data} addCredit={addCredit} updateCredit={updateCredit} delCredit={delCredit} />}
        {tab === "calendar" && <CashCalendar data={data} />}
        {tab === "integrations" && <IntegrationsTab data={data} syncedAt={syncedAt} openGuide={openGuide} onReview={() => setMatchOpen(true)} onSynced={afterSync} onConnectionsChange={setBankConns} updateLedgerMeta={(patch) => {
          setData((d) => ({ ...d, ledger: { ...d.ledger, ...patch } }));
          setLedgers((ls) => ls.map((l) => (l.id === data.ledger.id ? { ...l, ...patch } : l)));
          dbTry(() => db.updateLedger(data.ledger.id, patch));
        }} />}
        {tab === "reports" && <ReportsTab data={data} month={month} balance={balance} onAsk={askAgent} />}
        {tab === "profile" && (
          <AccountModal
            asPage
            theme={theme}
            setTheme={setTheme}
            onSignOut={onSignOut}
            onResetLedger={resetAll}
            ledgerName={data.ledger.name}
            onClose={() => setTab("overview")}
          />
        )}
        {tab === "contacts" && (
          <ContactsPage
            ledgerId={data.ledger.id}
            contacts={contacts}
            onChanged={refreshContacts}
            readOnly={readOnly}
          data={data} inbound={inbound} openPreview={openPreview} onConfirmVoid={askConfirm} />
        )}
        {tab === "taxpack" && (
          <TaxPack data={data} month={month} openPreview={openPreview} ledgerName={data.ledger.name} />
        )}
        {tab === "legal-data" && <LegalPage which="data" />}
        {tab === "legal-privacy" && <LegalPage which="privacy" />}
        {tab === "legal-terms" && <LegalPage which="terms" />}
        {tab === "settings" && (
          <SettingsPage
            readOnly={readOnly}
            contacts={contacts}
            setup={!setupHidden ? (
              <SetupChecklist
                data={data}
                bankConns={conns}
                openGuide={openGuide}
                onGo={(where) => { if (where === "capture") return setChatOpen(true); setTab(where); }}
                onDismiss={() => { window.localStorage.setItem("setup:hidden", "1"); setSetupHidden(true); }}
              />
            ) : null}
            theme={theme}
            setTheme={setTheme}
            ledgers={ledgers}
            ledger={data.ledger}
            onPickLedger={(l) => setCurrentLedger(l)}
            onNewLedger={() => setNewLedgerOpen(true)}
            onSignOut={onSignOut}
            onResetLedger={resetAll}
          />
        )}
        </div>
      </div>

      {/* ===== floating Tally chat (stays mounted so the conversation survives closing) ===== */}
      {/* capture panel floats above the dock */}
      </div>

      <div
        className="fixed z-40 tally-frame"
        style={{ pointerEvents: chatOpen ? "auto" : "none" }}
      >
        <div className={"capture-pop " + (chatOpen ? "open" : "")}>
          <div
            style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: elev(3) }}
            className="rounded-lg overflow-hidden tally-panel"
          >
            {/* Tally has a name and a face, because you talk to someone, not to
                a feature. The brand stays in the header of the app. */}
            <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: `1px solid ${P.line}` }}>
              <span
                aria-hidden
                style={{ background: P.brass, color: P.onbrass, width: 34, height: 34, borderRadius: 12 }}
                className="text-[15px] font-semibold flex items-center justify-center shrink-0"
              >
                T
              </span>
              <div className="flex-1 min-w-0 leading-tight">
                <div style={{ color: P.text }} className="text-[16px] font-semibold">Tally</div>
                <div style={{ color: P.faint }} className="text-[13.5px] truncate">
                  {data.ledger.name} · your bookkeeper
                </div>
              </div>
                <button onClick={() => setChatOpen(false)} aria-label="Close" style={{ color: P.muted }} className="p-1.5"><X size={17} /></button>
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
              bankConns={conns}
              insights={insights}
              taxPolicy={taxPolicy}
              onSettleFromReceipt={settleFromReceipt}
              seed={chatSeed}
              onSeedUsed={() => setChatSeed(null)}
              guide={chatGuide}
              onGuideUsed={() => setChatGuide(null)}
              nudge={chatNudge}
              onNudgeUsed={() => setChatNudge(null)}
              brief={chatBrief}
              onBriefUsed={() => setChatBrief(null)}
              contacts={contacts}
              hasInvoiceLink={hasInvoiceLink}
              /* Something wanted to speak and had already said it. Light the
                 badge rather than repeat the sentence. */
              onRemind={() => setChatUnread(true)}
              waiting={inbound.length}
              apply={{
                addTx, addAR, settleAR, setPlanned, setAnchor,
                addContact: async (c) => {
                  const r = await contacts_add(data.ledger.id, c);
                  if (r.ok) refreshContacts();
                  return r;
                },
                /* Make the link if there is not one, then send.

                   This used to refuse without a link, so Tally explained she
                   could not help and offered a button to the page where you
                   could do it by hand. The link is one row in a table. If
                   somebody has asked for an invitation to be sent, they have
                   already agreed to the thing the link is for. */
                /* Resolve the address here, where the contacts are.

                   Tally kept refusing to send because she could not find an
                   email, and the email was in the contacts table. Whether she
                   calls the lookup tool is not something I can guarantee, and
                   a feature should not depend on a model choosing to check.
                   So the card asks for a name and this finds the address. */
                inviteSupplier: async ({ to, note, name }) => {
                  let addr = String(to || "").trim();
                  if (!addr && name) {
                    const want = String(name).trim().toLowerCase();
                    const list = contacts.length ? contacts : await contacts_list(data.ledger.id);
                    const hit = list.find((c) => c.name.toLowerCase() === want)
                      || list.find((c) => c.name.toLowerCase().includes(want) && c.email)
                      || list.find((c) => want.includes(c.name.toLowerCase()) && c.email);
                    if (hit?.email) addr = hit.email;
                    else if (hit) return { ok: false, error: `${hit.name} is in your contacts but has no email address on file. Add one and try again.` };
                    else return { ok: false, error: `No contact called ${name}. Add them in Contacts, or type the address here.` };
                  }
                  if (!addr) return { ok: false, error: "Who should this go to?" };
                  to = addr;
                  let links = await share.listInvoiceLinks(data.ledger.id);
                  if (!links.length) {
                    const made = await share.createInvoiceLink(data.ledger.id, null);
                    if (!made.ok) return made;
                    links = await share.listInvoiceLinks(data.ledger.id);
                    refreshContacts();
                  }
                  const link = links[0];
                  if (!link) return { ok: false, error: "The link could not be created." };
                  return share.emailInvoiceLink(link.token, to, note);
                },
                createInvoiceLink: async (label) => {
                  const r = await share.createInvoiceLink(data.ledger.id, label || null);
                  if (r.ok) refreshContacts();
                  return r;
                },
              }}
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

      {/* The nudge queue is about work to do, and a reader has none. Tally
          herself stays, because answering "what is in this category" is most of
          why the ledger was shared. */}
      <TallyPeek
        peek={chatOpen || readOnly ? null : nudges.peek}
        /* Open on the thing that spoke, not on a greeting.

           Tapping a nudge used to clear it and open the panel cold, so the
           message that made you tap was gone and Tally introduced herself
           instead. The peek is the start of a conversation; throwing it away
           is the one thing not to do with it. */
        onOpen={() => {
          const said = nudges.peek;
          setChatOpen(true);
          setChatUnread(false);
          if (said?.text) setChatSeed({ said: said.text, followUp: said.followUp, at: Date.now() });
          nudges.clear();
        }}
        onDismiss={nudges.dismiss}
      />

      {/* On desktop the dock is gone, so Tally gets a corner of her own. Same
          state, same panel, just a trigger that survives the rail. */}
      <button
        onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) setChatUnread(false); }}
        aria-label={chatUnread ? "Tally has something to tell you" : "Talk to Tally"}
        title={chatOpen ? "Close Tally" : "Talk to Tally"}
        className="hidden lg:flex fixed z-40 items-center justify-center"
        style={{
          right: 24, bottom: 24, width: 60, height: 60, borderRadius: 22,
          background: P.brass, color: P.onbrass, boxShadow: elev(3),
          transition: "transform .18s cubic-bezier(.2,.8,.2,1), opacity .25s ease",
          opacity: chatOpen ? 0 : 1, transform: chatOpen ? "scale(.7)" : "none",
          pointerEvents: chatOpen ? "none" : "auto",
        }}
      >
        <MessageCircle size={24} />
        {chatUnread && !chatOpen && (
          <span
            aria-hidden
            style={{
              position: "absolute", top: 4, right: 4, width: 12, height: 12, borderRadius: "50%",
              background: P.debit, border: `2px solid ${P.brass}`,
            }}
          />
        )}
      </button>

      {/* ===== floating dock: all sections, Tally lives on the right ===== */}
      <nav className="fixed z-40 left-1/2 bottom-4 lg:hidden" style={{ transform: "translateX(-50%)", maxWidth: "calc(100vw - 20px)" }}>
        <div
          className="dock dock-row flex items-center gap-0.5 px-2 py-1.5 rounded-full"
          style={{ background: theme === "dark" ? "rgba(23,31,27,0.72)" : "rgba(251,250,245,0.78)", border: `1px solid ${P.line}`, backdropFilter: "blur(18px) saturate(1.4)", WebkitBackdropFilter: "blur(18px) saturate(1.4)", boxShadow: elev(3) }}
        >
          {tabs.map(([k, label, Icon]) => (
            <DockBtn
              key={k}
              label={label}
              active={tab === k}
              /* A dot on the section that has something waiting. An invoice
                 that arrived while you were on Snapshot should be visible from
                 Snapshot, not only once you happen to open AR / AP. */
              dot={k === "arap" && inbound.length > 0}
              onClick={() => { setTab(k); setChatOpen(false); }}
            >
              <Icon size={18} />
            </DockBtn>
          ))}

          {/* divider */}
          <span aria-hidden style={{ width: 1, height: 24, background: P.line, margin: "0 4px", flexShrink: 0 }} />

          {/* Tally, frosted brass, on the right. A speech bubble says "someone is
              in here"; a plus said "this adds a row". */}
          <button
            onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) setChatUnread(false); }}
            title={chatOpen ? "Close Tally" : chatUnread ? "Tally has something to tell you" : "Talk to Tally, capture a receipt or ask about the books"}
            aria-label={chatUnread ? "Tally has something to tell you" : "Talk to Tally"}
            className="dock-capture rounded-full flex items-center justify-center shrink-0"
            style={{ position: "relative", background: theme === "dark" ? "rgba(242,185,74,0.22)" : "rgba(223,167,38,0.16)", color: P.brassText, border: `1px solid ${theme === "dark" ? "rgba(242,185,74,0.5)" : "rgba(223,167,38,0.4)"}`, width: 44, height: 44, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
          >
            <span className="dock-capture-icon" style={{ display: "inline-flex", transform: chatOpen ? "scale(.88)" : "none", transition: "transform .28s cubic-bezier(.2,.8,.2,1)" }}>
              {chatOpen ? <X size={20} /> : <MessageCircle size={21} />}
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
      <ConfirmHost />

      <PreviewModal preview={preview} onClose={closePreview} policy={taxPolicy} />
      {menuOpen && (
        <MenuSheet
          tab={tab}
          setupPending={!setupHidden && setupProgress.done < setupProgress.total}
          onClose={() => setMenuOpen(false)}
          onGo={(where) => {
            setMenuOpen(false);
            setTab(where);
            setChatOpen(false);
            window.scrollTo({ top: 0 });
          }}
        />
      )}

      {accountOpen && (
        <AccountModal theme={theme} setTheme={setTheme} onSignOut={onSignOut} onResetLedger={resetAll}
          ledgerName={data.ledger.name} onClose={() => setAccountOpen(false)} />
      )}
      {newLedgerOpen && <NewLedgerModal onCreate={createLedgerAndSwitch} onClose={() => setNewLedgerOpen(false)} />}
      {explaining === "balance" && (
        <BalanceTrail
          balance={balance}
          transactions={data.transactions}
          bankTxns={bankTxns}
          month={month}
          onConsolidate={readOnly ? null : () => setMatchOpen(true)}
          onClose={() => setExplaining(null)}
        />
      )}

      {explaining && explaining !== "balance" && (
        <FigureTrail
          side={explaining}
          month={month}
          transactions={data.transactions}
          bankTxns={bankTxns}
          obligations={explaining === "ar" ? data.receivables : data.payables}
          /* The figure the card is showing, so the detail can check itself
             against it rather than both being believed separately. */
          cardValue={
            explaining === "in" ? cardFigures.in
              : explaining === "out" ? cardFigures.out
              : explaining === "net" ? cardFigures.net
              : null
          }
          ledgerCcy={data.ledger.currency || "CAD"}
          openPreview={openPreview}
          onClose={() => setExplaining(null)}
        />
      )}

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
            rememberRule: rememberFilingRule,
            bumpRule: bumpFilingRule,
            forgetRule: forgetFilingRule,
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
function PreviewModal({ preview, onClose, policy = TAX_POLICY }) {
  // Fit to the panel, or full size and scrollable. A long receipt scaled to
  // 70vh is unreadable, and the container never scrolled because the image had
  // already been shrunk to fit it.
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (!preview) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, onClose]);
  if (!preview) return null;
  const isImage = preview.type?.startsWith("image/");
  const isPdf = preview.type === "application/pdf";
  const entry = preview.entry;
  const t = entry ? deriveTreatment(entry, policy) : null;
  const code = entry ? (TAX_CODES[entry.taxCode] || TAX_CODES.none) : null;

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
      style={{ background: P.overlay }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={preview.name || "Filed document"}
        style={{
          background: P.surface, boxShadow: elev(3), borderRadius: R.panel,
          maxHeight: "calc(100dvh - max(24px, env(safe-area-inset-top)) - 24px)",
        }}
        className="modal-panel w-full max-w-4xl flex flex-col overflow-hidden"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${P.line}` }}>
          <FileText size={16} style={{ color: P.brassText }} className="shrink-0" />
          <div className="text-[15px] truncate flex-1" style={{ color: P.text }}>{preview.name || "Filed document"}</div>
          {isImage && !preview.error && (
            <button
              onClick={() => setZoom((z) => !z)}
              title={zoom ? "Fit to the panel" : "Full size"}
              aria-label={zoom ? "Fit to the panel" : "Full size"}
              style={{ background: zoom ? P.surface2 : "transparent", color: P.muted, borderRadius: 12 }}
              className="w-11 h-11 flex items-center justify-center shrink-0 press"
            >
              <Search size={17} />
            </button>
          )}
          {!preview.error && (
            <button
              onClick={() => downloadAttachment(preview.attachmentId, preview.name)}
              title="Download"
              aria-label="Download"
              style={{ color: P.muted, borderRadius: 12 }}
              className="w-11 h-11 flex items-center justify-center shrink-0 press"
            >
              <Download size={17} />
            </button>
          )}
          <button onClick={onClose} title="Close" aria-label="Close"
            style={{ background: P.surface2, color: P.text, borderRadius: 12 }}
            className="w-11 h-11 flex items-center justify-center shrink-0 press">
            <X size={18} />
          </button>
        </div>

        {/* The document scrolls, and the treatment travels with it. On a wide
            screen they sit side by side; on a phone the figures come first,
            because that is the part you came back to check. */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          <div className="flex-1 min-h-0 min-w-0 overflow-auto" style={{ background: P.bg, WebkitOverflowScrolling: "touch" }}>
            {preview.error ? (
              <p style={{ color: P.debit }} className="text-[15px] p-6">
                Couldn't load this file from storage. It may have been removed, so try re-attaching it.
              </p>
            ) : isImage ? (
              <div className={zoom ? "p-4" : "p-4 flex items-center justify-center min-h-full"}>
                <img
                  src={preview.url}
                  alt={preview.name}
                  className="rounded"
                  style={zoom ? { maxWidth: "none", width: "auto" } : { maxWidth: "100%", height: "auto" }}
                />
              </div>
            ) : isPdf ? (
              <>
                {/* iOS Safari renders only the first page of a PDF in an iframe
                    and will not scroll it, so on a phone the honest thing is a
                    button that opens it properly rather than a broken frame. */}
                <iframe
                  src={preview.url}
                  title={preview.name}
                  className="w-full hidden sm:block"
                  style={{ height: "70vh", border: "none", background: "#525659" }}
                />
                <div className="sm:hidden p-6 text-center">
                  <p style={{ color: P.muted }} className="text-[15px] mb-4">
                    A phone cannot scroll a PDF inside the app. Opening it uses the built-in reader, where you can
                    scroll and pinch.
                  </p>
                  <a
                    href={preview.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
                    className="px-5 py-3 text-[15px] font-medium inline-flex items-center gap-2 press"
                  >
                    Open the document <ExternalLink size={16} />
                  </a>
                </div>
              </>
            ) : (
              <p style={{ color: P.muted }} className="text-[15px] p-6">
                No inline preview for this file type. Use the download button above.
              </p>
            )}
          </div>

          {t && (
            <div
              className="shrink-0 lg:w-80 overflow-y-auto order-first lg:order-last"
              style={{ borderTop: `1px solid ${P.line}`, background: P.surface }}
            >
              <div className="p-5">
                <div style={{ color: P.text }} className="text-[16px]">{entry.description}</div>
                <div style={{ color: P.faint }} className="text-[13.5px] mb-4">
                  {entry.date} · {entry.category}{entry.subcategory ? ` · ${entry.subcategory}` : ""}
                </div>

                <div style={{ color: P.muted }} className="text-[13.5px] mb-2">How this is treated</div>
                {[
                  ["Tax line", `${t.gifi.code} · ${t.gifi.name}`],
                  ["Total on the receipt", fmt(entry.amount)],
                  entry.taxAmount > 0 ? [`${code.label}`, fmt(entry.taxAmount)] : ["Tax recorded", "none"],
                  t.recoverable > 0 ? ["Credit claimable", fmt(t.recoverable)] : null,
                  t.deductible < 1 ? ["Deductible share", `${Math.round(t.deductible * 100)}%`] : null,
                  t.capital ? ["Capitalised", `CCA class ${t.capital.class}`] : null,
                  ["Reduces taxable income by", fmt(t.deductibleAmount)],
                ].filter(Boolean).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 py-2 text-[14.5px]" style={{ borderTop: `1px solid ${P.line}` }}>
                    <span style={{ color: P.muted }}>{k}</span>
                    <span style={{ color: P.text, fontFamily: MONO }} className="tabular-nums shrink-0">{v}</span>
                  </div>
                ))}

                {t.notes.map((n) => (
                  <p key={n} style={{ color: P.faint }} className="text-[13.5px] mt-3 leading-snug">{n}</p>
                ))}
                {!entry.taxAmount && entry.taxCode !== "zero" && entry.taxCode !== "exempt" && (
                  <p style={{ color: P.brassText }} className="text-[13.5px] mt-3 leading-snug">
                    No tax was recorded against this entry. If the receipt shows GST or HST, adding it is what makes
                    the credit claimable.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
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
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div role="dialog" aria-modal="true" style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: elev(3), borderRadius: R.panel }} className="modal-panel w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 style={{ fontFamily: SERIF }} className="text-xl">Correct the balance</h3>
          <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
        </div>
        <p style={{ color: P.muted }} className="text-sm mb-4">
          {initialAmount != null
            ? "Prefilled from your bank feed. Anchoring aligns the ledger books to that number on this date. It does not invent missing transactions."
            : "Check your real accounts and enter the combined total. The ledger anchors to that number on that date, months you never tracked before it stop affecting the balance, and only entries you log after it count."}
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
        <button onClick={onImportInstead} style={{ color: P.brassText, fontFamily: MONO }} className="w-full text-center text-xs mt-3 underline decoration-dotted underline-offset-2">
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
 * record the run. Nothing here rewrites the balance, re-anchoring is still
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
      <span style={{ color: P.brassText }} className="shrink-0">·</span>
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
  actions, onAnchorInstead, onClose, openGuide, addSub,
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
     what is still open, there is no cursor to keep in sync, and nothing can be
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

  /* The best guess available, and no pretence that it is more than that.

     A filing rule if one matches, then a category whose name appears in the
     description, then the ledger's catch-all. Every one of these is offered
     for correction afterwards rather than presented as settled. */
  const guessCategory = (b) => {
    /* `data.categories` is `{ expense: [...], income: [...] }`, not a list.

       I called `.filter` on the object, which threw the moment somebody
       pressed Go ahead on a consolidation. Two mistakes in one line: the
       shape, and a field called `kind` that does not exist on a category
       either. It built and linted, because neither of those is visible until
       the line runs, and the line only runs when a bank payment has nothing
       behind it in the books. */
    const groups = data.categories || { expense: [], income: [] };
    const cats = (b.direction === "credit" ? groups.income : groups.expense) || [];
    const text = String(b.description || "").toLowerCase();

    const named = cats.find((c) => c.name && text.includes(c.name.toLowerCase()));
    if (named) return { category: named.name, subcategory: undefined, account: b.account || named.account };

    const fallback = cats.find((c) => /uncategor|other|misc/i.test(c.name)) || cats[0];
    return {
      category: fallback?.name || (b.direction === "credit" ? "Other income" : "Uncategorised"),
      subcategory: undefined,
      account: b.account,
    };
  };

  const doCreate = (b, opts) => {
    const t = actions.createFrom(b, opts);
    note({
      kind: "created", date: b.date, amount: b.amount,
      description: b.description || "bank line",
      detail: `added to the books as ${opts.category}${opts.subcategory ? ` / ${opts.subcategory}` : ""}`,
    });

    /* Remember how this was filed. The same line arrives every month and there
       is no reason to be asked about it twice. Only when the description has
       enough shape to identify it: "Cheque" on its own would match half a
       statement, so a weak signature teaches nothing. */
    const sig = ruleSignature(b.description);
    if (signatureIsUseful(sig)) {
      actions.rememberRule?.({
        signature: sig,
        direction: directionOf(b),
        category: opts.category,
        subcategory: opts.subcategory,
        learnedFrom: Math.abs(Number(b.amount) || 0),
      });
    }
    return t;
  };

  /* Every unmatched line a remembered rule already covers, grouped by rule.
     These go into the "I can sort this out myself" side of the plan, which is
     reviewed on screen before it runs and recorded afterwards. Filing money
     movements needs the person present, and pressing Consolidate is them being
     present. */
  const ruleWork = useMemo(
    () => plannedByRules(bankTxns, data?.importRules || []),
    [bankTxns, data?.importRules],
  );

  const doApplyRules = async () => {
    let filed = 0;
    for (const g of ruleWork) {
      for (const line of g.lines) {
        actions.createFrom(line, { category: g.rule.category, subcategory: g.rule.subcategory, ruleId: g.rule.id });
        filed += 1;
      }
      await actions.bumpRule?.(g.rule.id, g.lines.length);
      note({
        kind: "created", date: g.lines[0].date, amount: g.total,
        description: g.rule.subcategory || g.rule.category,
        detail: `${g.lines.length} ${g.lines.length === 1 ? "line" : "lines"} filed from a rule you set${g.rule.createdAt ? ` on ${String(g.rule.createdAt).slice(0, 10)}` : ""}`,
      });
    }
    return filed;
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
  const runPlan = async () => {
    setFixing(true);
    let paired = 0, removed = 0, setAside = 0;

    // Lines a remembered rule already covers. Filed first, so the plan's own
    // matching does not then ask about entries this just created.
    const filed = await doApplyRules();

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

    /* Payments the bank made and the books never heard of.

       These used to be a list handed back for the user to type in. The bank
       is the authority on whether money moved, so they are recorded, with the
       best category available and a flag saying it was a guess. Reversible in
       a tap, and it misstates nothing in the meantime: the money did leave
       the account. */
    let recorded = 0;
    for (const b of plan.fix.record || []) {
      const guess = guessCategory(b);
      doCreate(b, { category: guess.category, subcategory: guess.subcategory, account: guess.account });
      recorded += 1;
    }

    setFixedSummary({ paired, removed, setAside, filed, recorded });
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
    ruleFiledCount: log.filter((l) => l.kind === "created" && /filed from a rule/.test(l.detail || "")).length,
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
  const ruleLineCount = ruleWork.reduce((n, g) => n + g.lines.length, 0);
  const nothingToDo = plan.fix.count === 0 && plan.ask.count === 0 && ruleLineCount === 0;

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

  /* Clusters the reconciler declined to offer for deletion because they are too
     large to be copies of one payment. Read here so the modal can say so. */
  const dupPatterns = duplicates?.patterns || [];

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
        <button onClick={() => setOpenDup(openDup === item.id ? null : item.id)} style={{ color: P.brassText }} className="text-[13.5px] underline decoration-dotted underline-offset-2">
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
              bankTxn={item.bank} data={data} bankTxns={bankTxns} addSub={addSub}
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
              bankTxn={item} data={data} bankTxns={bankTxns} addSub={addSub}
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
    <div className="modal-overlay fixed inset-0 z-50 flex items-start justify-center p-3 overflow-y-auto" style={{ background: P.overlay }} onClick={closeView}>
      <div role="dialog" aria-modal="true" style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: elev(3), borderRadius: R.panel }} className="modal-panel w-full max-w-3xl p-5 my-6" onClick={(e) => e.stopPropagation()}>
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

        {/* Clusters too large to be copies of one payment. Shown rather than
            dropped: capping the groups without saying so would replace a
            dangerous offer with a silent omission, and the second is harder to
            notice. */}
        {/* What your own rules will do, named before it happens. This is the
            answer to being asked about the same bank fee every month: you
            categorised it once and the app remembers. */}
        {ruleLineCount > 0 && !fixedSummary && (
          <div style={{ background: P.surface2, borderRadius: 16 }} className="p-4 mb-4">
            <div style={{ color: P.text }} className="text-[15px] mb-1">
              {ruleLineCount} {ruleLineCount === 1 ? "line matches a rule" : "lines match rules"} you already set
            </div>
            {ruleWork.map((g) => (
              <div key={g.rule.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[14.5px]"
                   style={{ borderTop: `1px solid ${P.line}` }}>
                <span style={{ color: P.muted }} className="min-w-0 truncate">
                  {g.lines.length} &times; {g.rule.subcategory || g.rule.category}
                  {g.rule.timesUsed ? ` · used ${g.rule.timesUsed} times before` : " · first time"}
                </span>
                <span style={{ fontFamily: MONO, color: P.text }} className="tabular-nums shrink-0">{fmt(g.total)}</span>
              </div>
            ))}
            <div style={{ color: P.faint }} className="text-[13.5px] mt-2">
              These are filed when you run the plan below, and every one is listed in the record afterwards.
            </div>
          </div>
        )}

        {fixedSummary?.recorded > 0 && (
          <div style={{ background: P.brass + "14", borderRadius: 16 }} className="p-4 mb-4">
            <div style={{ color: P.brassText }} className="text-[15px]">
              {fixedSummary.recorded} {fixedSummary.recorded === 1 ? "payment" : "payments"} the bank made
              {fixedSummary.recorded === 1 ? " is" : " are"} now in the books.
            </div>
            <div style={{ color: P.muted }} className="text-[14.5px] mt-1">
              The amounts and dates come from the bank and are right. The categories are a guess, so worth a
              look in Transactions. Delete any of them there if the bank was wrong.
            </div>
            {/* Closing lands on the section behind this, and the entries are
                in Transactions. Threading a navigation prop for one button
                would be more wiring than the button is worth; the sentence
                above says where to look. */}
          </div>
        )}

        {fixedSummary?.filed > 0 && (
          <div style={{ background: P.credit + "14", borderRadius: 16 }} className="p-4 mb-4">
            <div style={{ color: P.credit }} className="text-[15px]">
              {fixedSummary.filed} {fixedSummary.filed === 1 ? "line" : "lines"} filed from your rules.
            </div>
            <div style={{ color: P.muted }} className="text-[14.5px] mt-1">
              Each one is in the record for this run, so it can be undone entry by entry in Transactions.
            </div>
          </div>
        )}

        {dupPatterns.length > 0 && (
          <div style={{ background: P.surface2, borderRadius: 16 }} className="p-4 mb-4">
            <div style={{ color: P.text }} className="text-[15px] mb-1">
              {dupPatterns.length} {dupPatterns.length === 1 ? "run" : "runs"} of identical amounts, left alone
            </div>
            <p style={{ color: P.muted }} className="text-[14.5px] leading-snug mb-2">
              Too many entries of the same amount to be copies of one payment, so nothing here is offered for
              removal. Repeated transfers of a round number look exactly like this, and so does a statement
              imported many times over.
            </p>
            {dupPatterns.slice(0, 4).map((pt) => (
              <div key={pt.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[14px]"
                   style={{ borderTop: `1px solid ${P.line}` }}>
                <span style={{ color: P.muted }} className="min-w-0 truncate">
                  {pt.description || "no description"} &middot; {pt.count} entries
                </span>
                <span style={{ fontFamily: MONO, color: P.text }} className="tabular-nums shrink-0">{fmt(pt.amount)}</span>
              </div>
            ))}
            {dupPatterns.length > 4 && (
              <div style={{ color: P.faint }} className="text-[13.5px] mt-2">
                and {dupPatterns.length - 4} more. Transactions has the full list.
              </div>
            )}
          </div>
        )}

        {/* ---- the plan, written out before it runs ---- */}
        {plan.fix.count > 0 && !fixedSummary && (
          <div style={{ background: P.bg, border: `1px solid ${P.brass}` }} className="rounded-lg p-4 mb-4">
            <div style={{ color: P.brassText }} className="text-[14px] font-medium mb-2">
              What I would do
            </div>
            <div className="space-y-1.5">
              {plan.fix.lines.map((l, i) => <PlanLine key={i}>{l}</PlanLine>)}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Btn onClick={runPlan} loading={fixing}>
                {!fixing && <Check size={13} />} Go ahead
              </Btn>
              <button onClick={() => setShowManual(true)} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2">
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
                    <button onClick={undoLast} style={{ color: P.brassText }} className="text-[13.5px] underline decoration-dotted underline-offset-2">
                      <ChevronLeft size={11} className="inline mb-0.5" /> undo the last {undoable.verb}
                    </button>
                  )}
                  {asks.length > 1 && (
                    <button onClick={skipCurrent} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2">
                      {onLastLap ? "still not sure, next one" : "skip for now"}
                    </button>
                  )}
                  <button onClick={() => setShowAllAsks(true)} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2 ml-auto">
                    show all {asks.length} at once
                  </button>
                </div>
              </>
            ) : null}

            {showAllAsks && (
              <button onClick={() => setShowAllAsks(false)} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2 mt-3">
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
        <button onClick={() => setShowManual(!showManual)} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2">
          {showManual ? "hide" : "show"} everything line by line
        </button>

        {showManual && (
          <div className="mt-3">
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <Label>On the bank, not in the books ({plan.ask.unrecorded.length})</Label>
                <div className="space-y-2">
                  {plan.ask.unrecorded.length === 0 && (
                    <EmptyState compact icon={Check} title="Every bank line is accounted for" />
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
                    <EmptyState compact icon={Check} title="Every entry has cleared" />
                  )}
                  {/* All of them. A cap here means an entry that never cleared is
                      invisible to the person trying to clear it. */}
                  {plan.uncleared.map((t) => (
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
                <button onClick={() => setShowMatched(!showMatched)} style={{ color: P.brassText }} className="text-[13.5px] underline decoration-dotted underline-offset-2 underline-offset-2">
                  {showMatched ? "hide" : "show"} {matched.length} already paired, {ignored.length} set aside
                </button>
                {showMatched && (
                  <div className="space-y-1 mt-2">
                    {matched.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 text-xs" style={{ fontFamily: MONO, color: P.faint }}>
                        <Check size={11} style={{ color: P.credit }} className="shrink-0" />
                        <span className="flex-1 truncate">{b.date} {b.description} → {txById.get(b.matchedTxId)?.description || "entry"}</span>
                        <span className="tabular-nums shrink-0">{fmt(b.amount)}</span>
                        <button onClick={() => doUnmatch(b.id)} style={{ color: P.brassText }}>undo</button>
                      </div>
                    ))}
                    {ignored.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 text-xs" style={{ fontFamily: MONO, color: P.faint }}>
                        <X size={11} className="shrink-0" />
                        <span className="flex-1 truncate">{b.date} {b.description}</span>
                        <span className="tabular-nums shrink-0">{fmt(b.amount)}</span>
                        <button onClick={() => actions.unignore(b.id)} style={{ color: P.brassText }}>bring it back</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button onClick={onAnchorInstead} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2 underline-offset-2">
              or force the books to the bank balance, which sets the difference to zero without explaining it
            </button>
          </div>
        )}

        {/* ---- what past consolidations did, in sentences ---- */}
        {consolidation?.history?.length > 0 && (
          <div className="mt-4">
            <button onClick={() => setShowHistory(!showHistory)} style={{ color: P.brassText }} className="text-[13.5px] underline decoration-dotted underline-offset-2 underline-offset-2">
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
function AddFromBank({ bankTxn, data, bankTxns = [], onAdd, onMatchInstead, onCancel, addSub }) {
  const type = bankTxn.direction === "credit" ? "income" : "expense";
  const cats = data.categories[type] || [];
  const [category, setCategory] = useState(cats[0]?.name || "Other");
  const [subcategory, setSubcategory] = useState("");
  const subs = cats.find((c) => c.name === category)?.subs || [];
  // The matcher only looks a few days out, so an entry dated a fortnight from
  // the bank line never surfaces as a suggestion, and adding this line anyway
  // is exactly how the books end up with two of everything.
  const already = useMemo(
    () => likelyAlreadyInBooks(bankTxn, data.transactions, bankTxns),
    [bankTxn, data.transactions, bankTxns],
  );

  return (
    <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-2 mb-2">
      {already && (
        <div style={{ border: `1px solid ${P.brass}` }} className="rounded p-2 mb-2">
          <div style={{ color: P.brassText }} className="text-[14px] font-medium mb-1">
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
          {/* SubPicker rather than a plain select, so a subcategory can be
              created here. This form used a select with only the existing
              options, which meant categorising a bank line in Consolidate was
              the one place in the app where you could not name something new,
              and the workaround was to abandon the run, go to Transactions,
              create it there, and come back. */}
          <SubPicker
            data={data}
            type={type}
            category={category}
            value={subcategory}
            onChange={setSubcategory}
            addSub={addSub}
          />
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
// here. They are stored as bank_transactions and reconciled in MatchView.
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
    // twice, and every checked row goes in a second time as brand-new rows 
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
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: elev(3), borderRadius: R.panel }}
        className="modal-panel w-full max-w-2xl max-h-full flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3" style={{ borderBottom: `1px solid ${P.line}` }}>
          <h3 style={{ fontFamily: SERIF }} className="text-xl">Import a statement</h3>
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
              <Btn onClick={handlePaste} loading={busy} disabled={!pasted.trim()}>
                {!busy && <Check size={14} />} Read pasted text
              </Btn>
              <span style={{ color: P.faint, fontFamily: MONO }} className="text-xs">or</span>
              <input ref={fileRef} type="file" accept=".pdf,.csv,.txt,.tsv,image/*,application/pdf,text/csv" className="hidden"
                onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ""; }} />
              <Btn tone="ghost" onClick={() => fileRef.current.click()} disabled={busy}>
                <FileText size={14} /> Upload statement
              </Btn>
            </div>
            {busy && (
              <LoadingLine>reading every line… longer statements take a moment</LoadingLine>
            )}
            {err && <p style={{ color: P.debit }} className="text-xs">{err}</p>}
          </div>
        )}

        {step === "review" && (
          <>
            <div className="px-5 py-3 space-y-2" style={{ borderBottom: `1px solid ${P.line}` }}>
              <p style={{ color: P.muted }} className="text-sm">
                Found <span style={{ color: P.text }}>{rows.length}</span> lines
                {dupCount > 0 && <> · <span style={{ color: P.brassText }}>{dupCount} look like they're already in the ledger</span> (unchecked, tick any that aren't actually duplicates)</>}.
              </p>
              {err && <p style={{ color: P.faint }} className="text-xs">{err}</p>}
              {ending && (
                <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: P.muted }}>
                  <input type="checkbox" checked={anchorToo} onChange={(e) => setAnchorToo(e.target.checked)} className="mt-0.5" />
                  <span>
                    Also anchor the balance to the statement's ending balance:{" "}
                    <span style={{ fontFamily: MONO, color: P.brassText }}>{fmt(ending.amount)}</span> on{" "}
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
                        {r.dup && <div style={{ color: P.brassText, fontFamily: MONO }} className="text-xs">possible duplicate</div>}
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

/* The condensed form of the ledger line: the section you are in, then the same
   figures you chose to show, in the same order. It follows Customise, so the
   bar can never contradict the cards it condensed from. Pinned once the card
   grid scrolls out of view, and gone again the moment it returns. */
function MiniLine({ show, sectionName, stats }) {
  return (
    <div aria-hidden={!show} className={"mini-line" + (show ? " show" : "")}>
      <div className="mini-line-in">
        <span className="mtitle" style={{ color: P.text }}>{sectionName}</span>
        {stats.map((st) => (
          <span key={st.label} className="mstat">
            <span style={{ color: P.faint }} className="text-sm">{st.label}</span>
            <span style={{ fontFamily: MONO, color: st.tone }} className="text-base tabular-nums">{st.value}</span>
          </span>
        ))}
        <span style={{ flex: 1 }} />
      </div>
    </div>
  );
}

/* In against out for the month, as one proportion and one sentence. */
function FlowBar({ inc, exp }) {
  const total = inc + exp;
  if (total <= 0) return null;

  const inShare = (inc / total) * 100;

  /* The sentence is the point. A proportion on its own invites the reader to
     work out what it is telling them, and the answer is nearly always a ratio
     they would rather be handed. */
  let caption;
  if (inc === 0) caption = "Nothing came in this month.";
  else if (exp === 0) caption = "Nothing went out this month.";
  else {
    const perDollar = exp / inc;
    const cents = Math.round(perDollar * 100);
    if (Math.abs(perDollar - 1) < 0.005) {
      caption = "You spent almost exactly what you brought in.";
    } else if (perDollar >= 1) {
      caption = `${fmt(perDollar)} went out for every dollar that came in.`;
    } else if (cents === 0) {
      // A small expense against a large month rounds to zero cents, and "0 cents
      // went out" reads as nothing having happened when something did.
      caption = "Less than a cent went out for every dollar that came in.";
    } else {
      caption = `${cents} cents went out for every dollar that came in.`;
    }
  }

  return (
    <div className="mt-4">
      <div
        className="h-2 rounded-full overflow-hidden flex"
        role="img"
        aria-label={`${fmt(inc)} in, ${fmt(exp)} out`}
      >
        <div style={{ width: `${inShare}%`, background: P.credit }} className="h-full" />
        <div style={{ width: `${100 - inShare}%`, background: P.debit }} className="h-full" />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-2">
        <span style={{ color: P.muted }} className="text-[14px] inline-flex items-center gap-1.5">
          <span aria-hidden style={{ background: P.credit, width: 7, height: 7, borderRadius: "50%" }} />
          {fmt(inc)} in
        </span>
        <span style={{ color: P.muted }} className="text-[14px] inline-flex items-center gap-1.5">
          <span aria-hidden style={{ background: P.debit, width: 7, height: 7, borderRadius: "50%" }} />
          {fmt(exp)} out
        </span>
        <span style={{ color: P.faint }} className="text-[14px]">{caption}</span>
      </div>
    </div>
  );
}

/* ================= signature: the ledger line ================= */
/* A figure and, underneath it, which way it is going. Percentages are only
   meaningful against a month that actually had activity, so a zero prior month
   says "first month with activity" rather than dividing by nothing. */
function Delta({ now, prev, invert }) {
  if (prev == null) return null;
  if (!prev) {
    return <div style={{ color: P.faint }} className="text-xs mt-1">first month with activity</div>;
  }
  const pct = Math.round(((now - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return <div style={{ color: P.faint }} className="text-xs mt-1">level with last month</div>;
  const up = pct > 0;
  const good = invert ? !up : up;
  return (
    <div style={{ color: good ? P.credit : P.debit }} className="text-xs mt-1 flex items-center gap-1">
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(pct)}% on last month
    </div>
  );
}

/* Where a figure came from, line by line.

   A card gives you a total and the sentence under it gives you the shape. This
   is the third step: the actual entries, grouped the same way the sentence
   describes them, so a number you do not recognise can be followed back to the
   thing that caused it.

   Grouped rather than listed flat, because "here are 47 rows" is not an
   explanation. The groups are the sentence: through the bank, not through it,
   still to file. */
/* Does the balance tie out?

   This is the question the whole product rests on. Everything else is
   presentation: if the books and the bank disagree and nobody can say why, the
   figures are decoration.

   A reconciliation in the accounting sense, not a list: start from what the
   bank says, account for every difference by name, and arrive at what the
   books say. Anything left over at the end is the amount nobody can explain,
   and that number should be zero. When it is not, it is stated as plainly as
   the rest rather than folded into a total.
*/
function BalanceTrail({ balance, transactions, bankTxns, month, onClose, onConsolidate }) {
  const paired = new Set((bankTxns || []).map((b) => b.matchedTxId).filter(Boolean));

  const settled = (bankTxns || []).filter((b) => !b.pending && b.status !== "ignored");
  const unfiled = settled.filter((b) => b.status !== "matched");
  const pending = (bankTxns || []).filter((b) => b.pending);
  const bookOnly = (transactions || []).filter(
    (t) => !paired.has(t.id) && t.payMethod !== "credits" && t.date && t.date > (balance.anchorDate || ""),
  );
  const ignored = (bankTxns || []).filter((b) => b.status === "ignored");

  const signed = (rows, isCredit) =>
    rows.reduce((n, r) => n + (isCredit(r) ? Math.abs(Number(r.amount) || 0) : -Math.abs(Number(r.amount) || 0)), 0);

  const unfiledNet = signed(unfiled, (b) => b.direction === "credit");
  const bookOnlyNet = signed(bookOnly, (t) => t.type === "income");
  const pendingNet = signed(pending, (b) => b.direction === "credit");

  const bankSide = Number(balance.bank) || 0;
  const bookSide = Number(balance.book) || 0;

  /* The bank's figure, adjusted by everything the books know about that the
     bank does not, and stripped of everything the bank knows that the books
     have not filed. What is left should be the books. */
  const explained = bankSide - unfiledNet + bookOnlyNet;
  const unexplained = Math.round((bookSide - explained) * 100) / 100;

  const Line = ({ label, why, amount, strong, tone }) => (
    <div className="py-2" style={{ borderTop: `1px solid ${P.line}` }}>
      <div className="flex items-baseline justify-between gap-3">
        <span style={{ color: strong ? P.text : P.muted }} className="text-[15px] min-w-0">
          {label}
        </span>
        <span
          style={{ fontFamily: MONO, color: tone || (strong ? P.text : P.faint) }}
          className="text-[15px] tabular-nums shrink-0"
        >
          {amount == null ? "" : fmt(amount)}
        </span>
      </div>
      {why && <p style={{ color: P.faint }} className="text-[13px] mt-0.5">{why}</p>}
    </div>
  );

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title="Does this tie out?"
      panelClass="flex flex-col"
      panelStyle={{ maxHeight: "88vh" }}
    >
      <ModalBody className="overflow-y-auto min-h-0 flex-1">
        <div
          className="flex items-baseline justify-between gap-3 pb-3 sticky top-0 z-10"
          style={{ borderBottom: `1px solid ${P.line}`, background: P.surface }}
        >
          <span style={{ color: P.muted }} className="text-[15px]">
            {Math.abs(unexplained) < 0.01 ? "Everything is accounted for" : "Not everything is accounted for"}
          </span>
          <span
            style={{ fontFamily: MONO, color: Math.abs(unexplained) < 0.01 ? P.credit : P.debit }}
            className="text-[19px] tabular-nums"
          >
            {fmt(unexplained)}
          </span>
        </div>

        <Line
          label="The bank says"
          why={balance.balanceAsOf ? `as of ${balance.balanceAsOf}` : "across every connected account"}
          amount={bankSide}
          strong
        />
        <Line
          label={`Less ${unfiled.length} bank ${unfiled.length === 1 ? "line" : "lines"} not yet filed`}
          why="The bank has them and the books do not, so they are in one figure and not the other."
          amount={-unfiledNet}
        />
        <Line
          label={`Plus ${bookOnly.length} ${bookOnly.length === 1 ? "entry" : "entries"} the bank never saw`}
          why="Cash, credits and anything typed in that no bank line accounts for."
          amount={bookOnlyNet}
        />
        <Line label="Which should give the books" amount={explained} strong />
        <Line
          label="The books actually say"
          amount={bookSide}
          strong
          tone={Math.abs(unexplained) < 0.01 ? P.credit : P.debit}
        />

        {Math.abs(unexplained) >= 0.01 && (
          <div
            style={{ background: P.debit + "14", color: P.debit, borderRadius: 14 }}
            className="p-3.5 mt-3 text-[14px] leading-relaxed"
          >
            {fmt(Math.abs(unexplained))} cannot be accounted for by anything above. That is usually an
            entry recorded twice, a bank line matched to the wrong entry, or a starting balance that was
            never right. Consolidating will name most of it.
          </div>
        )}

        {pending.length > 0 && (
          <Line
            label={`${pending.length} pending, not counted either side`}
            why={`${fmt(Math.abs(pendingNet))} the bank has not settled. It affects neither figure yet.`}
            amount={null}
          />
        )}
        {ignored.length > 0 && (
          <Line
            label={`${ignored.length} set aside`}
            why="Lines you have said are not yours. Excluded on purpose."
            amount={null}
          />
        )}

        {onConsolidate && Math.abs(unexplained) >= 0.01 && (
          <button
            onClick={() => { onClose(); onConsolidate(); }}
            style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
            className="h-11 px-4 text-[15px] font-medium press mt-4"
          >
            Consolidate
          </button>
        )}
      </ModalBody>
    </Modal>
  );
}

function FigureTrail({ side, month, transactions, bankTxns, obligations, ledgerCcy, cardValue, onClose, openPreview }) {
  /* Owed and owing follow a different trail.

     Money in and out are built from movements, so the question is where the
     money went. What is owed is built from commitments, so the question is
     when each one lands and how much of it is left. Same idea, different
     spine: grouped by urgency rather than by route. */
  if (side === "ar" || side === "ap") {
    return (
      <ObligationTrail
        kind={side === "ar" ? "receivables" : "payables"}
        rows={obligations || []}
        onClose={onClose}
        openPreview={openPreview}
      />
    );
  }

  const isIn = side === "in";
  const isNet = side === "net";
  const label = isNet ? "Net this month" : isIn ? "Money in" : "Money out";
  const wantType = isIn ? "income" : "expense";

  const inMonth = (d) => String(d || "").startsWith(month);
  const paired = new Set((bankTxns || []).map((b) => b.matchedTxId).filter(Boolean));

  /* Net is both sides, so nothing is filtered by direction. The groups then
     read as money in and money out rather than as routes, which is what a net
     figure is actually made of. */
  const bankRows = (bankTxns || []).filter(
    (b) => !b.pending && b.status !== "ignored" && inMonth(b.date)
      && (isNet || (isIn ? b.direction === "credit" : b.direction !== "credit")),
  );
  const bookOnly = (transactions || []).filter(
    (t) => inMonth(t.date) && !paired.has(t.id) && t.payMethod !== "credits"
      && (isNet || t.type === wantType),
  );
  const unfiled = bankRows.filter((b) => b.status !== "matched");

  /* Lines the bank has not settled.

     These were filtered out and never mentioned, so the newest two days of
     activity simply were not there: $2,123.00 of it, on the days you would
     most want to check. Excluding them from the total is right, because the
     bank has not committed to them and the figure would move under you.
     Excluding them from the list is not, because their absence looks like
     missing data. */
  const pendingRows = (bankTxns || []).filter(
    (b) => b.pending && inMonth(b.date)
      && (isNet || (isIn ? b.direction === "credit" : b.direction !== "credit")),
  );

  const sum = (rows, key = "amount") =>
    rows.reduce((n, r) => n + Math.abs(Number(r[key]) || 0), 0);

  const signed = (rows, isCredit) => rows.reduce(
    (n, r) => n + (isCredit(r) ? Math.abs(Number(r.amount) || 0) : -Math.abs(Number(r.amount) || 0)), 0,
  );

  // The most recent line the bank has given us, across the whole feed.
  const newestLine = (bankTxns || [])
    .map((b) => b.date)
    .filter(Boolean)
    .sort()
    .pop() || "";

  const total = isNet
    ? signed(bankRows, (b) => b.direction === "credit") + signed(bookOnly, (t) => t.type === "income")
    : sum(bankRows) + sum(bookOnly);

  const Group = ({ title, why, rows, describe, amountOf, tone }) => {
    if (!rows.length) return null;
    return (
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span style={{ color: P.text }} className="text-[15.5px]">
            {title}
            {/* How many, so a long group announces its own length rather than
                leaving you to scroll to find out. */}
            <span style={{ color: P.faint }} className="text-[13.5px] font-normal">
              {" "}&middot; {rows.length}
            </span>
          </span>
          <span
            style={{ fontFamily: MONO, color: tone || P.text }}
            className="text-[15.5px] tabular-nums shrink-0"
          >
            {fmt(sum(rows))}
          </span>
        </div>
        <p style={{ color: P.faint }} className="text-[13.5px] mb-1">{why}</p>
        {/* Every row. The modal scrolls; a detail view that hides rows is
            not a detail view, and "and 16 more" is the answer to a question
            nobody asked. */}
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-baseline justify-between gap-3 py-1"
            style={{ borderTop: `1px solid ${P.line}` }}
          >
            <span style={{ color: P.muted }} className="text-[13.5px] min-w-0 truncate">
              {String(r.date).slice(5)} &middot; {describe(r)}
            </span>
            <span
              style={{ fontFamily: MONO, color: P.faint }}
              className="text-[13.5px] tabular-nums shrink-0"
            >
              {fmt(amountOf(r))}
            </span>
          </div>
        ))}

      </div>
    );
  };

  return (
    /* A full view, with the scrolling inside it.

       The panel had no height of its own, so forty rows simply made the page
       taller and the total, the header and the close button all went with it.
       You could not tell whether the list continued or had run out.

       It is now a sheet: it takes the height available, the header stays, and
       only the rows move. */
    <Modal
      onClose={onClose}
      size="lg"
      title={`${label}, ${monthLabel(month)}`}
      panelClass="flex flex-col"
      panelStyle={{ maxHeight: "88vh" }}
    >
      <ModalBody className="overflow-y-auto min-h-0 flex-1">
        {/* The detail proves itself against the card.

            These two figures are computed by different code from the same
            data, so they agree only if both filters agree. When they do not,
            one of them is wrong and the reader deserves to know which screen
            to distrust rather than finding out from a statement weeks later.

            It is a check that runs in front of the person who cares, which is
            the only kind that cannot be forgotten. */}
        {cardValue != null && Math.abs(total - cardValue) > 0.01 && (
          <div
            style={{ background: P.debit + "14", color: P.debit, borderRadius: 14 }}
            className="p-3.5 mb-3 text-[14px] leading-relaxed"
          >
            These rows come to {fmt(total)} and the card says {fmt(cardValue)}. One of the two is wrong,
            and nothing here is filtered by anything you set, so it is a fault rather than something to
            adjust.
          </div>
        )}

        {/* The total stays put.

            A list of forty rows scrolls the total off the screen, which leaves
            you reading amounts with nothing to add them against. It is the one
            line you need throughout, so it stays at the top of the scroll
            rather than at the top of the list. */}
        <div
          className="flex items-baseline justify-between gap-3 pb-3 sticky top-0 z-10"
          style={{ borderBottom: `1px solid ${P.line}`, background: P.surface }}
        >
          <span style={{ color: P.muted }} className="text-[15px]">
            Everything below adds to
            {pendingRows.length > 0 && (
              <span style={{ color: P.faint }} className="block text-[13px]">
                {pendingRows.length} more pending, not counted
              </span>
            )}
          </span>
          <span
            style={{ fontFamily: MONO, color: isIn ? P.credit : P.debit }}
            className="text-[19px] tabular-nums"
          >
            {fmt(total)}
          </span>
        </div>

        {/* How far the feed reaches, stated before the rows rather than after
            them.

            An absent transaction has two explanations that need different
            answers: the bank has not settled it, which is the group below, or
            the feed has not fetched it, which is this line. Both belong where
            the question is asked. */}
        {newestLine && (
          <p style={{ color: P.faint }} className="text-[13px] pt-3">
            The bank has given us everything up to {newestLine}. Anything after that has not arrived yet.
          </p>
        )}

        {/* Pending first, because it answers the question people open this to
            ask.

            Somebody looking for yesterday's transfers was being asked to
            scroll past thirty-eight settled rows to find out they were
            pending. The newest days are the ones you check, so the reason they
            are absent belongs at the top rather than at the bottom. */}
        <Group
          title="Not settled yet"
          why="The bank has these and has not settled them, so they are not in the figure above yet."
          rows={pendingRows}
          describe={(b) => b.description || "bank line"}
          amountOf={(b) => b.amount}
        />

        <Group
          title="Through the bank"
          why="What the bank saw."
          rows={bankRows}
          tone={isIn ? P.credit : P.debit}
          describe={(b) => b.description || "bank line"}
          amountOf={(b) => b.amount}
        />

        <Group
          title="Not through the bank"
          why="Cash and hand-entered. The bank never saw these."
          rows={bookOnly}
          describe={(t) => `${t.description || t.category}${t.category && t.description ? ` · ${t.category}` : ""}`}
          amountOf={(t) => t.amount}
        />

        <Group
          title="Still to file"
          why="Counted above, but with no category yet. Consolidating files them."
          rows={unfiled}
          describe={(b) => b.description || "bank line"}
          amountOf={(b) => b.amount}
        />

        {/* How far the feed reaches.

            If a row is missing, there are two reasons and they need different
            answers: the bank has not settled it, which is above, or the feed
            has not fetched it, which is here. Without this line an absence
            looks the same either way and you are left guessing which. */}
        {newestLine && (
          <p style={{ color: P.faint }} className="text-[13px] mt-4 pt-3">
            The feed's newest line is {newestLine}. Anything after that has not been fetched yet.
          </p>
        )}

        {!bankRows.length && !bookOnly.length && !pendingRows.length && (
          <p style={{ color: P.muted }} className="text-[15px] py-4">
            Nothing this month.
          </p>
        )}

        {/* An end, so a list that stops looks like it stopped rather than like
            it was cut off. */}
        {(bankRows.length > 0 || bookOnly.length > 0) && (
          <p
            style={{ color: P.faint, borderTop: `1px solid ${P.line}` }}
            className="text-[13px] text-center pt-3 mt-4"
          >
            That is everything for {monthLabel(month)}.
          </p>
        )}
      </ModalBody>
    </Modal>
  );
}

/* What is owed, and when it lands.

   The card gives a total across a dozen parties and a fortnight of dates,
   which answers how much and nothing else. The useful questions are which of
   these is late, which is about to be, and how much of each is actually left
   after part payments. */
function ObligationTrail({ kind, rows, onClose, openPreview }) {
  const isAR = kind === "receivables";
  const today = todayStr();
  const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

  const open = rows.filter((o) => o.status === "open");
  const left = (o) => Math.max(0, Math.round((Math.abs(o.amount) - (Number(o.paidAmount) || 0)) * 100) / 100);
  const due = (o) => ((Number(o.paidAmount) || 0) > 0 && o.balanceDue ? o.balanceDue : o.dueDate);

  const overdue = open.filter((o) => due(o) && due(o) < today);
  const within = open.filter((o) => due(o) && due(o) >= today && due(o) <= soon);
  const later = open.filter((o) => !due(o) || due(o) > soon);
  const total = open.reduce((n, o) => n + left(o), 0);

  const Group = ({ title, why, list, tone }) => {
    if (!list.length) return null;
    return (
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span style={{ color: P.text }} className="text-[15.5px]">
            {title}
            <span style={{ color: P.faint }} className="text-[13.5px] font-normal">
              {" "}&middot; {list.length}
            </span>
          </span>
          <span
            style={{ fontFamily: MONO, color: tone || P.text }}
            className="text-[15.5px] tabular-nums shrink-0"
          >
            {fmt(list.reduce((n, o) => n + left(o), 0))}
          </span>
        </div>
        <p style={{ color: P.faint }} className="text-[13.5px] mb-1">{why}</p>
        {list.map((o) => (
          <div
            key={o.id}
            className="flex items-baseline justify-between gap-3 py-1.5"
            style={{ borderTop: `1px solid ${P.line}` }}
          >
            <span className="min-w-0">
              <span style={{ color: P.muted }} className="text-[14px] block truncate">
                {o.party}{o.description ? ` · ${o.description}` : ""}
              </span>
              <span style={{ color: P.faint }} className="text-[12.5px]">
                {due(o) ? `due ${due(o)}` : "no date"}
                {(Number(o.paidAmount) || 0) > 0
                  ? ` · ${fmt(o.paidAmount)} of ${fmt(Math.abs(o.amount))} paid`
                  : ""}
                {o.attachmentId ? " · receipt on file" : ""}
              </span>
            </span>
            <span
              style={{ fontFamily: MONO, color: P.faint }}
              className="text-[14px] tabular-nums shrink-0"
            >
              {fmt(left(o))}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={isAR ? "Owed to you" : "You owe them"}
      panelClass="flex flex-col"
      panelStyle={{ maxHeight: "88vh" }}
    >
      <ModalBody className="overflow-y-auto min-h-0 flex-1">
        {/* Same as the figure trail: the total is what you are reading the
            rows against, so it does not scroll away from them. */}
        <div
          className="flex items-baseline justify-between gap-3 pb-3 sticky top-0 z-10"
          style={{ borderBottom: `1px solid ${P.line}`, background: P.surface }}
        >
          <span style={{ color: P.muted }} className="text-[15px]">
            {open.length} open, still outstanding
          </span>
          <span
            style={{ fontFamily: MONO, color: isAR ? P.credit : P.debit }}
            className="text-[19px] tabular-nums"
          >
            {fmt(total)}
          </span>
        </div>

        <Group
          title="Overdue"
          why={isAR ? "Chase these." : "Past their date."}
          list={overdue}
          tone={P.debit}
        />
        <Group
          title="Within a fortnight"
          why="Next fourteen days."
          list={within}
        />
        <Group
          title="Later"
          why="Further out, or undated."
          list={later}
        />

        {!open.length && (
          <p style={{ color: P.muted }} className="text-[15px] py-4">
            Nothing open.
          </p>
        )}

        {open.length > 0 && (
          <p
            style={{ color: P.faint, borderTop: `1px solid ${P.line}` }}
            className="text-[13px] text-center pt-3 mt-4"
          >
            That is all {open.length} of them.
          </p>
        )}
      </ModalBody>
    </Modal>
  );
}

function LedgerLine({ sums, prevSums, entryCount, balance, openBooks, creditsLeft, onCredits, onReconcile, needsConsolidation, consolidationSettled, onConsolidate, sectionName, counts, unrecorded = { in: 0, out: 0 }, carry, onExplain }) {
  const fromBank = balance.source === "bank";

  // The bar appears when the grid leaves the screen. A sentinel and an observer
  // rather than a scroll handler, so it costs nothing per frame.
  const gridRef = useRef(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPinned(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Which cards are showing. Stored, so the choice survives a reload, and
  // validated on read so a card removed in a later version cannot leave a hole.
  const ALL = ["balance", "net", "in", "out", "ar", "ap", "credits"];
  const [shown, setShown] = useState(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem("snapshot:cards") || "null");
      if (Array.isArray(raw) && raw.length) return raw.filter((k) => ALL.includes(k));
    } catch { /* private mode */ }
    return ["balance", "net", "in", "out", "ar", "ap"];
  });
  const [picking, setPicking] = useState(false);
  const toggle = (k) => {
    setShown((cur) => {
      const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
      if (!next.length) return cur;           // never leave the page blank
      try { window.localStorage.setItem("snapshot:cards", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const money = (n) => fmt(n);
  const inCount = counts?.inCount ?? 0;
  const outCount = counts?.outCount ?? 0;
  const arFoot = counts?.arFoot || "settle in AR / AP to count it";
  const apFoot = counts?.apFoot || "settle in AR / AP to count it";

  /* What actually moved this month: filed entries, plus bank lines nothing
     has filed yet. They cannot overlap, because an unrecorded line is one no
     entry accounts for. */
  /* What moved this month: the bank, plus anything recorded that never
     touched it.

     The bank alone would drop cash and anything paid from a credit pool. The
     books alone miss whatever has not been filed. Adding an entry that has a
     bank line behind it would count the same money twice, so those are left
     to the bank side, which is where the date the money actually moved comes
     from.

     With no feed at all, the books are the only answer there is. */
  /* One sentence explaining a figure, in the same shape for both cards.

     Two parts that add up to the total, and a third only when something is
     still unfiled, because that is the only part that is actually work. */
  /* Quiet when there is nothing to say.

     The subtext was breaking every figure into its parts whether or not the
     parts were interesting. On a ledger where everything is filed and matched,
     "$700.83 through the bank" under a card reading $700.83 is a sentence that
     restates the number and teaches you to stop reading the line.

     It now says the plain count, and speaks up only for the things that would
     change what you do: money that did not go through the bank, lines not yet
     filed, and a feed that has fallen behind. */
  const cardFoot = (side) => {
    const notBank = side === "in" ? (unrecorded.bookOnlyIn || 0) : (unrecorded.bookOnlyOut || 0);
    const unfiled = side === "in" ? unrecorded.inAmount : unrecorded.outAmount;
    const unfiledCount = side === "in" ? unrecorded.in : unrecorded.out;
    /* The count of the things the figure adds up, not of book entries. Falls
       back to the book count only when there is no feed at all. */
    const n = unrecorded.hasBank
      ? (side === "in" ? unrecorded.countIn : unrecorded.countOut)
      : (side === "in" ? inCount : outCount);
    const word = side === "in" ? (n === 1 ? "deposit" : "deposits") : (n === 1 ? "payment" : "payments");

    const parts = [`${n} ${word}`];
    if (notBank > 0.005) parts.push(`${money(notBank)} not through the bank`);
    if (unfiledCount > 0) parts.push(`${money(unfiled)} still to file`);

    /* How far the bank data reaches, always, not only when it is badly stale.
     *
     * I hid this behind a two day threshold, so on the day it mattered the
     * card said nothing and the figure looked simply wrong. The date is what
     * tells you whether a short figure is a fault or a feed, and that is
     * worth one phrase on every card rather than an alarm on a few. */
    if (unrecorded.hasBank && unrecorded.newestLine) {
      parts.push(`bank read to ${unrecorded.newestLine}`);
    }
    return parts.join(" · ");
  };

  const trueIn = unrecorded.hasBank ? unrecorded.bankIn + (unrecorded.bookOnlyIn || 0) : sums.inc;
  const trueOut = unrecorded.hasBank ? unrecorded.bankOut + (unrecorded.bookOnlyOut || 0) : sums.exp;
  const trueNet = trueIn - trueOut;

  const cards = {
    balance: {
      // The figure is the headline; the state of it is a sentence, not a
      // string of symbols. "Δ −$1,397.97" is a thing to decode, "the books say
      // X, a gap of Y" is a thing to read.
      label: "Balance to date",
      /* Not a dash, and not the book figure.

         Drawing the book figure and correcting it a moment later is worse
         than drawing nothing: the first number was never wrong exactly, it
         just was not the one being asked for, and a figure that changes while
         you look at it is a figure you stop trusting.

         A dash was the first attempt and is still number-shaped, so the eye
         reads it as a value and then watches the value change, which is the
         glitch it was meant to prevent. A mark that is visibly working reads
         as "not yet". */
      value: balance.source === "loading" ? <TallyLoading /> : balance.beforeAnchor ? "·" : money(balance.value),
      tone: P.text, wide: true, /* Pressing the balance asks the only question that matters about
         it: does it tie out. Falling back to the old behaviour where the
         explainer is not wired, so this cannot leave a dead card. */
      onClick: onExplain ? () => onExplain("balance") : onReconcile,
      lead: balance.source === "loading"
        ? ""
        : fromBank
        ? (balance.delta != null && Math.abs(balance.delta) >= 0.01
            ? `Books say ${money(balance.book)}, a gap of ${money(Math.abs(balance.delta))}`
            : "Bank and books agree")
        : balance.beforeAnchor
          ? `This month ends before your anchor`
          : `Anchored at ${money(balance.anchorAmount)}`,
      /* The day and the time, and nothing invented.

         This said "Updated today" with no clock, and said it even when there
         was no timestamp at all: the word "today" was a hardcoded fallback,
         so a balance of unknown age claimed to be current. A figure that
         asserts its own freshness without knowing it is worse than one that
         says nothing.

         `stamp` gives "today at 7:02 a.m.", which is what makes a balance
         worth trusting or worth refreshing. */
      foot: balance.source === "loading"
        ? "Reading the bank"
        : fromBank
          ? (balance.balanceAsOf ? `Updated ${stamp(balance.balanceAsOf)}` : "Updated, time unknown")
          : `Set on ${balance.anchorDate}`,
      warn: needsConsolidation,
    },
    net: {
      label: "Net this month",
      /* Net has to agree with the two cards beside it.

         In and out now show what moved, so a net computed from the filed half
         would sit between them contradicting both. */
      value: money(trueNet),
      tone: trueNet >= 0 ? P.credit : P.debit, wide: true,
      // Net is in minus out, so it opens on both.
      onClick: onExplain ? () => onExplain("net") : undefined,
      delta: { now: sums.net, prev: prevSums?.net },
      /* Where the month began and where it ends up.

         A month with a total in and a total out and no link to the one before
         it is a month floating free: money received on 31 August stopped
         existing on 1 September. Every period opens with what the last one
         left, and saying so is the difference between a list of movements and
         a set of books. */
      /* The opening figure is built from the books, so while lines are
         unfiled it is describing a period the books do not yet fully cover.
         Saying "opened at X" from an incomplete record is the same confident
         wrong number as the one this replaced, so it waits. */
      foot: unrecorded.in || unrecorded.out
        ? `${money(sums.net)} of this is filed. Consolidate to carry the month forward.`
        : carry?.known
          ? `Opened at ${money(carry.opening)}, closes at ${money(carry.closing)}`
          : `Across ${entryCount} ${entryCount === 1 ? "entry" : "entries"} this month`,
    },
    /* These count the books, and the books can be behind the bank.

       "Money in $0.00, 0 deposits" is true of your ledger and reads as false
       when the bank shows a month of activity. The figure is not wrong; it is
       incomplete, and a card that cannot say which is a card that looks
       broken.

       So when the bank holds lines nobody has recorded, the count says so and
       the change against last month is withheld: comparing an empty month
       with a full one produces "100% down", which is arithmetic rather than
       information. */
    /* The headline is what came in, not what has been filed.

       It showed the books, so September read $700.83 while the bank had taken
       $2,032.03, and the true figure was relegated to a note under it. The
       books being behind is a bookkeeping lag, not a different reality: the
       money arrived either way, and a card called "Money in" that excludes
       money that came in is answering a different question from the one it
       asks.

       Adding them cannot double count. An unrecorded line is by definition
       one no entry accounts for, so the moment it is filed it leaves this
       set and joins the other. */
    in:  { label: "Money in",
           value: money(trueIn), tone: P.credit,
           onClick: onExplain ? () => onExplain("in") : undefined,
           delta: unrecorded.in ? null : { now: sums.inc, prev: prevSums?.inc },
           /* The bank's own figure, so this card can be checked against a
              statement without opening one. When the books are complete the
              two agree and there is nothing to say. */
           /* The split, under the true figure. Which half is filed matters
              for the tax pack and for anything that reads the books, so it is
              said plainly rather than hidden behind a total. */
           /* When nothing is outstanding the card says where the figure came
              from, rather than a bare count. "3 deposits" and "$0.00" together
              leave you unable to tell a quiet month from a feed that has not
              arrived, which is the confusion this whole card has been causing. */
           /* Matched is not the same as equal.

              Everything being paired says every bank line has an entry beside
              it. It says nothing about whether the two months add to the same
              figure, and they often do not: a deposit dated 31 August paired
              with an entry dated 1 September sits in different months on each
              side, and both are correctly matched.

              So the totals are compared whether or not anything is
              outstanding. Saying "all matched" and stopping there is how a
              $1,300 gap stayed invisible while the card looked healthy. */
           /* Where the figure came from, in two parts that add up to it.

              This used to compare the card against the bank and report them
              as "apart", which described a disagreement that does not exist:
              money that did not go through the bank is not a discrepancy, it
              is the other half of the total. The old wording sent you looking
              for an error that was never there. */
           foot: cardFoot("in") },
    out: { label: "Money out",
           value: money(trueOut), tone: P.debit,
           onClick: onExplain ? () => onExplain("out") : undefined,
           delta: unrecorded.out ? null : { now: sums.exp, prev: prevSums?.exp, invert: true },
           foot: cardFoot("out") },
    ar:  { label: "Owed to you", value: money(openBooks.ar), tone: P.credit, foot: arFoot,
           onClick: onExplain ? () => onExplain("ar") : undefined },
    ap:  { label: "You owe",     value: money(openBooks.ap), tone: P.debit,  foot: apFoot,
           onClick: onExplain ? () => onExplain("ap") : undefined },
    credits: creditsLeft !== null
      ? { label: "Credits left", value: money(creditsLeft), tone: creditsLeft > 0 ? P.credit : P.debit,
          onClick: onCredits, underline: true, foot: "non-cash, across every pool" }
      : null,
  };

  const visible = shown.filter((k) => cards[k]);

  return (
    <section className="mt-1" ref={gridRef}>
      <MiniLine
        show={pinned}
        sectionName={sectionName}
        /* truncation-ok: the pinned bar holds four figures by design. */
        stats={visible.slice(0, 4).map((k) => ({ label: cards[k].label.split(" · ")[0], value: cards[k].value, tone: cards[k].tone }))}
      />
      <div className="flex items-center justify-end gap-3 mb-3 -mt-11">
        <button
          onClick={() => setPicking((v) => !v)}
          aria-label="Choose which cards show"
          title="Choose cards"
          style={{ background: P.surface, boxShadow: elev(1), borderRadius: R.control, color: picking ? P.brassText : P.muted }}
          className="w-11 h-11 inline-flex items-center justify-center shrink-0 press"
        >
          <Sliders size={18} />
        </button>
      </div>

      {/* A sheet, not an inline tray. Choosing which cards show is a decision
          about the page, so it happens over the page rather than pushing it
          down and reflowing the very thing you are deciding about. Each row
          carries the card's own footnote, so you are picking a card you
          recognise rather than a label. */}
      {picking && (
        <div
          className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: P.overlay }}
          onClick={() => setPicking(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Customise Snapshot"
            onClick={(e) => e.stopPropagation()}
            style={{ background: P.surface, boxShadow: elev(3), borderRadius: R.panel }}
            className="modal-panel w-full max-w-md max-h-[85vh] overflow-y-auto"
          >
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-start justify-between gap-3">
                <h3 style={{ fontFamily: SERIF }} className="text-xl">Customise Snapshot</h3>
                <button onClick={() => setPicking(false)} aria-label="Close" style={{ color: P.muted }} className="p-1 shrink-0">
                  <X size={17} />
                </button>
              </div>
              <p style={{ color: P.muted }} className="text-[15px] mt-1">
                {visible.length} of {ALL.filter((k) => cards[k]).length} showing. The first two run full width.
              </p>
            </div>

            <div className="px-6 pb-6">
              {ALL.filter((k) => cards[k]).map((k, i) => {
                const on = shown.includes(k);
                const c = cards[k];
                const last = on && visible.length === 1;
                return (
                  <div
                    key={k}
                    className="flex items-center gap-4 py-4"
                    style={i === 0 ? {} : { borderTop: `1px solid ${P.line}` }}
                  >
                    <div className="flex-1 min-w-0">
                      <div style={{ color: P.text }} className="text-[16px]">{c.label}</div>
                      {(c.foot || c.lead) && (
                        <div style={{ color: P.faint }} className="text-[14px] mt-0.5 truncate">{c.foot || c.lead}</div>
                      )}
                    </div>
                    <button
                      onClick={() => toggle(k)}
                      role="switch"
                      aria-checked={on}
                      aria-label={c.label}
                      disabled={last}
                      title={last ? "Keep at least one card" : undefined}
                      style={{
                        width: 48, height: 28, borderRadius: 999, flexShrink: 0, position: "relative",
                        background: on ? P.brass : P.surface2,
                        border: `1px solid ${on ? P.brass : P.line}`,
                        opacity: last ? 0.5 : 1,
                        cursor: last ? "not-allowed" : "pointer",
                        transition: "background .2s ease",
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          position: "absolute", top: 2, left: 2, width: 22, height: 22, borderRadius: "50%",
                          background: P.surface, boxShadow: elev(1),
                          transform: on ? "translateX(20px)" : "none",
                          transition: "transform .22s cubic-bezier(.2,.8,.2,1)",
                        }}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {visible.map((k) => {
          const c = cards[k];
          const Inner = (
            <>
              <div className="flex items-center gap-1.5 mb-2.5">
                <span style={{ color: P.text }} className="text-[15px]">{c.label}</span>
                {/* The warning triangle opens Consolidate, so without a
                    handler it is a button that throws. A reader sees the
                    warning as plain text instead: the gap is still worth
                    knowing about, it is just not theirs to close. */}
                {c.warn && !onConsolidate && (
                  <AlertTriangle size={13} style={{ color: P.debit }} aria-hidden />
                )}
                {c.warn && onConsolidate && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onConsolidate(); }}
                    title={consolidationSettled ? "Consolidated, but the gap is not fully explained. Tap to review." : "Bank and books disagree. Tap to consolidate."}
                    style={{ color: consolidationSettled ? P.muted : P.debit }}
                    className="shrink-0"
                  >
                    <AlertTriangle size={14} />
                  </button>
                )}
              </div>
              <div
                style={{ fontFamily: MONO, color: c.tone }}
                className={`tabular-nums ${c.wide ? "text-[34px] k-fig-wide" : "text-[26px] k-fig"} leading-none`}
              >
                {c.value}
              </div>
              {c.delta && <Delta now={c.delta.now} prev={c.delta.prev} invert={c.delta.invert} />}
              {c.lead && <div style={{ color: P.muted }} className="text-[14.5px] mt-2.5">{c.lead}</div>}
              {c.foot && (
                <div style={{ color: P.faint }} className="text-[14px] mt-auto pt-3 leading-snug">{c.foot}</div>
              )}
            </>
          );
          return (
            <div
              key={k}
              onClick={c.onClick}
              style={cardStyle()}
              className={`p-5 flex flex-col ${c.wide ? "col-span-2" : ""} ${c.onClick ? "cursor-pointer" : ""}`}
            >
              {Inner}
            </div>
          );
        })}
      </div>

      {/* The shape of the month, in one line.

          This was two half-width tracks, each scaled to whichever of in and out
          was larger. With nothing coming in and six dollars going out, the left
          track was empty and the right was full, so what you saw was a red line
          across half the screen with nothing to say what it meant. It also
          repeated two figures the cards above already state.

          One track now, split by share of the money that moved, with a sentence
          underneath that says the thing the proportion is for. Hidden entirely
          when nothing moved, because a bar of nothing is not information. */}
      <FlowBar inc={sums.inc} exp={sums.exp} />
    </section>
  );
}

/* An icon in the header that opens a panel underneath it. This is where the
   two banners went: the tour card and the setup checklist used to sit above
   every screen, pushing the ledger down and saying the same thing every time.
   The help is still one tap away; it just stops shouting before it is asked. */
function HeaderPopover({ icon: Icon, label, dot, badge, open, onToggle, children, quietWhenRead }) {
  // Nothing to say means nothing on screen. An icon that is permanently lit is
  // furniture; one that appears when it has news is a message.
  const hidden = quietWhenRead && !dot && !open;
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!e.target.closest("[data-header-popover]")) onToggle(); };
    const esc = (e) => e.key === "Escape" && onToggle();
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", esc); };
  }, [open, onToggle]);

  if (hidden) return null;

  return (
    <div className="relative" data-header-popover>
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-label={label}
        title={label}
        aria-expanded={open}
        style={{ color: open ? P.brassText : P.muted, padding: 9 }}
        className="relative inline-flex items-center justify-center rounded-lg"
      >
        <Icon size={15} />
        {dot && !open && (
          <span
            aria-hidden
            style={{ position: "absolute", top: 5, right: 5, width: 7, height: 7, borderRadius: "50%", background: P.brass }}
          />
        )}
      </button>
      {open && (
        <div
          data-popover
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 60,
            width: "min(420px, calc(100vw - 32px))", maxWidth: "none",
            maxHeight: "70vh", overflowY: "auto",
            background: P.surface, borderRadius: R.panel, boxShadow: elev(3), padding: 4,
          }}
        >
          {badge && (
            <div style={{ color: P.faint }} className="text-xs px-4 pt-3">{badge} done</div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/* ================= the menu =================
   Everything you reach occasionally rather than live in: the two sections that
   came off the dock, your account, and the three documents anyone handing a
   bookkeeping app their bank feed is entitled to read before they do.

   A sheet rather than a dropdown, because on a phone a dropdown anchored to a
   corner either runs off the screen or shrinks its own targets. */
function MenuSheet({ onClose, onGo, tab, setupPending }) {
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const Item = ({ icon: Icon, label, hint, onClick, active, dot }) => (
    <button
      onClick={onClick}
      style={{ background: active ? P.surface2 : "transparent", borderRadius: 16 }}
      className="w-full flex items-center gap-4 px-3 py-4 text-left press"
    >
      <span
        style={{ background: active ? P.brass : P.surface2, color: active ? P.onbrass : P.muted, borderRadius: 13 }}
        className="w-11 h-11 flex items-center justify-center shrink-0 relative"
      >
        <Icon size={19} />
        {dot && (
          <span aria-hidden style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: P.brass }} />
        )}
      </span>
      <span className="flex-1 min-w-0">
        <span style={{ color: P.text }} className="text-[17px] block">{label}</span>
        {hint && <span style={{ color: P.faint }} className="text-[14px] block truncate">{hint}</span>}
      </span>
      <ChevronRight size={16} style={{ color: P.faint }} className="shrink-0" />
    </button>
  );

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-stretch justify-end lg:items-start lg:p-4"
      style={{ background: P.overlay }}
      onClick={onClose}
    >
      {/* Full screen on a phone. A 320px card floating in a corner is a desktop
          shape: it wastes the screen, shrinks its own targets, and reads as an
          interruption rather than a place you have gone. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onClick={(e) => e.stopPropagation()}
        style={{ background: P.surface, boxShadow: elev(3) }}
        className="menu-panel w-full lg:max-w-sm overflow-y-auto"
      >
        <div
          className="flex items-center justify-between gap-3 px-5 pb-3 sticky top-0 z-10"
          style={{
            paddingTop: "max(18px, env(safe-area-inset-top))",
            background: P.surface,
            borderBottom: `1px solid ${P.line}`,
          }}
        >
          <h3 style={{ fontFamily: SERIF }} className="text-2xl lg:text-xl">Menu</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: P.surface2, color: P.text, borderRadius: 14 }}
            className="w-11 h-11 flex items-center justify-center shrink-0 press"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-2 pb-2">
          <Item icon={Landmark} label="Tax pack" hint="A year's figures, and every receipt behind them"
            active={tab === "taxpack"} onClick={() => onGo("taxpack")} />
          <Item icon={BarChart3} label="Reports" hint="Statements and exports for any period"
            active={tab === "reports"} onClick={() => onGo("reports")} />
          <Item icon={Plug} label="Connectors" hint="Bank feed and tax filing"
            active={tab === "integrations"} onClick={() => onGo("integrations")} />
        </div>

        <div className="px-5 pt-3 pb-1" style={{ borderTop: `1px solid ${P.line}` }}>
          <div style={{ color: P.faint }} className="text-[13.5px]">You</div>
        </div>
        <div className="px-2 pb-2">
          <Item icon={User} label="Profile" hint="Email, name, and password"
            active={tab === "profile"} onClick={() => onGo("profile")} />
          <Item icon={SettingsIcon} label="Settings" hint="Ledgers, appearance, and setup"
            active={tab === "settings"} onClick={() => onGo("settings")} dot={setupPending} />
        </div>

        <div className="px-5 pt-3 pb-1" style={{ borderTop: `1px solid ${P.line}` }}>
          <div style={{ color: P.faint }} className="text-[13.5px]">Your data</div>
        </div>
        <div className="px-2 pb-4">
          <Item icon={Shield} label="How your financial data is handled" hint="Bank access, storage, and who can see it"
            active={tab === "legal-data"} onClick={() => onGo("legal-data")} />
          <Item icon={FileText} label="Privacy policy"
            active={tab === "legal-privacy"} onClick={() => onGo("legal-privacy")} />
          <Item icon={FileText} label="Terms of use"
            active={tab === "legal-terms"} onClick={() => onGo("legal-terms")} />
        </div>
      </div>
    </div>
  );
}

/* The documents, in full, in the app.
   They used to be three summaries with a button to the website. Following that
   button left the app entirely, and in a home-screen install there was no way
   back: no browser chrome, and the site's own header sat under the status bar.
   Somebody reading a privacy policy should not end up stranded.

   The text comes from lib/legal.js, the same object the website is built from,
   so a correction cannot land in one place and not the other. */
function Prose({ html }) {
  // The source allows <strong>, <em> and <a href> and nothing else. It is our
  // own text, not user input, but it is still worth saying which tags are in
  // play so nobody later pipes something else through here.
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function LegalBlock({ block }) {
  if (block.p) {
    return <p style={{ color: P.muted }} className="text-[16px] leading-relaxed mb-3"><Prose html={block.p} /></p>;
  }
  if (block.ul) {
    return (
      <ul className="mb-3">
        {block.ul.map((li, i) => (
          <li key={i} className="flex gap-3 mb-2">
            <span aria-hidden style={{ background: P.brass, width: 6, height: 6, borderRadius: "50%", marginTop: 9 }} className="shrink-0" />
            <span style={{ color: P.muted }} className="text-[16px] leading-relaxed"><Prose html={li} /></span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.note) {
    return (
      <div style={{ background: P.surface2, borderRadius: 16 }} className="p-4 mb-4">
        <div style={{ color: P.text }} className="text-[16px] mb-1">{block.note.h}</div>
        <p style={{ color: P.muted }} className="text-[15.5px] leading-relaxed"><Prose html={block.note.p} /></p>
      </div>
    );
  }
  if (block.table) {
    /* A three-column table does not fit a phone, so on a narrow screen each row
       becomes a small stack of labelled lines. Same content, no sideways
       scrolling through a document someone is trying to read. */
    const { head, rows } = block.table;
    return (
      <div className="mb-4">
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>{head.map((h) => (
                <th key={h} style={{ color: P.faint, borderBottom: `1px solid ${P.line}` }}
                    className="text-left font-normal text-[14px] pb-2 pr-4">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => (
                  <td key={j} style={{ color: P.muted, borderTop: `1px solid ${P.line}` }}
                      className="align-top text-[15px] py-3 pr-4 leading-relaxed"><Prose html={c} /></td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sm:hidden">
          {rows.map((r, i) => (
            <div key={i} style={{ background: P.surface2, borderRadius: 14 }} className="p-4 mb-2">
              {r.map((c, j) => (
                <div key={j} className={j ? "mt-2.5" : ""}>
                  <div style={{ color: P.faint }} className="text-[13px] mb-0.5">{head[j]}</div>
                  <div style={{ color: P.muted }} className="text-[15px] leading-relaxed"><Prose html={c} /></div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

function LegalPage({ which }) {
  const doc = LEGAL[which];
  if (!doc) return null;
  return (
    <div className="space-y-6 stagger">
      <div className="max-w-2xl">
        <div className="eyebrow mb-1.5">{doc.kicker}</div>
        <h2 style={{ fontFamily: SERIF }} className="text-2xl leading-tight">{doc.title}</h2>
        <div style={{ color: P.faint }} className="text-[14px] mt-1">Last updated {LEGAL_UPDATED}</div>
        <p style={{ color: P.muted }} className="text-[16.5px] leading-relaxed mt-3">{doc.lede}</p>
      </div>

      {doc.sections.map((sec, i) => (
        <section key={sec.id} style={cardStyle()} className="p-5 max-w-2xl">
          {/* The first section of each document is its summary, so it does not
              repeat its own heading above the note it contains. */}
          {!(i === 0 && sec.blocks.length === 1 && sec.blocks[0].note) && (
            <h3 style={{ fontFamily: SERIF }} className="text-xl mb-2">{sec.h}</h3>
          )}
          {sec.blocks.map((b, j) => <LegalBlock key={j} block={b} />)}
        </section>
      ))}

      <p style={{ color: P.faint }} className="text-[14px] max-w-2xl leading-relaxed">
        Brasstally is developed by GENIE AI, Inc. in Ontario, Canada. This is the same text published at
        brasstally.com, so you can send someone the link instead of a screenshot.
      </p>
    </div>
  );
}

/* ================= the tax pack =================
   One page an accountant can be sent: the period's figures, the breakdown by
   tax line, and every receipt behind them in one list.

   It lives in the menu rather than inside Reports because it is a destination
   for someone who is not you. "Open the tax pack" is a sentence you can say to
   a bookkeeper; "go to Reports, pick a period, scroll to the fourth block" is
   not.

   Nothing here is a new calculation. Every figure comes from lib/tax.js, which
   is tested, so this page and a single receipt's breakdown can never disagree. */
function TaxPack({ data, month, openPreview, ledgerName }) {
  const YEARS = useMemo(() => {
    const ys = new Set((data.transactions || []).map((t) => (t.date || "").slice(0, 4)).filter(Boolean));
    ys.add(month.slice(0, 4));
    return [...ys].sort().reverse();
  }, [data.transactions, month]);

  const [year, setYear] = useState(month.slice(0, 4));
  const [quarter, setQuarter] = useState("all");   // all | q1..q4

  const inPeriod = (dateStr) => {
    if (!dateStr || dateStr.slice(0, 4) !== year) return false;
    if (quarter === "all") return true;
    const m = Number(dateStr.slice(5, 7));
    return m >= (Number(quarter[1]) - 1) * 3 + 1 && m <= Number(quarter[1]) * 3;
  };

  const txs = useMemo(
    () => (data.transactions || []).filter((t) => inPeriod(t.date) && !t.plExclude),
    [data.transactions, year, quarter]
  );

  const policy = useMemo(() => ({
    capitalThreshold: Number(data?.ledger?.capitalThreshold ?? TAX_POLICY.capitalThreshold),
    province: data?.ledger?.province || TAX_POLICY.province,
    gstRegistered: data?.ledger?.gstRegistered ?? TAX_POLICY.gstRegistered,
  }), [data?.ledger]);

  const sum = useMemo(() => summarise(txs, policy), [txs, policy]);

  /* The receipt vault. Every entry in the period with a file behind it, plus
     the ones without, because a deduction with no receipt is the thing an
     auditor asks about first and the gap should be visible here rather than
     discovered later. */
  const withDoc = txs.filter((t) => t.attachmentId);
  const withoutDoc = txs.filter((t) => !t.attachmentId && t.type === "expense");
  const missingTax = txs.filter((t) => t.type === "expense" && !t.taxAmount && t.taxCode !== "zero" && t.taxCode !== "exempt");

  const label = quarter === "all" ? year : `${quarter.toUpperCase()} ${year}`;

  const exportPack = () => {
    const rows = [
      ["Brasstally tax pack", ledgerName, label],
      [],
      ["Summary"],
      ["Revenue", sum.revenue.toFixed(2)],
      ["GST/HST collected on sales", sum.collected.toFixed(2)],
      ["Expenses, gross", sum.expensesGross.toFixed(2)],
      ["Deductible after credits and limits", sum.deductible.toFixed(2)],
      ["Input tax credits claimable", sum.itc.toFixed(2)],
      ["Net tax position (positive is owing)", sum.netTaxPosition.toFixed(2)],
      ["Meals and entertainment, gross", sum.mealsGross.toFixed(2)],
      ["Capitalised, not expensed", sum.capitalTotal.toFixed(2)],
      ["Paid from credit pools", sum.creditsPaid.toFixed(2)],
      [],
      ["By tax line"],
      ["GIFI", "Name", "Entries", "Gross", "Deductible", "Tax paid", "Credit claimable"],
      ...sum.lines.map((l) => [l.code, l.name, l.count, l.gross.toFixed(2), l.deductible.toFixed(2), l.tax.toFixed(2), l.itc.toFixed(2)]),
      [],
      ["Capital additions"],
      ["Description", "Amount", "CCA class", "Class name"],
      ...sum.capitalItems.map((c) => [c.description, Number(c.amount).toFixed(2), c.class, c.name]),
      [],
      ["Every entry"],
      ["Date", "Description", "Category", "Type", "Gross", "Tax", "Code", "Capital", "GIFI", "Deductible", "Credit", "Receipt"],
      ...txs.map((t) => {
        const d = deriveTreatment(t, policy);
        return [
          t.date, t.description, t.category, t.type,
          Number(t.amount).toFixed(2), Number(t.taxAmount || 0).toFixed(2), t.taxCode || "none",
          t.capital ? "yes" : "no", d.gifi.code, d.deductibleAmount.toFixed(2), d.recoverable.toFixed(2),
          t.attachmentName || (t.attachmentId ? "on file" : "MISSING"),
        ];
      }),
      [],
      ["Prepared by Brasstally from the entries in this ledger. Figures are a starting point for a preparer, not advice."],
      [`Capitalisation policy: assets of ${policy.capitalThreshold} or more with a useful life beyond one year are capitalised.`],
      [`GST/HST registered: ${policy.gstRegistered ? "yes" : "no"} · Province: ${policy.province}`],
    ];
    downloadCSV(`brasstally-tax-pack-${ledgerName.replace(/\s+/g, "-")}-${label.replace(/\s+/g, "-")}.csv`, rows);
  };

  const Figure = ({ label: l, value, tone, foot }) => (
    <div style={cardStyle()} className="p-5 min-w-0">
      <div style={{ color: P.text }} className="text-[15px] mb-2.5">{l}</div>
      <div style={{ fontFamily: MONO, color: tone || P.text }} className="text-[26px] k-fig tabular-nums leading-none truncate">
        {fmt0(value)}
      </div>
      {foot && <div style={{ color: P.faint }} className="text-[14px] mt-3 leading-snug">{foot}</div>}
    </div>
  );

  return (
    <div className="space-y-6 stagger">
      {/* The section already names itself in the page heading above, so this
          row carries only the action, pulled up in line with that heading. The
          same shape Snapshot uses for its customise control. */}
      <div className="flex items-center justify-end -mt-11">
        <button
          onClick={exportPack}
          style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
          className="h-11 px-4 text-[15px] font-medium inline-flex items-center gap-2 shrink-0 press"
        >
          <Download size={16} /> Export the pack
        </button>
      </div>

      <p style={{ color: P.muted }} className="text-[15px] max-w-xl">
        Everything a preparer needs for {label}, and every receipt behind it.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {YEARS.map((y) => (
          <button
            key={y}
            onClick={() => setYear(y)}
            style={{
              background: y === year ? P.brass : P.surface, color: y === year ? P.onbrass : P.muted,
              boxShadow: y === year ? "none" : elev(1), borderRadius: R.pill,
            }}
            className="px-4 py-2.5 text-[15px] font-medium press"
          >
            {y}
          </button>
        ))}
        <span style={{ width: 1, height: 24, background: P.line }} className="mx-1 hidden sm:block" />
        {[["all", "Full year"], ["q1", "Q1"], ["q2", "Q2"], ["q3", "Q3"], ["q4", "Q4"]].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setQuarter(k)}
            style={{
              background: k === quarter ? P.surface2 : "transparent",
              color: k === quarter ? P.text : P.faint, borderRadius: R.pill,
            }}
            className="px-3.5 py-2.5 text-[14.5px] press"
          >
            {l}
          </button>
        ))}
      </div>

      {txs.length === 0 ? (
        <EmptyState icon={FileText} title={`Nothing in ${label}`}>
          Entries dated in this period will show here with their tax treatment.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Figure label="Revenue" value={sum.revenue} tone={P.credit}
              foot={sum.collected > 0 ? `${fmt0(sum.collected)} of HST collected on it` : "no tax collected"} />
            <Figure label="Deductible expenses" value={sum.deductible} tone={P.debit}
              foot={`from ${fmt0(sum.expensesGross)} spent`} />
            <Figure label="Credits claimable" value={sum.itc} tone={P.credit}
              foot="GST/HST paid on business inputs" />
            <Figure
              label={sum.netTaxPosition >= 0 ? "Net tax owing" : "Net tax refundable"}
              value={Math.abs(sum.netTaxPosition)}
              tone={sum.netTaxPosition >= 0 ? P.debit : P.credit}
              foot="collected, less credits claimable"
            />
          </div>

          {sum.flags.length > 0 && (
            <div style={cardStyle()} className="p-5">
              <h3 style={{ fontFamily: SERIF }} className="text-xl mb-1">Before you send it</h3>
              <p style={{ color: P.muted }} className="text-[15px] mb-3">
                Not errors. The things a preparer would otherwise have to ask you about.
              </p>
              {sum.flags.map((f) => (
                <div key={f.text} className="flex items-start gap-3 py-2.5" style={{ borderTop: `1px solid ${P.line}` }}>
                  <span aria-hidden style={{ background: f.level === "warn" ? P.debit : P.brass, width: 7, height: 7, borderRadius: "50%", marginTop: 7 }} className="shrink-0" />
                  <span style={{ color: P.text }} className="text-[15px] leading-snug">{f.text}</span>
                </div>
              ))}
            </div>
          )}

          <div style={cardStyle()} className="p-5">
            <h3 style={{ fontFamily: SERIF }} className="text-xl mb-1">By tax line</h3>
            <p style={{ color: P.muted }} className="text-[15px] mb-4">
              Your categories, grouped onto the GIFI lines a T2 uses.
            </p>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 520 }}>
                <thead>
                  <tr style={{ color: P.faint }} className="text-[13.5px] text-left">
                    <th className="pb-2 font-normal">Line</th>
                    <th className="pb-2 font-normal text-right">Gross</th>
                    <th className="pb-2 font-normal text-right">Deductible</th>
                    <th className="pb-2 font-normal text-right">Tax paid</th>
                    <th className="pb-2 font-normal text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {sum.lines.map((l) => (
                    <tr key={l.code} style={{ borderTop: `1px solid ${P.line}` }}>
                      <td className="py-3 pr-3">
                        <span style={{ color: P.text }} className="text-[15px] block">{l.name}</span>
                        <span style={{ color: P.faint, fontFamily: MONO }} className="text-[13px]">
                          {l.code} · {l.count} {l.count === 1 ? "entry" : "entries"}
                        </span>
                      </td>
                      <td style={{ fontFamily: MONO, color: P.text }} className="py-3 text-right tabular-nums text-[15px]">{fmt0(l.gross)}</td>
                      <td style={{ fontFamily: MONO, color: P.text }} className="py-3 text-right tabular-nums text-[15px]">{fmt0(l.deductible)}</td>
                      <td style={{ fontFamily: MONO, color: P.faint }} className="py-3 text-right tabular-nums text-[15px]">{l.tax ? fmt0(l.tax) : "·"}</td>
                      <td style={{ fontFamily: MONO, color: l.itc ? P.credit : P.faint }} className="py-3 text-right tabular-nums text-[15px]">{l.itc ? fmt0(l.itc) : "·"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sum.capitalItems.length > 0 && (
              <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${P.line}` }}>
                <div style={{ color: P.text }} className="text-[15px] mb-2">Capital additions, for the CCA schedule</div>
                {sum.capitalItems.map((c, i) => (
                  <div key={i} className="flex justify-between gap-3 py-1.5 text-[14.5px]">
                    <span style={{ color: P.muted }} className="min-w-0 truncate">{c.description} · class {c.class}</span>
                    <span style={{ fontFamily: MONO, color: P.text }} className="tabular-nums shrink-0">{fmt0(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle()} className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
              <h3 style={{ fontFamily: SERIF }} className="text-xl">Receipts on file</h3>
              <span style={{ color: P.faint }} className="text-[14px]">
                {withDoc.length} of {txs.length} entries have one
              </span>
            </div>
            <p style={{ color: P.muted }} className="text-[15px] mb-4">
              Tap one to open it. The file is the evidence behind the deduction.
            </p>

            {withDoc.length === 0 && (
              <div style={{ color: P.faint }} className="text-[15px]">No files attached in this period yet.</div>
            )}
            {withDoc.map((t) => {
              const d = deriveTreatment(t, policy);
              return (
                <button
                  key={t.id}
                  onClick={() => openPreview(t.attachmentId, t.attachmentName, t)}
                  className="w-full flex items-center gap-3.5 py-3 text-left press"
                  style={{ borderTop: `1px solid ${P.line}` }}
                >
                  <span style={{ background: P.surface2, color: P.muted, borderRadius: 11 }}
                    className="w-11 h-11 flex items-center justify-center shrink-0">
                    <Paperclip size={17} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span style={{ color: P.text }} className="text-[15px] block truncate">{t.description}</span>
                    <span style={{ color: P.faint }} className="text-[13.5px] block truncate">
                      {t.date} · {d.gifi.code} {d.gifi.name}
                      {t.taxAmount ? ` · ${fmt0(t.taxAmount)} tax` : ""}
                      {t.capital ? ` · capital class ${d.capital?.class}` : ""}
                    </span>
                  </span>
                  <span style={{ fontFamily: MONO, color: t.type === "income" ? P.credit : P.text }}
                    className="tabular-nums text-[15px] shrink-0">
                    {fmt0(t.amount)}
                  </span>
                </button>
              );
            })}

            {(withoutDoc.length > 0 || missingTax.length > 0) && (
              <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${P.line}` }}>
                {withoutDoc.length > 0 && (
                  <div style={{ color: P.muted }} className="text-[14.5px] leading-snug mb-1.5">
                    {withoutDoc.length} {withoutDoc.length === 1 ? "expense has" : "expenses have"} no file attached,
                    {" "}{fmt0(withoutDoc.reduce((a, b) => a + b.amount, 0))} in total. A deduction without a receipt is
                    the first thing an auditor asks about.
                  </div>
                )}
                {missingTax.length > 0 && (
                  <div style={{ color: P.muted }} className="text-[14.5px] leading-snug">
                    {missingTax.length} {missingTax.length === 1 ? "entry has" : "entries have"} no tax recorded. Any
                    GST or HST on those is unclaimed until the amount is entered.
                  </div>
                )}
              </div>
            )}
          </div>

          <p style={{ color: P.faint }} className="text-[14px] leading-relaxed max-w-2xl">
            Prepared from the entries in this ledger. Figures are a starting point for you or your accountant, not
            advice. Your capitalisation policy: assets of {fmt0(policy.capitalThreshold)} or more with a useful life
            beyond one year are capitalised. GST/HST registered: {policy.gstRegistered ? "yes" : "no"}.
          </p>
        </>
      )}
    </div>
  );
}

/* Invoices, as two icons rather than two panels.

   The inbox and the link were stacked cards above AR / AP, which on a phone
   meant scrolling past both of them every visit to reach the thing you came
   for. They are buttons now: a tray with a count, and a link. Each opens a
   sheet, and only one is open at a time.

   Built narrow first. The sheet is full width on a phone and a panel on a
   desktop, and every control clears 44px, because this is the part of AR / AP
   most likely to be used standing up. */
/* 1st, 2nd, 3rd. "on the 3 of each month" reads as a placeholder somebody
   forgot to finish, and the teens are the reason this is not one line. */
const ordinal = (n) => {
  const v = Number(n) || 1;
  const suffix = ["th", "st", "nd", "rd"][(v % 100 - 20) % 10]
    || ["th", "st", "nd", "rd"][v % 100]
    || "th";
  return `${v}${suffix}`;
};

/* Money that arrived against an invoice you are owed.

   The reconciler pairs bank lines with entries you already made. Nobody
   paired a deposit with the invoice it settles, so a client who paid a
   fortnight ago still shows as owing and you chase them. A wrong figure is a
   correction; chasing somebody who has already paid costs the relationship.

   Proposed rather than applied. Settling writes income, and a bank line
   cannot tell you which invoice a round number was for. */
function ArrivedCard({ items, onApprove, onDismiss, busyId }) {
  if (!items.length) return null;
  const total = items.reduce((n, h) => n + Math.abs(h.bank.amount), 0);

  return (
    <section style={{ background: P.credit + "12", borderRadius: 20 }} className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 style={{ fontFamily: SERIF }} className="text-xl">
          {items.length === 1 ? "This looks like an invoice being paid" : "These look like invoices being paid"}
        </h3>
        <span style={{ fontFamily: MONO, color: P.credit }} className="text-[15.5px] tabular-nums">
          {fmt(total)}
        </span>
      </div>
      <p style={{ color: P.muted }} className="text-[15px] mb-1">
        Money arrived that matches what somebody owes you. Approving marks the invoice received and pairs it
        with the bank line.
      </p>

      {items.map((h) => (
        <div key={h.bank.id} className="py-3" style={{ borderTop: `1px solid ${P.line}` }}>
          <div className="flex items-baseline justify-between gap-3">
            <span style={{ color: P.text }} className="text-[15.5px] min-w-0 truncate">
              {h.obligation.party}
              {h.obligation.description ? (
                <span style={{ color: P.muted }}> &middot; {h.obligation.description}</span>
              ) : null}
            </span>
            <span style={{ fontFamily: MONO, color: P.credit }} className="text-[15.5px] tabular-nums shrink-0">
              {fmt(Math.abs(h.bank.amount))}
            </span>
          </div>
          <div style={{ color: P.faint }} className="text-[13.5px] mt-0.5">
            {h.bank.date} &middot; {(h.bank.description || "bank line").slice(0, 40)} &middot; {h.why}
          </div>
          {h.shortfall > 0 && (
            /* Named, not smoothed over. A payment that arrives short is
               usually a processor fee and occasionally a client deciding to
               pay less, and only you know which. Approving records what
               actually arrived. */
            <div style={{ color: P.debit }} className="text-[13.5px] mt-0.5">
              {fmt(h.shortfall)} less than the {fmt(Math.abs(h.obligation.amount))} invoiced, probably a
              fee. Approving records what arrived.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <button
              onClick={() => onApprove(h)}
              disabled={busyId === h.bank.id}
              style={{ background: P.credit, color: "#fff", borderRadius: R.pill }}
              className="h-11 px-4 text-[15px] font-medium press"
            >
              {busyId === h.bank.id ? "Marking" : "Mark it received"}
            </button>
            <button
              onClick={() => onDismiss(h)}
              disabled={busyId === h.bank.id}
              style={{ color: P.muted }}
              className="h-11 px-3 text-[15px] press"
            >
              Not this one
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

/* What an inbound invoice's state is called, in one place.
 *
 * Three lists spelled this out separately and all three ended with "set
 * aside" for anything unrecognised, so a withdrawn invoice was reported as
 * declined. Saying somebody's work was refused when they took it back
 * themselves is a small lie that reads as a large one.
 */
function inboundState(status) {
  if (status === "accepted") return "accepted";
  if (status === "pending") return "waiting on you";
  if (status === "declined") return "set aside";
  if (status === "withdrawn") return "withdrawn by them";
  return status || "unknown";
}

function InvoiceTools({ ledgerId, ledgerCurrency, openPreview, onAccept, onCount, onDeletePayable, onFindPayable, onFindOpenPayables, onConfirmVoid, contacts = [], trailing = null , onContactsChange }) {
  const [open, setOpen] = useState(null);            // "inbox" | "link" | null
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [links, setLinks] = useState([]);
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);            // what the last action did
  const [filed, setFiled] = useState(null);          // the row mid-flight, being filed
  const [voided, setVoided] = useState(null);        // the last one removed
  const [hint, setHint] = useState(null);            // which icon is naming itself
  const [mailing, setMailing] = useState(false);
  const [mailTo, setMailTo] = useState("");
  const [mailNote, setMailNote] = useState("");
  const [mailResult, setMailResult] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [invites, setInvites] = useState([]);
  const [saving, setSaving] = useState("");
  const [saved, setSaved] = useState(() => new Set());

  /* People who have sent you an invoice and are not in your contacts.
   *
   * Asking about this in the chat would interrupt, and would ask once per
   * invoice, which is the wrong number of times. Here it sits where the
   * invoices already are, batched, and can be ignored indefinitely without
   * anything nagging.
   *
   * Only senders who left an address, because a contact with no way to reach
   * them is an entry in a list rather than a contact. */
  const unknownSenders = useMemo(() => {
    const known = new Set(
      (contacts || []).flatMap((c) => [c.email, c.name].filter(Boolean).map((v) => v.toLowerCase().trim())),
    );
    const seen = new Map();
    for (const inv of [...pending, ...history]) {
      const email = String(inv.contactEmail || "").toLowerCase().trim();
      if (!email || known.has(email)) continue;
      if (known.has(String(inv.party || "").toLowerCase().trim())) continue;
      if (saved.has(email)) continue;
      if (!seen.has(email)) {
        seen.set(email, { email: inv.contactEmail, name: inv.party, count: 0 });
      }
      seen.get(email).count += 1;
    }
    return [...seen.values()];
  }, [contacts, pending, history, saved]);

  const saveSender = async (sender) => {
    setSaving(sender.email);
    const res = await contacts_add(ledgerId, {
      name: sender.name,
      email: sender.email,
      // Somebody who invoices you is a contractor or a vendor. Contractor is
      // the commoner case for an intake link, and it is one tap to change.
      role: "contractor",
    });
    setSaving("");
    if (res?.ok !== false) {
      setSaved((prev) => new Set(prev).add(sender.email.toLowerCase()));
      onContactsChange?.();
    }
  };

  /* What a foreign invoice is worth, before you decide about it.

     The row showed PKR 385,000.00 and nothing else, so the only way to learn
     whether that was three hundred dollars or three thousand was to press
     Accept and read the dialog. A decision needs the figure in front of it,
     not behind a button. */
  const [rates, setRates] = useState({});
  useEffect(() => {
    const wanted = [...new Set(
      [...pending, ...history]
        .map((i) => i.currency)
        .filter((c) => c && c !== ledgerCurrency),
    )];
    let alive = true;
    (async () => {
      for (const ccy of wanted) {
        if (rates[ccy]) continue;
        const hit = await lookupRate(ccy, ledgerCurrency);
        if (!alive || !hit) continue;
        setRates((prev) => ({ ...prev, [ccy]: hit }));
      }
    })();
    return () => { alive = false; };
    /* eslint-disable-next-line */
  }, [pending, history, ledgerCurrency]);
  const [showSent, setShowSent] = useState(false);
  const [openPerson, setOpenPerson] = useState("");

  /* One entry per person, with their requests and what answered them.

     The list was one row per event: every request, every invoice, and the
     person's address repeated on all of them. You deal with people, so a
     person is the unit, and the events sit underneath when you ask. */
  /* What an invoice is worth in your own currency.
   *
   * The group total was adding PKR to CAD and reporting $707,907.00, which is
   * not a sum of anything. A total across currencies is only a number if it
   * is converted first.
   *
   * Three sources, in descending order of truth: the payable it became, which
   * holds the rate actually used; today's rate, for one not yet accepted; and
   * failing both, nothing, because a guessed conversion in a total is worse
   * than a total that admits it is short. */
  /* The books' currency, resolved here rather than borrowed from below.
   *
   * `ledgerCcy` is declared much further down, inside the part of this
   * component that renders a single invoice. Reading it from a memo that runs
   * on every render reached it before it existed: "Cannot access ... before
   * initialization", and the whole app failed to render rather than one
   * section failing.
   *
   * The prop is the real source, so this reads the prop. */
  const booksCcy = ledgerCurrency || "CAD";

  const inLedgerCcy = (iv) => {
    const amount = Math.abs(Number(iv.amount) || 0);
    if (!iv.currency || iv.currency === booksCcy) return amount;

    const ob = iv.obligationId ? onFindPayable?.(iv.obligationId) : null;
    if (ob) return Math.abs(Number(ob.amount) || 0);

    const rate = rates[iv.currency]?.rate;
    return rate ? amount * rate : null;
  };

  const people = useMemo(() => {
    const by = new Map();
    for (const r of invites) {
      const key = (r.email || "").toLowerCase();
      if (!key) continue;
      if (!by.has(key)) {
        by.set(key, {
          email: r.email, name: r.name, requests: [], invoices: [],
          total: 0, unconverted: 0, live: 0,
        });
      }
      const p = by.get(key);
      if (!p.name && r.name) p.name = r.name;
      if (r.kind === "submission") {
        p.invoices.push(r);
        const worth = inLedgerCcy(r);
        if (worth == null) p.unconverted += 1;
        else p.total += worth;
      } else {
        p.requests.push(r);
        if (r.active) p.live += 1;
      }
    }
    return [...by.values()].sort((a, b) => {
      // Anyone still waiting on a reply first, then by how much has come in.
      const aw = a.requests.some((r) => r.active) ? 0 : 1;
      const bw = b.requests.some((r) => r.active) ? 0 : 1;
      return aw - bw || b.total - a.total;
    });
    /* eslint-disable-next-line */
  }, [invites, rates, booksCcy]);
  const [correcting, setCorrecting] = useState(null);
  const [reason, setReason] = useState("");

  const refresh = async () => {
    const [p, h, l, sc, iv] = await Promise.all([
      share.listInbound(ledgerId, "pending"),
      share.listInbound(ledgerId, "all"),
      share.listInvoiceLinks(ledgerId),
      share.listSchedules(ledgerId),
      share.listLinkInvites(ledgerId),
    ]);
    setPending(p); setHistory(h); setLinks(l); setSchedules(sc); setInvites(iv);
    onCount?.(p.length);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [ledgerId]);

  /* Faster while the tray is open, ordinary speed when it is not.
     Ten seconds costs six requests a minute and only while someone is looking
     at the thing those requests are about. Three seconds everywhere, which is
     what a blanket poll means, is twelve hundred an hour per open tab and a
     measurable amount of a phone's battery for a tray nobody is watching.

     If invoices still take ten seconds to appear, migration 0025 has not been
     run: that is what makes them arrive the instant they are submitted, and
     everything here is the floor underneath it. */
  useEffect(() => {
    if (!open) return;
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [open, ledgerId]);
  /* The panel closes when you close it, and not otherwise.

     It used to close itself two seconds after the queue emptied, which is a
     panel deciding it knows better than the person reading it. You accept an
     invoice and the thing you were looking at leaves while you are still
     looking at it.

     Clicking outside closes it, Escape closes it, pressing the icon again
     closes it. That is three ways, all of them yours. */
  const shell = useRef(null);
  useEffect(() => {
    if (!open) return;

    /* Where the gesture began, not only where it ended.

       Selecting a link by dragging past the edge of the panel releases
       outside it, and closing on that is the panel punishing you for
       reading. A gesture that started inside belongs to the panel wherever
       it finishes. */
    let startedInside = false;
    const down = (e) => {
      startedInside = Boolean(
        e.target?.isConnected &&
        (shell.current?.contains(e.target) || e.target.closest?.("[data-invoice-tools]")),
      );
    };

    const away = (e) => {
      const el = e.target;
      if (!shell.current || !el) return;
      if (startedInside) { startedInside = false; return; }

      /* Three things that are not "outside", and all three were closing it.

         A dialog, a preview or a confirm lives at the top of the document
         rather than inside this panel, so pressing a button in one looked
         like clicking away. Viewing an invoice closed the tray behind it,
         which is the opposite of what opening something should do.

         A node that has already left the page cannot be compared with
         anything. Pressing a button that removes its own row gives an event
         whose target is detached by the time this runs, and `contains` says
         false, so the panel closed under the mouse that was using it.

         And anything marked as belonging to this panel, wherever React chose
         to put it. */
      if (!el.isConnected) return;

      /* While anything is open on top, this panel is not the thing being
         dismissed. Checking the document rather than the event covers the
         backdrop too: clicking away from a preview should close the preview
         and leave what is underneath it alone. */
      if (document.querySelector("[role=dialog]")) return;

      if (el.closest?.("[data-invoice-tools], [data-popover]")) return;
      if (shell.current.contains(el)) return;

      setOpen(null);
    };

    /* On release, not on press.

       Pressing closes the moment a gesture begins, which sounds decisive and
       means a drag that starts inside and ends outside, or a text selection
       that runs past the edge, shuts the panel mid-action. */
    document.addEventListener("mousedown", down, true);
    document.addEventListener("touchstart", down, true);
    document.addEventListener("mouseup", away);
    document.addEventListener("touchend", away);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("touchstart", down, true);
      document.removeEventListener("mouseup", away);
      document.removeEventListener("touchend", away);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e) => e.key === "Escape" && setOpen(null);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);

  const first = links[0];
  /* Every link on the ledger has taken submissions, not just the general
     one, now that each recipient gets their own. */
  const totalReceived = links.reduce((n, l) => n + (l.submissions || 0), 0);

  /* An arrangement is shown separately only when it has nothing in the queue.
     Otherwise the invoice in the queue is the arrangement, as far as anyone
     looking at the screen is concerned. */

  /* One row per relationship.

     A monthly arrangement with Syed was three things on screen: the
     arrangement, the invoice it raised last month, and that invoice again in
     the history. All real, all different, and from the outside three copies
     of Syed.

     The history only shows what is not already represented above. An invoice
     belonging to an arrangement is that arrangement as far as anyone reading
     the page is concerned, so it is reachable from the row rather than listed
     beside it. */
  /* One row per thing, whatever kind of thing it is.

     There were two lists: what is waiting, and what has come in. A monthly
     arrangement appeared in the first and the invoice that created it in the
     second, so the same agreement with Syed occupied two lines that looked
     like duplicates because they were describing one relationship twice.

     Now it is one list. Every row is an invoice or an arrangement, labelled
     with what it is and what state it is in, sorted so the ones that need a
     decision are at the top. The kind is a label on the line, not a heading
     above a section. */
  const rows = useMemo(() => {
    const out = [];
    const claimed = new Set();

    /* An arrangement claims its invoices by link, and by likeness.

       The link is the right way and it is not always there: an invoice
       accepted before the schedule existed carries no schedule id, and the
       migration that backfills them may not have run. Depending on it meant
       the same agreement drew two rows and the interface had no idea they
       were related.

       So likeness is the fallback. Same party, same description, same amount
       is the same monthly agreement, because that is what a monthly
       agreement is. */
    const alike = (a, b) =>
      String(a.party || "").trim().toLowerCase() === String(b.party || "").trim().toLowerCase() &&
      String(a.description || "").trim().toLowerCase() === String(b.description || "").trim().toLowerCase() &&
      Math.abs(Math.abs(Number(a.amount) || 0) - Math.abs(Number(b.amount) || 0)) < 0.005;

    for (const sc of schedules) {
      const belongs = (h) => (h.scheduleId ? h.scheduleId === sc.id : alike(h, sc));
      const mine = history.filter(belongs);
      mine.forEach((h) => claimed.add(h.id));
      const waiting = pending.find(belongs);
      if (waiting) claimed.add(waiting.id);
      // The most recent one it raised, so merging loses nothing: the invoice
      // number, the attachment and the ability to void it all stay reachable.
      const last = mine
        .filter((h) => h.status === "accepted")
        .sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || "")))[0] || null;
      out.push({
        key: `sc-${sc.id}`,
        kind: "monthly",
        schedule: sc,
        invoice: waiting || null,
        last,
        accepted: mine.filter((h) => h.status === "accepted").length,
        party: sc.party,
        description: sc.description,
        amount: waiting ? waiting.amount : sc.amount,
        sortAt: waiting ? "0" : `1-${sc.party}`,
      });
    }

    /* Denied ones leave the list.

       Pressing Deny and watching the invoice stay on the page reads as the
       button not having worked. The three buttons are three different
       answers and the list should show three different things:

         Add to what I owe   it joins your books and moves below
         Needs correction    it stays at the top, still waiting
         Deny                it goes

       Nothing is destroyed. Denied invoices are behind the count at the
       bottom, because a supplier who was refused may well ask why, and an
       answer of "I cannot see it any more" is not one. */
    for (const inv of [...pending, ...history]) {
      if (claimed.has(inv.id)) continue;
      if (inv.status === "declined") { claimed.add(inv.id); continue; }
      claimed.add(inv.id);
      out.push({
        key: `inv-${inv.id}`,
        kind: inv.recurrence === "monthly" ? "monthly" : "once",
        schedule: null,
        invoice: inv,
        accepted: inv.status === "accepted" ? 1 : 0,
        party: inv.party,
        description: inv.description,
        amount: inv.amount,
        sortAt: inv.status === "pending" ? "0" : `2-${String(inv.submittedAt || "")}`,
      });
    }

    return out.sort((a, b) => a.sortAt.localeCompare(b.sortAt));
  }, [schedules, pending, history]);

  /* Three groups, because they need three different amounts of attention.

     Waiting on a decision, open in your books, and done. A settled invoice is
     finished business: it should be findable and it should not be occupying a
     row between two things that still need you. */
  const [settledOpen, setSettledOpen] = useState(false);
  const [expanded, setExpanded] = useState("");

  const grouped = useMemo(() => {
    const live = [];
    const done = [];
    for (const row of rows) {
      const inv = row.last || row.invoice;
      const ob = inv?.obligationId ? onFindPayable?.(inv.obligationId) : null;
      // An arrangement is never done: next month is always coming.
      if (ob && ob.status !== "open" && !row.schedule) done.push({ ...row, ob });
      else live.push(row);
    }
    return { live, done };
  }, [rows, onFindPayable]);

  // Refused, kept, and out of the way.
  const denied = useMemo(
    () => history.filter((h) => h.status === "declined"),
    [history],
  );
  const scheduleFor = (inv) => schedules.find((sc) => sc.id === inv.scheduleId) || null;

  /* Has anything ever arrived? The history cannot answer that, because voiding
     deletes the row. The link counts every submission it has ever taken and
     nothing removes that, so it is the honest source. */
  const everReceived = links.some((l) => l.submissions > 0) || history.length > 0 || schedules.length > 0;

  /* Is this already on the books?

     A supplier who emails an invoice and also sends it through the link, or
     one whose monthly arrangement raised it while you entered it by hand,
     produces two payables for one debt. Nothing downstream catches that: it
     is two separate obligations with the same amount, and it is found when
     somebody pays twice.

     Matched on party and amount, within a month either way, and only against
     open payables: a settled one is a different month's bill. */
  const alreadyOwed = (inv) => {
    const want = String(inv.party || "").trim().toLowerCase();
    const amt = Math.abs(Number(inv.amount) || 0);
    return (onFindOpenPayables?.() || []).find((p) => {
      if (String(p.party || "").trim().toLowerCase() !== want) return false;
      if (Math.abs(Math.abs(Number(p.amount) || 0) - amt) > 0.005) return false;
      if (!p.dueDate || !inv.dueDate) return true;
      return Math.abs(new Date(p.dueDate) - new Date(inv.dueDate)) < 31 * 864e5;
    }) || null;
  };

  const accept = async (inv) => {
    /* A figure in another currency cannot go into the books at face value.

       The ledger has one currency and no exchange rates, so recording 1,250
       USD as 1,250 in a Canadian ledger overstates nothing visibly and
       misstates everything quietly, and it would be found at year end by an
       accountant rather than here.

       So it asks, prefilled with the invoiced figure, and whatever you enter
       is recorded with the original kept in the description. */
    /* Say so before it becomes a second bill, not after. */
    const twin = alreadyOwed(inv);
    if (twin) {
      const ok = await onConfirmVoid?.({
        title: `You already owe ${twin.party} ${fmt(Math.abs(twin.amount))}`,
        body: `That one is due ${twin.dueDate || "with no date"}${twin.description ? `, for ${twin.description}` : ""}. Accepting this adds a second payable for the same amount. If it is the same bill, deny this one instead.`,
        confirmLabel: "Add it anyway",
      });
      if (!ok) return;
    }

    if (foreign(inv)) {
      /* Fetched, not asked for.

         Typing a rate is the moment somebody reaches for whatever Google
         shows, which is a retail quote with a spread in it. The Bank of
         Canada figure is the one the CRA accepts for reporting, so it is
         offered filled in, with its source and date under the field, and it
         can be overwritten by anyone who knows better. */
      const fx = await lookupRate(inv.currency, ledgerCcy);
      const suggested = fx ? Math.abs(inv.amount) * fx.rate : null;

      const converted = await askAmount({
        title: `${inv.party} invoiced ${fmtIn(inv.amount, inv.currency, ledgerCcy)}`,
        body: fx
          ? `Your books are in ${ledgerCcy}. This is today's rate, ${fx.rate.toFixed(4)}, and you can change the figure if you were charged a different one.`
          : `Your books are in ${ledgerCcy}. What is this worth in ${ledgerCcy}? The original stays on the record either way.`,
        placeholder: fmt(suggested ?? inv.amount),
        prefill: suggested != null ? suggested.toFixed(2) : "",
        note: fx ? `${fx.source}${fx.on ? `, ${fx.on}` : ""}` : "",
        confirmLabel: "Add it",
      });
      if (converted == null) return;
      /* The original, the rate and the result.

         It recorded the original amount and nothing else, so a year later
         nobody could check the arithmetic or explain the figure to an
         accountant. The rate is what makes a conversion auditable, and it
         costs one division to work out. */
      const rate = inv.amount ? converted / Math.abs(inv.amount) : 0;
      /* Where the rate came from goes on the record with it. A conversion
         whose source is unknown is a number somebody has to defend from
         memory. */
      const via = fx && Math.abs(rate - fx.rate) < 0.00005 ? `, ${fx.source}` : "";
      inv = {
        ...inv,
        amount: converted,
        description:
          `${inv.description || "Invoice"} ` +
          `(${fmtIn(Math.abs(inv.amount), inv.currency, ledgerCcy)} at ${rate.toFixed(4)}${via} = ` +
          `${fmtIn(converted, ledgerCcy, ledgerCcy)})`,
      };
    }

    setBusy(inv.id);
    setErr("");
    const created = await onAccept({
      party: inv.party,
      description: inv.description || inv.invoiceNo || "Invoice",
      amount: inv.amount,
      dueDate: inv.dueDate || todayStr(),
      taxAmount: inv.taxAmount,
      attachmentId: inv.filePath,
      attachmentName: inv.invoiceNo ? `${inv.invoiceNo}.pdf` : `${inv.party} invoice`,
    });
    // Wait for the payable to reach the database before pointing at it.
    await created?.saved;
    const res = await share.decideInbound(inv.id, "accepted", created?.id);

    /* A monthly submission becomes an arrangement. It starts from next month,
       because the invoice in hand already covers this one. */
    if (res.ok && inv.recurrence === "monthly" && !inv.scheduleId) {
      /* Link the invoice back to the arrangement it started.

         It was not linked, so the accepted invoice and the arrangement it
         created were two unrelated rows as far as the interface could tell,
         and the same supplier appeared twice. */
      const made = await share.startSchedule(ledgerId, inv);
      if (made?.id) await share.attachToSchedule(inv.id, made.id);
    }
    // Tell whoever sent it. Fired without waiting: the books are already right.
    if (first?.token) share.notifySupplierDecision(first.token, inv.id, "accepted").catch(() => {});
    if (!res.ok) {
      setBusy("");
      setErr(`Added to what you owe, but the invoice could not be cleared from this list: ${res.error}`);
      return;
    }
    setBusy("");

    /* The row files itself before it leaves.
       It used to vanish and leave a sentence behind, which reads as the card
       having been deleted rather than filed. Now it turns into its own
       receipt for a moment, then goes, so the eye follows the thing it acted
       on instead of hunting for what changed. */
    setFiled({ id: inv.id, party: inv.party, amount: inv.amount, dueDate: inv.dueDate });
    setTimeout(() => {
      setFiled(null);
      refresh();
    }, 1400);
  };

  const decline = async (inv) => {
    setBusy(inv.id);
    const sch = scheduleFor(inv);
    if (first?.token) share.notifySupplierDecision(first.token, inv.id, "declined").catch(() => {});
    await share.decideInbound(inv.id, "declined");
    setBusy("");
    if (sch) {
      setVoided({ party: inv.party, amount: inv.amount, settled: false, schedule: sch, denied: true });
      setTimeout(() => setVoided(null), 12000);
      refresh();
      return;
    }
    setDone(`${inv.party} set aside. Nothing was added to your books.`);
    refresh();
  };

  /* Void removes the invoice everywhere: the submission, and the payable it
     created. The one case that cannot be undone quietly is a payable that has
     already been settled, because settling wrote a transaction and may have
     paired it to a bank line. That gets asked about rather than assumed, and
     the transaction is left alone either way: deleting a payment that has
     cleared the bank would put the books out by its amount. */
  const voidOne = async (inv) => {
    const payable = inv.obligationId ? onFindPayable?.(inv.obligationId) : null;
    const settled = payable && payable.status !== "open";

    if (settled) {
      const ok = await onConfirmVoid?.({
        title: `Void ${inv.party}, ${fmt(inv.amount)}?`,
        body: `This was marked paid${payable.settledOn ? ` on ${payable.settledOn}` : ""}. The invoice and the payable go. The transaction stays, because the money already moved and removing it would put your balance out by ${fmt(inv.amount)}.`,
        confirmLabel: "Void it",
      });
      if (!ok) return;
    }

    setBusy(inv.id);
    /* Before the row is deleted, and carrying what we already have, because
       after the delete there is nothing left to describe. */
    if (first?.token) {
      share.notifySupplierDecision(first.token, inv.id, "voided", {
        party: inv.party, amount: inv.amount, description: inv.description,
        invoiceNo: inv.invoiceNo, contactEmail: inv.contactEmail, recurrence: inv.recurrence,
      }).catch(() => {});
    }
    const r = await share.voidInbound(inv.id);
    if (r.obligationId) onDeletePayable?.(r.obligationId);
    setBusy("");
    /* Same shape as filing, in reverse. Voiding used to leave two sentences
       of explanation where a person wanted to see the thing disappear.

       If it came from a monthly arrangement, the offer to stop that comes
       with it. Voiding one month's invoice is not the same as cancelling the
       arrangement, and guessing either way is wrong: silently stopping it
       loses an agreement, silently continuing raises the same invoice again
       in four weeks. So it asks, once, where you just acted. */
    setVoided({
      party: inv.party,
      amount: inv.amount,
      settled,
      schedule: scheduleFor(inv),
    });
    setTimeout(() => setVoided(null), 12000);
    refresh();
  };

  /* Send it back with a reason. The invoice stays pending, because it is
     still an open question rather than a closed one, and the corrected
     version arrives as a new submission. */
  const requestCorrection = async (inv) => {
    if (!first?.token) return setErr("Create an intake link first.");
    setBusy(inv.id); setErr("");
    const r = await share.askForCorrection(first.token, inv.id, reason.trim());
    setBusy("");
    if (!r.ok) return setErr(r.error || "That did not send.");
    setCorrecting(null); setReason("");
    setDone(`Sent back to ${inv.party}. It stays here until the corrected one arrives.`);
  };

  const stopOne = async (sc) => {
    setBusy(sc.id);
    await share.stopSchedule(sc.id);
    setBusy("");
    setDone(`${sc.party} will not be raised again. Anything already in the tray is still there.`);
    refresh();
  };

  const createLink = async () => {
    setErr(""); setBusy("link");
    const r = await share.createInvoiceLink(ledgerId, null);
    setBusy("");
    if (!r.ok) return setErr(r.error || "That did not save.");
    refresh();
  };

  /* Checking by hand. The spin runs for a minimum of half a second whatever
     the network does, because a refresh that returns in 60ms looks like a
     button that ignored you. */
  const manualRefresh = async () => {
    setSpinning(true);
    const started = Date.now();
    await refresh();
    const left = 500 - (Date.now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    setSpinning(false);
  };

  /* Revoking one person, which now means something.

     Every recipient is emailed their own link, so turning one off stops that
     person and leaves everyone else working. When they all shared a token
     this button could not have existed honestly. */
  const revokeInvite = async (iv) => {
    /* Two different consequences wearing one button.

       Somebody invited from here holds a link of their own, so revoking stops
       them alone. Somebody who arrived through a link you pasted somewhere is
       on the general one, and turning that off stops everybody holding it.
       Saying "nobody else is affected" in the second case would be a lie. */
    const personal = iv.invited && links.filter((l) => l.id === iv.linkId).some((l) => l.label);
    if (!(await onConfirmVoid?.({
      title: `Revoke ${iv.email}?`,
      body: personal
        ? "Their link stops working immediately. Anything they have already sent stays in your books, and nobody else is affected."
        : "They are using your general link, so turning it off stops everyone who holds it, not just them. Anything already sent stays in your books.",
      confirmLabel: personal ? "Revoke it" : "Turn the link off",
    }))) return;
    setBusy(iv.id);
    await share.revokeInvoiceLink(iv.linkId);
    setBusy("");
    setDone(`${iv.email} can no longer send invoices through that link.`);
    refresh();
  };

  const sendLink = async () => {
    setBusy("mail"); setMailResult(null);
    const r = await share.emailInvoiceLink(first.token, mailTo.trim(), mailNote.trim());
    setBusy("");
    setMailResult(r);
    if (r.ok) { setMailTo(""); setMailNote(""); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share.invoiceLinkUrl(first.token, first.slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the link is on screen anyway */ }
  };

  /* An icon with its name underneath it on hover.
     `title` alone was doing this, badly: the browser tooltip takes a second to
     appear, renders in the operating system's font, and never appears at all
     on a phone. This one is instant and looks like the app. It is hidden on
     coarse pointers, where hovering is not a thing and the label beside the
     icons already says what the tray is. */
  const Tool = ({ id, icon: Icon, label, count }) => (
    <button
      onClick={() => { setOpen(open === id ? null : id); setDone(null); }}
      onMouseEnter={() => setHint(id)}
      onMouseLeave={() => setHint(null)}
      onFocus={() => setHint(id)}
      onBlur={() => setHint(null)}
      aria-label={label}
      aria-expanded={open === id}
      style={{
        background: open === id ? P.brass : P.surface,
        color: open === id ? P.onbrass : P.text,
        boxShadow: open === id ? "none" : elev(1),
        borderRadius: 14,
      }}
      className="relative w-11 h-11 flex items-center justify-center shrink-0 press"
    >
      <Icon size={18} />
      {hint === id && (
        <span
          role="tooltip"
          className="hint-bubble"
          style={{
            position: "absolute", top: "calc(100% + 7px)", left: "50%", transform: "translateX(-50%)",
            background: P.text, color: P.bg, borderRadius: 9, padding: "5px 9px",
            fontSize: 12.5, whiteSpace: "nowrap", zIndex: 30, pointerEvents: "none",
            boxShadow: elev(2),
          }}
        >
          {label}
        </span>
      )}
      {count > 0 && (
        <span
          style={{
            position: "absolute", top: -5, right: -5, minWidth: 19, height: 19, padding: "0 5px",
            borderRadius: 999, background: P.debit, color: "#fff",
            fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 0 2px ${P.bg}`,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );

  /* The ledger's own currency needs no label; anything else does.
     Writing "CAD" beside every figure on a Canadian ledger is noise, and
     writing nothing beside a figure that is not in dollars is a mistake
     waiting to be made at year end. */
  // Passed in. This component takes a ledger id, not the ledger, and reading
  // `data` here threw on render: AR / AP would not open at all.
  const ledgerCcy = ledgerCurrency || "CAD";
  const foreign = (inv) => inv.currency && inv.currency !== ledgerCcy;
  const withCcy = (inv) => fmtIn(inv.amount, inv.currency, ledgerCcy);

  /* One row, whatever it is describing.

     An arrangement, a waiting invoice, or one that has been dealt with. The
     kind is a label on the line rather than a heading over a section, which
     is what stops the same supplier appearing twice under two headings. */
  const Row = ({ row }) => {
    const inv = row.invoice;
    const sc = row.schedule;
    const pendingHere = inv?.status === "pending";
    const foreignHere = inv ? foreign(inv) : false;

    /* What this row has done, and what it will do next, in one line.
       An arrangement that has raised something says so with the invoice
       number, because "1 accepted" without naming it is a number you cannot
       act on. */
    const last = row.last;

    /* Whether the payable this became has been paid.

       The tray said "added to what you owe" forever, including after you had
       paid it, so the same bill looked open in one place and settled in
       another. They are one thread and the row should say where it ends. */
    const ob = (last || inv)?.obligationId ? onFindPayable?.((last || inv).obligationId) : null;
    const paid = ob && ob.status !== "open";

    /* Paid, part paid, or nothing yet.

       A monthly arrangement names the month it covers, because "Paid" on a
       bill that repeats leaves you asking which one. The month comes from the
       invoice's own due date rather than the day the money moved: a September
       invoice settled in October was still September's work. */
    const paidStamp = (() => {
      if (!ob) return null;
      const billed = Math.abs(Number(ob.amount) || 0);
      const already = Number(ob.paidAmount) || 0;
      const month = (last || inv)?.dueDate
        ? monthLabel(String((last || inv).dueDate).slice(0, 7))
        : "";
      const forMonth = row.kind === "monthly" && month ? ` · ${month}` : "";

      if (ob.status !== "open") return { full: true, label: `Paid${forMonth}` };
      if (already > 0.005) {
        return { full: false, label: `${fmt(already)} of ${fmt(billed)} paid${forMonth}` };
      }
      return null;
    })();

    const state = pendingHere
      ? "waiting on you"
      : sc
        ? [
            last
              ? `${last.invoiceNo || "last one"} ${paid ? `paid${ob.settledOn ? ` ${ob.settledOn}` : ""}` : "added to what you owe"}`
              : "nothing yet",
            `next on the ${ordinal(sc.dayOfMonth)}`,
          ].join(" · ")
        : inv?.status === "accepted"
          ? paid
            ? `paid${ob.settledOn ? ` ${ob.settledOn}` : ""}`
            : "added to what you owe"
          : "set aside";

    return (
      <div className="py-3.5" style={{ borderTop: `1px solid ${P.line}` }}>
        <div className="flex items-baseline justify-between gap-3">
          <span style={{ color: P.text }} className="text-[15.5px] min-w-0 truncate">
            {row.party}
            {row.description ? <span style={{ color: P.muted }}> &middot; {row.description}</span> : null}
            {row.kind === "monthly" && (
              <span
                style={{ background: P.brass + "24", color: P.brassText, borderRadius: 999 }}
                className="ml-2 px-2 py-0.5 text-[12px] font-medium whitespace-nowrap"
              >
                Monthly
              </span>
            )}
            {/* What has happened to the money.

                An invoice that has been paid looked exactly like one that had
                not, so the only way to find out was to go to AR / AP and look
                it up. The stamp says which, and for a part payment it says how
                much, because "part paid" without a figure is a question
                rather than an answer. */}
            {paidStamp && (
              <span
                style={{
                  background: (paidStamp.full ? P.credit : P.brass) + "24",
                  color: paidStamp.full ? P.credit : P.brassText,
                  borderRadius: 999,
                }}
                className="ml-2 px-2 py-0.5 text-[12px] font-medium whitespace-nowrap"
              >
                {paidStamp.label}
              </span>
            )}
          </span>
          <span
            style={{ fontFamily: MONO, color: pendingHere ? P.debit : P.faint }}
            className="text-[15.5px] tabular-nums shrink-0 whitespace-nowrap"
          >
            {/* Once it is in the books, the books' figure is the truth.

                A foreign invoice kept showing its original amount after being
                accepted, so the row said PKR 385,000.00 while the payable said
                $1,920.77. The original belongs underneath as history, not on
                top as the headline. */}
            {ob ? fmt(Math.abs(ob.amount)) : foreignHere ? fmtIn(row.amount, inv.currency, ledgerCcy) : fmt(row.amount)}
          </span>
        </div>

        {/* The conversion, at today's rate, with its source.

            An estimate rather than a commitment: nothing is written until you
            accept, and the dialog still lets you use the rate you were
            actually charged. */}
        {/* Before accepting: what it is worth, as an estimate.
            After: what it was, and the rate it came in at. */}
        {foreignHere && ob && (
          <div style={{ color: P.faint }} className="text-[13.5px] mt-0.5">
            {fmtIn(row.amount, inv.currency, ledgerCcy)} invoiced, at{" "}
            {(Math.abs(ob.amount) / Math.abs(row.amount)).toFixed(4)}
          </div>
        )}

        {foreignHere && !ob && rates[inv.currency] && (
          <div style={{ color: P.muted }} className="text-[13.5px] mt-0.5">
            about {fmt(Math.abs(row.amount) * rates[inv.currency].rate)} in {ledgerCcy}
            <span style={{ color: P.faint }}>
              {" "}&middot; {rates[inv.currency].rate.toFixed(4)}, {rates[inv.currency].source}
            </span>
          </div>
        )}

        <div style={{ color: P.faint }} className="text-[13.5px] mt-0.5">
          {inv?.invoiceNo ? `${inv.invoiceNo} · ` : ""}
          {inv?.dueDate ? `due ${inv.dueDate} · ` : ""}
          {state}
        </div>

        {inv?.lines?.length > 0 && pendingHere && (
          <div style={{ background: P.surface2, borderRadius: 12 }} className="mt-2 px-3 py-2">
            {inv.lines.map((l, k) => (
              <div key={k} className="flex items-baseline justify-between gap-3 py-0.5">
                <span style={{ color: P.muted }} className="text-[13.5px] min-w-0 truncate">
                  {l.description}
                  {Number(l.quantity) !== 1 && <span style={{ color: P.faint }}> &times;{l.quantity}</span>}
                </span>
                <span style={{ color: P.faint, fontFamily: MONO }} className="text-[13px] tabular-nums shrink-0">
                  {fmt(l.amount ?? (Number(l.quantity) || 1) * (Number(l.rate) || 0))}
                </span>
              </div>
            ))}
          </div>
        )}

        {inv?.note && inv.note !== "Raised automatically from a monthly arrangement" && (
          <p style={{ color: P.muted }} className="text-[14px] mt-1.5 leading-snug">{inv.note}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          {(inv || last)?.filePath && (
            <button
              onClick={() => {
                const f = inv || last;
                openPreview(f.filePath, f.invoiceNo || `${row.party} invoice`, f);
              }}
              style={{ color: P.brassText }}
              className="text-[14px] inline-flex items-center gap-1.5 press"
            >
              <Paperclip size={14} /> See the invoice
            </button>
          )}

          {pendingHere && (
            <>
              <button
                onClick={() => accept(inv)}
                disabled={busy === inv.id}
                style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
                className="h-11 px-4 text-[15px] font-medium press"
              >
                {busy === inv.id ? "Adding" : "Add to what I owe"}
              </button>
              <button
                onClick={() => { setCorrecting(correcting?.id === inv.id ? null : inv); setReason(""); }}
                disabled={busy === inv.id}
                style={{ background: P.surface2, color: P.text, borderRadius: R.pill }}
                className="h-11 px-4 text-[15px] font-medium press"
              >
                Needs correction
              </button>
              <button
                onClick={() => decline(inv)}
                disabled={busy === inv.id}
                style={{ color: P.debit }}
                className="h-11 px-3 text-[15px] font-medium press"
              >
                Deny
              </button>
            </>
          )}

          {sc && (
            <button
              onClick={() => stopOne(sc)}
              disabled={busy === sc.id}
              style={{ color: P.faint }}
              className="h-11 px-2 text-[14px] press"
            >
              Stop repeating
            </button>
          )}

          {!pendingHere && (inv || last) && (
            <button
              onClick={() => voidOne(inv || last)}
              disabled={busy === (inv || last).id}
              style={{ color: P.debit }}
              className="h-11 px-2 text-[14px] press"
            >
              Void
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={shell} data-invoice-tools>
      <div className="flex items-center gap-2">
        <Tool id="inbox" icon={Inbox} label="Invoices sent to you" count={pending.length} />
        <Tool id="link" icon={LinkIcon} label="Your intake link" />
        <span style={{ color: P.faint }} className="text-[14px] min-w-0 truncate">
          {pending.length
            ? `${pending.length} ${pending.length === 1 ? "invoice" : "invoices"} waiting`
            : "Invoices sent to you"}
        </span>

        {/* Whatever the section wants beside its icons: same line, far end.
            Rendered here rather than wrapped around this component, so an
            expanding panel below cannot squeeze the row and push them onto a
            line of their own. */}
        {trailing && (
          <span className="flex items-center gap-2 shrink-0 ml-auto">{trailing}</span>
        )}

        
      </div>

      {voided && (
        <div
          style={{ background: P.surface2, borderRadius: 14 }}
          className="flex items-start gap-3 p-3.5 mt-2 filed-pop"
        >
          <span
            aria-hidden
            style={{ background: P.debit + "1f", color: P.debit, borderRadius: 10 }}
            className="w-8 h-8 flex items-center justify-center shrink-0"
          >
            <Trash2 size={15} />
          </span>
          <span className="min-w-0">
            <span style={{ color: P.text }} className="text-[15px] block">
              {voided.party} {voided.denied ? "denied" : "voided"}, {fmt(voided.amount)}
            </span>
            <span style={{ color: P.muted }} className="text-[14px]">
              {voided.denied
                ? "Set aside. Nothing was added to your books."
                : voided.settled
                  ? "Gone from the list and from what you owe. The payment stays in your books."
                  : "Gone from the list and from what you owe."}
            </span>

            {voided.schedule && (
              <span className="flex flex-wrap items-center gap-2 mt-2">
                <span style={{ color: P.text }} className="text-[14px]">
                  This one repeats. Next on the {ordinal(voided.schedule.dayOfMonth)}.
                </span>
                <button
                  onClick={async () => {
                    await share.stopSchedule(voided.schedule.id);
                    setVoided(null);
                    setDone(`${voided.party} will not be raised again.`);
                    refresh();
                  }}
                  style={{ background: P.debit, color: "#fff", borderRadius: R.pill }}
                  className="h-9 px-3 text-[14px] font-medium press"
                >
                  Stop it too
                </button>
                <button
                  onClick={() => setVoided(null)}
                  style={{ color: P.muted }}
                  className="h-9 px-2 text-[14px] press"
                >
                  Keep it
                </button>
              </span>
            )}
          </span>
        </div>
      )}

      {done && !voided && (
        <div style={{ background: P.credit + "14", borderRadius: 14 }} className="p-3.5 mt-2">
          <span style={{ color: P.credit }} className="text-[14.5px]">{done}</span>
        </div>
      )}

      {open && (
        <div style={cardStyle()} className="p-5 mt-2">
          {open === "inbox" && (
            <>
              {/* The heading only exists while there is something under it.
                  "Nothing waiting" is a card that appears the moment you clear
                  the last one, so the reward for finishing is a box telling you
                  the box is empty. */}
              {(rows.length > 0 || denied.length > 0) && !filed && (
                <>
                  {/* Check for new ones, inside the thing it refreshes.

                  It sat on the icon row outside the panel, which put a control
                  for the tray next to two controls that open things, and left
                  it visible when the tray was shut and there was nothing to
                  refresh. */}
              <div className="flex items-start justify-between gap-3">
                <h3 style={{ fontFamily: SERIF }} className="text-xl">Invoices sent to you</h3>
                <button
                          onClick={manualRefresh}
                          onMouseEnter={() => setHint("refresh")}
                          onMouseLeave={() => setHint(null)}
                          onFocus={() => setHint("refresh")}
                          onBlur={() => setHint(null)}
                          aria-label="Check for new invoices"
                          disabled={spinning}
                          style={{ background: P.surface, color: P.text, boxShadow: elev(1), borderRadius: 14 }}
                          className="relative w-11 h-11 flex items-center justify-center shrink-0 press"
                        >
                          <RefreshCw size={17} className={spinning ? "spin-once" : undefined} />
                          {hint === "refresh" && (
                            <span
                              role="tooltip"
                              className="hint-bubble"
                              style={{
                                position: "absolute", top: "calc(100% + 7px)", right: 0,
                                background: P.text, color: P.bg, borderRadius: 9, padding: "5px 9px",
                                fontSize: 12.5, whiteSpace: "nowrap", zIndex: 30, pointerEvents: "none",
                                boxShadow: elev(2),
                              }}
                            >
                              Check for new invoices
                            </span>
                          )}
                        </button>
              </div>

              {/* Save the people who have been invoicing you.

                  Offered where the invoices are rather than in the chat: a
                  conversation would interrupt, and would ask once per invoice
                  instead of once per person. Ignorable indefinitely, and gone
                  the moment they are saved. */}
              {!filed && unknownSenders.length > 0 && (
                <div style={{ background: P.brass + "12", borderRadius: 16 }} className="p-3.5 mt-2 mb-1">
                  <div style={{ color: P.text }} className="text-[14.5px] mb-1">
                    {unknownSenders.length === 1
                      ? "Somebody has invoiced you who is not in your contacts"
                      : `${unknownSenders.length} people have invoiced you who are not in your contacts`}
                  </div>
                  {unknownSenders.map((sender) => (
                    <div key={sender.email} className="flex items-center gap-2 py-1">
                      <span style={{ color: P.muted }} className="text-[14px] flex-1 min-w-0 truncate">
                        {sender.name}
                        <span style={{ color: P.faint }} className="ml-2">{sender.email}</span>
                        {sender.count > 1 && <span style={{ color: P.faint }}> &middot; {sender.count} invoices</span>}
                      </span>
                      <button
                        onClick={() => saveSender(sender)}
                        disabled={saving === sender.email}
                        style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
                        className="h-9 px-3 text-[13.5px] font-medium shrink-0 press"
                      >
                        {saving === sender.email ? "Saving" : "Save as contact"}
                      </button>
                    </div>
                  ))}
                  <p style={{ color: P.faint }} className="text-[12.5px] mt-1 leading-snug">
                    Saved as a contractor, which you can change in Contacts. Saving one means you can invite
                    them by name later rather than retyping the address.
                  </p>
                </div>
              )}
                  <p style={{ color: P.muted }} className="text-[15px] mb-2">
                    One line each. Accepting adds it to what you owe; denying takes it off this list.
                  </p>
                </>
              )}

              {grouped.live.length === 0 && grouped.done.length === 0 && denied.length === 0 && !filed && (
                <div className="py-2 text-center">
                  <div
                    style={{ background: P.credit + "18", color: P.credit }}
                    className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                  >
                    <Check size={22} />
                  </div>
                  <div style={{ color: P.text }} className="text-[16px]">
                    {everReceived ? "All caught up" : "Nothing has come in yet"}
                  </div>
                  <div style={{ color: P.muted }} className="text-[14.5px] mt-1">
                    {everReceived
                      ? "Nothing is waiting on you."
                      : "Share your link and invoices will land here."}
                  </div>
                </div>
              )}

              {filed && (
                <div className="py-6 text-center filed-pop">
                  <div
                    style={{ background: P.credit, color: "#fff" }}
                    className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
                  >
                    <Check size={26} />
                  </div>
                  <div style={{ color: P.text }} className="text-[17px]">Filed</div>
                  <div style={{ color: P.muted }} className="text-[15px] mt-1">
                    {filed.party} &middot; {fmt(filed.amount)}
                    {filed.dueDate ? ` · due ${filed.dueDate}` : ""}
                  </div>
                  <div style={{ color: P.faint }} className="text-[14px] mt-1">Added to what you owe</div>
                </div>
              )}

              {!filed && grouped.live.map((row) => (
                <div key={row.key}>
                  <Row row={row} />
                  {/* Both have to exist.

                      `correcting?.id === row.invoice?.id` is true when both
                      are undefined, which is every arrangement row while
                      nothing is being corrected. The form then rendered and
                      read `row.invoice.id` off null.

                      Optional chaining makes a missing value quiet, and two
                      quiet values compare equal. That is the trap. */}
                  {row.invoice && correcting?.id === row.invoice.id && (
                    <div style={{ background: P.surface2, borderRadius: 14 }} className="p-3.5 mb-3">
                      <label style={{ color: P.muted }} className="text-[14px] block mb-1.5">
                        What needs changing
                      </label>
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="The amount is short by the GST"
                        style={{ background: P.surface, color: P.text, borderRadius: 13 }}
                        className="w-full h-11 px-3.5 text-[15px] outline-none border-none"
                      />
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <button
                          onClick={() => requestCorrection(row.invoice)}
                          disabled={busy === row.invoice.id || !row.invoice.contactEmail}
                          style={{
                            background: P.brass, color: P.onbrass, borderRadius: R.pill,
                            opacity: row.invoice.contactEmail ? 1 : 0.5,
                          }}
                          className="h-11 px-4 text-[15px] font-medium press"
                        >
                          {busy === row.invoice.id ? "Sending" : "Send it back"}
                        </button>
                        <button
                          onClick={() => { setCorrecting(null); setReason(""); }}
                          style={{ color: P.muted }}
                          className="h-11 px-2 text-[15px] press"
                        >
                          Cancel
                        </button>
                      </div>
                      {!row.invoice.contactEmail && (
                        <p style={{ color: P.debit }} className="text-[14px] mt-2 leading-snug">
                          They left no email address, so there is nobody to send this to. Deny it instead.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Refused, and still findable.

                  A supplier who was turned down may well ask why, and "I
                  cannot see it any more" is not an answer. They sit behind a
                  count rather than in the list, because a decision you have
                  already made is not work. */}
              {/* Done, and out of the way.

                  A settled invoice is finished business. It should be findable
                  and it should not occupy a row between two things that still
                  need you, so each one is a line and the detail is a tap
                  away. */}
              {!filed && grouped.done.length > 0 && (
                <div className="mt-3" style={{ borderTop: `1px solid ${P.line}` }}>
                  <button
                    onClick={() => setSettledOpen(!settledOpen)}
                    style={{ color: P.credit }}
                    className="text-[14.5px] py-2.5 press inline-flex items-center gap-1.5"
                    aria-expanded={settledOpen}
                  >
                    <Check size={13} />
                    {grouped.done.length} paid in full
                    <span style={{ color: P.faint }}>
                      &middot; {fmt(grouped.done.reduce((n, r) => n + Math.abs(r.ob?.amount || 0), 0))}
                    </span>
                    <ChevronDown
                      size={13}
                      style={{ transform: settledOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }}
                    />
                  </button>

                  {settledOpen && grouped.done.map((row) => (
                    <div key={row.key}>
                      {expanded === row.key ? (
                        <Row row={row} />
                      ) : (
                        <button
                          onClick={() => setExpanded(row.key)}
                          className="w-full flex items-baseline justify-between gap-3 py-2 text-left press"
                          style={{ borderTop: `1px solid ${P.line}` }}
                        >
                          <span style={{ color: P.muted }} className="text-[14px] min-w-0 truncate">
                            {row.party}
                            {(row.last || row.invoice)?.invoiceNo
                              ? ` · ${(row.last || row.invoice).invoiceNo}`
                              : ""}
                            {row.ob?.settledOn ? ` · paid ${row.ob.settledOn}` : ""}
                          </span>
                          <span
                            style={{ fontFamily: MONO, color: P.faint }}
                            className="text-[14px] tabular-nums shrink-0"
                          >
                            {fmt(Math.abs(row.ob?.amount || 0))}
                          </span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!filed && denied.length > 0 && (
                <details className="mt-3">
                  <summary style={{ color: P.faint }} className="text-[14px] cursor-pointer press">
                    {denied.length} denied
                  </summary>
                  <div className="mt-2">
                    {denied.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-baseline justify-between gap-3 py-2"
                        style={{ borderTop: `1px solid ${P.line}` }}
                      >
                        <span style={{ color: P.faint }} className="text-[14px] min-w-0 truncate">
                          {inv.party}
                          {inv.description ? ` · ${inv.description}` : ""}
                          {inv.invoiceNo ? ` · ${inv.invoiceNo}` : ""}
                        </span>
                        <span
                          style={{ fontFamily: MONO, color: P.faint }}
                          className="text-[14px] tabular-nums shrink-0"
                        >
                          {fmtIn(inv.amount, inv.currency, ledgerCcy)}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}

          {open === "link" && (
            <>
              <div className="flex items-start justify-between gap-3">
                <h3 style={{ fontFamily: SERIF }} className="text-xl">Let them send it to you</h3>
                <button
                          onClick={manualRefresh}
                          onMouseEnter={() => setHint("refresh")}
                          onMouseLeave={() => setHint(null)}
                          onFocus={() => setHint("refresh")}
                          onBlur={() => setHint(null)}
                          aria-label="Check for new invoices"
                          disabled={spinning}
                          style={{ background: P.surface, color: P.text, boxShadow: elev(1), borderRadius: 14 }}
                          className="relative w-11 h-11 flex items-center justify-center shrink-0 press"
                        >
                          <RefreshCw size={17} className={spinning ? "spin-once" : undefined} />
                          {hint === "refresh" && (
                            <span
                              role="tooltip"
                              className="hint-bubble"
                              style={{
                                position: "absolute", top: "calc(100% + 7px)", right: 0,
                                background: P.text, color: P.bg, borderRadius: 9, padding: "5px 9px",
                                fontSize: 12.5, whiteSpace: "nowrap", zIndex: 30, pointerEvents: "none",
                                boxShadow: elev(2),
                              }}
                            >
                              Check for new invoices
                            </span>
                          )}
                        </button>
              </div>
              <p style={{ color: P.muted }} className="text-[15px] mb-3">
                Send a contractor this link. Their invoice arrives in the tray, and becomes something you owe
                only when you accept it.
              </p>
              {first ? (
                <>
                  <div
                    style={{ background: P.surface2, borderRadius: 14, fontFamily: MONO }}
                    className="p-3 text-[13px] break-all"
                  >
                    {share.invoiceLinkUrl(first.token, first.slug)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <button
                      onClick={copy}
                      style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
                      className="h-11 px-4 text-[15px] font-medium press"
                    >
                      {copied ? "Copied" : "Copy the link"}
                    </button>
                    <button
                      onClick={() => { setMailing(!mailing); setMailResult(null); }}
                      style={{ background: P.surface2, color: P.text, borderRadius: R.pill }}
                      className="h-11 px-4 text-[15px] font-medium inline-flex items-center gap-2 press"
                    >
                      <Mail size={16} /> Email it
                    </button>
                    {/* The counter is the way in.

                        It read "6 received" and could not be pressed, so the
                        only number on the panel was the one that answered the
                        least useful question. Who holds the link matters more
                        than how many have used it, and both are behind this
                        now. */}
                    <button
                      onClick={() => setShowSent(!showSent)}
                      style={{ color: P.brassText }}
                      className="text-[14px] press inline-flex items-center gap-1.5"
                      aria-expanded={showSent}
                    >
                      {invites.length > 0
                        ? `${invites.length} invited · ${totalReceived} received`
                        : `${totalReceived} received`}
                      <ChevronDown
                        size={13}
                        style={{ transform: showSent ? "rotate(180deg)" : "none", transition: "transform .18s" }}
                      />
                    </button>
                  </div>

                  {/* Sending it, rather than copying it somewhere else to send.
                      A link that has to be pasted into another app is a link
                      that gets pasted with no context, and the supplier then
                      has to guess what it is. */}
                  {showSent && (
                      <div style={{ borderTop: `1px solid ${P.line}` }} className="mt-3 pt-3">
                        {invites.length === 0 ? (
                          <p style={{ color: P.muted }} className="text-[14px]">
                            Nobody has been invited and nothing has come in through this link yet.
                          </p>
                        ) : (
                          <>
                            {/* One line per person, opening onto their requests.

                                Nine rows for one contractor, with the
                                reference printed at both ends of each, is a
                                log rather than a list. You deal with people,
                                and each person is one line until you ask for
                                more. */}
                            {people.map((p) => (
                              <div key={p.email} style={{ borderTop: `1px solid ${P.line}` }}>
                                <button
                                  onClick={() => setOpenPerson(openPerson === p.email ? "" : p.email)}
                                  className="w-full flex items-center gap-3 py-2.5 text-left press"
                                  aria-expanded={openPerson === p.email}
                                >
                                  <span className="flex-1 min-w-0">
                                    <span style={{ color: P.text }} className="text-[14.5px] block truncate">
                                      {p.name || p.email}
                                    </span>
                                    <span style={{ color: P.faint }} className="text-[13px]">
                                      {p.requests.length
                                        ? `${p.requests.length} ${p.requests.length === 1 ? "request" : "requests"}`
                                        : "no request sent"}
                                      {p.invoices.length ? ` · ${p.invoices.length} received` : " · nothing back yet"}
                                      {p.live === 0 && p.requests.length ? " · all revoked" : ""}
                                    </span>
                                  </span>
                                  {(p.total > 0 || p.unconverted > 0) && (
                                    <span className="shrink-0 text-right">
                                      <span
                                        style={{ fontFamily: MONO, color: P.faint }}
                                        className="text-[13.5px] tabular-nums block"
                                      >
                                        {fmt(p.total)}
                                      </span>
                                      {p.unconverted > 0 && (
                                        <span style={{ color: P.faint }} className="text-[11.5px]">
                                          {p.unconverted} not converted
                                        </span>
                                      )}
                                    </span>
                                  )}
                                  <ChevronDown
                                    size={13}
                                    style={{
                                      color: P.faint,
                                      transform: openPerson === p.email ? "rotate(180deg)" : "none",
                                      transition: "transform .18s",
                                    }}
                                  />
                                </button>

                                {openPerson === p.email && (
                                  <div className="pb-2 pl-3">
                                    {p.requests.map((rq) => (
                                      <div key={rq.id} className="py-1.5">
                                        <div className="flex items-center gap-3">
                                          <span
                                            style={{
                                              fontFamily: MONO,
                                              color: rq.active ? P.brassText : P.faint,
                                              textDecoration: rq.active ? "none" : "line-through",
                                            }}
                                            className="text-[13px] flex-1 min-w-0 truncate"
                                          >
                                            {rq.reference || "request"}
                                            <span style={{ color: P.faint }} className="ml-2">
                                              {String(rq.sentAt).slice(0, 10)}
                                            </span>
                                          </span>
                                          {rq.active ? (
                                            <button
                                              onClick={() => revokeInvite(rq)}
                                              disabled={busy === rq.id}
                                              style={{ color: P.debit }}
                                              className="text-[13px] shrink-0 press"
                                            >
                                              {busy === rq.id ? "Revoking" : "Revoke"}
                                            </button>
                                          ) : (
                                            <span style={{ color: P.faint }} className="text-[12.5px] shrink-0">
                                              revoked
                                            </span>
                                          )}
                                        </div>

                                        {/* What answered this request, underneath it. */}
                                        {p.invoices.filter((iv) => iv.reference === rq.reference).map((iv) => (
                                          <div key={iv.id} className="flex items-baseline justify-between gap-3 pl-3 py-0.5">
                                            <span style={{ color: P.faint }} className="text-[12.5px] min-w-0 truncate">
                                              {iv.invoiceNo ? `${iv.invoiceNo} · ` : ""}
                                              {String(iv.sentAt).slice(0, 10)} · {inboundState(iv.status)}
                                            </span>
                                            <span className="shrink-0 text-right">
                                              {/* Yours first, theirs underneath.

                                                  You read this column to know
                                                  what things cost you, and a
                                                  figure in a currency you do
                                                  not keep books in cannot
                                                  answer that. */}
                                              <span
                                                style={{ fontFamily: MONO, color: P.faint }}
                                                className="text-[12.5px] tabular-nums block"
                                              >
                                                {inLedgerCcy(iv) == null ? "not converted" : fmt(inLedgerCcy(iv))}
                                              </span>
                                              {iv.currency && iv.currency !== ledgerCcy && (
                                                <span
                                                  style={{ fontFamily: MONO, color: P.faint }}
                                                  className="text-[11px] tabular-nums block"
                                                >
                                                  {fmtIn(iv.amount, iv.currency, ledgerCcy)}
                                                </span>
                                              )}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    ))}

                                    {/* Sent in without a request behind them. */}
                                    {p.invoices.filter((iv) => !iv.reference).length > 0 && (
                                      <div className="py-1.5">
                                        <span style={{ color: P.faint }} className="text-[13px]">
                                          through the general link
                                        </span>
                                        {p.invoices.filter((iv) => !iv.reference).map((iv) => (
                                          <div key={iv.id} className="flex items-baseline justify-between gap-3 pl-3 py-0.5">
                                            <span style={{ color: P.faint }} className="text-[12.5px] min-w-0 truncate">
                                              {iv.invoiceNo ? `${iv.invoiceNo} · ` : ""}
                                              {String(iv.sentAt).slice(0, 10)} · {inboundState(iv.status)}
                                            </span>
                                            <span className="shrink-0 text-right">
                                              {/* Yours first, theirs underneath.

                                                  You read this column to know
                                                  what things cost you, and a
                                                  figure in a currency you do
                                                  not keep books in cannot
                                                  answer that. */}
                                              <span
                                                style={{ fontFamily: MONO, color: P.faint }}
                                                className="text-[12.5px] tabular-nums block"
                                              >
                                                {inLedgerCcy(iv) == null ? "not converted" : fmt(inLedgerCcy(iv))}
                                              </span>
                                              {iv.currency && iv.currency !== ledgerCcy && (
                                                <span
                                                  style={{ fontFamily: MONO, color: P.faint }}
                                                  className="text-[11px] tabular-nums block"
                                                >
                                                  {fmtIn(iv.amount, iv.currency, ledgerCcy)}
                                                </span>
                                              )}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}

                            <p style={{ color: P.faint }} className="text-[13px] mt-2 leading-snug">
                              Each request has its own link, so revoking one stops that request and leaves the
                              others working. Anything that came through the general link is shared with
                              everyone holding it.
                            </p>
                          </>
                        )}
                      </div>
                    )}

                                      {mailing && (
                    <div style={{ background: P.surface2, borderRadius: 16 }} className="p-4 mt-3">
                      <label style={{ color: P.muted }} className="text-[14px] block mb-1.5">
                        Their email
                      </label>
                      <ContactPicker
                        value={mailTo}
                        onChange={setMailTo}
                        contacts={contacts}
                        field="email"
                        roles={["contractor", "vendor", "employee"]}
                        placeholder="accounts@contractor.ca"
                      />
                      <label style={{ color: P.muted }} className="text-[14px] block mt-3 mb-1.5">
                        A line for them, if you want one
                      </label>
                      <input
                        value={mailNote}
                        onChange={(e) => setMailNote(e.target.value)}
                        placeholder="For the September work"
                        style={{ background: P.surface, color: P.text, borderRadius: 13 }}
                        className="w-full h-11 px-3.5 text-[15px] outline-none border-none"
                      />
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <button
                          onClick={sendLink}
                          disabled={busy === "mail" || !mailTo.trim()}
                          style={{
                            background: P.brass, color: P.onbrass, borderRadius: R.pill,
                            opacity: busy === "mail" || !mailTo.trim() ? 0.5 : 1,
                          }}
                          className="h-11 px-4 text-[15px] font-medium press"
                        >
                          {busy === "mail" ? "Sending" : "Send it"}
                        </button>
                        <button
                          onClick={() => { setMailing(false); setMailResult(null); }}
                          style={{ color: P.muted }}
                          className="h-11 px-2 text-[15px] press"
                        >
                          Cancel
                        </button>
                      </div>
                      {mailResult && (
                        <p
                          style={{ color: mailResult.ok ? P.credit : P.debit }}
                          className="text-[14.5px] mt-3 leading-snug"
                        >
                          {mailResult.ok
                            ? `Sent to ${mailResult.to}. If they reply, it goes to your inbox.`
                            : mailResult.error}
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={createLink}
                  disabled={busy === "link"}
                  style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
                  className="h-11 px-4 text-[15px] font-medium press"
                >
                  {busy === "link" ? "Creating" : "Create a link"}
                </button>
              )}
              {err && <p style={{ color: P.debit }} className="text-[14px] mt-2">{err}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* Defined here, not inside ContactsPage.

   A component declared inside another is a new function on every render, so
   React unmounts and remounts it rather than updating it, and an input inside
   loses focus after every character typed. That is the bug where the cursor
   jumped out of the field each letter.

   This is the second time on this feature. The first was the correction form
   inside Row, which the handler check happened to catch. Nothing catches it
   here, so the rule is worth stating: if it renders an input, it does not get
   declared inside another component. */
function ContactField({ label, value, onChange, type, placeholder, id }) {
  return (
    <div>
      <label htmlFor={id} style={{ color: P.muted }} className="text-[14px] block mb-1.5">{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type || "text"}
        placeholder={placeholder}
        autoComplete="off"
        style={{ background: P.surface2, color: P.text, borderRadius: 13 }}
        className="w-full h-11 px-3.5 text-[15px] outline-none border-none"
      />
    </div>
  );
}

/* The list itself. Reached from the menu, because it is a place you set up
   once and then mostly meet through the pickers elsewhere. */
/* Everything that has passed between you and one person.
 *
 * The contact row held a name and an address, which is a rolodex rather than a
 * ledger. The question people actually bring to a contact is "what have I paid
 * them, and what is outstanding", and that was three screens away.
 *
 * Matched on name and address rather than by a stored link, because most of
 * this history predates contacts existing. An exact name match is the spine;
 * the address catches the rest.
 */
function ContactHistory({ contact, data, inbound, onClose, openPreview }) {
  const norm = (v) => String(v || "").trim().toLowerCase();
  const name = norm(contact.name);
  const email = norm(contact.email);

  const isTheirs = (party, addr) =>
    (name && norm(party) === name) || (email && addr && norm(addr) === email);

  const obligations = [
    ...(data.receivables || []).map((o) => ({ ...o, kind: "receivables" })),
    ...(data.payables || []).map((o) => ({ ...o, kind: "payables" })),
  ].filter((o) => isTheirs(o.party));

  const invoices = (inbound || []).filter((i) => isTheirs(i.party, i.contactEmail));

  const settledTxIds = new Set(obligations.map((o) => o.settledTxId).filter(Boolean));
  const payments = (data.transactions || [])
    .filter((t) => settledTxIds.has(t.id) || isTheirs(t.description))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const open = obligations.filter((o) => o.status === "open");
  const owed = open.reduce(
    (n, o) => n + (o.kind === "payables" ? 1 : -1)
      * Math.max(0, Math.abs(o.amount) - (Number(o.paidAmount) || 0)),
    0,
  );
  const paidToThem = payments
    .filter((t) => t.type === "expense")
    .reduce((n, t) => n + Math.abs(t.amount), 0);

  const Row = ({ left, right, sub, tone }) => (
    <div className="flex items-baseline justify-between gap-3 py-2" style={{ borderTop: `1px solid ${P.line}` }}>
      <span className="min-w-0">
        <span style={{ color: P.muted }} className="text-[14px] block truncate">{left}</span>
        {sub && <span style={{ color: P.faint }} className="text-[12.5px]">{sub}</span>}
      </span>
      <span
        style={{ fontFamily: MONO, color: tone || P.faint }}
        className="text-[14px] tabular-nums shrink-0"
      >
        {right}
      </span>
    </div>
  );

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={contact.name}
      panelClass="flex flex-col"
      panelStyle={{ maxHeight: "88vh" }}
    >
      <ModalBody className="overflow-y-auto min-h-0 flex-1">
        <div
          className="flex items-baseline justify-between gap-3 pb-3 sticky top-0 z-10"
          style={{ borderBottom: `1px solid ${P.line}`, background: P.surface }}
        >
          <span style={{ color: P.muted }} className="text-[15px]">
            {paidToThem > 0 ? `${fmt(paidToThem)} paid to them` : "Nothing paid yet"}
          </span>
          {Math.abs(owed) > 0.005 && (
            <span
              style={{ fontFamily: MONO, color: owed > 0 ? P.debit : P.credit }}
              className="text-[17px] tabular-nums"
            >
              {owed > 0 ? `${fmt(owed)} owed` : `${fmt(Math.abs(owed))} owed to you`}
            </span>
          )}
        </div>

        {open.length > 0 && (
          <div className="mt-4">
            <div style={{ color: P.text }} className="text-[15.5px] mb-1">Still open</div>
            {open.map((o) => (
              <Row
                key={o.id}
                left={o.description || (o.kind === "payables" ? "A bill" : "An invoice")}
                sub={`${o.kind === "payables" ? "you owe" : "owed to you"} · due ${o.dueDate || "no date"}${
                  (Number(o.paidAmount) || 0) > 0 ? ` · ${fmt(o.paidAmount)} of ${fmt(Math.abs(o.amount))} paid` : ""
                }`}
                right={fmt(Math.max(0, Math.abs(o.amount) - (Number(o.paidAmount) || 0)))}
                tone={o.kind === "payables" ? P.debit : P.credit}
              />
            ))}
          </div>
        )}

        {payments.length > 0 && (
          <div className="mt-4">
            <div style={{ color: P.text }} className="text-[15.5px] mb-1">Payments</div>
            {payments.map((t) => (
              <Row
                key={t.id}
                left={t.description || t.category}
                sub={`${t.date}${t.category && t.description ? ` · ${t.category}` : ""}`}
                right={`${t.type === "income" ? "+" : "−"}${fmt(t.amount)}`}
                tone={t.type === "income" ? P.credit : P.text}
              />
            ))}
          </div>
        )}

        {invoices.length > 0 && (
          <div className="mt-4">
            <div style={{ color: P.text }} className="text-[15.5px] mb-1">Invoices they sent</div>
            {invoices.map((i) => (
              <Row
                key={i.id}
                left={`${i.invoiceNo ? `${i.invoiceNo} · ` : ""}${i.description || "Invoice"}`}
                sub={`${String(i.submittedAt || "").slice(0, 10)} · ${
                  inboundState(i.status)
                }`}
                right={i.currency && i.currency !== (data.ledger.currency || "CAD")
                  ? `${i.currency} ${fmt(i.amount)}`
                  : fmt(i.amount)}
              />
            ))}
          </div>
        )}

        {!open.length && !payments.length && !invoices.length && (
          <p style={{ color: P.muted }} className="text-[15px] py-4">
            Nothing has passed between you yet. Anything you file against this name will show here.
          </p>
        )}

        {(open.length > 0 || payments.length > 0 || invoices.length > 0) && (
          <p style={{ color: P.faint }} className="text-[12.5px] mt-4">
            Matched on name and address, because most of this predates the contact being saved. An entry
            filed under a different spelling will not appear.
          </p>
        )}
      </ModalBody>
    </Modal>
  );
}

function ContactsPage({ ledgerId, contacts, onChanged, readOnly, data, inbound = [], openPreview , onConfirmVoid }) {
  /* Whose history is open. */
  const [historyFor, setHistoryFor] = useState(null);
  const [inviting, setInviting] = useState("");

  /* A failure belongs to the row that caused it.
   *
   * `setErr` writes into the add-and-edit form, which is closed while somebody
   * is pressing buttons on a list. So the invitation failed, said so into a
   * hidden element, and the button returned to its old label looking as though
   * nothing had happened at all. */
  const [rowErr, setRowErr] = useState({});
  const failRow = (id, message) => setRowErr((prev) => ({ ...prev, [id]: message }));
  const [invited, setInvited] = useState(() => new Set());

  /* Who already has a page, so the row offers the right control rather than
     inviting somebody who was invited last week. */
  const [portals, setPortals] = useState([]);
  const refreshPortals = useCallback(async () => {
    if (!ledgerId) return;
    setPortals(await share.listPortals(ledgerId));
  }, [ledgerId]);
  useEffect(() => { refreshPortals(); }, [refreshPortals]);
  const portalFor = (id) => portals.find((p) => p.contactId === id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "vendor", note: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? contacts.filter((c) =>
          c.name.toLowerCase().includes(needle) || (c.email || "").toLowerCase().includes(needle))
      : contacts;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, q]);

  const byRole = useMemo(() => {
    const out = new Map();
    for (const c of shown) {
      if (!out.has(c.role)) out.set(c.role, []);
      out.get(c.role).push(c);
    }
    return [...out.entries()].sort(
      (a, b) => CONTACT_ROLES.findIndex((r) => r.id === a[0]) - CONTACT_ROLES.findIndex((r) => r.id === b[0]),
    );
  }, [shown]);

  const blank = () => setForm({ name: "", email: "", phone: "", role: "vendor", note: "" });

  const save = async () => {
    setErr(""); setBusy(true);
    const r = editing
      ? await contacts_update(editing.id, {
          name: form.name.trim(), email: form.email.trim().toLowerCase() || null,
          phone: form.phone.trim() || null, role: form.role, note: form.note.trim() || null,
        })
      : await contacts_add(ledgerId, form);
    setBusy(false);
    if (!r.ok) return setErr(r.error || "That did not save.");
    setAdding(false); setEditing(null); blank();
    onChanged?.();
  };

  const remove = async (c) => {
    /* Deleting a contact leaves every entry that used them alone. The name
       was copied onto those rows when they were made, so nothing is orphaned
       and nothing silently changes in the books. */
    if (!(await askConfirm({
      title: `Remove ${c.name}?`,
      body: "Entries and invoices that already name them are untouched. This only takes them out of the list you pick from.",
      confirmLabel: "Remove",
    }))) return;
    await contacts_delete(c.id);
    onChanged?.();
  };


  return (
    <div className="space-y-5 stagger">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div />
        {!readOnly && (
          <button
            onClick={() => { setEditing(null); blank(); setAdding(!adding); setErr(""); }}
            style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
            className="h-11 px-4 text-[15px] font-medium shrink-0 press"
          >
            {adding ? "Cancel" : "Add a contact"}
          </button>
        )}
      </div>

      {(adding || editing) && (
        <section style={cardStyle()} className="p-5 max-w-2xl">
          <h3 style={{ fontFamily: SERIF }} className="text-xl mb-4">
            {editing ? `Edit ${editing.name}` : "New contact"}
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <ContactField id="c-name" label="Name" value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Acme Contracting" />
            <div>
              <label style={{ color: P.muted }} className="text-[14px] block mb-1.5">Role</label>
              <div className="flex flex-wrap gap-1.5">
                {CONTACT_ROLES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setForm((f) => ({ ...f, role: r.id }))}
                    title={r.hint}
                    style={{
                      background: form.role === r.id ? P.brass : P.surface2,
                      color: form.role === r.id ? P.onbrass : P.muted,
                      borderRadius: R.pill,
                    }}
                    className="h-11 px-3.5 text-[14.5px] font-medium press"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <ContactField id="c-email" label="Email" type="email" value={form.email}
              onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="ap@acme.ca" />
            <ContactField id="c-phone" label="Phone" value={form.phone}
              onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="Optional" />
          </div>
          <div className="mt-3">
            <ContactField id="c-note" label="A note, if you want one" value={form.note}
              onChange={(v) => setForm((f) => ({ ...f, note: v }))} placeholder="Framing and drywall" />
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button
              onClick={save}
              disabled={busy || !form.name.trim()}
              style={{
                background: P.brass, color: P.onbrass, borderRadius: R.pill,
                opacity: busy || !form.name.trim() ? 0.5 : 1,
              }}
              className="h-11 px-4 text-[15px] font-medium press"
            >
              {busy ? "Saving" : editing ? "Save" : "Add them"}
            </button>
            <button
              onClick={() => { setAdding(false); setEditing(null); blank(); setErr(""); }}
              style={{ color: P.muted }}
              className="h-11 px-2 text-[15px] press"
            >
              Cancel
            </button>
          </div>
          {err && <p style={{ color: P.debit }} className="text-[14.5px] mt-3">{err}</p>}
        </section>
      )}

      {contacts.length > 6 && (
        <label
          style={{ background: P.surface, boxShadow: elev(1), borderRadius: R.pill }}
          className="flex items-center gap-2.5 px-4 h-11 max-w-sm"
        >
          <Search size={16} style={{ color: P.faint }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find someone"
            style={{ background: "transparent", color: P.text }}
            className="flex-1 text-[15px] outline-none border-none"
          />
        </label>
      )}

      {contacts.length === 0 ? (
        <EmptyState icon={Users} title="Nobody here yet">
          Add the contractors, vendors and clients you deal with, and their names will be one tap away
          everywhere else.
        </EmptyState>
      ) : (
        byRole.map(([role, people]) => (
          <section key={role} style={cardStyle()} className="p-5">
            <h3 style={{ fontFamily: SERIF }} className="text-xl">{contacts_roleLabel(role)}</h3>
            <p style={{ color: P.muted }} className="text-[14.5px] mb-2">
              {CONTACT_ROLES.find((r) => r.id === role)?.hint}
            </p>
            {people.map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-3" style={{ borderTop: `1px solid ${P.line}` }}>
                <span
                  aria-hidden
                  style={{ background: P.surface2, color: P.muted, borderRadius: 11 }}
                  className="w-10 h-10 flex items-center justify-center shrink-0 text-[13px] font-semibold"
                >
                  {/* truncation-ok: initials, two letters by design. */}
                  {c.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase()}
                </span>
                <span className="flex-1 min-w-0">
                  <span style={{ color: P.text }} className="text-[15.5px] block truncate">{c.name}</span>
                  <span style={{ color: P.faint }} className="text-[13.5px] block truncate">
                    {[c.email, c.phone, c.note].filter(Boolean).join(" · ") || "No details"}
                  </span>
                  {/* Beneath the person it happened to, where somebody pressing
                      a button on their row is already looking. */}
                  {rowErr[c.id] && (
                    <span style={{ color: P.debit }} className="text-[13.5px] block mt-0.5">
                      {rowErr[c.id]}
                    </span>
                  )}
                </span>

                {/* Before Edit, and outside the readOnly guard.

                    Reading what has passed between you and somebody is not an
                    edit, and an accountant with read access has more reason to
                    want it than anyone. */}
                <button
                  onClick={() => setHistoryFor(c)}
                  style={{ color: P.brassText }}
                  className="h-11 px-2 text-[14px] shrink-0 press"
                >
                  History
                </button>

                {/* Their own page, by link rather than by account.

                    Only for somebody with an address, because there is nowhere
                    to send it otherwise, and the button would be a promise the
                    row cannot keep. */}
                {!readOnly && c.email && (() => {
                  const portal = portalFor(c.id);

                  /* Real buttons, and each says what pressing it does.

                     These were bare text that happened to be clickable, which
                     on a row full of other text reads as a label rather than a
                     control. And once somebody has an account, "send" is the
                     wrong word: the address already exists, so sending again
                     is a reminder rather than a first invitation. */
                  const Pill = ({ onClick, busy, label, tone }) => (
                    <button
                      onClick={onClick}
                      disabled={busy}
                      style={{
                        background: tone === "danger" ? "transparent" : P.surface2,
                        color: tone === "danger" ? P.debit : P.text,
                        border: tone === "danger" ? `1px solid ${P.line}` : "none",
                        borderRadius: R.pill,
                      }}
                      className="h-10 px-3.5 text-[13.5px] font-medium shrink-0 press"
                    >
                      {busy ? "Working" : label}
                    </button>
                  );

                  if (portal?.active) {
                    return (
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span
                          style={{ color: P.faint }}
                          className="text-[12.5px] hidden sm:inline"
                          title={portal.openedAt ? `Last opened ${String(portal.openedAt).slice(0, 10)}` : "Never opened"}
                        >
                          {portal.opens > 0 ? `${portal.opens} opens` : "unopened"}
                        </span>
                        <Pill
                          busy={inviting === c.id}
                          label={invited.has(c.id) ? "Sent again" : "Reinvite"}
                          onClick={async () => {
                            setInviting(c.id);
                            const res = await share.invitePortal(c.id);
                            setInviting("");
                            if (res?.ok) {
                              setInvited((prev) => new Set(prev).add(c.id));
                              failRow(c.id, "");
                            } else {
                              failRow(c.id, res?.error || "It did not send. Try again in a moment.");
                            }
                            refreshPortals();
                          }}
                        />
                        <Pill
                          tone="danger"
                          busy={inviting === c.id}
                          label="Turn off"
                          onClick={async () => {
                            if (!(await onConfirmVoid?.({
                              title: `Turn off ${c.name}'s account?`,
                              body: "Their address stops working immediately. Nothing they have sent you is affected, and you can turn it back on.",
                              confirmLabel: "Turn it off",
                            }))) return;
                            setInviting(c.id);
                            await share.setPortalActive(c.id, false);
                            setInviting("");
                            refreshPortals();
                          }}
                        />
                      </span>
                    );
                  }

                  if (portal && !portal.active) {
                    return (
                      <Pill
                        busy={inviting === c.id}
                        label="Turn account back on"
                        onClick={async () => {
                          setInviting(c.id);
                          await share.setPortalActive(c.id, true);
                          setInviting("");
                          refreshPortals();
                        }}
                      />
                    );
                  }

                  return (
                    <Pill
                      busy={inviting === c.id}
                      label="Send their account"
                      onClick={async () => {
                        setInviting(c.id);
                        const res = await share.invitePortal(c.id);
                        setInviting("");
                        if (res?.ok) {
                          setInvited((prev) => new Set(prev).add(c.id));
                          failRow(c.id, "");
                        } else {
                          failRow(c.id, res?.error || "It did not send. Try again in a moment.");
                        }
                        refreshPortals();
                      }}
                    />
                  );
                })()}

                {!readOnly && (
                  <>
                    <button
                      onClick={() => { setEditing(c); setAdding(false); setForm({
                        name: c.name, email: c.email || "", phone: c.phone || "", role: c.role, note: c.note || "",
                      }); }}
                      style={{ color: P.muted }}
                      className="h-11 px-2 text-[14px] shrink-0 press"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(c)}
                      style={{ color: P.debit }}
                      className="h-11 px-2 text-[14px] shrink-0 press"
                    >
                      Remove
                    </button>
                  </>
                )}
                {/* Rendered inside the returned tree, not after it. */}
      {historyFor && (
        <ContactHistory
          contact={historyFor}
          data={data}
          inbound={inbound}
          openPreview={openPreview}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
            ))}
          </section>
        ))
      )}
    </div>

  );
}

/* ================= contacts =================
   One input that is still an input.

   Everywhere a party or an address is asked for, you can type freely as
   before, and what you have typed narrows a list of people you already deal
   with. Choosing one fills the field. Nothing is forced: a name that is not
   in the list is still a valid answer, which matters because the first time
   you deal with anyone they are not in the list.

   The role sits beside the name in smaller type because it is what tells two
   similar entries apart, and it is the second thing you read rather than
   something you have to hunt for. */
function ContactPicker({
  value, onChange, contacts = [], field = "name", roles = null,
  placeholder, onPick, id, autoFocus,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);

  const matches = useMemo(
    () => contacts_matchContacts(contacts, value, { field, roles }),
    [contacts, value, field, roles],
  );

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const choose = (c) => {
    onChange(field === "email" ? (c.email || "") : c.name);
    onPick?.(c);
    setOpen(false);
  };

  /* Arrow keys and Enter, because a list that can only be clicked is a list
     that slows down the person who types quickly, which is the person filling
     in the same form for the tenth time. */
  const onKeyDown = (e) => {
    if (!open || !matches.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % matches.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); }
    else if (e.key === "Enter" && matches[active]) { e.preventDefault(); choose(matches[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        type={field === "email" ? "email" : "text"}
        inputMode={field === "email" ? "email" : undefined}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-autocomplete="list"
        style={{ background: P.surface2, color: P.text, borderRadius: 13 }}
        className="w-full h-11 px-3.5 text-[15px] outline-none border-none"
      />

      {open && matches.length > 0 && (
        <div
          role="listbox"
          data-popover
          style={{ background: P.surface, boxShadow: elev(3), borderRadius: 14, maxWidth: "none" }}
          className="absolute left-0 right-0 top-full mt-1.5 z-50 p-1 overflow-hidden"
        >
          {matches.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(c)}
              style={{ background: i === active ? P.surface2 : "transparent", borderRadius: 10 }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
            >
              <span className="flex-1 min-w-0">
                <span style={{ color: P.text }} className="text-[15px] block truncate">
                  {c.name}
                  <span style={{ color: P.faint }} className="text-[12.5px] ml-2">
                    {contacts_roleLabel(c.role)}
                  </span>
                </span>
                {(field === "email" ? c.email : c.email) && (
                  <span style={{ color: P.faint }} className="text-[13px] block truncate">{c.email}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= sharing and intake =================
   Two things the owner sets up once and mostly forgets: who can read this
   ledger, and the link a supplier uses to send an invoice in. Both live in
   Settings because both are configuration rather than daily work. */
function AccessCard({ ledger, contacts = [] }) {
  const [shares, setShares] = useState([]);
  const [links, setLinks] = useState([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");

  const refresh = async () => {
    setShares(await share.listShares(ledger.id));
    setLinks(await share.listInvoiceLinks(ledger.id));
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [ledger.id]);

  const invite = async () => {
    setErr(""); setBusy(true);
    const r = await share.inviteViewer(ledger.id, email);
    setBusy(false);
    if (!r.ok) return setErr(r.error || "That did not save.");
    /* Access is granted either way. If the note did not reach them, say so
       plainly rather than leaving you to discover it when they ask why they
       cannot see anything. */
    setErr(r.emailed ? "" : `Access granted, but the email did not send: ${r.emailError || "unknown reason"}. Tell them yourself.`);
    setEmail(""); refresh();
  };

  const newLink = async () => {
    setBusy(true);
    const r = await share.createInvoiceLink(ledger.id, null);
    setBusy(false);
    if (!r.ok) return setErr(r.error || "That did not save.");
    refresh();
  };

  const copy = async (token) => {
    try {
      await navigator.clipboard.writeText(share.invoiceLinkUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(""), 2000);
    } catch { /* clipboard blocked, the link is on screen anyway */ }
  };

  return (
    <>
      {/* min-w-0 on a grid child is the whole fix.
          A grid track sizes to its content by default, and this card holds an
          intake URL in a monospace face with nothing to break on. That one
          unbreakable string set the track's minimum width, the card grew past
          the screen, and every paragraph in it was cut off on the right.
          Nothing was wrong with the text. */}
      <section style={cardStyle()} className="p-5 min-w-0">
        <h3 style={{ fontFamily: SERIF }} className="text-xl">Who can read this ledger</h3>
        <p style={{ color: P.muted }} className="text-[15px] mb-4">
          Give your accountant the books without giving them the keys. They can read everything except your
          bank connection, and they cannot change or delete anything.
        </p>

        {shares.map((sh) => (
          <div key={sh.id} className="flex items-center gap-3 py-3" style={{ borderTop: `1px solid ${P.line}` }}>
            <span className="flex-1 min-w-0">
              <span style={{ color: P.text }} className="text-[15px] block truncate">{sh.email}</span>
              <span style={{ color: P.faint }} className="text-[13.5px]">
                Can read &middot; invited {String(sh.invitedAt).slice(0, 10)}
              </span>
            </span>
            <button
              onClick={async () => { await share.revokeShare(sh.id); refresh(); }}
              style={{ color: P.debit }} className="text-[14.5px] shrink-0 press"
            >
              Remove
            </button>
          </div>
        ))}

        <div className="flex flex-wrap gap-2 mt-4">
          <div className="flex-1 min-w-[220px]">
            <ContactPicker
              value={email}
              onChange={setEmail}
              contacts={contacts}
              field="email"
              roles={["accountant"]}
              placeholder="accountant@firm.ca"
            />
          </div>
          <button
            onClick={invite}
            disabled={busy || !email.trim()}
            style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill, opacity: busy || !email.trim() ? 0.5 : 1 }}
            className="h-11 px-4 text-[15px] font-medium shrink-0 press"
          >
            Give read access
          </button>
        </div>
        <p style={{ color: P.faint }} className="text-[13.5px] mt-2 leading-snug">
          Access is tied to that address. Nothing opens until they sign in with it, and removing them here
          closes it immediately.
        </p>
        {err && <p style={{ color: P.debit }} className="text-[14px] mt-2">{err}</p>}
      </section>

      <section style={cardStyle()} className="p-5 min-w-0">
        <h3 style={{ fontFamily: SERIF }} className="text-xl">Invoices sent to you</h3>
        <p style={{ color: P.muted }} className="text-[15px] mb-4">
          Send a contractor this link and their invoice arrives in your books. Nothing becomes a payable until
          you accept it, because anyone holding the link can submit.
        </p>

        {links.map((l) => (
          <div key={l.id} className="py-3" style={{ borderTop: `1px solid ${P.line}` }}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                style={{ color: P.text, fontFamily: MONO }}
                className="text-[13px] w-full break-all"
              >
                {share.invoiceLinkUrl(l.token, l.slug)}
              </span>
              <button onClick={() => copy(l.token)} style={{ color: P.brassText }} className="text-[14.5px] shrink-0 press">
                {copied === l.token ? "Copied" : "Copy"}
              </button>
              <button
                onClick={async () => { await share.revokeInvoiceLink(l.id); refresh(); }}
                style={{ color: P.debit }} className="text-[14.5px] shrink-0 press"
              >
                Turn off
              </button>
            </div>
            <div style={{ color: P.faint }} className="text-[13.5px] mt-1">
              {l.submissions} {l.submissions === 1 ? "invoice" : "invoices"} received
            </div>
          </div>
        ))}

        <button
          onClick={newLink}
          disabled={busy}
          style={{ background: links.length ? P.surface2 : P.brass, color: links.length ? P.text : P.onbrass, borderRadius: R.pill }}
          className="h-11 px-4 text-[15px] font-medium mt-4 press"
        >
          {links.length ? "Another link" : "Create a link"}
        </button>
        {links.length > 1 && (
          <p style={{ color: P.faint }} className="text-[13.5px] mt-2 leading-snug">
            One link each makes it obvious who sent what, and lets you turn off a single supplier without
            reissuing to everyone.
          </p>
        )}
      </section>
    </>
  );
}

/* ================= Settings =================
   Its own page rather than the account sheet in page clothes. Two cards over
   an Account section, which is the order the prototype puts them in and the
   order people look: which books am I in, how does it look, then who am I. */
function SettingsPage({ theme, setTheme, ledgers, ledger, onPickLedger, onNewLedger, onSignOut, onResetLedger, setup, readOnly, contacts = [] }) {
  const [pal, setPal] = useState(currentPalette);

  const applyPalette = (name) => {
    setPalette(name, theme);
    setPal(name);
  };

  return (
    <div className="space-y-6 stagger">
      <div>
        <h2 style={{ fontFamily: SERIF }} className="text-2xl">Settings</h2>
        <p style={{ color: P.muted }} className="text-[15px]">Ledgers, appearance, and your account.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section style={cardStyle()} className="p-5">
          <h3 style={{ fontFamily: SERIF }} className="text-xl">Ledgers</h3>
          <p style={{ color: P.muted }} className="text-[15px] mb-4">Business and personal stay separate books.</p>
          {(ledgers || []).map((l) => {
            const on = l.id === ledger.id;
            return (
              <button
                key={l.id}
                onClick={() => !on && onPickLedger(l)}
                style={{
                  background: on ? "transparent" : P.surface2,
                  border: `1.5px solid ${on ? P.brass : "transparent"}`,
                  borderRadius: 16,
                }}
                className="w-full flex items-center gap-3 p-4 mb-2 text-left"
              >
                <span className="flex-1 min-w-0">
                  <span style={{ color: P.text }} className="text-[16px] block truncate">{l.name}</span>
                  <span style={{ color: P.faint }} className="text-[14px]">
                    {l.kind === "personal" ? "Personal ledger" : "Business ledger"}
                  </span>
                </span>
                {on && (
                  <span
                    style={{ background: P.brass + "22", color: P.brassText, borderRadius: R.pill }}
                    className="text-[13.5px] px-2.5 py-1 shrink-0"
                  >
                    Open
                  </span>
                )}
              </button>
            );
          })}
          <button onClick={onNewLedger} style={{ color: P.brassText }} className="text-[15px] mt-1">
            + New ledger
          </button>
        </section>

        <section style={cardStyle()} className="p-5">
          <h3 style={{ fontFamily: SERIF }} className="text-xl">Appearance</h3>
          <p style={{ color: P.muted }} className="text-[15px] mb-4">Applies everywhere, including the landing page.</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {PALETTE_NAMES.map((name) => {
              const swatch = THEMES[name][theme === "dark" ? "dark" : "light"];
              const on = name === pal;
              return (
                <button
                  key={name}
                  onClick={() => applyPalette(name)}
                  aria-pressed={on}
                  style={{
                    background: on ? "transparent" : P.surface2,
                    border: `1.5px solid ${on ? P.brass : "transparent"}`,
                    borderRadius: 16,
                  }}
                  className="p-3 text-left"
                >
                  <span className="flex gap-1.5 mb-2.5">
                    {[swatch.brass, swatch.credit, swatch.debit].map((c, i) => (
                      <span key={i} aria-hidden style={{ background: c, width: 14, height: 14, borderRadius: "50%" }} />
                    ))}
                  </span>
                  <span style={{ color: P.text }} className="text-[15px] capitalize">{name}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-4 mt-5 pt-5" style={{ borderTop: `1px solid ${P.line}` }}>
            <div className="flex-1 min-w-0">
              <div style={{ color: P.text }} className="text-[16px]">Night theme</div>
              <div style={{ color: P.faint }} className="text-[14px]">Everyone starts on paper</div>
            </div>
            <button
              onClick={() => {
                /* Three states, not two: dark, light, and whatever the device
                   says. A phone that dims itself at sunset should take the app
                   with it, and somebody who wants it fixed can still fix it. */
                const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
                setTheme(next);
                setPalette(pal, next === "system" ? systemTheme() : next);
              }}
              role="switch"
              aria-checked={theme === "dark"}
              aria-label="Night theme"
              style={{
                width: 48, height: 28, borderRadius: 999, flexShrink: 0, position: "relative",
                background: theme === "dark" ? P.brass : P.surface2,
                border: `1px solid ${theme === "dark" ? P.brass : P.line}`,
                transition: "background .2s ease",
              }}
            >
              <span
                aria-hidden
                style={{
                  position: "absolute", top: 2, left: 2, width: 22, height: 22, borderRadius: "50%",
                  background: P.surface, boxShadow: elev(1),
                  transform: theme === "dark" ? "translateX(20px)" : "none",
                  transition: "transform .22s cubic-bezier(.2,.8,.2,1)",
                }}
              />
            </button>
          </div>
        </section>
      </div>

      {/* The checklist is about setting this ledger up, which is not a
          visitor's job. */}
      {!readOnly && setup}

      {/* Sharing and intake links belong to whoever owns the books. */}
      {!readOnly && (
        <>
          <h2 style={{ fontFamily: SERIF }} className="text-2xl mt-2">Access</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <AccessCard ledger={ledger} contacts={contacts} />
          </div>
        </>
      )}

      {/* Which build you are looking at. Two rounds were spent on a fix that
          was not deployed yet, on both sides of the conversation. */}
      <p style={{ color: P.faint, fontFamily: MONO }} className="text-[12.5px] mt-6">
        build {typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev"}
      </p>

      <h2 style={{ fontFamily: SERIF }} className="text-2xl mt-2">Account</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <section style={cardStyle()} className="p-5">
          <h3 style={{ fontFamily: SERIF }} className="text-xl">Membership</h3>
          <p style={{ color: P.muted }} className="text-[15px] mb-3">Where your plan stands.</p>
          <div className="flex items-center justify-between gap-3 py-2.5" style={{ borderTop: `1px solid ${P.line}` }}>
            <span className="text-[15px]">Plan</span>
            <span style={{ background: P.brass + "22", color: P.brassText, borderRadius: R.pill }} className="text-[13.5px] px-2.5 py-1">
              Early access
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5" style={{ borderTop: `1px solid ${P.line}` }}>
            <span className="text-[15px]">Ledgers</span>
            <span style={{ color: P.faint }} className="text-[15px]">Unlimited</span>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5" style={{ borderTop: `1px solid ${P.line}` }}>
            <span className="text-[15px]">Billing</span>
            <span style={{ color: P.faint }} className="text-[15px]">Nothing due</span>
          </div>
        </section>

        <section style={cardStyle()} className="p-5">
          <h3 style={{ fontFamily: SERIF }} className="text-xl">Danger zone</h3>
          <p style={{ color: P.muted }} className="text-[15px] mb-4">
            Resetting erases every entry in {ledger.name}. Your other ledgers are untouched.
          </p>
          <button
            onClick={onResetLedger}
            disabled={readOnly}
            style={{ background: P.surface2, color: readOnly ? P.faint : P.debit, borderRadius: R.pill, opacity: readOnly ? 0.5 : 1 }}
            className="w-full px-4 py-3 text-[15px] font-medium inline-flex items-center justify-center gap-2 mb-2"
          >
            <RotateCcw size={16} /> Reset this ledger
          </button>
          <button
            onClick={onSignOut}
            style={{ background: P.surface2, color: P.text, borderRadius: R.pill }}
            className="w-full px-4 py-3 text-[15px] font-medium inline-flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Sign out
          </button>
        </section>
      </div>
    </div>
  );
}

/* ================= Overview ================= */
/* ================= what wants you =================
   Three panels above the budget: what needs deciding, how close the month is to
   closed, and the reports worth keeping to hand. The prototype opened Snapshot
   with this, and it is the right thing to open with: a ledger's first question
   is not "what are the numbers" but "what am I supposed to do about them". */

const CLOSE_KEY = (m) => `close:${m}`;

function NeedsAttention({ data, insights, balance, consolidation, month, onGo, onAsk }) {
  const [exported, setExported] = useState(() => {
    try { return Boolean(window.localStorage.getItem(CLOSE_KEY(month))); } catch { return false; }
  });
  useEffect(() => {
    try { setExported(Boolean(window.localStorage.getItem(CLOSE_KEY(month)))); } catch {}
  }, [month]);

  const [pinned, setPinned] = useState(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem("pinned:reports") || "null");
      if (Array.isArray(raw)) return raw;
    } catch {}
    return ["Profit and loss", "Where the money went", "Cash calendar"];
  });
  const [pinning, setPinning] = useState(false);
  const PINNABLE = ["Profit and loss", "Where the money went", "Cash calendar", "Open books", "Credit pools", "Bank against books", "T2 GIFI draft"];
  const pin = (r) => {
    setPinned((cur) => {
      const next = cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r];
      try { window.localStorage.setItem("pinned:reports", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Everything below is derived from the ledger, not decoration. A step is done
  // because the books say so, which is the only way a checklist earns trust.
  const monthEnd = `${month}-31`;
  const openThisMonth = data.payables.filter((p) => p.status === "open" && p.dueDate && p.dueDate <= monthEnd);
  const overdue = data.receivables.filter((r) => r.status === "open" && r.dueDate && r.dueDate < todayStr());
  const bankOff = balance.source === "bank" && balance.delta != null && Math.abs(balance.delta) >= 0.01 && !consolidation?.settled;
  const poolsUnreviewed = (data.credits || []).length > 0 && !(data.transactions || []).some((t) => isCredits(t) && (t.date || "").startsWith(month));

  const steps = [
    { label: "Consolidate the bank", done: !bankOff, go: () => onGo("reconcile") },
    { label: `Settle ${monthLabel(month).split(" ")[0]} payables`, done: openThisMonth.length === 0, go: () => onGo("arap"), note: openThisMonth.length ? `${openThisMonth.length} left` : null },
    { label: "Chase what is overdue", done: overdue.length === 0, go: () => onGo("arap"), note: overdue.length ? `${overdue.length} overdue` : null },
    { label: "Review credit pools", done: !poolsUnreviewed, go: () => onGo("credits") },
    { label: "Export the statement", done: exported, go: () => onGo("reports") },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);

  const toneFor = (sev) => (sev === "alert" ? P.debit : sev === "warn" ? P.brass : P.faint);
  const decisions = insights.slice(0, 4);

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 mt-10 mb-4">
        <h2 style={{ fontFamily: SERIF }} className="text-xl">What wants you</h2>
        {decisions.length > 0 && (
          <button onClick={() => onAsk?.("What needs my attention this month?")} style={{ color: P.brassText }} className="text-base">
            See everything
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-4 stagger">
        {/* 1. what needs deciding */}
        <section style={cardStyle()} className="p-5">
          <h3 style={{ fontFamily: SERIF }} className="text-xl">Needs a decision</h3>
          <p style={{ color: P.muted }} className="text-sm mb-3">
            {decisions.length ? `${decisions.length} ${decisions.length === 1 ? "thing is" : "things are"} waiting on you.` : "Nothing is waiting on you."}
          </p>
          {decisions.length === 0 ? (
            <div style={{ color: P.faint }} className="text-sm">The books agree with the bank and nothing is overdue.</div>
          ) : decisions.map((i) => (
            <button
              key={i.id || i.title}
              onClick={() => onAsk?.(i.ask || i.title)}
              className="w-full flex items-start gap-2.5 py-2 text-left"
              style={{ borderTop: `1px solid ${P.line}` }}
            >
              <span aria-hidden style={{ background: toneFor(i.severity), width: 7, height: 7, borderRadius: "50%", marginTop: 6 }} className="shrink-0" />
              <span className="flex-1 min-w-0">
                <span style={{ color: P.text }} className="text-sm block">{i.title}</span>
                {i.detail && (
                  <span style={{ color: P.faint }} className="text-[13.5px] block leading-snug">{i.detail}</span>
                )}
              </span>
            </button>
          ))}
        </section>

        {/* 2. how close the month is to closed */}
        <section style={cardStyle()} className="p-5">
          <h3 style={{ fontFamily: SERIF }} className="text-xl">Closing {monthLabel(month).split(" ")[0]}</h3>
          <p style={{ color: P.muted }} className="text-sm mb-3">{doneCount} of {steps.length} done.</p>
          <div className="flex items-baseline gap-2 mb-2">
            <span style={{ fontFamily: MONO, color: pct === 100 ? P.credit : P.brassText }} className="text-2xl tabular-nums">{pct}%</span>
            <span style={{ color: P.faint }} className="text-xs">{pct === 100 ? "closed" : "on track"}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: P.surface2 }}>
            <div style={{ width: `${pct}%`, background: pct === 100 ? P.credit : P.brass }} className="h-full" />
          </div>
          {steps.map((st) => (
            <button
              key={st.label}
              onClick={st.go}
              className="w-full flex items-center gap-2 py-1.5 text-left text-sm"
              style={{ borderTop: `1px solid ${P.line}`, color: st.done ? P.faint : P.text }}
            >
              <span
                aria-hidden
                style={{
                  width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                  border: `1.5px solid ${st.done ? P.credit : P.line2}`,
                  background: st.done ? P.credit : "transparent",
                }}
              />
              <span className="flex-1 truncate">{st.label}</span>
              {st.note && <span style={{ color: P.faint, fontFamily: MONO }} className="text-xs shrink-0">{st.note}</span>}
            </button>
          ))}
        </section>

        {/* 3. the reports worth keeping to hand */}
        <section style={cardStyle()} className="p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 style={{ fontFamily: SERIF }} className="text-xl">Pinned</h3>
              <p style={{ color: P.muted }} className="text-sm mb-3">Reports you keep coming back to.</p>
            </div>
          </div>
          {pinned.map((r) => (
            <button
              key={r}
              onClick={() => onGo("reports")}
              className="w-full flex items-center gap-2 py-2 text-left text-sm"
              style={{ borderTop: `1px solid ${P.line}` }}
            >
              <span className="flex-1 truncate">{r}</span>
              <ChevronRight size={15} style={{ color: P.faint }} className="shrink-0" />
            </button>
          ))}
          {!pinning ? (
            <button onClick={() => setPinning(true)} style={{ color: P.brassText }} className="text-sm mt-2">
              + Pin a report
            </button>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PINNABLE.map((r) => {
                const on = pinned.includes(r);
                return (
                  <button
                    key={r}
                    onClick={() => pin(r)}
                    style={{ background: on ? P.brass : P.surface2, color: on ? P.onbrass : P.muted, borderRadius: R.pill }}
                    className="px-2.5 py-1 text-xs"
                  >
                    {r}
                  </button>
                );
              })}
              <button onClick={() => setPinning(false)} style={{ color: P.faint }} className="text-xs px-2 py-1">done</button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Overview({ data, monthTx, sums, setPlanned, month, insights = [], onAsk, balance, consolidation, onGo }) {
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
      <NeedsAttention
        data={data} insights={insights} balance={balance} consolidation={consolidation}
        month={month} onGo={onGo} onAsk={onAsk}
      />

      <div className="flex items-baseline justify-between gap-3 mt-8 mb-3">
        <h2 style={{ fontFamily: SERIF }} className="text-xl">Planned against actual</h2>
      </div>
      <div className="grid md:grid-cols-2 gap-6 stagger">
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
    warn: { color: P.brassText, Icon: AlertTriangle },
    info: { color: P.faint, Icon: Info },
  };

  return (
    <section className="mb-6">
      <div className="eyebrow mb-2.5 flex items-center gap-1.5">
        <Sparkles size={11} /> Worth a look
      </div>
      <div className="space-y-2.5">
        {shown.map((i, n) => {
          const { color, Icon } = TONE[i.severity] || TONE.info;
          return (
            <Reveal key={i.id} delay={Math.min(n + 1, 3)}>
              <div
                style={{
                  ...cardStyle(),
                  border: `1px solid ${i.severity === "alert" ? color + "66" : P.line}`,
                }}
                className="p-4 flex items-start gap-3"
              >
                <div
                  className="shrink-0 inline-flex items-center justify-center mt-0.5"
                  style={{ width: 26, height: 26, borderRadius: 8, background: color + "1f", color }}
                >
                  <Icon size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ color: P.text }} className="text-sm font-semibold">{i.title}</div>
                  <p style={{ color: P.muted }} className="text-xs mt-1">{i.detail}</p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <Btn tone="ghost" size="sm" onClick={() => onAsk?.(i.ask)}>
                      <MessageSquare size={12} /> Ask Tally
                    </Btn>
                    <button
                      type="button"
                      onClick={() => drop(i.id)}
                      style={{ color: P.faint, fontFamily: MONO }}
                      className="text-xs px-2 hover:opacity-70"
                    >
                      dismiss
                    </button>
                  </div>
                </div>
              </div>
            </Reveal>
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
    <div className="modal-overlay fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: elev(3), borderRadius: R.panel }}
        className="modal-panel w-full max-w-xl max-h-full flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${P.line}` }}>
          <div className="flex-1 min-w-0">
            <h3 style={{ fontFamily: SERIF }} className="text-xl truncate">{drill.category}</h3>
            <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">
              {monthLabel(month)} · {list.length} {list.length === 1 ? "entry" : "entries"} ·{" "}
              <span style={{ color: tone }}>{fmt(total)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-2" style={{ borderBottom: `1px solid ${P.line}` }}>
          <Segmented
            size="sm"
            value={sortBy}
            onChange={setSortBy}
            options={[{ value: "date", label: "By date" }, { value: "amount", label: "By amount" }]}
          />
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
            <EmptyState compact icon={Search} title="No matching entries">Nothing in this category matches that search.</EmptyState>
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
    <section style={cardStyle()} className="p-5">
      <div className="flex justify-between items-baseline mb-3">
        <h2 style={{ fontFamily: SERIF }} className="text-xl">{title}</h2>
        <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs">planned / actual</div>
      </div>
      <div className="space-y-3">
        {list.map((r) => {
          const pct = r.planned > 0 ? Math.min((r.actual / r.planned) * 100, 100) : r.actual > 0 ? 100 : 0;
          const over = type === "expense" && r.actual > r.planned;
          return (
            <div key={r.name} className="budget-row">
              <div className="flex justify-between text-sm mb-1 gap-3">
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
                {/* Spent first, then the budget it is measured against, on one
                    line and right aligned so the column of figures lines up
                    instead of wrapping under itself. */}
                <span style={{ fontFamily: MONO }} className="tabular-nums flex items-baseline gap-1.5 shrink-0 whitespace-nowrap">
                  <span style={{ color: over ? P.debit : P.text }} className="text-sm">{fmt0(r.actual)}</span>
                  <span style={{ color: P.faint }} className="text-sm">/</span>
                  {editing === r.name ? (
                    <input
                      autoFocus
                      defaultValue={r.planned}
                      onBlur={(e) => { setPlanned(type, r.name, parseFloat(e.target.value) || 0); setEditing(null); }}
                      onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                      style={{ background: P.bg, border: `1px solid ${P.brass}`, color: P.text, width: 66 }}
                      className="rounded px-1 text-right text-sm"
                    />
                  ) : (
                    <button onClick={() => setEditing(r.name)} style={{ color: P.faint }} className="text-sm" title="Edit planned amount">
                      {fmt0(r.planned)}
                    </button>
                  )}
                </span>
              </div>
              {/* A full track, so an empty category still reads as a category
                  with nothing spent rather than as a missing row. */}
              <div className="h-2 rounded-full overflow-hidden" style={{ background: P.surface2 }}>
                <div
                  style={{ width: `${Math.max(pct, r.actual > 0 ? 3 : 0)}%`, background: over ? P.debit : P.brass }}
                  className="h-full rounded-full"
                />
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

/* ================= Tally, the assistant =================
   One transcript, no modes. What you send decides what happens: a file or a
   line with money in it is read into a draft entry, anything else goes to the
   agent in lib/agent.js, which works the ledger with tools and can propose
   changes, never make them. Tally also speaks first, see `brief` and `nudge`. */

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
  propose_contact: "drafting a contact",
  propose_invoice_invite: "drafting an invitation",
  propose_invoice_link: "drafting an intake link",
  contacts: "looking up a contact",
  propose_obligation: "drafting a receivable / payable",
  propose_settle: "drafting a settlement",
  propose_budget: "drafting a budget",
  propose_anchor: "drafting a re-anchor",
  open_view: "finding the right screen",
};

/* Three choices in one card, lettered, with the reminder that typing is always
   an option.

   They used to be loose full-width buttons stacked in the transcript, which at
   three looked like three unanswered messages and at eight looked like a menu
   someone forgot to close. A card says these belong together and there are this
   many of them, which is the difference between a suggestion and a demand.

   Three is the ceiling on purpose. A fourth option is nearly always the one
   nobody reads, and the input below covers everything the list does not. */
function OptionCard({ options, onPick, title }) {
  if (!options?.length) return null;
  const LETTERS = ["A", "B", "C"];
  return (
    <div style={{ background: P.surface2, borderRadius: 16 }} className="mt-2 overflow-hidden">
      {title && (
        <div style={{ color: P.text }} className="text-[15px] font-medium px-4 pt-3.5 pb-1">{title}</div>
      )}
      {/* truncation-ok: three suggestions, chosen for being few. */}
      {options.slice(0, 3).map((q, i) => (
        <button
          key={q}
          type="button"
          onClick={() => onPick(q)}
          style={{ borderTop: i && !title ? `1px solid ${P.line}` : i ? `1px solid ${P.line}` : "none" }}
          className="w-full flex items-start gap-3 px-4 py-3.5 text-left press"
        >
          <span
            aria-hidden
            style={{ background: P.surface, color: P.faint, borderRadius: 8 }}
            className="w-6 h-6 shrink-0 flex items-center justify-center text-[12.5px] font-semibold mt-px"
          >
            {LETTERS[i]}
          </span>
          <span style={{ color: P.text }} className="text-[15px] leading-snug flex-1">{q}</span>
        </button>
      ))}
      <div style={{ color: P.faint, borderTop: `1px solid ${P.line}` }} className="text-[13.5px] px-4 py-2.5">
        Or just type below
      </div>
    </div>
  );
}

const DEFAULT_ASKS = [
  "Where did my money go this month?",
  "What's my cash position over the next 60 days?",
  "Is anything in my books off?",
];

function Capture({
  data, addTx, addAR, addSub, month, embedded, balance, openBooks, recon, consolidation, bankConns,
  insights = [], seed, onSeedUsed, guide, onGuideUsed, nudge, onNudgeUsed, brief, onBriefUsed, apply, onGo,
  onSettleFromReceipt, taxPolicy = TAX_POLICY,
  /* These were outside the brace, as a second and third argument. React calls
     a component with one object, so they were never passed and `contacts` was
     always the empty default. The tool ran, found nothing, and Tally said
     there was no address on file for a man whose address was on the screen.

     A prop silently defaulting is the quietest failure in React: nothing
     throws, nothing warns, the feature just behaves as if the data does not
     exist. */
  contacts = [], hasInvoiceLink = false, onRemind, waiting = 0,
}) {
  // A gap that's already been consolidated isn't news, opening the panel on a
  // ledger you reconciled yesterday should not greet you with it again.
  const drift = balance?.source === "bank" && balance.delta != null
    && Math.abs(balance.delta) >= 0.01 && !consolidation?.settled;
  /* One line, and it is the same length whether there is a problem or not.
     This used to be two paragraphs listing everything Tally can do, followed by
     up to five guide steps, followed by three more suggestions. Eleven things
     to read before you could say anything. A greeting that explains its own
     feature set is a greeting nobody finishes. */
  const opener = drift
    ? `The bank and the books disagree by ${fmt(balance.delta)}. Want me to walk it?`
    : "I keep your books. What do you need?";
  /* One conversation, wherever you opened it.

     It used to live in this browser's storage, so the phone and the desktop
     held two different conversations with the same bookkeeper, and a card
     drawn on one was invisible on the other while the message beside it said
     "the card is above".

     It is a table now, scoped to you and this ledger. An accountant reading
     shared books gets their own thread. */
  const [msgs, setMsgs] = useState([{ role: "assistant", text: opener }]);
  const [threadReady, setThreadReady] = useState(false);
  const seenIds = useRef(new Set());

  const [input, setInput] = useState("");
  // Empty when idle, otherwise the line shown under the transcript. One piece
  // of state instead of a boolean plus a mode to phrase it with.
  const [busy, setBusy] = useState("");
  // Which section's brief the agent is carrying, if any. Cleared when the user
  // moves on to something the guide has nothing to say about.
  const [guideId, setGuideId] = useState(null);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const greetedDrift = useRef(false);
  // The agent's own message history, in Anthropic shape. Separate from `msgs`,
  // which is what the panel draws, tool traffic belongs in one and not the other.
  const convo = useRef([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await chat.loadThread(data.ledger.id);
      if (!alive) return;
      if (Array.isArray(rows) && rows.length) {
        rows.forEach((m) => m._id && seenIds.current.add(m._id));
        setMsgs(rows);
      } else if (Array.isArray(rows)) {
        /* A new day, and nothing said in it yet.

           The opener is a summary rather than a greeting, because a
           bookkeeper who has been through your books overnight should lead
           with what she found. It is computed from the ledger, not asked of a
           model: it has to be right and it has to be instant, and a sentence
           about your own figures is not a thing worth waiting on a network
           for. */
          const brief = morningBrief();
          setMsgs([brief]);
          chat.appendMessage(data.ledger.id, brief).then((id) => { if (id) seenIds.current.add(id); });
      }
      // null means the load failed rather than the thread being empty, so the
      // opener stays and nothing is overwritten.
      setThreadReady(true);
    })();

    const stop = chat.watchThread(data.ledger.id, (m) => {
      // From another device. Ours are already on screen and carry the same id.
      if (!m._id || seenIds.current.has(m._id)) return;
      seenIds.current.add(m._id);
      setMsgs((prev) => [...prev, m]);
    });

    return () => { alive = false; stop(); };
    /* eslint-disable-next-line */
  }, [data.ledger.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  /* On screen straight away, and on the way to the other device.

     The insert is not awaited: a message should appear as it is typed, not
     after a round trip. The returned id is remembered so the realtime echo of
     our own message is ignored rather than drawn twice. */
  /* What she opens with, from the books.

     Five things she might mention, in the order they cost you money, and at
     most three of them. A summary that lists everything is a summary nobody
     reads. */
  const morningBrief = () => {
    const bits = [];
    const today = todayStr();

    const payables = (data.payables || []).filter((o) => o.status === "open" && o.dueDate && o.dueDate < today);
    const receivables = (data.receivables || []).filter((o) => o.status === "open" && o.dueDate && o.dueDate < today);
    // A week out, without reaching for a helper that does not exist here.
    const weekOut = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const dueSoon = (data.payables || []).filter(
      (o) => o.status === "open" && o.dueDate && o.dueDate >= today && o.dueDate <= weekOut,
    );

    if (waiting > 0) {
      bits.push(`**${waiting} ${waiting === 1 ? "invoice is" : "invoices are"} waiting on you** in AR / AP.`);
    }
    if (payables.length) {
      const t = payables.reduce((n, o) => n + Math.abs(o.amount), 0);
      bits.push(`**${fmt(t)} is overdue to pay**, across ${payables.length} ${payables.length === 1 ? "bill" : "bills"}.`);
    }
    if (receivables.length) {
      const t = receivables.reduce((n, o) => n + Math.abs(o.amount), 0);
      bits.push(`**${fmt(t)} is overdue to you**, across ${receivables.length}.`);
    }
    if (!payables.length && dueSoon.length) {
      const t = dueSoon.reduce((n, o) => n + Math.abs(o.amount), 0);
      bits.push(`${fmt(t)} falls due in the next week.`);
    }
    if (drift) {
      bits.push(`The bank and the books disagree by ${fmt(balance?.delta)}.`);
    }

    const text = bits.length
      ? `Morning. ${bits.slice(0, 3).join(" ")}`
      : "Morning. Nothing is overdue, nothing is waiting, and the bank agrees with the books.";

    return {
      role: "assistant",
      text,
      followUp: bits.length ? "What should I deal with first?" : "How did last month compare?",
    };
  };

  /* Built from what is actually true right now.

     Ordered by what it costs to ignore: money arriving that nobody has
     recorded first, then invoices waiting, then a bank that disagrees with
     the books, then chasing. The last two are always useful and sit at the
     bottom so they never crowd out something urgent. */
  const quickPrompts = useMemo(() => {
    const out = [];
    const overdueIn = (data?.receivables || []).filter(
      (o) => o.status === "open" && o.dueDate && o.dueDate < todayStr(),
    );

    if (waiting > 0) {
      out.push({
        label: `Review ${waiting} waiting ${waiting === 1 ? "invoice" : "invoices"}`,
        ask: "What invoices are waiting on me, and should I accept them?",
        icon: <Inbox size={13} />,
      });
    }
    /* Always offered.

       It was conditional on already having a link or a contact, which is
       exactly backwards: the person who has neither is the one who needs the
       prompt, and the card creates the link when there is none. A suggestion
       that only appears once you no longer need it is not a suggestion. */
    /* This one does not ask a question, it shows the list.

       Pressing it used to start a conversation: she asked who, you typed a
       name, she looked it up, and if the contact lived on the other ledger
       you went round again. Three turns to reach a list the app already has
       on screen.

       A prompt for a thing the app knows should produce the thing, not an
       enquiry about it. */
    out.push({
      label: "Email an invoice link",
      run: "pick-contact",
      icon: <Mail size={13} />,
    });
    if (drift) {
      out.push({
        label: "Explain the bank gap",
        ask: "Walk me through the gap between my bank balance and my books, line by line.",
        icon: <Landmark size={13} />,
      });
    }
    if (overdueIn.length) {
      out.push({
        label: `Chase ${overdueIn.length} overdue`,
        ask: "Which invoices are overdue to me, and who should I chase first?",
        icon: <FileClock size={13} />,
      });
    }
    if (out.length < 3) {
      out.push({
        label: "Where did the money go",
        ask: "Where did my money go this month, by category, with the biggest first?",
        icon: <TrendingUp size={13} />,
      });
    }
    return out.slice(0, 3);
  }, [waiting, hasInvoiceLink, contacts, drift, data?.receivables]);

  /* Whether it is your turn.

     The row was gated on a transcript of two messages or fewer, which was
     true on the day I wrote it and false from the moment the transcript
     started being stored. Yours has dozens, so it never appeared once.

     The right question is not how long the conversation is, it is whether you
     are being invited to speak: nothing typed, nothing in flight, and the last
     thing said was hers. */
  const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;
  const showPrompts =
    quickPrompts.length > 0 && !busy && !input.trim() && lastMsg && lastMsg.role !== "user";

  /* Who you could send an invoice request to, as a list rather than a
     question. Contacts with an address first, because they can be sent to in
     one more tap; everyone else is offered by name so the card can look the
     address up or you can type one. */
  const offerContacts = () => {
    const withEmail = (contacts || []).filter((c) => c.email);
    const withoutEmail = (contacts || []).filter((c) => !c.email);

    if (!contacts.length) {
      /* Contacts belong to a ledger, and somebody looking for a name they know
         they saved deserves to be told where it lives rather than that it does
         not exist. Syed on the business books is not missing, he is elsewhere. */
      push({
        role: "assistant",
        text:
          "Nobody is saved on this ledger. Contacts belong to one set of books, so anyone you added on your other ledger is there rather than here.\n\n" +
          "Tell me a name and an email and I will draw the invitation, or add them in Contacts first.",
      });
      return;
    }

    /* One picker at a time.

       Pressing the prompt three times produced three identical lists, because
       each press pushed a message and nothing checked whether the last one was
       still waiting to be answered. A question nobody has answered does not
       need asking again.

       An unanswered picker is reused: the transcript scrolls to it instead of
       growing. Once a choice is made it is marked used, so the next press
       offers a fresh one. */
    const openPicker = msgs.some((m) => m.pickContacts?.length && !m.pickUsed);
    if (openPicker) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }

    push({
      role: "assistant",
      text: "Who should it go to?",
      pickId: `pick-${Date.now()}`,
      pickContacts: [...withEmail, ...withoutEmail].slice(0, 8),
    });
  };

  const push = (m) => {
    setMsgs((prev) => [...prev, m]);
    if (threadReady) {
      chat.appendMessage(data.ledger.id, m).then((id) => { if (id) seenIds.current.add(id); });
    }
  };

  /* Say a thing once.

     The transcript survives a reload now, and everything that speaks
     unprompted speaks on mount, so the same unanswered sentence stacked up:
     three identical drift warnings, each with its own button, none of them
     newer than the last.

     If it is already in the transcript and nothing has been said since, this
     does not repeat it. The badge still lights, because the point is to
     remind you it is there, not to say it again. */
  const pushOnce = (m) => {
    const said = String(m.text || "");
    if (!said) return push(m);
    setMsgs((prev) => {
      if (prev.some((p) => p.role === "assistant" && p.text === said)) {
        // Already on the page. Nudge rather than repeat.
        onRemind?.();
        return prev;
      }
      if (threadReady) {
        chat.appendMessage(data.ledger.id, m).then((id) => { if (id) seenIds.current.add(id); });
      }
      return [...prev, m];
    });
  };

  /* Balances that start agreeing and then disagree deserve a word, once.

     "Once" was a ref, which lives for one mount. Every reload got a fresh one
     and said the same thing again, so an unchanged gap of $121.69 produced a
     new identical paragraph every time the app started. Seven reloads, seven
     warnings.

     It is remembered per ledger and per figure now. The same gap is silent
     forever; a different gap is news and speaks. */
  useEffect(() => {
    if (!drift) return;
    /* Keyed on the ledger and the figure, not on a storage key that no
         longer exists. The same gap stays quiet across every device, because
         a warning already sitting in the shared transcript does not need
         saying again on the phone. */
    const mark = `bt-drift:${data.ledger.id}:${balance?.delta}`;
    if (greetedDrift.current) return;
    try {
      if (localStorage.getItem(mark)) { greetedDrift.current = true; return; }
      localStorage.setItem(mark, "1");
    } catch { /* private mode, the ref still covers this session */ }
    greetedDrift.current = true;
    if (msgs.length <= 1) return; // the opener said it
    pushOnce({
      role: "assistant",
      text: `Your bank and your books just stopped agreeing: ${fmt(balance.bank)} against ${fmt(balance.book)}, a gap of ${fmt(balance.delta)}. Want me to walk it?`,
      followUp: "Walk me through the gap between my bank balance and my books, line by line.",
    });
  }, [drift]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tool calls collapse into a single activity line rather than one bubble each.
  const pushStep = (name) =>
    setMsgs((prev) => {
      const last = prev[prev.length - 1];
      if (last?.steps) return [...prev.slice(0, -1), { ...last, steps: [...last.steps, name] }];
      return [...prev, { role: "assistant", steps: [name] }];
    });

  const runTurn = async (question, useGuide = guideId) => {
    setBusy("working through the ledger…");
    const before = convo.current;
    const history = trimHistory([...before, { role: "user", content: question }]);
    try {
      const { text, messages } = await runAgent({
        history,
        // Rebuilt every turn from live state, so the agent reads what's on screen.
        /* Rebuilt every turn from live state. Contacts and whether an intake link
           exists are here because both new tools check before proposing: one so
           it does not offer to add somebody twice, the other because inviting a
           supplier through a link that does not exist is a dead end. */
        ctx: {
          data, balance, month, bankConns, recon, consolidation, guide: useGuide,
          contacts, hasInvoiceLink,
        },
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
    setBusy("");
  };

  // `withGuide` is passed explicitly by the guide's own step buttons: setState
  // has not flushed by the time the handler calls this, so reading guideId off
  // state here would send the first question of a guide without its brief.
  const ask = (question, withGuide) => {
    push({ role: "user", text: question });
    runTurn(question, withGuide === undefined ? guideId : withGuide);
  };

  /* Something handed over from outside the panel.

     Two shapes. A question from an insight card, which is asked. And a line
     Tally already said in the peek bubble, which is not: it is repeated as
     the first thing in the transcript, with whatever it offered to do.

     Opening on a greeting after tapping a message is the thing this fixes.
     The peek is the opening line of a conversation, and the panel used to
     throw it away and start again with "I keep your books. What do you
     need?", which reads as not having been listening. */
  useEffect(() => {
    if (!seed) return;

    if (seed.said) {
      onSeedUsed?.();
      /* followUp is a question, not an action. The peek carries a place to go
         rather than something to ask, so the question is the one a person
         would type next about that message. Tally answers it from the ledger,
         which is more use than a link to the page they were already told
         about. */
      pushOnce({
        role: "assistant",
        text: seed.said,
        followUp: seed.followUp || undefined,
      });
      return;
    }

    if (!seed.question) return;
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
    push({ role: "assistant", text: guideOpener(guide.id), guideId: guide.id });
  }, [guide?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Tally noticing something and saying so ----
     The finding is already computed and already worded (lib/insights.js), so
     this costs nothing and arrives before the user thinks to ask. It comes with
     the question attached: one tap sends the agent after the entries behind it. */
  useEffect(() => {
    if (!brief?.insight) return;
    onBriefUsed?.();
    const i = brief.insight;
    push({
      role: "assistant",
      text: `${i.severity === "alert" ? "This one needs you" : i.severity === "warn" ? "Worth a look" : "One thing I noticed"}: ${i.title}. ${i.detail}`,
      followUp: i.ask,
    });
  }, [brief?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- money landed, so say so before being asked ----
     The whole point of a proactive message is that it arrives without a
     question. It states what came in, then puts the payments that are actually
     due in front of the user with one tap to settle each. */
  /* ---- what the morning pass did ----
     A table rather than a sentence, because it is a list of pairs and four of
     those in prose is a paragraph. Six rows at most, like everything else
     she writes. */
  useEffect(() => {
    if (!nudge?.paired?.length) return;
    onNudgeUsed?.();
    const rows = nudge.paired.slice(0, 6);
    const table = [
      "| Bank line | Amount | Matched to |",
      "| --- | --- | --- |",
      ...rows.map((p) =>
        `| ${(p.bank.description || "bank line").slice(0, 28)} | ${fmt(Math.abs(p.bank.amount))} | ${(p.tx.description || p.tx.category || "entry").slice(0, 24)} |`),
    ].join("\n");
    const more = nudge.paired.length > rows.length
      ? `\n\n${nudge.paired.length - rows.length} more paired the same way.`
      : "";
    pushOnce({
      role: "assistant",
      text:
        `**Paired ${nudge.paired.length} bank ${nudge.paired.length === 1 ? "line" : "lines"} this morning, ${fmt(nudge.total)}.**\n\n` +
        `${table}${more}\n\nNothing was deleted or created. Undo any of it in Consolidate.`,
      followUp: "What is still unmatched?",
    });
  }, [nudge?.at]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [nudge?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = async (file) => {
    if (!file) return;
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
    setBusy(isPdf ? "reading the document…" : "reading the receipt…");
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

      /* Does this receipt pay something already on the books?
         Without this the receipt became a second entry while the payable stayed
         open, so "You owe" overstated by the amount you had just paid, and the
         settle flow with its required receipt was skipped. The receipt is the
         evidence that flow asks for. */
      const match = draft.type === "expense" ? findOpenPayable(data, draft) : null;
      if (match) {
        push({
          role: "assistant",
          text: `That looks like the ${fmt(match.amount)} you owe ${match.party}${match.description ? ` for ${match.description}` : ""}. Settling it files this receipt against the bill, so it is not counted twice.`,
          settleSuggestion: { item: match, draft },
          att,
        });
      } else {
        push({ role: "assistant", text: draft.note || "Here's what I read, confirm or adjust:", draft, att });
      }
    } catch (e) {
      push({ role: "assistant", text: `I couldn't read that one. ${friendlyError(e)}. Try a clearer file, or type the details (e.g. “Figma $45 on March 10”).` });
    }
    setBusy("");
  };

  /* ---- where a typed line goes ----
     With the mode switch gone the message itself decides, which is what people
     expected the switch to be doing anyway. A question is answered; a line with
     real money in it is filed; anything else is a question, because "did I pay
     Vercel" must never become a $0 draft entry. */
  const looksLikeQuestion = (text) =>
    /\?/.test(text) ||
    /^\s*(why|how|what|when|which|where|who|should|can|could|would|do i|did i|am i|is my|are my|show|list|tell|explain|compare|find|check|help)\b/i.test(text);

  const handleText = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    push({ role: "user", text });
    // Parsed on-device first. It costs nothing, it decides where the message is
    // going, and it's the draft we fall back to when the reader is unreachable 
    // a typed line with an amount in it should never come back empty-handed.
    const local = parseEntryText(text, { categories: data.categories, ledgerKind: data.ledger.kind });
    if (looksLikeQuestion(text) || !(Number(local?.amount) > 0)) {
      await runTurn(text);
      return;
    }
    setBusy("filing that…");
    try {
      const raw = await askClaude(
        [{ type: "text", text: `${extractionPrompt(data.categories, data.ledger.name)}\n\nUser message: "${text}"` }],
        { schema: extractionSchema(data.categories) }
      );
      const draft = normalizeDraft(raw, { categories: data.categories, ledgerKind: data.ledger.kind, fallback: local });
      push({ role: "assistant", text: draft.note || "Got it, confirm or adjust:", draft });
    } catch (e) {
      // The local parse already found the amount, so the entry survives the
      // reader being unreachable, only the category is a guess worth checking.
      push({ role: "assistant", text: `${friendlyError(e)}, so I filled this in from your message. Check the category before saving.`, draft: local });
    }
    setBusy("");
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
      style={embedded ? { minHeight: 0 } : cardStyle()}
      className={(embedded ? "flex-1 " : "rounded-lg ") + "flex flex-col min-h-0"}
    >
      {guideId && GUIDES[guideId] && (
        <div className="flex items-center gap-2 px-3 pt-2">
          <span style={{ background: P.brass + "22", border: `1px solid ${P.brass}`, color: P.brassText, fontFamily: MONO, width: 22, height: 22 }}
            className="rounded-full text-xs flex items-center justify-center shrink-0">
            {GUIDES[guideId].avatar}
          </span>
          <span style={{ fontFamily: MONO, color: P.muted }} className="text-xs flex-1 truncate">{GUIDES[guideId].title}</span>
          <button onClick={() => setGuideId(null)} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2">
            leave the guide
          </button>
        </div>
      )}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
        style={embedded ? {} : { maxHeight: "55vh", minHeight: 320 }}
      >
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
                  <FileText size={13} style={{ color: P.brassText }} /> {m.pdfName}
                </div>
              )}
              {m.text && <TallyText text={m.text} tone={m.role === "assistant" ? P.muted : P.text} />}
              {m.steps && (
                <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs space-y-0.5">
                  {m.steps.map((name, k) => (
                    <div key={k} className="flex items-center gap-1.5">
                      <Search size={10} style={{ color: P.brassText, flexShrink: 0 }} />
                      {TOOL_LABEL[name] || name.replace(/_/g, " ")}
                    </div>
                  ))}
                </div>
              )}
              {m.guideId && GUIDES[m.guideId] && (
                <OptionCard
                  options={GUIDES[m.guideId].steps.slice(0, 3)}
                  onPick={(q) => { setGuideId(m.guideId); ask(q, m.guideId); }}
                />
              )}
              {/* Tally said something unprompted, and left the follow-up
                  question on the table rather than making the user phrase it. */}
              {/* A contact chosen straight into the invitation card, rather
                  than typed back as a sentence for her to interpret. */}
              {m.pickContacts?.length > 0 && !m.pickUsed && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.pickContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        // Spent, so the next press offers a fresh list rather
                        // than reusing one whose answer is already on screen.
                        setMsgs((prev) =>
                          prev.map((x) => (x.pickId && x.pickId === m.pickId ? { ...x, pickUsed: true } : x)),
                        );
                        push({
                          role: "assistant",
                          proposal: {
                            kind: "propose_invoice_invite",
                            input: {
                              to: c.email || "",
                              name: c.name,
                              reason: c.email
                                ? `Invitation to ${c.name}, ${c.email}`
                                : `${c.name} has no address on file, so add one below`,
                            },
                          },
                        });
                      }}
                      style={{ background: P.surface2, color: P.text, borderRadius: R.pill }}
                      className="h-9 px-3 text-[13.5px] press inline-flex items-center gap-1.5"
                    >
                      {c.name}
                      <span style={{ color: P.faint }} className="text-[12px]">
                        {contacts_roleLabel(c.role)}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => ask("Send an invoice request to somebody who is not in my contacts.")}
                    style={{ color: P.muted }}
                    className="h-9 px-2 text-[13.5px] press"
                  >
                    Someone else
                  </button>
                </div>
              )}

              {m.followUp && (
                <div className="mt-2">
                  <button type="button" onClick={() => ask(m.followUp)}
                    style={{ background: P.brass, color: P.onbrass, borderRadius: 12 }}
                    className="px-3 py-2 text-[14px] font-medium text-left inline-flex items-center gap-2">
                    <Search size={13} /> Look into it
                  </button>
                </div>
              )}
              {m.nudge && <NudgeCard nudge={m.nudge} data={data} apply={apply} onDone={(line) => push({ role: "assistant", text: line, done: true })} />}
              {m.settleSuggestion && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    onClick={() => onSettleFromReceipt(m.settleSuggestion, m.att)}
                    style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
                    className="px-4 py-2.5 text-[15px] font-medium press"
                  >
                    Settle that bill
                  </button>
                  <button
                    onClick={() => push({ role: "assistant", text: "Filing it as a new entry instead.", draft: m.settleSuggestion.draft, att: m.att })}
                    style={{ background: P.surface2, color: P.text, borderRadius: R.pill }}
                    className="px-4 py-2.5 text-[15px] font-medium press"
                  >
                    No, a separate entry
                  </button>
                </div>
              )}
              {m.draft && (
                <>
                  <DraftCard draft={m.draft} att={m.att} data={data} addSub={addSub} onSave={saveDraft} />
                  <TaxLine draft={m.draft} policy={taxPolicy} />
                </>
              )}
              {m.proposal && (
                ["propose_contact", "propose_invoice_invite", "propose_invoice_link"].includes(m.proposal.kind)
                  ? <PlainProposalCard proposal={m.proposal} apply={apply} />
                  : <ProposalCard proposal={m.proposal} data={data} apply={apply} />
              )}
              {m.link && (
                <div className="mt-2">
                  <Btn tone="ghost" onClick={() => onGo?.(m.link.view)}>{m.link.label || "Open"}</Btn>
                </div>
              )}
            </div>
          </div>
        ))}
        {/* Openers, drawn from what the local insight pass already found. They
            stay up until the first question, and never re-offer something Tally
            has already put on the table unprompted. */}
        {!msgs.some((m) => m.role === "user") && !busy && (
          <OptionCard
            /* truncation-ok: three openers, not a list of anything owed. */
            options={[...new Set([...insights.slice(0, 3).map((i) => i.ask), ...DEFAULT_ASKS])]
              .filter((q) => !msgs.some((m) => m.followUp === q))
              .slice(0, 3)}
            onPick={(q) => ask(q)}
          />
        )}
        {busy && (
          <LoadingLine>{busy}</LoadingLine>
        )}
        <div ref={endRef} />
      </div>
      {/* What is worth asking, given the state of the books.

          Not a fixed menu. A menu of everything is a menu nobody reads, and a
          suggestion to chase overdue invoices when nothing is overdue teaches
          people to ignore the row. Each of these only appears when it has
          something behind it, at most three, and they go once the
          conversation is underway. */}
      {showPrompts && (
        <div className="px-3 pt-2 flex flex-wrap gap-1.5">
          {quickPrompts.map((q) => (
            <button
              key={q.label}
              onClick={() => (q.run === "pick-contact" ? offerContacts() : ask(q.ask))}
              style={{ background: P.surface2, color: P.text, borderRadius: R.pill }}
              className="h-9 px-3 text-[13.5px] press inline-flex items-center gap-1.5"
            >
              {q.icon}
              {q.label}
            </button>
          ))}
        </div>
      )}

      <div className="p-3 flex items-center gap-2 tally-composer" style={{ borderTop: `1px solid ${P.line}` }}>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ""; }} />
        <button
          onClick={() => fileRef.current.click()}
          title="Attach a receipt screenshot or invoice PDF"
          aria-label="Attach a receipt or invoice"
          style={{ background: P.surface2, color: P.muted, width: 44, height: 44, borderRadius: 14 }}
          className="flex items-center justify-center shrink-0 press"
        >
          <Camera size={19} />
        </button>
        <input
          placeholder="Ask Tally, or type an entry"
          aria-label="Message Tally"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && handleText()}
          style={{ background: P.surface2, color: P.text, borderRadius: 13 }}
          className="flex-1 min-w-0 px-4 py-2.5 text-[15px] outline-none border-none"
        />
        <button
          onClick={handleText}
          disabled={busy || !input.trim()}
          aria-label="Send"
          style={{
            background: P.brass, color: P.onbrass, width: 44, height: 44, borderRadius: 14,
            opacity: busy || !input.trim() ? 0.4 : 1,
            cursor: busy || !input.trim() ? "not-allowed" : "pointer",
          }}
          className="flex items-center justify-center shrink-0 press"
        >
          <Send size={18} />
        </button>
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
            <button onClick={() => setDismissed(true)} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2">
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
    <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-3 mt-2 space-y-2 w-72 max-w-full">
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

/* What Tally says, rendered.

   Her text went into a <p> unchanged, so a model that writes **like this**
   put asterisks on the screen. The fix is not to tell her to stop using
   markdown, because every model reaches for it under pressure and the
   instruction fails exactly when the answer is complicated. Render the small
   part of it she actually uses instead.

   Three things: bold, bullets, and pipe tables. Tables are the point. Four
   overdue invoices as a paragraph is a paragraph you read twice; as four rows
   it is a glance, and the amounts line up so the big one finds you. */

const inlineBold = (text, key) => {
  const out = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${key}-b${i++}`} style={{ color: P.text, fontWeight: 600 }}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

/* A cell that is money gets the mono face and sits right, so a column of
   amounts can be compared by eye rather than read one at a time. */
const looksLikeMoney = (v) => /^[-+(]?\s*\$?\s*[\d,]+(\.\d{2})?\s*\)?$/.test(String(v).trim());

function TallyTable({ rows }) {
  const [head, ...body] = rows;
  return (
    <div className="my-2 -mx-0.5 overflow-x-auto">
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                style={{ color: P.faint, borderBottom: `1px solid ${P.line}` }}
                className={`text-[12.5px] font-normal pb-1.5 pr-3 ${i && looksLikeMoney(body[0]?.[i]) ? "text-right" : "text-left"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => {
                const money = looksLikeMoney(c);
                return (
                  <td
                    key={ci}
                    style={{
                      color: ci === 0 ? P.text : P.muted,
                      borderTop: ri ? `1px solid ${P.line}` : "none",
                      fontFamily: money ? MONO : undefined,
                    }}
                    className={`text-[13.5px] py-1.5 pr-3 align-top ${money ? "text-right tabular-nums whitespace-nowrap" : ""}`}
                  >
                    {inlineBold(c, `${ri}-${ci}`)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TallyText({ text, tone }) {
  const blocks = useMemo(() => {
    const lines = String(text || "").split("\n");
    const out = [];
    let para = [], bullets = [], table = [];

    const flushPara = () => { if (para.length) { out.push({ t: "p", v: para.join(" ") }); para = []; } };
    const flushBullets = () => { if (bullets.length) { out.push({ t: "ul", v: bullets }); bullets = []; } };
    const flushTable = () => {
      // Two columns and two rows minimum, or it is a sentence with a pipe in it.
      if (table.length >= 2 && table[0].length >= 2) out.push({ t: "table", v: table });
      else table.forEach((r) => para.push(r.join(" | ")));
      table = [];
    };

    for (const raw of lines) {
      const line = raw.trimEnd();
      const isRow = /^\s*\|?.+\|.+\|?\s*$/.test(line) && line.includes("|");
      const isDivider = /^[\s|:-]+$/.test(line) && line.includes("-");
      const isBullet = /^\s*[-*]\s+/.test(line);

      if (isRow && !isBullet) {
        flushPara(); flushBullets();
        if (isDivider) continue;   // the |---|---| separator carries nothing
        table.push(line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
        continue;
      }
      flushTable();

      if (isBullet) { flushPara(); bullets.push(line.replace(/^\s*[-*]\s+/, "")); continue; }
      flushBullets();

      if (!line.trim()) { flushPara(); continue; }
      para.push(line);
    }
    flushPara(); flushBullets(); flushTable();
    return out;
  }, [text]);

  return (
    <div className="space-y-1.5">
      {blocks.map((b, i) => {
        if (b.t === "table") return <TallyTable key={i} rows={b.v} />;
        if (b.t === "ul") {
          return (
            <ul key={i} className="space-y-1">
              {b.v.map((li, j) => (
                <li key={j} className="flex gap-2">
                  <span aria-hidden style={{ background: P.brass, width: 5, height: 5, borderRadius: "50%", marginTop: 8 }} className="shrink-0" />
                  <span style={{ color: tone }} className="flex-1">{inlineBold(li, `${i}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={i} style={{ color: tone }}>{inlineBold(b.v, String(i))}</p>;
      })}
    </div>
  );
}

/* Three strokes, drawing themselves, where a figure is being fetched.

   The same gesture as the launch screen, so the app has one way of saying
   hold on rather than a different spinner in every corner. */
function TallyLoading({ size = 26 }) {
  return (
    <svg
      className="tally-load"
      width={size}
      height={size * 0.72}
      viewBox="0 0 26 19"
      fill="none"
      role="img"
      aria-label="Reading the bank"
    >
      <line x1="2" y1="4" x2="18" y2="4" stroke={P.credit} strokeWidth="3" strokeLinecap="round" />
      <line x1="2" y1="11" x2="13" y2="11" stroke={P.debit} strokeWidth="3" strokeLinecap="round" />
      <line x1="23" y1="2" x2="21" y2="17" stroke={P.brass} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ================= agent proposals =================
   The agent can't write. It draws one of these instead, and nothing reaches the
   ledger until it's tapped. The money fields stay editable, because the agent read
   your books to build this, but it didn't live them. */
/* Proposals with no money in them.

   ProposalCard is built around an amount: every one of its kinds has one, and
   the layout starts from that. A contact and an invitation have none, so they
   get their own small card rather than an amount field hidden behind a
   condition in a component that works. Same shape, same rule that nothing
   happens until the button is pressed. */
function PlainProposalCard({ proposal, apply }) {
  const { kind, input } = proposal;
  const [v, setV] = useState(() => ({ ...input }));
  const [state, setState] = useState("open");
  const [err, setErr] = useState("");
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));

  const isContact = kind === "propose_contact";
  const isLink = kind === "propose_invoice_link";
  const title = isContact ? "Add a contact"
    : isLink ? "Create an intake link"
    : "Invite them to invoice you";

  const run = async () => {
    setErr("");
    const r = isContact
      ? await apply.addContact?.({
          name: v.name, role: v.role, email: v.email, phone: v.phone, note: v.note,
        })
      : isLink
        ? await apply.createInvoiceLink?.(v.label)
        : await apply.inviteSupplier?.({ to: v.to, note: v.note, name: v.name });
    if (!r?.ok) return setErr(r?.error || "That did not go through.");
    setState("applied");
  };

  if (state === "dismissed") return null;
  if (state === "applied") {
    return (
      <div style={{ color: P.credit }} className="text-[14px] mt-2 flex items-center gap-1.5">
        <Check size={13} />
        {isContact ? `${v.name} added to your contacts.`
          : isLink ? "Intake link created. It is in AR / AP."
          : `Invitation sent to ${v.to}.`}
      </div>
    );
  }

  return (
    <div
      style={{ background: P.bg, border: `1px solid ${P.brass}55` }}
      className="rounded-lg p-3 mt-2 space-y-2 w-72 max-w-full"
    >
      <div style={{ color: P.brassText }} className="text-[14px] font-medium flex items-center gap-1.5">
        <Sparkles size={11} /> {title}
      </div>
      {input.reason && <p style={{ color: P.faint }} className="text-xs">{input.reason}</p>}

      {isLink ? (
        <>
          <div>
            <Label>What it is for</Label>
            <Input
              value={v.label || ""}
              onChange={(e) => set("label", e.target.value)}
              placeholder="Optional, such as a supplier name"
            />
          </div>
          <p style={{ color: P.faint }} className="text-xs">
            Anyone holding the link can send you an invoice, and nothing reaches your books until you accept
            it.
          </p>
        </>
      ) : isContact ? (
        <>
          <div>
            <Label>Name</Label>
            <Input value={v.name || ""} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <Label>Role</Label>
            <div className="flex flex-wrap gap-1">
              {CONTACT_ROLES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => set("role", r.id)}
                  style={{
                    background: v.role === r.id ? P.brass : P.surface2,
                    color: v.role === r.id ? P.onbrass : P.muted,
                    borderRadius: 999,
                  }}
                  className="px-2.5 py-1 text-[12.5px] font-medium"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Email</Label>
            <Input value={v.email || ""} onChange={(e) => set("email", e.target.value)} placeholder="Optional" />
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>To</Label>
            <Input
              value={v.to || ""}
              onChange={(e) => set("to", e.target.value)}
              placeholder={v.name ? `Looked up from ${v.name}` : "their@email.ca"}
            />
            {!v.to && v.name && (
              <p style={{ color: P.faint }} className="text-xs mt-1">
                Left empty, this goes to the address on {v.name}'s contact record.
              </p>
            )}
          </div>
          <div>
            <Label>A line for them</Label>
            <Input value={v.note || ""} onChange={(e) => set("note", e.target.value)} placeholder="Optional" />
          </div>
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Btn onClick={run} disabled={isContact ? !v.name : isLink ? false : !(v.to || v.name)}>
          {isContact ? "Add them" : isLink ? "Create it" : "Send it"}
        </Btn>
        <Btn tone="ghost" onClick={() => setState("dismissed")}>Not now</Btn>
      </div>
      {err && <p style={{ color: P.debit }} className="text-xs">{err}</p>}
    </div>
  );
}

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
      <div style={{ color: P.brassText }} className="text-[14px] font-medium flex items-center gap-1.5">
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
        type: file.type || attTypeFromName(file.name) || "application/octet-stream",
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
        onClick={() => openPreview(tx.attachmentId, tx.attachmentName, tx)}
        title={`View ${tx.attachmentName || "filed document"}`}
        style={{ color: P.brassText, padding: 6, margin: -6 }}
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

function Transactions({ data, monthTx, addTx, delTx, updateTx, setTxAttachment, openPreview, openImport, openTransfer, addSub, addCredit, month, cleared, readOnly = false }) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("all");
  const [recOnly, setRecOnly] = useState(false);
  const [q, setQ] = useState("");
  const [dir, setDir] = useState("all");   // all | in | out
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
  const needle = q.trim().toLowerCase();
  const list = monthTx
    .filter((t) => !showAccountFilter || filter === "all" || t.account === filter)
    .filter((t) => !recOnly || isRec(t))
    .filter((t) => dir === "all" || (dir === "in" ? t.type === "income" : t.type === "expense"))
    // One field across description, category, and subcategory: people search
    // for "vercel" or "software", not for a column.
    .filter((t) => !needle || [t.description, t.category, t.subcategory]
      .some((v) => String(v || "").toLowerCase().includes(needle)))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const recTotal = list.filter(isRec).reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);

  const submit = () => {
    if (!form.amount || !form.description) return;
    addTx({ ...form, subcategory: form.subcategory || undefined, creditId: form.payMethod === "credits" ? form.creditId : undefined, amount: parseFloat(form.amount) });
    setForm(blank);
    setAdding(false);
  };

  return (
    <>
      {/* One toolbar: search, direction, then the two things you came to do.
          The old row of tracked-out mono words read as a debug switchboard. */}
      {/* Search takes its own line, then everything else sits on one line that
          cannot wrap. Nowrap is the point: if a future label makes the row too
          wide it will scroll sideways rather than silently dropping a button
          onto a line of its own, which is how Add entry came to look like a
          separate section of the page. */}
      <div className="mb-4 space-y-2">
        <label
          style={{ background: P.surface, boxShadow: elev(1), borderRadius: R.pill }}
          className="flex items-center gap-2.5 px-4 w-full"
        >
          <Search size={17} style={{ color: P.faint }} className="shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search entries, parties, categories"
            aria-label="Search entries"
            style={{ background: "transparent", color: P.text }}
            className="py-3 w-full outline-none text-[15px]"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear search" style={{ color: P.faint }} className="shrink-0 p-1">
              <X size={14} />
            </button>
          )}
        </label>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap overflow-x-auto no-bar">
        {/* One segmented control rather than three separate pills. Three pills
            with gaps and two labelled buttons beside them needed 442px on a
            358px row, so everything after them wrapped. Sharing one track saves
            the gaps and the two outer shadows. */}
        <div
          className="flex items-center shrink-0 h-11 p-1"
          style={{ background: P.surface, boxShadow: elev(1), borderRadius: R.pill }}
        >
          {[["all", "All"], ["in", "In"], ["out", "Out"]].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setDir(k)}
              aria-pressed={dir === k}
              style={{
                background: dir === k ? P.brass : "transparent",
                color: dir === k ? P.onbrass : P.muted,
                borderRadius: R.pill,
              }}
              className="h-9 px-3.5 text-[15px] font-medium press"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {!readOnly && <>
        {/* Transfer keeps its icon and loses its word below 640px, because the
            word is the part that does not fit. Add entry keeps a word at every
            width, because it is the primary action and an unlabelled plus is a
            guess. */}
        <button
          onClick={openTransfer}
          title="Move money between your ledgers"
          aria-label="Transfer between ledgers"
          style={{ background: P.surface2, color: P.text, borderRadius: R.pill }}
          className="shrink-0 press inline-flex items-center justify-center gap-2 h-11 w-11 sm:w-auto sm:px-4 text-[15px] font-medium"
        >
          <ArrowLeftRight size={17} />
          <span className="hidden sm:inline">Transfer</span>
        </button>
        <button
          onClick={() => setAdding(!adding)}
          style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
          className="shrink-0 press inline-flex items-center justify-center gap-1.5 sm:gap-2 h-11 px-3.5 sm:px-4 text-[15px] font-medium"
        >
          <Plus size={17} />
          Add<span className="hidden sm:inline">&nbsp;entry</span>
        </button>
        </>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        {showAccountFilter && ["all", "business", "personal"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ color: filter === f ? P.brassText : P.faint }} className="text-[14px]">
            {f === "all" ? "Both accounts" : f}
          </button>
        ))}
        <button onClick={() => setRecOnly(!recOnly)}
          title="Show recurring entries only"
          style={{ color: recOnly ? P.brassText : P.faint }}
          className="text-[14px] inline-flex items-center gap-1.5">
          <Repeat size={13} /> Recurring only
        </button>
        {!readOnly && (
          <button onClick={openImport} style={{ color: P.faint }} className="text-[14px] inline-flex items-center gap-1.5">
          <FileText size={13} /> Import a statement
        </button>
        )}
        <span style={{ color: P.faint }} className="text-[14px] ml-auto">
          {list.length} {list.length === 1 ? "entry" : "entries"}{needle ? " matching" : ""}
        </span>
      </div>

      <section style={cardStyle()} className="p-5">
      {recOnly && (
        <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs mb-3">
          Recurring net this month: <span style={{ color: recTotal >= 0 ? P.credit : P.debit }}>{fmt(recTotal)}</span>
        </p>
      )}

      {adding && (
        <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-3 mb-4 grid sm:grid-cols-6 gap-2 items-end">
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
        <EmptyState
          icon={recOnly ? Repeat : Receipt}
          title={recOnly ? "No recurring entries this month" : "Nothing logged this month"}
        >
          {recOnly
            ? "Entries you mark as recurring will collect here."
            : "Add an entry above, or capture a receipt and let Tally read it."}
        </EmptyState>
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
              <div
                key={t.id}
                className="row-interactive flex items-center gap-2 sm:gap-3 py-2.5 px-2 -mx-2 rounded-md"
                style={{ borderColor: P.line, "--row-hover": P.surface2 }}
              >
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
                      <span style={{ color: P.brassText, border: `1px solid ${P.brass}` }} className="rounded px-1 shrink-0" title="Paid with credits, doesn't affect cash balance">
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
                  <IconButton label="Edit" onClick={() => setEditingId(t.id)}>
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton
                    label="Delete"
                    onClick={async () => {
                      // Transfers already ask; a plain entry deleted straight
                      // from the row did not, and the row it removes is gone
                      // from the month's totals with nothing to undo it.
                      const ok = await askConfirm({
                        title: "Delete this entry?",
                        body: `${t.description || "This entry"} · ${fmt(t.amount)} on ${t.date}. It comes out of this month's totals.`,
                        confirmLabel: "Delete",
                      });
                      if (ok) delTx(t.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              </div>
            )
          )}
        </div>
      )}
      </section>
    </>
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
        padding: "3px 7px", borderRadius: 5, fontSize: 11, boxShadow: elev(2),
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
    <div className="space-y-6 stagger">
      {/* Every section opens with its own figures, the way Snapshot does. Three
          cards here, because a profit and loss has exactly three answers. */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Revenue", value: revenue, tone: P.credit, change: revenueChange },
          { label: "Expenses", value: costs, tone: P.debit, change: costsChange, invert: true },
          { label: net >= 0 ? "Net income" : "Net loss", value: net, tone: net >= 0 ? P.credit : P.debit, change: netChange },
        ].map((c) => (
          <div key={c.label} style={cardStyle()} className="p-4 flex flex-col min-w-0">
            <div style={{ color: P.text }} className="text-[15px] mb-2">{c.label}</div>
            <div style={{ fontFamily: MONO, color: c.tone }} className="text-[22px] k-fig tabular-nums leading-none truncate">{fmt0(Math.abs(c.value))}</div>
            {/* The month was already on the stepper, and pairing it with the
                change badge on one line is what pushed "100%" out of the card
                on a phone. The change sits under its own figure now. */}
            <div className="mt-2">
              <PLChange value={c.change} invert={c.invert} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 items-center">
        <div className="flex-1" />
        <Btn tone="ghost" onClick={exportCSV} title="Download this statement + underlying transactions as CSV">
          <Download size={14} /> Export CSV
        </Btn>
      </div>

      <section style={cardStyle()} className="p-5">
        <h2 style={{ fontFamily: SERIF }} className="text-xl mb-3">{monthLabel(month)} statement</h2>
        <div className="space-y-2.5">
          <PLRow label="Revenue" value={revenue} color={P.credit} change={revenueChange} />
          <PLRow label="Costs & expenses" value={-costs} color={P.debit} change={costsChange} invertChange />
          {recCosts > 0 && (
            <div style={{ color: P.faint }} className="flex justify-between gap-3 text-[13.5px] pl-4">
              <span className="inline-flex items-center gap-1.5"><Repeat size={12} /> recurring, then one-time</span>
              <span className="tabular-nums shrink-0" style={{ fontFamily: MONO }}>{fmt0(-recCosts)} / {fmt0(-(costs - recCosts))}</span>
            </div>
          )}
          {creditCosts > 0 && (
            <div style={{ color: P.faint }} className="flex justify-between gap-3 text-[13.5px] pl-4">
              <span>covered by credits, so no cash left</span>
              <span className="tabular-nums shrink-0" style={{ color: P.brassText, fontFamily: MONO }}>{fmt0(-creditCosts)}</span>
            </div>
          )}
          <div style={{ borderTop: `1px solid ${P.line}` }} className="pt-3 mt-1 flex justify-between items-baseline gap-3">
            <span style={{ color: P.text }} className="text-[17px] font-semibold">
              Net {net >= 0 ? "profit" : "loss"}
            </span>
            <span className="flex items-baseline gap-2.5 shrink-0">
              <PLChange value={netChange} />
              <span style={{ color: net >= 0 ? P.credit : P.debit, fontFamily: MONO }} className="tabular-nums text-[19px]">
                {fmt(net)}
              </span>
            </span>
          </div>
          {margin !== null && (
            <div style={{ color: P.faint }} className="text-[14px] text-right">
              a {margin.toFixed(0)}% margin on revenue
            </div>
          )}
        </div>
        {(openAR > 0 || openAP > 0) && (
          <p style={{ color: P.faint }} className="text-xs mt-3">
            Not yet in these numbers: {fmt(openAR)} still owed to you, {fmt(openAP)} you still owe.
          </p>
        )}
      </section>

      {/* at-a-glance stats: burn rate, top category concentration, txn count, the numbers behind the statement above */}
      <section style={cardStyle()} className="p-5">
        <h2 style={{ fontFamily: SERIF }} className="text-xl mb-3">At a glance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Avg. daily spend" value={fmt(avgDailyCost)} hint={`over ${daysElapsed} ${daysElapsed === 1 ? "day" : "days"}`} />
          <StatTile label="Avg. daily revenue" value={fmt(avgDailyRevenue)} hint={`over ${daysElapsed} ${daysElapsed === 1 ? "day" : "days"}`} />
          <StatTile
            label="Top category share"
            value={topCatShare !== null ? `${topCatShare.toFixed(0)}%` : "·"}
            hint={catRows.length ? catRows[0][0] : "no expenses"}
          />
          <StatTile label="Transactions" value={String(monthTx.length)} hint={`${monthTx.filter((t) => t.type === "expense").length} out · ${monthTx.filter((t) => t.type === "income").length} in`} />
        </div>
      </section>

      <section style={cardStyle()} className="p-5">
        <h2 style={{ fontFamily: SERIF }} className="text-xl mb-3">Where the money went</h2>
        {catRows.length === 0 ? (
          <p style={{ color: P.faint }} className="text-sm">No expenses in this view for {monthLabel(month)}.</p>
        ) : (
          <div className="space-y-2">
            {catRows.map(([cat, v], i) => (
              <CatBarRow key={cat} index={i} cat={cat} value={v} max={maxCat} count={catCount[cat]} shareOfCosts={costs > 0 ? (v / costs) * 100 : null} />
            ))}
          </div>
        )}
      </section>

      <section style={cardStyle()} className="p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 style={{ fontFamily: SERIF }} className="text-xl">Six-month trend</h2>
          <div className="flex items-center gap-4 text-[14px]" style={{ color: P.faint }}>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: P.credit, display: "inline-block" }} /> Money in
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: P.debit, display: "inline-block" }} /> Money out
            </span>
          </div>
        </div>
        <div className="flex items-end gap-3 h-32">
          {trend.map((t, i) => (
            <TrendBar key={t.m} index={i} t={t} maxTrend={maxTrend} active={t.m === month} />
          ))}
        </div>
      </section>
    </div>
  );
}

// invertChange: for cost rows, a rise is bad (red) and a fall is good (green), the opposite of revenue/net
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
  <div className="flex justify-between items-baseline gap-3">
    <span style={{ color: P.text }} className="text-[15px] min-w-0 truncate">{label}</span>
    <span className="flex items-baseline gap-2.5 shrink-0">
      {change !== undefined && <PLChange value={change} invert={invertChange} />}
      <span style={{ color, fontFamily: MONO }} className="tabular-nums text-[15px]">{fmt(value)}</span>
    </span>
  </div>
);

function StatTile({ label, value, hint }) {
  return (
    <div style={{ background: P.surface2, borderRadius: 14 }} className="p-4 min-w-0">
      <div style={{ color: P.muted }} className="text-[14px] mb-1.5">{label}</div>
      <div style={{ fontFamily: MONO, color: P.text }} className="text-[19px] tabular-nums leading-none truncate">{value}</div>
      {hint && <div style={{ color: P.faint }} className="text-[13.5px] mt-2">{hint}</div>}
    </div>
  );
}

function CatBarRow({ cat, value, max, count, shareOfCosts, index = 0 }) {
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
        <div
          style={{
            width: `${(value / max) * 100}%`,
            background: P.debit,
            opacity: 0.8,
            // Rows draw in sequence, heaviest category first, so the ranking
            // reads as it lands rather than appearing all at once.
            animationDelay: `${Math.min(index, 8) * 45}ms`,
          }}
          className="h-full bar-rise-x"
        >
          <ChartTip show={hover}>
            {fmt(value)}{shareOfCosts !== null ? ` · ${shareOfCosts.toFixed(0)}% of costs` : ""} · {count} {count === 1 ? "txn" : "txns"}
          </ChartTip>
        </div>
      </div>
      <div style={{ fontFamily: MONO }} className="text-sm tabular-nums w-24 text-right">{fmt(value)}</div>
    </div>
  );
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function TrendBar({ t, maxTrend, active, index = 0 }) {
  const [hover, setHover] = useState(false);
  // A period with nothing in it makes maxTrend 0, and `t.inc / 0` is NaN, which
  // React writes out as height:NaN% and the browser discards. The result was a
  // chart with no bars, no baseline and one lonely month label: it read as
  // broken rather than as empty, which it was.
  const scale = Math.max(maxTrend, 1);
  // Clamped as well as guarded: if maxTrend is ever stale relative to the data
  // a bar would render taller than its own column and spill over the card.
  const pct = (v) => Math.min((v / scale) * 100, 100);
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
      <div className="flex items-end gap-0.5 w-full justify-center relative" style={{ height: 96 }}>
        <span aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, background: P.line }} />
        {/* Months stagger left to right, income a beat ahead of spend, so the
            pair reads as one gesture per month instead of a wall going up. */}
        <div
          style={{ height: `${pct(t.inc)}%`, background: P.credit, width: "30%", minHeight: t.inc ? 2 : 0, animationDelay: `${index * 50}ms` }}
          className="rounded-t bar-rise-y"
        />
        <div
          style={{ height: `${pct(t.exp)}%`, background: P.debit, width: "30%", minHeight: t.exp ? 2 : 0, animationDelay: `${index * 50 + 25}ms` }}
          className="rounded-t bar-rise-y"
        />
      </div>
      <div style={{ color: active ? P.brassText : P.faint }} className="text-[13px]">
        {MONTH_SHORT[Number(t.m.slice(5)) - 1] || t.m.slice(5)}
      </div>
    </div>
  );
}

/* ================= AR / AP ================= */
/* Writing an invoice and sending it.
 *
 * The mirror of the intake tray, and it borrows that flow's habits on purpose:
 * lines that add themselves up, one currency, a contact rather than a retyped
 * address, and nothing counted until it has actually gone.
 *
 * A draft lives here alone. Sending is the moment it becomes a receivable, so
 * the books never contain a figure nobody has been asked for.
 */
function BillingList({ ledgerId, ledgerCcy, contacts = [], addAR, readOnly, onChanged }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [draft, setDraft] = useState(null);

  const refresh = useCallback(async () => {
    if (!ledgerId) return;
    setRows(await billing.listSent(ledgerId));
  }, [ledgerId]);

  useEffect(() => { refresh(); }, [refresh]);

  const blank = async () => {
    const number = await billing.nextNumber(ledgerId);
    setDraft({
      id: null,
      number: number || "INV-0001",
      party: "",
      contactEmail: "",
      contactId: null,
      issuedOn: todayStr(),
      dueOn: "",
      currency: ledgerCcy || "CAD",
      note: "",
      taxRate: 0,
      lines: [{ desc: "", qty: 1, rate: "" }],
    });
    setOpen(true);
  };

  const totals = draft ? billing.totalOf(draft.lines, draft.taxRate) : { net: 0, tax: 0, total: 0 };

  const setLine = (i, patch) => {
    setDraft((d) => {
      const lines = d.lines.map((l, n) => (n === i ? { ...l, ...patch } : l));
      /* A blank line at the end, always, so adding the next one is typing
         rather than pressing a button first. */
      if (i === lines.length - 1 && (lines[i].desc || lines[i].rate)) {
        lines.push({ desc: "", qty: 1, rate: "" });
      }
      return { ...d, lines };
    });
  };

  const save = async (andSend) => {
    const lines = draft.lines.filter((l) => String(l.desc).trim() || Number(l.rate));
    if (!draft.party.trim()) { setErr("Who is it for?"); return null; }
    if (!lines.length || totals.total <= 0) { setErr("Add at least one line with an amount."); return null; }
    if (andSend && !String(draft.contactEmail || "").trim()) {
      setErr("An address is needed to send it. Pick a contact, or type one in.");
      return null;
    }
    setErr("");
    setBusy("save");
    const saved = await billing.saveDraft(ledgerId, {
      ...draft, lines, amount: totals.total, taxAmount: totals.tax,
    });
    setBusy("");
    if (!saved) { setErr("That did not save."); return null; }
    await refresh();
    return saved;
  };

  const sendIt = async () => {
    const saved = await save(true);
    if (!saved) return;
    setBusy("send");
    const res = await billing.send(saved.id, { addAR });
    setBusy("");
    if (res?.ok === false) { setErr(res.error || "It did not send."); return; }
    setOpen(false);
    setDraft(null);
    setDone(`${saved.number} sent to ${res?.to || saved.party}.`);
    setTimeout(() => setDone(""), 8000);
    await refresh();
    onChanged?.();
  };

  const drafts = rows.filter((r) => r.status === "draft");
  const live = rows.filter((r) => r.status === "sent");
  const closed = rows.filter((r) => r.status === "paid" || r.status === "cancelled");
  const owedOut = live.reduce((n, r) => n + Math.abs(r.amount), 0);

  const Line = ({ r }) => (
    <div className="py-2.5" style={{ borderTop: `1px solid ${P.line}` }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span style={{ color: P.text }} className="text-[15px] block truncate">
            {r.party}
            <span style={{ fontFamily: MONO, color: P.faint }} className="text-[13px] ml-2">{r.number}</span>
          </span>
          <span style={{ color: P.faint }} className="text-[13px]">
            {r.status === "draft" ? "not sent yet"
              : r.status === "cancelled" ? "cancelled"
              : r.status === "paid" ? `paid${r.dueOn ? "" : ""}`
              : `sent ${String(r.sentAt || "").slice(0, 10)}${r.opens > 0 ? ` · opened ${r.opens === 1 ? "once" : `${r.opens} times`}` : " · unopened"}`}
            {r.dueOn && r.status === "sent" ? ` · due ${r.dueOn}` : ""}
          </span>
        </span>
        <span style={{ fontFamily: MONO, color: r.status === "paid" ? P.credit : P.text }}
          className="text-[15px] tabular-nums shrink-0">
          {fmtIn(r.amount, r.currency, ledgerCcy)}
        </span>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          {r.status === "draft" && (
            <>
              <button onClick={() => { setDraft({ ...r, taxRate: r.amount ? r.taxAmount / (r.amount - r.taxAmount) : 0, lines: r.lines || [{ desc: "", qty: 1, rate: "" }] }); setOpen(true); }}
                style={{ color: P.brassText }} className="text-[13.5px] press">Open it</button>
              <button onClick={async () => { await billing.removeDraft(r.id); refresh(); }}
                style={{ color: P.faint }} className="text-[13.5px] press">Delete</button>
            </>
          )}
          {r.status === "sent" && (
            <>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(`https://www.brasstally.com/v/${r.token}`);
                  setDone("Address copied.");
                  setTimeout(() => setDone(""), 4000);
                }}
                style={{ color: P.brassText }} className="text-[13.5px] press">Copy the address</button>
              <button
                onClick={async () => { setBusy(r.id); await billing.send(r.id, { addAR }); setBusy(""); refresh(); }}
                disabled={busy === r.id}
                style={{ color: P.brassText }} className="text-[13.5px] press">
                {busy === r.id ? "Sending" : "Send it again"}
              </button>
              <button onClick={async () => { await billing.cancel(r.id); refresh(); }}
                style={{ color: P.debit }} className="text-[13.5px] press">Cancel it</button>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section style={{ background: P.surface, borderRadius: 20 }} className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 style={{ fontFamily: SERIF }} className="text-xl">Invoices you send</h3>
        {owedOut > 0 && (
          <span style={{ fontFamily: MONO, color: P.muted }} className="text-[15.5px] tabular-nums">
            {fmt(owedOut)} out
          </span>
        )}
      </div>
      <p style={{ color: P.muted }} className="text-[15px] mb-1">
        Write one, send it, and it becomes something you are owed. Nothing is counted until it goes.
      </p>

      {done && <p style={{ color: P.credit }} className="text-[14.5px] py-1">{done}</p>}
      {err && !open && <p style={{ color: P.debit }} className="text-[14.5px] py-1">{err}</p>}

      {drafts.map((r) => <Line key={r.id} r={r} />)}
      {live.map((r) => <Line key={r.id} r={r} />)}

      {closed.length > 0 && (
        <details className="mt-2">
          <summary style={{ color: P.faint }} className="text-[13.5px] cursor-pointer">
            {closed.length} paid or cancelled
          </summary>
          {closed.map((r) => <Line key={r.id} r={r} />)}
        </details>
      )}

      {rows.length === 0 && !open && (
        <p style={{ color: P.faint }} className="text-[14.5px] py-2">
          Nothing sent yet. An invoice from here lands in their inbox with a page they can open.
        </p>
      )}

      {!readOnly && !open && (
        <button onClick={blank}
          style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
          className="h-11 px-4 text-[15px] font-medium press mt-3">
          <Plus size={14} className="inline mb-0.5" /> Write one
        </button>
      )}

      {open && draft && (
        <div style={{ background: P.surface2, borderRadius: 16 }} className="p-4 mt-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span style={{ fontFamily: MONO, color: P.brassText }} className="text-[14px]">{draft.number}</span>
            <button onClick={() => { setOpen(false); setDraft(null); setErr(""); }}
              style={{ color: P.faint }} className="text-[14px] press">Close</button>
          </div>

          <label style={{ color: P.muted }} className="text-[14px] block mt-2">Who it is for</label>
          <input
            value={draft.party}
            onChange={(e) => setDraft({ ...draft, party: e.target.value })}
            placeholder="Northside Developments"
            style={{ background: P.surface, color: P.text, borderRadius: 13 }}
            className="w-full h-11 px-3.5 text-[15px] outline-none border-none mt-1"
          />
          {contacts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {contacts.filter((c) => c.email).slice(0, 8).map((c) => (
                <button key={c.id}
                  onClick={() => setDraft({ ...draft, party: c.name, contactEmail: c.email, contactId: c.id })}
                  style={{ background: P.surface, color: P.muted, borderRadius: 999 }}
                  className="px-3 py-1.5 text-[13px] press">
                  {c.name}
                </button>
              ))}
            </div>
          )}

          <label style={{ color: P.muted }} className="text-[14px] block mt-3">Their email</label>
          <input
            value={draft.contactEmail || ""}
            onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })}
            placeholder="accounts@northside.ca"
            inputMode="email"
            style={{ background: P.surface, color: P.text, borderRadius: 13 }}
            className="w-full h-11 px-3.5 text-[15px] outline-none border-none mt-1"
          />

          <label style={{ color: P.muted }} className="text-[14px] block mt-3">What it is for</label>
          {draft.lines.map((l, i) => (
            <div key={i} className="flex gap-1.5 mt-1.5">
              <input
                value={l.desc}
                onChange={(e) => setLine(i, { desc: e.target.value })}
                placeholder={i === 0 ? "Design, 12 hours" : "Another line"}
                style={{ background: P.surface, color: P.text, borderRadius: 13 }}
                className="flex-1 min-w-0 h-11 px-3.5 text-[15px] outline-none border-none"
              />
              <input
                value={l.qty}
                onChange={(e) => setLine(i, { qty: e.target.value })}
                inputMode="decimal"
                style={{ background: P.surface, color: P.text, borderRadius: 13, fontFamily: MONO }}
                className="w-16 h-11 px-2 text-[15px] text-center outline-none border-none"
              />
              <input
                value={l.rate}
                onChange={(e) => setLine(i, { rate: e.target.value })}
                inputMode="decimal"
                placeholder="95.00"
                style={{ background: P.surface, color: P.text, borderRadius: 13, fontFamily: MONO }}
                className="w-24 h-11 px-2 text-[15px] text-right outline-none border-none"
              />
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <label style={{ color: P.muted }} className="text-[14px]">Tax</label>
            <select
              value={draft.taxRate}
              onChange={(e) => setDraft({ ...draft, taxRate: Number(e.target.value) })}
              style={{ background: P.surface, color: P.text, borderRadius: 13 }}
              className="h-11 px-3 text-[15px] outline-none border-none"
            >
              <option value={0}>None</option>
              <option value={0.05}>GST 5%</option>
              <option value={0.13}>HST 13%</option>
              <option value={0.15}>HST 15%</option>
            </select>
            <label style={{ color: P.muted }} className="text-[14px] ml-2">Due</label>
            <input
              type="date"
              value={draft.dueOn || ""}
              onChange={(e) => setDraft({ ...draft, dueOn: e.target.value })}
              style={{ background: P.surface, color: P.text, borderRadius: 13 }}
              className="h-11 px-3 text-[15px] outline-none border-none"
            />
          </div>

          <input
            value={draft.note || ""}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="A note on the invoice, if you want one"
            style={{ background: P.surface, color: P.text, borderRadius: 13 }}
            className="w-full h-11 px-3.5 text-[15px] outline-none border-none mt-2"
          />

          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${P.line}` }}>
            <div className="flex items-baseline justify-between">
              <span style={{ color: P.muted }} className="text-[14.5px]">Subtotal</span>
              <span style={{ fontFamily: MONO, color: P.muted }} className="text-[14.5px] tabular-nums">{fmt(totals.net)}</span>
            </div>
            {totals.tax > 0 && (
              <div className="flex items-baseline justify-between">
                <span style={{ color: P.muted }} className="text-[14.5px]">Tax</span>
                <span style={{ fontFamily: MONO, color: P.muted }} className="text-[14.5px] tabular-nums">{fmt(totals.tax)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between mt-1">
              <span style={{ color: P.text }} className="text-[16px]">Total</span>
              <span style={{ fontFamily: MONO, color: P.text }} className="text-[18px] tabular-nums">{fmt(totals.total)}</span>
            </div>
          </div>

          {err && <p style={{ color: P.debit }} className="text-[14.5px] mt-2">{err}</p>}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              onClick={sendIt}
              disabled={busy !== ""}
              style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
              className="h-11 px-4 text-[15px] font-medium press"
            >
              {busy === "send" ? "Sending" : busy === "save" ? "Saving" : "Send it"}
            </button>
            <button
              onClick={async () => { const v = await save(false); if (v) { setOpen(false); setDraft(null); } }}
              disabled={busy !== ""}
              style={{ color: P.muted }}
              className="h-11 px-2 text-[15px] press"
            >
              Keep it as a draft
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ARAP({ data, addAR, settleAR, delAR, removeSettled, updateAR, addSub, addCredit, openPreview, openGuide, receiptSettle, onReceiptSettleUsed, readOnly, onInboundChange, contacts = [], arrived = [], onApproveArrived, onDismissArrived, arrivedBusy, bankTxns = [], onPairBank , onContactsChange }) {
  /* Plans live beside the payables, never inside them. */
  const [plans, setPlans] = useState([]);
  const refreshPlans = useCallback(async () => {
    if (!data?.ledger?.id) return;
    setPlans(await listPlanned(data.ledger.id));
  }, [data?.ledger?.id]);

  useEffect(() => { refreshPlans(); }, [refreshPlans]);

  /* A plan becoming real.

     It turns into an ordinary payable and the plan records what it became, so
     the intention and the bill are the same story rather than two entries
     somebody has to remember are related. */
  const commitPlan = async (plan) => {
    const created = await addAR("payables", {
      party: plan.label,
      description: plan.note || `Planned ${plan.bucket}`,
      amount: Math.abs(plan.amount),
      dueDate: plan.expectedOn || todayStr(),
      category: plan.category,
    });
    await updatePlanned(plan.id, { status: "committed", obligationId: created?.id });
    refreshPlans();
  };
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

  const openARItems = data.receivables.filter((r) => r.status === "open");
  const openAPItems = data.payables.filter((r) => r.status === "open");
  const parties = new Set(openAPItems.map((x) => x.party)).size;
  const settledThisMonth = [...data.receivables, ...data.payables]
    .filter((i) => i.status !== "open" && String(i.settledOn || "").startsWith(todayStr().slice(0, 7)));
  // The one obligation the page is usually opened to check.
  const nextUp = [...openAPItems, ...openARItems]
    .filter((i) => i.dueDate)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];

  const kpis = [
    { label: "Owed to you", value: openAR, tone: P.credit,
      foot: `${openARItems.length} open ${openARItems.length === 1 ? "invoice" : "invoices"}` },
    { label: "You owe them", value: openAP, tone: P.debit,
      foot: `${openAPItems.length} across ${parties} ${parties === 1 ? "party" : "parties"}` },
    { label: "Net position", value: net, tone: net >= 0 ? P.credit : P.debit,
      foot: net >= 0 ? "more coming in than going out" : "more going out than coming in" },
    { label: "Settled this month", value: settledThisMonth.reduce((a, b) => a + b.amount, 0), tone: P.muted,
      foot: `${settledThisMonth.length} locked ${settledThisMonth.length === 1 ? "entry" : "entries"}` },
  ];

  return (
    <div className="space-y-6 stagger">
      {!readOnly && (
        <ArrivedCard
          items={arrived}
          onApprove={onApproveArrived}
          onDismiss={onDismissArrived}
          busyId={arrivedBusy}
        />
      )}

      {/* One row: the tray and link icons on the left, these on the right.

          They were on a line of their own underneath, which pushed everything
          below them down a row and left the icons floating with nothing
          beside them. Same line, opposite ends, and the section starts higher
          up the page. */}
      {/* The panel must not live inside a flex row.

          I put the icons and these two buttons on one line, and the expanding
          panel came with them: opening the intake link squeezed the row, and
          the buttons wrapped to the bottom.

          InvoiceTools now takes what belongs beside its icons and renders it
          on its own row, so the panel below is full width whatever is open. */}
      {!readOnly && (
        <InvoiceTools
          trailing={
            <>
              <GuideAnchor id="ar-ap" onOpen={openGuide} label="Help me chase" onContactsChange={onContactsChange} />
              <Btn tone="ghost" onClick={exportCSV} title="Download all receivables and payables as CSV">
                <Download size={14} /> Export CSV
              </Btn>
            </>
          }
          ledgerId={data.ledger.id}
          ledgerCurrency={data.ledger.currency}
          openPreview={openPreview}
          onAccept={(inv) => addAR("payables", inv)}
          onCount={onInboundChange}
          contacts={contacts}
          onFindPayable={(id) => data.payables.find((p) => p.id === id) || null}
          onFindOpenPayables={() => (data.payables || []).filter((p) => p.status === "open")}
          onDeletePayable={(id) => delAR("payables", id)}
          onConfirmVoid={askConfirm}
        />
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} style={cardStyle()} className="p-4 flex flex-col">
            <div style={{ color: P.muted }} className="text-sm mb-1.5">{k.label}</div>
            <div style={{ fontFamily: MONO, color: k.tone }} className="text-xl tabular-nums">
              {k.value < 0 ? "-" : ""}{fmt(Math.abs(k.value))}
            </div>
            <div style={{ color: P.faint }} className="text-xs mt-auto pt-3 leading-snug">{k.foot}</div>
          </div>
        ))}
      </div>

      {nextUp && (
        <div style={cardStyle()} className="p-4 flex items-center gap-3">
          <CalendarDays size={18} style={{ color: P.brassText }} className="shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">
              Next up: <strong>{nextUp.party}</strong>{nextUp.description ? ` · ${nextUp.description}` : ""}
            </div>
            <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs">due {nextUp.dueDate}</div>
          </div>
          <span style={{ fontFamily: MONO, color: data.payables.includes(nextUp) ? P.debit : P.credit }}
                className="text-base tabular-nums shrink-0">
            {fmt(nextUp.amount)}
          </span>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-6">
        <ARList kind="receivables" title="They owe you" items={data.receivables} data={data} addAR={addAR} settleAR={settleAR} delAR={delAR} removeSettled={removeSettled} updateAR={updateAR} addSub={addSub} addCredit={addCredit} openPreview={openPreview} tone={P.credit} action="Mark received" contacts={contacts} bankTxns={bankTxns} onPairBank={onPairBank} />
        {/* What you bill, above what you are billed: the section people open
            this app to act on rather than to read. */}
        <BillingList
          ledgerId={data.ledger.id}
          ledgerCcy={data.ledger.currency || "CAD"}
          contacts={contacts}
          addAR={addAR}
          readOnly={readOnly}
          onChanged={onInboundChange}
        />

        <PlannedList
          ledgerId={data.ledger.id}
          plans={plans}
          readOnly={readOnly}
          onChanged={refreshPlans}
          onCommit={commitPlan}
        />

        <ARList kind="payables" title="You owe them" items={data.payables} data={data} addAR={addAR} settleAR={settleAR} delAR={delAR} removeSettled={removeSettled} updateAR={updateAR} addSub={addSub} addCredit={addCredit} openPreview={openPreview} tone={P.debit} action="Mark paid" receiptSettle={receiptSettle} onReceiptSettleUsed={onReceiptSettleUsed} contacts={contacts} />
      </div>
    </div>
  );
}

/* ---------- shared field block for AR/AP add + edit forms ---------- */
function ARFields({ kind, f, set, data, addSub, addCredit, contacts = [] }) {
  const type = kind === "receivables" ? "income" : "expense";
  const cats = data.categories[type].map((c) => c.name);
  const catVal = f.category && cats.includes(f.category) ? f.category : (kind === "receivables" ? "Client revenue" : "GENIE AI");
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{kind === "receivables" ? "Who owes you" : "Who you owe"}</Label>
          {/* Filtered by which side of the books this is. Asking who owes you
              and offering your vendors is a list that makes the work harder. */}
          <ContactPicker
            value={f.party}
            onChange={(v) => set("party", v)}
            contacts={contacts}
            roles={kind === "receivables" ? ["client", "contractor", "vendor"] : ["vendor", "contractor", "employee"]}
            placeholder={kind === "receivables" ? "Client" : "Vendor or contractor"}
          />
        </div>
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

/* Money you mean to spend, kept out of what you owe.
 *
 * A payable is somebody else's claim: they expect it and will chase it. A plan
 * is your own intention and costs nothing to abandon. Putting a trip you might
 * take into "You owe them" overstates the figure you make decisions against,
 * so this sits beside that section rather than inside it and its total is
 * never added in.
 *
 * The one join between them is deliberate: when a plan becomes real, it turns
 * into a payable and says so, rather than being retyped.
 */
function PlannedList({ ledgerId, plans, onChanged, readOnly, onCommit }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ label: "", amount: "", bucket: "travel", expectedOn: "", note: "" });

  const open = plans.filter((p) => p.status === "planned");
  const totals = plannedTotals(open);

  const BUCKETS = [
    ["travel", "Travel"],
    ["equipment", "Equipment"],
    ["software", "Software"],
    ["people", "People"],
    ["tax", "Tax"],
    ["other", "Other"],
  ];
  const bucketLabel = (b) => (BUCKETS.find(([k]) => k === b) || [, "Other"])[1];

  const save = async () => {
    const amount = Number(String(form.amount).replace(/[^0-9.-]/g, ""));
    if (!form.label.trim() || !(amount > 0)) return;
    setBusy("new");
    await addPlanned(ledgerId, { ...form, amount });
    setBusy("");
    setAdding(false);
    setForm({ label: "", amount: "", bucket: "travel", expectedOn: "", note: "" });
    onChanged?.();
  };

  return (
    <section style={{ background: P.surface, borderRadius: 20 }} className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 style={{ fontFamily: SERIF }} className="text-xl">Planned</h3>
        {open.length > 0 && (
          <span style={{ fontFamily: MONO, color: P.muted }} className="text-[15.5px] tabular-nums">
            {fmt(totals.total)}
          </span>
        )}
      </div>
      <p style={{ color: P.muted }} className="text-[15px] mb-1">
        What you intend to spend. Not counted in what you owe, because nobody is expecting it yet.
      </p>

      {open.length === 0 && !adding && (
        <p style={{ color: P.faint }} className="text-[14.5px] py-2">
          Nothing planned. A trip, a laptop, a contractor you mean to hire.
        </p>
      )}

      {open.map((p) => (
        <div key={p.id} className="py-3" style={{ borderTop: `1px solid ${P.line}` }}>
          <div className="flex items-baseline justify-between gap-3">
            <span style={{ color: P.text }} className="text-[15.5px] min-w-0 truncate">
              {p.label}
              <span
                style={{ background: P.surface2, color: P.muted, borderRadius: 999 }}
                className="ml-2 px-2 py-0.5 text-[12px] whitespace-nowrap"
              >
                {bucketLabel(p.bucket)}
              </span>
            </span>
            <span style={{ fontFamily: MONO, color: P.muted }} className="text-[15.5px] tabular-nums shrink-0">
              {fmt(p.amount)}
            </span>
          </div>
          <div style={{ color: P.faint }} className="text-[13.5px] mt-0.5">
            {p.expectedOn ? `around ${p.expectedOn}` : "no date yet"}
            {p.note ? ` · ${p.note}` : ""}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button
                onClick={async () => {
                  setBusy(p.id);
                  await onCommit?.(p);
                  setBusy("");
                }}
                disabled={busy === p.id}
                style={{ background: P.surface2, color: P.text, borderRadius: R.pill }}
                className="h-10 px-3.5 text-[14.5px] font-medium press"
              >
                {busy === p.id ? "Adding" : "It is happening"}
              </button>
              <button
                onClick={async () => { setBusy(p.id); await dropPlanned(p.id); setBusy(""); onChanged?.(); }}
                disabled={busy === p.id}
                style={{ color: P.faint }}
                className="h-10 px-2 text-[14px] press"
              >
                Drop it
              </button>
            </div>
          )}
        </div>
      ))}

      {!readOnly && !adding && (
        <button
          onClick={() => setAdding(true)}
          style={{ background: P.surface2, color: P.text, borderRadius: R.pill }}
          className="h-11 px-4 text-[15px] font-medium press mt-3"
        >
          <Plus size={14} className="inline mb-0.5" /> Plan something
        </button>
      )}

      {adding && (
        <div style={{ background: P.surface2, borderRadius: 14 }} className="p-3.5 mt-3">
          <input
            autoFocus
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Flights to Karachi"
            style={{ background: P.surface, color: P.text, borderRadius: 13 }}
            className="w-full h-11 px-3.5 text-[15px] outline-none border-none mb-2"
          />
          <div className="flex flex-wrap gap-2">
            <input
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              inputMode="decimal"
              placeholder="1800.00"
              style={{ background: P.surface, color: P.text, borderRadius: 13, fontFamily: MONO }}
              className="h-11 px-3.5 text-[15px] outline-none border-none w-32"
            />
            <select
              value={form.bucket}
              onChange={(e) => setForm({ ...form, bucket: e.target.value })}
              style={{ background: P.surface, color: P.text, borderRadius: 13 }}
              className="h-11 px-3 text-[15px] outline-none border-none"
            >
              {BUCKETS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input
              type="date"
              value={form.expectedOn}
              onChange={(e) => setForm({ ...form, expectedOn: e.target.value })}
              style={{ background: P.surface, color: P.text, borderRadius: 13 }}
              className="h-11 px-3 text-[15px] outline-none border-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              onClick={save}
              disabled={busy === "new"}
              style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
              className="h-11 px-4 text-[15px] font-medium press"
            >
              {busy === "new" ? "Saving" : "Plan it"}
            </button>
            <button
              onClick={() => setAdding(false)}
              style={{ color: P.muted }}
              className="h-11 px-2 text-[15px] press"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ARList({ kind, title, items, data, addAR, settleAR, delAR, removeSettled, updateAR, addSub, addCredit, openPreview, tone, action, receiptSettle, onReceiptSettleUsed, contacts = [], bankTxns = [], onPairBank }) {
  const [adding, setAdding] = useState(false);
  const [settleFor, setSettleFor] = useState(null);   // item awaiting the confirm dialog

  /* A receipt arrived from Tally that pays one of these. Open the confirm on
     it, with the receipt already in hand, so the required-evidence step is
     satisfied by the thing that started the flow. */
  useEffect(() => {
    if (!receiptSettle || kind !== "payables") return;
    const live = items.find((i) => i.id === receiptSettle.item.id && i.status === "open");
    if (live) setSettleFor({ ...live, __receipt: receiptSettle.att, __draft: receiptSettle.draft });
    onReceiptSettleUsed?.();
  }, [receiptSettle, kind, items, onReceiptSettleUsed]);
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
  /* Part paid first, then by date.

     A bill you are halfway through is the one with a promise attached: you
     agreed a date for the rest and somebody is expecting it. Sorted by date
     alone it can sit at position nine, below four bills nobody has discussed,
     and the arrangement is the thing most likely to be forgotten. */
  const partPaidFirst = (a, b) => {
    const ap = (Number(a.paidAmount) || 0) > 0.005 ? 0 : 1;
    const bp = (Number(b.paidAmount) || 0) > 0.005 ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ad = ap === 0 && a.balanceDue ? a.balanceDue : a.dueDate;
    const bd = bp === 0 && b.balanceDue ? b.balanceDue : b.dueDate;
    return (ad || "9999-12-31").localeCompare(bd || "9999-12-31");
  };
  const open = [...items.filter((i) => i.status === "open")].sort(partPaidFirst);
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

  /* A settled entry, with what it was for.

     The description was behind an eleven pixel icon, so a line reading
     "Syed Belal $2,727.00 paid 2026-08-11" could not be reconciled against
     anything without clicking something you would have to notice first. The
     amount and the party are not enough: the same supplier bills you for
     different work, and a figure with no subject is a figure you cannot check.

     So it reads on two lines: who and what, then how much and when. */
  const SettledLine = ({ i, indent }) => (
    <div style={{ paddingLeft: indent ? "18px" : 0 }} className="py-1.5">
      <div className="flex justify-between items-baseline gap-2">
        <span
          style={{ color: P.muted, fontFamily: MONO }}
          className="text-xs truncate flex items-center gap-1.5 min-w-0"
        >
          <Lock size={10} style={{ color: P.faint }} />
          {i.party}{isCredits(i) ? " (credits)" : ""}
        </span>
        <span
          style={{ color: P.muted, fontFamily: MONO }}
          className="text-xs shrink-0 flex items-center gap-2"
        >
          {fmt(i.amount)} &middot; {kind === "receivables" ? "received" : "paid"} {i.settledOn}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeSettled(kind, i); }}
            title="Remove this settlement (and its transaction)"
            aria-label="Remove settlement"
            style={{ color: P.faint, padding: "4px", margin: "-4px", cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = P.debit)}
            onMouseLeave={(e) => (e.currentTarget.style.color = P.faint)}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {/* What it was for, and what backs it up. On the line, not behind an
          icon: this is the part that answers "where did that come from". */}
      <div
        style={{ color: P.faint, paddingLeft: 15 }}
        className="text-[11.5px] flex items-center gap-2 min-w-0"
      >
        <span className="truncate">
          {/* An entry with nothing written on it says so.

              Showing an empty line leaves you wondering whether the detail is
              missing or you have missed it, and one of those is worth acting
              on. An old entry from before the intake flow often has nothing,
              and knowing that is the answer to where it came from. */}
          {i.description
            ? `${i.description}${i.category ? ` · ${i.category}` : ""}`
            : i.category
              ? i.category
              : "no description on this one"}
        </span>
        {i.attachmentId ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openPreview(i.attachmentId, i.attachmentName || "receipt", i);
            }}
            title="See the receipt"
            style={{ color: P.brassText }}
            className="shrink-0 inline-flex items-center gap-1"
          >
            <Paperclip size={10} /> receipt
          </button>
        ) : (
          <span className="shrink-0">no receipt</span>
        )}
      </div>
    </div>
  );

  const renderRow = (i, inGroup) => {
    /* The date that is actually still owed on.

       A bill part paid on an arrangement is not overdue on its original date:
       that date was met, in part, and the rest is due when you agreed it would
       be. Judging it on the old date would light up half your list in red for
       bills nobody is late on. */
    const effectiveDue = (Number(i.paidAmount) || 0) > 0 && i.balanceDue ? i.balanceDue : i.dueDate;
    const overdue = effectiveDue && effectiveDue < todayStr() && i.status === "open";
    /* Not due, and it repeats. See the button below for why this matters. */
    /* Part paid, so the row says how far along it is. An open bill showing
       its full amount when half has gone overstates what you owe. */
    const paidSoFar = Number(i.paidAmount) || 0;
    const left = Math.max(0, Math.round((Math.abs(i.amount) - paidSoFar) * 100) / 100);

    /* Part paid, and marked in brass rather than red or green.
     *
     * It is neither: red is a bill nobody has touched, green is one that is
     * finished, and this is an arrangement you are halfway through and have
     * agreed the rest of. A third state deserves a third colour, and brass is
     * the one this app uses for things in progress. */
    const partPaid = paidSoFar > 0.005 && i.status === "open";

    const tooEarly = Boolean(
      i.dueDate && i.dueDate > todayStr() && (i.recurrence === "recurring" || i.frequency),
    );
    const future = !overdue && i.dueDate && i.dueDate > horizon;

    if (editingId === i.id && editForm) {
      return (
        <div key={i.id} style={{ background: P.bg, border: `1px solid ${P.brass}` }} className="rounded-lg p-3 space-y-2">
          <ARFields kind={kind} f={editForm} set={eset} data={data} addSub={addSub} addCredit={addCredit} contacts={contacts} />
          <div className="flex gap-2">
    <Btn className="flex-1 justify-center" onClick={saveEdit}><Check size={14} /> Save changes</Btn>
    <Btn tone="ghost" onClick={() => { setEditingId(null); setEditForm(null); }}><X size={14} /></Btn>
          </div>
        </div>
      );
    }
    return (
      <div
        key={i.id}
        style={{
          background: inGroup ? P.surface : P.surface2,
          border: overdue ? `1px solid ${P.debit}` : "none",
          borderRadius: 14,
          opacity: future ? 0.7 : 1,
        }}
        className="p-3.5 flex items-center gap-2 min-w-0"
      >
        <button onClick={() => { setEditingId(i.id); setEditForm({ ...i, amount: String(i.amount), frequency: i.frequency || "monthly", category: i.category || defaultCat }); }} className="flex-1 min-w-0 text-left" title="Edit">
          {/* Who and what for, on one line; when and how underneath. The old
              shape put the party alone on the first line and everything else
              in a mono footnote, which read as metadata rather than as the
              thing itself. */}
          <div className="text-[15px] truncate" style={{ color: P.text }}>
            {i.party}{i.description ? <span style={{ color: P.muted }}> · {i.description}</span> : null}
          </div>
          <div style={{ color: overdue ? P.debit : P.faint }} className="text-[13.5px] flex items-center gap-1.5 flex-wrap mt-0.5" data-meta>
            {isRec(i) && <RecMark />}
            {/* The date that is still owed on. A bill part paid on an
              arrangement shows when the rest lands, not the date it was
              originally raised for. */}
          <span>
            {paidSoFar > 0 && i.balanceDue ? `rest due ${i.balanceDue}` : `due ${i.dueDate}`}
          </span>
            {overdue && <span>· overdue</span>}
            {future && <span>· in {daysUntil(i.dueDate)} days</span>}
            {isRec(i) && <span>· {freqLabel(i.frequency || "monthly")}</span>}
            {i.subcategory && <span>· {i.subcategory}</span>}
          </div>
          {isCredits(i) && (
    <div style={{ fontFamily: MONO, color: P.brassText }} className="text-xs">{creditName(data, i.creditId)} credits, no cash moves</div>
          )}
        </button>
        <div className="shrink-0 text-right">
          {/* What is still owed, with what has gone underneath. A bill
              showing its full amount when half is paid overstates the debt,
              and the total at the top of the section is built from the same
              figure, so they would disagree. */}
          <div
            style={{ fontFamily: MONO, color: partPaid ? P.brassText : tone }}
            className="text-[15px] tabular-nums"
          >
            {fmt(paidSoFar > 0 ? left : i.amount)}
          </div>
          {paidSoFar > 0 && (
            <div style={{ color: P.faint }} className="text-[12px] tabular-nums">
              {fmt(paidSoFar)} of {fmt(Math.abs(i.amount))} paid
            </div>
          )}
        </div>
        {i.attachmentId && (
          <button onClick={() => openPreview(i.attachmentId, i.attachmentName, i)} title={`View ${i.attachmentName || "invoice"}`} style={{ color: P.brassText, padding: 6, margin: -6 }}>
    <Paperclip size={13} />
          </button>
        )}
        <button
          onClick={() => { setEditingId(i.id); setEditForm({ ...i, amount: String(i.amount), frequency: i.frequency || "monthly", category: i.category || defaultCat }); }}
          style={{ color: P.faint, padding: 6, margin: -6 }}
          title="Edit"
          className="hidden sm:block shrink-0"
        >
          <Pencil size={14} />
        </button>
        {/* A bill that is not due yet, and repeats, cannot be settled here.

            A yearly fee paid last week reappears with next year's date on it,
            and its tick sits there looking exactly like the one you just
            used. Pressing it marks a bill paid 323 days early, which is a
            misclick that takes a year to notice.

            Faded and refusing, with the date in the tooltip, rather than
            hidden: a control that vanishes leaves you wondering whether the
            bill is tracked at all. A one-off can still be paid early, because
            paying a bill ahead of its date is a normal thing to do when there
            is only one of it. */}
        <button
          onClick={() => { if (!tooEarly) setSettleFor(i); }}
          disabled={tooEarly}
          title={tooEarly
            ? `Not due until ${i.dueDate}. This one repeats, so it unlocks nearer the date.`
            : `${action}: confirm the actual amount, date, payment, and file the receipt`}
          aria-label={tooEarly ? `Not due until ${i.dueDate}` : action}
          style={{
            background: P.surface, color: P.text, borderRadius: R.pill,
            boxShadow: tooEarly ? "none" : elev(1),
            opacity: tooEarly ? 0.32 : 1,
            cursor: tooEarly ? "not-allowed" : "pointer",
          }}
          className="shrink-0 w-11 h-11 flex items-center justify-center press"
        >
          <Check size={17} />
        </button>
        <IconButton
          label="Delete"
          className="hidden sm:inline-flex shrink-0"
          onClick={async () => {
            const ok = await askConfirm({
              title: `Delete this ${kind === "receivables" ? "receivable" : "payable"}?`,
              body: `${i.party || "This entry"}${i.description ? ` · ${i.description}` : ""} · ${fmt(i.amount)}. It stops counting toward your open books.`,
              confirmLabel: "Delete",
            });
            if (ok) delAR(kind, i.id);
          }}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
    );
  };

  const openTotal = open.reduce((a, b) => a + b.amount, 0);

  return (
    <section style={cardStyle()} className="p-5 arap-panel">
      <div className="flex justify-between items-center mb-1 gap-2">
        <h2 style={{ fontFamily: SERIF }} className="text-xl flex-1">{title}</h2>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={(e) => { onInvoice(e.target.files[0]); e.target.value = ""; }} />
        {adding
          ? <button onClick={cancelAdd} style={{ color: P.muted }} className="text-[15px] px-2" title="Close">Cancel</button>
          : <button
              onClick={() => setAdding(true)}
              style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
              className="px-4 py-2.5 text-[15px] font-medium inline-flex items-center gap-2 shrink-0 press"
            >
              <Plus size={16} /> Add
            </button>}
      </div>

      {reading && (
        <LoadingLine className="mb-3">reading the invoice…</LoadingLine>
      )}

      {adding && (
        <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-3 mb-3 space-y-2">
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
          <ARFields kind={kind} f={form} set={set} data={data} addSub={addSub} addCredit={addCredit} contacts={contacts} />
          {readErr && <p style={{ color: P.brassText }} className="text-xs">{readErr}</p>}
          <Btn className="w-full justify-center" onClick={submit}><Check size={14} /> Add</Btn>
        </div>
      )}

      <div style={{ color: P.faint }} className="text-[14px] mb-4">
        {open.length} open · {fmt(openTotal)}{kind === "payables" ? " committed" : ""}
      </div>

      <div className="arap-scroll">
      {open.length === 0 && !adding ? (
        <EmptyState compact icon={Check} title="Nothing open">Everything here is settled.</EmptyState>
      ) : (
        <div className="space-y-2">
          {openSeq.map((g) => {
            if (g.items.length === 1) return renderRow(g.items[0]);
            const total = g.items.reduce((s, x) => s + x.amount, 0);
            const nextDue = g.items[0].dueDate;
            const expanded = !!openGroups[g.party];
            return (
              <div key={"g:" + g.party} style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="overflow-hidden">
                <button onClick={() => toggleGroup(g.party)} className="w-full p-3 flex items-center gap-2 text-left">
                  <ChevronDown size={15} style={{ color: P.brassText, transform: expanded ? "none" : "rotate(-90deg)", transition: "transform .18s" }} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] truncate" style={{ color: P.text }}>{g.party}</div>
                    <div style={{ color: P.faint }} className="text-[13.5px] mt-0.5">
                      {g.items.length} items · next due {nextDue}
                    </div>
                  </div>
                  <div style={{ fontFamily: MONO, color: tone }} className="text-[15px] tabular-nums shrink-0">{fmt(total)}</div>
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
          bankTxns={bankTxns}
          data={data}
          addCredit={addCredit}
          action={action}
          onConfirm={async ({ att, bankId, ...actual }) => {
            let attachmentId, attachmentName;
            if (att) {
              attachmentId = await storeAttachment(att);
              // evidence is the point of the dialog: if the file didn't land, nothing settles
              if (!attachmentId) throw new Error("The receipt couldn't be saved to storage. Check your connection and try again.");
              attachmentName = att.name;
            }
            const tx = settleAR(kind, settleFor.id, { ...actual, attachmentId, attachmentName });

            /* Join the deposit to the entry that explains it.

               Without this the invoice is settled and the bank line is still
               loose, so the next consolidation asks about money whose story is
               already written down. */
            if (bankId && tx?.id) onPairBank?.(bankId, tx.id);

            setSettleFor(null);
          }}
          onClose={() => setSettleFor(null)}
        />
      )}


      {settled.length > 0 && (
        <div className="mt-4" style={{ borderTop: `1px solid ${P.line}`, paddingTop: "12px" }}>
          <Label>
            Settled and locked
            <span style={{ color: P.faint }} className="font-normal">
              {" "}&middot; {settled.length} {settled.length === 1 ? "entry" : "entries"}
            </span>
          </Label>
          {/* Every one of them.

              This was capped at six with nothing to say so, which is how a
              settled payment can be in your books, correct, and invisible.
              Somebody hunting for a figure they half remember would have
              concluded it was not there. */}
          {settledSeq.map((g) => {
            if (g.items.length > 1) {
              const gTotal = g.items.reduce((s, x) => s + x.amount, 0);
              const gk = "s:" + g.party;
              return (
                <div key={gk}>
                  <button onClick={() => toggleGroup(gk)} style={{ color: P.muted, fontFamily: MONO }} className="text-xs flex justify-between items-center gap-2 py-1 w-full">
                    <span className="truncate flex items-center gap-1.5">
                      <ChevronDown size={11} style={{ color: P.brassText, transform: openGroups[gk] ? "none" : "rotate(-90deg)", transition: "transform .18s" }} />
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
            <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-3 mt-2">
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
                <button onClick={() => openPreview(noteFor.attachmentId, noteFor.attachmentName, noteFor)}
                  style={{ color: P.brassText }} className="text-xs inline-flex items-center gap-1 mt-2">
                  <Paperclip size={11} /> View filed invoice
                </button>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </section>
  );
}

/* ================= settle confirm: the actuals ================= */
function SettleModal({ kind, item, data, addCredit, action, onConfirm, onClose, bankTxns = [] }) {
  /* What is still owed, which is what the dialog is about.

     A bill half paid should open on the half that is left, not on the original
     figure. Typing over a number that is already wrong is a small tax on every
     instalment. */
  const alreadyPaid = Number(item.paidAmount) || 0;
  const outstanding = Math.max(0, Math.round((Math.abs(item.amount) - alreadyPaid) * 100) / 100);
  // Opens on what is left, so an instalment does not start by correcting a
  // figure that is already wrong.
  const [amount, setAmount] = useState(
    String(Math.max(0, Math.round((Math.abs(item.amount) - (Number(item.paidAmount) || 0)) * 100) / 100)),
  );
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
  /* A deposit on the bank that matches what is being marked received.

     Marking an invoice received asked for a document, which for money coming
     in means hunting for the remittance advice or photographing a screen. The
     bank statement already says the money arrived, on a date, for an amount.
     It is better evidence than a photograph and it is already here.

     Amount to the cent, within a fortnight of the date being entered, and
     only unmatched credits, so a line already explained by something else is
     never claimed twice. */
  /* An entry that already accounts for this money.

     Looked for before the bank, because it is the stronger finding: a bank
     line means the money arrived, an entry means it arrived and somebody has
     already written it down. Settling without noticing it writes a second
     one and overstates income.

     Not already spoken for: an entry another invoice has been settled against
     belongs to that invoice. */
  const claimedTxIds = useMemo(() => {
    const all = [...(data?.receivables || []), ...(data?.payables || [])];
    return new Set(all.map((o) => o.settledTxId).filter(Boolean));
  }, [data?.receivables, data?.payables]);

  /* Matches you have already rejected.

     An entry offered once and waved away should not come back every time the
     dialog opens. Kept against this obligation, so dismissing a wrong match
     for one bill does not hide a right one for another. */
  const [notThis, setNotThis] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`bt-not-match:${item.id}`) || "[]")); }
    catch { return new Set(); }
  });

  const dismissMatch = (txId) => {
    setNotThis((prev) => {
      const next = new Set(prev);
      next.add(txId);
      try { localStorage.setItem(`bt-not-match:${item.id}`, JSON.stringify([...next])); } catch { /* fine */ }
      return next;
    });
  };

  const alreadyInBooks = useMemo(() => {
    const owed = Math.abs(Number(item?.amount) || 0);
    const want = Math.abs(Number(parsed) || 0);
    if (!owed && !want) return null;
    const tol = arrivalTolerance(owed || want);
    const wantType = kind === "receivables" ? "income" : "expense";

    return (data?.transactions || []).find((t) => {
      if (t.type !== wantType) return false;
      if (claimedTxIds.has(t.id)) return false;
      if (notThis.has(t.id)) return false;
      const got = Math.abs(Number(t.amount) || 0);
      const matchesEntered = want && Math.abs(got - want) <= 0.005;
      const matchesInvoice = owed && owed - got >= -0.005 && owed - got <= tol;
      if (!matchesEntered && !matchesInvoice) return false;
      if (!t.date || !date) return true;
      return Math.abs(new Date(t.date) - new Date(date)) <= 14 * 864e5;
    }) || null;
  }, [data?.transactions, claimedTxIds, item?.amount, parsed, date, kind, notThis]);

  /* Does the entry name the same party as the bill?

     The amount matching is what finds a candidate, and the amount alone is a
     weak signal: two payments of $1,600 in one month is ordinary. An entry
     for Bilal Shafi offered against a bill from Syed Belal is almost
     certainly the wrong one, and the dialog should say so rather than present
     it with confidence. */
  const matchPartyAgrees = useMemo(() => {
    if (!alreadyInBooks) return true;
    const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    const want = norm(item.party);
    const text = `${norm(alreadyInBooks.description)} ${norm(alreadyInBooks.party)}`;
    if (!want || !text.trim()) return true;
    return want.split(" ").filter((w) => w.length >= 4).some((w) => text.includes(w));
  }, [alreadyInBooks, item?.party]);

  const bankProof = useMemo(() => {
    if (kind !== "receivables") return null;
    const want = Math.abs(Number(parsed) || 0);
    if (!want) return null;
    /* The invoice, not the amount in the box, is what a fee comes off. Match
       against what is owed and let the arriving figure be smaller. */
    const owed = Math.abs(Number(item?.amount) || want);
    const tol = arrivalTolerance(owed);
    return (bankTxns || []).find((b) => {
      if (b.direction !== "credit" || b.status === "matched" || b.status === "ignored") return false;
      if (notThis.has(b.id)) return false;
      const got = Math.abs(Number(b.amount) || 0);
      const shortOfEntered = Math.abs(got - want) <= 0.005;
      const shortOfInvoice = owed - got >= -0.005 && owed - got <= tol;
      if (!shortOfEntered && !shortOfInvoice) return false;
      if (!b.date || !date) return true;
      return Math.abs(new Date(b.date) - new Date(date)) <= 14 * 864e5;
    }) || null;
  }, [kind, parsed, date, bankTxns, notThis]);

  const valid = !Number.isNaN(parsed) && parsed > 0 && date && (doc || filedName || bankProof || alreadyInBooks);

  /* Paying less than what is left is a part payment, and the dialog says so
     rather than letting somebody discover it afterwards. */
  const partial = parsed > 0 && parsed < outstanding - 0.005;
  const remaining = partial ? Math.round((outstanding - parsed) * 100) / 100 : 0;

  /* When the rest is expected.

     An arrangement nobody wrote down is a bill that surprises you. Thirty days
     is a starting point rather than an assumption, and it is only asked for
     when the payment is actually short. */
  /* Whether the receipt goes to the supplier with the payment notice.

     On by default, because proof is the point of the notice and a supplier
     chasing a payment they cannot see wants to see it.

     Off is a real choice, though, and worth offering plainly: a payment
     receipt is very often a screenshot of your banking app, with your balance
     and somebody else's payments in the frame. Sending that to a contractor
     is a decision, not a detail, and nobody should discover they made it
     afterwards. */
  const [shareReceipt, setShareReceipt] = useState(true);

  const [balanceDue, setBalanceDue] = useState(() => {
    const d = new Date(Date.now() + 30 * 864e5);
    return d.toISOString().slice(0, 10);
  });

  const pickDoc = (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setDocErr(`That file is ${(file.size / 1048576).toFixed(1)} MB, max 8 MB. Try a smaller export or a screenshot.`);
      return;
    }
    setDocErr("");
    setDoc({ name: file.name || "receipt.png", type: file.type || attTypeFromName(file.name) || "application/octet-stream", file });
  };

  const confirm = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setDocErr("");
    try {
      await onConfirm({
      amount: parsed, date, payMethod, creditId, att: doc,
      bankId: bankProof?.id,
      existingTxId: alreadyInBooks?.id,
      balanceDue: partial ? balanceDue : undefined,
      shareReceipt,
    });
    } catch (e) {
      setDocErr(e?.message || "Something went wrong filing that. Try again.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div role="dialog" aria-modal="true" style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: elev(3), borderRadius: R.panel }} className="modal-panel w-full max-w-sm p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-1">
          <h3 style={{ fontFamily: SERIF }} className="text-xl">{action}</h3>
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
            <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="px-3 py-2 flex items-center gap-2">
              <Paperclip size={12} style={{ color: P.brassText }} className="shrink-0" />
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

          {/* Only for bills you are paying, and only when there is something to
            send. A receivable's receipt is yours and goes nowhere. */}
        {kind === "payables" && (doc || filedName) && (
          <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={shareReceipt}
              onChange={(e) => setShareReceipt(e.target.checked)}
              style={{ accentColor: P.brass, width: 17, height: 17, marginTop: 2 }}
              className="shrink-0"
            />
            <span className="min-w-0">
              <span style={{ color: P.text }} className="text-[14.5px] block">
                Send the receipt to them as proof
              </span>
              <span style={{ color: P.faint }} className="text-[13.5px]">
                Only if this bill came from an invoice request. Worth a look first if it is a screenshot of
                your banking app.
              </span>
            </span>
          </label>
        )}

        {(alreadyPaid > 0 || partial) && (
          <div
            style={{ background: P.surface2, borderRadius: 14 }}
            className="px-3.5 py-3 mt-2 text-[14.5px] leading-relaxed"
          >
            {alreadyPaid > 0 && (
              <div style={{ color: P.muted }}>
                {fmt(alreadyPaid)} of {fmt(Math.abs(item.amount))} already paid, {fmt(outstanding)} left.
              </div>
            )}
            {partial && (
              <>
                <div style={{ color: P.text }}>
                  This pays part of it. {fmt(remaining)} stays open and the bill closes when the rest
                  arrives.
                </div>
                <label
                  style={{ color: P.muted }}
                  className="text-[14px] flex flex-wrap items-center gap-2 mt-2.5"
                >
                  The rest is due
                  <input
                    type="date"
                    value={balanceDue}
                    onChange={(e) => setBalanceDue(e.target.value)}
                    style={{ background: P.surface, color: P.text, borderRadius: 11 }}
                    className="h-10 px-2.5 text-[14.5px] outline-none border-none"
                  />
                </label>
              </>
            )}
          </div>
        )}

        {/* The bank already saw it.

              Shown rather than silently accepted, because "why did this let me
              through without a receipt" is a fair question and the answer is a
              good one: a statement entry is stronger evidence than a
              photograph of a screen. */}
          {/* Already written down, so nothing new will be. */}
        {alreadyInBooks && (
          <div
            style={{ background: P.credit + "14", borderRadius: 14 }}
            className="flex items-start gap-3 p-3.5 mt-2"
          >
            <span
              aria-hidden
              style={{ background: P.credit + "22", color: P.credit, borderRadius: 10 }}
              className="w-8 h-8 flex items-center justify-center shrink-0"
            >
              <Check size={15} />
            </span>
            <span className="min-w-0">
              <span style={{ color: P.text }} className="text-[15px] block">
                This is already in your books
              </span>
              <span style={{ color: P.muted }} className="text-[14px]">
                {alreadyInBooks.description || alreadyInBooks.category} on {alreadyInBooks.date},{" "}
                {fmt(Math.abs(alreadyInBooks.amount))}.{" "}
                {/* The verb follows the direction. This said "marking
                    received" on a bill you are paying, which is the wrong
                    half of the transaction. */}
                {kind === "receivables" ? "Marking received" : "Marking paid"} will point this at that
                entry rather than adding a second one.
              </span>

              {/* The amount found it; the amount alone is a weak signal.

                  Two payments of the same figure in one month is ordinary, so
                  an entry naming a different party is probably a different
                  payment. Said plainly, above the button that dismisses it. */}
              {!matchPartyAgrees && (
                <span style={{ color: P.debit }} className="text-[14px] block mt-1.5">
                  That entry does not mention {item.party}, so it may well be a different payment of the
                  same amount.
                </span>
              )}

              <button
                type="button"
                onClick={() => dismissMatch(alreadyInBooks.id)}
                style={{ color: P.brassText }}
                className="text-[14px] underline decoration-dotted underline-offset-2 mt-1.5 block"
              >
                Not this one
              </button>
              {Math.abs(Math.abs(alreadyInBooks.amount) - parsed) > 0.005 && (
                <button
                  onClick={() => setAmount(String(Math.abs(alreadyInBooks.amount)))}
                  style={{ color: P.brassText }}
                  className="text-[14px] underline decoration-dotted underline-offset-2 mt-1 block"
                >
                  Use {fmt(Math.abs(alreadyInBooks.amount))} instead of {fmt(parsed)}
                </button>
              )}
            </span>
          </div>
        )}

        {!alreadyInBooks && bankProof && (
            <div
              style={{ background: P.credit + "14", borderRadius: 14 }}
              className="flex items-start gap-3 p-3.5 mt-2"
            >
              <span
                aria-hidden
                style={{ background: P.credit + "22", color: P.credit, borderRadius: 10 }}
                className="w-8 h-8 flex items-center justify-center shrink-0"
              >
                <Check size={15} />
              </span>
              <span className="min-w-0">
                <span style={{ color: P.text }} className="text-[15px] block">
                  The bank shows {fmt(Math.abs(bankProof.amount))} arriving on {bankProof.date}
                </span>
                {Math.abs(Math.abs(bankProof.amount) - parsed) > 0.005 && (
                  <button
                    onClick={() => setAmount(String(Math.abs(bankProof.amount)))}
                    style={{ color: P.brassText }}
                    className="text-[14px] underline decoration-dotted underline-offset-2"
                  >
                    Use {fmt(Math.abs(bankProof.amount))} instead of {fmt(parsed)}
                  </button>
                )}
                <span style={{ color: P.muted }} className="text-[14px]">
                  {(bankProof.description || "bank line").slice(0, 46)}. That is the evidence, so no receipt
                  is needed, and the two will be paired.
                </span>
                {/* Same reasoning as the entry above: found by amount, and an
                    amount is a weak signal on its own. */}
                <button
                  type="button"
                  onClick={() => dismissMatch(bankProof.id)}
                  style={{ color: P.brassText }}
                  className="text-[14px] underline decoration-dotted underline-offset-2 mt-1.5 block"
                >
                  Not this one
                </button>
              </span>
            </div>
          )}
          {filedName && !doc && (
            <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs mt-1.5 truncate">
              📎 {filedName} is already filed against this entry, that counts as evidence.
            </p>
          )}
        </div>

        {differs && (
          <p style={{ color: P.brassText, fontFamily: MONO }} className="text-xs mt-2">
            estimated {fmt(item.amount)} → actual {fmt(parsed)}; the books record the actual
          </p>
        )}
        {docErr && <p style={{ color: P.brassText }} className="text-xs mt-2">{docErr}</p>}

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
function CreditsCard({ data, addCredit, updateCredit, delCredit, readOnly = false }) {
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

  // Every entry logged against a pool, so the page can show what the credits
  // actually paid for rather than only what is left of them.
  const spent = data.transactions
    .filter((t) => isCredits(t) && t.type === "expense")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 style={{ fontFamily: SERIF }} className="text-xl">Credit pools</h2>
          <p style={{ color: P.muted }} className="text-[15px]">Non-cash coverage, tracked beside cash.</p>
        </div>
        {adding ? (
          <button onClick={() => setAdding(false)} style={{ color: P.muted }} className="text-[15px] px-2 shrink-0">Cancel</button>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill }}
            className="px-4 py-2.5 text-[15px] font-medium inline-flex items-center gap-2 shrink-0 press"
          >
            <Plus size={16} /> New pool
          </button>
        )}
      </div>

      {adding && (
        <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-3 mb-3 grid sm:grid-cols-4 gap-2 items-end">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="MongoDB credits" /></div>
          <div><Label>Granted</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" /></div>
          <div><Label>Already used (before the app)</Label><Input type="number" value={used} onChange={(e) => setUsed(e.target.value)} placeholder="0" /></div>
          <Btn className="justify-center" onClick={submit}><Check size={14} /> Add pool</Btn>
        </div>
      )}

      {pools.length === 0 && !adding ? (
        <EmptyState compact icon={Coins} title="No credit pools yet">Add one with +, or pick "add a credit pool" inside any Paid via dropdown.</EmptyState>
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
              <div key={c.id} style={cardStyle()} className="p-5">
                <div className="flex justify-between items-start gap-2">
                  <button onClick={() => { setEditingId(c.id); setEdit({ name: c.name, initial: String(c.initial), usedAdjustment: String(c.usedAdjustment || 0) }); }} className="text-left min-w-0" style={{ color: P.text }} title="Edit this pool">
                    <span style={{ fontFamily: SERIF }} className="text-xl block truncate">{c.name}</span>
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setEditingId(c.id); setEdit({ name: c.name, initial: String(c.initial), usedAdjustment: String(c.usedAdjustment || 0) }); }} style={{ color: P.faint, padding: 6, margin: -6 }} title="Edit"><Pencil size={12} /></button>
                    <button
                      onClick={async () => {
                        const ok = await askConfirm({
                          title: `Remove the ${c.name} pool?`,
                          body: "Entries already paid from it keep their credit tag.",
                          confirmLabel: "Remove pool",
                        });
                        if (ok) delCredit(c.id);
                      }}
                      style={{ color: P.faint, padding: 6, margin: -6 }}
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                {/* What is left leads, and what it is left of trails it on the
                    same line, so the pair reads as one fact. */}
                <div className="flex items-baseline gap-2.5 mt-4 flex-wrap">
                  <span style={{ fontFamily: MONO, color: remaining > 0 ? P.credit : P.debit }} className="text-[30px] tabular-nums leading-none">
                    {fmt0(remaining)}
                  </span>
                  <span style={{ color: P.muted }} className="text-[15px]">left of {fmt0(c.initial)}</span>
                </div>

                {/* The bar shows what has gone, not what remains: a pool you
                    have barely touched should read as barely touched. */}
                <div className="h-2 rounded-full overflow-hidden mt-4" style={{ background: P.surface2 }}>
                  <div style={{ width: `${Math.max(usedPct, usedPct > 0 ? 3 : 0)}%`, background: P.brass }} className="h-full rounded-full" />
                </div>

                <div className="flex items-baseline justify-between gap-3 mt-4 pt-4" style={{ borderTop: `1px solid ${P.line}` }}>
                  <span style={{ color: P.text }} className="text-[15px]">Used so far</span>
                  <span style={{ fontFamily: MONO, color: P.faint }} className="text-[15px] tabular-nums">
                    {fmt0((c.usedAdjustment || 0) + tracked)}
                  </span>
                </div>
                {((c.usedAdjustment || 0) > 0 || committed > 0) && (
                  <div style={{ color: P.faint }} className="text-[13.5px] mt-1.5">
                    {(c.usedAdjustment || 0) > 0 ? `${fmt0(c.usedAdjustment)} before the app, ${fmt0(tracked)} logged here` : ""}
                    {(c.usedAdjustment || 0) > 0 && committed > 0 ? " · " : ""}
                    {committed > 0 ? `${fmt0(committed)} committed in open payables` : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* A pool's balance says how much is left. This says what it bought,
          which is the half of the story the old page never showed. */}
      {spent.length > 0 && (
        <>
          <div className="flex items-baseline justify-between gap-3 mt-10 mb-4">
            <h2 style={{ fontFamily: SERIF }} className="text-xl">Paid with credits</h2>
            <span style={{ color: P.faint }} className="text-[14px]">
              {fmt0(spent.reduce((a, b) => a + b.amount, 0))} across {spent.length} {spent.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <div style={cardStyle()} className="px-5 py-2">
            {/* All of them. The count is in the header above; capping the list
                as well means a credit you spent is simply not on the page. */}
            {spent.map((t, i) => (
              <div
                key={t.id}
                className="flex items-center gap-4 py-3"
                style={i === 0 ? {} : { borderTop: `1px solid ${P.line}` }}
              >
                <span style={{ fontFamily: MONO, color: P.faint }} className="text-[13.5px] w-14 shrink-0">
                  {t.date?.slice(5)}
                </span>
                <span className="flex-1 min-w-0">
                  <span style={{ color: P.text }} className="text-[15px] block truncate">{t.description || t.category}</span>
                  <span style={{ color: P.faint }} className="text-[13.5px]">
                    {creditName(data, t.creditId)} · non-cash
                  </span>
                </span>
                <span style={{ fontFamily: MONO, color: P.muted }} className="text-[15px] tabular-nums shrink-0">
                  {fmt(t.amount)}
                </span>
              </div>
            ))}
          </div>
          <p style={{ color: P.faint }} className="text-[14px] mt-3">
            None of these moved cash, so they stay out of the balance and out of money out.
          </p>
        </>
      )}
    </>
  );
}

/* ================= cash calendar: list + month-grid views ================= */
function CashCalendar({ data }) {
  const [view, setView] = useState("grid"); // grid | list. A calendar opens on
  // the calendar: the shape of the month is the thing you came for, and the
  // list is the same data read one line at a time.
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
      {isCredits(o) && <span style={{ fontFamily: MONO, color: P.brassText, border: `1px solid ${P.brass}` }} className="text-xs rounded px-1">{creditName(data, o.creditId)}</span>}
      <div style={{ fontFamily: MONO, color: o.kind === "receivables" ? P.credit : P.debit }} className="text-sm tabular-nums">
        {o.kind === "receivables" ? "+" : "−"}{fmt(o.amount)}
      </div>
    </div>
  );

  const ViewToggle = () => (
    <Segmented
      size="sm"
      value={view}
      onChange={setView}
      options={[{ value: "grid", label: "Calendar" }, { value: "list", label: "List" }]}
    />
  );

  /* ---------- what is coming, in both views ----------
     The two figures belong to the page, not to whichever way you are reading
     it. They used to live inside the list branch, so switching to the month
     grid dropped them. */
  /* The horizon starts from the day you are looking at.

     It was anchored on today whatever you clicked, so the figures sat
     unchanged while the calendar moved underneath them, which reads as broken
     rather than deliberate. Clicking the 20th should answer "what happens in
     the month after the 20th".

     And it was a plain expression, so a new horizon was built on every render
     and the cards flickered for no reason. */
  const horizonFrom = selectedDay || today;
  const { horizonEnd, horizonOcc } = useMemo(() => {
    const d = new Date(`${horizonFrom}T00:00:00`);
    d.setDate(d.getDate() + span);
    const end = d.toISOString().slice(0, 10);
    return { horizonEnd: end, horizonOcc: occurrencesBetween(data, horizonFrom, end, today) };
  }, [data, horizonFrom, span, today]);
  const ahead = horizonOcc.filter((o) => !o.overdue);
  const aheadIn = ahead.filter((o) => o.kind === "receivables" && !isCredits(o)).reduce((s, o) => s + o.amount, 0);
  const aheadOut = ahead.filter((o) => o.kind === "payables" && !isCredits(o)).reduce((s, o) => s + o.amount, 0);
  const aheadInCount = ahead.filter((o) => o.kind === "receivables").length;
  const aheadOutCount = ahead.filter((o) => o.kind === "payables").length;

  const HorizonCards = () => (
    <div className="grid sm:grid-cols-2 gap-3">
      {/* The day you picked, above the grid rather than below it.
          A month of boxes is tall, so a detail card underneath sits off the
          bottom of the screen on a phone: you tap a date and nothing appears
          to happen. The answer belongs between the question and the thing you
          asked it of. */}
      {selectedDay && (
        <section style={cardStyle()} className="p-5">
          <h2 style={{ fontFamily: SERIF }} className="text-xl mb-1">
            {new Date(selectedDay + "T00:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}
          </h2>
          {dayItems.length === 0 ? (
            <EmptyState compact icon={CalendarDays} title="Nothing due this day" />
          ) : (
            <div className="divide-y" style={{ borderColor: P.line }}>
              {dayItems.map((o, i) => <div key={i} style={{ borderColor: P.line }}><Row o={o} /></div>)}
            </div>
          )}
        </section>
      )}

      <div style={cardStyle()} className="p-5">
        <div style={{ color: P.text }} className="text-[15px] mb-2.5">
            {/* Say which day it counts from, or the figure looks like it is
                ignoring you. */}
            Expected in, {span} days from {horizonFrom === today ? "today" : horizonFrom}
          </div>
        <div style={{ fontFamily: MONO, color: P.credit }} className="text-[30px] tabular-nums leading-none">{fmt0(aheadIn)}</div>
        <div style={{ color: P.faint }} className="text-[14px] mt-4">
          {aheadInCount} {aheadInCount === 1 ? "receivable" : "receivables"}
        </div>
      </div>
      <div style={cardStyle()} className="p-5">
        <div style={{ color: P.text }} className="text-[15px] mb-2.5">
            Expected out, {span} days from {horizonFrom === today ? "today" : horizonFrom}
          </div>
        <div style={{ fontFamily: MONO, color: P.debit }} className="text-[30px] tabular-nums leading-none">{fmt0(aheadOut)}</div>
        <div style={{ color: P.faint }} className="text-[14px] mt-4">
          {aheadOutCount} {aheadOutCount === 1 ? "payable and recurring cost" : "payables and recurring costs"}
        </div>
      </div>
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
    const inCount = upcoming.filter((o) => o.kind === "receivables").length;
    const outCount = upcoming.filter((o) => o.kind === "payables").length;
    const byDate = upcoming.reduce((m, o) => { (m[o.due] = m[o.due] || []).push(o); return m; }, {});
    const dates = Object.keys(byDate).sort();
    const prettyDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });

    return (
      <div className="space-y-6 stagger">
        <HorizonCards />

        <div style={cardStyle()} className="p-5">
          <div className="flex flex-wrap justify-between items-center gap-4 mb-3">
            <div style={{ color: P.muted }} className="text-[15px]">
              Net over {span} days
              <span style={{ fontFamily: MONO, color: cashIn - cashOut >= 0 ? P.credit : P.debit }} className="ml-2 tabular-nums">
                {fmt(cashIn - cashOut)}
              </span>
            </div>
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
          <section style={cardStyle({ tone: "debit" })} className="p-5">
            <h2 style={{ fontFamily: SERIF, color: P.debit }} className="text-xl mb-1">Overdue</h2>
            <div className="divide-y" style={{ borderColor: P.line }}>
              {overdue.map((o, i) => <div key={i} style={{ borderColor: P.line }}><Row o={o} /></div>)}
            </div>
          </section>
        )}

        <section style={cardStyle()} className="p-5">
          <h2 style={{ fontFamily: SERIF }} className="text-xl mb-2">Next {span} days</h2>
          {dates.length === 0 ? (
            <EmptyState compact icon={CalendarDays} title="Nothing due in this window">Recurring receivables and payables project here automatically once you add them.</EmptyState>
          ) : (
            <div className="space-y-3">
              {dates.map((d) => (
                <div key={d}>
                  <div style={{ fontFamily: MONO, color: d === today ? P.brass : P.faint, borderBottom: `1px solid ${P.line}` }} className="text-[14px] pb-1 mb-1">
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
    <div className="space-y-6 stagger">
      <HorizonCards />

      <div style={cardStyle()} className="p-5">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Btn tone="ghost" onClick={() => { setGridMonth(shiftMonth(gridMonth, -1)); setSelectedDay(null); }}>‹</Btn>
            <div className="text-[15px] w-40 text-center">{monthLabel(gridMonth)}</div>
            <Btn tone="ghost" onClick={() => { setGridMonth(shiftMonth(gridMonth, 1)); setSelectedDay(null); }}>›</Btn>
          </div>
          <div style={{ color: P.faint }} className="text-[14px] flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden style={{ background: P.credit, width: 7, height: 7, borderRadius: "50%" }} />
              <span style={{ fontFamily: MONO, color: P.credit }} className="tabular-nums">{fmt0(monthIn)}</span> in
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden style={{ background: P.debit, width: 7, height: 7, borderRadius: "50%" }} />
              <span style={{ fontFamily: MONO, color: P.debit }} className="tabular-nums">{fmt0(monthOut)}</span> out
            </span>
          </div>
          <ViewToggle />
        </div>

        <div className="grid grid-cols-7 gap-2 mb-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} style={{ color: P.faint }} className="text-[14px] text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {cells.map((date, i) => {
            if (!date) return <div key={i} style={{ background: "transparent", minHeight: 108 }} />;
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
                // A day with something on it lifts onto the card surface; an
                // empty day stays part of the ground. That inversion is what
                // makes the month scannable without reading a single figure.
                style={{
                  background: items.length || isSel ? P.surface : P.surface2,
                  border: `1px solid ${isSel || isToday ? P.brass : "transparent"}`,
                  boxShadow: items.length && !isSel ? elev(1) : "none",
                  borderRadius: 14,
                  minHeight: 108,
                }}
                className="p-3 text-left flex flex-col"
                title={items.length ? `${items.length} ${items.length === 1 ? "item" : "items"} on ${date}` : date}
              >
                <div className="flex items-center gap-1.5">
                  <span style={{ color: isToday ? P.brassText : items.length ? P.text : P.faint }} className="text-[15px]">
                    {Number(date.slice(8))}
                  </span>
                </div>
                {/* One dot per direction. The amounts are a tap away in the day
                    panel; on the grid they turned every cell into a receipt. */}
                <div className="flex items-center gap-1.5 mt-1.5">
                  {dayIn > 0 && <span aria-hidden style={{ background: P.credit, width: 7, height: 7, borderRadius: "50%" }} />}
                  {dayOut > 0 && <span aria-hidden style={{ background: P.debit, width: 7, height: 7, borderRadius: "50%" }} />}
                  {items.some(isCredits) && <span aria-hidden style={{ background: P.brass, width: 7, height: 7, borderRadius: "50%" }} title="includes credits" />}
                </div>
                <div className="flex-1" />
                {isSel && (
                  <div style={{ color: P.faint }} className="text-[13px]">
                    {items.length} {items.length === 1 ? "item" : "items"}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {!selectedDay && (
        <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs text-center">tap a day to see what's due · brass underline = credits involved</p>
      )}
    </div>
  );
}

/* ================= Reports & analytics =================
   Every other tab answers "how am I doing right now". This one answers "give me
   the period, as a file", which is the question you get from an accountant, a
   lender, or a co-founder, and the one the app used to make you assemble by hand
   out of a month-by-month P&L. Pick a window, read the figures on screen, hand any
   block over as a CSV or a PDF.

   Nothing here is a second source of truth: every number is recomputed from
   data.transactions the same way the P&L computes it, just over a wider window. */

const REPORT_RANGES = [
  ["this-month", "This month"],
  ["last-month", "Last month"],
  ["3", "Last 3 months"],
  ["6", "Last 6 months"],
  ["12", "Last 12 months"],
  ["ytd", "Year to date"],
  ["fy", "Fiscal year"],
  ["all", "All time"],
];

const lastDayOf = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};

/** [start, end, label] for a range key, as ISO dates. */
function reportWindow(range, month, fye, txs) {
  const end = lastDayOf(month);
  const span = (fromMonth) => [`${fromMonth}-01`, end];
  switch (range) {
    case "last-month": {
      const prev = shiftMonth(month, -1);
      return [`${prev}-01`, lastDayOf(prev)];
    }
    case "3": return span(shiftMonth(month, -2));
    case "6": return span(shiftMonth(month, -5));
    case "12": return span(shiftMonth(month, -11));
    case "ytd": return [`${month.slice(0, 4)}-01-01`, end];
    case "fy": {
      // The fiscal year the month on screen falls inside, not the calendar one.
      const y = Number(month.slice(0, 4));
      return fiscalWindow(fye, end.slice(5) <= fye ? y : y + 1);
    }
    case "all": {
      const dates = txs.map((t) => t.date).filter(Boolean).sort();
      return [dates[0] || `${month}-01`, dates[dates.length - 1] || end];
    }
    default: return span(month);
  }
}

function ReportsTab({ data, month, balance, onAsk }) {
  const [range, setRange] = useState("this-month");
  const fye = data.ledger.fye || "12-31";
  const stamp = data.ledger.name.replace(/[^\w]+/g, "");

  const r = useMemo(() => {
    const [from, to] = reportWindow(range, month, fye, data.transactions);
    // plExclude is what the P&L honours (owner draws and the like), so the
    // statement here matches that tab rather than quietly disagreeing with it.
    const tx = data.transactions.filter((t) => t.date >= from && t.date <= to && !t.plExclude);
    const revenue = tx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const costs = tx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const recurring = tx.filter((t) => t.type === "expense" && isRec(t)).reduce((s, t) => s + t.amount, 0);
    const onCredits = tx.filter((t) => t.type === "expense" && isCredits(t)).reduce((s, t) => s + t.amount, 0);

    // Months the window actually touches, so "per month" divides by the right
    // number and a partial first month still shows up as a bar.
    const months = [];
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) {
      const mt = tx.filter((t) => t.date.startsWith(m));
      const inc = mt.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
      const exp = mt.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
      months.push({ m, inc, exp, net: inc - exp, count: mt.length });
      if (months.length > 240) break; // an unparseable date can't run away with the loop
    }

    const byCat = {};
    tx.filter((t) => t.type === "expense").forEach((t) => {
      byCat[t.category] = byCat[t.category] || { amount: 0, count: 0 };
      byCat[t.category].amount += t.amount;
      byCat[t.category].count += 1;
    });
    const cats = Object.entries(byCat)
      .map(([name, v]) => ({ name, ...v, share: costs > 0 ? (v.amount / costs) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);

    const byIncomeCat = {};
    tx.filter((t) => t.type === "income").forEach((t) => {
      byIncomeCat[t.category] = (byIncomeCat[t.category] || 0) + t.amount;
    });

    const net = revenue - costs;
    return {
      from, to, tx, revenue, costs, recurring, onCredits, net,
      margin: revenue > 0 ? (net / revenue) * 100 : null,
      months, cats,
      incomeCats: Object.entries(byIncomeCat).sort((a, b) => b[1] - a[1]),
      perMonth: months.length ? net / months.length : 0,
      burnPerMonth: months.length ? costs / months.length : 0,
    };
  }, [data.transactions, range, month, fye]);

  const label = `${longDate(r.from)} to ${longDate(r.to)}`;
  const obs = useMemo(() => obligationsView(data, { status: "all", limit: 100 }), [data]);
  const rec = useMemo(() => recurringCosts(data), [data]);

  /* ---- the exports ----
     One shape per report: a name, a line saying what's in it, and the buttons
     that produce it. Everything is generated on the device from state already
     in memory, so nothing here needs the network. */
  const statementRows = () => [
    { name: "Revenue", amount: r.revenue },
    { name: "Costs and expenses", amount: -r.costs },
    // Only worth a line when there is something on it. A statement full of
    // zeroes reads as a broken export rather than a quiet month.
    ...(r.recurring > 0 ? [
      { name: "of which recurring", amount: -r.recurring },
      { name: "of which one-time", amount: -(r.costs - r.recurring) },
    ] : []),
    ...(r.onCredits > 0 ? [{ name: "of which covered by credits (non-cash)", amount: -r.onCredits }] : []),
    { name: `Net ${r.net >= 0 ? "profit" : "loss"}`, amount: r.net, strong: true, final: true },
  ];

  const exportStatementCSV = () => {
    downloadCSV(`Statement_${stamp}_${r.from}_${r.to}.csv`, [
      [`Income statement, ${data.ledger.name}`, label],
      [],
      ...statementRows().map((x) => [x.name, x.amount.toFixed(2)]),
      ["Margin", r.margin !== null ? `${r.margin.toFixed(1)}%` : "n/a"],
      ["Average net per month", r.perMonth.toFixed(2)],
      ["Average spend per month", r.burnPerMonth.toFixed(2)],
      [],
      ["Income by category"],
      ...r.incomeCats.map(([c, v]) => [c, v.toFixed(2)]),
      [],
      ["Expenses by category", "Amount", "Share of costs", "Entries"],
      ...r.cats.map((c) => [c.name, c.amount.toFixed(2), `${c.share.toFixed(1)}%`, c.count]),
    ]);
  };

  const exportStatementPDF = () => {
    formPdf({
      filename: `Statement_${stamp}_${r.from}_${r.to}.pdf`,
      formTitle: "Income statement",
      formSub: `${data.ledger.name} · ${label}`,
      banner: "",
      footer: `Prepared in Brasstally · ${todayStr()} · cash basis, from the ${data.ledger.name} ledger`,
      codeWidth: 0,
      ident: [
        ["Ledger", `${data.ledger.name} (${kindLabel(data.ledger.kind)})`],
        ["Period", label],
        ["Currency", data.ledger.currency || "CAD"],
        ["Entries", String(r.tx.length)],
      ],
      columns: ["", "Line", "Amount"],
      rows: [
        ...statementRows(),
        { section: "Expenses by category" },
        ...r.cats.map((c) => ({ name: `${c.name} (${c.share.toFixed(0)}%)`, amount: -c.amount })),
        { name: "Total expenses", amount: -r.costs, strong: true },
        { section: "By month" },
        ...r.months.map((m) => ({ name: monthLabel(m.m), amount: m.net })),
      ],
      note: (r.onCredits > 0 ? `${pdfMoney(r.onCredits)} of the expenses above were covered by credit pools and never moved cash. ` : "")
        + "Cash basis: open receivables and payables are not included until they settle. "
        + `Open at the time of writing: ${fmt(obs.receivables?.items.filter((i) => i.status === "open").reduce((s, i) => s + i.amount, 0) || 0)} owed to the ledger, `
        + `${fmt(obs.payables?.items.filter((i) => i.status === "open").reduce((s, i) => s + i.amount, 0) || 0)} owed out.`,
    });
  };

  const exportTransactionsCSV = () => {
    downloadCSV(`Transactions_${stamp}_${r.from}_${r.to}.csv`, [
      [`Transactions, ${data.ledger.name}`, label],
      [],
      ["Date", "Description", "Category", "Subcategory", "Type", "Frequency", "Paid with", "Receipt", "Amount"],
      ...[...r.tx]
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .map((t) => [
          t.date, t.description, t.category, t.subcategory || "", t.type,
          isRec(t) ? "Recurring" : "One-time", isCredits(t) ? "Credits" : "Cash",
          t.attachmentId ? (t.attachmentName || "yes") : "",
          (t.type === "income" ? t.amount : -t.amount).toFixed(2),
        ]),
    ]);
  };

  const exportMonthlyCSV = () => {
    downloadCSV(`Monthly_${stamp}_${r.from}_${r.to}.csv`, [
      [`Month by month, ${data.ledger.name}`, label],
      [],
      ["Month", "Income", "Expenses", "Net", "Entries"],
      ...r.months.map((m) => [m.m, m.inc.toFixed(2), (-m.exp).toFixed(2), m.net.toFixed(2), m.count]),
    ]);
  };

  const exportObligationsCSV = () => {
    const rows = ["receivables", "payables"].flatMap((k) =>
      (obs[k]?.items || []).map((i) => [
        k === "receivables" ? "Owed to you" : "You owe",
        i.party, i.description || "", i.dueDate || "", i.status,
        i.settledOn || "", i.daysOverdue || "", i.recurring ? "Recurring" : "One-time",
        i.amount.toFixed(2),
      ]),
    );
    downloadCSV(`AR_AP_${stamp}_${todayStr()}.csv`, [
      [`Receivables and payables, ${data.ledger.name}`, `as at ${longDate(todayStr())}`],
      [],
      ["Side", "Party", "Description", "Due", "Status", "Settled on", "Days overdue", "Frequency", "Amount"],
      ...rows,
    ]);
  };

  const exportRecurringCSV = () => {
    downloadCSV(`Recurring_${stamp}_${todayStr()}.csv`, [
      [`Recurring costs, ${data.ledger.name}`, `as at ${longDate(todayStr())}`],
      [],
      ["Merchant", "Category", "Latest amount", "Latest date", "Times seen", "Last price change", "Paid with"],
      ...rec.subscriptions.map((s) => [
        s.name, s.category, s.latestAmount.toFixed(2), s.latestDate, s.occurrences,
        s.priceChanged ? `${s.priceChanged.change >= 0 ? "+" : ""}${s.priceChanged.change.toFixed(2)} on ${s.priceChanged.on}` : "",
        s.paidWith,
      ]),
      [],
      ["Scheduled obligations"],
      ["Side", "Party", "Amount", "Frequency", "Next due", "Monthly equivalent"],
      ...rec.scheduledObligations.map((s) => [
        s.kind === "receivables" ? "Owed to you" : "You owe",
        s.party, s.amount.toFixed(2), s.frequency, s.nextDue || "", s.monthlyEquivalent.toFixed(2),
      ]),
    ]);
  };

  const reports = [
    {
      title: "Income statement",
      sub: `Revenue, costs, and net for the period, with the category breakdown behind it.`,
      csv: exportStatementCSV, pdf: exportStatementPDF,
    },
    {
      title: "Transaction ledger",
      sub: `Every one of the ${r.tx.length} ${r.tx.length === 1 ? "entry" : "entries"} in the period, with category, frequency, and whether a receipt is filed.`,
      csv: exportTransactionsCSV,
    },
    {
      title: "Month by month",
      sub: `Income, expenses, and net for each of the ${r.months.length} ${r.months.length === 1 ? "month" : "months"} in the window.`,
      csv: exportMonthlyCSV,
    },
    {
      title: "Receivables and payables",
      sub: "Every open and settled obligation as it stands today, with ageing. Not period-bound, because what is owed is owed now.",
      csv: exportObligationsCSV,
    },
    {
      title: "Recurring costs",
      sub: `${rec.subscriptions.length} recurring ${rec.subscriptions.length === 1 ? "charge" : "charges"} grouped by merchant, plus every scheduled obligation and what it costs a month.`,
      csv: exportRecurringCSV,
    },
  ];

  const maxMonth = Math.max(...r.months.flatMap((m) => [m.inc, m.exp]), 1);
  const maxCat = Math.max(...r.cats.map((c) => c.amount), 1);

  return (
    <div className="space-y-6 stagger">
      <section style={cardStyle()} className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52">
            <Label>Period</Label>
            <Select value={range} onChange={(e) => setRange(e.target.value)}>
              {REPORT_RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </div>
          <div className="flex-1 min-w-40">
            <div style={{ color: P.faint, fontFamily: MONO }} className="text-xs">{label}</div>
            <div style={{ color: P.muted }} className="text-sm">
              {r.tx.length} {r.tx.length === 1 ? "entry" : "entries"} across {r.months.length} {r.months.length === 1 ? "month" : "months"}
            </div>
          </div>
          <Btn tone="ghost" onClick={exportStatementPDF} title="The income statement for this period as a PDF">
            <FileText size={14} /> Statement PDF
          </Btn>
        </div>
      </section>

      <section style={cardStyle()} className="p-5">
        <h2 style={{ fontFamily: SERIF }} className="text-xl mb-3">The period in six numbers</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatTile label="Revenue" value={fmt(r.revenue)} hint={`${r.incomeCats.length} ${r.incomeCats.length === 1 ? "source" : "sources"}`} />
          <StatTile label="Costs" value={fmt(r.costs)} hint={r.onCredits > 0 ? `${fmt(r.onCredits)} on credits` : `${r.cats.length} ${r.cats.length === 1 ? "category" : "categories"}`} />
          <StatTile label={`Net ${r.net >= 0 ? "profit" : "loss"}`} value={fmt(r.net)} hint={r.margin !== null ? `${r.margin.toFixed(0)}% margin` : "no revenue"} />
          <StatTile label="Spend per month" value={fmt(r.burnPerMonth)} hint={`over ${r.months.length} ${r.months.length === 1 ? "month" : "months"}`} />
          <StatTile label="Net per month" value={fmt(r.perMonth)} hint={r.perMonth >= 0 ? "building" : "drawing down"} />
          <StatTile label="Balance today" value={fmt(balance?.value ?? 0)} hint={balance?.source === "bank" ? "from the bank" : "from the books"} />
        </div>
        {r.recurring > 0 && (
          <p style={{ color: P.faint }} className="text-xs mt-3">
            {fmt(r.recurring)} of the costs are recurring, {fmt(r.costs - r.recurring)} one-time.
          </p>
        )}
      </section>

      <section style={cardStyle()} className="p-5">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h2 style={{ fontFamily: SERIF }} className="text-xl">Month by month</h2>
          <div className="flex items-center gap-3 text-xs" style={{ color: P.faint, fontFamily: MONO }}>
            <span className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 2, background: P.credit, display: "inline-block" }} /> income</span>
            <span className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 2, background: P.debit, display: "inline-block" }} /> expense</span>
          </div>
        </div>
        {r.months.length === 0 || maxMonth === 0 ? (
          <p style={{ color: P.faint }} className="text-[15px]">
            {r.months.length === 0
              ? "Nothing recorded in this period."
              : "No money moved in this period, so there is nothing to chart yet."}
          </p>
        ) : (
          /* A twelve-month window scrolls sideways, and a scroll container clips
             in both axes, so the bar tooltips need room reserved above them.
             Columns stop stretching past 72px, because one month spread across
             the full width does not read as a chart. */
          <div className="flex items-end gap-2 overflow-x-auto pt-7 pb-1" style={{ minHeight: 128 }}>
            {r.months.map((m, i) => (
              <div key={m.m} style={{ minWidth: 34, maxWidth: 72 }} className="flex-1">
                <TrendBar index={i} t={m} maxTrend={maxMonth} active={m.m === month} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={cardStyle()} className="p-5">
        <h2 style={{ fontFamily: SERIF }} className="text-xl mb-3">Where the money went</h2>
        {r.cats.length === 0 ? (
          <p style={{ color: P.faint }} className="text-sm">No expenses in this period.</p>
        ) : (
          <div className="space-y-2">
            {r.cats.map((c, i) => (
              <CatBarRow key={c.name} index={i} cat={c.name} value={c.amount} max={maxCat} count={c.count} shareOfCosts={c.share} />
            ))}
          </div>
        )}
      </section>

      <section style={cardStyle()} className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <div>
            <h2 style={{ fontFamily: SERIF }} className="text-xl leading-tight">Export</h2>
            <p style={{ color: P.muted }} className="text-sm">
              Built on your device from what is already on screen. CSV opens anywhere; PDF is the one you send.
            </p>
          </div>
        </div>
        <div className="divide-y mt-3" style={{ borderColor: P.line }}>
          {reports.map((rep) => (
            <div key={rep.title} className="py-3 flex items-start gap-3 flex-wrap" style={{ borderColor: P.line }}>
              <div className="flex-1 min-w-48">
                <div style={{ color: P.text }} className="text-sm">{rep.title}</div>
                <p style={{ color: P.faint }} className="text-xs mt-0.5">{rep.sub}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Btn tone="ghost" onClick={rep.csv}><Download size={13} /> CSV</Btn>
                {rep.pdf && <Btn tone="ghost" onClick={rep.pdf}><FileText size={13} /> PDF</Btn>}
              </div>
            </div>
          ))}
        </div>
        <p style={{ color: P.faint }} className="text-xs mt-3">
          Filing a return is next door under Connectors, where the same figures are mapped onto CRA's own schedules.
        </p>
      </section>

      {onAsk && (
        <section style={cardStyle()} className="p-5">
          <h2 style={{ fontFamily: SERIF }} className="text-xl mb-1">Ask about the period</h2>
          <p style={{ color: P.muted }} className="text-sm mb-3">Tally reads the same entries these figures came from.</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              `Summarise ${longDate(r.from)} to ${longDate(r.to)}: what changed, and what should I do about it?`,
              "Which categories grew the most over this period, and why?",
              "What are my recurring costs totalling a year, and which ones went up?",
            ].map((q) => (
              <button key={q} type="button" onClick={() => onAsk(q)}
                style={{ background: P.surface2, color: P.text, borderRadius: 12 }}
                className="px-3.5 py-2.5 text-[14.5px] text-left leading-snug">
                {q}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ================= floating dock button ================= */
function DockBtn({ label, active, onClick, children, dot }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      type="button"
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className="dock-btn relative rounded-full flex items-center justify-center shrink-0"
      style={{
        color: active ? "#10120C" : P.muted,
        background: active ? P.brass : "transparent",
        transform: hover && !active ? "translateY(-2px)" : "none",
        transition: "background .25s ease, color .25s ease, transform .18s cubic-bezier(.2,.8,.2,1)",
      }}
    >
      {children}
      {dot && (
        <span
          aria-hidden
          style={{
            position: "absolute", top: 6, right: 6, width: 8, height: 8,
            borderRadius: "50%", background: P.brass,
            boxShadow: `0 0 0 2px ${P.surface}`,
          }}
        />
      )}
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
  overview: ["Your month at a glance", "Planned versus actual, per category. Tap a planned amount to set a budget, tap a category name to see the entries behind it, and tap Tally in the corner to capture receipts or ask about balance drift."],
  transactions: ["Every entry lives here", "Add one manually, import a whole bank statement, or use Transfer to move money between your ledgers. Tap the pencil on any row to edit it, and the paperclip to file its receipt."],
  pl: ["Your profit and loss", "Switch between business, personal, and combined scope. Owner draws are excluded, credit-paid costs get their own line, and Export produces a CSV your accountant can use as is."],
  arap: ["Who owes you, who you owe", "Upload an invoice and the fields fill themselves. Recurring items queue their next occurrence automatically when you settle them. Tap any open item to edit everything about it."],
  credits: ["Money that isn't cash", "Pools for AWS credits, compute credits, and the like. Anything paid via a pool draws the pool down instead of your bank balance. Tap a pool to edit it, including credits used before you started tracking."],
  calendar: ["What's coming due", "List view shows the next 30 or 90 days. Calendar view is a month grid, and recurring items are projected onto their future dates. Tap a day to see what lands on it."],
  integrations: ["The outside world", "Connect your bank with Plaid right here, and new transactions arrive in a review you confirm. Tax drafts map your year onto CRA's forms, compute deadlines, and prep the accountant email."],
  reports: ["The year, as a file", "Pick a period and the whole ledger is cut to it: the statement, the months behind it, and where the money went. Every block exports as a CSV your spreadsheet opens or a PDF you can send."],
};

function TourCard({ tab, onDismiss, asPanel }) {
  const copy = TOUR_COPY[tab];
  if (!copy) return null;
  return (
    <div
      style={asPanel ? { padding: 16 } : { ...cardStyle(), borderLeft: `3px solid ${P.brass}` }}
      className={asPanel ? "flex items-start gap-3" : "rounded-lg p-4 mb-5 flex items-start gap-3"}
    >
      <div className="flex-1">
        <div style={{ color: P.brassText }} className="text-[14px] font-medium mb-1">First time here</div>
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
    <div role="dialog" aria-modal="true" style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: elev(3), borderRadius: R.panel }} className="modal-panel w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
          <Segmented
            full
            value={kind}
            onChange={setKind}
            options={[{ value: "business", label: "Business" }, { value: "personal", label: "Personal" }]}
          />
          <p style={{ color: P.faint }} className="text-xs mt-2">
            {kind === "business" ? "A Business Ledger starts with revenue, salaries, software, and hosting categories, and unlocks the CRA T2 draft." : "A Personal Ledger starts with home, food, and transport categories, and keeps your own money out of the company's books."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Current balance</Label><Input type="number" value={bal} onChange={(e) => setBal(e.target.value)} placeholder="0.00" /></div>
          <div><Label>As of</Label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
        </div>
        <Btn className="w-full" size="lg" loading={busy} disabled={!name.trim()} onClick={submit}>
          {!busy && <Check size={15} />} Create ledger
        </Btn>
        {onboarding && (
          <button onClick={onSignOut} style={{ color: P.faint, fontFamily: MONO }} className="w-full text-center text-xs underline decoration-dotted">sign out</button>
        )}
      </div>
    </div>
  );

  if (onboarding)
    return (
      <div style={{ background: P.bg, minHeight: "100dvh", fontFamily: SANS, color: P.text }} className="flex items-center justify-center p-4">
        {body}
      </div>
    );
  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      {body}
    </div>
  );
}

/* ================= getting started =================
   Four things have to be true before the app is worth anything: a ledger, a
   bank feed, an entry, and something to compare spending against. Nobody reads
   a welcome tour, so this is not one. It is the four things, each a button that
   does the thing, and it disappears on its own once they are done. */

function SetupChecklist({ data, bankConns, onGo, openGuide, onDismiss, asPanel }) {
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
      sub: "Photograph a receipt, or just type what you paid. Either way Tally reads the amount, the merchant, and the date for you.",
      action: ["Show Tally", () => onGo("capture")],
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
    <section
      style={asPanel ? { padding: 16 } : cardStyle({ tone: "brass", level: 2 })}
      className={asPanel ? "" : "p-5 mb-6"}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 style={{ fontFamily: SERIF }} className="text-xl leading-tight">Getting set up</h2>
          <p style={{ color: P.muted }} className="text-sm">
            {doneCount} of {steps.length} done.{asPanel ? "" : " This card goes away by itself."}
          </p>
        </div>
        <button onClick={onDismiss} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2 shrink-0">
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

/* Form-styled PDF: line codes, right-ruled amounts, parenthesized negatives.
   Built for CRA schedules, which is why the banner and footer say "draft" by
   default, the Reports tab prints its own statements through here and passes
   its own, and sets codeWidth to 0 for a sheet with no line-code column. */
const pdfMoney = (n) => (n < 0 ? "(" : "") + Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (n < 0 ? ")" : "");

function formPdf({
  filename, formTitle, formSub, ident, columns, rows, note,
  banner = "DRAFT · for preparation only",
  footer = `Prepared in Brasstally · ${todayStr()} · draft for use with CRA-certified software, not a filed return`,
  codeWidth = 24,
}) {
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const W = 215.9, L = 16, R = W - 16, NX = L + codeWidth;
  let y = 18;
  const hr = (yy, dark) => { doc.setDrawColor(dark ? 60 : 150); doc.setLineWidth(dark ? 0.4 : 0.2); doc.line(L, yy, R, yy); };
  const pageBreak = () => { if (y > 260) { doc.addPage(); y = 18; } };

  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(formTitle, L, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  if (banner) doc.text(banner, R, y, { align: "right" });
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
  if (codeWidth) doc.text(columns[0], L, y);
  doc.text(columns[1], NX, y);
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
    if (r.code && codeWidth) doc.text(String(r.code), L, y);
    doc.text(doc.splitTextToSize(r.name, R - NX - 26)[0], NX, y);
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
    doc.text(footer, L, 279);
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
        style={{ background: P.brass + "22", border: `1px solid ${P.brass}`, color: P.brassText, fontFamily: MONO, width: 24, height: 24 }}
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
          <div style={{ color: P.faint }} className="text-[14px]">Next up</div>
          <div style={{ fontFamily: SERIF }} className="text-xl leading-tight">{next.title}</div>
          <div style={{ fontFamily: MONO, color: P.brassText }} className="text-sm">{longDate(next.date)}</div>
        </div>
        <div style={{ color: P[TONE[c.tone]] || P.text, border: `1px solid ${P[TONE[c.tone]] || P.line}`, fontFamily: MONO }}
          className="rounded-full px-3 py-1 text-sm whitespace-nowrap">
          {c.text}
        </div>
      </div>
      <div style={{ color: P.muted }} className="text-xs mt-1">{next.sub}</div>

      {rows.length > 1 && (
        <div style={{ borderTop: `1px solid ${P.line}` }} className="mt-3 pt-2 space-y-1">
          <div style={{ color: P.faint }} className="text-[14px] mb-1">{title}</div>
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
          <span style={{ fontFamily: MONO, color: P.brassText }} className="text-xs">{f.code}</span>
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
            style={{ fontFamily: MONO, color: P.brassText }} className="text-xs underline decoration-dotted underline-offset-2 whitespace-nowrap">
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
    <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-4">
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
        <p style={{ color: P.brassText }} className="text-xs mt-2">{separate.note}</p>
      )}

      {changed > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowDiff(!showDiff)} style={{ color: P.brassText }} className="text-[13.5px] underline decoration-dotted underline-offset-2">
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
                <div key={"m" + f.code} style={{ fontFamily: MONO, color: P.brassText }} className="text-xs">
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
                <span style={{ color: P.brassText }} className="text-[14px] font-medium">{title}</span>
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
            <span style={{ fontFamily: MONO, color: P.brassText }} className="w-20 shrink-0">{f.code}</span>
            <span className="flex-1 min-w-0"><span style={{ color: P.text }}>{f.name}</span> <span style={{ color: P.muted }}>{f.when}</span></span>
          </div>
        ))}
      </div>

      <p style={{ color: P.faint }} className="text-xs mt-3">
        Version list read from CRA's own form pages. <a href={CRA_FORMS_INDEX} target="_blank" rel="noreferrer" style={{ color: P.brassText }} className="underline decoration-dotted">CRA forms and publications ↗</a>
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
    <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-4">
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
                <Paperclip size={11} style={{ color: P.brassText }} /> {f.name}
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
            {!valid && <p style={{ color: P.brassText }} className="text-xs">Add their email address above to open the draft.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function IntegrationsTab({ data, updateLedgerMeta, onSynced, onConnectionsChange, openGuide, onReview, syncedAt = 0 }) {
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
    formPdf({
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
    <div className="space-y-6 stagger">
      <BankFeedCard data={data} onSynced={onSynced} onConnectionsChange={onConnectionsChange} openGuide={openGuide} onReview={onReview} syncedAt={syncedAt} />

      {/* ---------- CRA: T2 for business ledgers, T1 for personal ---------- */}
      {!isBiz ? <PersonalTaxCard data={data} openGuide={openGuide} /> : (
      <section style={cardStyle()} className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 style={{ fontFamily: SERIF }} className="text-xl leading-tight">Corporate tax, T2</h2>
            <p style={{ color: P.muted }} className="text-[15px]">GIFI draft, deadlines, and the filing route for {fy}.</p>
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

            <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-4">
              <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                <Label>Schedule 125 · income statement (GIFI) · {fyStart} → {fyEnd}</Label>
                <div className="flex gap-2">
                  <Btn tone="ghost" onClick={copyDraft}>{copied ? <Check size={13} /> : null} {copied ? "Copied" : "Copy"}</Btn>
                  <Btn tone="ghost" onClick={exportGifiCSV}><Download size={13} /> CSV</Btn>
                  <Btn tone="ghost" onClick={exportGifiPDF}><FileText size={13} /> PDF</Btn>
                </div>
              </div>
              {fyTx.length === 0 ? (
                <EmptyState compact icon={FileText} title="No business activity">Nothing is recorded in this fiscal year yet.</EmptyState>
              ) : (
                <div className="divide-y" style={{ borderColor: P.line }}>
                  {gifiRows.map((r) => (
                    <div key={r.code + r.name} className="flex items-center gap-3 py-1.5" style={{ borderColor: P.line }}>
                      <span style={{ fontFamily: MONO, color: P.brassText }} className="text-xs w-12 shrink-0">{r.code}</span>
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
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div role="dialog" aria-modal="true" style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: elev(3), borderRadius: R.panel }} className="modal-panel w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
              <ArrowLeftRight size={16} style={{ color: P.brassText }} className="mt-4 shrink-0" />
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
/* Why a feed is behind, answered in the app.
 *
 * The diagnosis existed, but only as a console command, and asking somebody to
 * paste JSON out of DevTools to find out why their bank is stale is a support
 * process rather than a product. Everything it needs is one call away.
 *
 * It reads the Item rather than our own records, because our records are the
 * thing under suspicion. What Plaid says it holds, what products the Item was
 * granted, and what the sync actually delivered, side by side.
 */
function FeedDiagnosis({ rows, env, onClose }) {
  const Verdict = ({ r }) => {
    const products = r.item?.billed_products || [];
    const noTransactions = Array.isArray(products) && products.length > 0
      && !products.includes("transactions");
    const expired = r.item?.consent_expiration && r.item.consent_expiration < new Date().toISOString();
    const itemError = r.item?.error;

    const lines = [];
    if (itemError) lines.push([`Plaid reports ${itemError} on this connection`, P.debit]);
    if (noTransactions) {
      lines.push([
        `This connection was never granted the transactions product. It can return balances and nothing else, which is why the balance moves and the list does not.`,
        P.debit,
      ]);
    }
    if (expired) lines.push([`Consent expired on ${String(r.item.consent_expiration).slice(0, 10)}.`, P.debit]);
    if (!lines.length && r.newest) {
      lines.push([`Plaid holds ${r.total_available} lines in this window, newest ${r.newest}.`, P.muted]);
    }
    if (!lines.length) lines.push(["Plaid returned nothing for this window.", P.debit]);
    return (
      <>
        {lines.map(([t, c], i) => (
          <p key={i} style={{ color: c }} className="text-[14.5px] leading-relaxed mt-1">{t}</p>
        ))}
      </>
    );
  };

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title="Why a feed is behind"
      panelClass="flex flex-col"
      panelStyle={{ maxHeight: "88vh" }}
    >
      <ModalBody className="overflow-y-auto min-h-0 flex-1">
        <p style={{ color: P.muted }} className="text-[15px] pb-3">
          Read from Plaid just now, not from our records, because our records are the thing in doubt.
          {env && (
            <span style={{ color: P.faint }} className="block text-[13.5px] mt-1">
              {/* The tier is on screen because a masked secret cannot be read
                  in the dashboard, and it changes how long a sign-in lasts. */}
              Plaid {env}
              {env !== "production" && ", where sign-ins expire sooner than in production"}
            </span>
          )}
        </p>

        {(rows || []).map((r, i) => (
          <div key={i} className="py-3" style={{ borderTop: `1px solid ${P.line}` }}>
            <div className="flex items-baseline justify-between gap-3">
              <span style={{ color: P.text }} className="text-[15.5px]">
                {r.institution || "Bank"}
                <span style={{ color: P.faint }} className="text-[13.5px]"> &middot; {r.ledger}</span>
              </span>
              <span style={{ fontFamily: MONO, color: P.faint }} className="text-[14px] shrink-0">
                {r.newest || "nothing"}
              </span>
            </div>

            <Verdict r={r} />

            <div style={{ color: P.faint }} className="text-[13px] mt-2 leading-relaxed">
              products {Array.isArray(r.item?.billed_products) ? r.item.billed_products.join(", ") : "unknown"}
              {" · "}last synced {String(r.last_synced || "never").slice(0, 16)}
              {r.has_cursor ? " · has a cursor" : " · no cursor"}
              {r.accounts?.length ? ` · ${r.accounts.length} account${r.accounts.length === 1 ? "" : "s"}` : ""}
            </div>

            {r.dates?.length > 0 && (
              <div style={{ color: P.faint }} className="text-[13px] mt-1">
                dates Plaid holds: {r.dates.join(", ")}
              </div>
            )}
            {r.error && (
              <p style={{ color: P.debit }} className="text-[14px] mt-1">{r.error}</p>
            )}
          </div>
        ))}

        {(rows || []).length > 1 && (
          <p style={{ color: P.faint }} className="text-[13px] mt-4 pt-3" >
            Two connections to the same bank behaving differently is the useful comparison: it rules out
            the bank and points at whichever one of them differs above.
          </p>
        )}
      </ModalBody>
    </Modal>
  );
}

function BankFeedCard({ data, onSynced, onConnectionsChange, openGuide, onReview, syncedAt = 0 }) {
  const [plaidEnv, setPlaidEnv] = useState("");
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
  /* Checking health costs money.

     `check_status` calls Plaid's /item/get once per connection, and it ran
     every time this card mounted, which is every visit to Connectors. That is
     a metered call for a question that changes about as often as a bank
     changes its mind: a connection that was healthy an hour ago is healthy
     now, and when it is not, the next sync says so anyway.

     Once every six hours, remembered across reloads, and always on demand
     when somebody presses the button. */
  const HEALTH_EVERY_MS = 6 * 60 * 60 * 1000;

  /* Ask Plaid what it holds, and show the answer here.

     This was a console command, which means the one moment somebody needs it
     is the one moment they are least likely to run it. */
  const [diagnosis, setDiagnosis] = useState(null);
  const [diagnosing, setDiagnosing] = useState(false);

  const runDiagnosis = async () => {
    setDiagnosing(true);
    try {
      // Every connection, not just this ledger: two Items on one bank
      // behaving differently is the most useful thing the answer can contain.
      const out = await bank.plaid("probe", { days: 10 });
      setDiagnosis(out?.accounts || []);
      setPlaidEnv(out?.env || "");
    } catch (e) {
      setErr(e?.message || "Could not reach Plaid just now.");
    }
    setDiagnosing(false);
  };

  const refreshHealth = async ({ force = false } = {}) => {
    const key = `bt-bank-health:${data.ledger.id}`;
    if (!force) {
      try {
        const last = Number(localStorage.getItem(key) || 0);
        if (last && Date.now() - last < HEALTH_EVERY_MS) return;
      } catch { /* no store, fall through and check */ }
    }
    try { localStorage.setItem(key, String(Date.now())); } catch { /* fine */ }
    try {
      const st = await bank.checkStatus(data.ledger.id);
      if (st?.env) setPlaidEnv(st.env);
      
      await refreshConns();
    } catch { /* health is a nicety; never block the card on it */ }
  };

  const finishConnect = async (public_token, metadata, ledgerId) => {
    // No institution name in update mode: send null rather than "Bank" so the
    // server keeps the name already stored instead of overwriting it.
    const res = await bank.plaid("exchange", {
      public_token,
      ledger_id: ledgerId,
      institution: metadata?.institution?.name || null,
    });
    setResumable(false);
    const list = await refreshConns();

    /* Fetch, rather than ask them to.

       Restoring the sign-in and then saying "tap Sync now" asks somebody to do
       the only thing they reconnected for. Worse, the daily limit I added to
       keep Plaid calls down would then skip the automatic refresh, because an
       attempt had already been recorded that day, so a freshly reconnected
       bank stayed empty until tomorrow.

       A reconnect is a person asking for their data, which outranks a limit
       meant for background work. The marker is cleared so the morning pass is
       not confused by it either. */
    try {
      const morning = bank.lastMorningBoundary().toISOString().slice(0, 10);
      localStorage.removeItem(`bt-bank-pass:${morning}`);
    } catch { /* no store, nothing to clear */ }

    setNotice(res?.reconnected ? "Sign-in restored. Fetching what you missed." : "Connected. Fetching your transactions.");

    let pulled = 0;
    for (const c of list || []) {
      if (res?.connection_id && c.id !== res.connection_id) continue;
      try {
        const out = await bank.plaid("sync", { connection_id: c.id });
        pulled += Number(out?.added) || 0;
      } catch (e) {
        setErr(e?.message || "Connected, but the first fetch failed. Try Sync now.");
      }
    }

    await refreshConns();
    onSynced?.();
    setNotice(
      pulled > 0
        ? `${pulled} ${pulled === 1 ? "line" : "lines"} fetched. They are in review, nothing is in your books yet.`
        : "Up to date. Nothing new since the last sync.",
    );
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
  /* Reloaded when the app syncs in the background, not only when the
       ledger changes. The morning refresh updated the connection and this card
       kept showing the timestamp it read on mount, so a feed that had just run
       still claimed to be two days old. */
    }, [data.ledger.id, syncedAt]);

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
  // from connect() on purpose, linking the bank again would create a second
  // connection, which double-counts the balance and re-imports every line.
  const reconnect = async (id) => {
    setErr(""); setNotice(""); setBusy(true);
    try {
      const redirect_uri = bank.plaidRedirectUri();
      const { link_token, oauth, oauth_error } = await bank.plaid(
        "create_link_token", { redirect_uri, connection_id: id },
      );

      /* An OAuth bank cannot be reconnected without the redirect.

         The server falls back to a link token with no redirect when the URI is
         not allowlisted, which is right for a bank that authenticates inside
         Link. RBC and the other Canadian banks send you to their own site and
         back, so without it the session cannot complete: Link appears to
         succeed, the item stays in its expired state, and the next sync says
         sign-in expired again.

         That is a reconnect loop with nothing on screen to explain it, so it
         stops here and says what to fix rather than opening a door that leads
         nowhere. */
      if (!oauth && oauth_error) {
        /* A warning, not a refusal.

           I made this a hard stop, on the belief that an OAuth bank cannot
           complete without an allowlisted redirect. Plaid's own documentation
           says otherwise: on desktop and mobile web, Link opens the bank in a
           pop-up and finishes without one.

           So the stop was wrong, and worse than wrong. Reconnect did nothing,
           which left Connect as the only button that appeared to work, and
           Connect creates a **new Item** every time. That is the daily
           re-authentication: a fresh Item each day, none of them repaired,
           none of them carrying the cursor that makes a sync resume. */
        console.warn("OAuth redirect not allowlisted, continuing without it:", oauth_error);
      }
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
      // still deployed, its cursor has already moved past these lines, say so
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
    const ok = await askConfirm({
      title: "Disconnect this bank?",
      body: "New transactions stop syncing. Entries you already imported stay in the ledger.",
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    try {
      await bank.plaid("disconnect", { connection_id: id });
      const next = (conns || []).filter((x) => x.id !== id);
      setConns(next);
      onConnectionsChange?.(next);
    } catch (e) { setErr(String(e.message || e)); }
  };

  return (
    <section style={cardStyle()} className="p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 style={{ fontFamily: SERIF }} className="text-xl leading-tight">Bank feed</h2>
          <p style={{ color: P.muted }} className="text-[15px]">Connections belong to this ledger. Each ledger links its own accounts.</p>
        </div>
        <div className="flex items-center gap-2">
          <GuideAnchor id="bank-feed" onOpen={openGuide} label={connected ? "Something wrong?" : "Help me connect"} />
          {/* A filled tint rather than an outline: the state is the point, and
              a hairline pill in mono read as a build flag. */}
          <span
            style={{
              background: conns?.length ? P.credit + "1f" : P.surface2,
              color: conns?.length ? P.credit : P.faint,
              borderRadius: R.pill,
            }}
            className="text-[14px] px-3 py-1 whitespace-nowrap"
          >
            {conns === null ? "Checking" : conns.length ? "Connected" : "Not connected"}
          </span>
        </div>
      </div>

      {conns?.length > 0 && (
        <div className="mt-4 space-y-2">
          {conns.map((c) => {
            const stale = bank.needsReconnect(c);
            return (
            <div key={c.id} style={{ background: P.surface2, border: stale ? `1px solid ${P.debit}` : "none", borderRadius: 16 }} className="p-4 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-[16px] truncate" style={{ color: P.text }}>{c.institution || "Bank"}</div>
                <div style={{ color: P.faint }} className="text-[14px] mt-0.5">
                  {/* Whether it is current, not only when it ran.

                      "Today at 7:02 a.m." is a fact and leaves the actual
                      question unanswered: is this figure the one I should be
                      looking at? A sync at 6am today is before the morning
                      boundary and therefore yesterday's picture, and the
                      timestamp alone makes it look fresh. */}
                  {c.last_synced
                    ? `${bank.isStale({ lastSyncedAt: c.last_synced }) ? "Last synced" : "Up to date, synced"} ${stamp(c.last_synced)}`
                    : "Never synced"}
                  {/* A development Item is short-lived by design, so repeated
                      expiry on this tier is the tier rather than the bank. */}
                  {plaidEnv && plaidEnv !== "production" && bank.needsReconnect(c) && (
                    <span style={{ color: P.faint }}>
                      {" "}&middot; on Plaid {plaidEnv}, where sign-ins expire sooner than in production
                    </span>
                  )}
                  {Array.isArray(c.accounts) && c.accounts.length
                    ? ` · ${c.accounts.length} ${c.accounts.length === 1 ? "account" : "accounts"}`
                    : ""}
                  {c.current_balance != null ? ` · ${fmt(Number(c.current_balance))}` : ""}
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
                : <button
                    onClick={() => sync(c.id)}
                    disabled={syncing === c.id}
                    style={{ background: P.surface, color: P.text, borderRadius: R.pill, boxShadow: elev(1) }}
                    className="px-4 py-2.5 text-[15px] font-medium inline-flex items-center gap-2 shrink-0 press"
                  >
                    {syncing === c.id ? <Loader2 size={15} className="animate-spin" /> : null} Sync now
                  </button>}

              {/* Why is this behind.

                  It asks Plaid what it actually holds, and reads the Item's
                  own products and consent rather than our records, because our
                  records are the thing in doubt when a feed stops moving. */}
              <button
                onClick={runDiagnosis}
                disabled={diagnosing}
                style={{ color: P.brassText }}
                className="text-[14px] px-2 press shrink-0"
              >
                {diagnosing ? "Checking" : "Why behind?"}
              </button>

              <button onClick={() => disconnect(c.id)} style={{ color: P.faint, padding: 6, margin: -6 }} title="Disconnect"><Trash2 size={13} /></button>
            </div>
            );
          })}
        </div>
      )}

      {diagnosis && (
        <FeedDiagnosis rows={diagnosis} env={plaidEnv} onClose={() => setDiagnosis(null)} />
      )}

      {/* Connecting is a one-time act. Once a bank is on the card, offering
          "Connect a bank" again reads as "add another account" and is the
          fastest way to end up with the same account linked twice, which
          double-counts the balance. It comes back when the last one is removed. */}
      <div className="mt-4">
        {connected ? (
          <p style={{ color: P.faint }} className="text-[14px]">
            {conns.length === 1 ? "This ledger is connected to your bank." : `This ledger is connected to ${conns.length} banks.`} Remove one with the bin icon to connect a different bank.
          </p>
        ) : (
          <>
            <button
              onClick={connect}
              disabled={busy}
              style={{ background: P.brass, color: P.onbrass, borderRadius: R.pill, opacity: busy ? 0.6 : 1 }}
              className="px-5 py-3 text-[15px] font-medium inline-flex items-center gap-2 press"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Connect a bank
            </button>
            <p style={{ color: P.faint }} className="text-[14px] mt-3">
              You sign in with your own bank. Brasstally never sees the password.
            </p>
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
        <button onClick={() => setShowSetup(!showSetup)} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2 mt-4">
          {showSetup ? "hide" : "show"} one-time server setup
        </button>
      )}
      {showSetup && !connected && (
        <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-3 mt-2 space-y-1.5">
          {[
            ["1", "Run supabase/migration-bank-connections.sql and supabase/migration-bank-balances.sql in the SQL Editor"],
            ["2", "Edge Functions: add secrets PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV (sandbox to test, production when approved)"],
            ["3", "Deploy the function: Edge Functions, New function, name it exactly \"plaid\", paste supabase/functions/plaid/index.ts, Deploy"],
            ["4", `In the Plaid Dashboard → Team Settings → API, add Allowed redirect URI: ${typeof window !== "undefined" ? window.location.origin + "/" : "https://your-site/"}`],
            ["5", "Reload this page and tap Connect a bank. Console warnings about WebGPU/WASM from Plaid's own scripts are harmless, so ignore them."],
          ].map(([n, t]) => (
            <div key={n} className="flex gap-2 text-sm" style={{ color: P.muted }}>
              <span style={{ fontFamily: MONO, color: P.brassText }}>{n}.</span><span>{t}</span>
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
    formPdf({
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
    <section style={cardStyle()} className="p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 style={{ fontFamily: SERIF }} className="text-xl leading-tight">Personal tax (T1)</h2>
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
          <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-4">
            <button onClick={() => setShowForms(!showForms)} className="w-full text-left flex items-center gap-2">
              <ChevronRight size={13} style={{ color: P.faint, transform: showForms ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
              <Label>What a T1 is made of</Label>
            </button>
            {showForms ? (
              <div className="mt-1">
                {T1_PACKAGE.map((f) => (
                  <div key={f.code} className="flex items-start gap-2 py-1.5" style={{ borderTop: `1px solid ${P.line}` }}>
                    <span style={{ fontFamily: MONO, color: P.brassText }} className="text-xs w-24 shrink-0">{f.code}</span>
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

          <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-4">
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
                    {/* A GIFI section heading is a heading, not a stamp. Weight
                        separates it from its lines; capitals and tracking made
                        the statement read like a receipt printer. */}
                    <span className={"flex-1 truncate " + (v === null ? "text-[14px] font-medium" : strong ? "text-sm font-medium" : "text-sm")}
                      style={{ color: v === null ? P.text : strong ? P.text : P.muted }}>
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
      <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-4">
        <Label>Filing</Label>
        <p style={{ color: P.faint, fontFamily: MONO }} className="text-xs">checking…</p>
      </div>
    );
  }

  return (
    <div style={{ background: P.bg, border: `1px solid ${P.line}`, borderRadius: R.control }} className="p-4">
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
      <div className="flex items-start gap-3 mb-5">
        {FILING_STATUSES.map(([k, label], i) => (
          <button key={k} onClick={() => save({ status: k })} className="flex-1 text-left min-w-0" title={`Mark as ${label}`}>
            <div style={{ height: 5, borderRadius: 99, background: i <= statusIdx ? P.brass : P.surface2 }} />
            <div style={{ color: i <= statusIdx ? P.text : P.faint }} className="text-[14px] mt-2 truncate">{label}</div>
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
              <button onClick={() => setPicking(true)} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2">change</button>
            </div>
          )}
          {route === "accountant" && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm">Filed by your accountant</div>
                <div style={{ fontFamily: MONO, color: P.faint }} className="text-xs truncate">{accountantEmail || "add their email below"}</div>
              </div>
              <button onClick={() => save({ route: null, software: null })} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2">change</button>
            </div>
          )}

          {(route === "software" ? softwareSteps(form, sw || list[0]) : accountantSteps(form)).map(([t, b], i) => (
            <div key={i} className="flex gap-2 mb-2">
              <span style={{ fontFamily: MONO, color: P.brassText }} className="text-sm shrink-0">{i + 1}.</span>
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
                <button onClick={() => setRecording(true)} style={{ color: P.faint }} className="text-[13.5px] underline decoration-dotted underline-offset-2">edit</button>
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
function AccountModal({ theme, setTheme, onSignOut, onResetLedger, ledgerName, onClose, asPage }) {
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    setMsg(error ? error.message : `Password link sent to ${email}.`);
  };
  const replayTours = () => {
    Object.keys(window.localStorage).filter((k) => k.startsWith("tour:")).forEach((k) => window.localStorage.removeItem(k));
    setMsg("Tutorials will show again on each tab.");
  };

  const Section = ({ title, children }) => (
    <div style={{ borderTop: `1px solid ${P.line}` }} className="pt-4 mt-4">
      <div style={{ color: P.brassText }} className="text-[14px] font-medium mb-2">{title}</div>
      {children}
    </div>
  );

  const body = (
    <>
        {!asPage && (
          <div className="flex justify-between items-start">
            <h3 style={{ fontFamily: SERIF }} className="text-xl">Account</h3>
            <button onClick={onClose} style={{ color: P.muted }} className="p-1"><X size={16} /></button>
          </div>
        )}

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
            <Pill solid tone="brass" mono>Early access</Pill>
            <span style={{ color: P.muted }} className="text-sm">Free · founding member</span>
          </div>
          <p style={{ color: P.faint }} className="text-xs mt-2">Unlimited ledgers while Brasstally is in early access. When paid plans arrive, founding members hear first, and your books stay yours either way.</p>
        </Section>

        <Section title="Billing">
          <p style={{ color: P.muted }} className="text-sm">Nothing to bill yet. Cards, invoices, and receipts will live here when plans launch.</p>
        </Section>

        <Section title="Settings">
          {/* The appearance switch used to sit here as well. Settings owns the
              theme now, with a real toggle and the four palettes beside it, and
              two switches for one setting is two places for it to look wrong. */}
          <div className="space-y-2">
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

        <div style={{ borderTop: `1px solid ${P.line}` }} className="pt-4 mt-4 space-y-2" data-account-actions>
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
    </>
  );

  // On the phone there is no Settings section to navigate to, so it stays a
  // sheet. Where the rail has room, the same content is a page like any other.
  if (asPage) {
    return (
      <div className="space-y-6 stagger">
        <div style={cardStyle()} className="p-5 max-w-2xl">{body}</div>
      </div>
    );
  }

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: P.overlay }} onClick={onClose}>
      <div role="dialog" aria-modal="true" style={{ background: P.surface, border: `1px solid ${P.line}`, boxShadow: elev(3), borderRadius: R.panel }} className="modal-panel w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  );
}
