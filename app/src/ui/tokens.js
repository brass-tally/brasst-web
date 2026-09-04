/* ================= design tokens =================
   The source of truth for the app's palette, elevation, radii, and type. The
   same values back the landing page at /, so crossing from the marketing site
   into the ledger is not a change of product.

   Every component reads P at render time rather than importing a frozen copy,
   so swapping P's values and re-rendering the tree re-themes the whole app in
   one pass. applyThemeVars mirrors the same values onto the document root as
   CSS custom properties, which is what lets stylesheet rules (hover states,
   reveals, the glass header) follow a theme swap without React touching them. */

export const PALETTES = {
  dark: {
    mode: "dark",
    bg: "#101613",
    surface: "#171F1B",
    surface2: "#1D2622",
    line: "#2A3530",
    linehover: "#3A463F",  // hairline under the pointer, on cards and rows
    text: "#F3F1E7",
    muted: "#AEB5A9",
    faint: "#7C847B",
    credit: "#6FCB97",
    debit: "#E0705F",
    brass: "#E0B65A",
    onbrass: "#10120C",    // ink that sits on a brass fill
    overlay: "rgba(6,10,8,0.75)",
    glass: "rgba(16,22,19,0.8)",
  },
  light: {
    mode: "light",
    bg: "#F5F3EC",            // warm paper, a touch brighter so cards don't glare against it
    surface: "#FAF8F1",       // soft cream instead of near-white
    surface2: "#EDEAE0",
    line: "#E0DCCE",          // hairlines recede instead of gridding the page
    linehover: "#CFC9B6",
    text: "#2A2F27",          // soft ink, not black
    muted: "#59604F",
    faint: "#83887A",
    credit: "#2E7D54",        // calmer green
    debit: "#B0523F",         // terracotta instead of alarm red
    brass: "#DFA726",
    onbrass: "#10120C",
    overlay: "rgba(52,56,46,0.38)",
    glass: "rgba(245,243,236,0.85)",
  },
};

// The theme the pre-paint script in index.html already committed to. Reading
// it back here means the JS palette starts on the same foot as the painted
// page, instead of flashing dark before the stored preference loads.
function bootTheme() {
  if (typeof document === "undefined") return "dark";
  const stamped = document.documentElement.getAttribute("data-theme");
  return stamped === "light" ? "light" : "dark";
}

// Mutable palette object, every component reads P at render time, so swapping
// its values and re-rendering the tree re-themes the whole app.
export const P = { ...PALETTES[bootTheme()] };

// Shared with the landing page, so a theme chosen on either side of /app
// survives the crossing.
export const THEME_KEY = "bt-theme";

export const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
export const SANS = "'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, sans-serif";
// Headings are Fraunces — the serif from the landing page. It is the one place
// the app lets a second family in, and it is what makes a section heading read
// as a title rather than as bolder body copy.
export const SERIF = "'Fraunces', Georgia, serif";

/* ================= elevation =================
   Shadows carry the hue of the ground they fall on, never flat black. On the
   dark ledger that means a deep green-black; on paper, a warm grey. Three
   steps only — resting card, raised (hover / popover), and lifted (modal) —
   so elevation reads as hierarchy instead of decoration.

   Each step pairs a tight contact shadow with a wide, heavily-offset ambient
   one. The contact shadow is what seats the card on the page; the ambient is
   what gives it height. A single 1px shadow has neither, which is why the
   earlier scale was invisible. */
export const SHADOW = {
  dark: {
    1: "0 1px 2px rgba(4,8,6,.30), 0 6px 16px -8px rgba(4,8,6,.40)",
    2: "0 2px 6px rgba(4,8,6,.32), 0 18px 40px -16px rgba(0,0,0,.50)",
    3: "0 4px 10px rgba(4,8,6,.36), 0 30px 80px -28px rgba(0,0,0,.62)",
  },
  light: {
    1: "0 1px 2px rgba(58,52,38,.07), 0 6px 16px -8px rgba(58,52,38,.10)",
    2: "0 2px 6px rgba(58,52,38,.08), 0 18px 40px -16px rgba(58,52,38,.16)",
    3: "0 4px 10px rgba(58,52,38,.09), 0 30px 80px -28px rgba(58,52,38,.26)",
  },
};
export const elev = (level) => SHADOW[P.mode === "light" ? "light" : "dark"][level];

/* Which ink to lay on a filled surface. Brass is light in both themes, so it
   always takes the dark ink — but credit and debit invert between themes (a
   soft mint on the dark ledger, a deep forest on paper), and a fixed dark ink
   disappeared into them in light mode. Relative luminance decides instead. */
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
   Named for what they wrap rather than for their size, so a card and a modal
   can be retuned without hunting through rounded-lg/rounded-xl call sites.
   Mirrored into tailwind.config.js as rounded-control / -card / -panel. */
export const R = {
  control: 10,  // buttons, inputs, selects
  card: 14,     // sections and cards
  panel: 18,    // modals, the deck frame
  pill: 999,
};

/* Writes the active palette onto the document root, so CSS can read the same
   tokens React does. Inline properties on <html> outrank the static fallback
   block in index.css, which only exists to cover the frame before React
   mounts. Also stamps data-theme, sharing the landing page's convention. */
export function applyThemeVars(p = P) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(p)) {
    if (k !== "mode") root.style.setProperty(`--${k}`, v);
  }
  root.setAttribute("data-theme", p.mode);
  // Derived tokens: the focus outline, the translucent ring behind a focused
  // field, and the row hover ground.
  root.style.setProperty("--ring", p.brass);
  root.style.setProperty("--focus-ring", p.brass + "33");
  root.style.setProperty("--row-hover", p.surface2);
  // The browser chrome on mobile follows the ledger it is framing.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", p.bg);
}

// Run once at import so the first paint after the bundle loads is already
// themed, without waiting for a component to mount.
applyThemeVars(P);
