"use client";

// <Agent/> v2 — декларативний рух у стилі x.ai/bot.
//
// Чому попередня версія «мікроглючила»: кожен кадр (rAF) JS писав атрибути
// через setAttribute — будь-який кадр, що пропустився (GC, re-render, 120 Гц
// монітор проти 60), давав ривок. Тепер JS лише ставить ЦІЛІ/класи, а всю
// плавність робить браузер: CSS-переходи та анімації (композитер, GPU,
// незалежно від частоти кадрів). Жодного rAF усередині агента.
//
// Поведіння:
//  • випадкові сценки кожні 4–9 с: погляд униз/угору/вбік, щуріння,
//    підмигування, недовірливий погляд — CSS-перехід погляду 650 мс;
//  • повільне моргання (клас .blinking: закриття 150 мс, утримання,
//    відкриття 260 мс), інтервал 3.5–7.5 с; на hover НЕ «злипається»;
//  • hover → сміється (очі-дуги «^ ^») + стрибок (CSS keyframes,
//    squash&stretch, без конфлікту з SVG-transform — окремий wrapper);
//  • angry → тіло червоніє (#E5322D, плавна затоплюваність 300 мс) + дрожі;
//  • дихання/нахилення/гойдання — вкладені CSS-анімації;
//  • prefers-reduced-motion: статика (глобальний матч у globals.css).
//
// Ноутбук (prop laptop): CSS-розкриття з пружиною, рядки коду — CSS-анімація,
// якір екрана (viewport-координати) → AgentLinkLayer для кабеля.

import { useEffect, useId, useRef, useState } from "react";
import type { Mood } from "./agentMachine";

const RANK: Record<Mood, number> = {
  angry: 0, alert: 1, sad: 2, thinking: 3, happy: 4, surprised: 5, sleepy: 6, neutral: 7,
};

type Shape = { dx: number; dy: number; rx: number; ry: number; rot: number; scale: number; arc: boolean; arcH: number };

function shapeFor(mood: Mood, side: -1 | 1): Shape {
  const base: Shape = { dx: 0, dy: 0, rx: 2.1, ry: 4.2, rot: 0, scale: 1, arc: false, arcH: 0 };
  switch (mood) {
    case "happy":     // сміється: очі-дуги «^ ^», відкриті
      return { ...base, rx: 3.0, ry: 3.4, rot: -14 * side, arc: true, arcH: 5.2, scale: 1.05 };
    case "angry":
      return { ...base, ry: 4.4, rot: 30 * side, dy: -0.6 };
    case "alert":
      return { ...base, rx: 1.7, ry: 2.6, scale: 0.85 };
    case "surprised":
      return { ...base, rx: 2.5, ry: 5.4, dy: -1.4, scale: 1.12 };
    case "thinking":
      return { ...base, dx: -1.6, dy: -2.4, scale: side === -1 ? 0.88 : 1 };
    case "sad":
      return { ...base, ry: 4.0, rot: -26 * side, dy: 0.8 };
    case "sleepy":
      // половина-заплющені, але читаються як очі (не «- -» риски)
      return { ...base, rx: 3.0, ry: 2.0, dy: 0.6 };
    default:
      return base;
  }
}

const EYE_LX = -3.5;
const EYE_RX = 3.5;
const EYE_Y = -1;

/** Базовий погляд емоції (додається до сценки). */
const MOOD_LOOK: Partial<Record<Mood, [number, number]>> = {
  thinking: [-3.5, -4], sad: [0, 4], sleepy: [0, 1.5], surprised: [0, -1],
};
/** Стан щуріння. sleepy НЕ має давати рисок («- -»): сон уже дає очі-лінійки
 *  через shapeFor — тому sleepy прибрано з squint, щоб агент лишався «живим».
 *  Тонкі риски — ТІЛЬКИ миттєва сценка «щуриться» (~1.5 с раз на 4–9 с). */
const MOOD_SQUINT: Partial<Record<Mood, number>> = { sad: 0.3, angry: 0.2 };

/** Геометрія прямокутника ока. sq ≥ 0.5 (щуріння/сон) → ТОНКА ЛІНІЯ. */
function rectGeom(s: Shape, sq: number) {
  const line = sq >= 0.5;
  const w = (line ? 3.2 : 2 * s.rx) * (1 + 0.06 * (line ? 0 : sq));
  const h = line ? 1.1 : Math.max(1.4, 2 * s.ry * (1 - 0.6 * sq));
  return { x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(w, h) / 2 };
}

type Scene = { gx: number; gy: number; squint: number; wink: boolean };

/** 9 випадкових сценок (плюс «центр»). */
const SCENES: Scene[] = [
  { gx: 0, gy: 5.5, squint: 0, wink: false },      // униз
  { gx: 0, gy: -5.5, squint: 0, wink: false },     // угору
  { gx: 6, gy: 1, squint: 0, wink: false },        // убік праворуч
  { gx: -6, gy: 1, squint: 0, wink: false },       // убік ліворуч
  { gx: -4.5, gy: -3, squint: 0.3, wink: false },   // недовірливий
  { gx: 4, gy: 3, squint: 0, wink: false },        // униз-убік
  { gx: 0, gy: 0, squint: 0.65, wink: false },      // щуриться
  { gx: 0, gy: 0, squint: 0, wink: true },         // підмигує
  { gx: 0, gy: 0, squint: 0, wink: false },        // центр
];

const clamp = (v: number, max = 6) => Math.max(-max, Math.min(max, v));

export type AgentProps = {
  mood?: Mood;
  size?: number;
  className?: string;
  onClick?: () => void;
  /** Сцена «ноутбук» (аналіз). */
  laptop?: boolean;
  /** Якір екрана ноутбука (viewport) для кабеля; null — сцену завершено. */
  onLaptopAnchor?: (rect: { x: number; y: number } | null) => void;
};

export function Agent({
  mood: moodProp = "neutral",
  size = 40,
  className = "",
  onClick,
  laptop = false,
  onLaptopAnchor,
}: AgentProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const screenRef = useRef<SVGGElement>(null);
  const anchorCb = useRef(onLaptopAnchor);
  const reducedRef = useRef(false);

  const [scene, setScene] = useState<Scene>({ gx: 0, gy: 0, squint: 0, wink: false });
  const [ovr, setOvr] = useState<{ mood: Mood; until: number } | null>(null);
  const [hover, setHover] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [isLight, setIsLight] = useState(false);

  useEffect(() => { anchorCb.current = onLaptopAnchor; });

  useEffect(() => {
    reducedRef.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Тема (очі/сфера реагують на перемикач)
  useEffect(() => {
    const el = document.documentElement;
    const upd = () => setIsLight(!el.classList.contains("dark"));
    upd();
    const mo = new MutationObserver(upd);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  // Expirація тимчасового override (click → happy на 1.2 с)
  useEffect(() => {
    if (ovr && ovr.until !== Infinity) {
      const t = setTimeout(() => setOvr(null), Math.max(0, ovr.until - performance.now()));
      return () => clearTimeout(t);
    }
  }, [ovr]);

  // Фінальний mood (пріоритет з agentMachine)
  const mood: Mood = (() => {
    if (ovr && performance.now() < ovr.until && RANK[ovr.mood] <= RANK[moodProp]) {
      return ovr.mood;
    }
    return moodProp;
  })();

  // ── Випадкові сценки (JS ставить ціль — CSS везе плавно) ─────
  useEffect(() => {
    if (reducedRef.current) return;
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const next = () => {
      t = setTimeout(() => {
        if (!alive) return;
        const svg = svgRef.current;
        const offscreen = svg && (() => {
          const r = svg.getBoundingClientRect();
          return r.bottom < 0 || r.top > window.innerHeight;
        })();
        if (!document.hidden && !offscreen) {
          setScene(SCENES[Math.floor(Math.random() * SCENES.length)]);
        }
        next();
      }, 4000 + Math.random() * 5000);
    };
    next();
    return () => { alive = false; clearTimeout(t); };
  }, []);

  // ── Повільне моргання: клас на <svg>, плавність — CSS ────────
  useEffect(() => {
    if (reducedRef.current) return;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    let alive = true;
    const blink = () => {
      t1 = setTimeout(() => {
        if (!alive) return;
        const el = svgRef.current;
        el?.classList.add("blinking");
        t2 = setTimeout(() => {
          el?.classList.remove("blinking");
          blink();
        }, 140); // коротке моргання — очі майже не «застигають» закритими
      }, (mood === "sleepy" || mood === "sad" ? 7000 + Math.random() * 7000 : 3500 + Math.random() * 4000));
    };
    blink();
    return () => { alive = false; clearTimeout(t1); clearTimeout(t2); };
  }, [mood]);

  // ── Ноутбук: якір екрана після розкриття ─────────────────────
  useEffect(() => {
    if (!laptop) {
      anchorCb.current?.(null);
      return;
    }
    const t = setTimeout(() => {
      const el = screenRef.current;
      // Мобільні (<768): лінії не малюємо (ТЗ 4.1.6) — якір не потрібен
      if (el && window.innerWidth >= 768) {
        const r = el.getBoundingClientRect();
        anchorCb.current?.({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
    }, 450);
    return () => {
      clearTimeout(t);
      anchorCb.current?.(null);
    };
  }, [laptop]);

  // ── Hover / click ─────────────────────────────────────────────
  const triggerJump = () => {
    if (reducedRef.current) return;
    setJumping(false);
    // дозвіл перезапустити keyframes навіть під час попереднього стрибка
    requestAnimationFrame(() => setJumping(true));
  };

  const handleEnter = () => {
    setHover(true);
    setOvr({ mood: "happy", until: Infinity });
    triggerJump();
  };
  const handleLeave = () => {
    setHover(false);
    setOvr((prev) => (prev && prev.until === Infinity ? null : prev));
  };
  const handleClick = () => {
    setOvr({ mood: "happy", until: performance.now() + 1200 });
    triggerJump();
    onClick?.();
  };

  // ── Цілі погляду/щуріння (мова емоції + сценка; hover → центр) ─
  const [mx, my] = MOOD_LOOK[mood] ?? [0, 0];
  const gx = clamp(hover ? 0 : scene.gx + mx);
  const gy = clamp(hover ? 0 : scene.gy + my);
  const squint = hover ? 0 : Math.max(scene.squint, MOOD_SQUINT[mood] ?? 0);
  const wink = !hover && scene.wink;

  const eyeColor = isLight ? "#F5F5F5" : "#050505";
  const sL = shapeFor(mood, -1);
  const sR = shapeFor(mood, 1);

  const eyeTransform = (s: Shape, x0: number) =>
    `translate(${x0 + s.dx}px, ${EYE_Y + s.dy}px) rotate(${s.rot}deg) scale(${s.scale})`;

  /** Геометрія прямокутника ока з урахуванням щуріння (перехід — CSS). */
  const rectStyle = (s: Shape, blinkOpen = true): React.CSSProperties => {
    const sq = squint;
    const w = 2 * s.rx * (1 + 0.12 * sq);
    const h = Math.max(0.6, 2 * s.ry * (blinkOpen ? 1 : 0.06) * (1 - 0.6 * sq));
    return {
      x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(w, h) / 2,
      fill: eyeColor,
      transition: "all 280ms cubic-bezier(0.22,1,0.36,1)",
    } as React.CSSProperties;
  };

  const tilt = mood === "thinking" ? -5 : mood === "sad" ? 4 : 0;
  const sink = mood === "sad" ? 1.5 : 0;
  const sway = mood === "neutral";

  return (
    <svg
      ref={svgRef}
      data-agent-svg
      viewBox="0 0 40 46"
      width={size}
      height={size * 1.15}
      className={`select-none ${className}`}
      style={{ overflow: "visible", cursor: onClick ? "pointer" : undefined }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={handleClick}
      onAnimationEnd={(e) => {
        if ((e.target as Element).classList.contains("ag-jump")) setJumping(false);
      }}
      role="img"
      aria-label="Agent"
    >
      <defs>
        <radialGradient id={`ag-sphere-dark-${uid}`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="58%" stopColor="#E4E4E4" />
          <stop offset="100%" stopColor="#9CA3AF" />
        </radialGradient>
        <radialGradient id={`ag-sphere-light-${uid}`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#3B3B3B" />
          <stop offset="55%" stopColor="#262626" />
          <stop offset="100%" stopColor="#0A0A0A" />
        </radialGradient>
        <radialGradient id={`ag-tint-${uid}`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#FF6B66" />
          <stop offset="70%" stopColor="#E5322D" />
          <stop offset="100%" stopColor="#B71C1C" />
        </radialGradient>
        <radialGradient id={`ag-gloss-${uid}`} cx="30%" cy="24%" r="55%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── Стрибок: CSS keyframes, БЕЗ transform-атрибута (без конфліктів) ── */}
      <g className={jumping ? "ag-jump" : undefined}>
        {/* Центр корпусу (статичний атрибут — не анімується) */}
        <g transform={`translate(20 ${21 + sink})`}>
          {/* Гойдання корпусу (недовірливий/спокійний) */}
          <g className={sway ? "ag-sway" : undefined} style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}>
            {/* Нахил емоції (CSS-перехід) */}
            <g style={{ transform: `rotate(${tilt}deg)`, transformBox: "fill-box", transformOrigin: "50% 100%", transition: "transform 600ms cubic-bezier(0.22,1,0.36,1)" }}>
              {/* Дихання */}
              <g className="ag-breathe" style={{ transformBox: "fill-box", transformOrigin: "50% 55%" }}>
                {/* Дрожі angry */}
                <g className={mood === "angry" ? "ag-shake" : undefined}>
                  {/* Тіло: нормальне + червоний шар (затухає 300 мс) */}
                  <circle r={16} fill={`url(#${isLight ? `ag-sphere-light-${uid}` : `ag-sphere-dark-${uid}`})`} />
                  <circle r={16} fill={`url(#ag-tint-${uid})`} style={{ opacity: mood === "angry" ? 1 : 0, transition: "opacity 300ms ease" }} />
                  <ellipse cx={-4.5} cy={-7} rx={8.5} ry={6} fill={`url(#ag-gloss-${uid})`} />
                  <circle r={16} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth={0.6} />

                  {/* Погляд: одна ціль — CSS-перехід 650 мс (пружний) */}
                  <g style={{ transform: `translate(${gx}px, ${gy}px)`, transformBox: "fill-box", transformOrigin: "50% 50%", transition: "transform 650ms cubic-bezier(0.22,1,0.36,1)" }}>
                    {/* Моргання (клас .blinking на <svg>) */}
                    <g className="ag-blinkwrap" style={{ transformBox: "fill-box", transformOrigin: "50% 50%", transition: "transform 260ms ease-in-out" }}>
                      {/* Ліве око */}
                      <g style={{ transform: eyeTransform(sL, EYE_LX), transformBox: "fill-box", transformOrigin: "50% 50%", transition: "transform 450ms cubic-bezier(0.22,1,0.36,1)" }}>
                        <rect
                          {...rectGeom(sL, squint)}
                          fill={eyeColor}
                          style={{ transition: "all 280ms cubic-bezier(0.22,1,0.36,1)", opacity: sL.arc ? 0 : 1 }}
                        />
                        {sL.arc && (
                          <path
                            d={`M ${-sL.rx} 2 Q 0 ${2 - sL.arcH} ${sL.rx} 2`}
                            fill="none" stroke={eyeColor} strokeWidth={3.4} strokeLinecap="round"
                            style={{ transition: "opacity 200ms ease", opacity: 1 }}
                          />
                        )}
                      </g>
                      {/* Праве око (обгорнуте для підмигування) */}
                      <g className={wink ? "ag-winkwrap" : undefined} style={{ transformBox: "fill-box", transformOrigin: "50% 50%", transition: "transform 240ms ease-in-out" }}>
                        <g style={{ transform: eyeTransform(sR, EYE_RX), transformBox: "fill-box", transformOrigin: "50% 50%", transition: "transform 450ms cubic-bezier(0.22,1,0.36,1)" }}>
                          <rect
                            {...rectGeom(sR, squint)}
                            fill={eyeColor}
                            style={{ transition: "all 280ms cubic-bezier(0.22,1,0.36,1)", opacity: sR.arc ? 0 : 1 }}
                          />
                          {sR.arc && (
                            <path
                              d={`M ${-sR.rx} 2 Q 0 ${2 - sR.arcH} ${sR.rx} 2`}
                              fill="none" stroke={eyeColor} strokeWidth={3.4} strokeLinecap="round"
                              style={{ transition: "opacity 200ms ease", opacity: 1 }}
                            />
                          )}
                        </g>
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>

        {/* ── Ноутбук: БЕЗ рук, нижче тіла, CSS-розкриття ─────── */}
        <g transform="translate(11 35)">
          <g
            ref={screenRef}
            className={`ag-laptop${laptop ? " open" : ""}`}
            style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
          >
            <g className={laptop ? "ag-float" : undefined} style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}>
              {/* Клавіатура */}
              <rect x={0} y={7.5} width={18} height={5} rx={1.4} fill="#2A2A2A" stroke="#4A4A4A" strokeWidth={0.5} />
              <rect x={1.6} y={8.8} width={14.8} height={1.6} rx={0.6} fill="#3A3A3A" />
              {/* Кришка: scaleY 0→1 від нижнього краю */}
              <g className="ag-lid" style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}>
                <rect x={1} y={-6.5} width={16} height={14} rx={1.4} fill="#111111" stroke="#4A4A4A" strokeWidth={0.5} />
                <rect x={2.2} y={-5.3} width={13.6} height={11.6} rx={0.8} fill="#E8E8E8" />
                {/* Рядки коду: CSS-анімація наповнення */}
                <rect className="cl cl1" x={3.4} y={-4} width={9} height={1.3} rx={0.6} fill="#3A3A3A" style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }} />
                <rect className="cl cl2" x={3.4} y={-1.9} width={7} height={1.3} rx={0.6} fill="#3A3A3A" style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }} />
                <rect className="cl cl3" x={3.4} y={0.2} width={10} height={1.3} rx={0.6} fill="#3A3A3A" style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }} />
                <rect className="cl cl4" x={3.4} y={2.3} width={6} height={1.3} rx={0.6} fill="#3A3A3A" style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }} />
                <rect className="ag-cursor" x={11.5} y={2.3} width={1.4} height={1.4} rx={0.3} fill="#111111" />
              </g>
            </g>
          </g>
        </g>
      </g>

      {/* ── Усі ключі/CSS — тут (без rAF, усе робить композитор) ── */}
      <style>{`
        /* Стрибок: присідання → політ → приземлення → відскок */
        @keyframes ag-jump-kf {
          0%   { transform: translateY(0) scale(1, 1); }
          14%  { transform: translateY(2px) scale(1.1, 0.84); }
          42%  { transform: translateY(-8.5px) scale(0.95, 1.12); }
          70%  { transform: translateY(0) scale(1.08, 0.9); }
          86%  { transform: translateY(-1.8px) scale(0.98, 1.04); }
          100% { transform: translateY(0) scale(1, 1); }
        }
        .ag-jump {
          animation: ag-jump-kf 0.62s cubic-bezier(0.34, 1.56, 0.64, 1) 1;
          transform-box: fill-box;
          transform-origin: 50% 100%;
        }
        /* Дихання ±2% */
        @keyframes ag-breathe-kf {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.02); }
        }
        .ag-breathe { animation: ag-breathe-kf 3.4s ease-in-out infinite; }
        /* Легке гойдання корпусу */
        @keyframes ag-sway-kf {
          0%, 100% { transform: rotate(-0.8deg); }
          50%      { transform: rotate(0.8deg); }
        }
        .ag-sway { animation: ag-sway-kf 6s ease-in-out infinite; }
        /* Дрожі angry */
        @keyframes ag-shake-kf {
          0%, 100% { transform: translateX(0); }
          25%      { transform: translateX(-0.55px); }
          75%      { transform: translateX(0.55px); }
        }
        .ag-shake { animation: ag-shake-kf 0.1s linear infinite; }
        /* Моргання (клас .blinking на батьківському <svg>) */
        svg.blinking .ag-blinkwrap { transform: scaleY(0.06); transition-duration: 150ms; }
        /* Підмигування правим окном */
        .ag-winkwrap { transform: scaleY(0.07); }
        /* Паріння ноутбука */
        @keyframes ag-float-kf {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-1.5px); }
        }
        .ag-float { animation: ag-float-kf 3s ease-in-out infinite; }
        /* Рядки коду: послідовне наповнення */
        @keyframes ag-cl-kf {
          0%   { transform: scaleX(0.15); fill: #3A3A3A; }
          14%  { transform: scaleX(1);     fill: #E5E5E5; }
          62%  { transform: scaleX(1);     fill: #9CA3AF; }
          78%  { transform: scaleX(0.15); fill: #3A3A3A; }
          100% { transform: scaleX(0.15); fill: #3A3A3A; }
        }
        .ag-laptop.open .cl1 { animation: ag-cl-kf 3.4s ease-in-out infinite 0.15s; }
        .ag-laptop.open .cl2 { animation: ag-cl-kf 3.4s ease-in-out infinite 0.55s; }
        .ag-laptop.open .cl3 { animation: ag-cl-kf 3.4s ease-in-out infinite 0.95s; }
        .ag-laptop.open .cl4 { animation: ag-cl-kf 3.4s ease-in-out infinite 1.35s; }
        /* Миготіння курсора */
        @keyframes ag-cursor-kf { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        .ag-laptop.open .ag-cursor { animation: ag-cursor-kf 0.5s steps(1) infinite; }
        /* Розкриття/закриття ноутбука (пружина) */
        .ag-laptop {
          opacity: 0;
          transform: scale(0.4);
          visibility: hidden;
          pointer-events: none;
          transition:
            opacity 300ms ease,
            transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1),
            visibility 0s linear 350ms;
        }
        .ag-laptop.open {
          opacity: 1;
          transform: scale(1);
          visibility: visible;
          transition:
            opacity 300ms 60ms ease,
            transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1),
            visibility 0s;
        }
        /* Кришка: підйом від нижнього краю */
        .ag-lid {
          transform: scaleY(0);
          transition: transform 340ms 80ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .ag-laptop.open .ag-lid { transform: scaleY(1); }
      `}</style>
    </svg>
  );
}
