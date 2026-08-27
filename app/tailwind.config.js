/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        // One grotesque for everything. Hierarchy comes from weight and
        // tracking, not from a second, more traditional-looking family.
        sans: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // The single source of truth for the type scale — index.html no longer
      // patches these sizes, so there is one place to tune them.
      fontSize: {
        xs: ['12.5px', { lineHeight: '17px', fontWeight: '400', letterSpacing: '-0.002em' }],
        sm: ['13.5px', { lineHeight: '19px', fontWeight: '400', letterSpacing: '-0.004em' }],
        base: ['15px', { lineHeight: '23px', fontWeight: '400', letterSpacing: '-0.008em' }],
        lg: ['17px', { lineHeight: '24px', fontWeight: '500', letterSpacing: '-0.014em' }],
        xl: ['20px', { lineHeight: '26px', fontWeight: '600', letterSpacing: '-0.02em' }],
        '2xl': ['24px', { lineHeight: '30px', fontWeight: '600', letterSpacing: '-0.024em' }],
        '3xl': ['30px', { lineHeight: '35px', fontWeight: '600', letterSpacing: '-0.028em' }],
        '4xl': ['36px', { lineHeight: '41px', fontWeight: '600', letterSpacing: '-0.03em' }],
      },
      colors: {
        brass: "#C9A24B",
        credit: "#5CB283",
        debit: "#C4574E",
        bg: "#101613",
        surface: "#171F1B",
        surface2: "#1D2622",
        line: "#2A3530",
        text: "#EAE7DA",
        muted: "#8B9389",
        faint: "#5E6660",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease",
        "slide-up": "slideUp 0.3s ease",
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
        brass: "0 2px 8px rgba(201, 162, 75, 0.1)",
        "brass-lg": "0 4px 12px rgba(201, 162, 75, 0.2)",
      },
    },
  },
  plugins: [],
};
