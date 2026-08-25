/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
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
