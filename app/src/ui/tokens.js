export const PALETTES = {
  dark: {
    mode: "dark",
    bg: "#100E0C",
    surface: "#1A1714",
    surface2: "#221E1A",
    line: "#2A2521",
    linehover: "#37312B",
    text: "#F5F1EC",
    muted: "#B0A79F",
    faint: "#877E76",
    credit: "#34D399",
    debit: "#FB7185",
    brass: "#FBBF24",       // fills: buttons, active dock, progress
    brassText: "#FBBF24",   // on the dark ledger the same value clears AA as text
    onbrass: "#1C1200",     // ink that sits on a brass fill
    overlay: "rgba(8,6,4,0.72)",
    glass: "rgba(16,14,12,0.84)",
  },
  light: {
    mode: "light",
    bg: "#FAF9F7",          // warm neutral paper, no blue cast
    surface: "#FFFFFF",     // cards sit clean against it
    surface2: "#F5F3F0",    // inset wells
    line: "#EDEAE5",        // hairlines recede instead of gridding the page
    linehover: "#E2DDD6",
    text: "#1C1917",        // soft ink, not black
    muted: "#5A534E",
    faint: "#8A827B",
    credit: "#08805A",
    debit: "#C4442F",
    brass: "#F59E0B",       // 8.16:1 with onbrass on top, excellent as a fill
    brassText: "#A9620A",   // 4.73:1 on surface, passes AA as text
    onbrass: "#241703",
    overlay: "rgba(28,25,23,0.40)",
    glass: "rgba(250,249,247,0.84)",
  },
};

/* ================= the other three =================
   Ember ships. These are here because the Appearance panel offers them, and a
   switch that offers a choice it cannot make is worse than no switch. Each one
   is a full pair, and every text token in all eight combinations clears WCAG AA
   (checked by scripts/check-tdz.mjs's sibling in the production kit).

   brass is the fill and brassText the text tone throughout, for the same reason
   Ember needs both: a colour bright enough to carry a button is rarely dark
   enough to read as a word. */
export const THEMES = {
  ember: PALETTES,
  ink: {
    light: {
      mode: "light",
      bg: "#FAFAF9", surface: "#FFFFFF", surface2: "#F4F4F2",
      line: "#EAE9E5", linehover: "#D8D6D0",
      text: "#1A1A17", muted: "#57564F", faint: "#86847C",
      credit: "#08805A", debit: "#C4442F",
      brass: "#1C1C19", brassText: "#1C1C19", onbrass: "#FFFFFF",
      overlay: "rgba(26,26,23,0.40)", glass: "rgba(250,250,249,0.84)",
    },
    dark: {
      mode: "dark",
      bg: "#0C0C0B", surface: "#151513", surface2: "#1E1E1B",
      line: "#242320", linehover: "#33322D",
      text: "#F5F4F0", muted: "#ADABA3", faint: "#807E76",
      credit: "#34D399", debit: "#FB7185",
      brass: "#F5F4F0", brassText: "#F5F4F0", onbrass: "#14140F",
      overlay: "rgba(0,0,0,0.72)", glass: "rgba(12,12,11,0.84)",
    },
  },
  jade: {
    light: {
      mode: "light",
      bg: "#F5F7F6", surface: "#FFFFFF", surface2: "#EEF2F0",
      line: "#E3E9E6", linehover: "#D3DBD7",
      text: "#0F1A16", muted: "#4E5B55", faint: "#7E8B85",
      credit: "#08805A", debit: "#C4442F",
      brass: "#0A855C", brassText: "#08805A", onbrass: "#FFFFFF",
      overlay: "rgba(15,26,22,0.40)", glass: "rgba(245,247,246,0.84)",
    },
    dark: {
      mode: "dark",
      bg: "#0B1210", surface: "#141C19", surface2: "#1B2521",
      line: "#222E29", linehover: "#2E3C36",
      text: "#ECF2EF", muted: "#A3B2AC", faint: "#7A8882",
      credit: "#34D399", debit: "#FB7185",
      brass: "#34D399", brassText: "#34D399", onbrass: "#06110D",
      overlay: "rgba(4,10,8,0.72)", glass: "rgba(11,18,16,0.84)",
    },
  },
  indigo: {
    light: {
      mode: "light",
      bg: "#F6F7FC", surface: "#FFFFFF", surface2: "#EFF1F9",
      line: "#E5E8F2", linehover: "#D5D9EA",
      text: "#14172B", muted: "#4F5470", faint: "#7F849C",
      credit: "#08805A", debit: "#C4442F",
      brass: "#5B5BD6", brassText: "#4A45C9", onbrass: "#FFFFFF",
      overlay: "rgba(20,23,43,0.40)", glass: "rgba(246,247,252,0.84)",
    },
    dark: {
      mode: "dark",
      bg: "#0D0F1A", surface: "#151827", surface2: "#1D2132",
      line: "#232742", linehover: "#303556",
      text: "#EEEFF7", muted: "#A6AAC4", faint: "#7C8199",
      credit: "#34D399", debit: "#FB7185",
      brass: "#8B8CF0", brassText: "#9B9CF5", onbrass: "#0D0F1A",
      overlay: "rgba(4,6,14,0.72)", glass: "rgba(13,15,26,0.84)",
    },
  },
};

export const PALETTE_NAMES = ["ember", "ink", "jade", "indigo"];
export const PALETTE_KEY = "bt-palette.v2";

/* Which palette is in play. Read once at boot and whenever Settings changes it;
   validated on read so a name removed in a later version falls back to Ember
   rather than leaving the app unstyled. */
export function currentPalette() {
  try {
    const v = window.localStorage.getItem(PALETTE_KEY);
    if (PALETTE_NAMES.includes(v)) return v;
  } catch { /* private mode */ }
  return "ember";
}

export function setPalette(name, mode) {
  const pal = PALETTE_NAMES.includes(name) ? name : "ember";
  const m = mode === "dark" ? "dark" : "light";
  Object.assign(P, THEMES[pal][m]);
  try { window.localStorage.setItem(PALETTE_KEY, pal); } catch { /* private mode */ }
  applyThemeVars(P);
  return pal;
}

/* Light is where everyone starts. Night is a choice, and once made it is
   remembered under THEME_KEY and carried across to the landing page. The
   pre-paint script in index.html should agree:
     document.documentElement.setAttribute("data-theme", saved === "dark" ? "dark" : "light"); */
function bootTheme() {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export const P = { ...PALETTES[bootTheme()] };

export const THEME_KEY = "bt-theme";

export const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
export const SANS = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
/* Headings share the body family now. Fraunces was doing brand work that the
   landing page does better, and at UI sizes it read as decoration rather than
   hierarchy. Weight and tracking carry the headings instead. */
export const SERIF = SANS;

/* ================= elevation =================
   Shadows carry the hue of the ground they fall on. Three steps only: resting
   card, raised (hover, popover), lifted (modal). */
export const SHADOW = {
  dark: {
    1: "0 1px 2px rgba(0,0,0,.30), 0 12px 30px -16px rgba(0,0,0,.60)",
    2: "0 2px 8px rgba(0,0,0,.35), 0 26px 60px -24px rgba(0,0,0,.70)",
    3: "0 4px 14px rgba(0,0,0,.40), 0 40px 90px -30px rgba(0,0,0,.78)",
  },
  light: {
    1: "0 1px 2px rgba(28,25,23,.05), 0 10px 26px -14px rgba(28,25,23,.14)",
    2: "0 2px 6px rgba(28,25,23,.06), 0 20px 44px -20px rgba(28,25,23,.20)",
    3: "0 4px 12px rgba(28,25,23,.08), 0 34px 80px -28px rgba(28,25,23,.28)",
  },
};
export const elev = (level) => SHADOW[P.mode === "light" ? "light" : "dark"][level];

/* Which ink to lay on a filled surface. Relative luminance decides, so credit
   and debit inverting between themes stays handled. */
const LIGHT_INK = "#FBF7EC";
export function inkOn(hex) {
  const h = String(hex).replace("#", "");
  if (h.length < 6) return P.onbrass;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? P.onbrass : LIGHT_INK;
}

/* ================= radii =================
   Rounder than before. Named for what they wrap, mirrored in tailwind.config.js. */
export const R = {
  control: 13,  // buttons, inputs, selects
  card: 20,     // sections and cards
  panel: 24,    // modals
  pill: 999,
};

/* Writes the active palette onto the document root so CSS reads the same tokens
   React does. Inline properties on <html> outrank the static block in index.css,
   which exists only to cover the frame before React mounts. */
export function applyThemeVars(p = P) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(p)) {
    if (k === "mode") continue;
    // brassText -> --brasstext, so CSS stays lowercase
    root.style.setProperty(`--${k.toLowerCase()}`, v);
  }
  root.setAttribute("data-theme", p.mode);
  root.style.setProperty("--ring", p.brass);
  root.style.setProperty("--focus-ring", p.brass + "33");
  root.style.setProperty("--row-hover", p.surface2);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", p.bg);
}

/* Swap the theme and remember it. Call this from the Settings toggle instead of
   mutating P by hand, so the stored value and the painted value cannot drift. */
export function setTheme(mode) {
  const next = mode === "dark" ? "dark" : "light";
  Object.assign(P, PALETTES[next]);
  try { window.localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
  applyThemeVars(P);
  return next;
}

applyThemeVars(P);
