"use client";

import { useEffect, useId, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useTranslation } from "@/components/LanguageContext";
import { parseApiDate } from "@/lib/dates";
import {
  Bar as RBar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PYTHON_API = process.env.NEXT_PUBLIC_PYTHON_API || "http://127.0.0.1:8010";

type Tab = "stats" | "threats" | "examples";

interface PhishingStats {
  total: number;
  verified: number;
  by_brand: Record<string, number>;
  by_source: Record<string, number>;
  by_country: Record<string, number>;
  top_domains: Record<string, number>;
}

interface PhishingThreat {
  id: number;
  external_id: string;
  source: string;
  url: string;
  full_url: string;
  target_brand: string | null;
  domain: string;
  host: string;
  verified: string;
  status: string;
  target_country: string[];
  tags: string[];
  first_seen: string | null;
  last_seen: string | null;
}

interface PhishingExamples {
  content: string;
  generated_at: string;
  model: string;
  purpose: string;
}

export default function PhishingPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("stats");
  const [stats, setStats] = useState<PhishingStats | null>(null);
  const [threats, setThreats] = useState<PhishingThreat[]>([]);
  const [threatsTotal, setThreatsTotal] = useState(0);
  const [examples, setExamples] = useState<PhishingExamples | null>(null);
  const [loading, setLoading] = useState(true);
  const [examplesLoading, setExamplesLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [statsRes, threatsRes] = await Promise.all([
          fetch(`${PYTHON_API}/phishing/stats`),
          fetch(`${PYTHON_API}/phishing/threats?limit=100`),
        ]);
        if (statsRes.ok) setStats(await statsRes.json());
        if (threatsRes.ok) {
          const data = await threatsRes.json();
          setThreats(data.threats || []);
          setThreatsTotal(data.total || 0);
        }
      } catch {}
      setLoading(false);
    };
    load();
  }, []);

  const loadExamples = async () => {
    setExamplesLoading(true);
    try {
      const res = await fetch(`${PYTHON_API}/phishing/examples`);
      if (res.ok) setExamples(await res.json());
    } catch {}
    setExamplesLoading(false);
  };

  useEffect(() => {
    if (tab === "examples" && !examples) loadExamples();
  }, [tab]);

  const renderMarkdown = (md: string) => {
    return md
      .replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold text-text-primary mt-6 mb-2">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold text-text-primary mt-8 mb-3">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold text-text-primary mt-8 mb-4">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-text-primary font-semibold">$1</strong>')
      .replace(/^- (.+)$/gm, '<li class="ml-4 text-text-secondary">$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 text-text-secondary"><span class="text-primary font-mono">$1.</span> $2</li>')
      .replace(/\n{2,}/g, '<br/><br/>')
      .replace(/\n/g, '<br/>');
  };

  const CHART_COLORS = [
    "#F5F5F5", "#E0E0E0", "#CBCBCB", "#B6B6B6", "#A1A1A1", "#8C8C8C",
    "#7A7A7A", "#6B6B6B", "#5C5C5C", "#4D4D4D", "#3E3E3E", "#2F2F2F",
  ];

  const UNKNOWN_RE = /^(невідомий бренд|unknown|невідомо|—)$/i;

  const BarChart = ({ data, label, excludeUnknown }: { data: Record<string, number>; label: string; excludeUnknown?: boolean }) => {
    const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
    let pairs = Object.entries(data ?? {});
    let hidden = 0;
    if (excludeUnknown) {
      for (const [n, v] of pairs) if (UNKNOWN_RE.test(n)) hidden += v;
      pairs = pairs.filter(([n]) => !UNKNOWN_RE.test(n));
    }
    const entries = pairs.slice(0, 12).map(([name, value]) => ({ name, value }));
    const total = entries.reduce((s, e) => s + e.value, 0);
    const height = Math.max(entries.length * 38 + 28, 130);
    return (
      <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
          {total > 0 && (
            <span
              className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-text-muted"
              title={hidden > 0 ? `Без бренда: ${hidden.toLocaleString()}` : undefined}
            >
              {hidden > 0 ? `…${hidden.toLocaleString()} + ` : ""}
              {total.toLocaleString()}
            </span>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-xs text-text-muted">Немає даних</p>
        ) : (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
              <RBarChart data={entries} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }}>
                <defs>
                  {entries.map((_, i) => {
                    const c = CHART_COLORS[i % CHART_COLORS.length];
                    return (
                      <linearGradient key={i} id={`${uid}g${i}`} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={c} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={c} stopOpacity={0.95} />
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis type="number" hide domain={[0, "dataMax"]} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  contentStyle={{
                    background: "rgba(10,10,10,0.96)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 10,
                    fontSize: 12,
                    color: "#e2e8f0",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                  }}
                  formatter={(value) => {
                    const v = Number(value);
                    const pct = total > 0 ? ` · ${((v / total) * 100).toFixed(1)}%` : "";
                    return [`${v.toLocaleString()}${pct}`, ""];
                  }}
                />
                <RBar dataKey="value" radius={[0, 6, 6, 0]} barSize={16} animationDuration={500} animationEasing="ease-out">
                  {entries.map((_, i) => (
                    <Cell key={i} fill={`url(#${uid}g${i})`} />
                  ))}
                </RBar>
                <LabelList
                  dataKey="value"
                  position="right"
                  offset={10}
                  style={{ fill: "#cbd5e1", fontSize: 11 }}
                  formatter={(v: React.ReactNode) => Number(v).toLocaleString()}
                />
              </RBarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  };

  return (
    <AdminShell title={t.nav.phishing}>
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">

        {/* Header */}
        <header className="relative mb-6 animate-fade-in-up sm:mb-8">
          <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-danger/6 blur-[60px]" />
          <div className="relative">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-0.5 w-6 rounded-full bg-gradient-to-r from-text-primary to-text-muted" />
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-secondary">
                PHISHTANK · OPENPHISH · PHISHSTATS
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-text-primary sm:text-2xl lg:text-3xl">
              <span className="bg-gradient-to-r from-text-primary to-text-muted bg-clip-text text-transparent">
                PHISHING MONITOR
              </span>
            </h1>
            <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-text-muted sm:text-sm">
              {t.sections.phishingSubtitle}
            </p>
          </div>
        </header>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
          {([
            ["stats", t.sections.phishingStats],
            ["threats", `${t.sections.phishingThreats} (${threatsTotal.toLocaleString()})`],
            ["examples", t.sections.phishingExamples],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all ${
                tab === key
                  ? "bg-info/20 text-white shadow-sm"
                  : "text-text-muted hover:text-text-secondary hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Stats Tab */}
        {tab === "stats" && (
          <div className="space-y-4 animate-fade-in-up">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-text-muted">Завантаження...</div>
            ) : stats ? (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
                    <div className="font-mono text-2xl font-bold text-text-secondary">{stats.total.toLocaleString()}</div>
                    <div className="mt-1 text-xs text-text-muted">{t.sections.phishingTotal}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
                    <div className="font-mono text-2xl font-bold text-signal">{stats.verified.toLocaleString()}</div>
                    <div className="mt-1 text-xs text-text-muted">{t.sections.phishingVerified}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
                    <div className="font-mono text-2xl font-bold text-info">{Object.keys(stats.by_brand).length}</div>
                    <div className="mt-1 text-xs text-text-muted">{t.sections.phishingByBrand}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
                    <div className="font-mono text-2xl font-bold text-primary">{Object.keys(stats.by_country).length}</div>
                    <div className="mt-1 text-xs text-text-muted">{t.sections.phishingByCountry}</div>
                  </div>
                </div>

                {/* Charts */}
                <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                  <BarChart data={stats?.by_brand ?? {}} label={t.sections.phishingByBrand} excludeUnknown />
                  <BarChart data={stats?.by_country ?? {}} label={t.sections.phishingByCountry} />
                </div>
                <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
                  <BarChart data={stats?.top_domains ?? {}} label={t.sections.phishingTopDomains} />
                  <BarChart data={stats?.by_source ?? {}} label={t.sections.phishingBySource} />
                </div>
              </>
            ) : (
              <div className="flex h-40 items-center justify-center text-text-muted">Немає даних</div>
            )}
          </div>
        )}

        {/* Threats Tab */}
        {tab === "threats" && (
          <div className="animate-fade-in-up">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-text-muted">Завантаження...</div>
            ) : threats.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/10 bg-white/[0.02]">
                    <tr>
                      <th className="px-3 py-2 font-medium text-text-muted">Джерело</th>
                      <th className="px-3 py-2 font-medium text-text-muted">URL / Домен</th>
                      <th className="px-3 py-2 font-medium text-text-muted">Бренд</th>
                      <th className="px-3 py-2 font-medium text-text-muted">Статус</th>
                      <th className="px-3 py-2 font-medium text-text-muted">Країни</th>
                      <th className="px-3 py-2 font-medium text-text-muted">Виявлено</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {threats.map((t) => (
                      <tr key={t.id} className="transition-colors hover:bg-white/[0.02]">
                        <td className="px-3 py-2">
                          <span className="inline-flex rounded-full bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info">
                            {t.source}
                          </span>
                        </td>
                        <td className="max-w-xs px-3 py-2">
                          <a
                            href={t.full_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate text-info hover:underline"
                            title={t.full_url}
                          >
                            {t.domain || t.url}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-text-secondary">{t.target_brand || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            t.verified === "verified" || t.verified === "community"
                              ? "bg-signal/10 text-signal"
                              : "bg-warning/10 text-warning"
                          }`}>
                            {t.verified}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-text-muted">{(t.target_country || []).join(", ") || "—"}</td>
                        <td className="px-3 py-2 text-text-muted">
                          {parseApiDate(t.first_seen)?.toLocaleDateString("uk-UA") ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-text-muted">Немає фішингових URL</div>
            )}
          </div>
        )}

        {/* Examples Tab */}
        {tab === "examples" && (
          <div className="animate-fade-in-up">
            <div className="mb-4 rounded-xl border border-warning/20 bg-warning/5 p-4">
              <p className="text-sm font-medium text-warning">{t.sections.phishingExamplesSubtitle}</p>
            </div>

            {!examples && !examplesLoading && (
              <button
                onClick={loadExamples}
                className="rounded-lg bg-info/20 px-4 py-2 text-sm font-medium text-info hover:bg-info/30 transition-colors"
              >
                {t.sections.phishingRefresh}
              </button>
            )}

            {examplesLoading && (
              <div className="flex h-40 items-center justify-center gap-2 text-text-muted">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-info border-t-transparent" />
                {t.sections.phishingGenerating}
              </div>
            )}

            {examples && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs text-text-muted">
                    {examples.model} · {(parseApiDate(examples.generated_at) ?? new Date()).toLocaleString("uk-UA")}
                  </span>
                  <button
                    onClick={loadExamples}
                    className="text-xs text-info hover:underline"
                  >
                    {t.sections.phishingRefresh}
                  </button>
                </div>
                <div
                  className="prose-phishing text-sm leading-relaxed text-text-secondary"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(examples.content) }}
                />
              </div>
            )}
          </div>
        )}

      </div>
    </AdminShell>
  );
}
