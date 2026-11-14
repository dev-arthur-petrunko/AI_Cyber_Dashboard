"use client";

// Агент-«гастролер» (ТЗ 5.5), виправлений запитом власника:
//  • з'являється СПЕРЕДУ (шар z-[25]: над картками z-0/10, ПІД шапкою z-30);
//  • НЕ біля 8 метрик — цілі тільки «аналітичні» картки (data-agent-roam):
//    мапа загроз, топ країн-цілей, трекер акторів, атаки за спонсором,
//    топ вендорів — ніби аналізує їх;
//  • раз у 20–40 с зникає (схлопується) і з'являється в ІНШІЙ картці;
//  • іноді «виглядає» з-за краю (видно частину голови);
//  • максимум 2 агенти: логотип + цей (на час ноутбук-сцени ховається);
//  • prefers-reduced-motion: без схлопувань, статично в одній картці.
//
// Координати — ВІДНОСНО шару (absolute inset-0 у обертці сторінки), тому
// агент правильно «сідає» на картку навіть коли вміст центрований (max-w).

import { useEffect, useRef, useState } from "react";
import { Agent } from "./Agent";
import type { Mood } from "./agentMachine";

type Spot = { left: number; top: number; peek: boolean };

export function AgentRoamer({ hidden = false }: { hidden?: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [visible, setVisible] = useState(false);
  const [mood, setMood] = useState<Mood>("thinking");

  useEffect(() => {
    if (hidden) { setVisible(false); return; }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const pick = (): Spot | null => {
      const layer = layerRef.current;
      if (!layer) return null;
      const layerRect = layer.getBoundingClientRect();
      // Тільки аналітичні картки (мапа/топ-країни/трекер/спонсори/вендори)
      const els = Array.from(document.querySelectorAll<HTMLElement>("[data-agent-roam]"));
      const free = els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.top < window.innerHeight - 40 && r.bottom > 80;
      });
      if (!free.length) return null;
      const el = free[Math.floor(Math.random() * free.length)];
      const r = el.getBoundingClientRect();
      const peek = Math.random() < 0.3;
      // Аналізує: більшість часу «thinking», іноді спокійний/сонний
      const moods: Mood[] = ["thinking", "thinking", "thinking", "neutral", "sleepy"];
      setMood(moods[Math.floor(Math.random() * moods.length)]);
      return {
        // відносно шару (absolute inset-0 обертки сторінки)
        left: r.right - layerRect.left - 46,
        top: r.top - layerRect.top - 26,
        peek,
      };
    };

    let timer: ReturnType<typeof setTimeout>;
    const relocate = () => {
      const next = pick();
      if (next) { setSpot(next); setVisible(true); }
      timer = setTimeout(() => {
        setVisible(false);
        setTimeout(relocate, 300); // 250 мс на схлопування
      }, 20000 + Math.random() * 20000);
    };

    if (!reduce) relocate();
    else { const s = pick(); if (s) setSpot(s); }

    return () => clearTimeout(timer);
  }, [hidden]);

  return (
    // Шар ПЕРЕД контентом (z-25), але ПІД верхньою панеллю (z-30)
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-[25]" aria-hidden="true">
      {spot && visible && !hidden && (
        <div
          className="agent-roamer absolute"
          style={{
            left: spot.left,
            top: spot.top,
            clipPath: spot.peek ? "inset(38% 0 0 0)" : undefined, // виглядає з-за краю
          }}
        >
          <Agent mood={mood} size={44} />
        </div>
      )}
      <style>{`
        .agent-roamer { animation: roamer-pop 0.45s cubic-bezier(0.34,1.56,0.64,1) both; }
        @keyframes roamer-pop {
          from { transform: scale(0.1); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) { .agent-roamer { animation: none; } }
      `}</style>
    </div>
  );
}
