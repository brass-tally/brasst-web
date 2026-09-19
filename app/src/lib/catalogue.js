/* Services Brasstally can recognise, and what it can do about each.
 *
 * Every entry states its own truth. A "Connect" button on something that
 * cannot be connected is a lie the person discovers by pressing it, so the
 * three states are kept apart and named:
 *
 *   live        there is a real integration, and it works
 *   seen        no integration, but your bank feed shows you pay for it, so
 *               the amount, the cadence and the next charge are all known
 *   wanted      neither: it can be asked for, and asking is recorded
 *
 * The recognition list is deliberately long, because matching a card
 * descriptor to a known service is the whole value: "GOOGLE*CLOUD_8812" is
 * not a name anybody wants to read.
 */

export const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "banking", label: "Banking" },
  { id: "productivity", label: "Productivity" },
  { id: "design", label: "Design" },
  { id: "developer", label: "Developer" },
  { id: "comms", label: "Communication" },
  { id: "finance", label: "Finance" },
  { id: "marketing", label: "Marketing" },
];

/* Matched against a normalised bank descriptor. Order matters only where one
   name contains another. */
export const SERVICES = [
  { id: "plaid", name: "Your bank", category: "banking", state: "live",
    note: "Transactions, balances and a morning pass", match: [] },

  { id: "stripe", name: "Stripe", category: "finance", state: "live",
    note: "Take card payments on an invoice", match: ["STRIPE"] },
  { id: "paypal", name: "PayPal", category: "finance", state: "live",
    note: "Take payment on an invoice", match: ["PAYPAL"] },
  { id: "square", name: "Square", category: "finance", state: "live",
    note: "Take payment on an invoice", match: ["SQUARE", "SQ "] },

  { id: "google", name: "Google Workspace", category: "productivity", match: ["GOOGLE", "GSUITE", "WORKSPACE"] },
  { id: "microsoft", name: "Microsoft 365", category: "productivity", match: ["MICROSOFT", "MSFT", "OFFICE"] },
  { id: "notion", name: "Notion", category: "productivity", match: ["NOTION"] },
  { id: "dropbox", name: "Dropbox", category: "productivity", match: ["DROPBOX"] },
  { id: "zoom", name: "Zoom", category: "comms", match: ["ZOOM"] },
  { id: "slack", name: "Slack", category: "comms", match: ["SLACK"] },
  { id: "asana", name: "Asana", category: "productivity", match: ["ASANA"] },
  { id: "atlassian", name: "Atlassian", category: "developer", match: ["ATLASSIAN", "JIRA", "CONFLUENCE"] },
  { id: "monday", name: "Monday", category: "productivity", match: ["MONDAY"] },
  { id: "airtable", name: "Airtable", category: "productivity", match: ["AIRTABLE"] },

  { id: "adobe", name: "Adobe", category: "design", match: ["ADOBE"] },
  { id: "figma", name: "Figma", category: "design", match: ["FIGMA"] },
  { id: "canva", name: "Canva", category: "design", match: ["CANVA"] },

  { id: "github", name: "GitHub", category: "developer", match: ["GITHUB"] },
  { id: "vercel", name: "Vercel", category: "developer", match: ["VERCEL"] },
  { id: "aws", name: "Amazon Web Services", category: "developer", match: ["AWS", "AMAZON WEB"] },
  { id: "supabase", name: "Supabase", category: "developer", match: ["SUPABASE"] },
  { id: "openai", name: "OpenAI", category: "developer", match: ["OPENAI"] },
  { id: "anthropic", name: "Anthropic", category: "developer", match: ["ANTHROPIC", "CLAUDE"] },
  { id: "cloudflare", name: "Cloudflare", category: "developer", match: ["CLOUDFLARE"] },
  { id: "digitalocean", name: "DigitalOcean", category: "developer", match: ["DIGITALOCEAN"] },

  { id: "quickbooks", name: "QuickBooks", category: "finance", match: ["QUICKBOOKS", "INTUIT"] },
  { id: "xero", name: "Xero", category: "finance", match: ["XERO"] },
  { id: "wave", name: "Wave", category: "finance", match: ["WAVE ACCOUNTING", "WAVEAPPS"] },

  { id: "mailchimp", name: "Mailchimp", category: "marketing", match: ["MAILCHIMP", "INTUIT MAILCHIMP"] },
  { id: "hubspot", name: "HubSpot", category: "marketing", match: ["HUBSPOT"] },
  { id: "shopify", name: "Shopify", category: "marketing", match: ["SHOPIFY"] },
  { id: "squarespace", name: "Squarespace", category: "marketing", match: ["SQUARESPACE"] },
  { id: "godaddy", name: "GoDaddy", category: "marketing", match: ["GODADDY"] },
];

/** Which known service a bank descriptor belongs to, if any. */
export function identify(descriptor) {
  const text = String(descriptor || "").toUpperCase();
  for (const svc of SERVICES) {
    for (const needle of svc.match || []) {
      if (text.includes(needle)) return svc;
    }
  }
  return null;
}

/**
 * The catalogue, with each entry's real state filled in.
 *
 * @param subs       output of findSubscriptions
 * @param connected  ids with a working connection, e.g. ["plaid", "stripe"]
 */
export function build(subs = [], connected = []) {
  const bySvc = new Map();
  for (const sub of subs) {
    const svc = identify(sub.name);
    if (!svc) continue;
    /* Keep the dearest when a service charges more than one way. */
    const prev = bySvc.get(svc.id);
    if (!prev || sub.monthly > prev.monthly) bySvc.set(svc.id, sub);
  }

  const rows = SERVICES.map((svc) => {
    const sub = bySvc.get(svc.id) || null;
    const isConnected = connected.includes(svc.id);
    return {
      ...svc,
      sub,
      connected: isConnected,
      /* The state shown, which is not the same as the state declared: a live
         integration nobody has set up is not connected, and a service with no
         integration is still recognised if it is charging you. */
      state: isConnected ? "connected"
        : sub ? "seen"
          : svc.state === "live" ? "available" : "wanted",
    };
  });

  /* Anything charging you that is not in the list at all. Real spend deserves
     a row even when nobody has taught the app what it is. */
  const known = new Set([...bySvc.values()].map((s) => s.key));
  for (const sub of subs) {
    if (known.has(sub.key)) continue;
    if (identify(sub.name)) continue;
    rows.push({
      id: `other:${sub.key}`,
      name: sub.name,
      category: "other",
      sub,
      connected: false,
      state: "seen",
      unknown: true,
    });
  }

  const order = { connected: 0, seen: 1, available: 2, wanted: 3 };
  return rows.sort((a, b) =>
    (order[a.state] - order[b.state]) || (b.sub?.monthly || 0) - (a.sub?.monthly || 0));
}
