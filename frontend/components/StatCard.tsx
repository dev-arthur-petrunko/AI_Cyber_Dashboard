import { ReactNode, useEffect, useState, useRef } from "react";

export function StatCard({
  label,
  value,
  accent,
  icon,
  delay = 0,
  hint,
}: {
  label: string;
  value: number | string;
  accent?: "critical" | "warning" | "signal" | "default";
  icon?: ReactNode;
  delay?: number;
  hint?: string;
}) {
  const accentColor = {
    // Critical — єдиний червоний акцент сайту (#E5322D, рішення власника)
    critical: "text-[#E5322D]",
    warning: "text-warning",
    signal: "text-signal",
    default: "text-text-primary",
  }[accent ?? "default"];

  const iconBg = {
    critical: "bg-[#E5322D]/12",
    warning: "bg-warning/10",
    signal: "bg-signal/10",
    default: "bg-panel-raised",
  }[accent ?? "default"];

  const accentBar = {
    critical: "from-[#E5322D]/0 via-[#E5322D] to-[#E5322D]/0",
    warning: "from-warning/0 via-warning to-warning/0",
    signal: "from-signal/0 via-signal to-signal/0",
    default: "from-primary/0 via-primary to-primary/0",
  }[accent ?? "default"];

  const accentGlow = {
    critical: "bg-[#E5322D]/18",
    warning: "bg-warning/10",
    signal: "bg-signal/10",
    default: "bg-primary/5",
  }[accent ?? "default"];

  // Count-up animation for numeric values
  const [displayValue, setDisplayValue] = useState(typeof value === "number" ? 0 : value);
  const prevValue = useRef(value);

  useEffect(() => {
    if (typeof value !== "number") {
      setDisplayValue(value);
      return;
    }
    const target = value;
    const duration = 1200;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4); // ease-out quart for smoother feel
      setDisplayValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
    prevValue.current = value;
  }, [value]);

  return (
    <div
      className={`animate-slide-up-fade card group relative h-full overflow-hidden p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong sm:p-4${
        accent === "critical" ? " border-[#E5322D]/45 bg-[#E5322D]/[0.05]" : ""
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${accentBar} opacity-60 transition-opacity duration-200 group-hover:opacity-100`} />
      <span className={`pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full blur-2xl ${accentGlow}`} />
      <div className="relative flex h-full items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{label}</p>
          <p className={`mt-2 text-3xl font-bold leading-none tracking-tight text-glow ${accentColor}`}>
            {displayValue}
          </p>
        </div>
        <div className="flex items-start gap-1.5">
          {hint && (
            <div className="group/tooltip relative">
              <span className="flex h-5 w-5 flex-shrink-0 cursor-help items-center justify-center rounded-full bg-panel-raised text-text-muted transition-colors hover:bg-border hover:text-text-secondary">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </span>
              <div className="pointer-events-none absolute right-0 top-7 z-50 w-56 rounded-lg border border-border bg-panel p-2.5 text-[11px] leading-relaxed text-text-muted opacity-0 shadow-lg transition-opacity group-hover/tooltip:opacity-100">
                {hint}
              </div>
            </div>
          )}
          {icon && (
            <span className={`${iconBg} flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border`}>
              {icon}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
