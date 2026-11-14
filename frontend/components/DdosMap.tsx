"use client";

// DDoS-карта-планета (Cloudflare Radar): ортографічна проєкція d3-geo
// з повільним авто-обертанням. Дугами показано потоки атак
// «країна-джерело → країна-ціль» (синтез пар за рангом топ-листів),
// пульсуючі кільця — найактивніші країни. Планету можна обертати
// перетягуванням; клік по країні виділяє її (синхронно з легендою).
// Нижче — звичний графік динаміки за 30 днів і атрибуція Cloudflare.
// Дані приходять з API /ddos-stats (зрізи ddos_snapshots), live-запитів немає.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  geoDistance,
  geoGraticule10,
  geoInterpolate,
  geoOrthographic,
  geoPath,
} from "d3-geo";
import type { GeoPermissibleObjects } from "d3-geo";
import {
  CENTROIDS,
  countryFeatures,
  mulberry32,
} from "@/lib/worldGeo";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "./LanguageContext";
import { COUNTRY_TO_ISO } from "@/lib/countries";
import type { DdosLayer, DdosStats } from "@/lib/types";

type Side = "targets" | "origins";

const CRITICAL = "#F5F5F5"; // ч/б: цілі — світлі
const ORIGIN = "#8A8A8A"; // ч/б: джерела — сірі
const SUCCESS = "#B8B8B8"; // ч/б: спадання

type CountryDatum = { iso2: string; value: number };

export function DdosMap({
  stats,
  layer,
  side,
  loading,
  selectedCountry,
  onCountrySelect,
  compact = false,
  mapWidth,
}: {
  stats: DdosStats | null;
  layer: DdosLayer;
  side: Side;
  loading: boolean;
  selectedCountry: string | null;
  onCountrySelect: (code: string | null) => void;
  compact?: boolean;
  mapWidth?: number;
}) {
  const { t } = useTranslation();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const layerStats = stats?.[layer];
  const topMetric = side === "targets" ? "top_targets" : "top_origins";
  const topView = layerStats?.metrics?.[topMetric]?.view;
  const tsView = layerStats?.metrics?.["timeseries"]?.view;
  const attribution =
    layerStats?.metrics?.["summary"]?.source && layerStats?.metrics?.["summary"]?.license
      ? `${layerStats.metrics["summary"].source} (${layerStats.metrics["summary"].license})`
      : null;

  /* Обидва списки незалежно від активного перемикача: дуги потребують
     пари «джерело → ціль», хороплет підсвичує активний бік. */
  const splitData = useMemo(() => {
    const collect = (metric: string): CountryDatum[] => {
      const view = layerStats?.metrics?.[metric]?.view;
      if (!view || !("items" in view)) return [];
      const counts = new Map<string, number>();
      (view as { items: { country: string; code?: string; value: number }[] }).items.forEach((item) => {
        const code = (item.code || COUNTRY_TO_ISO[item.country] || "").toUpperCase();
        if (code) counts.set(code, (counts.get(code) ?? 0) + item.value);
      });
      return Array.from(counts.entries())
        .map(([iso2, value]) => ({ iso2, value }))
        .sort((a, b) => b.value - a.value);
    };
    return { targets: collect("top_targets"), origins: collect("top_origins") };
  }, [layerStats]);

  const mapData = useMemo(
    () =>
      splitData[side].map((d) => ({ country: d.iso2, value: d.value })),
    [splitData, side]
  );

  const topCountries = mapData.slice(0, 6);
  const maxValue = Math.max(1, ...mapData.map((d) => d.value));

  const chartData = useMemo(() => {
    if (!tsView || !("points" in tsView)) return [];
    return (tsView as { points: { date: string; value: number }[] }).points.map((p) => ({
      date: p.date,
      value: p.value,
    }));
  }, [tsView]);

  const weekDelta = useMemo(() => {
    if (chartData.length < 14) return null;
    const sorted = [...chartData].sort((a, b) => a.date.localeCompare(b.date));
    const sum = (arr: { value: number }[]) => arr.reduce((acc, p) => acc + p.value, 0);
    const prev = sum(sorted.slice(-14, -7));
    if (prev <= 0) return null;
    return ((sum(sorted.slice(-7)) - prev) / prev) * 100;
  }, [chartData]);

  const active =
    selectedCountry && mapData.some((d) => d.country === selectedCountry)
      ? selectedCountry
      : null;
  const selectedItem = active ? mapData.find((d) => d.country === active) : null;

  const hasData = mapData.length > 0 || chartData.length > 0;

  const baseFill = isDark ? "#1C1C1C" : "#CBD5E1";

  const scaleFill = (value: number) => {
    const ratio = 0.3 + 0.7 * (value / maxValue);
    return `rgba(255, 255, 255, ${ratio.toFixed(2)})`;
  };

  const countryNames = t.map.countries as Record<string, string>;
  const selectedName = selectedItem ? countryNames[selectedItem.country] ?? selectedItem.country : null;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 spinner-glow" />
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border bg-panel-raised px-4">
        <p className="max-w-sm text-center text-xs leading-relaxed text-text-muted sm:text-sm">
          {t.map.ddos.noData}
        </p>
      </div>
    );
  }

  return (
    <div>
      <DdosPlanet
        targets={splitData.targets}
        origins={splitData.origins}
        side={side}
        active={active}
        isDark={isDark}
        baseFill={baseFill}
        scaleFill={scaleFill}
        countryNames={countryNames}
        compact={compact}
        mapWidth={mapWidth}
        onSelect={onCountrySelect}
      />

      {/* Картка підсвіченої країни (клік/тап по мапі або легенді) */}
      {selectedItem && selectedName && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 animate-fade-in">
          <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: CRITICAL }} />
          <span className="truncate text-sm font-bold text-text-primary">{selectedName}</span>
          <span className="ml-auto font-mono text-sm font-black text-critical">
            {selectedItem.value}%
          </span>
          <button
            type="button"
            onClick={() => onCountrySelect(null)}
            aria-label={t.map.ddos.deselect}
            className="ml-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-critical/20 hover:text-critical"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Легенда: топ цілі + топ джерела (клік підсвічує країну) */}
      <LegendGrid
        title={`${t.map.ddos.targets} · L${layer === "layer7" ? "7" : "3"}`}
        items={splitData.targets.slice(0, 4)}
        color={CRITICAL}
        active={active}
        countryNames={countryNames}
        onSelect={onCountrySelect}
      />
      <LegendGrid
        title={`${t.map.ddos.origins} · L${layer === "layer7" ? "7" : "3"}`}
        items={splitData.origins.slice(0, 4)}
        color={ORIGIN}
        active={active}
        countryNames={countryNames}
        onSelect={onCountrySelect}
        className="mt-1.5"
      />

      {/* Динаміка атак за 30 днів + зміна за тиждень */}
      {chartData.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-panel-raised p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-text-secondary">{t.map.ddos.trend}</p>
            {weekDelta !== null && (
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <span
                  className={
                    weekDelta > 0.05
                      ? "text-critical"
                      : weekDelta < -0.05
                        ? ""
                        : "text-text-muted"
                  }
                  style={weekDelta < -0.05 ? { color: SUCCESS } : undefined}
                >
                  {weekDelta > 0.05 ? "↑" : weekDelta < -0.05 ? "↓" : "≈"} {Math.abs(weekDelta).toFixed(1)}%
                </span>
                <span className="text-text-muted">{t.map.ddos.deltaWeek}</span>
              </p>
            )}
          </div>
          <div className={compact ? "h-40" : "h-56 sm:h-64"}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="ddosGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: isDark ? "#8A94A6" : "#6B7280" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: isDark ? "#8A94A6" : "#6B7280" }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: isDark ? "#1C1C1C" : "#FFFFFF",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}`,
                    borderRadius: "0.75rem",
                    fontSize: 11,
                  }}
                  formatter={(value: number) => [`${value.toFixed(2)}%`, t.map.ddos.share]}
                />
                <Area type="monotone" dataKey="value" stroke="#F5F5F5" strokeWidth={1.5} fill="url(#ddosGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {attribution && (
        <p className="mt-3 text-right text-[10px] text-text-muted">
          {t.map.ddos.attribution}
          {` · ${attribution}`}
        </p>
      )}
    </div>
  );
}

/* ─── Легенда однієї сторони ───────────────────────────────────── */

function LegendGrid({
  title,
  items,
  color,
  active,
  countryNames,
  onSelect,
  className = "",
}: {
  title: string;
  items: CountryDatum[];
  color: string;
  active: string | null;
  countryNames: Record<string, string>;
  onSelect: (code: string | null) => void;
  className?: string;
}) {
  if (!items.length) return null;
  const max = Math.max(1, ...items.map((d) => d.value));
  return (
    <div className={`mt-3 ${className}`}>
      <p className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color }}>
        {title}
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {items.map((d) => (
          <button
            key={d.iso2}
            type="button"
            onClick={() => onSelect(active === d.iso2 ? null : d.iso2)}
            aria-pressed={active === d.iso2}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-all ${
              active === d.iso2 ? "bg-panel-raised ring-1 ring-critical/40" : "bg-panel-raised"
            }`}
          >
            <span
              className="h-3 w-3 flex-shrink-0 rounded-sm"
              style={{ background: color, opacity: 0.35 + 0.65 * (d.value / max) }}
            />
            <span className="truncate text-xs font-medium text-text-primary">
              {countryNames[d.iso2] ?? d.iso2}
            </span>
            <span className="ml-auto font-mono text-xs font-bold text-text-secondary">
              {d.value.toFixed(1)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Планета ──────────────────────────────────────────────────── */

type Rot = { lambda: number; phi: number };

function DdosPlanet({
  targets,
  origins,
  side,
  active,
  isDark,
  baseFill,
  scaleFill,
  countryNames,
  compact,
  mapWidth,
  onSelect,
}: {
  targets: CountryDatum[];
  origins: CountryDatum[];
  side: Side;
  active: string | null;
  isDark: boolean;
  baseFill: string;
  scaleFill: (v: number) => string;
  countryNames: Record<string, string>;
  compact: boolean;
  mapWidth?: number;
  onSelect: (code: string | null) => void;
}) {
  const W = mapWidth ?? (compact ? 640 : 900);
  const D = Math.min(W, compact ? 340 : 560); // діаметр планети

  const features = useMemo(() => countryFeatures(), []);

  const graticule = useMemo(() => geoGraticule10(), []);
  const sphere = useMemo(() => ({ type: "Sphere" }) as GeoPermissibleObjects, []);

  const projection = useMemo(() => geoOrthographic().clipAngle(90), []);

  /* Стан обертання + drag-взаємодія: rAF оновлює кожен кадр (60 fps),
     з плавним розгоном після drag. ?norotate=1 — тестовий режим без авто-обертання. */
  const [norotate] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("norotate")
  );
  const rotRef = useRef<Rot>({ lambda: -15, phi: -18 });
  const [rot, setRot] = useState<Rot>(rotRef.current);
  const dragRef = useRef<{ x: number; y: number; rot: Rot } | null>(null);
  const lastInteractRef = useRef(0);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    // Момент відновлення автоповороту (для плавного розгону після drag/паузи).
    let resumedAt = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (dragRef.current || reducedMotion.current || norotate) {
        last = now;
        resumedAt = 0;
        return;
      }
      if (now - lastInteractRef.current < 3500) {
        last = now;
        resumedAt = 0;
        return;
      }
      const dt = now - last;
      last = now;
      if (!resumedAt) resumedAt = now;
      // Плавний старт: повна швидкість за ~700 мс після відновлення,
      // щоб куля не «ривалась» з місця після відпускання або паузи.
      const ramp = Math.min(1, (now - resumedAt) / 700);
      const eased = ramp * ramp * (3 - 2 * ramp); // smoothstep
      rotRef.current = {
        ...rotRef.current,
        lambda: rotRef.current.lambda + dt * 0.0014 * eased,
      };
      setRot(rotRef.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, rot: rotRef.current };
    lastInteractRef.current = performance.now();
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    lastInteractRef.current = performance.now();
    const next = {
      lambda: d.rot.lambda + (e.clientX - d.x) * 0.28,
      phi: Math.max(-55, Math.min(25, d.rot.phi - (e.clientY - d.y) * 0.18)),
    };
    rotRef.current = next;
    setRot(next);
  };
  const endDrag = () => {
    dragRef.current = null;
    lastInteractRef.current = performance.now();
  };

  /* Проєкція під поточний кадр */
  projection.fitExtent([[4, 4], [D - 4, D - 4]], sphere);
  projection.rotate([rot.lambda, rot.phi, 0]);
  const pathGen = geoPath(projection);
  const [cx, cy] = projection.translate();

  const center: [number, number] = [-rot.lambda, -rot.phi];
  const isVisible = (ll: [number, number]) => geoDistance(ll, center) < Math.PI / 2 - 0.02;

  const projectElevated = (ll: [number, number], k: number): [number, number] | null => {
    const p = projection(ll);
    if (!p) return null;
    return [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k];
  };

  /* Значення для хороплета: активний бік — основний, другий — легкий тінт */
  const primary = side === "targets" ? targets : origins;
  const secondary = side === "targets" ? origins : targets;
  const primaryMap = new Map(primary.map((d) => [d.iso2, d.value]));
  const secondaryMap = new Map(secondary.map((d) => [d.iso2, d.value]));
  const secondaryMax = Math.max(1, ...secondary.map((d) => d.value));
  const secondaryColor = side === "targets" ? ORIGIN : CRITICAL;

  /* Дуги: i-те джерело → i-та ціль (синтез пар за рангом) */
  const arcs = useMemo(() => {
    const n = Math.min(6, targets.length, origins.length);
    const out: { id: string; a: [number, number]; b: [number, number]; weight: number }[] = [];
    for (let i = 0; i < n; i++) {
      const ca = CENTROIDS[origins[i].iso2];
      const cb = CENTROIDS[targets[i].iso2];
      if (!ca || !cb) continue;
      out.push({
        id: `ddosArc${i}`,
        a: [ca[1], ca[0]],
        b: [cb[1], cb[0]],
        weight: origins[i].value / Math.max(1, origins[0].value),
      });
    }
    return out;
  }, [targets, origins]);

  const buildArcPath = (a: [number, number], b: [number, number]): string => {
    const interp = geoInterpolate(a, b);
    const dist = geoDistance(a, b);
    const alt = 0.08 + Math.sin(Math.min(dist / Math.PI, 1)) * 0.42;
    const N = 40;
    let dAttr = "";
    let pen = false;
    for (let i = 0; i <= N; i++) {
      const tt = i / N;
      const ll = interp(tt) as [number, number];
      const k = 1 + alt * Math.sin(Math.PI * tt);
      if (!isVisible(ll)) {
        pen = false;
        continue;
      }
      const p = projectElevated(ll, k);
      if (!p) {
        pen = false;
        continue;
      }
      dAttr += `${pen ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
      pen = true;
    }
    return dAttr;
  };

  /* Зорі на фоні (детерміновані, щоб SSR/CSR збігалися) */
  const stars = useMemo(() => {
    const rnd = mulberry32(20260821);
    return Array.from({ length: 60 }, () => ({
      x: rnd() * D,
      y: rnd() * D,
      r: 0.4 + rnd() * 0.9,
      o: 0.15 + rnd() * 0.4,
    }));
  }, [D]);

  const markerList = useMemo(() => {
    const list: { iso2: string; ll: [number, number]; value: number; kind: "target" | "origin"; rank: number }[] = [];
    const push = (arr: CountryDatum[], kind: "target" | "origin") =>
      arr.slice(0, 8).forEach((d, rank) => {
        const c = CENTROIDS[d.iso2];
        if (c) list.push({ iso2: d.iso2, ll: [c[1], c[0]], value: d.value, kind, rank });
      });
    push(targets, "target");
    push(origins, "origin");
    return list;
  }, [targets, origins]);

  const oceanInner = isDark ? "#182338" : "#EDF2F7";
  const oceanOuter = isDark ? "#0C1424" : "#DDE5EE";
  const borderColor = isDark ? "rgba(148,163,184,0.35)" : "rgba(255,255,255,0.85)";
  const gridStroke = isDark ? "rgba(148,163,184,0.14)" : "rgba(100,116,139,0.18)";

  return (
    <div className="flex justify-center">
      <svg
        viewBox={`0 0 ${D} ${D}`}
        width="100%"
        style={{ maxWidth: D, margin: "0 auto", display: "block", touchAction: "pan-y" }}
        role="img"
        aria-label="DDoS attack planet"
        className={dragRef.current ? "cursor-grabbing" : "cursor-grab"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <defs>
          <radialGradient id="ddosOcean" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor={oceanInner} />
            <stop offset="100%" stopColor={oceanOuter} />
          </radialGradient>
          <radialGradient id="ddosAtmo" cx="50%" cy="50%" r="50%">
            <stop offset="82%" stopColor="rgba(255,255,255,0)" />
            <stop offset="97%" stopColor={isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)"} />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <linearGradient id="ddosArcStroke" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={ORIGIN} />
            <stop offset="100%" stopColor={CRITICAL} />
          </linearGradient>
          <filter id="ddosGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Зорі */}
        {stars.map((s, i) => (
          <circle key={`st${i}`} cx={s.x} cy={s.y} r={s.r} fill={isDark ? "#94A3B8" : "#64748B"} opacity={s.o} />
        ))}

        {/* Атмосфера + океан */}
        <circle cx={cx} cy={cy} r={D / 2} fill="url(#ddosAtmo)" />
        <circle cx={cx} cy={cy} r={D / 2 - 2} fill="url(#ddosOcean)" stroke={borderColor} strokeWidth={1} />

        {/* Сітка меридіанів/паралелей */}
        <path d={pathGen(graticule as GeoPermissibleObjects) ?? ""} fill="none" stroke={gridStroke} strokeWidth={0.5} />

        {/* Країни */}
        {features.map(({ f, iso2 }: { f: any; iso2: string }, i) => {
          const pv = primaryMap.get(iso2);
          const sv = secondaryMap.get(iso2);
          const isActive = !!iso2 && iso2 === active;
          let fill = baseFill;
          if (pv !== undefined) fill = scaleFill(pv);
          else if (sv !== undefined)
            fill = side === "targets"
              ? `rgba(255,255,255,${(0.18 + 0.4 * (sv / secondaryMax)).toFixed(2)})`
              : `rgba(255,255,255,${(0.15 + 0.35 * (sv / secondaryMax)).toFixed(2)})`;
          return (
            <path
              key={`${f.id ?? "noid"}-${i}`}
              data-iso={iso2 || undefined}
              d={pathGen(f as GeoPermissibleObjects) ?? ""}
              fill={isActive ? (side === "targets" ? CRITICAL : ORIGIN) : fill}
              stroke={isActive ? (isDark ? "#F2F6FA" : "#FFFFFF") : borderColor}
              strokeWidth={isActive ? 1.4 : 0.4}
              cursor={iso2 && (pv !== undefined || sv !== undefined) ? "pointer" : "default"}
              filter={isActive ? "url(#ddosGlow)" : undefined}
              onClick={
                iso2 && (pv !== undefined || sv !== undefined)
                  ? () => onSelect(iso2)
                  : undefined
              }
            >
              {(pv !== undefined || sv !== undefined) && (
                <title>
                  {countryNames[iso2] ?? iso2}: {(pv ?? sv ?? 0).toFixed(1)}%
                </title>
              )}
            </path>
          );
        })}

        {/* Дуги атак «джерело → ціль» */}
        {arcs.map((arc, i) => {
          const dAttr = buildArcPath(arc.a, arc.b);
          if (!dAttr) return null;
          const dur = `${(3.2 - arc.weight * 1.2).toFixed(2)}s`;
          return (
            <g key={arc.id}>
              <path id={arc.id} d={dAttr} fill="none" stroke="url(#ddosArcStroke)" strokeWidth={0.8 + arc.weight * 1.4} opacity={0.55} />
              <path d={dAttr} fill="none" stroke="#E5E5E5" strokeWidth={0.7 + arc.weight} className="ddos-arc-dash" opacity={0.9} />
              <circle r={1.6 + arc.weight * 1.6} fill="#FFFFFF" filter="url(#ddosGlow)">
                <animateMotion dur={dur} repeatCount="indefinite" begin={`${i * 0.55}s`}>
                  <mpath href={`#${arc.id}`} />
                </animateMotion>
              </circle>
            </g>
          );
        })}

        {/* Маркери країн + пульсації на топ-3 активному боці */}
        {markerList.map((m) => {
          if (!isVisible(m.ll)) return null;
          const p = projection(m.ll);
          if (!p) return null;
          const color = m.kind === "target" ? CRITICAL : ORIGIN;
          const r = 2 + Math.sqrt(m.value) * 1.1;
          const pulse = m.rank < 3;
          return (
            <g key={`${m.kind}${m.iso2}`}>
              {pulse && (
                <circle cx={p[0]} cy={p[1]} r={r} fill="none" stroke={color} strokeWidth={1.2}>
                  <animate attributeName="r" values={`${r};${r * 3}`} dur="2.2s" repeatCount="indefinite" begin={`${m.rank * 0.4}s`} />
                  <animate attributeName="opacity" values="0.7;0" dur="2.2s" repeatCount="indefinite" begin={`${m.rank * 0.4}s`} />
                </circle>
              )}
              <circle cx={p[0]} cy={p[1]} r={r} fill={color} stroke={isDark ? "#0C1424" : "#FFFFFF"} strokeWidth={0.8}>
                <title>{`${countryNames[m.iso2] ?? m.iso2}: ${m.value.toFixed(1)}%`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export type { Side as DdosSide };
