"use client";

import { useTranslation } from "./LanguageContext";

export function LanguageToggle() {
  const { t, lang, setLang } = useTranslation();

  const languages = [
    { code: "uk", label: "UA" },
    { code: "en", label: "EN" },
    { code: "pl", label: "PL" },
    { code: "fr", label: "FR" },
    { code: "de", label: "DE" },
  ] as const;

  return (
    <label
      className="relative flex h-8 items-center rounded-md border border-border bg-panel px-2 text-text-secondary transition-colors hover:border-border-strong sm:h-9 sm:px-3"
      aria-label={t.a11y.language}
    >
      <span className="sr-only">{t.a11y.language}</span>
      <select
        value={lang}
        onChange={(event) => setLang(event.target.value as typeof lang)}
        className="max-w-20 cursor-pointer appearance-none bg-transparent pr-3 text-xs font-semibold text-text-primary outline-none sm:max-w-none sm:text-sm"
      >
        {languages.map((language) => (
          <option key={language.code} value={language.code}>{language.label}</option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2 h-3 w-3 text-text-muted sm:right-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
