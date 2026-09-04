/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Two families, each with a job: Plus Jakarta Sans carries the
        // interface, Fraunces carries the headings. Geist Mono carries every
        // number. Same three the landing page uses.
        sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // The single source of truth for the type scale — index.html no longer
      // patches these sizes, so there is one place to tune them. Sizes track
      // the landing page's 16.5px body, and the tracking is looser than it was:
      // Plus Jakarta Sans is a wider face than Geist and does not want to be
      // squeezed the way a grotesque does.
      fontSize: {
        xs: ['13px', { lineHeight: '18px', fontWeight: '400', letterSpacing: '0' }],
        sm: ['14px', { lineHeight: '20px', fontWeight: '400', letterSpacing: '-0.002em' }],
        base: ['16.5px', { lineHeight: '27px', fontWeight: '400', letterSpacing: '-0.004em' }],
        lg: ['19px', { lineHeight: '27px', fontWeight: '500', letterSpacing: '-0.01em' }],
        xl: ['22px', { lineHeight: '29px', fontWeight: '600', letterSpacing: '-0.015em' }],
        '2xl': ['27px', { lineHeight: '33px', fontWeight: '600', letterSpacing: '-0.018em' }],
        '3xl': ['34px', { lineHeight: '40px', fontWeight: '600', letterSpacing: '-0.02em' }],
        '4xl': ['40px', { lineHeight: '46px', fontWeight: '600', letterSpacing: '-0.022em' }],
      },
      // These mirror PALETTES.dark in src/ui/tokens.js. Anything reading a
      // Tailwind colour class gets the same values as anything reading P, so
      // the two systems can no longer drift apart.
      colors: {
        brass: "#E0B65A",
        onbrass: "#10120C",
        credit: "#6FCB97",
        debit: "#E0705F",
        bg: "#101613",
        surface: "#171F1B",
        surface2: "#1D2622",
        line: "#2A3530",
        linehover: "#3A463F",
        text: "#F3F1E7",
        muted: "#AEB5A9",
        faint: "#7C847B",
      },
      borderRadius: {
        // Named for what they wrap, matching the R scale in src/ui/tokens.js.
        control: "10px",
        card: "14px",
        panel: "18px",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease",
        "slide-up": "slideUp 0.3s cubic-bezier(.2,.8,.2,1)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(-4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      boxShadow: {
        brass: "0 2px 8px rgba(224, 182, 90, 0.12)",
        "brass-lg": "0 4px 12px rgba(224, 182, 90, 0.22)",
      },
    },
  },
  plugins: [],
};
