"use client";

// ОДИН spільний rAF на всіх агентів (ТЗ 5.4): провайдер відстежує курсор
// і щокадрово викликає tick-и зареєстрованих агентів (lerp руху очей).
// Пауза при:hidden вкладці (visibilitychange).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  ReactNode,
} from "react";

export type Cursor = { x: number; y: number };
type Tick = (cursor: Cursor) => void;

type AgentApi = {
  subscribe: (tick: Tick) => () => void;
};

const noopSubscribe = () => () => {};
const Ctx = createContext<AgentApi>({ subscribe: noopSubscribe });

export function AgentProvider({ children }: { children: ReactNode }) {
  const subsRef = useRef<Set<Tick>>(new Set());
  const cursorRef = useRef<Cursor>({ x: -9999, y: -9999 });

  const subscribe = useCallback((tick: Tick) => {
    subsRef.current.add(tick);
    return () => {
      subsRef.current.delete(tick);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cursorRef.current.x = e.clientX;
      cursorRef.current.y = e.clientY;
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const c = cursorRef.current;
      for (const fn of subsRef.current) fn(c);
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        raf = requestAnimationFrame(loop);
      }
    };

    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <Ctx.Provider value={{ subscribe }}>{children}</Ctx.Provider>;
}

/** Реєструє tick агента в спільному rAF (безпечний fallback без провайдера). */
export function useAgentCursorTick(tick: Tick) {
  const { subscribe } = useContext(Ctx);
  const ref = useRef(tick);
  ref.current = tick;
  useEffect(() => subscribe((c) => ref.current(c)), [subscribe]);
}
