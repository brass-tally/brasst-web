# Issues to Fix - From Slack Conversation

## 1. ✅ Sign-in Screen Not Appearing (BLOCKING)

**Status**: Configuration needed

**Root Cause**: Supabase environment variables not properly set for production build

**Fix**: 
- [ ] Set `VITE_SUPABASE_URL` in Vercel environment variables
- [ ] Set `VITE_SUPABASE_ANON_KEY` in Vercel environment variables  
- [ ] Trigger Vercel redeploy
- [ ] Test at your production URL - sign-in screen should appear

**Reference**: See `PRODUCTION_SETUP.md`

---

## 2. Name Updates (In Progress)

**Status**: Partially done ("brasst-web" and "brasst-app" names updated in vercel.json)

**What's Left**:
- [ ] Update hardcoded "Brasstally" references in app to "Brasst" or new brand name
  - App logo/wordmark image references
  - Meta tags in HTML
  - Landing page content
  - Component labels

**Files to Update**:
- app/src/App.jsx (line 452: logo, line 451: label, etc.)
- landing/index.html (multiple references)
- app/src/App.jsx (title tag in HTML)

---

## 3. Light Theme for Website

**Status**: Theme palettes already exist in code

**Fix**:
- [ ] Update landing page to use light theme CSS by default
- [ ] Landing page HTML already has color vars - just need to swap colors
- [ ] Consider adding theme toggle for users to switch between light/dark

**Key Color Vars to Update** (in landing/index.html `<style>`):
```css
:root {
  --bg: #F5F3EC;        /* warm paper background */
  --surface: #FAF8F1;   /* soft cream cards */
  --text: #2A2F27;      /* soft ink text */
  --brass: #D4A574;     /* warm brass accent */
  /* ... etc */
}
```

---

## 4. Rillet-Like Design Upgrade

**Status**: Design planning phase

**What This Means**:
- Modern, minimalist aesthetic
- Clean typography
- Subtle animations
- Focus on user experience

**Areas to Update**:
- [ ] App UI components styling
- [ ] Landing page visual hierarchy
- [ ] Color palette refinement
- [ ] Spacing and typography

**Next Steps**: Review Rillet's design system and create mockups

---

## 5. Landing Page Upgrade for Small/Mid Businesses

**Status**: Planning phase

**Target Audience**: "The little guy" - small business owners

**Messaging Changes**:
- [ ] Focus on simplicity and ease of use
- [ ] Emphasize affordability and no complexity
- [ ] Highlight quick setup and getting started
- [ ] Show ROI for small businesses

**Content Changes Needed**:
- [ ] Update hero copy
- [ ] Adjust feature list to highlight what matters to SMBs
- [ ] Pricing section (when ready)
- [ ] Case studies/testimonials from small business owners

**Example Updates**:
- Replace complex feature terminology with simple benefits
- Add "Get started in 5 minutes" messaging
- Show clear pricing (if applicable)
- Simplify the onboarding flow

---

## Implementation Order

1. **FIRST - Fix sign-in (blocking issue)**
   - Verify Supabase env vars in Vercel
   - Test that authentication works

2. **SECOND - Update branding/naming**
   - Update all "Brasstally" references to new brand name
   - Update logos and wordmarks
   - Update meta tags

3. **THIRD - Light theme for website**
   - Update landing page to light theme
   - Test on mobile and desktop
   - Add theme toggle if desired

4. **FOURTH - Design upgrade**
   - Create design mockups (Rillet-inspired)
   - Update UI components
   - Apply to both app and landing page

5. **FIFTH - Landing page rewrite for SMBs**
   - Update copy and messaging
   - Adjust feature list
   - Redesign hero section
   - Add business-focused benefits

---

## Quick Checklist Before Push to Live

- [ ] Sign-in screen appears and works
- [ ] User can create account and log in
- [ ] All "Brasstally" references updated to new name
- [ ] Landing page displays correctly in light theme
- [ ] Mobile responsive design looks good
- [ ] No console errors in browser
- [ ] Supabase environment variables confirmed in Vercel
- [ ] All links working (landing → app)
- [ ] Email verification flow works
- [ ] Password reset flow works
- [ ] Feedback from beta users incorporated
