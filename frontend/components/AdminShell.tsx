"use client";

// Оболонка сторінки після редизайну: верхнє меню (TopNav) замість Sidebar+Topbar.
// - Заголовок сторінки (h1), підзаголовок і статус «N із M джерел · оновлено …»
//   — у блоці PageHeader ПІД панеллю (прибрано дублювання h1 з Topbar).
// - «System Online» зі старого сайдбара — у правій частині PageHeader.
// - Контент: вся ширина, max-w ~1600px по центру.
// - Футер-полоска «CYBER SENTINEL · REAL-TIME INTELLIGENCE» — на місці.

import { ReactNode } from "react";
import { TopNav } from "./TopNav";

export function AdminShell({
  title,
  subtitle,
  meta,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Друга частина статусного рядка в меню (синхронізація/записи). */
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <TopNav actions={actions} subtitle={subtitle} meta={meta} />

      <main className="mx-auto w-full max-w-[1600px] px-3 sm:px-4 lg:px-6">
        {/* ─── PageHeader: лише h1 ────────────────────────────────
            Порожній title → блок не рендериться (головна: назва в центрі).
            Підзаголовок/статус тепер у меню (TopNav, 2-й рядок). */}
        {title && (
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-3 pt-4 sm:pt-5">
            <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight sm:text-3xl">
              <span className="bg-gradient-to-r from-text-primary to-text-muted bg-clip-text text-transparent">
                {title}
              </span>
            </h1>
          </div>
        )}

        {children}
      </main>

      <div className="mt-6 border-t border-border/60 bg-panel/30 px-3 py-2 text-center font-mono text-[9px] uppercase tracking-[0.25em] text-text-muted/70">
        CYBER SENTINEL · REAL-TIME INTELLIGENCE
      </div>
    </div>
  );
}
