/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px', fontWeight: '500' }],
        sm: ['14px', { lineHeight: '20px', fontWeight: '500' }],
        base: ['16px', { lineHeight: '24px', fontWeight: '400' }],
        lg: ['18px', { lineHeight: '28px', fontWeight: '500' }],
        xl: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        '2xl': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        '3xl': ['30px', { lineHeight: '36px', fontWeight: '700' }],
        '4xl': ['36px', { lineHeight: '44px', fontWeight: '700' }],
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
