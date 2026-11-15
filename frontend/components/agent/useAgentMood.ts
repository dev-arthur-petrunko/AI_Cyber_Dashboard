"use client";

// Прив'язка емоцій агента до даних (ТЗ 5.3) + idle → sleepy.
// Пріоритет: angry > alert > sad > thinking > happy > surprised > sleepy > neutral.
// Surprised (hover) та click → happy керує сам <Agent/> через reducer.

import { useEffect, useMemo, useState } from "react";
import { Mood, MOOD_RANK } from "./agentMachine";

export type AgentSignals = {
  /** йде завантаження / генерація AI-аналізу */
  loading?: boolean;
  /** backend недоступний (/health) або /ai/* → 503 */
  error?: boolean;
  /** виросла кількість Critical або з'явився "In the wild" */
  criticalRise?: boolean;
  /** ріст DDoS за тиждень (↑ N%) */
  ddosUp?: boolean;
  /** дані порожні ("немає даних") */
  empty?: boolean;
};

/** Обчислює dataMood за сигналами з пріоритетом з ТЗ. */
export function moodFromSignals(s: AgentSignals): Mood {
  const candidates: Mood[] = [];
  if (s.criticalRise) candidates.push("angry");
  if (s.ddosUp) candidates.push("alert");
  if (s.error) candidates.push("sad");
  if (s.loading) candidates.push("thinking");
  if (s.empty) candidates.push("sleepy");
  if (candidates.length === 0) return "neutral";

  let best = candidates[0];
  for (const m of candidates) {
    if (MOOD_RANK[m] < MOOD_RANK[best]) best = m;
  }
  return best;
}

/**
 * dataMood для <Agent mood=…/>:
 * сигнали → за замовчуванням; idle >60с → sleepy (очі-лінійки НЕ ставимо —
 *  sleepy тепер малюється напівзаплющеними, але читабельними очима).
 */
export function useAgentMood(signals: AgentSignals = {}): Mood {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 180_000);
    };
    reset();
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ];
    for (const ev of events) window.addEventListener(ev, reset, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, reset);
    };
  }, []);

  return useMemo(() => {
    const base = moodFromSignals(signals);
    if (base !== "neutral") return base;
    if (signals.empty) return "sleepy";
    return idle ? "sleepy" : "neutral";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    signals.loading,
    signals.error,
    signals.criticalRise,
    signals.ddosUp,
    signals.empty,
    idle,
  ]);
}
