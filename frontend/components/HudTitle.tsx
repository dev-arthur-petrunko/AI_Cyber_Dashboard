import { ReactNode } from "react";

const DOT = {
  signal: "bg-signal text-signal",
  critical: "bg-critical text-critical",
  warning: "bg-warning text-warning",
  info: "bg-info text-info",
  primary: "bg-primary text-primary",
} as const;

export type HudAccent = keyof typeof DOT;

export function HudTitle({
  label,
  accent = "signal",
  className = "",
}: {
  label: string;
  accent?: HudAccent;
  className?: string;
}) {
  return (
    <h2 className={`flex min-w-0 items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-secondary sm:text-xs ${className}`}>
      <span className={`dot-glow inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full ${DOT[accent]}`} />
      <span className="truncate">{label}</span>
    </h2>
  );
}