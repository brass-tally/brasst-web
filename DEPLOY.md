# Deploying the site

## First deploy

1. Create a Vercel project from this repository. Framework preset: **Other**.
   There is no build step; the output is the repository root.
2. Add `brasstally.com` and `www.brasstally.com` as domains, with www
   redirecting to the apex.
3. Deploy. `vercel.json` carries the security headers and cache rules.

## Serving the app at /app

The app is a separate project. To put both behind one domain, the parent
project's `vercel.json` uses a `services` block, with this repository mounted at
`/` and the app at `/app`. Two things are easy to get wrong:

- The project's framework setting must be **Services**, or the `services` key is
  ignored and the routing silently falls back.
- A service receives the original path. `/app/assets/x.js` arrives as
  `/app/assets/x.js`, not `/assets/x.js`, so the app's internal rewrites matter.

Until that is wired, `/app` can simply be a redirect to wherever the app is
deployed. The links in the footer and nav both point at `/app`.

## Supabase

The page calls `signInWithOtp` with `emailRedirectTo` set to `origin + /app`.
In the Supabase dashboard, under Authentication, add these to the allowed
redirect URLs or the emailed link will refuse to open:

```
https://brasstally.com/app
https://www.brasstally.com/app
http://localhost:8080/app
```

Only the project URL and the **publishable** key are in the page, which is what
that key is for. Anything else belongs in Edge Function secrets.

## Before you point the domain at it

- [ ] Privacy policy and terms, linked from the footer. Handling Canadian
      financial data through Plaid raises PIPEDA obligations, so this is worth
      an hour of a lawyer's time rather than a template.
- [ ] Decide whether you mean the promise on this page: founding members keep
      the free tier when plans arrive. It is a public commitment.
- [ ] Replace `brasstally.com` in `canonical`, the Open Graph tags, `robots.txt`
      and `sitemap.xml` if the domain changes.
- [ ] Check the link preview by pasting the URL into Slack or iMessage once it
      is live. `og-image.png` should render.

## Known trade-offs

- The Supabase client loads from jsDelivr at runtime. It keeps the page
  dependency-free, but it is a third party in the sign-in path. Self-hosting the
  client is the hardening step if that matters to you.
- No Content Security Policy. The page uses inline styles and one inline module,
  so a strict policy needs nonces, which needs a build step. The other security
  headers are set.
- No analytics. Add Vercel Analytics or Plausible if you want numbers; nothing
  is tracking anyone today.

## Checks

```bash
node qa.mjs
```

Runs in CI on every push.
