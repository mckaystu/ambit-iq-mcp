/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#ffffff",
        surface: "#ffffff",
        panel: "#ffffff",
        accent: "#635bff",
        text: "#0a2540",
        muted: "#2f3a5a"
      },
      boxShadow: {
        stripe: "0 4px 6px rgba(50, 50, 93, 0.11), 0 1px 3px rgba(0, 0, 0, 0.08)"
      },
      transitionTimingFunction: {
        stripe: "cubic-bezier(0.165, 0.84, 0.44, 1)"
      }
    }
  },
  plugins: []
};
