import { Stats, Threat, Region, Timeline, Severity, ExploitMaturity, DdosStats, DdosLayer } from "./types";
import { parseApiDate } from "./dates";
import curatedRaw from "../../data/curated_threats.json";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
// Render free tier може прокидатися до хвилини. Ліміт у 2 секунди завжди
// показував демо-дані після простою, хоча API вже завантажував актуальні дані.
const API_TIMEOUT_MS = 55_000;

type CuratedItem = {
  title: string;
  url: string;
  source: string;
  region: Region;
  type: string;
  severity: Severity;
  country: string[];
  tags: string[];
  summary: string;
  published: string;
  exploit_maturity: ExploitMaturity;
  vendor?: string | null;
};

const CURATED_THREATS: Threat[] = (curatedRaw as CuratedItem[]).map((item, i) => ({
  id: i + 1,
  external_id: item.url,
  title: item.title,
  source: item.source,
  type: item.type,
  severity: item.severity,
  country: item.country,
  region: item.region,
  vendor: item.vendor ?? null,
  vendor_local: null,
  products: [],
  published: item.published,
  tags: item.tags,
  summary: item.summary,
  url: item.url,
  cve_id: null,
  cvss_score: null,
  local_score: null,
  epss_score: null,
  exploit_maturity: item.exploit_maturity,
}));

const uaCount = CURATED_THREATS.filter((t) => t.region === "UA").length;
const criticalCount = CURATED_THREATS.filter((t) => t.severity === "Critical").length;
const activeExploits = CURATED_THREATS.filter(
  (t) => t.exploit_maturity === "In the wild" || t.exploit_maturity === "Weaponized"
).length;

const sourceCounts = CURATED_THREATS.reduce<Record<string, number>>((acc, t) => {
  acc[t.source] = (acc[t.source] ?? 0) + 1;
  return acc;
}, {});

const severityCounts = CURATED_THREATS.reduce<Record<string, number>>((acc, t) => {
  acc[t.severity] = (acc[t.severity] ?? 0) + 1;
  return acc;
}, {});

const maturityCounts = CURATED_THREATS.reduce<Record<string, number>>((acc, t) => {
  const key = t.exploit_maturity || "Unknown";
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

const demoTotal = CURATED_THREATS.length || 1;
const toPct = (count: number) => Math.round((count / demoTotal) * 1000) / 10;

const DEMO_STATS: Stats = {
  critical_threats: criticalCount,
  active_exploits: activeExploits,
  new_cve_24h: 0,
  ua_alerts: uaCount,
  high_epss_risk: 0,
  top_vendors: [],
  by_source: Object.entries(sourceCounts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count),
  by_country: [],
  ddos_origins: [],
  ddos_targets: [],
  by_actor: [],
  by_sponsor: [],
  severity_breakdown: Object.entries(severityCounts).map(([severity, count]) => ({ severity, count, pct: toPct(count) })),
  exploit_breakdown: Object.entries(maturityCounts).map(([maturity, count]) => ({ maturity, count, pct: toPct(count) })),
  total_threats: CURATED_THREATS.length,
  last_update: new Date().toISOString(),
};

const DEMO_THREATS: Threat[] = [...CURATED_THREATS].sort(
  (a, b) => (parseApiDate(b.published)?.getTime() ?? 0) - (parseApiDate(a.published)?.getTime() ?? 0)
);

async function safeFetch<T>(path: string, fallback: T): Promise<{ data: T; isDemo: boolean }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json(), isDemo: false };
  } catch {
    return { data: fallback, isDemo: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchStats(region?: Region) {
  const qs = new URLSearchParams({ days: "365", ...(region ? { region } : {}) });
  const stats = { ...DEMO_STATS };
  if (region) {
    const filtered = CURATED_THREATS.filter((t) => t.region === region);
    stats.total_threats = filtered.length;
    stats.critical_threats = filtered.filter((t) => t.severity === "Critical").length;
    stats.ua_alerts = region === "UA" ? filtered.length : 0;
    stats.active_exploits = filtered.filter(
      (t) => t.exploit_maturity === "In the wild" || t.exploit_maturity === "Weaponized"
    ).length;
    const bySource = filtered.reduce<Record<string, number>>((acc, t) => {
      acc[t.source] = (acc[t.source] ?? 0) + 1;
      return acc;
    }, {});
    stats.by_source = Object.entries(bySource).map(([source, count]) => ({ source, count }));
  }
  return safeFetch<Stats>(`/stats?${qs}`, stats);
}

const DEMO_TIMELINE: Timeline = {
  cve_id: "CVE-2026-1287",
  found: true,
  verdict: "Критична швидкість: почали атакувати практично одразу після публікації — патчити невідкладно.",
  days_to_poc: 1,
  days_to_kev: 3,
  cvss_score: 9.8,
  epss_score: 0.94,
  events: [
    {
      type: "published", label: "Уязвимість опублікована", date: new Date(Date.now() - 4 * 86400e3).toISOString(),
      source: "NVD", title: "CVE-2026-1287", url: null, severity: "Critical",
    },
    {
      type: "poc", label: "З'явився публічний PoC", date: new Date(Date.now() - 3 * 86400e3).toISOString(),
      source: "GitHub", title: "PoC: CVE-2026-1287-exploit", url: "https://github.com", severity: "Unknown",
    },
    {
      type: "kev", label: "Додано в CISA KEV (активна експлуатація)", date: new Date(Date.now() - 1 * 86400e3).toISOString(),
      source: "CISA KEV", title: "CVE-2026-1287 KEV", url: null, severity: "Critical",
    },
  ],
};

export async function fetchTimeline(cveId: string) {
  return safeFetch<Timeline>(`/timeline/${cveId}`, { ...DEMO_TIMELINE, cve_id: cveId });
}

export type ThreatCategory = "feed" | "ioc" | "all";

export interface ThreatFilterOpts {
  search?: string;
  offset?: number;
  severity?: Severity;
  sort?: string;
  days?: number;
  source?: string;
  vendor?: string;
  maturity?: string;
  dateFrom?: string;
  dateTo?: string;
  hasCve?: boolean;
  actor?: string;
}

export async function fetchThreats(
  region?: Region,
  limit = 25,
  category: ThreatCategory = "all",
  opts: ThreatFilterOpts = {}
) {
  const qs = new URLSearchParams({
    limit: String(limit),
    days: String(opts.days ?? 365),
    ...(region ? { region } : {}),
    ...(category !== "all" ? { category } : {}),
    ...(opts.search ? { search: opts.search } : {}),
    ...(opts.severity ? { severity: opts.severity } : {}),
    ...(opts.offset ? { offset: String(opts.offset) } : {}),
    ...(opts.sort ? { sort: opts.sort } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.vendor ? { vendor: opts.vendor } : {}),
    ...(opts.maturity ? { exploit_maturity: opts.maturity } : {}),
    ...(opts.dateFrom ? { date_from: opts.dateFrom } : {}),
    ...(opts.dateTo ? { date_to: opts.dateTo } : {}),
    ...(opts.hasCve ? { has_cve: "true" } : {}),
    ...(opts.actor ? { actor: opts.actor } : {}),
  });
  let filtered = region ? DEMO_THREATS.filter((t) => t.region === region) : DEMO_THREATS;
  if (category === "feed") filtered = filtered.filter((t) => t.type !== "IOC");
  if (category === "ioc") filtered = filtered.filter((t) => t.type === "IOC");
  if (opts.severity) filtered = filtered.filter((t) => t.severity === opts.severity);
  if (opts.search) {
    const needle = opts.search.toLowerCase();
    filtered = filtered.filter((t) =>
      [t.title, t.summary, t.source, t.cve_id ?? "", t.vendor ?? "", ...t.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }
  const offset = opts.offset ?? 0;
  return safeFetch<{ total: number; items: Threat[] }>(`/threats?${qs}`, {
    total: filtered.length,
    items: filtered.slice(offset, offset + limit),
  });
}

// Довідники для фільтрів «Бази записів» (v1.6.1)
export interface SourcesResponse {
  received: Record<string, number | null>;
  groups?: Record<string, string[]>;
  /** ISO-время последнего полного прохода колекторов (null, если ещё не было). */
  last_fetched?: string | null;
}

export async function fetchSources() {
  return safeFetch<SourcesResponse>("/sources", { received: {}, groups: {} });
}

export interface VendorEntry {
  vendor: string;
  count: number;
}

export async function fetchVendors() {
  return safeFetch<VendorEntry[]>("/vendors", []);
}

// Третя лінза: (спонсор, країна IoC) — де фізично хоститься інфраструктура.
export interface SponsorInfraResponse {
  pairs: { sponsor: string; country: string; count: number }[];
  actor_links_by_sponsor: Record<string, number>;
  total_records: number;
}

export async function fetchSponsorInfra() {
  return safeFetch<SponsorInfraResponse>("/stats/sponsor-infrastructure", {
    pairs: [],
    actor_links_by_sponsor: {},
    total_records: 0,
  });
}

// DDoS-статистика Cloudflare Radar. Без даних повертається null (не демо-дані).
export async function fetchDdosStats(scope: "global" | "UA" = "global"): Promise<DdosStats | null> {
  try {
    const res = await fetch(`${API_URL}/ddos-stats?scope=${scope}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export type { DdosLayer };
