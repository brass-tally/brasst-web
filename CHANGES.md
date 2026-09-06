# What changed in this package

Everything else is your code, unmodified.

## New

```
app/src/shell/Rail.jsx        left rail, with the ledger switcher on the mark
app/src/shell/TallyDock.jsx   drawer, peek, corner button (not yet wired)
app/src/shell/useNudges.js    the queue that makes Tally speak first
supabase/migrations/  (19)    already applied; committed so a fresh environment
                              can be rebuilt from source
supabase/diagnostic-bank-connections.sql
.gitattributes  .gitignore  README.md  CHANGES.md
```

## Replaced

```
vercel.json                                 adds "framework": "vite" to the app
                                            service, which is what makes it build
app/index.html                              light is the ground state, and the
                                            font set matches the tokens
app/src/index.css                           new tokens, Inter, and .eyebrow now
                                            uses --brasstext
app/src/ui/tokens.js                        Ember. Same exports, plus setTheme
supabase/functions/beta-feedback/index.ts   drops the service role, reads
                                            identity from the session, handles
                                            CORS, bounds the input
```

## Edited

`app/src/App.jsx`, four changes:

1. **62 sites** moved from `color: P.brass` to `color: P.brassText`. The six
   `background: P.brass` fills were left alone.
2. `Rail` imported and mounted, with the layout root becoming a flex row.
3. The dock is now `lg:hidden`. It is the phone's navigation; the rail is the
   desktop's.
4. A desktop-only Tally button in the bottom right, because hiding the dock
   also hid the way in. Same `chatOpen` state, same panel.

Verified with `npm run build`. The output references
`/app/assets/index-<hash>.js`, which is the thing your live deployment is
currently missing.

## Built but not wired

`TallyDock.jsx` and `useNudges.js` are complete and parse clean, but the
existing capture panel already works and swapping it is a change worth making
with the app running in front of you. `WIRING.md` in the shell package has the
steps.

## Not included

`api/send-beta-approvals`, the target of the cron in `vercel.json`. It was never
shared, so it is not here. If it does not exist, the cron is calling nothing.
