"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "./LanguageContext";
import { SPONSOR_NAMES } from "@/lib/i18n";

// Ч/б: спонсоры различаются плотностью серого
const SPONSOR_COLORS: Record<string, string> = {
  Russia: "#F5F5F5",
  China: "#C9C9C9",
  "North Korea": "#9CA3AF",
  Iran: "#737373",
  Belarus: "#525252",
};

function gradient(color: string): string {
  return `linear-gradient(90deg, ${color}F2 0%, ${color}A6 100%)`;
}

export function SponsorChart({
  data,
  selected,
  onSelect,
}: {
  data: { sponsor: string; count: number }[];
  selected?: string | null;
  onSelect?: (sponsor: string) => void;
}) {
  const { t, lang } = useTranslation();
  const [animated, setAnimated] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 300);
    return () => clearTimeout(timer);
  }, []);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-text-muted">{t.sections.noThreats}</p>
      </div>
    );
  }

  const maxValue = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((acc, d) => acc + d.count, 0);

  const sponsorName = (sponsor: string): string =>
    SPONSOR_NAMES[lang]?.[sponsor] ?? sponsor;

  return (
    <div className="w-full">
      <div className="space-y-1.5">
        {data.map((d, i) => {
          const pct = (d.count / maxValue) * 100;
          const share = total ? Math.round((d.count / total) * 100) : 0;
          const color = SPONSOR_COLORS[d.sponsor] ?? "#64748B";
          return (
            <div
              key={d.sponsor}
              className={`group relative flex items-center gap-2 ${onSelect ? "cursor-pointer" : ""}`}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelect?.(d.sponsor)}
              role={onSelect ? "button" : undefined}
              aria-pressed={onSelect ? selected === d.sponsor : undefined}
              title={onSelect ? sponsorName(d.sponsor) : undefined}
            >
              <span
                className={`w-28 flex-shrink-0 truncate text-right text-xs font-medium sm:w-32 ${
                  selected === d.sponsor ? "text-text-primary" : "text-text-secondary"
                }`}
              >
                {sponsorName(d.sponsor)}
              </span>
              <div
                className={`h-5 flex-1 overflow-hidden rounded-md bg-panel-raised ${
                  selected === d.sponsor ? "ring-1 ring-white/30" : ""
                }`}
              >
                <div
                  className="h-full rounded-md transition-[width] duration-1000 ease-out"
                  style={{
                    width: animated ? `${pct}%` : "0%",
                    background: gradient(color),
                  }}
                />
              </div>
              <span className="w-10 flex-shrink-0 text-right font-mono text-xs font-bold text-text-secondary">
                {d.count}
              </span>

              {hovered === i && (
                <div className="pointer-events-none absolute -top-9 right-6 z-10 whitespace-nowrap rounded-lg border border-border bg-panel px-2.5 py-1.5 text-xs shadow-lg">
                  <span className="font-bold text-text-primary">{sponsorName(d.sponsor)}</span>
                  <span className="ml-1.5 font-mono text-text-secondary">
                    {d.count} · {share}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
