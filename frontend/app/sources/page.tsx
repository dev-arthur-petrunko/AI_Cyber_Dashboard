"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useTranslation } from "@/components/LanguageContext";
import sources from "../../../data/sources_status.json";

interface SourceItem {
  name: string;
  url: string;
  status?: string;
  description?: string;
  problem?: string;
  possible_solution?: string;
  requires_key?: string | null;
  docs?: string;
  country?: string;
  flag?: string;
  org?: string;
  connection?: string;
  rss?: string | null;
  license?: string;
  type?: string;
  freshness?: string;
}

export default function SourcesPage() {
  const { t } = useTranslation();

  // Живі статуси джерел із бекенду (лічильники в БД).
  // null — дані ще не завантажені або бекенд недоступний: тоді показуємо
  // статус із конфіга, щоб не позначати всі джерела "не налаштованими".
  const [received, setReceived] = useState<Record<string, number | null> | null>(null);

  // Доступність (HTTP) сторінок ML-датасетів: name -> available.
  const [datasetLive, setDatasetLive] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    fetch(`${apiUrl}/sources`, { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.received) setReceived(data.received);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeoutId));
    fetch(`${apiUrl}/datasets`, { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.datasets) {
          const live: Record<string, boolean> = {};
          for (const ds of data.datasets) {
            live[ds.name] = Boolean(ds.payload?.check?.available);
          }
          setDatasetLive(live);
        }
      })
      .catch(() => {});
    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <AdminShell title={t.sources.title}>
      <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6 lg:px-8 lg:py-8">
        <header className="mb-6 animate-fade-in-up sm:mb-8">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-0.5 w-6 rounded-full bg-gradient-to-r from-text-primary to-text-muted" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-secondary">
              18+ OPEN FEEDS
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-text-primary sm:text-2xl lg:text-3xl">
            <span className="bg-gradient-to-r from-text-primary to-text-muted bg-clip-text text-transparent">
              {t.sources.title}
            </span>
          </h1>
          <p className="mt-2 text-xs text-text-secondary sm:text-sm">
            {t.sources.subtitle}
          </p>
        </header>

        {/* Telemetry API */}
        <SourceSection
          title={t.sources.telemetry}
          icon="🛰"
          items={(sources.telemetry_api as SourceItem[]) || []}
          render={(s, i) => (
            <TelemetryCard key={s.name} item={s} delay={i} received={received?.[s.name]} />
          )}
        />

        {/* World sources */}
        <SourceSection
          title={t.sources.worldSources}
          icon="🌍"
          items={(sources.world_sources as SourceItem[]) || []}
          render={(s, i) => (
            <TelemetryCard key={s.name} item={s} delay={i} received={received?.[s.name]} />
          )}
        />

        {/* Vendor RSS */}
        <SourceSection
          title={t.sources.vendorRSS}
          icon="📡"
          items={(sources.vendor_rss as SourceItem[]) || []}
          render={(s, i) => (
            <SourceCard key={s.name} name={s.name} url={s.url} description={cardText(t, s.name, s.description || "")} received={received?.[s.name]} delay={i} license={s.license} />
          )}
        />

        {/* Integrated UA sources */}
        <SourceSection
          title={t.sources.integrated}
          icon="✓"
          items={(sources.integrated_ua as SourceItem[]) || []}
          render={(s, i) => (
            <SourceCard key={s.name} name={s.name} url={s.url} description={cardText(t, s.name, s.description || "")} received={received?.[s.name]} delay={i} license={s.license} />
          )}
        />

        {/* Planned UA sources */}
        <SourceSection
          title={t.sources.planned}
          icon="⚠"
          items={(sources.planned_ua as SourceItem[]) || []}
          render={(s, i) => (
            <PlannedCard key={s.name} item={s} delay={i} received={received?.[s.name]} />
          )}
        />

        {/* New international CERT sources */}
        <SourceSection
          title={t.sources.certInternational}
          icon="🌐"
          items={(sources.cert_international_new as SourceItem[]) || []}
          render={(s, i) => (
            <CertCard key={s.name} item={s} delay={i} received={received?.[s.name]} />
          )}
        />

        {/* DDoS: метрики та новини */}
        <SourceSection
          title={t.sources.ddos}
          icon="🛡"
          items={(sources.ddos_sources as SourceItem[]) || []}
          render={(s, i) => (
            <SourceCard key={s.name} name={s.name} url={s.url} description={cardText(t, s.name, s.description || "")} received={received?.[s.name]} delay={i} license={s.license} />
          )}
        />

        {/* DDoS ML datasets */}
        <SourceSection
          title={t.sources.mlDatasets}
          icon="🤖"
          items={(sources.ml_datasets as SourceItem[]) || []}
          render={(s, i) => (
            <DatasetCard
              key={s.name}
              item={s}
              delay={i}
              received={received?.[s.name]}
              live={datasetLive?.[s.name]}
            />
          )}
        />

        <footer className="mt-10 animate-fade-in text-center text-xs text-text-muted" style={{ animationDelay: "500ms" }}>
          {t.sources.footer}
        </footer>
      </div>
    </AdminShell>
  );
}

function SourceSection<T extends SourceItem>({
  title,
  icon,
  items,
  render,
}: {
  title: string;
  icon: string;
  items: T[];
  render: (item: T, index: number) => React.ReactNode;
}) {
  if (!items.length) return null;
  return (
    <section className="animate-fade-in-up mb-8" style={{ animationDelay: "100ms" }}>
      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-signal/20 text-xs">{icon}</span>
        <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-text-secondary">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((s, i) => render(s, i))}
      </div>
    </section>
  );
}

function SourceCard({
  name,
  url,
  description,
  received,
  delay,
  license,
}: {
  name: string;
  url: string;
  description: string;
  received?: number | null;
  delay: number;
  license?: string;
}) {
  const { t } = useTranslation();
  const live = received !== undefined ? (received ?? 0) > 0 : undefined;
  const statusColor = live === true ? "bg-signal" : live === false ? "bg-warning" : "bg-border-strong";

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="animate-fade-in-up group relative overflow-hidden rounded-xl border border-border bg-panel p-4 shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg sm:p-5"
      style={{ animationDelay: `${150 + delay * 80}ms` }}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${statusColor}`} />
      <div className="flex items-start justify-between">
        <h3 className="font-bold text-text-primary transition-colors group-hover:text-signal">{name}</h3>
        {live !== undefined && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white ${statusColor}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${live === true ? "animate-pulse bg-white" : "bg-white/70"}`} />
            {live === true ? t.sources.active : t.sources.notConfigured}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-text-secondary">{description}</p>
      {live === true && (
        <p className="mt-2 text-xs font-semibold text-signal">{received} {t.sources.records}</p>
      )}
      {license && (
        <p className="mt-1.5 text-xs text-text-muted">
          <span className="font-semibold text-text-secondary">{t.sources.license}: </span>
          {license}
        </p>
      )}
      <p className="mt-3 truncate text-xs text-text-muted">{new URL(url).hostname}</p>
    </a>
  );
}

function TelemetryCard({ item, delay, received }: { item: SourceItem; delay: number; received?: number | null }) {
  const { t } = useTranslation();
  const live = received !== undefined ? (received ?? 0) > 0 : undefined;
  // Джерело вимагає API-ключ і ще не підключене → вся картка червона
  const needsKey = live !== true && Boolean(item.requires_key);
  const badgeColor =
    needsKey
      ? "bg-critical"
      : live === true
        ? "bg-signal"
        : live === false
          ? "bg-warning"
          : item.status === "active"
            ? "bg-signal"
            : item.status === "partial"
              ? "bg-warning"
              : "bg-info";
  const badgeText =
    live === true
      ? t.sources.active
      : live === false
        ? t.sources.notConfigured
        : item.status === "active"
          ? t.sources.active
          : item.status === "partial"
            ? t.sources.partial
            : t.sources.statusPlanned;

  return (
    <div
      className={`animate-fade-in-up relative overflow-hidden rounded-xl p-4 shadow-sm sm:p-5 ${needsKey ? "border border-critical" : "glass-card border border-border"}`}
      style={{
        animationDelay: `${150 + delay * 80}ms`,
        ...(needsKey ? { backgroundColor: "rgba(255, 255, 255, 0.06)" } : {}),
      }}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${badgeColor}`} />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-text-primary">{item.name}</h3>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white ${badgeColor}`}>
          {badgeText}
        </span>
      </div>
      <p className="text-sm text-text-secondary">{cardText(t, item.name, item.description || "")}</p>
      {live === true && (
        <p className="mt-2 text-xs font-semibold text-signal">{received} {t.sources.records}</p>
      )}
      {item.license && (
        <p className="mt-1.5 text-xs text-text-muted">
          <span className="font-semibold text-text-secondary">{t.sources.license}: </span>
          {item.license}
        </p>
      )}
      {live === false && (item.problem || item.possible_solution) && (
        <p className="mt-2 text-xs text-warning">{item.problem ?? item.possible_solution}</p>
      )}
      {needsKey && (
        <p className="mt-2 text-xs font-medium text-critical">
          {t.sources.keyRequired} <span className="font-mono font-semibold">{item.requires_key}</span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-signal hover:underline"
        >
          {new URL(item.url).hostname}
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
        {item.docs && (
          <a
            href={item.docs}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-info hover:underline"
          >
            {t.sources.docs}
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

function PlannedCard({ item, delay, received }: { item: SourceItem; delay: number; received?: number | null }) {
  const { t } = useTranslation();
  const live = received !== undefined ? (received ?? 0) > 0 : undefined;
  const translated = sourcePlannedText(t, item.name);
  const problem = translated?.problem ?? item.problem;
  const solution = translated?.solution ?? item.possible_solution;
  return (
    <div
      className="animate-slide-in-right glass-card rounded-xl border border-border p-4 shadow-sm sm:p-5"
      style={{ animationDelay: `${300 + delay * 80}ms` }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-text-primary">{item.name}</h3>
        <span className="flex items-center gap-2">
          {live !== undefined && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white ${
                live ? "bg-signal" : "bg-warning"
              }`}
            >
              {live ? t.sources.active : t.sources.notConfigured}
            </span>
          )}
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-signal hover:underline"
          >
            {new URL(item.url).hostname}
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </span>
      </div>
      {live === true ? (
        <p className="text-sm font-semibold text-signal">
          {received} {t.sources.records}
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-text-secondary">
            <span className="font-semibold text-warning">{t.sources.problem}</span> {problem}
          </p>
          <p className="text-text-muted">
            <span className="font-semibold text-signal">{t.sources.solution}</span> {solution}
          </p>
        </div>
      )}
    </div>
  );
}

const CERT_STATUS_STYLE: Record<string, { badge: string; bar: string; label: string }> = {
  ready: { badge: "bg-signal", bar: "bg-signal", label: "ready" },
  partial: { badge: "bg-warning", bar: "bg-warning", label: "partial" },
  needs_setup: { badge: "bg-info", bar: "bg-info", label: "needs_setup" },
};

function CertCard({ item, delay, received }: { item: SourceItem; delay: number; received?: number | null }) {
  const { t } = useTranslation();
  const live = received !== undefined ? (received ?? 0) > 0 : undefined;
  const style =
    live === true
      ? { badge: "bg-signal", bar: "bg-signal", label: t.sources.active }
      : live === false
        ? { badge: "bg-warning", bar: "bg-warning", label: t.sources.notConfigured }
        : CERT_STATUS_STYLE[item.status || "needs_setup"] ?? CERT_STATUS_STYLE.needs_setup;
  return (
    <div
      className="animate-fade-in-up relative overflow-hidden rounded-xl border border-border bg-panel p-4 shadow-sm sm:p-5"
      style={{ animationDelay: `${150 + delay * 80}ms` }}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${style.bar}`} />
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none" title={item.country}>{item.flag}</span>
          <h3 className="font-bold text-text-primary">{item.name}</h3>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white ${style.badge}`}>
          {style.label}
        </span>
      </div>
      {item.connection && (
        <p className="mb-1.5 text-xs font-semibold text-info">{item.connection}</p>
      )}
      <p className="text-sm text-text-secondary">{item.description}</p>
      {live === true && (
        <p className="mt-2 text-xs font-semibold text-signal">{received} {t.sources.records}</p>
      )}
      {item.license && (
        <p className="mt-1.5 text-xs text-text-muted">
          <span className="font-semibold text-text-secondary">{t.sources.license}: </span>
          {item.license}
        </p>
      )}
      {live === false && item.possible_solution && (
        <p className="mt-2 text-xs text-warning">{item.possible_solution}</p>
      )}
      {item.rss && (
        <p className="mt-2 truncate text-xs font-mono text-text-muted">
          <span className="font-semibold text-info">RSS: </span>
          <a href={item.rss} target="_blank" rel="noreferrer" className="hover:underline">{item.rss}</a>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-signal hover:underline"
        >
          {new URL(item.url).hostname}
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>
  );
}

function cardText(t: ReturnType<typeof useTranslation>["t"], name: string, fallback: string): string {
  const cards = (t as unknown as { sourceCards?: Record<string, string> }).sourceCards;
  return cards?.[name] ?? fallback;
}

// Картка ML-датасета: ліцензія, тип, актуальність, кількість записів
// та доступність сторінки (last HTTP check з dataset_snapshots).
function DatasetCard({
  item,
  delay,
  received,
  live,
}: {
  item: SourceItem;
  delay: number;
  received?: number | null;
  live?: boolean;
}) {
  const { t } = useTranslation();
  const statusLabel = live === false ? t.sources.notConfigured : t.sources.active;
  const statusClass = live === false ? "bg-warning" : "bg-signal";

  return (
    <div
      className="animate-fade-in-up relative overflow-hidden rounded-xl border border-border bg-panel p-4 shadow-sm sm:p-5"
      style={{ animationDelay: `${150 + delay * 80}ms` }}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${statusClass}`} />
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-bold text-text-primary">{item.name}</h3>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white ${statusClass}`}>
          {live === false ? "⚠ " : ""}{statusLabel}
        </span>
      </div>
      <p className="text-sm text-text-secondary">{item.description}</p>
      {item.type && (
        <p className="mt-2 text-xs text-text-muted">
          <span className="font-semibold text-text-secondary">{t.sources.type}: </span>
          {item.type}
        </p>
      )}
      {item.freshness && (
        <p className="mt-1 text-xs text-text-muted">
          <span className="font-semibold text-text-secondary">{t.sources.freshness}: </span>
          {item.freshness}
        </p>
      )}
      {item.license && (
        <p className="mt-1 text-xs text-text-muted">
          <span className="font-semibold text-text-secondary">{t.sources.license}: </span>
          {item.license}
        </p>
      )}
      {typeof received === "number" && received > 0 && (
        <p className="mt-2 text-xs font-semibold text-signal">{received.toLocaleString()} {t.sources.records}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-signal hover:underline"
        >
          {new URL(item.url).hostname}
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
        {item.docs && (
          <a
            href={item.docs}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-info hover:underline"
          >
            {t.sources.docs}
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

function sourcePlannedText(
  t: ReturnType<typeof useTranslation>["t"],
  name: string,
): { problem?: string; solution?: string } | undefined {
  const planned = (t as unknown as { sourcePlanned?: Record<string, { problem: string; solution: string }> }).sourcePlanned;
  return planned?.[name];
}
