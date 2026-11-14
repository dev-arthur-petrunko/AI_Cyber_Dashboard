"use client";

// Шар кабелів «агент-ноутбук → картка дашборда» (ТЗ 4.1.3).
// - fixed на весь екран, pointer-events: НЕМАЄ (кліки проходять скрізь),
//   z-index 20 (над контентом, НИЖЧЕ topbar z-30);
// - приймає якір (екран ноутбука від <Agent laptop onLaptopAnchor=…>)
//   і малює криву Безье до data-agent-target картки;
// - лінія «малюється» stroke-dasharray 450 мс, бігають 3 пакети даних,
//   в кінці — точка-«роз'єм»; картка підсвічується (outline) і показує
//   «ANALYZING…» (i18n, 5 мов).
// - координати перераховуються максимум раз на кадр (rAF), при
//   scroll/resize; поза екраном — ціль пропускається.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../LanguageContext";

type Target = { el: Element; rect: DOMRect };

export function AgentLinkLayer({
  anchor,
  targetSelector,
  onDone,
}: {
  /** Екран ноутбука (viewport) або null — сцену завершено. */
  anchor: { x: number; y: number } | null;
  /** Селектор карток-цілей, напр. "[data-agent-target]". */
  targetSelector: string;
  /** Викликається, коли лінія стерлася (кінець однієї цілі). */
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const packetsRef = useRef<SVGCircleElement[]>([]);
  const labelRef = useRef<HTMLDivElement>(null);
  const [targetEl, setTargetEl] = useState<Element | null>(null);
  const [drawn, setDrawn] = useState(false);

  const analyzing = (t.sections as Record<string, string> | undefined)?.analizing ?? "ANALYZING…";

  // ── Вибір найближчої ВИМІРЮВАНОЇ цілі (раз на початок з'єднання) ─
  useEffect(() => {
    if (!anchor) { setTargetEl(null); setDrawn(false); return; }
    const els = Array.from(document.querySelectorAll(targetSelector));
    let best: Element | null = null;
    let bestD = Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 30) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue; // поза екраном
      const cx = r.left + Math.min(r.width, 320) / 2;
      const d = (cx - anchor.x) ** 2 + (r.top - anchor.y) ** 2;
      if (d < bestD) { bestD = d; best = el; }
    }
    setTargetEl(best);
    setDrawn(false);
    return () => { setTargetEl(null); setDrawn(false); };
  }, [anchor, targetSelector]);

  // ── Малювання кривої + анімація (один rAF на кадр) ────────────
  useEffect(() => {
    if (!anchor || !targetEl || !pathRef.current) return;
    const path = pathRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let start = 0;
    const length = 0;

    const paint = (now: number) => {
      if (!start) start = now;
      const r = targetEl.getBoundingClientRect();
      // найближча точка на лівому/верхньому краю картки
      const tx = r.left + Math.min(r.width, 320) / 2;
      const ty = r.top + 6;
      const mx = (anchor.x + tx) / 2;
      const my = Math.min(anchor.y, ty) - 40; // дуга вгору
      path.setAttribute("d", `M ${anchor.x} ${anchor.y} Q ${mx} ${my} ${tx} ${ty}`);

      const L = path.getTotalLength();
      if (!reduce) {
        const draw = Math.min(1, (now - start) / 450);
        path.style.strokeDasharray = String(L);
        path.style.strokeDashoffset = String(L * (1 - draw));
        // пакети даних уздовж шляху
        const p1 = ((now - start) % 900) / 900;
        packetsRef.current.forEach((c, i) => {
          if (!c) return;
          const pp = (p1 + i * 0.33) % 1;
          const pt = path.getPointAtLength(L * pp);
          c.setAttribute("cx", String(pt.x));
          c.setAttribute("cy", String(pt.y));
          c.setAttribute("opacity", draw > 0.95 ? "0.9" : "0");
        });
        if (draw < 1) raf = requestAnimationFrame(paint);
        else if (!drawn) setDrawn(true);
      } else {
        path.style.strokeDasharray = "none";
        path.style.strokeDashoffset = "0";
        setDrawn(true);
      }

      // мітка «ANALYZING…» біля цілі
      if (labelRef.current) {
        labelRef.current.style.left = `${Math.min(tx + 8, innerWidth - 110)}px`;
        labelRef.current.style.top = `${Math.max(ty - 22, 4)}px`;
      }
    };
    raf = requestAnimationFrame(paint);

    const onScrollOrResize = () => { start = 0; };
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      onDone?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, targetEl]);

  if (!anchor || !targetEl) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-20" aria-hidden="true">
      <svg className="h-full w-full">
        <path
          ref={pathRef}
          fill="none"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <circle ref={dotRef} r={3} fill="#FFFFFF" opacity={0} />
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            ref={(el) => { if (el) packetsRef.current[i] = el; }}
            r={2}
            fill="#FFFFFF"
            opacity={0}
          />
        ))}
      </svg>

      {/* Підсвітка картки-цілі */}
      <div
        className="agent-analyzing-ring"
        style={{
          position: "fixed",
          left: targetEl.getBoundingClientRect().left - 2,
          top: targetEl.getBoundingClientRect().top - 2,
          width: Math.min(targetEl.getBoundingClientRect().width, 324),
          height: targetEl.getBoundingClientRect().height,
          outline: "1px solid rgba(255,255,255,0.85)",
          outlineOffset: "2px",
          borderRadius: 14,
          pointerEvents: "none",
        }}
      />
      <div
        ref={labelRef}
        className="fixed font-mono text-[9px] uppercase tracking-[0.18em]"
        style={{
          color: "#FFFFFF",
          background: "rgba(10,10,10,0.85)",
          border: "1px solid rgba(255,255,255,0.35)",
          borderRadius: 6,
          padding: "2px 6px",
          pointerEvents: "none",
          transition: "left 90ms linear, top 90ms linear",
        }}
      >
        {analyzing}
      </div>

      <style>{`
        @keyframes agent-ring-pulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 1; }
        }
        .agent-analyzing-ring { animation: agent-ring-pulse 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .agent-analyzing-ring { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
