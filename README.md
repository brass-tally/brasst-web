# Brasstally

Monorepo for [brasstally.com](https://brasstally.com) (landing) and [app.brasstally.com](https://app.brasstally.com) (the app).

| Path | Host | What |
|---|---|---|
| `landing/` | `brasstally.com`, `www.brasstally.com` | Marketing landing page + magic-link sign-in |
| `app/` | `brasstally.com/app` | React bookkeeping app (Vite + Supabase) |

One Vercel project deploys both via [Services](https://vercel.com/docs/services) — host-based routing in root `vercel.json`.

## Local dev

```bash
# App
cd app && npm install && npm run dev

# Landing — open landing/index.html in a browser, or:
npx serve landing
```

## Deploy

Push to `main`. Vercel builds `app/` (Vite) and serves `landing/` as static files.

**Domains on the Vercel project:** `brasstally.com`, `www.brasstally.com` (app at `/app`)

**Supabase auth:** Site URL + redirect URLs should include `https://brasstally.com/app`.

See `app/README.md` for Supabase migrations, edge functions, and full app setup.
