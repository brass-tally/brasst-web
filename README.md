# Brasstally, web

The marketing site at `brasstally.com`. One HTML file, no build step, no
dependencies beyond two webfonts and the Supabase client loaded from a CDN for
the sign-in forms.

The app lives in a **separate repository** and is served at `/app` by the
`services` block in `vercel.json`. The two are deployed independently but share
a domain, so a visitor crosses between them in a single session.

## Run it

```bash
python3 -m http.server 8080
# http://localhost:8080
```

## What is in here

```
index.html            the whole site
favicon.ico
icon-192.png
icon-512.png
apple-touch-icon.png
qa.mjs                structure, links, sign-in, theme, contrast
```

## The contract with the app repo

These two things must stay in step across the repositories, because a visitor
sees both within seconds of each other:

1. **Design tokens.** The palette block in `<style>` mirrors `PALETTES.ember`
   in the app's `src/ui/tokens.js`. `accent` is the amber fill and
   `accentText` is the deeper tone for links and eyebrows. They are separate on
   purpose: amber carries a button and fails as body text.
2. **`bt-theme` in localStorage.** Both sides read it before first paint, which
   is what stops the lights flipping when someone clicks into the app. Light is
   the default for everyone; dark is stored only once chosen.

The site does **not** write a palette preference. It has no palette switcher,
so anything it stored would be a choice the visitor never made.

## Sign-in

Two magic-link forms, hero and footer, both calling `signInWithOtp` with
`emailRedirectTo` pointing at `/app`. Only the Supabase URL and the
**publishable** key appear here, which is what that key is for. Anything else
belongs in Edge Function secrets.

## Checks

```bash
node qa.mjs
```

Also runs on every push through `.github/workflows/qa.yml`.
