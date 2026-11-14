"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "./LanguageContext";
import { countryName } from "@/lib/countries";
import { interpolateHex } from "@/lib/color";

function gradient(color: string): string {
  return `linear-gradient(90deg, ${color}F2 0%, ${color}A6 100%)`;
}

export function TopCountriesChart({
  data,
}: {
  data: { country: string; count: number }[];
}) {
  const { t } = useTranslation();
  const countryNames = t.map.countries as Record<string, string>;
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

  const chartData = data.slice(0, 15).map((d) => ({
    ...d,
    label: countryName(d.country, countryNames),
  }));
  const maxValue = Math.max(1, ...chartData.map((d) => d.count));

  return (
    <div className="w-full">
      <div className="space-y-1.5">
        {chartData.map((d, i) => {
          const pct = (d.count / maxValue) * 100;
          const color = interpolateHex([254, 202, 202], [185, 28, 28], 0.3 + 0.7 * (d.count / maxValue));
          return (
            <div
              key={d.country}
              className="group relative flex items-center gap-2"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: color, opacity: 0.9 }}
              />
              <span className="w-24 flex-shrink-0 truncate text-left text-xs font-medium text-text-secondary">
                {d.label}
              </span>
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-panel-raised">
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
                  <span className="font-bold text-text-primary">{d.label}</span>
                  <span className="ml-1.5 font-mono text-text-secondary">
                    {d.count} · {Math.round(pct)}%
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
