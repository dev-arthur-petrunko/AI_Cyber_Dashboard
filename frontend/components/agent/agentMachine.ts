// Машина станів агента: 8 емоцій, пріоритети та тимчасові overrides.
// Емоції передаються ЛИШЕ формою/нахилом/розміром очей, позою та кольором тіла.
// Червоний (#E5322D) допустимий ТІЛЬКИ в "angry" (ТЗ п.5.2).

export type Mood =
  | "neutral"
  | "happy"
  | "angry"
  | "alert"
  | "surprised"
  | "thinking"
  | "sad"
  | "sleepy";

/** 0 = найвищий пріоритет (ТЗ: angry > alert > sad > thinking > happy > surprised > sleepy > neutral). */
export const MOOD_RANK: Record<Mood, number> = {
  angry: 0,
  alert: 1,
  sad: 2,
  thinking: 3,
  happy: 4,
  surprised: 5,
  sleepy: 6,
  neutral: 7,
};

export type AgentState = {
  /** Дані/зовнішні сигнали (loading, critical rise, health…). */
  dataMood: Mood;
  /** Тимчасовий стан від взаємодії: hover → surprised, click → happy. */
  override: Mood | null;
  overrideUntil: number; // performance.now() мс; Infinity — до "leave"
};

export function createAgentState(dataMood: Mood = "neutral"): AgentState {
  return { dataMood, override: null, overrideUntil: 0 };
}

export type AgentEvent =
  | { type: "data"; mood: Mood }
  | { type: "hover" }
  | { type: "leave" }
  | { type: "click"; ms?: number };

export function agentReducer(state: AgentState, ev: AgentEvent): AgentState {
  switch (ev.type) {
    case "data":
      // Зовнішній сигнал головний, але НЕ перериває angry/alert (згідно пріоритету):
      // якщо новий сигнал слабший за поточний override — він чекає (лише dataMood).
      return { ...state, dataMood: ev.mood };
    case "hover":
      return { ...state, override: "surprised", overrideUntil: Infinity };
    case "leave":
      return state.override === "surprised"
        ? { ...state, override: null, overrideUntil: 0 }
        : state;
    case "click":
      return { ...state, override: "happy", overrideUntil: performance.now() + (ev.ms ?? 1000) };
  }
}

/**
 * Фінальний mood: тимчасовий override має пріоритет, ЯКЩО його ранг не вищий
 * за ранг dataMood (напр. surprised НЕ перекриває angry — пріоритет ТЗ).
 */
export function resolveMood(state: AgentState, now: number): Mood {
  if (
    state.override &&
    now < state.overrideUntil &&
    MOOD_RANK[state.override] <= MOOD_RANK[state.dataMood]
  ) {
    return state.override;
  }
  return state.dataMood;
}
