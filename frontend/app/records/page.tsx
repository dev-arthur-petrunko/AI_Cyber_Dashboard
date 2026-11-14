"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { ThreatTable } from "@/components/ThreatTable";
import { useTranslation } from "@/components/LanguageContext";
import { fetchSources, fetchThreats, fetchVendors, ThreatCategory, VendorEntry } from "@/lib/api";
import { Severity, Threat } from "@/lib/types";

const PAGE_SIZE = 25;

const SOURCE_GROUP_LABELS: Record<string, string> = {
  integrated_ua: "UA",
  telemetry_api: "Telemetry API",
  world_sources: "World",
  vendor_rss: "Vendor RSS",
  cert_international_new: "International CERT",
  phishing_sources: "Phishing",
  leak_sources: "Leaks",
  ddos_sources: "DDoS",
  apt_sources: "APT / Actor",
  ioc_sources: "IOC feeds",
};

export default function RecordsPage() {
  const { t, lang } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState<ThreatCategory>("all");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [sortBy, setSortBy] = useState<string>("");
  const [sourcesSel, setSourcesSel] = useState<string[]>([]);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [sourceGroups, setSourceGroups] = useState<Record<string, string[]>>({});
  const [vendors, setVendors] = useState<VendorEntry[]>([]);
  const [vendor, setVendor] = useState("");
  const [maturity, setMaturity] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hasCve, setHasCve] = useState(false);
  const [actor, setActor] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("actor") ?? "";
  });
  const [page, setPage] = useState(0);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(0);
  }, [debouncedQuery, category, severity, sortBy, sourcesSel, vendor, maturity, dateFrom, dateTo, hasCve, actor]);

  useEffect(() => {
    fetchSources().then((r) => setSourceGroups(r.data.groups ?? {}));
    fetchVendors().then((r) => setVendors(r.data));
  }, []);

  const toggleSource = (name: string) =>
    setSourcesSel((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    );

  const load = useCallback(async () => {
    setLoading(true);
    // Сайт глобальний — регіональний фільтр прибрано (v1.6.0).
    const res = await fetchThreats(undefined, PAGE_SIZE, category, {
      search: debouncedQuery || undefined,
      offset: page * PAGE_SIZE,
      severity: severity || undefined,
      sort: sortBy || undefined,
      source: sourcesSel.length ? sourcesSel.join(",") : undefined,
      vendor: vendor || undefined,
      maturity: maturity || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      hasCve: hasCve || undefined,
      actor: actor || undefined,
    });
    setThreats(res.data.items);
    setTotal(res.data.total);
    setIsDemo(res.isDemo);
    setLoading(false);
  }, [debouncedQuery, category, severity, page, sortBy, sourcesSel, vendor, maturity, dateFrom, dateTo, hasCve, actor]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportCsv = () => {
    const header = ["id", "title", "source", "type", "severity", "cve_id", "cvss_score", "local_score", "epss_score", "exploit_maturity", "region", "published", "url"];
    const rows = threats.map((thr) =>
      [
        thr.id,
        `"${thr.title.replace(/"/g, '""')}"`,
        `"${thr.source.replace(/"/g, '""')}"`,
        thr.type,
        thr.severity,
        thr.cve_id ?? "",
        thr.cvss_score ?? "",
        thr.local_score ?? "",
        thr.epss_score ?? "",
        thr.exploit_maturity,
        thr.region,
        thr.published,
        thr.url ?? "",
      ].join(",")
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `threats_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasFilters =
    debouncedQuery ||
    category !== "all" ||
    severity ||
    sortBy ||
    sourcesSel.length > 0 ||
    vendor ||
    maturity ||
    dateFrom ||
    dateTo ||
    hasCve ||
    actor;

  return (
    <AdminShell title={t.nav.records}>
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">
        <header className="relative mb-5 animate-fade-in-up sm:mb-6">
          <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-danger/6 blur-[60px]" />
          <div className="relative flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex h-0.5 w-6 rounded-full bg-gradient-to-r from-text-primary to-text-muted" />
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-secondary">
                  THREAT DATABASE
                </span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-text-primary sm:text-2xl lg:text-3xl">
                <span className="bg-gradient-to-r from-text-primary to-text-muted bg-clip-text text-transparent">
                  {t.nav.records}
                </span>
              </h1>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-panel-raised px-3 py-1 font-mono text-[11px] font-bold text-text-secondary">
              {loading ? "…" : total} {t.records.results}
            </span>
          </div>
          <p className="relative mt-2 text-xs text-text-secondary sm:text-sm">{t.records.subtitle}</p>
          <p className="relative mt-1 text-[10px] text-text-muted sm:text-xs">{t.records.dataAsOf} {new Date().toLocaleTimeString(lang === "uk" ? "uk-UA" : lang === "pl" ? "pl-PL" : "de-DE", { hour: "2-digit", minute: "2-digit" })}</p>
        </header>

        {/* Панель пошуку та фільтрів */}
        <div className="mb-4 animate-fade-in-up space-y-3 rounded-xl border border-border bg-panel p-3 shadow-sm sm:p-4" style={{ animationDelay: "80ms" }}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.records.searchPlaceholder}
                className="cyber-input w-full rounded-lg border border-border bg-panel-raised py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-panel-raised px-3 py-2 text-sm font-medium text-text-secondary transition-all hover:border-signal/40 hover:text-signal active:scale-[0.97]"
              title={t.records.export}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              <span className="hidden sm:inline">{copied ? "✓" : t.records.export}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Тип */}
            <div className="flex overflow-hidden rounded-lg border border-border">
              {(["all", "feed", "ioc"] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  title={
                    cat === "feed"
                      ? t.records.feedTooltip
                      : cat === "ioc"
                        ? t.records.iocTooltip
                        : undefined
                  }
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    category === cat
                      ? "bg-signal/15 text-text-primary"
                      : "bg-panel-raised text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {cat === "all" ? t.records.allTypes : cat.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Критичність */}
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity | "")}
              className="rounded-lg border border-border bg-panel-raised px-2.5 py-1.5 text-xs text-text-secondary focus:border-signal/60 focus:outline-none"
              aria-label={t.records.severity}
            >
              <option value="">{t.records.severity}</option>
              {(["Critical", "High", "Medium", "Low"] as const).map((sev) => (
                <option key={sev} value={sev}>{t.severity[sev]}</option>
              ))}
            </select>

            {/* Джерела (мультивибір, згруповані за категоріями) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setSourcePanelOpen((o) => !o)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  sourcesSel.length
                    ? "border-signal/40 text-signal"
                    : "border-border bg-panel-raised text-text-secondary hover:text-text-primary"
                }`}
              >
                {t.records.sourceFilter}{sourcesSel.length ? ` · ${sourcesSel.length}` : ""}
                <svg className={`h-3 w-3 transition-transform ${sourcePanelOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {sourcePanelOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setSourcePanelOpen(false)} />
                  <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-72 overflow-auto rounded-lg border border-border bg-panel p-2 shadow-xl">
                    {Object.entries(sourceGroups).map(([grp, names]) => (
                      <div key={grp} className="mb-1">
                        <p className="px-1 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-text-muted">
                          {SOURCE_GROUP_LABELS[grp] ?? grp}
                        </p>
                        {names.map((n) => (
                          <label key={n} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-text-secondary hover:bg-white/5">
                            <input
                              type="checkbox"
                              className="h-3 w-3 accent-cyan-400"
                              checked={sourcesSel.includes(n)}
                              onChange={() => toggleSource(n)}
                            />
                            {n}
                          </label>
                        ))}
                      </div>
                    ))}
                    {Object.keys(sourceGroups).length === 0 && (
                      <p className="p-2 text-xs text-text-muted">…</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Вендор */}
            <select
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="max-w-[11rem] rounded-lg border border-border bg-panel-raised px-2.5 py-1.5 text-xs text-text-secondary focus:border-signal/60 focus:outline-none"
              aria-label={t.records.vendorLabel}
            >
              <option value="">{t.records.vendorLabel}</option>
              {vendors.map((v) => (
                <option key={v.vendor} value={v.vendor}>
                  {v.vendor} ({v.count})
                </option>
              ))}
            </select>

            {/* Зрілість експлойта */}
            <select
              value={maturity}
              onChange={(e) => setMaturity(e.target.value)}
              className="rounded-lg border border-border bg-panel-raised px-2.5 py-1.5 text-xs text-text-secondary focus:border-signal/60 focus:outline-none"
              aria-label={t.records.maturityLabel}
            >
              <option value="">{t.records.maturityLabel}</option>
              <option value="In the wild">{t.exploitStatus.inTheWild}</option>
              <option value="Weaponized">{t.exploitStatus.weaponized}</option>
              <option value="PoC">{t.exploitStatus.poc}</option>
              <option value="Unknown">{t.exploitStatus.unknown}</option>
            </select>

            {/* Період публікації */}
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label={t.records.periodFrom}
              className="rounded-lg border border-border bg-panel-raised px-2 py-1.5 text-xs text-text-secondary focus:border-signal/60 focus:outline-none [color-scheme:dark]"
            />
            <span className="text-xs text-text-muted">–</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label={t.records.periodTo}
              className="rounded-lg border border-border bg-panel-raised px-2 py-1.5 text-xs text-text-secondary focus:border-signal/60 focus:outline-none [color-scheme:dark]"
            />

            {/* Має CVE */}
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary" title={t.records.hasCve}>
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-cyan-400"
                checked={hasCve}
                onChange={(e) => setHasCve(e.target.checked)}
              />
              {t.records.hasCve}
            </label>

            {/* Сортування */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-lg border border-border bg-panel-raised px-2.5 py-1.5 text-xs text-text-secondary focus:border-signal/60 focus:outline-none"
            >
              <option value="">{t.records.sortDate}</option>
              <option value="severity">{t.records.sortSeverity}</option>
            </select>

            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setDebouncedQuery("");
                  setCategory("all");
                  setSeverity("");
                  setSortBy("");
                  setSourcesSel([]);
                  setVendor("");
                  setMaturity("");
                  setDateFrom("");
                  setDateTo("");
                  setHasCve(false);
                  setActor("");
                  inputRef.current?.focus();
                }}
                className="rounded-lg border border-border bg-panel-raised px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-warning/40 hover:text-warning"
              >
                {t.records.clear}
              </button>
            )}
          </div>

          {/* Активний фільтр актора (deep-link із Sankey) */}
          {actor && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {t.records.actorLabel}: {actor}
                <button
                  type="button"
                  onClick={() => setActor("")}
                  className="ml-0.5 text-primary/70 transition-colors hover:text-primary"
                  aria-label={`${t.records.clear} ${actor}`}
                >
                  ✕
                </button>
              </span>
            </div>
          )}
        </div>

        {/* Результати */}
        {isDemo && !loading && (
          <div className="animate-fade-in mb-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning shadow-sm">
            ⚠️ {t.header.demoWarning}
          </div>
        )}

        {loading ? (
          <div className="glass-card rounded-xl border border-border p-10 text-center shadow-sm">
            <div className="mx-auto h-8 w-8 spinner-glow" />
            <p className="mt-3 text-sm text-text-muted">{t.sections.loading}</p>
          </div>
        ) : threats.length === 0 ? (
          <div className="glass-card animate-fade-in rounded-xl border border-border p-10 text-center shadow-sm">
            <p className="text-sm text-text-secondary">{t.records.noResults}</p>
            <p className="mt-1 text-xs text-text-muted">{t.sections.tryFilter}</p>
          </div>
        ) : (
          <>
            <div className="animate-fade-in" key={`${debouncedQuery}-${category}-${severity}-${sortBy}-${sourcesSel.join("|")}-${vendor}-${maturity}-${dateFrom}-${dateTo}-${hasCve}-${actor}-${page}`}>
              <ThreatTable threats={threats} />
            </div>

            {/* Пагінація */}
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm text-text-secondary transition-all hover:border-signal/40 hover:text-signal disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                <span className="hidden sm:inline">←</span>
              </button>

              <span className="font-mono text-xs font-bold text-text-muted">
                {page + 1} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm text-text-secondary transition-all hover:border-signal/40 hover:text-signal disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="hidden sm:inline">→</span>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
