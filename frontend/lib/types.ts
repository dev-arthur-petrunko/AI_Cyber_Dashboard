export type Region = "UA" | "World";
export type Severity = "Critical" | "High" | "Medium" | "Low" | "Unknown";
export type ExploitMaturity = "PoC" | "Weaponized" | "In the wild" | "Unknown";

export interface Explanation {
  explanation: string;
  risk: string;
  recommendations: string[];
}

export interface Threat {
  id: number;
  external_id: string;
  title: string;
  source: string;
  type: string;
  severity: Severity;
  country: string[];
  region: Region;
  vendor: string | null;
  vendor_local: string | null;
  products: string[];
  published: string;
  tags: string[];
  summary: string;
  url: string | null;
  cve_id: string | null;
  cvss_score: number | null;
  local_score: number | null;
  epss_score: number | null;
  exploit_maturity: ExploitMaturity;
  fetched_at?: string;
  explanation?: Explanation;
}

export interface TimelineEvent {
  type: "published" | "poc" | "weaponized" | "kev" | "advisory" | "mention";
  label: string;
  date: string;
  source: string;
  title: string;
  url: string | null;
  severity: Severity;
}

export interface Timeline {
  cve_id: string;
  found: boolean;
  events: TimelineEvent[];
  days_to_poc: number | null;
  days_to_kev: number | null;
  cvss_score: number | null;
  epss_score: number | null;
  verdict: string;
}
export interface Stats {
  critical_threats: number;
  active_exploits: number;
  new_cve_24h: number;
  ua_alerts: number;
  high_epss_risk: number;
  risk_label?: string;
  top_vendors: { vendor: string; count: number }[];
  by_source: { source: string; count: number }[];
  by_country: { country: string; count: number }[];
  ddos_origins: { country: string; code: string; value: number; layer: string }[];
  ddos_targets: { country: string; code: string; value: number; layer: string }[];
  by_actor: { actor: string; sponsor: string; country: string; count: number; is_fallback?: boolean }[];
  by_sponsor: { sponsor: string; count: number }[];
  severity_breakdown?: { severity: string; count: number; pct?: number }[];
  exploit_breakdown?: { maturity: string; count: number; pct?: number }[];
  total_threats: number;
  last_update: string | null;
}

// ===== DDoS-статистика Cloudflare Radar =====
export type DdosLayer = "layer3" | "layer7";

export interface DdosMetric {
  scope: string;
  metric_type: string;
  captured_at: string;
  source: string;
  license: string;
  view: DdosView;
}

export type DdosView =
  | { kind: "vector" | "share"; labels: { name: string; value: number }[]; updated: string }
  | { kind?: never; points: { date: string; value: number }[]; updated: string }
  | { kind?: never; items: { country: string; code: string; value: number }[]; origin: boolean; updated: string };

export interface DdosLayerStats {
  layer: DdosLayer;
  metrics: Record<string, DdosMetric>;
  missing: string[];
}

export interface DdosStats {
  region: string;
  layer3: DdosLayerStats;
  layer7: DdosLayerStats;
}

