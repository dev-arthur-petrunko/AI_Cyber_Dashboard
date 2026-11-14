"use client";

// Верхня панель навігації (ТЗ: бічного меню більше немає).
// - Назви «CYBER SENTINEL» у меню НЕМАЄ (логотип лише на головній) — за вимогою.
// - Пункти меню: активний підкреслюється білою лінією 2px, що ПЛАВНО переїжджає
//   (transform: translateX + width, transition 250ms cubic-bezier(0.23,1,0.32,1)).
// - Другий рядок (якщо є дані): «74 із 93 джерел · оновлено … · System Online ·
//   Синхронізовано … · N записів у базі» — статус у меню, як просив користувач.
// - < 1100px частина пунктів ховається у випадаюче «Ще ▾»; < 768px — бургер
//   з повноекранним меню (анімація появи).
// - Справа: LanguageToggle, ThemeToggle, кнопка оновлення (⟳) з actions сторінки.

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "./LanguageContext";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";

type NavItem = { href: string; label: string };

/** Порядок пунктів — як у ТЗ. Кількість видимих пунктів залежить від ширини. */
const VISIBLE_WIDE = 8; // ≥ 1440px
const VISIBLE_MEDIUM = 6; // 1100–1439px: два останні пункти — у «Ще ▾»

export function TopNav({
  actions,
  subtitle,
  meta,
}: {
  actions?: ReactNode;
  /** Статусний рядок (джерела/оновлення) — другий ряд меню. */
  subtitle?: ReactNode;
  /** Друга частина статусу (синхронізація/записи). */
  meta?: ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [width, setWidth] = useState(1440);
  // Підкреслення: transform + width активного пункту (px)
  const [indicator, setIndicator] = useState({ x: 0, w: 0, visible: false });
  // Лічильник «перемикань» — для майбутнього кивка агента (етап 4/5)
  const [pulse, setPulse] = useState(0);

  const items: NavItem[] = [
    { href: "/", label: t.nav.dashboard },
    { href: "/ai", label: t.nav.aiAnalysis },
    { href: "/ddos", label: t.nav.ddosShort },
    { href: "/phishing", label: t.nav.phishing },
    { href: "/records", label: t.nav.recordsShort },
    { href: "/sources", label: t.header.sources },
    { href: "/updates", label: t.nav.updates },
    { href: "/support", label: t.nav.support },
  ];

  const visibleCount = width >= 1440 ? VISIBLE_WIDE : width >= 1100 ? VISIBLE_MEDIUM : width >= 768 ? 0 : 0;
  const visible = visibleCount > 0 ? items.slice(0, visibleCount) : [];
  const overflow = visibleCount > 0 ? items.slice(visibleCount) : items;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const activeIndex = visible.findIndex((it) => isActive(it.href));

  // Ширина в'юпорта (для брейкпоінтів ТЗ 1100/768)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Позиція підкреслення: вимірюємо активний <Link> і малюємо лінію над ним
  useLayoutEffect(() => {
    const nav = listRef.current;
    if (!nav || activeIndex < 0 || visibleCount === 0) {
      setIndicator((s) => ({ ...s, visible: false }));
      return;
    }
    const el = nav.querySelectorAll<HTMLAnchorElement>("a[data-nav]")[activeIndex];
    if (!el) {
      setIndicator((s) => ({ ...s, visible: false }));
      return;
    }
    const navBox = nav.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    setIndicator({ x: box.left - navBox.left, w: box.width, visible: true });
  }, [activeIndex, visibleCount, width, pathname]);

  // Закриття випадайки «Ще» кліком поза
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  // Закриття мобільного меню при зміні маршруту
  useEffect(() => setMobileOpen(false), [pathname]);

  const go = () => setPulse((p) => p + 1);

  return (
    <header
      className="sticky top-0 z-30 border-b border-border"
      style={{ background: "var(--panel-card)", backdropFilter: "blur(14px)" }}
    >
      <div className="relative mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:px-4 lg:px-6">
        {/* ── Пункти меню (десктоп ≥ 768px) ─────────────────────── */}
        {width >= 768 && (
          <nav ref={navRef} className="relative min-w-0 flex-1 md:block" aria-label="Main">
            <div ref={listRef} className="relative flex items-center gap-1 overflow-x-auto scrollbar-thin">
              {visible.map((item, i) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-nav
                    onClick={go}
                    aria-current={active ? "page" : undefined}
                    className={`group relative whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-semibold tracking-wide transition-all duration-200 ${
                      i > 0 ? "ml-0.5" : ""
                    } ${
                      active
                        ? "bg-panel-raised text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                        : "text-text-secondary hover:bg-panel-raised/60 hover:text-text-primary"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}

              {/* Що не влізе — у випадаюче «Ще ▾» (тільки 1100–1439px) */}
              {overflow.length > 0 && visibleCount > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMoreOpen((o) => !o)}
                    className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                      moreOpen || overflow.some((i) => isActive(i.href))
                        ? "text-text-primary"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                    aria-expanded={moreOpen}
                  >
                    {t.nav.more} ▾
                  </button>
                  {moreOpen && (
                    <div className="absolute left-0 top-full z-40 mt-1 min-w-[160px] animate-scale-in rounded-lg border border-border bg-panel-raised p-1 shadow-xl">
                      {overflow.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => {
                            setMoreOpen(false);
                            go();
                          }}
                          className={`block rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
                            isActive(item.href)
                              ? "bg-panel text-text-primary"
                              : "text-text-secondary hover:bg-panel hover:text-text-primary"
                          }`}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Підкреслення активного пункту — плавно переїжджає */}
              {indicator.visible && (
                <span
                  className="pointer-events-none absolute bottom-0 h-[2px] rounded-full bg-text-primary"
                  style={{
                    width: indicator.w,
                    transform: `translateX(${indicator.x}px)`,
                    transition: "transform 250ms cubic-bezier(0.23,1,0.32,1), width 250ms cubic-bezier(0.23,1,0.32,1)",
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
          </nav>
        )}

        {/* ── Мобільний бургер (< 768px) ─────────────────────────── */}
        {width < 768 && (
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-panel-raised hover:text-text-primary"
            aria-label="Menu"
            aria-expanded={mobileOpen}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              )}
            </svg>
          </button>
        )}

        <div className="ml-auto flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Кількість записів — у правому куті меню (вимога користувача) */}
          {meta && (
            <span
              className="hidden whitespace-nowrap rounded-md border border-border bg-panel-raised px-2 py-1 font-mono text-[10px] font-semibold tracking-wide text-text-secondary sm:inline-block"
              title={String(t.header.records)}
            >
              {meta}
            </span>
          )}
          <LanguageToggle />
          <ThemeToggle />
          {actions}
        </div>
      </div>

      {/* ── Другий рядок меню: статус джерел (за наявності даних) ─
          «74 із 93 джерел · оновлено 13.11, 22:27 · System Online»
          («Синхронізовано …» і записи прибрано з цього рядка — за вимогою) */}
      {subtitle && (
        <div className="border-t border-border/60">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted sm:px-4 lg:px-6">
            <span className="whitespace-nowrap">{subtitle}</span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text-secondary">
              <span className="dot-glow h-1.5 w-1.5 animate-pulse rounded-full bg-signal text-signal" />
              System Online
            </span>
          </div>
        </div>
      )}

      {/* ── Мобільне меню на весь екран (анімація появи) ──────────── */}
      {mobileOpen && width < 768 && (
        <div className="fixed inset-x-0 bottom-0 top-14 z-40 animate-slide-up-fade overflow-y-auto border-t border-border" style={{ background: "var(--panel-card)", backdropFilter: "blur(14px)" }}>
          <nav className="mx-auto flex max-w-[1600px] flex-col gap-1 p-4" aria-label="Mobile">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center rounded-lg px-4 py-3.5 text-base font-semibold transition-colors ${
                  isActive(item.href)
                    ? "bg-panel-raised text-text-primary"
                    : "text-text-secondary hover:text-text-primary"
                }`}
                aria-current={isActive(item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
