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
  { id: "other", label: "Other" },
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

  /* Added after reading five real statements, where each of these was charging
     every month and none was recognised. */
  { id: "apple", name: "Apple", category: "productivity", match: ["APPLE"] },
  { id: "elevenlabs", name: "ElevenLabs", category: "developer", match: ["ELEVENLABS", "ELEVEN LABS"] },
  { id: "upstash", name: "Upstash", category: "developer", match: ["UPSTASH"] },
  { id: "railway", name: "Railway", category: "developer", match: ["RAILWAY"] },
  { id: "render", name: "Render", category: "developer", match: ["RENDER COM", "RENDER"] },
  { id: "linear", name: "Linear", category: "productivity", match: ["LINEAR"] },
  { id: "loom", name: "Loom", category: "comms", match: ["LOOM"] },
  { id: "calendly", name: "Calendly", category: "productivity", match: ["CALENDLY"] },
  { id: "docusign", name: "DocuSign", category: "productivity", match: ["DOCUSIGN"] },
  { id: "signcom", name: "Sign.com", category: "productivity", match: ["SIGN COM", "SIGNCOM"] },
  { id: "spotify", name: "Spotify", category: "other", match: ["SPOTIFY"] },
  { id: "netflix", name: "Netflix", category: "other", match: ["NETFLIX"] },
  /* Wise is not here, deliberately. On a bank feed it appears as money moved
     INTO a Wise account, which is a transfer between your own accounts, and
     listing it as "known" exempted it from every check: it was reported as a
     $341 a month subscription, and would have double counted against the
     charges the Wise card then made. */

  /* Named by the owner after reading their own statements, plus the hosting
     and mail services that sit alongside them. */
  { id: "postmark", name: "Postmark", category: "developer", match: ["POSTMARKAPP", "POSTMARK"] },
  { id: "hostinger", name: "Hostinger", category: "developer", match: ["HOSTINGER"] },
  { id: "amazonprime", name: "Amazon Prime", category: "other", match: ["AMAZON PRIME", "AMZN PRIME"] },
  { id: "namecheap", name: "Namecheap", category: "developer", match: ["NAMECHEAP"] },
  { id: "netlify", name: "Netlify", category: "developer", match: ["NETLIFY"] },
  { id: "fly", name: "Fly.io", category: "developer", match: ["FLY IO", "FLYIO"] },
  { id: "resend", name: "Resend", category: "developer", match: ["RESEND"] },
  { id: "twilio", name: "Twilio", category: "comms", match: ["TWILIO"] },
  { id: "sendgrid", name: "SendGrid", category: "comms", match: ["SENDGRID"] },
  { id: "plaid", name: "Plaid", category: "finance", match: ["PLAID"] },
  { id: "stripe-sub", name: "Stripe billing", category: "finance", match: ["STRIPE"] },
  { id: "zapier", name: "Zapier", category: "productivity", match: ["ZAPIER"] },
  { id: "miro", name: "Miro", category: "design", match: ["MIRO"] },
  { id: "webflow", name: "Webflow", category: "marketing", match: ["WEBFLOW"] },
  { id: "framer", name: "Framer", category: "design", match: ["FRAMER"] },
  { id: "cursor", name: "Cursor", category: "developer", match: ["CURSOR"] },
  { id: "perplexity", name: "Perplexity", category: "developer", match: ["PERPLEXITY"] },
  { id: "midjourney", name: "Midjourney", category: "design", match: ["MIDJOURNEY"] },
  { id: "replit", name: "Replit", category: "developer", match: ["REPLIT"] },
  { id: "digitalocean2", name: "DigitalOcean", category: "developer", match: ["DIGITAL OCEAN"] },
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
