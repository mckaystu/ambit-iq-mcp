import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        /** Primary actions — aligned with HCLSoftware Enchanted interactive blue */
        hcl: {
          blue: "#0f62fe",
        },
        carbon: {
          bg: "#f6f8fb",
          layer: "#ffffff",
          "layer-01": "#eef3f9",
          "layer-02": "#e3ebf6",
          border: "#d3deec",
          "border-strong": "#7d93b0",
          text: "#1d2a3b",
          "text-secondary": "#4b6078",
          "text-placeholder": "#8ea0b7",
          interactive: "#0f62fe",
          "interactive-hover": "#0043ce",
          "interactive-active": "#002d9c",
        },
      },
      boxShadow: {
        carbon: "0 8px 24px rgba(12, 35, 64, 0.08)",
        enchanted: "0 12px 30px rgba(15, 34, 64, 0.12)",
      },
      fontFamily: {
        sans: ['"Source Sans 3"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
