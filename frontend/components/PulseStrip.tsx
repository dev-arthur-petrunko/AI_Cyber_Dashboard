"use client";

/**
 * Сигнатурний елемент дашборда: тонка ЕКГ-лінія вгорі сторінки,
 * що візуалізує обсяг нових загроз за годинами протягом останніх 24 годин.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "./LanguageContext";

export function PulseStrip({ hourlyVolume }: { hourlyVolume: number[] }) {
  const { t } = useTranslation();
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const width = 1200;
  const height = 40;
  const safe = hourlyVolume.length >= 2 ? hourlyVolume : [2, 3, 2];
  const max = Math.max(...safe, 1);

  const points = safe
    .map((v, i) => {
      const x = (i / (safe.length - 1)) * width;
      const y = height - (v / max) * (height - 6) - 3;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="relative w-full overflow-hidden border-b border-border bg-panel">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="relative h-12 w-full"
        role="img"
        aria-label={t.a11y.threatActivity24h}
      >
        <defs>
          <linearGradient id="pulse-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.25" />
            <stop offset="50%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="100%" stopColor="#B8B8B8" stopOpacity="0.8" />
          </linearGradient>
        </defs>

        {/* Main pulse line */}
        <polyline
          points={points}
          fill="none"
          stroke="url(#pulse-gradient)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Animated scanning dot */}
        {!reducedMotion && (
          <circle r="3" fill="#FFFFFF">
            <animateMotion dur="8s" repeatCount="indefinite" path={`M0,0 L${points}`} />
            <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
          </circle>
        )}

        {/* Pulsing endpoint */}
        {!reducedMotion && (
          <circle
            cx={width}
            cy={height - (safe[safe.length - 1] / max) * (height - 6) - 3}
            r="3"
            fill="#FFFFFF"
          >
            <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
            <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>

      <span className="pointer-events-none absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-text-muted">
        <span className="dot-glow h-1.5 w-1.5 animate-pulse rounded-full bg-signal text-signal" />
        Live · 24h
      </span>
    </div>
  );
}
