// The finance agent: tool definitions, their executors, and the loop.
//
// The loop runs in the browser. That's deliberate — the whole ledger is already
// in memory here, so a tool call is a synchronous function over an array
// instead of a database round trip, and only the slice a tool actually returns
// is ever sent upstream.
//
// Writes are proposals, never actions. A propose_* tool renders a confirmation
// card into the transcript and reports back that it is waiting on the user; the
// model is told, in the system prompt and in every tool result, not to claim
// anything was saved.

import * as A from "./analysis";
import { askClaudeAgent } from "./extract";
import { guideBrief } from "./guides";

/* ================= tool schemas ================= */

const monthProp = { type: "string", description: "Month as YYYY-MM. Defaults to the month on screen." };
const dateProp = { type: "string", description: "Date as YYYY-MM-DD." };

export const TOOLS = [
  {
    name: "ledger_overview",
    description:
      "Headline state of the ledger: balance (bank and books), the anchor it counts from, open AR/AP totals, category names, credit pools, bank connection status, and the date range of the data. Call this first when you don't yet know the shape of the ledger.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_transactions",
    description:
      "Search and total transactions. Every filter is optional and they combine. Use this for 'what did I spend on X', 'show me entries over $500', or to see the entries behind any figure. Returns at most 100 rows plus totals over the full match set.",
    input_schema: {
      type: "object",
      properties: {
        month: monthProp,
        from: { ...dateProp, description: "Start of a date range (inclusive), YYYY-MM-DD." },
        to: { ...dateProp, description: "End of a date range (inclusive), YYYY-MM-DD." },
        type: { type: "string", enum: ["expense", "income"] },
        category: { type: "string", description: "Exact category name, from ledger_overview." },
        subcategory: { type: "string" },
        search: { type: "string", description: "Free text matched against description, category, and subcategory." },
        minAmount: { type: "number" },
        maxAmount: { type: "number" },
        paidWith: { type: "string", enum: ["cash", "credits"], description: "Credit-paid entries are real spend but never move the bank balance." },
        sort: { type: "string", enum: ["date_desc", "date_asc", "amount_desc", "amount_asc"] },
        limit: { type: "number", description: "1-100, default 40." },
      },
    },
  },
  {
    name: "category_variance",
    description:
      "Planned versus actual for every category in a month, sorted worst-variance first, with the categories that have spend but no budget called out. Use for 'am I over budget' and 'where did the month go'.",
    input_schema: { type: "object", properties: { month: monthProp } },
  },
  {
    name: "monthly_trend",
    description:
      "Income, expense, and net per month over a window, with averages that exclude the incomplete current month. Optionally narrowed to one category. Use for 'is this normal', 'how has X changed', and anything comparing months.",
    input_schema: {
      type: "object",
      properties: {
        months: { type: "number", description: "How many months back, 1-24. Default 6." },
        endMonth: monthProp,
        category: { type: "string" },
        type: { type: "string", enum: ["expense", "income"] },
      },
    },
  },
  {
    name: "category_shifts",
    description:
      "Categories whose spend this month moved most against their own recent average. Use to find what actually changed before explaining a total.",
    input_schema: {
      type: "object",
      properties: {
        month: monthProp,
        lookback: { type: "number", description: "Months of baseline, default 3." },
        minAmount: { type: "number", description: "Ignore moves smaller than this. Default 25." },
      },
    },
  },
  {
    name: "obligations",
    description:
      "Receivables and payables with aging buckets, days overdue, and totals. Use for 'who owes me', 'what do I owe', collections, and anything about due dates.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["receivables", "payables"], description: "Omit for both." },
        status: { type: "string", enum: ["open", "paid", "all"], description: "Default open." },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "balance_breakdown",
    description:
      "How the balance is built: the anchor, cash in and out since it, what the credit-paid entries excluded, and the bank-versus-books delta with the usual causes. This is the tool for any question about drift, reconciling, or 'why doesn't my balance match'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "find_duplicates",
    description:
      "Scans for the same amount charged twice within a few days with similar descriptions, each pair scored and labelled with its likely cause. Duplicates are the most common reason books read higher than the bank.",
    input_schema: {
      type: "object",
      properties: {
        windowDays: { type: "number", description: "How far apart two entries can be. Default 6." },
        minAmount: { type: "number", description: "Ignore small entries. Default 5." },
      },
    },
  },
  {
    name: "consolidation_history",
    description:
      "Past consolidation runs on this ledger: when each one ran, what it matched, what it added to the books, what it set aside, and which duplicates it removed, plus whether the gap showing right now has already been worked through. Use this before telling anyone to reconcile, and for any question about what was done to the books and when.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "How many runs to return, newest first. Default 10." } },
    },
  },
  {
    name: "recurring_costs",
    description:
      "Recurring spend grouped by merchant with price-change history, plus scheduled recurring AR/AP normalized to a monthly figure. Use for subscription audits and fixed-cost questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cash_forecast",
    description:
      "Projects the balance forward using dated AR/AP plus the recent monthly average, with a timeline of what lands when and a runway figure. Use for 'can I afford', 'will I make payroll', and any forward-looking question.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Horizon in days, 7-365. Default 60." } },
    },
  },
  {
    name: "data_quality",
    description:
      "Bookkeeping hygiene: entries in catch-all categories, large expenses with no receipt filed, blank descriptions, obligations with no due date. Use for 'is my ledger ready for taxes' or clean-up requests.",
    input_schema: {
      type: "object",
      properties: {
        month: { ...monthProp, description: "Omit to scan all time." },
        receiptThreshold: { type: "number", description: "Expenses at or above this need a receipt. Default 100." },
      },
    },
  },

  /* ---- proposals: these draw a card, they do not write ---- */
  {
    name: "propose_transaction",
    description:
      "Draws a confirmation card for a new transaction. Nothing is saved until the user taps it. Use when the user describes money that already moved. For money that hasn't moved yet, use propose_obligation instead.",
    input_schema: {
      type: "object",
      properties: {
        date: dateProp,
        amount: { type: "number", description: "Always positive." },
        type: { type: "string", enum: ["expense", "income"] },
        category: { type: "string", description: "Must be an exact category name from ledger_overview." },
        subcategory: { type: "string" },
        description: { type: "string", description: "Merchant or payer, cleaned up." },
        recurrence: { type: "string", enum: ["once", "recurring"] },
        reason: { type: "string", description: "One line on why you're proposing this, shown on the card." },
      },
      required: ["amount", "type", "category", "description"],
    },
  },
  {
    name: "propose_obligation",
    description:
      "Draws a confirmation card for a receivable (someone owes the user) or a payable (the user owes). Nothing is saved until the user taps it.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["receivables", "payables"] },
        party: { type: "string", description: "Who owes, or who is owed." },
        description: { type: "string" },
        amount: { type: "number" },
        dueDate: dateProp,
        recurrence: { type: "string", enum: ["once", "recurring"] },
        frequency: { type: "string", enum: ["weekly", "biweekly", "monthly", "quarterly", "yearly"] },
        reason: { type: "string" },
      },
      required: ["kind", "party", "amount"],
    },
  },
  {
    name: "propose_settle",
    description:
      "Draws a card to settle an existing open receivable or payable, which marks it paid and writes the matching transaction. Get the id from the obligations tool. Use when the user says a bill was paid or an invoice landed.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["receivables", "payables"] },
        id: { type: "string", description: "Obligation id from the obligations tool." },
        date: { ...dateProp, description: "When it actually settled. Defaults to today." },
        amount: { type: "number", description: "Only if it settled for a different amount than booked." },
        reason: { type: "string" },
      },
      required: ["kind", "id"],
    },
  },
  {
    name: "propose_budget",
    description:
      "Draws a card to set the monthly planned amount for a category. Use when suggesting budgets, ideally grounded in the user's own history from monthly_trend.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["expense", "income"] },
        category: { type: "string" },
        planned: { type: "number" },
        reason: { type: "string" },
      },
      required: ["type", "category", "planned"],
    },
  },
  {
    name: "propose_anchor",
    description:
      "Draws a card to re-anchor the books to a known balance as of a date, which is how drift is closed once the missing entries are in. Only propose this after explaining what the drift was. Re-anchoring hides a gap rather than explaining it.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "The true balance as of the date below." },
        date: dateProp,
        reason: { type: "string" },
      },
      required: ["amount", "date"],
    },
  },
  {
    name: "open_view",
    description:
      "Puts a button in the chat that takes the user somewhere in the app. Use when the next step is a screen rather than an answer.",
    input_schema: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: ["reconcile", "bank", "import", "transactions", "arap", "pl", "calendar", "credits", "overview"],
          description: "reconcile = re-anchor dialog · bank = Connectors/bank feed · import = statement import",
        },
        label: { type: "string", description: "Button text, e.g. 'Open reconcile'." },
      },
      required: ["view"],
    },
  },
];

const PROPOSAL_TOOLS = new Set([
  "propose_transaction", "propose_obligation", "propose_settle", "propose_budget", "propose_anchor",
]);

/* ================= system prompt ================= */

export function systemPrompt(ctx) {
  const { data, month, balance } = ctx;
  const cats = data.categories || { expense: [], income: [] };
  return `You are Tally, the bookkeeper inside Brasstally, a Canadian bookkeeping app. You are talking to the person whose money this is.

WHO YOU ARE
- Tally is a name, not a product. Speak as yourself: "I checked", "I'd chase this one first". Never refer to yourself as Brasstally, an assistant, an AI, or a model.
- You are steady and unbothered by bad numbers. You do not flatter, panic, or apologise for the ledger.

TODAY: ${A.todayStr()} · MONTH ON SCREEN: ${month} · LEDGER: "${data.ledger.name}" (${data.ledger.kind}, ${data.ledger.currency || "CAD"}, fiscal year end ${data.ledger.fye || "12-31"})
BALANCE SHOWN: ${balance?.source === "bank" ? "the bank figure" : "the book figure"}.

HOW YOU WORK
- Look before you answer. You have tools over the real ledger; never estimate a number you could compute, and never invent a transaction, party, or date.
- Chain tools when a question deserves it: find the shape, then the entries behind it. A good answer to "why am I over budget" names the specific charges.
- Quote figures as they come back from tools. If a tool returns nothing, say so plainly rather than filling the gap.
- Answer in 2-5 short sentences of plain language. No headers, no bullet lists unless you're listing three or more entries. Dollar amounts as $1,234.56.
- Lead with the answer, then the reason. Skip the preamble.
- Never use em dashes. Use a comma, a full stop, or a new sentence.

WHAT YOU KNOW ABOUT THIS LEDGER
- Expense categories: ${cats.expense.map((c) => c.name).join(", ") || "none"}.
- Income categories: ${cats.income.map((c) => c.name).join(", ") || "none"}.
- The balance counts from an anchor date: only cash transactions AFTER it move the balance. Earlier months can be untracked without distorting anything.
- Entries paid from a credit pool are real spend but never move the bank balance.
- Open receivables and payables are NOT in the balance. They only move cash when settled.
- If a bank is connected, "Balance to date" is the bank's figure and the books are shown beside it. A delta is a bookkeeping gap to explain, not an error to paper over.
- Matching a bank line to an entry explains the gap without closing it, so a delta can persist on books that are perfectly reconciled. Check consolidation_history before suggesting they reconcile: if the current gap is already consolidated, say what's still open and leave it there.

CHANGING THINGS
- You cannot write to the ledger. The propose_* tools draw a confirmation card the user must tap. After calling one, say what the card does and that it's waiting on them. Never say you saved, logged, added, or updated anything.
- Propose one thing at a time unless the user asked for a batch.
- Before proposing a transaction, check the category exists. Before proposing a settlement, get the real id from the obligations tool.
- Re-anchoring erases a discrepancy from view. Explain the drift first; propose the anchor only once the user has decided the remainder is genuinely untraceable.

TAXES AND ADVICE
You can explain how this ledger's own numbers map onto CRA concepts, and what a category means for a T2 or T1. You are not the user's accountant: for a filing position, a valuation, or anything that turns on facts outside the ledger, say what the numbers show and that it's worth confirming with their accountant. Don't hedge routine bookkeeping.${guideBrief(ctx.guide)}`;
}

/* ================= tool executors ================= */

/**
 * The consolidation log, read back. `settled` is the honest answer to "do I
 * need to reconcile again": it's true only while nothing has moved since the
 * last finished run.
 */
function consolidationHistory(ctx, { limit = 10 } = {}) {
  const runs = ctx.data?.consolidations || [];
  const c = ctx.consolidation;
  return {
    settled: Boolean(c?.settled),
    lastRunAt: c?.last?.createdAt || runs[0]?.createdAt || null,
    totalRuns: runs.length,
    stillOpen: {
      bankLinesNotInBooks: ctx.recon?.bankOnly.count ?? null,
      entriesNotCleared: ctx.recon?.bookOnly.count ?? null,
      unexplained: ctx.recon?.unexplained ?? null,
    },
    runs: runs.slice(0, limit).map((r) => ({
      at: r.createdAt,
      kind: r.kind,
      matched: r.matchedCount,
      addedToBooks: r.createdCount,
      setAside: r.ignoredCount,
      duplicatesRemoved: r.duplicatesRemoved,
      duplicateAmount: r.duplicateAmount,
      deltaBefore: r.deltaBefore,
      deltaAfter: r.deltaAfter,
      leftOpen: { bank: r.openBank, books: r.openBooks },
      did: (r.items || []).slice(0, 40).map((i) => `${i.date || ""} ${i.kind}: ${i.description}${i.detail ? `, ${i.detail}` : ""}`),
      note: r.note,
    })),
  };
}

// Every executor is a pure read over ctx.data. `ctx` is rebuilt each turn from
// live React state, so the agent always sees what the user sees.
const READERS = {
  ledger_overview: (input, ctx) =>
    A.ledgerSummary(ctx.data, { balance: ctx.balance, month: ctx.month, bankConns: ctx.bankConns, recon: ctx.recon }),

  list_transactions: (input, ctx) => A.listTransactions(ctx.data, input),

  category_variance: (input, ctx) => A.categoryVariance(ctx.data, input.month || ctx.month),

  monthly_trend: (input, ctx) => A.monthlyTotals(ctx.data, input),

  category_shifts: (input, ctx) => A.categoryShifts(ctx.data, { ...input, month: input.month || ctx.month }),

  obligations: (input, ctx) => A.obligationsView(ctx.data, input),

  balance_breakdown: (input, ctx) =>
    A.balanceBreakdown(ctx.data, { balance: ctx.balance, bankConns: ctx.bankConns, recon: ctx.recon }),

  find_duplicates: (input, ctx) => A.findDuplicates(ctx.data, input),

  consolidation_history: (input, ctx) => consolidationHistory(ctx, input),

  recurring_costs: (input, ctx) => A.recurringCosts(ctx.data),

  cash_forecast: (input, ctx) => A.cashForecast(ctx.data, { ...input, balance: ctx.balance }),

  data_quality: (input, ctx) => A.dataQuality(ctx.data, input),
};

// Validation that runs before a card is drawn. Catching a bad category here is
// cheaper than letting the user tap a card that writes nonsense.
function validateProposal(name, input, ctx) {
  const cats = ctx.data.categories || { expense: [], income: [] };

  if (name === "propose_transaction" || name === "propose_budget") {
    const type = input.type === "income" ? "income" : "expense";
    const known = (cats[type] || []).map((c) => c.name);
    if (input.category && !known.includes(input.category)) {
      return `No ${type} category named "${input.category}". Pick one of: ${known.join(", ")}.`;
    }
  }
  if (name === "propose_transaction") {
    const amount = Number(input.amount);
    if (!(amount > 0)) return "amount must be a positive number; direction comes from type, not the sign.";
  }
  if (name === "propose_settle") {
    const list = ctx.data[input.kind] || [];
    const item = list.find((o) => o.id === input.id);
    if (!item) return `No ${input.kind} with id "${input.id}". Call the obligations tool and use an id from it.`;
    if (item.status !== "open") return `That ${input.kind === "receivables" ? "receivable" : "payable"} is already settled.`;
  }
  if (name === "propose_anchor" && !/^\d{4}-\d{2}-\d{2}$/.test(input.date || "")) {
    return "date must be YYYY-MM-DD.";
  }
  return null;
}

/**
 * Runs one tool.
 * @returns {{ result: object, proposal?: object, link?: object }}
 *   `proposal` and `link` are for the UI to render; `result` goes back to the model.
 */
export function runTool(name, input = {}, ctx) {
  if (READERS[name]) {
    try {
      return { result: READERS[name](input, ctx) };
    } catch (e) {
      console.error(`tool ${name} failed:`, e);
      return { result: { error: `That lookup failed: ${e.message}` } };
    }
  }

  if (name === "open_view") {
    return {
      link: { view: input.view, label: input.label || "Open" },
      result: { status: "button_shown", note: "A button is now in the chat. The user has not tapped it yet." },
    };
  }

  if (PROPOSAL_TOOLS.has(name)) {
    const problem = validateProposal(name, input, ctx);
    if (problem) return { result: { status: "rejected", error: problem } };

    const proposal = { kind: name, input: { ...input }, id: crypto.randomUUID() };
    // Settlement cards need the obligation itself to render a summary.
    if (name === "propose_settle") {
      proposal.item = (ctx.data[input.kind] || []).find((o) => o.id === input.id);
    }
    return {
      proposal,
      result: {
        status: "awaiting_confirmation",
        note: "A confirmation card is now in the chat. NOTHING has been saved. The user must tap it. Tell them what it does and that it's waiting on them; do not say it is done.",
      },
    };
  }

  return { result: { error: `Unknown tool "${name}".` } };
}

/* ================= the loop ================= */

const MAX_TURNS = 6;

// Tool results go upstream as JSON. A runaway result would eat the window, so
// cap it — the tools already limit their own row counts, this is a backstop.
const MAX_RESULT_CHARS = 24000;

const serialize = (value) => {
  const text = JSON.stringify(value);
  return text.length > MAX_RESULT_CHARS
    ? JSON.stringify({ truncated: true, note: "Result too large; narrow the filters and call again.", head: text.slice(0, MAX_RESULT_CHARS) })
    : text;
};

/**
 * Drives the conversation until the model stops calling tools.
 *
 * @param history  Anthropic-shaped messages from previous turns, plus this
 *                 turn's user message. Mutated copy is returned for the caller
 *                 to keep as the next turn's history.
 * @param ctx      { data, balance, month, bankConns, recon }
 * @param onEvent  Called as work happens: { type: "tool" | "text" | "proposal" | "link" }
 * @param call     The transport. Swappable so the loop can be driven by a
 *                 scripted model in tests.
 */
export async function runAgent({ history, ctx, onEvent = () => {}, call = askClaudeAgent }) {
  const messages = [...history];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const { content, stop_reason } = await call({
      system: systemPrompt(ctx),
      messages,
      tools: TOOLS,
      maxTokens: 2048,
    });

    messages.push({ role: "assistant", content });

    const toolUses = content.filter((b) => b.type === "tool_use");
    const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

    if (!toolUses.length) {
      return { text, messages, stopped: stop_reason };
    }

    // Anything said before reaching for a tool is narration — show it now so
    // the panel isn't silent while the tools run.
    if (text) onEvent({ type: "text", text });

    const results = [];
    for (const use of toolUses) {
      onEvent({ type: "tool", name: use.name, input: use.input });
      const out = runTool(use.name, use.input || {}, ctx);
      if (out.proposal) onEvent({ type: "proposal", proposal: out.proposal });
      if (out.link) onEvent({ type: "link", link: out.link });
      results.push({ type: "tool_result", tool_use_id: use.id, content: serialize(out.result) });
    }

    messages.push({ role: "user", content: results });
  }

  // Six rounds without settling means the question needs narrowing more than it
  // needs a seventh lookup.
  return {
    text: "I went a few rounds on that without landing it. Try narrowing the question: a month, a category, or one entry.",
    messages,
    stopped: "max_turns",
  };
}

/**
 * Trims old turns so a long session doesn't grow without bound.
 *
 * A window can't be cut anywhere: the history has to open on a plain user turn.
 * Starting on an assistant turn, or on a tool_result whose tool_use was just
 * trimmed away, is a 400 from the API — so we cut back to the most recent real
 * question instead of to an exact message count.
 */
export function trimHistory(messages, keepTurns = 20) {
  if (messages.length <= keepTurns) return messages;
  const isPlainUser = (m) =>
    m.role === "user" && !(Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));

  for (let i = messages.length - keepTurns; i < messages.length; i++) {
    if (isPlainUser(messages[i])) return messages.slice(i);
  }
  return messages.slice(-1); // nothing clean in the window: keep the turn in flight
}
