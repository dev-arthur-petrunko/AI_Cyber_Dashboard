"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "./LanguageContext";

export function ThemeToggle({ bare = false }: { bare?: boolean }) {
  const { t } = useTranslation();
  const [isDark, setIsDark] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("theme");
    const shouldBeDark = stored ? stored === "dark" : true;
    
    setIsDark(shouldBeDark);
    document.documentElement.classList.toggle("dark", shouldBeDark);
  }, []);

  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    document.documentElement.classList.toggle("dark", newTheme);
    localStorage.setItem("theme", newTheme ? "dark" : "light");
  };

  if (!mounted) {
    return <div className="h-7 w-7 rounded-md border border-transparent sm:h-9 sm:w-9" />;
  }

  return (
    <button
      onClick={toggleTheme}
      className={`relative flex h-7 w-7 items-center justify-center transition-colors hover:bg-panel-raised sm:h-9 sm:w-9 ${
        bare ? "rounded-md" : "rounded-lg border border-border bg-panel hover:border-border-strong"
      }`}
      aria-label={isDark ? t.a11y.switchToLight : t.a11y.switchToDark}
    >
      {isDark ? (
        <svg
          className="h-4 w-4 text-warning transition-transform group-hover:rotate-12 sm:h-5 sm:w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ) : (
        <svg
          className="h-4 w-4 text-info transition-transform group-hover:-rotate-12 sm:h-5 sm:w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      )}
    </button>
  );
}
