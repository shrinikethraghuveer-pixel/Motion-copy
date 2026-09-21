/** @type {import('tailwindcss').Config} */
// Tailwind v4 reads most config from CSS (@theme in globals.css); this file is
// wired via the `@config` directive for JS-config tokens (colors + glow shadows).
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        obsidian: "#010110",
        "obsidian-soft": "#070716",
      },
      boxShadow: {
        "glow-violet": "0 0 24px -6px rgba(124, 58, 237, 0.55)",
        "glow-cyan": "0 0 20px -4px rgba(6, 182, 212, 0.55)",
        "glow-indigo": "0 0 28px -6px rgba(99, 102, 241, 0.5)",
      },
    },
  },
  plugins: [],
};
