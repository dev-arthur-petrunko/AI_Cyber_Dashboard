// Машина станів агента: 8 емоцій + пріоритет (ТЗ 5.2).
// Емоції передаються ЛИШЕ формою/нахилом/розміром очей, позою та кольором тіла.
// Червоний (#E5322D) допустимий ТІЛЬКИ в "angry".
// (Мертві reducer/createAgentState/resolveMood видалено — ніхто не імпортував.)

export type Mood =
  | "neutral"
  | "happy"
  | "angry"
  | "alert"
  | "surprised"
  | "thinking"
  | "sad"
  | "sleepy";

/** 0 = найвищий пріоритет (angry > alert > sad > thinking > happy > surprised > sleepy > neutral). */
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
