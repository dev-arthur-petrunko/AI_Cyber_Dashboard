"use client";

import { useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useTranslation } from "@/components/LanguageContext";

const KO_FI_URL = "https://ko-fi.com/arthurpetrunko";
const MONOBANK_JAR_URL = "https://send.monobank.ua/jar/A55e1mCwVQ";
const CARD_NUMBER = "4874 1000 3975 4612";

export default function SupportPage() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyCard = async () => {
    try {
      await navigator.clipboard.writeText(CARD_NUMBER);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <AdminShell title={t.support.title}>
      <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6 lg:px-8 lg:py-8">
        <header className="mb-6 animate-fade-in-up sm:mb-8">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-0.5 w-6 rounded-full bg-gradient-to-r from-text-primary to-text-muted" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-secondary">
              OPEN SOURCE PROJECT
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-text-primary sm:text-2xl lg:text-3xl">
            <span className="bg-gradient-to-r from-text-primary to-text-muted bg-clip-text text-transparent">
              {t.support.title}
            </span>
          </h1>
          <p className="mt-2 text-xs text-text-secondary sm:text-sm">
            {t.support.subtitle}
          </p>
        </header>

        <section className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
          <div className="rounded-xl border border-border bg-panel p-4 shadow-sm sm:p-6">
            <p className="text-sm leading-relaxed text-text-secondary">{t.support.p1}</p>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary">{t.support.p2}</p>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary">{t.support.p3}</p>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary">{t.support.thanks}</p>
          </div>
        </section>

        <section className="animate-fade-in-up mt-4" style={{ animationDelay: "200ms" }}>
          <div className="rounded-xl border border-signal/20 bg-signal/5 p-4 shadow-sm sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-lg">💙</span>
              <h2 className="text-lg font-bold text-text-primary">{t.support.donateTitle}</h2>
            </div>
            <p className="mb-4 text-sm font-semibold text-text-primary">{t.support.goal}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <a
                href={KO_FI_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-lg bg-signal px-4 py-3 text-sm font-bold text-white transition-all duration-300 hover:bg-signal/90 active:scale-[0.98]"
              >
                {t.support.koFi} ↗
              </a>
              <a
                href={MONOBANK_JAR_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-lg border border-signal/40 bg-panel px-4 py-3 text-sm font-bold text-text-primary transition-all duration-300 hover:bg-panel-raised active:scale-[0.98]"
              >
                {t.support.monobank} ↗
              </a>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-panel px-4 py-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                  {t.support.cardLabel}
                </p>
                <p className="mt-0.5 font-mono text-sm font-bold text-text-primary">{CARD_NUMBER}</p>
              </div>
              <button
                onClick={copyCard}
                className="shrink-0 rounded-md bg-panel-raised px-3 py-2 text-xs font-bold text-text-primary transition-all duration-300 hover:bg-signal/20 active:scale-95"
              >
                {copied ? t.support.copied : t.support.copy}
              </button>
            </div>
          </div>
        </section>

        <footer className="mt-10 animate-fade-in text-center text-xs text-text-muted" style={{ animationDelay: "300ms" }}>
          {t.sources.footer}
        </footer>
      </div>
    </AdminShell>
  );
}
