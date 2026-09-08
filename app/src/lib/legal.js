/* ================= the three documents =================
   The text lives here, once, as data.

   It was written straight into three HTML files, and the app linked out to
   them. That meant a policy could be corrected on the website and stay wrong
   inside the app, which for a document about someone's bank data is not a
   cosmetic problem. It also meant reading the policy threw you out of the app
   with no way back.

   So: this file is the source, the app renders it directly, and
   scripts/build-legal.mjs renders the web pages from the same object. Edit here
   and both follow.

   Block types the renderers understand:
     { p: "..." }                        a paragraph
     { ul: ["...", "..."] }              a list
     { note: { h: "...", p: "..." } }    a highlighted aside
     { table: { head: [...], rows: [[...]] } }
   Inline markup allowed: <strong>, <em>, <a href>. Nothing else. */

export const ENTITY = "GENIE AI, Inc.";
export const LEGAL_EMAIL = "legal@genieai.ca";
export const LEGAL_UPDATED = "7 September 2026";

const mail = `<a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>`;

export const LEGAL = {
  privacy: {
    kicker: "Privacy",
    title: "Privacy policy",
    lede:
      "What we collect, why we collect it, who else touches it, and how to get it back or have it deleted. " +
      "Written to be read rather than to be survived.",
    sections: [
      {
        id: "short", h: "The short version", blocks: [
          { note: {
            h: "If you read one paragraph, read this one",
            p: "We collect what the bookkeeping needs and nothing for advertising. Your bank password never " +
               "reaches us. Your books are yours: export them any time, delete them any time. We do not sell " +
               "data, and nobody here reads your ledger unless you ask us to look at something.",
          } },
        ],
      },
      {
        id: "who", h: "Who we are", blocks: [
          { p: `Brasstally is operated by <strong>${ENTITY}</strong>, a company incorporated in Ontario, Canada. ` +
               `For the purposes of Canadian privacy law we are the organisation accountable for the personal ` +
               `information described here. Our privacy contact is ${mail}.` },
        ],
      },
      {
        id: "what", h: "What we collect", blocks: [
          { table: {
            head: ["What", "Where it comes from", "Why"],
            rows: [
              ["<strong>Your email address</strong>", "You, at sign-up",
               "To identify your account and send sign-in links. It is the only contact detail we require."],
              ["<strong>Your ledger entries</strong><br/>amounts, dates, descriptions, categories, parties, tax",
               "You, or a bank feed you connect, or a receipt you upload",
               "They are the product. Without them there are no books."],
              ["<strong>Receipts and invoices</strong>", "You, by upload or photograph",
               "To read the entry from, and to hold as the evidence behind a deduction."],
              ["<strong>Bank transactions and balances</strong>", "Plaid, if you connect an account",
               "To reconcile your books against what the bank actually shows."],
              ["<strong>Bank access tokens</strong>", "Plaid",
               "To request that data again on your behalf. <strong>Not your banking credentials.</strong>"],
              ["<strong>Basic technical logs</strong>", "Automatically, when you use the app",
               "To keep the service running and to investigate faults."],
            ],
          } },
          { p: "We do not collect your name, address, phone number, date of birth, social insurance number or " +
               "business number, because the bookkeeping does not need them. If a future feature needs one, this " +
               "policy will say so before that feature exists." },
        ],
      },
      {
        id: "why", h: "Why we are allowed to", blocks: [
          { p: "Under Canada's <em>Personal Information Protection and Electronic Documents Act</em> and " +
               "comparable provincial law, we rely on <strong>your consent</strong>, given when you create an " +
               "account and again each time you connect a bank or upload a document." },
          { p: "Consent for a bank connection is separate and specific: it is given inside your bank's own flow, " +
               "and you can withdraw it by disconnecting the account, which stops further access immediately." },
        ],
      },
      {
        id: "processors", h: "Who else touches it", blocks: [
          { p: "We use a small number of service providers. Each one gets only what its job needs." },
          { table: {
            head: ["Provider", "What it does", "What it sees"],
            rows: [
              ["<strong>Supabase</strong>", "Database, authentication and file storage",
               "Everything, as the store of record."],
              ["<strong>Plaid</strong>", "Bank connections",
               "Your banking sign-in, on your bank's own screen, and the transactions it returns. We never receive the credentials."],
              ["<strong>Anthropic</strong>", "Reading receipts and answering questions in the app",
               "The document or question you send, and the ledger context needed to answer it."],
              ["<strong>Vercel</strong>", "Hosting", "Request metadata and technical logs."],
              ["<strong>Resend</strong>", "Sending email", "Your email address and the message."],
            ],
          } },
          { p: "<strong>We do not sell personal information, and we do not share it for advertising.</strong> " +
               "There is no advertising in Brasstally and no advertiser can pay to appear in it." },
          { p: "We would disclose information if compelled by a valid legal order. If that ever happens and we " +
               "are permitted to tell you, we will." },
        ],
      },
      {
        id: "where", h: "Where it lives", blocks: [
          { p: "Data is stored in Canada where our providers offer it, and otherwise in the United States. Some " +
               "processing therefore happens outside Canada, which means it can in principle be reached by the " +
               "courts and authorities of that country. That is true of essentially every cloud service, and you " +
               "are entitled to know it rather than discover it." },
          { p: "Access inside our own systems is restricted at the database level. Rows are scoped by user, so " +
               "the database itself refuses to return another account's data rather than relying on the " +
               "application to filter correctly." },
        ],
      },
      {
        id: "keep", h: "How long we keep it", blocks: [
          { ul: [
            "<strong>While your account is open:</strong> everything, because tax records need years of history " +
            "and deleting last year's books would defeat the purpose.",
            "<strong>When you reset a ledger:</strong> that ledger's entries and its files are deleted.",
            "<strong>When you delete your account:</strong> your rows and your uploaded files are removed. " +
            "Backups roll off on their own cycle, within 30 days.",
            "<strong>Technical logs:</strong> weeks, not years.",
          ] },
        ],
      },
      {
        id: "rights", h: "Your rights", blocks: [
          { p: "You can, at any time and without asking us:" },
          { ul: [
            "<strong>See everything.</strong> Every section of the app shows the underlying entries.",
            "<strong>Take it with you.</strong> Every section exports to CSV, including a full tax pack.",
            "<strong>Correct it.</strong> Every entry is editable.",
            "<strong>Delete it.</strong> Reset a ledger, or delete the account.",
            "<strong>Withdraw bank consent.</strong> Disconnect the account and access stops.",
          ] },
          { p: `If you would rather we did any of that for you, or you want a copy in another format, write to ` +
               `${mail}. We will respond within 30 days, which is the period Canadian law allows.` },
        ],
      },
      {
        id: "ai", h: "Automated processing", blocks: [
          { p: "When you upload a receipt, its contents are sent to Anthropic's API and read by a model, which " +
               "returns the vendor, amount, date, tax and a suggested category. When you ask Tally a question, " +
               "the question and the ledger context needed to answer it are sent the same way." },
          { p: "Nothing is decided about you by that process. It fills in a form you then confirm, and every " +
               "field remains editable. There is no profiling, scoring or automated decision-making that " +
               "affects your rights." },
        ],
      },
      {
        id: "children", h: "Children", blocks: [
          { p: "Brasstally is for running a business and is not directed at anyone under 18. We do not knowingly " +
               "collect information from children." },
        ],
      },
      {
        id: "changes", h: "Changes", blocks: [
          { p: "If we change this policy in a way that affects you, we will say so in the app rather than " +
               "quietly editing the page and changing the date. The date at the top always reflects the current " +
               "version." },
        ],
      },
      {
        id: "complain", h: "Complaints", blocks: [
          { p: `Start with us: ${mail}. If we do not resolve it, you can complain to the Office of the Privacy ` +
               `Commissioner of Canada, or to your provincial commissioner in Alberta, British Columbia or Quebec.` },
        ],
      },
    ],
  },

  terms: {
    kicker: "Terms",
    title: "Terms of use",
    lede:
      "What the service does, what it deliberately does not do, and the rules on both sides. " +
      "Plain language, and short enough to actually read.",
    sections: [
      {
        id: "takeaway", h: "The one thing to take away", blocks: [
          { note: {
            h: "It prepares. You file.",
            p: "Brasstally prepares books and drafts returns. <strong>It is not an accountant, it does not give " +
               "advice, and it cannot file anything with the CRA.</strong> A draft is a starting point for you " +
               "or your accountant, and the numbers remain your responsibility.",
          } },
        ],
      },
      {
        id: "agree", h: "Agreeing to these terms", blocks: [
          { p: "Using Brasstally means agreeing to what is on this page. If you are using it for a company, you " +
               "are confirming you are allowed to accept on that company's behalf." },
        ],
      },
      {
        id: "what", h: "What Brasstally is", blocks: [
          { p: "Bookkeeping software. It records entries, reads receipts, tracks what you owe and are owed, " +
               "connects to your bank to reconcile, and prepares summaries and drafts for tax purposes." },
        ],
      },
      {
        id: "not", h: "What it is not", blocks: [
          { ul: [
            "<strong>Not an accountant.</strong> Nothing in the app is accounting, tax or legal advice. It shows " +
            "its working so a professional can check it, which is not the same as replacing one.",
            "<strong>Not a filing service.</strong> No Canadian tax software exposes a filing interface to third " +
            "parties. Brasstally prepares the package and tracks the return through draft, sent, filed and " +
            "assessed. You or your accountant file it.",
            "<strong>Not a bank or a payment service.</strong> It never moves money. A bank connection is read only.",
            "<strong>Not a guarantee of accuracy.</strong> Categories are suggested, tax treatment is derived " +
            "from rules, and a receipt is read by a model. All of it is editable because all of it can be wrong. " +
            "The figures you file are yours.",
          ] },
        ],
      },
      {
        id: "account", h: "Your account", blocks: [
          { p: "Keep access to your email secure, since that is how you sign in. Tell us promptly if you think " +
               "someone else is in your account. One account is for one person or one business; do not share " +
               "credentials." },
        ],
      },
      {
        id: "yours", h: "Your data stays yours", blocks: [
          { p: "You own your books. We claim no ownership of your entries or documents. We hold them in order to " +
               "run the service for you, and you can export or delete them at any time. We do not use your " +
               "ledger to train models." },
        ],
      },
      {
        id: "use", h: "Acceptable use", blocks: [
          { ul: [
            "Do not use Brasstally to record or facilitate anything unlawful.",
            "Do not upload documents you have no right to.",
            "Do not attempt to reach another account's data, or probe the service for weaknesses without asking " +
            "us first. If you find something, tell us and we will thank you properly.",
            "Do not resell access or scrape the service.",
          ] },
        ],
      },
      {
        id: "banks", h: "Bank connections", blocks: [
          { p: "Bank connections are provided through Plaid, and using one means accepting Plaid's terms as " +
               "well. You sign in on your bank's own screen; we never receive your banking credentials. We are " +
               "not responsible for a bank feed being unavailable, delayed, or returning data your bank has " +
               "mislabelled, though we will tell you when a connection needs attention." },
        ],
      },
      {
        id: "pay", h: "Money", blocks: [
          { p: "Brasstally is currently in early access and free. Founding members keep a free tier when paid " +
               "plans arrive. If pricing changes we will give notice in the app before anything is charged, and " +
               "no card is required to use it today." },
        ],
      },
      {
        id: "uptime", h: "Availability", blocks: [
          { p: "We do not promise a particular level of uptime during early access. We do promise not to lose " +
               "your data carelessly, and to tell you if something goes wrong that affects it." },
        ],
      },
      {
        id: "end", h: "Ending it", blocks: [
          { p: "You can stop at any time by deleting your account, and your data goes with it. We may suspend an " +
               "account that breaks the acceptable use rules above, or if we are required to. If we ever " +
               "discontinue the service, we will give reasonable notice and time to export." },
        ],
      },
      {
        id: "liability", h: "Liability", blocks: [
          { p: "Brasstally is provided as is. To the extent the law allows, we are not liable for indirect or " +
               "consequential loss, and our total liability is limited to what you have paid us in the previous " +
               "twelve months, which during early access is nothing." },
          { p: "Said plainly: <strong>the figures you file are your responsibility.</strong> Please have a " +
               "professional review anything material before it goes to the CRA." },
          { p: "Nothing here limits liability that cannot be limited by law." },
        ],
      },
      {
        id: "law", h: "Governing law", blocks: [
          { p: "These terms are governed by the laws of Ontario and the federal laws of Canada that apply there, " +
               "and the courts of Ontario have jurisdiction." },
        ],
      },
    ],
  },

  data: {
    kicker: "Your financial data",
    title: "How your financial data is handled",
    lede:
      "The privacy policy covers personal information in general. This page is about the part that " +
      "actually worries people: your bank, your receipts, and your books.",
    sections: [
      {
        id: "before", h: "Before you connect a bank", blocks: [
          { note: {
            h: "The sign-in happens at your bank, not here",
            p: "We receive a token that can <strong>read</strong> transactions and balances. It cannot move " +
               "money, change anything, or be used to sign in as you.",
          } },
        ],
      },
      {
        id: "bank", h: "Your bank sign-in", blocks: [
          { p: "Connecting an account opens <strong>Plaid</strong>, a regulated data provider used by most " +
               "Canadian fintech. Your banking username and password are entered on your bank's own interface " +
               "inside that flow. They are never sent to Brasstally, never stored by Brasstally, and cannot be " +
               "retrieved by us afterwards because we never had them." },
          { p: "If your bank offers a read-only or limited-access option, using it changes nothing about how " +
               "Brasstally works. We only ever ask to read." },
        ],
      },
      {
        id: "token", h: "What the token can and cannot do", blocks: [
          { table: {
            head: ["Can", "Cannot"],
            rows: [[
              "Read transactions on the accounts you selected<br/>Read balances on those accounts<br/>" +
              "Tell us when the connection needs re-authorising",
              "Move, send or withdraw money<br/>Change anything at your bank<br/>" +
              "Reach accounts you did not select<br/>Be used to sign in as you<br/>" +
              "Survive you disconnecting it",
            ]],
          } },
          { p: "Tokens are held in a table your own session cannot read: the application reads bank data through " +
               "a server-side function, and the token column is never exposed to the browser." },
          { p: "Disconnecting an account revokes the token with Plaid. Any transactions already pulled into your " +
               "books stay, because they are your books; delete them individually or reset the ledger if you " +
               "want them gone." },
        ],
      },
      {
        id: "rows", h: "Who can reach your rows", blocks: [
          { p: "Every table is protected by <strong>row level security</strong> in Postgres. That means the " +
               "scoping is enforced by the database, not by the application remembering to add a filter. If the " +
               "app had a bug that forgot to restrict a query, the database would still return nothing that is " +
               "not yours." },
          { p: "Inside our team, access to production data is limited to what is needed to operate the service, " +
               "and nobody reads your ledger for interest. If you ask us to look at something, we look at that." },
        ],
      },
      {
        id: "files", h: "Receipts and invoices", blocks: [
          { p: "Files go into private storage keyed by your user id. They are not public, not guessable, and not " +
               "served from a public URL. When the app shows you a document it requests a short-lived signed " +
               "link that expires on its own." },
          { p: "A file stays attached to its entry, because a deduction without its receipt is the first thing " +
               "an auditor asks about. Deleting the entry deletes the file." },
        ],
      },
      {
        id: "model", h: "What a model sees", blocks: [
          { p: "Two things are sent to <strong>Anthropic's API</strong>:" },
          { ul: [
            "<strong>A receipt you upload,</strong> so the vendor, amount, date and tax can be read off it and " +
            "the form filled in.",
            "<strong>A question you ask Tally,</strong> along with the ledger figures needed to answer it.",
          ] },
          { p: "Nothing is sent unless you upload a document or type a question. Your ledger is not used to " +
               "train models. The extraction fills in a form you then confirm, and every field it produces stays " +
               "editable, because a model reading a crumpled receipt can be wrong and you are the one filing the " +
               "return." },
        ],
      },
      {
        id: "tax", h: "Tax figures", blocks: [
          { p: "Tax treatment is <strong>derived</strong> from your entries every time it is shown, rather than " +
               "frozen onto a row. Recategorise an entry and its tax line follows. What is stored is only what " +
               "cannot be recalculated: the tax amount printed on the receipt, which regime applied, and whether " +
               "you chose to capitalise the purchase." },
          { p: "This matters for a practical reason. A stored conclusion goes stale silently, and then your " +
               "statement and your ledger disagree with no way to tell which is right." },
        ],
      },
      {
        id: "separate", h: "Business and personal", blocks: [
          { p: "Ledgers are separate records, not filtered views of one pile. A personal entry cannot appear in a " +
               "business statement, bank connections belong to the ledger that made them, and resetting one " +
               "ledger leaves the other untouched." },
        ],
      },
      {
        id: "out", h: "Getting it out", blocks: [
          { p: "Every section exports to CSV, and the tax pack exports the whole period: the summary, the figures " +
               "per CRA line, capital additions, and every entry with its treatment and whether a receipt " +
               "exists. You do not need to ask us and you do not need an export request. It is a button." },
        ],
      },
      {
        id: "gone", h: "Getting it gone", blocks: [
          { ul: [
            "<strong>One entry:</strong> delete it, and its file goes with it.",
            "<strong>One ledger:</strong> reset it. Entries and files are removed; other ledgers are untouched.",
            "<strong>Everything:</strong> delete your account. Rows and files are removed, and backups roll off " +
            "within 30 days.",
            "<strong>A bank connection:</strong> disconnect it. The token is revoked with Plaid.",
          ] },
        ],
      },
      {
        id: "breach", h: "If something goes wrong", blocks: [
          { p: "If personal information under our control is lost or accessed without authorisation in a way " +
               "that creates a real risk of significant harm, Canadian law requires us to report it to the " +
               "Privacy Commissioner and to notify you. We will, and we will tell you what happened rather than " +
               "issuing a statement about how much we value your trust." },
        ],
      },
      {
        id: "never", h: "What we never do", blocks: [
          { ul: [
            "Sell your data, or share it for advertising. There is no advertising in Brasstally.",
            "Use your ledger to train models.",
            "Ask for your banking password. If anything claiming to be us ever does, it is not us.",
            "Move your money. The connection is read only, always.",
          ] },
          { note: {
            h: "A limit worth stating",
            p: "Data is stored in Canada where our providers offer it, and otherwise in the United States. " +
               "Processing outside Canada can in principle be reached by that country's courts. That is true of " +
               "essentially every cloud service, and you should know it rather than find out.",
          } },
        ],
      },
    ],
  },
};
