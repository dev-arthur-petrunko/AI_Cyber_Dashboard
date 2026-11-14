"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { DdosMap } from "@/components/DdosMap";
import { useTranslation } from "@/components/LanguageContext";
import { countryName } from "@/lib/countries";
import type { DdosLayer, DdosStats } from "@/lib/types";

const PYTHON_API = process.env.NEXT_PUBLIC_PYTHON_API || "http://127.0.0.1:8010";

type Side = "targets" | "origins";

export default function DdosPage() {
  const { t, lang } = useTranslation();
  const [stats, setStats] = useState<DdosStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [layer, setLayer] = useState<DdosLayer>("layer7");
  const [side, setSide] = useState<Side>("targets");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${PYTHON_API}/ddos-stats?scope=global`);
        if (res.ok) setStats(await res.json());
      } catch {}
      setLoading(false);
    };
    load();
  }, []);

  const layerStats = stats?.[layer];
  const topMetric = side === "targets" ? "top_targets" : "top_origins";
  const topItems =
    layerStats?.metrics?.[topMetric]?.view &&
    "items" in (layerStats.metrics[topMetric].view as any)
      ? (layerStats.metrics[topMetric].view as any).items
      : [];

  const summaryView = layerStats?.metrics?.summary?.view;
  const vectors =
    summaryView && "labels" in (summaryView as any)
      ? (summaryView as any).labels
      : [];

  return (
    <AdminShell title={t.map.modeDdos}>
      <div className="mx-auto max-w-[100rem] px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8">

        {/* Header */}
        <header className="relative mb-6 animate-fade-in-up sm:mb-8">
          <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-danger/6 blur-[60px]" />
          <div className="relative">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-0.5 w-6 rounded-full bg-gradient-to-r from-text-primary to-text-muted" />
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-secondary">
                CLOUDFLARE RADAR
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-text-primary sm:text-2xl lg:text-3xl">
              <span className="bg-gradient-to-r from-text-primary to-text-muted bg-clip-text text-transparent">
                {t.map.modeDdos}
              </span>
            </h1>
            <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-text-muted sm:text-sm">
              {t.map.ddos.subtitle}
            </p>
            <p className="mt-0.5 text-[10px] text-text-muted italic">
              {lang === "uk"
                ? "Дані завжди глобальні — Cloudflare Radar не підтримує фільтр за країною-запитом"
                : lang === "de"
                ? "Daten sind immer global — Cloudflare Radar unterstützt keinen Länder-Filter"
                : lang === "fr"
                ? "Les données sont toujours mondiales — Cloudflare Radar ne prend pas en charge le filtrage par pays"
                : lang === "pl"
                ? "Dane są zawsze globalne — Cloudflare Radar nie obsługuje filtrowania według kraju"
                : "Data is always global — Cloudflare Radar does not support country-scoped queries"}
            </p>
          </div>
        </header>

        {/* Controls */}
        <div className="mb-6 flex flex-wrap gap-2">
          <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
            {(["layer7", "layer3"] as DdosLayer[]).map((l) => (
              <button
                key={l}
                onClick={() => setLayer(l)}
                title={l === "layer3" ? ((t.map.ddos as any).layer3Desc ?? "") : ((t.map.ddos as any).layer7Desc ?? "")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  layer === l
                    ? "bg-danger/20 text-white"
                    : "text-text-muted hover:text-text-secondary hover:bg-white/5"
                }`}
              >
                {l === "layer7" ? t.map.ddos.layer7 : t.map.ddos.layer3}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
            {(["targets", "origins"] as Side[]).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  side === s
                    ? "bg-info/20 text-white"
                    : "text-text-muted hover:text-text-secondary hover:bg-white/5"
                }`}
              >
                {s === "targets" ? t.map.ddos.targets : t.map.ddos.origins}
              </button>
            ))}
          </div>
        </div>

        {/* Map */}
        <div className="mb-6">
          <DdosMap
            stats={stats}
            layer={layer}
            side={side}
            loading={loading}
            selectedCountry={null}
            onCountrySelect={() => {}}
            mapWidth={1100}
          />
        </div>

        {/* Top countries table */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-primary">
              {side === "targets" ? t.map.ddos.targets : t.map.ddos.origins} — {layer === "layer7" ? "L7" : "L3"}
            </h3>
            {loading ? (
              <div className="flex h-20 items-center justify-center text-text-muted">...</div>
            ) : topItems.length > 0 ? (
              <div className="space-y-1.5">
                {topItems.slice(0, 15).map((item: any, i: number) => {
                  const iso = String(item.code || item.country || "").toUpperCase();
                  const localized = countryName(iso, (t.map.countries as Record<string, string>)) || countryName(item.country, (t.map.countries as Record<string, string>)) || item.country;
                  return (
                  <div key={item.code || i} className="flex items-center gap-2">
                    <span className="w-5 text-right font-mono text-[10px] text-text-muted">{i + 1}</span>
                    <span className="flex-1 truncate text-xs text-text-secondary">
                      {localized}
                    </span>
                    <div className="relative h-4 w-24 overflow-hidden rounded bg-white/5">
                      <div
                        className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-danger/60 to-danger/30"
                        style={{ width: `${(item.value / Math.max(...topItems.map((t: any) => t.value), 1)) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono text-[10px] text-text-secondary">
                      {item.value.toFixed(1)}%
                    </span>
                  </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-text-muted">{t.map.ddos.noData}</p>
            )}
          </div>

          {/* Attack vectors */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-primary">Вектори атак</h3>
            {loading ? (
              <div className="flex h-20 items-center justify-center text-text-muted">...</div>
            ) : vectors.length > 0 ? (
              <div className="space-y-1.5">
                {vectors.slice(0, 12).map((v: any, i: number) => (
                  <div key={v.name || i} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-xs text-text-secondary">{v.name}</span>
                    <div className="relative h-4 w-20 overflow-hidden rounded bg-white/5">
                      <div
                        className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-warning/60 to-warning/30"
                        style={{ width: `${(v.value / Math.max(...vectors.map((x: any) => x.value), 1)) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono text-[10px] text-text-secondary">
                      {v.value.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted">Немає даних</p>
            )}
          </div>
        </div>

        {/* Єдиний блок нотаток: гео-дисклеймер завжди, Layer 7 — за режимом */}
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
          <p className="text-[10px] leading-relaxed text-text-muted italic">
            {t.sections.geoDisclaimer}
          </p>
          {layer === "layer7" && (
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              <span className="font-semibold text-warning">⚠</span>{" "}
              {t.map.ddos.layer7ScopeNote}
            </p>
          )}
        </div>

      </div>
    </AdminShell>
  );
}
