/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Ч/б редизайн: усі семантичні токени — відтінки сірого (імена НЕ змінювались).
        // Значення — RGB-тріплети в CSS-змінних, тож працюють і модифікатори
        // прозорості (bg-signal/10), і теми: .dark — світлі тони, :root — темні.
        bg: "rgb(var(--bg-rgb) / <alpha-value>)",
        panel: "var(--panel)",
        "panel-raised": "var(--panel-raised)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        signal: "rgb(var(--signal) / <alpha-value>)",
        critical: "rgb(var(--critical) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        primary: "rgb(var(--primary) / <alpha-value>)",
        // Alias: у старих сторінок (DDoS/Phishing) колір називався danger.
        // Без цього from-danger/to-danger/text-danger не генерувались у Tailwind,
        // через що шкали були прозрачними, а h1 — невидимим (bg-clip-text + прозорий текст).
        danger: "rgb(var(--critical) / <alpha-value>)",
        "ua-gold": "rgb(var(--ua-gold) / <alpha-value>)",
        "ua-blue": "rgb(var(--ua-blue) / <alpha-value>)",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "ui-sans-serif", "sans-serif"],
      },
      boxShadow: {
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
      },
    },
  },
  plugins: [],
};
