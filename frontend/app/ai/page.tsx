"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useTranslation } from "@/components/LanguageContext";
import { parseApiDate } from "@/lib/dates";
import { AiDigestCard, AiIntelligenceCard, AiUkraineCard } from "@/components/ai/AiCards";
import { UaFlag } from "@/components/UaFlag";

const PYTHON_API = process.env.NEXT_PUBLIC_PYTHON_API || "http://127.0.0.1:8010";

interface AiStatus {
  cached: string[];
  count: number;
  last_refresh: string;
  next_refresh_hour: number;
  next_refresh_in_hours: number;
  timezone: string;
}

type PageTab = "general" | "ukraine";

export default function AiAnalysisPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [pageTab, setPageTab] = useState<PageTab>("general");

  useEffect(() => {
    // Глубокая ссылка: /ai?tab=ukraine — сразу открыть анализ Украины
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "ukraine") setPageTab("ukraine");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${PYTHON_API}/ai/status`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setStatus(data);
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const switchTab = (tab: PageTab) => {
    setPageTab(tab);
    // Синхронізуємо URL без перезавантаження, щоб deep-link працював
    if (typeof window !== "undefined") {
      const url = tab === "ukraine" ? "/ai?tab=ukraine" : "/ai";
      window.history.replaceState(null, "", url);
    }
  };

  const allReady = status && status.count === 5;
  const ukraineReady = !!status?.cached.includes("ukraine");
  const generalReady =
    !!status &&
    ["digest", "ddos", "ioc", "vendor"].every((k) => status.cached.includes(k));

  const formatTime = (iso: string) => {
    const d = parseApiDate(iso);
    if (!d) return "—";
    return d.toLocaleString("uk-UA", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  };

  return (
    <AdminShell title={t.nav.aiAnalysis}>
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">

        {/* ─── Hero ─────────────────────────────── */}
        <header className="relative mb-6 animate-fade-in-up sm:mb-8">
          <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-danger/6 blur-[60px]" />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex h-0.5 w-6 rounded-full bg-gradient-to-r from-text-primary to-text-muted" />
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-secondary">
                  AI · GPT-OSS 120B
                </span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-text-primary sm:text-2xl lg:text-3xl">
                <span className="bg-gradient-to-r from-text-primary to-text-muted bg-clip-text text-transparent">
                  {t.sections.aiDigest}
                </span>
              </h1>
              <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-text-muted sm:text-sm">
                {t.sections.aiPageSubtitle}
              </p>
            </div>

            {/* Status */}
            <div className="flex flex-shrink-0 items-center gap-2">
              {allReady ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/30 bg-signal/8 px-3 py-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-signal" />
                  </span>
                  <span className="font-mono text-[10px] font-bold text-signal">{t.sections.aiStatusReady}</span>
                </span>
              ) : status ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/8 px-3 py-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
                  <span className="font-mono text-[10px] font-bold text-warning">{status.count}/5</span>
                </span>
              ) : null}
            </div>
          </div>
        </header>

        {/* ─── Верхнеуровневые вкладки: Загальний / Україна ────── */}
        <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-border bg-panel p-1.5 shadow-sm sm:mb-6 sm:inline-grid sm:auto-cols-max sm:grid-flow-col">
          <button
            type="button"
            onClick={() => switchTab("general")}
            aria-current={pageTab === "general"}
            className={`flex min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all sm:justify-start sm:px-5 sm:text-xs ${
              pageTab === "general"
                ? "bg-gradient-to-r from-primary/15 to-signal/10 text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]"
                : "text-text-secondary hover:bg-panel-raised hover:text-text-primary"
            }`}
          >
            <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
            <span className="truncate">{t.sections.aiTabGeneral}</span>
            <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${generalReady ? "bg-signal" : status ? "animate-pulse bg-warning" : "bg-border"}`} />
          </button>

          <button
            type="button"
            onClick={() => switchTab("ukraine")}
            aria-current={pageTab === "ukraine"}
            className={`flex min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all sm:justify-start sm:px-5 sm:text-xs ${
              pageTab === "ukraine"
                ? "bg-primary/12 text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]"
                : "text-text-secondary hover:bg-panel-raised hover:text-text-primary"
            }`}
          >
            <UaFlag className="h-3.5 w-5 flex-shrink-0 rounded-[2px]" />
            <span className="truncate">{t.sections.aiUkraine}</span>
            <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${ukraineReady ? "bg-signal" : status ? "animate-pulse bg-warning" : "bg-border"}`} />
          </button>
        </div>

        {/* Schedule info bar */}
        {status && status.last_refresh && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-panel/50 px-4 py-2.5 sm:gap-5">
            <div className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-primary" />
              <span className="font-mono text-[10px] text-text-muted">
                {t.sections.aiLastUpdate}: {formatTime(status.last_refresh)}
              </span>
            </div>
            <span className="hidden h-3 w-px bg-border sm:block" />
            <div className="flex items-center gap-1.5">
              <svg className="h-3 w-3 text-text-muted/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-mono text-[10px] text-text-muted">
                {t.sections.aiNextUpdate}: {status.next_refresh_hour}:00 KYIV ({status.next_refresh_in_hours}h)
              </span>
            </div>
            <span className="hidden h-3 w-px bg-border sm:block" />
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-text-muted/60">
                {status.timezone}
              </span>
            </div>
          </div>
        )}

        {/* ─── Контент вкладки ──────────────────────────────────── */}
        {pageTab === "general" ? (
          <div key="tab-general">
            {/* AI Digest */}
            <AiDigestCard />

            {/* AI Intelligence (DDoS / IOC / Вендор) */}
            <AiIntelligenceCard />
          </div>
        ) : (
          <div key="tab-ukraine">
            {/* Окремий щоденний аналіз українського сегмента */}
            <AiUkraineCard />
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center sm:mt-8">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-muted/60">
            {t.sections.aiPoweredBy}
          </p>
        </div>
      </div>
    </AdminShell>
  );
}
