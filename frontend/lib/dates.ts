/**
 * Парсер дат із API бекенду.
 *
 * Бекенд пише наївні UTC-часи без пояса: "2026-11-01T20:49:29.300553"
 * (SQLAlchemy DateTime, db.now_utc()). JavaScript трактує такий рядок як
 * ЛОКАЛЬНИЙ час браузера — у зоні UTC+2 шапка показувала 20:49 замість
 * реальних 22:49 (різниця завжди дорівнює зсуву поясу користувача).
 *
 * Тут такі значення тлумачимо як UTC, а рядки з поясом (Z / ±HH:MM)
 * читаємо як є. Дати з `new Date().toISOString()` (вже з Z) не змінюються.
 */

const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Повертає Date або null, якщо значення відсутнє/некоректне. */
export function parseApiDate(value?: string | Date | null): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  // Вже з часовим поясом — не чіпаємо.
  if (HAS_TZ.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Лише дата (YYYY-MM-DD) — інтерпретуємо як опівніч UTC (як і раніше).
  if (DATE_ONLY.test(raw)) return new Date(raw);

  // Наївний час: додаємо Z, щоб браузер не читав його як локальний.
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(`${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Формат «HH:MM» у локалі користувача; порожнє значення → дефіс. */
export function formatApiTime(value?: string | Date | null, locale = "uk-UA"): string {
  const d = parseApiDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
}

/** Формат «DD.MM, HH:MM» у локалі користувача; порожнє значення → дефіс. */
export function formatApiDateTime(value?: string | Date | null, locale = "uk-UA"): string {
  const d = parseApiDate(value);
  if (!d) return "—";
  return `${new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(d)}, ${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d)}`;
}
