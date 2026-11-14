"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "@/components/LanguageContext";
import { UaFlag } from "@/components/UaFlag";
import { parseApiDate } from "@/lib/dates";

const PYTHON_API = process.env.NEXT_PUBLIC_PYTHON_API || "http://127.0.0.1:8010";

interface AiData {
  analysis: string;
  tokens: { total: number };
  model: string;
  generated_at: string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong class='font-semibold text-text-primary'>$1</strong>")
    .replace(/`([^`]+)`/g, "<code class='rounded bg-panel-raised px-1.5 py-0.5 text-[11px] text-primary'>$1</code>");
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const htmlLines: string[] = [];
  let inList = false;
  let inOl = false;
  let inTable = false;
  let tableRows: string[] = [];

  const flushTable = () => {
    if (tableRows.length > 0) {
      const headerCells = tableRows[0].split("|").map((c) => c.trim()).filter(Boolean);
      const skipFirst = headerCells.length >= 4 && /^#\s*$|^\d+\s*$|^\*\*\d/.test(headerCells[0]);
      htmlLines.push(`<div class="overflow-x-auto my-4"><table class="w-full border-collapse">`);
      tableRows.forEach((row, i) => {
        const allCells = row.split("|").map((c) => c.trim()).filter(Boolean);
        const cells = skipFirst && allCells.length >= 4 ? allCells.slice(1) : allCells;
        const tag = i === 0 ? "th" : "td";
        const isHeader = i === 0;
        htmlLines.push(`<tr class="${isHeader ? "" : ""}">`);
        cells.forEach((cell, ci) => {
          const cleaned = stripHtml(cell);
          const content = inlineFormat(cleaned);
          const isLastCol = ci === cells.length - 1 && cells.length >= 3;
          htmlLines.push(`<${tag} class="px-3 py-2.5 text-left ${isHeader ? "text-[10px] font-bold uppercase tracking-wider text-text-muted border-b border-border bg-white/[0.015]" : "text-text-secondary border-b border-white/[0.03] leading-[1.7]"}" ${isLastCol ? 'style="min-width:200px"' : ""}>${content}</${tag}>`);
        });
        htmlLines.push("</tr>");
      });
      htmlLines.push("</table></div>");
      tableRows = [];
    }
    inTable = false;
  };

  for (const line of lines) {
    if (line.match(/^\|.*\|$/)) {
      if (!inTable) { inTable = true; tableRows = []; }
      if (line.match(/^\|[\s\-:|]+\|$/)) continue;
      tableRows.push(line);
      continue;
    } else if (inTable) {
      flushTable();
    }

    const trimmed = line.trim();

    // Horizontal rule
    if (trimmed.match(/^-{3,}$/) || trimmed.match(/^\*{3,}$/)) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      if (inOl) { htmlLines.push("</ol>"); inOl = false; }
      htmlLines.push(`<hr />`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      if (inOl) { htmlLines.push("</ol>"); inOl = false; }
      const content = inlineFormat(trimmed.slice(2));
      htmlLines.push(`<blockquote>${content}</blockquote>`);
      continue;
    }

    // h1
    if (trimmed.match(/^# (.+)$/)) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      if (inOl) { htmlLines.push("</ol>"); inOl = false; }
      const content = inlineFormat(trimmed.slice(2));
      htmlLines.push(`<h1>${content}</h1>`);
    }
    // h2
    else if (trimmed.match(/^## (.+)$/)) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      if (inOl) { htmlLines.push("</ol>"); inOl = false; }
      const content = inlineFormat(trimmed.slice(3));
      htmlLines.push(`<h2>${content}</h2>`);
    }
    // h3
    else if (trimmed.match(/^### (.+)$/)) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      if (inOl) { htmlLines.push("</ol>"); inOl = false; }
      const content = inlineFormat(trimmed.slice(4));
      htmlLines.push(`<h3>${content}</h3>`);
    }
    // Unordered list item (including indented sub-items)
    else if (trimmed.match(/^- (.+)$/)) {
      if (inOl) { htmlLines.push("</ol>"); inOl = false; }
      if (!inList) { htmlLines.push("<ul>"); inList = true; }
      const isIndented = line.match(/^\s{2,}/);
      const content = inlineFormat(trimmed.slice(2));
      htmlLines.push(`<li class="${isIndented ? "ml-4 text-text-muted text-[0.75rem]" : ""}">${content}</li>`);
    }
    // Ordered list
    else if (trimmed.match(/^\d+\.\s+(.+)$/)) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      if (!inOl) { htmlLines.push("<ol>"); inOl = true; }
      const content = inlineFormat(trimmed.replace(/^\d+\.\s+/, ""));
      const isIndented = line.match(/^\s{2,}/);
      htmlLines.push(`<li class="${isIndented ? "ml-4 text-text-muted text-[0.75rem]" : ""}">${content}</li>`);
    }
    // Empty line — close lists, add spacing
    else if (!trimmed) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      if (inOl) { htmlLines.push("</ol>"); inOl = false; }
    }
    // Regular paragraph
    else {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      if (inOl) { htmlLines.push("</ol>"); inOl = false; }
      const content = inlineFormat(trimmed);
      htmlLines.push(`<p>${content}</p>`);
    }
  }
  if (inList) htmlLines.push("</ul>");
  if (inOl) htmlLines.push("</ol>");
  if (inTable) flushTable();

  return <div className="prose-ai" dangerouslySetInnerHTML={{ __html: htmlLines.join("") }} />;
}

function AiSkeleton() {
  return (
    <div className="space-y-3 py-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2" style={{ animationDelay: `${i * 100}ms` }}>
          <div className="h-3 w-1/3 animate-pulse rounded bg-panel-raised" />
          <div className="h-2 w-full animate-pulse rounded bg-panel-raised" />
          <div className="h-2 w-4/5 animate-pulse rounded bg-panel-raised" />
        </div>
      ))}
    </div>
  );
}

function AiFooter({ data }: { data: AiData }) {
  const generated = parseApiDate(data.generated_at) ?? new Date();
  const timeStr = generated.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
      <div className="flex items-center gap-1.5">
        <span className="h-1 w-1 rounded-full bg-signal" />
        <span className="font-mono text-[9px] text-text-muted">{data.model}</span>
      </div>
      <span className="font-mono text-[9px] text-text-muted/60">{timeStr}</span>
    </div>
  );
}

/* ─── Digest Card ─────────────────────────────────────────────── */

export function AiDigestCard() {
  const { t, lang } = useTranslation();
  const [data, setData] = useState<AiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const poll = async () => {
      try {
        const res = await fetch(`${PYTHON_API}/ai/digest?lang=${lang}`);
        if (res.status === 503) {
          setTimeout(() => !cancelled && poll(), 3000);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) { setData(json); setLoading(false); }
      } catch (e: unknown) {
        if (!cancelled) { setError(e instanceof Error ? e.message : "Error"); setLoading(false); }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [lang]);

  return (
    <section className="ai-section animate-fade-in-up mb-4 sm:mb-6">
      <div className="card glass-card hud-corners relative overflow-hidden rounded-xl border border-border shadow-sm">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/0 via-primary to-primary/0 opacity-60" />
        <span className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full blur-3xl bg-primary/8" />

        <div className="relative p-5 sm:p-6 lg:p-8">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
            </div>
            <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-text-secondary sm:text-xs">
              {t.sections.aiDigest}
            </h2>
          </div>

          {loading ? (
            <AiSkeleton />
          ) : error ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
              {error}
            </div>
          ) : data ? (
            <>
              <Markdown text={data.analysis} />
              <AiFooter data={data} />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* ─── Intelligence Card (DDoS / IOC / Vendor tabs) ────────────── */

type Tab = "ddos" | "ioc" | "vendor";

export function AiIntelligenceCard() {
  const { t, lang } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("ddos");
  const [results, setResults] = useState<Record<Tab, AiData | null>>({ ddos: null, ioc: null, vendor: null });
  const [loadingTab, setLoadingTab] = useState<Tab | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tabs: { key: Tab; label: string; dot: string; activeCls: string }[] = [
    { key: "ddos", label: "DDoS", dot: "bg-critical", activeCls: "border-critical/40 bg-critical/10 text-critical" },
    { key: "ioc", label: "IOC", dot: "bg-warning", activeCls: "border-warning/40 bg-warning/10 text-warning" },
    { key: "vendor", label: t.sections.aiVendor, dot: "bg-signal", activeCls: "border-signal/40 bg-signal/10 text-signal" },
  ];

  const fetchTab = async (tab: Tab, requestLang: typeof lang) => {
    if (results[tab]) {
      setActiveTab(tab);
      return;
    }
    setActiveTab(tab);
    setLoadingTab(tab);
    setError(null);
    try {
      const res = await fetch(`${PYTHON_API}/ai/${tab}?lang=${requestLang}`);
      if (res.status === 503) {
        setTimeout(() => fetchTab(tab, requestLang), 3000);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setResults((prev) => ({ ...prev, [tab]: json }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoadingTab(null);
    }
  };

  useEffect(() => {
    setResults({ ddos: null, ioc: null, vendor: null });
    setError(null);
    fetchTab("ddos", lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const currentData = results[activeTab];
  const currentTab = tabs.find((tb) => tb.key === activeTab)!;

  return (
    <section className="ai-section animate-fade-in-up mb-4 sm:mb-6">
      <div className="card glass-card hud-corners relative overflow-hidden rounded-xl border border-border shadow-sm">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-signal/0 via-signal to-signal/0 opacity-60" />
        <span className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full blur-3xl bg-signal/8" />

        <div className="relative p-5 sm:p-6 lg:p-8">
          {/* Header */}
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-signal/10">
              <svg className="h-4 w-4 text-signal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-text-secondary sm:text-xs">
              AI Intelligence
            </h2>
          </div>

          {/* Tabs */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key;
              const isLoading = loadingTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => fetchTab(tab.key, lang)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all sm:text-[11px] ${
                    isActive
                      ? tab.activeCls
                      : "border-border bg-panel-raised text-text-secondary hover:border-border-strong hover:text-text-primary"
                  }`}
                >
                  {isLoading ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${tab.dot}`} />
                  )}
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="animate-fade-in min-h-[80px]">
            {loadingTab === activeTab ? (
              <AiSkeleton />
            ) : error ? (
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
                {error}
              </div>
            ) : currentData ? (
              <>
                <Markdown text={currentData.analysis} />
                <AiFooter data={currentData} />
              </>
            ) : (
              <p className="py-4 text-center text-[11px] text-text-muted">{t.sections.aiIntelligenceHint}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Ukraine Card (окремий щоденний зріз українського сегмента) ── */

export function AiUkraineCard() {
  const { t, lang } = useTranslation();
  const [data, setData] = useState<AiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const poll = async () => {
      try {
        const res = await fetch(`${PYTHON_API}/ai/ukraine?lang=${lang}`);
        if (res.status === 503) {
          setTimeout(() => !cancelled && poll(), 3000);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) { setData(json); setLoading(false); }
      } catch (e: unknown) {
        if (!cancelled) { setError(e instanceof Error ? e.message : "Error"); setLoading(false); }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [lang]);

  return (
    <section className="ai-section animate-fade-in-up mb-4 sm:mb-6" key="ukraine-card">
      <div className="card glass-card hud-corners relative overflow-hidden rounded-xl border border-primary/20 shadow-sm">
        {/* Верхня лінія у кольорах прапора */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary/0 via-text-muted to-primary/0 opacity-70" />
        <span className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full blur-3xl bg-primary/10" />

        <div className="relative p-5 sm:p-6 lg:p-8">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 ring-1 ring-primary/25">
              <UaFlag className="h-4 w-6 rounded-[2px]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-text-secondary sm:text-xs">
                {t.sections.aiUkraine} · AI
              </h2>
              <p className="mt-0.5 truncate text-[10px] text-text-muted">{t.sections.aiUkraineDesc}</p>
            </div>
          </div>

          {loading ? (
            <AiSkeleton />
          ) : error ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
              {error}
            </div>
          ) : data ? (
            <>
              <Markdown text={data.analysis} />
              <AiFooter data={data} />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* ─── Preview Card (main dashboard → links to /ai) ────────────── */

export function AiPreviewCard() {
  const { t, lang } = useTranslation();
  const [data, setData] = useState<AiData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${PYTHON_API}/ai/digest?lang=${lang}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setData(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [lang]);

  const preview = data ? data.analysis.split("\n").filter((l) => l.trim()).slice(0, 2).join(" ") : "";

  return (
    <section className="ai-section animate-fade-in-up h-full">
      <Link href="/ai" className="group block h-full">
        <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/5 via-panel to-signal/5 shadow-sm transition-all duration-500 hover:border-primary/30 hover:shadow-[0_8px_40px_rgba(255,255,255,0.08)]">

          {/* Animated gradient border glow */}
          <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 40%, rgba(255,255,255,0.03) 100%)" }} />

          {/* Top accent line */}
          <span className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-primary/40 to-transparent transition-all duration-500 group-hover:via-primary/60" />

          <div className="relative flex h-full flex-col gap-2 p-4">
            {/* Big icon */}
            <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-signal/10 shadow-[0_0_24px_rgba(255,255,255,0.08)] transition-all duration-500 group-hover:shadow-[0_0_32px_rgba(255,255,255,0.16)] group-hover:scale-105">
              <svg className="h-6 w-6 text-primary transition-transform duration-500 group-hover:rotate-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423-1.423z" />
              </svg>
              {/* Pulse ring */}
              {data && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-40" />
                  <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-panel bg-signal" />
                </span>
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="flex-shrink-0 text-sm font-bold tracking-tight text-text-primary sm:text-base">
                  {t.nav.aiAnalysis}
                </h2>
                {["DDoS", "IOC", t.sections.aiVendor, t.sections.aiUkraine ?? "UA"].map((label) => (
                  <span key={label} className="rounded border border-border bg-panel-raised/60 px-1 py-px font-mono text-[7px] font-bold uppercase leading-none tracking-wider text-text-muted">
                    {label}
                  </span>
                ))}
                <span className="hidden h-px flex-1 bg-gradient-to-r from-border to-transparent sm:block" />
              </div>
              <p className="mt-0.5 text-xs text-text-muted sm:text-sm">{t.sections.aiDigestDesc}</p>
              {preview && (
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-text-muted sm:text-[13px]">
                  {preview}
                </p>
              )}
            </div>
            </div>

            {/* CTA-стрілка */}
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-panel-raised transition-all duration-300 group-hover:border-primary/30 group-hover:bg-primary/5">
              <svg className="h-4 w-4 text-primary transition-transform duration-300 group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
        </div>
      </Link>
    </section>
  );
}
