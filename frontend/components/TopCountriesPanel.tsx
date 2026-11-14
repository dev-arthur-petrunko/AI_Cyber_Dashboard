"use client";

// Єдина панель "Топ країн" для обох режимів: IoC (threats) та DDoS (Cloudflare).
// - IoC: показує absolute counts з /stats?by_country
// - DDoS: показує % з /ddos-stats (Cloudflare Radar)
// Підтримує синхронний highlight з картою через selectedCountry/onSelectCountry.

import { useEffect, useState } from "react";
import { useTranslation } from "./LanguageContext";
import { countryName, COUNTRY_TO_ISO } from "@/lib/countries";
import { interpolateHex } from "@/lib/color";
import type { DdosLayer } from "@/lib/types";

type Mode = "threats" | "ddos";

type IoCItem = { country: string; count: number };
type DDoSItem = { country: string; value: number; code?: string };

function gradient(color: string): string {
  return `linear-gradient(90deg, ${color}F2 0%, ${color}A6 100%)`;
}

function sourceLabel(mode: Mode, ddosLayer?: DdosLayer, ddosSide?: string): string {
  if (mode === "threats") return "IoC · ThreatFox/URLhaus/MalwareBazaar";
  const layer = ddosLayer === "layer3" ? "L3" : "L7";
  const side = ddosSide === "origins" ? "джерела" : "цілі";
  return `Cloudflare Radar · ${layer} · ${side}`;
}

export function TopCountriesPanel({
  mode,
  iocData,
  ddosData,
  ddosLayer,
  ddosSide,
  selectedCountry,
  onSelectCountry,
}: {
  mode: Mode;
  iocData: IoCItem[];
  ddosData: DDoSItem[];
  ddosLayer?: DdosLayer;
  ddosSide?: string;
  selectedCountry: string | null;
  onSelectCountry: (code: string | null) => void;
}) {
  const { t } = useTranslation();
  const countryNames = t.map.countries as Record<string, string>;
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    setAnimated(false);
    const timer = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(timer);
  }, [mode, ddosLayer, ddosSide]);

  const isDdos = mode === "ddos";

  // Нормалізуємо дані в єдиний формат
  const items: { code: string; label: string; value: number; pct: number }[] = isDdos
    ? (() => {
        const maxVal = Math.max(1, ...ddosData.map((d) => d.value));
        return ddosData.slice(0, 12).map((d) => {
          const code = (d.code || "").toUpperCase();
          return {
            code,
            label: countryName(code, countryNames) || d.country,
            value: d.value,
            pct: d.value, // вже в %
          };
        });
      })()
    : (() => {
        // Об'єднуємо за ISO-кодом: різні написання однієї країни
        // (напр. "USA" vs "United States") не повинні дублюватись у списку.
        const merged = new Map<string, { country: string; count: number; code: string }>();
        for (const d of iocData) {
          const code = COUNTRY_TO_ISO[d.country] || "";
          const key = code || d.country;
          const prev = merged.get(key);
          if (prev) {
            prev.count += d.count;
          } else {
            merged.set(key, { country: d.country, count: d.count, code });
          }
        }
        const maxVal = Math.max(1, ...Array.from(merged.values()).map((d) => d.count));
        return Array.from(merged.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 12)
          .map((d) => {
            return {
              code: d.code,
              label: countryName(d.country, countryNames, d.code),
              value: d.count,
              pct: (d.count / maxVal) * 100,
            };
          });
      })();

  const maxValue = Math.max(1, ...items.map((d) => d.value));

  const barColor = (pct: number) =>
    isDdos
      ? `rgba(255, 255, 255, ${(0.3 + 0.7 * (pct / 100)).toFixed(2)})`
      : interpolateHex([115, 115, 115], [245, 245, 245], 0.3 + 0.7 * (pct / 100));

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-text-muted">{t.sections.noThreats}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Підпис джерела */}
      <p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-text-muted">
        {sourceLabel(mode, ddosLayer, ddosSide)}
      </p>

      <div className="space-y-1.5">
        {items.map((d) => {
          const isActive = selectedCountry === d.code;
          const color = barColor(d.pct);
          return (
            <div
              key={d.code || d.label}
              className={`group relative flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors ${
                isActive ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-panel-raised"
              }`}
              onMouseEnter={() => d.code && onSelectCountry(d.code)}
              onMouseLeave={() => onSelectCountry(null)}
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
                    width: animated ? `${d.pct}%` : "0%",
                    background: isDdos ? `rgba(255, 255, 255, ${0.3 + 0.7 * (d.pct / 100)})` : gradient(color),
                  }}
                />
              </div>
              <span className="w-14 flex-shrink-0 text-right font-mono text-xs font-bold text-text-secondary">
                {isDdos ? `${d.value.toFixed(1)}%` : d.value}
              </span>
            </div>
          );
        })}
      </div>

      {/* Індикатор stale для IoC */}
      {!isDdos && (
        <p className="mt-3 text-center text-[9px] text-text-muted italic">
          Не залежить від вкладки карти · IoC-дані з ThreatFox/URLhaus
        </p>
      )}
    </div>
  );
}
