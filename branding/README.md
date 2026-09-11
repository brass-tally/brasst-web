# Brasstally

Two applications behind one domain, built and served separately by Vercel:

```
landing/    brasstally.com          one HTML file, no build
app/        brasstally.com/app      React + Vite on Supabase
api/        serverless routes       beta approvals, health check
supabase/   migrations + edge functions
```

`vercel.json` at the root wires them together with a `services` block.

## Running the app

```bash
cd app
npm install
npm run dev
```

The landing page needs no build:

```bash
cd landing && python3 -m http.server 8080
```

## Deploying

Push to `main`. **Two things must both be true or the app will not build:**

1. `vercel.json` contains a `services` key. It does.
2. The Vercel project's framework is set to **Services** in
   Settings -> Build and Deployment.

If the second is missing, Vercel ignores the services block, serves the folders
as static files, and `/app` returns the unbuilt `index.html` that asks for
`/src/main.jsx`. That is a white page, and it also publishes every source file.
The check after any deploy:

```bash
curl -o /dev/null -w "%{http_code}\n" https://www.brasstally.com/app/src/App.jsx
```

`404` is correct. `200` means the build did not run.

## The contract between landing and app

`bt-theme` in localStorage. Both read it before first paint, both default to
light, and Settings in the app writes it through `setTheme()` in
`app/src/ui/tokens.js`. That is why the two share token values: the theme
survives the crossing, so the palette has to.

## Colour tokens

`brass` is the fill. `brassText` is the deeper tone for text, links, and
eyebrows. They are separate because amber carries a button well and fails as
body text: the old single token measured 2.04:1 on the light surface where 4.5
is the minimum. `inkOn()` picks the label colour for any fill by luminance.

## Database

`supabase/migrations/` is numbered and replayable. Rules:

1. An applied migration is immutable. Fix forward with a new file.
2. Additive only. No dropped tables or columns, no renames.
3. RLS in the same migration that creates the table.
4. Never touch `bank_connections.access_token`, `.cursor`, or `.item_id`. The
   token is the user's bank session and clearing the cursor replays their whole
   history as duplicates.

## Edge functions

Deployed with the CLI, not by pushing:

```bash
supabase functions deploy plaid
supabase functions deploy extract
supabase functions deploy beta-feedback --no-verify-jwt
```

`beta-feedback` runs without a JWT so logged-out visitors can report problems.
It reads identity from the session when one exists and never from the request
body.
