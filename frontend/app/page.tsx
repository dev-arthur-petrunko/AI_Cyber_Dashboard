"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchDdosStats, fetchSponsorInfra, fetchSources, fetchStats, fetchThreats } from "@/lib/api";
import { parseApiDate } from "@/lib/dates";
import { DdosLayer, DdosStats, Stats, Threat } from "@/lib/types";
import type { SponsorInfraResponse } from "@/lib/api";
import { AdminShell } from "@/components/AdminShell";
import { StatCard } from "@/components/StatCard";
import { VendorChart } from "@/components/VendorChart";
import { TopCountriesPanel } from "@/components/TopCountriesPanel";
import { ActorSankey } from "@/components/ActorSankey";
import { SponsorChart } from "@/components/SponsorChart";
import { ThreatTable } from "@/components/ThreatTable";
import { ThreatMap } from "@/components/ThreatMap";
import { HudTitle } from "@/components/HudTitle";
import { DdosMap } from "@/components/DdosMap";
import { UaFlag } from "@/components/UaFlag";
import { AiPreviewCard } from "@/components/ai/AiCards";
import { MethodologyPanel } from "@/components/MethodologyPanel";
import { Agent } from "@/components/agent/Agent";
import { AgentLinkLayer } from "@/components/agent/AgentLinkLayer";
import { AgentRoamer } from "@/components/agent/AgentRoamer";
import { useAgentMood } from "@/components/agent/useAgentMood";
import { useTranslation } from "@/components/LanguageContext";
import { Translations, Language, SPONSOR_NAMES } from "@/lib/i18n";

type MapMode = "threats" | "ddos";
type DdosSide = "targets" | "origins";

export default function DashboardPage() {
  const { t, lang } = useTranslation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [iocThreats, setIocThreats] = useState<Threat[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [showIoc, setShowIoc] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recentPage, setRecentPage] = useState(0);
  const [mapMode, setMapMode] = useState<MapMode>("threats");
  const [ddosLayer, setDdosLayer] = useState<DdosLayer>("layer7");
  const [ddosSide, setDdosSide] = useState<DdosSide>("targets");
  const [ddosStats, setDdosStats] = useState<DdosStats | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedSponsor, setSelectedSponsor] = useState<string | null>(null);
  const [sponsorInfra, setSponsorInfra] = useState<SponsorInfraResponse | null>(null);
  const [sourcesMeta, setSourcesMeta] = useState<{ active: number; total: number; lastFetched: string | null } | null>(null);

  const toggleSponsor = (sponsor: string) => {
    setSelectedSponsor((prev) => {
      const next = prev === sponsor ? null : sponsor;
      if (next && !sponsorInfra) {
        fetchSponsorInfra().then((r) => setSponsorInfra(r.data));
      }
      return next;
    });
  };

  useEffect(() => {
    setRecentPage(0);
  }, [threats]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Сайт глобальний: усі агрегати без region-фільтра.
    // Український сегмент — окремо: UA-alerts картка + AI-аналіз України (/ai?tab=ukraine).
    Promise.all([
      fetchStats(),
      fetchThreats(undefined, 50, "feed", { sort: "severity", days: 30 }),
      fetchThreats(undefined, 40, "ioc"),
      fetchDdosStats("global"),
      fetchSources(),
    ]).then(([s, t, ioc, ddos, src]) => {
      if (cancelled) return;
      setStats(s.data);
      setThreats(t.data.items);
      setIocThreats(ioc.data.items);
      setDdosStats(ddos);
      setIsDemo(s.isDemo || t.isDemo || ioc.isDemo);
      const received = src.data.received ?? {};
      const entries = Object.entries(received);
      setSourcesMeta({
        active: entries.filter(([, n]) => typeof n === "number" && n > 0).length,
        total: entries.length,
        lastFetched: src.data.last_fetched ?? null,
      });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const lastUpdate = stats?.last_update ? formatLastUpdate(stats.last_update, lang, t) : t.sections.loading;

  // Живі емоції агента за даними (ТЗ 5.3): завантаження → thinking,
  // немає даних/без дій 60с → sleepy, помилка → sad (див. useAgentMood).
  const agentMood = useAgentMood({
    loading,
    empty: !loading && !stats,
  });

  // ── Сцена «агент з ноутбуком»: раз у 45–90 с; аналізує випадкову картку ──
  const [agentLaptop, setAgentLaptop] = useState(false);
  const [agentAnchor, setAgentAnchor] = useState<{ x: number; y: number } | null>(null);
  const lastTargetRef = useRef<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const run = () => {
      if (cancelled || document.hidden) { schedule(); return; }
      // Випадкова ціль серед карток дашборда (не повторювати ту саму двічі поспіль)
      const els = Array.from(document.querySelectorAll<HTMLElement>("[data-agent-target]"));
      const visible = els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.top < window.innerHeight && r.bottom > 0;
      });
      if (visible.length === 0) { schedule(); return; }
      const pool = visible.filter((el) => el.dataset.agentTarget !== lastTargetRef.current);
      const target = (pool.length ? pool : visible)[Math.floor(Math.random() * (pool.length || visible.length))];
      lastTargetRef.current = target.dataset.agentTarget ?? null;

      setAgentLaptop(true);           // ноутбук розкривається, якір → лінія
      timer = setTimeout(() => {
        if (cancelled) return;
        setAgentLaptop(false);        // ноутбук закривається → якір null → лінія зникає
        schedule();
      }, 5200);
    };
    const schedule = () => {
      timer = setTimeout(run, 45000 + Math.random() * 45000);
    };
    schedule();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // «Дашборд — 71 із 93 джерел · оновлено 27.10, 15:30»: лічильник джерел,
  // що дали дані, разом із датою останнього проходу колекторів.
  const sourcesSubtitle = sourcesMeta && sourcesMeta.total > 0 ? formatSourcesLine(sourcesMeta, lang, t) : null;

  const severityBreakdown = (stats?.severity_breakdown ?? []).reduce<Record<string, number>>((acc, item) => {
    acc[item.severity] = item.count;
    return acc;
  }, {});

  const severityTotal = Object.values(severityBreakdown).reduce((a, b) => a + b, 0) || threats.length || 1;

  const severityPct = (stats?.severity_breakdown ?? []).reduce<Record<string, number>>((acc, item) => {
    acc[item.severity] = item.pct ?? Math.round((item.count / severityTotal) * 1000) / 10;
    return acc;
  }, {});

  const exploitBreakdown = (stats?.exploit_breakdown ?? []).reduce<Record<string, number>>((acc, item) => {
    acc[item.maturity] = item.count;
    return acc;
  }, {});

  const RECENT_PAGE_SIZE = 10;
  const recentPages = Math.max(1, Math.ceil(threats.length / RECENT_PAGE_SIZE));
  const pageThreats = threats.slice(recentPage * RECENT_PAGE_SIZE, (recentPage + 1) * RECENT_PAGE_SIZE);

  // DDoS top items для панелі (Cloudflare Radar)
  const ddosTopItems = (() => {
    if (!ddosStats) return [];
    const layer = ddosStats[ddosLayer];
    const topMetric = ddosSide === "targets" ? "top_targets" : "top_origins";
    const view = layer?.metrics?.[topMetric]?.view;
    if (view && "items" in (view as any)) return (view as any).items as { country: string; value: number; code?: string }[];
    return [];
  })();

  return (
    <AdminShell
      title=""
      subtitle={sourcesSubtitle}
      meta={
        stats?.total_threats != null
          ? `${stats.total_threats.toLocaleString()} ${t.header.records}`
          : undefined
      }
    >
      <div className="relative min-h-screen">
        {/* Кабель «ноутбук → картка» поверх контенту (pointer-events: none) */}
        <AgentLinkLayer anchor={agentAnchor} targetSelector="[data-agent-target]" />
        {/* Гастролюючий агент ховається під час ноутбук-сцени (щоб не було 3+) */}
        <AgentRoamer hidden={agentLaptop} />
        <div className="relative z-10 mx-auto max-w-7xl px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-8">
          {/* Рядок статусу перенесено у меню (TopNav, 2-й рядок) */}

          {/* ЛОГОТИП по центру: CYBER агент SENTINEL —
              Головна сторінка: назва великими літерами, трохи вище
              за центр (відступ від меню), агент між словами живий. */}
          <section className="animate-fade-in-up mb-4 mt-[7vh] flex justify-center sm:mb-5">
            {/* Логотип CYBER (агент) SENTINEL — компактний, агент щільно до тексту */}
            <h1 className="flex select-none items-center gap-1.5 text-center font-black uppercase leading-none tracking-[0.04em] text-3xl sm:gap-2.5 sm:text-5xl lg:text-6xl">
              <span className="text-glow-strong text-text-primary">
                CYBER
              </span>
              <span className="inline-flex items-center justify-center rounded-full border border-border-strong bg-panel px-0.5 py-0.5 shadow-sm sm:px-1">
                <Agent
                  mood={agentMood}
                  size={40}
                  className="sm:h-[56px] sm:w-[56px] lg:h-[68px] lg:w-[68px]"
                  laptop={agentLaptop}
                  onLaptopAnchor={setAgentAnchor}
                />
              </span>
              <span className="text-glow-strong text-text-primary">
                SENTINEL
              </span>
            </h1>
          </section>

          {isDemo && (
            <div className="animate-fade-in mb-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning shadow-sm sm:mb-6 sm:px-4 sm:py-3 sm:text-sm">
              ⚠️ {t.header.demoWarning}
            </div>
          )}

          {/* ─── Метрики + AI-аналіз: 4 вікна вгорі, 4 внизу,
                 AI-аналіз збоку у ДВА рази ширший (50% ширини),
                 ліві вікна вузькі (4 колонки) ──────────────────── */}
          <section
            className="mb-4 animate-fade-in-up sm:mb-6"
            style={{ animationDelay: "80ms" }}
          >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-4">
              {/* Ліва сітка: ряди однакової висоти (auto-rows-fr) — усі 8 вікон
                  одного розміру; AI-колонка тягнеться рівно на 2 ряди */}
              <div className="grid grid-cols-2 gap-2 auto-rows-fr sm:gap-2.5 md:grid-cols-4" data-agent-cards>
                {/* Р СЏРґ 1 */}
                <div data-agent-target="critical"><StatCard label={t.stats.critical} value={stats?.critical_threats ?? "вЂ”"} accent="critical" icon={<BoltIcon />} delay={0} hint={(t as any).statsHints?.critical} /></div>
                <div data-agent-target="active"><StatCard label={t.stats.active} value={stats?.active_exploits ?? "вЂ”"} accent="warning" icon={<TargetIcon />} delay={60} hint={(t as any).statsHints?.active} /></div>
                <div data-agent-target="new24"><StatCard label={t.stats.new24h} value={stats?.new_cve_24h ?? "вЂ”"} accent="signal" icon={<SparklesIcon />} delay={120} hint={(t as any).statsHints?.new24h} /></div>
                <div data-agent-target="epss"><StatCard label={stats?.risk_label === "High/Critical" ? t.stats.highSeverity : t.stats.epssRisk} value={stats?.high_epss_risk ?? "вЂ”"} accent="warning" icon={<ChartIcon />} delay={180} hint={(t as any).statsHints?.epssRisk} /></div>
                {/* Р СЏРґ 2 */}
                <div data-agent-target="ua"><StatCard label={t.stats.uaAlerts} value={stats?.ua_alerts ?? "вЂ”"} icon={<UaFlag className="h-5 w-8 rounded shadow-sm sm:h-6 sm:w-9" />} delay={240} hint={(t as any).statsHints?.uaAlerts} /></div>
                {/* Вікно: AI-аналіз України (посилання) */}
                <Link
                  href="/ai?tab=ukraine"
                  className="animate-slide-up-fade card group relative flex h-full flex-col justify-between overflow-hidden p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong sm:p-4"
                  style={{ animationDelay: "300ms" }}
                  title={(t as any).sections.aiUkraineButton}
                >
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/0 via-text-muted to-primary/0 opacity-60" />
                  <div className="flex w-full items-start justify-between gap-2">
                    <p className="min-w-0 truncate font-mono text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                      {t.sections.aiUkraine ?? "AI-аналіз України"}
                    </p>
                    <UaFlag className="h-3.5 w-5 flex-shrink-0 rounded shadow-sm" />
                  </div>
                  <p className="mt-1.5 text-3xl font-bold leading-none tracking-tight text-text-primary text-glow">
                    AI
                  </p>
                  <span className="mt-1.5 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-text-muted transition-transform duration-300 group-hover:translate-x-0.5">
                    {t.sections.aiAnalyze ?? ""} в†’
                  </span>
                </Link>
                <div data-agent-target="records"><StatCard label={t.header.records.length > 20 ? "Всього записів" : t.header.records} value={stats?.total_threats ?? "—"} icon={<DatabaseIcon />} delay={360} /></div>
                <div data-agent-target="sources"><StatCard label={t.header.sources} value={sourcesMeta ? `${sourcesMeta.active}/${sourcesMeta.total}` : "вЂ”"} icon={<SourcesIconSmall />} delay={420} /></div>
              </div>

              {/* Збоку: AI-аналіз — h-full, закінчується рівно на 2-му ряді */}
              <div className="min-w-0 h-full" data-agent-target="ai">
                <AiPreviewCard />
              </div>
            </div>
          </section>

          {/* Threat map + Top attacker countries (side by side) */}
          <section className="mb-4 grid grid-cols-1 gap-4 animate-fade-in-up sm:mb-6 lg:grid-cols-3" style={{ animationDelay: "180ms" }}>
            <div className="card hud-corners gradient-border-animated p-4 sm:p-5 lg:col-span-2" data-agent-roam>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex min-w-0 items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-secondary sm:text-xs">
                  <span className={`dot-glow inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full ${mapMode === "ddos" ? "bg-critical text-critical" : "bg-primary text-primary"}`} />
                  <span className="truncate">{mapMode === "ddos" ? t.map.modeDdos : t.map.title}</span>
                </h2>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t.map.modeLabel}>
                  <button
                    type="button"
                    onClick={() => { setMapMode("threats"); setSelectedCountry(null); }}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all sm:text-xs ${
                      mapMode === "threats"
                        ? "bg-primary text-black shadow-[0_0_12px_rgba(255,255,255,0.3)]"
                        : "border border-border bg-panel-raised text-text-secondary hover:border-primary/40 hover:text-text-primary"
                    }`}
                  >
                    {t.map.modeThreats}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMapMode("ddos"); setSelectedCountry(null); }}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all sm:text-xs ${
                      mapMode === "ddos"
                        ? "bg-critical text-black shadow-[0_0_12px_rgba(255,255,255,0.3)]"
                        : "border border-border bg-panel-raised text-text-secondary hover:border-critical/40 hover:text-text-primary"
                    }`}
                  >
                    {t.map.modeDdos}
                  </button>
                </div>
              </div>

              {mapMode === "ddos" && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs">
                  <button
                    type="button"
                    onClick={() => setDdosLayer("layer3")}
                    title={(t.map.ddos as any).layer3Desc ?? ""}
                    className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                      ddosLayer === "layer3"
                        ? "bg-panel-raised text-text-primary ring-1 ring-border-strong"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {t.map.ddos.layer3}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDdosLayer("layer7")}
                    title={(t.map.ddos as any).layer7Desc ?? ""}
                    className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                      ddosLayer === "layer7"
                        ? "bg-panel-raised text-text-primary ring-1 ring-border-strong"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {t.map.ddos.layer7}
                  </button>
                  <span className="mx-1 hidden h-3 w-px bg-border sm:block" />
                  <button
                    type="button"
                    onClick={() => setDdosSide("targets")}
                    className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                      ddosSide === "targets"
                        ? "bg-panel-raised text-text-primary ring-1 ring-border-strong"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {t.map.ddos.targets}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDdosSide("origins")}
                    className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                      ddosSide === "origins"
                        ? "bg-panel-raised text-text-primary ring-1 ring-border-strong"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {t.map.ddos.origins}
                  </button>
                </div>
              )}

              <p className="mb-4 text-xs text-text-secondary sm:text-sm">
                {mapMode === "ddos" ? t.map.ddos.subtitle : t.map.subtitle}
              </p>
              {mapMode === "ddos" ? (
                <DdosMap
                  stats={ddosStats}
                  layer={ddosLayer}
                  side={ddosSide}
                  loading={loading}
                  selectedCountry={selectedCountry}
                  onCountrySelect={setSelectedCountry}
                  compact
                />
              ) : (
                <>
                  {loading ? (
                    <div className="flex h-64 items-center justify-center">
                      <div className="h-8 w-8 spinner-glow" />
                    </div>
                  ) : (
                    <ThreatMap
                      byCountry={stats?.by_country ?? []}
                      ddosOrigins={stats?.ddos_origins ?? []}
                      ddosTargets={stats?.ddos_targets ?? []}
                      selectedCountry={selectedCountry}
                      onCountrySelect={setSelectedCountry}
                    />
                  )}
                </>
              )}
            </div>
            <div className="card hud-corners p-4 sm:p-5" data-agent-roam>
              <HudTitle
                label={mapMode === "ddos" ? (ddosSide === "targets" ? t.map.ddos.targets : t.map.ddos.origins) : t.sections.topAttackerCountries}
                accent="signal"
                className="mb-1"
              />
              <p className="mb-2 text-xs text-text-secondary sm:text-sm">
                {mapMode === "ddos" ? t.map.ddos.subtitle : t.sections.attackerCountriesSubtitle}
              </p>
              {loading ? (
                <div className="flex h-64 items-center justify-center">
                  <div className="h-8 w-8 spinner-glow" />
                </div>
              ) : (
                <TopCountriesPanel
                  mode={mapMode}
                  iocData={stats?.by_country ?? []}
                  ddosData={ddosTopItems}
                  ddosLayer={ddosLayer}
                  ddosSide={ddosSide}
                  selectedCountry={selectedCountry}
                  onSelectCountry={setSelectedCountry}
                />
              )}
              {mapMode === "threats" && (
                <p className="mt-2 text-center text-[9px] text-text-muted italic">
                  {lang === "uk"
                    ? "* Кількість = згадування в записах; одна загроза може стосуватися кількох країн"
                    : lang === "de"
                    ? "* Anzahl = ErwГ¤hnungen; eine Bedrohung kann mehrere LГ¤nder betreffen"
                    : "* Count = mentions in records; one threat may relate to multiple countries"}
                </p>
              )}
              <p className="mt-2 border-t border-border pt-2 text-center text-[10px] leading-relaxed text-text-muted italic">
                {t.sections.geoDisclaimer}
              </p>
            </div>
          </section>
          <section className="mb-4 animate-fade-in-up sm:mb-6" style={{ animationDelay: "260ms" }}>
            <div className="card p-4 sm:p-5" data-agent-roam>
              <HudTitle label={t.sections.actorTracker} accent="critical" className="mb-1" />
              <p className="mb-2 text-xs text-text-secondary sm:text-sm">{t.sections.actorTrackerSubtitle}</p>
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="h-8 w-8 spinner-glow" />
                </div>
              ) : (
                <ActorSankey links={stats?.by_actor ?? []} />
              )}
            </div>
          </section>

          {/* Sponsor countries */}
          <section className="mb-4 animate-fade-in-up sm:mb-6" style={{ animationDelay: "280ms" }}>
            <div className="card p-4 sm:p-5" title={t.sections.sponsorCardTooltip} data-agent-roam>
              <HudTitle label={t.sections.sponsorChart} accent="critical" className="mb-1" />
              <p className="mb-2 text-xs text-text-secondary sm:text-sm">{t.sections.sponsorChartSubtitle}</p>
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="h-8 w-8 spinner-glow" />
                </div>
              ) : (
                <>
                  <SponsorChart
                    data={stats?.by_sponsor ?? []}
                    selected={selectedSponsor}
                    onSelect={toggleSponsor}
                  />
                  {selectedSponsor && sponsorInfra && (
                    <SponsorInfraPanel
                      sponsor={selectedSponsor}
                      infra={sponsorInfra}
                      t={t}
                    />
                  )}
                </>
              )}
            </div>
          </section>

          {/* Top vendors — на всю ширину (була поруч із «За джерелами» у 2/3+1/3) */}
          <section className="mb-6 sm:mb-8">
            <div className="animate-fade-in-up glass-card rounded-xl border border-border p-4 shadow-sm sm:p-5" style={{ animationDelay: "290ms" }} data-agent-roam>
              <HudTitle label={t.sections.topVendors} accent="critical" className="mb-2 sm:mb-3" />
              <VendorChart data={stats?.top_vendors ?? []} dense />
              <p className="mt-3 text-[10px] italic text-text-muted">
                {t.sections.vendorScopeNote}
              </p>
            </div>
          </section>

          {/* Методологія */}
          <section className="mb-6 sm:mb-8">
            <MethodologyPanel />
          </section>

          {/* IOC strip */}
          <section className="animate-fade-in-up mb-6 sm:mb-8" style={{ animationDelay: "350ms" }}>
            <button
              onClick={() => setShowIoc(!showIoc)}
              className="group mb-3 flex items-center gap-2 text-sm font-bold text-text-secondary transition-all hover:text-signal sm:mb-4"
            >
              <svg className={`h-5 w-5 transition-transform duration-300 ${showIoc ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="inline-flex items-center gap-2">
                <span className="dot-glow inline-block h-2 w-2 animate-pulse rounded-full bg-critical text-critical" />
                {t.sections.iocThreats}
              </span>
              <span className="rounded-full border border-border bg-panel-raised px-2 py-0.5 font-mono text-[10px] font-bold text-text-muted">
                {iocThreats.length}
              </span>
            </button>

            {showIoc && (
              <div className="animate-fade-in-up">
                {iocThreats.length === 0 ? (
                  <div className="glass-card rounded-xl border border-border p-8 text-center shadow-sm">
                    <p className="text-sm text-text-secondary">{t.sections.iocEmpty}</p>
                  </div>
                ) : (
                  <div className="scrollbar-thin -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
                    {iocThreats.map((threat, i) => (
                      <IocCard key={threat.id} threat={threat} index={i} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Details */}
          <section className="animate-fade-in-up mb-6 sm:mb-8" style={{ animationDelay: "400ms" }}>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="group mb-3 flex items-center gap-2 text-sm font-bold text-text-secondary transition-all hover:text-signal sm:mb-4"
            >
              <svg className={`h-5 w-5 transition-transform duration-300 ${showDetails ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="dot-glow inline-block h-2 w-2 animate-pulse rounded-full bg-primary text-primary" />
              {t.sections.details}
            </button>

            {showDetails && (
              <div className="animate-fade-in-up grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3">
                <DetailCard title={t.sections.severity} icon={<WarningIcon />}>
                  <div className="space-y-2">
                    {["Critical", "High", "Medium", "Low", "Unknown"].map((sev) => {
                      const count = severityBreakdown[sev] ?? 0;
                      const rawPct =
                        severityPct[sev] ??
                        (severityTotal > 0 ? (count / severityTotal) * 100 : 0);
                      const pct = Math.round(rawPct * 10) / 10;
                      const pctLabel = pct > 0 && pct < 0.1 ? "<0.1" : pct.toFixed(1).replace(/\.0$/, "");
                      const colors: Record<string, string> = {
                        Critical: "bg-critical", High: "bg-warning", Medium: "bg-info", Low: "bg-border-strong", Unknown: "bg-text-muted"
                      };
                      return (
                        <div key={sev}>
                          <div className="mb-1 flex justify-between text-xs text-text-secondary">
                            <span className="font-medium">{t.severity[sev as keyof typeof t.severity] || sev}</span>
                            <span className="font-mono">{count} ({pctLabel}%)</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-panel-raised">
                            <div className={`h-full rounded-full ${colors[sev]} transition-all duration-1000 ease-out`} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </DetailCard>

                <DetailCard title={t.sections.exploitStatus} icon={<TargetIconSmall />}>
                  <div className="space-y-3">
                    {(["In the wild", "Weaponized", "PoC", "Unknown"] as const).map((status) => {
                      const count = exploitBreakdown[status] ?? 0;
                      if (count === 0) return null;
                      const dotColor = status === "In the wild" ? "bg-critical animate-pulse" : status === "Weaponized" ? "bg-warning" : status === "PoC" ? "bg-signal" : "bg-border-strong";
                      const label = status === "In the wild" ? t.exploitStatus.inTheWild : status === "Weaponized" ? t.exploitStatus.weaponized : status === "PoC" ? t.exploitStatus.poc : t.exploitStatus.unknown;
                      return (
                        <div key={status} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
                            <span className="text-sm text-text-secondary">{label}</span>
                          </div>
                          <span className="font-mono text-sm font-bold text-text-primary">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </DetailCard>

                <DetailCard title={t.sections.recentThreats} icon={<ClockIcon />}>
                  <div className="space-y-2.5">
                    <div className="max-h-64 space-y-2.5 overflow-y-auto pr-1 sm:max-h-72">
                      {pageThreats.map((threat) => (
                        <div key={threat.id} className="group flex items-start gap-2">
                          <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${threat.severity === "Critical" ? "bg-critical" : threat.severity === "High" ? "bg-warning" : "bg-info"}`} />
                          <div className="min-w-0 flex-1">
                            <a href={threat.url ?? "#"} target="_blank" rel="noreferrer" className="block truncate text-xs font-medium text-text-primary transition-colors hover:text-signal">
                              {threat.title}
                            </a>
                            <p className="mt-0.5 truncate text-[10px] text-text-muted">{threat.source} В· {threat.severity}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <button
                        type="button"
                        onClick={() => setRecentPage((p) => Math.max(0, p - 1))}
                        disabled={recentPage === 0}
                        className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-secondary transition-all hover:border-signal/40 hover:text-signal disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
                        aria-label={t.a11y.prevPage}
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <span className="font-mono text-[10px] font-bold text-text-muted">
                        {recentPage + 1} / {recentPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRecentPage((p) => Math.min(recentPages - 1, p + 1))}
                        disabled={recentPage >= recentPages - 1}
                        className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-secondary transition-all hover:border-signal/40 hover:text-signal disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
                        aria-label={t.a11y.nextPage}
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </DetailCard>
              </div>
            )}
          </section>

          {/* Threats Table */}
          <section className="mb-6 animate-fade-in-up sm:mb-8" style={{ animationDelay: "500ms" }}>
            <HudTitle label={t.sections.latestThreats} accent="warning" className="mb-3 sm:mb-4" />
            {loading ? (
              <div className="glass-card rounded-xl border border-border p-8 text-center shadow-sm">
                <div className="inline-block h-8 w-8 spinner-glow" />
                <p className="mt-3 text-sm text-text-muted">{t.sections.loading}</p>
              </div>
            ) : (
              <ThreatTable threats={threats.slice(0, 25)} />
            )}
          </section>

          {/* Sources — у самий низ сторінки */}
          <section className="animate-fade-in-up" style={{ animationDelay: "560ms" }}>
            <div className="glass-card rounded-xl border border-border p-4 shadow-sm sm:p-5">
              <HudTitle label={t.sections.bySource} accent="signal" className="mb-3 sm:mb-4" />
              <div className="flex flex-wrap gap-2">
                {stats?.by_source.map((s, i) => (
                  <span
                    key={s.source}
                    className="animate-fade-in inline-flex items-center gap-1.5 rounded-full border border-border bg-panel-raised px-2.5 py-1 text-[11px] font-medium text-text-secondary shadow-sm transition-all hover:scale-105 hover:shadow-md sm:px-3 sm:py-1.5 sm:text-xs"
                    style={{ animationDelay: `${600 + i * 40}ms` }}
                  >
                    {s.source}
                    <span className="font-mono font-bold text-text-primary">{s.count}</span>
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AdminShell>
  );
}

function formatLastUpdate(value: string, lang: string, t: Translations[Language]) {
  const date = parseApiDate(value);
  const locale = lang === "uk" ? "uk-UA" : lang;
  if (!date) return t.header.syncUnavailable;
  return `${t.header.synced} ${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)}`;
}

/** «71 із 93 джерел · оновлено 27.10, 15:30» — у шапці поруч із заголовком сторінки. */
function formatSourcesLine(
  meta: { active: number; total: number; lastFetched: string | null },
  lang: string,
  t: Translations[Language]
) {
  const template = (t.header as { sourcesCounter?: string }).sourcesCounter;
  if (!template) return `${meta.active} / ${meta.total}`;
  let dateLabel = "вЂ”";
  const d = parseApiDate(meta.lastFetched);
  if (d) {
    const locale = lang === "uk" ? "uk-UA" : lang;
    dateLabel = `${new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(d)}, ${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d)}`;
  }
  return template
    .replace("{active}", String(meta.active))
    .replace("{total}", String(meta.total))
    .replace("{date}", dateLabel);
}

function DetailCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-xl border border-border p-4 shadow-sm sm:p-5">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-muted">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function BoltIcon() {
  return (
    <svg className="h-4 w-4 text-[#E5322D] sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg className="h-4 w-4 text-warning sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg className="h-4 w-4 text-signal sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg className="h-4 w-4 text-warning sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="h-4 w-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg className="h-4 w-4 text-text-secondary sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <ellipse cx={12} cy={5} rx={9} ry={3} />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
    </svg>
  );
}

function SourcesIconSmall() {
  return (
    <svg className="h-4 w-4 text-text-secondary sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
    </svg>
  );
}

function TargetIconSmall() {
  return (
    <svg className="h-4 w-4 text-signal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-4 w-4 text-info" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

const IOC_SOURCE_COLOR: Record<string, string> = {
  "ThreatFox": "text-critical/80 border-critical/30 bg-critical/10",
  "MalwareBazaar": "text-warning border-warning/30 bg-warning/10",
  "AlienVault OTX": "text-info border-info/30 bg-info/10",
};

function IocCard({ threat, index }: { threat: Threat; index: number }) {
  const iocValue = (threat.summary?.split("\n")[0] || threat.external_id || "").slice(0, 60);
  const sourceStyle = IOC_SOURCE_COLOR[threat.source] ?? "text-signal border-signal/30 bg-signal/10";
  const host = (() => {
    try {
      return new URL(threat.url ?? "").hostname;
    } catch {
      return threat.source;
    }
  })();
  return (
    <a
      href={threat.url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="animate-fade-in flex w-60 flex-shrink-0 flex-col gap-2 rounded-xl border border-border bg-panel p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-signal/40 hover:shadow-md"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold ${sourceStyle}`}>
          {threat.source}
        </span>
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${threat.severity === "Critical" ? "bg-critical" : threat.severity === "High" ? "bg-warning" : threat.severity === "Medium" ? "bg-info" : "bg-border-strong"}`} />
      </div>
      <span className="line-clamp-2 text-xs font-medium leading-snug text-text-primary">
        {threat.title}
      </span>
      {iocValue && (
        <span className="block truncate font-mono text-[10px] text-text-muted" title={threat.summary ?? undefined}>
          {iocValue}
        </span>
      )}
      <span className="mt-auto flex items-center gap-1 text-[10px] text-text-muted">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        {host}
      </span>
    </a>
  );
}

function SponsorInfraPanel({
  sponsor,
  infra,
  t,
}: {
  sponsor: string;
  infra: SponsorInfraResponse;
  t: Translations[Language];
}) {
  const { lang } = useTranslation();
  const pairs = infra.pairs.filter((p) => p.sponsor === sponsor);
  const name = SPONSOR_NAMES[lang]?.[sponsor] ?? sponsor;
  if (pairs.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
        <p className="text-xs font-semibold text-text-primary">
          {t.sections.sponsorInfraTitle} вЂ” {name}
        </p>
        <p className="mt-1 text-[10px] italic text-text-muted">
          {t.sections.sponsorInfraEmpty}
        </p>
      </div>
    );
  }
  const top = pairs.slice(0, 8);
  const max = Math.max(1, ...top.map((p) => p.count));
  const geoTotal = pairs.reduce((acc, p) => acc + p.count, 0);
  const links = infra.actor_links_by_sponsor[sponsor] ?? 0;
  const coverage = t.sections.sponsorInfraCoverage
    .replace("{n}", String(geoTotal))
    .replace("{m}", String(links));
  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-xs font-semibold text-text-primary">
        {t.sections.sponsorInfraTitle} вЂ” {name}
      </p>
      <p className="mb-2 mt-0.5 text-[10px] text-text-muted">
        {t.sections.sponsorInfraSubtitle}
      </p>
      <div className="space-y-1.5">
        {top.map((p) => (
          <div key={p.country} className="flex items-center gap-2">
            <span className="w-28 flex-shrink-0 truncate text-right text-xs text-text-secondary sm:w-32">
              {p.country}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-white/5">
              <div
                className="h-full rounded bg-gradient-to-r from-critical/60 to-critical/25"
                style={{ width: `${(p.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 flex-shrink-0 text-right font-mono text-xs text-text-secondary">
              {p.count}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 border-t border-white/10 pt-1.5 text-[10px] italic text-text-muted">
        {coverage}
      </p>
    </div>
  );
}
