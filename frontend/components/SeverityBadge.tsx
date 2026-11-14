"use client";

import { Severity, ExploitMaturity } from "@/lib/types";
import { useTranslation } from "./LanguageContext";

const SEVERITY_COLOR: Record<Severity, string> = {
  // Ч/б: різниця щільністю, не кольором
  Critical: "bg-black text-white border border-black dark:bg-white dark:text-black dark:border-white",
  High: "border-[1.5px] border-text-primary text-text-primary",
  Medium: "border border-border-strong text-text-secondary",
  Low: "text-text-muted",
  Unknown: "border border-dashed border-border text-text-muted",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useTranslation();
  return (
    <span
      title={severity === "Unknown" ? t.table.unknownSeverityTooltip : undefined}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide ${SEVERITY_COLOR[severity]} ${severity === "Unknown" ? "cursor-help" : ""}`}
    >
      {severity === "High" && (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {severity}
    </span>
  );
}

export function ExploitMaturityBadge({ maturity }: { maturity: ExploitMaturity }) {
  const { t } = useTranslation();

  if (maturity === "Unknown") {
    return <span className="text-xs font-medium text-text-muted">{t.exploitStatus.unknown}</span>;
  }
  const MATURITY_LABEL: Record<ExploitMaturity, string> = {
    PoC: t.exploitStatus.poc,
    Weaponized: t.exploitStatus.weaponized,
    "In the wild": t.exploitStatus.inTheWild,
    Unknown: t.exploitStatus.unknown,
  };
  // Ч/б: In the wild — суцільна заливка, Weaponized — рамка, PoC — тонка рамка
  const boxCls =
    maturity === "In the wild"
      ? "bg-black text-white border border-black dark:bg-white dark:text-black dark:border-white"
      : maturity === "Weaponized"
        ? "border-[1.5px] border-text-primary text-text-primary"
        : "border border-border-strong text-text-secondary";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${boxCls}`}>
      {MATURITY_LABEL[maturity]}
    </span>
  );
}
