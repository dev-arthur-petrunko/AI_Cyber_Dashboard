"use client";

// Мапа загроз: 3D-планета (ортографічна проєкція d3-geo) з даними ЗАГРОЗ
// + DDoS-індикатори. Хороплет за кількістю загроз на країну, пульсуючі
// маркери топ-країн, авто-обертання та drag-взаємодія — як на DDoS-мапі.
// Підтримує синхронний highlight з TopCountriesPanel через selectedCountry.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  geoDistance,
  geoGraticule10,
  geoOrthographic,
  geoPath,
} from "d3-geo";
import type { GeoPermissibleObjects } from "d3-geo";
import { useTranslation } from "./LanguageContext";
import { COUNTRY_TO_ISO } from "@/lib/countries";
import { interpolateHex } from "@/lib/color";
import { CENTROIDS, countryFeatures, mulberry32 } from "@/lib/worldGeo";

type DdosItem = { country: string; code: string; value: number; layer: string };
type MapDatum = { country: string; value: number };
type Rot = { lambda: number; phi: number };

export function ThreatMap({
  byCountry,
  ddosOrigins = [],
  ddosTargets = [],
  selectedCountry,
  onCountrySelect,
}: {
  byCountry: { country: string; count: number }[];
  ddosOrigins?: DdosItem[];
  ddosTargets?: DdosItem[];
  selectedCountry: string | null;
  onCountrySelect: (code: string | null) => void;
}) {
  const [isDark, setIsDark] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const data = useMemo<MapDatum[]>(() => {
    const counts = new Map<string, number>();
    byCountry.forEach(({ country, count }) => {
      const iso = COUNTRY_TO_ISO[country];
      if (iso) counts.set(iso, (counts.get(iso) ?? 0) + count);
    });
    return Array.from(counts.entries())
      .map(([country, value]) => ({ country, value }))
      .sort((a, b) => b.value - a.value);
  }, [byCountry]);

  const topCountries = data.slice(0, 12);
  const maxValue = Math.max(1, ...data.map((d) => d.value));

  const baseFill = isDark ? "#1C1C1C" : "#CBD5E1";
  const scaleFill = (value: number) => {
    const ratio = 0.25 + 0.75 * (value / maxValue);
    return interpolateHex([90, 90, 90], [245, 245, 245], ratio);
  };

  const countryNames = t.map.countries as Record<string, string>;

  const valueMap = useMemo(
    () => new Map(data.map((d) => [d.country, d.value])),
    [data]
  );

  return (
    <div>
      <ThreatGlobe
        valueMap={valueMap}
        top={topCountries}
        selected={selectedCountry}
        isDark={isDark}
        baseFill={baseFill}
        scaleFill={scaleFill}
        countryNames={countryNames}
        onSelect={onCountrySelect}
      />

      {/* Легенда: топ країни за кількістю загроз + DDoS-індикатори */}
      <div className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {topCountries.map((d) => {
          const isActive = selectedCountry === d.country;
          const ddosOrig = ddosOrigins.find((o) => (o.code || "").toUpperCase() === d.country);
          const ddosTgt = ddosTargets.find((o) => (o.code || "").toUpperCase() === d.country);
          return (
            <button
              key={d.country}
              type="button"
              onClick={() => onCountrySelect(isActive ? null : d.country)}
              onMouseEnter={() => onCountrySelect(d.country)}
              onMouseLeave={() => onCountrySelect(null)}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-all ${
                isActive
                  ? "bg-primary/15 ring-1 ring-primary/40"
                  : "bg-panel-raised hover:bg-panel-raised"
              }`}
            >
              <span className="h-3 w-3 flex-shrink-0 rounded-sm" style={{ background: scaleFill(d.value) }} />
              <span className="truncate text-xs font-medium text-text-primary">
                {countryNames[d.country] ?? d.country}
              </span>
              {ddosOrig && (
                <span className="flex-shrink-0 rounded bg-critical/15 px-1 py-0.5 font-mono text-[8px] font-bold text-critical" title={`${t.map.ddos.origins}: ${ddosOrig.value.toFixed(1)}%`}>
                  {t.map.ddos.origins}
                </span>
              )}
              {ddosTgt && (
                <span className="flex-shrink-0 rounded bg-warning/15 px-1 py-0.5 font-mono text-[8px] font-bold text-warning" title={`${t.map.ddos.targets}: ${ddosTgt.value.toFixed(1)}%`}>
                  {t.map.ddos.targets}
                </span>
              )}
              <span className="ml-auto font-mono text-xs font-bold text-text-secondary">{d.value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Планета загроз ───────────────────────────────────────────── */

function ThreatGlobe({
  valueMap,
  top,
  selected,
  isDark,
  baseFill,
  scaleFill,
  countryNames,
  onSelect,
}: {
  valueMap: Map<string, number>;
  top: MapDatum[];
  selected: string | null;
  isDark: boolean;
  baseFill: string;
  scaleFill: (v: number) => string;
  countryNames: Record<string, string>;
  onSelect: (code: string | null) => void;
}) {
  const D = 340; // діаметр планети (як у компактного DDoS-глобуса)

  const features = useMemo(() => countryFeatures(), []);
  const graticule = useMemo(() => geoGraticule10(), []);
  const sphere = useMemo(() => ({ type: "Sphere" }) as GeoPermissibleObjects, []);
  const projection = useMemo(() => geoOrthographic().clipAngle(90), []);

  /* Стан обертання + drag-взаємодія (початковий центр — Європа/Україна).
     rAF оновлює кожен кадр (60 fps), з плавним розгоном після drag.
     ?norotate=1 — тестовий режим без авто-обертання (детерміновані скриншоти). */
  const [norotate] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("norotate")
  );
  const rotRef = useRef<Rot>({ lambda: -30, phi: -16 });
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
    let acc = 0; // накопичувач часу → оновлення стану раз на 100 мс
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (dragRef.current || reducedMotion.current || norotate) {
        last = now;
        resumedAt = 0;
        acc = 0;
        return;
      }
      if (now - lastInteractRef.current < 3500) {
        last = now;
        resumedAt = 0;
        acc = 0;
        return;
      }
      const dt = now - last;
      last = now;
      acc += dt;
      if (acc < 100) return; // мікрофікс лагів: setRot раз на 100 мс, не 60×/с
      acc = 0;
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

  const center: [number, number] = [-rot.lambda, -rot.phi];
  const isVisible = (ll: [number, number]) => geoDistance(ll, center) < Math.PI / 2 - 0.02;

  /* Маркери топ-8 країн */
  const markerList = useMemo(
    () =>
      top.slice(0, 8).flatMap((d) => {
        const c = CENTROIDS[d.country];
        return c ? [{ iso2: d.country, ll: [c[1], c[0]] as [number, number], value: d.value }] : [];
      }),
    [top]
  );

  /* Зорі на фоні (детерміновані, щоб SSR/CSR збігалися) */
  const stars = useMemo(() => {
    const rnd = mulberry32(20260823);
    return Array.from({ length: 60 }, () => ({
      x: rnd() * D,
      y: rnd() * D,
      r: 0.4 + rnd() * 0.9,
      o: 0.15 + rnd() * 0.4,
    }));
  }, [D]);

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
        aria-label="Threat planet"
        className={dragRef.current ? "cursor-grabbing" : "cursor-grab"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <defs>
          <radialGradient id="threatOcean" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor={oceanInner} />
            <stop offset="100%" stopColor={oceanOuter} />
          </radialGradient>
          <radialGradient id="threatAtmo" cx="50%" cy="50%" r="50%">
            <stop offset="82%" stopColor="rgba(255,255,255,0)" />
            <stop offset="97%" stopColor={isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)"} />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <filter id="threatGlow" x="-40%" y="-40%" width="180%" height="180%">
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
        <circle cx={D / 2} cy={D / 2} r={D / 2} fill="url(#threatAtmo)" />
        <circle cx={D / 2} cy={D / 2} r={D / 2 - 2} fill="url(#threatOcean)" stroke={borderColor} strokeWidth={1} />

        {/* Сітка меридіанів/паралелей */}
        <path d={pathGen(graticule as GeoPermissibleObjects) ?? ""} fill="none" stroke={gridStroke} strokeWidth={0.5} />

        {/* Країни: хороплет за кількістю загроз */}
        {features.map(({ f, iso2 }, i) => {
          const value = valueMap.get(iso2);
          const isActive = !!iso2 && iso2 === selected;
          let fill = baseFill;
          if (value !== undefined) fill = scaleFill(value);
          return (
            <path
              key={`${f.id ?? "noid"}-${i}`}
              data-iso={iso2 || undefined}
              d={pathGen(f as GeoPermissibleObjects) ?? ""}
              fill={isActive ? "#F5F5F5" : fill}
              stroke={isActive ? (isDark ? "#F2F6FA" : "#FFFFFF") : borderColor}
              strokeWidth={isActive ? 1.4 : 0.4}
              cursor={iso2 ? "pointer" : "default"}
              filter={isActive ? "url(#threatGlow)" : undefined}
              onClick={
                iso2
                  ? () => onSelect(iso2 === selected ? null : iso2)
                  : undefined
              }
            >
              <title>
                {countryNames[iso2] ?? iso2}
                {value !== undefined ? `: ${value}` : ""}
              </title>
            </path>
          );
        })}

        {/* Маркери топ-країн + пульсації перших трьох */}
        {markerList.map((m, rank) => {
          if (!isVisible(m.ll)) return null;
          const p = projection(m.ll);
          if (!p) return null;
          // Радіус маркера: повільніше зростання + жорстке обмеження зверху,
          // бо на "Шкідливій інфраструктурі" топ-країни (великі значення)
          // створювали непропорційно великі круги поверх карти.
          const r = Math.min(7, 1.6 + Math.sqrt(m.value) * 0.45);
          const color = scaleFill(m.value);
          const pulse = rank < 3;
          return (
            <g key={`mk${m.iso2}`}>
              {pulse && (
                <circle cx={p[0]} cy={p[1]} r={r} fill="none" stroke="#FFFFFF" strokeWidth={1.2}>
                  <animate attributeName="r" values={`${r};${r * 3}`} dur="2.2s" repeatCount="indefinite" begin={`${rank * 0.4}s`} />
                  <animate attributeName="opacity" values="0.7;0" dur="2.2s" repeatCount="indefinite" begin={`${rank * 0.4}s`} />
                </circle>
              )}
              <circle cx={p[0]} cy={p[1]} r={r} fill={color} stroke={isDark ? "#0C1424" : "#FFFFFF"} strokeWidth={0.8} className="pointer-events-none">
                <title>{`${countryNames[m.iso2] ?? m.iso2}: ${m.value}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
