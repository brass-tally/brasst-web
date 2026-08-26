# Production Setup Guide

## Environment Variables for Vercel

The app requires two Supabase environment variables to be set in Vercel for authentication to work. These must be set in your Vercel project settings.

### Step 1: Set Environment Variables in Vercel Dashboard

Go to your project settings on Vercel and add these environment variables:

```
VITE_SUPABASE_URL=https://your-supabase-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

**Important**: The `VITE_` prefix is required for Vite to inject them during the build process.

### Step 2: Verify Supabase Configuration

1. The Supabase project must have:
   - Email/Password authentication enabled
   - Magic Link (passwordless) sign-in enabled
   - Proper redirect URLs configured (add your production URL)

2. The beta_signups table should exist with columns:
   - email (text, unique)
   - status (text: pending/approved)
   - created_at (timestamp)

### Step 3: Deploy

Push to your main branch or trigger a manual redeploy in Vercel:

```bash
git add .
git commit -m "Update production configuration"
git push
```

Vercel will pick up the environment variables and rebuild the app. The sign-in screen should now appear at your app URL.

### Troubleshooting

If the sign-in screen still doesn't appear:

1. **Check browser console** - Look for any JavaScript errors
2. **Verify env vars** - Go to Vercel project settings and confirm VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
3. **Test locally** - Run `npm run dev` in the app directory to test with fallback credentials
4. **Check Supabase** - Verify your Supabase project is running and the anon key is correct

### Local Development

For local development without setting environment variables, the app will use fallback hardcoded Supabase credentials (for testing only).

To use custom credentials locally:

1. Create `app/.env.local` with your Supabase credentials
2. Run `npm run dev`
3. Access at `http://localhost:5173/app/`
