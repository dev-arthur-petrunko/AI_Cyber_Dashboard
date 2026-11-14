"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "./LanguageContext";
import { countryName } from "@/lib/countries";

export interface ActorLink {
  actor: string;
  country: string;
  count: number;
  is_fallback?: boolean;
}

interface Node {
  name: string;
  value: number;
  label: string;
  column: "left" | "right";
  y: number;
  height: number;
}

interface Edge {
  a: string;
  c: string;
  value: number;
  y1: number;
  y2: number;
  isFallback: boolean;
}

const NODE_WIDTH = 14;
const GAP = 10;
const PAD_Y = 10;
const CHART_WIDTH = 1150;
const LEFT_LABEL_X = 28;
const RIGHT_LABEL_X = CHART_WIDTH - 28;
const MAX_LEFT_NODES = 20;
const MAX_RIGHT_NODES = 10;
const NODE_MIN_H = 6;
const NODE_MAX_H = 26;
const OTHERS_LEFT = "__others_left__";
const OTHERS_RIGHT = "__others_right__";

// Ч/б: актори различаются оттенками серого (светлый → тёмный), не цветом
const ACTOR_COLORS = [
  "#F5F5F5",
  "#D4D4D4",
  "#A3A3A3",
  "#8A8A8A",
  "#6B6B6B",
  "#525252",
  "#404040",
];

const COLOR_BY_ACTOR: Record<string, string> = {};

function actorColor(actor: string): string {
  if (!(actor in COLOR_BY_ACTOR)) {
    COLOR_BY_ACTOR[actor] = ACTOR_COLORS[Object.keys(COLOR_BY_ACTOR).length % ACTOR_COLORS.length];
  }
  return COLOR_BY_ACTOR[actor];
}

/** ISO-2 → емодзі-прапорець («UA» → 🇺🇦). */
function isoToFlag(iso: string): string {
  if (!/^[A-Z]{2}$/.test(iso)) return "";
  return String.fromCodePoint(...[...iso].map((ch) => 127397 + ch.charCodeAt(0)));
}

function truncate(name: string, max = 24): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

function buildLayout(links: ActorLink[], othersLabel: string): { nodes: Node[]; edges: Edge[]; height: number } {
  if (!links.length) return { nodes: [], edges: [], height: 100 };

  const leftMap = new Map<string, number>();
  const rightMap = new Map<string, number>();
  const pairValue = new Map<string, number>();
  const pairFallback = new Map<string, boolean>();

  for (const { actor, country, count, is_fallback } of links) {
    leftMap.set(actor, (leftMap.get(actor) ?? 0) + count);
    rightMap.set(country, (rightMap.get(country) ?? 0) + count);
    const key = `${actor}\u0000${country}`;
    pairValue.set(key, (pairValue.get(key) ?? 0) + count);
    // is_fallback is only true if ALL counts for this pair come from fallback
    if (is_fallback && !pairFallback.has(key)) pairFallback.set(key, true);
    if (!is_fallback) pairFallback.set(key, false);
  }

  // Топ-N акторів, решту зливаємо в «Інші групи»
  const leftSorted = Array.from(leftMap.entries()).sort((a, b) => b[1] - a[1]);
  const topLeft = leftSorted.slice(0, MAX_LEFT_NODES);
  const leftOthers = leftSorted.slice(MAX_LEFT_NODES);
  if (leftOthers.length) {
    const sum = leftOthers.reduce((acc, [, v]) => acc + v, 0);
    topLeft.push([OTHERS_LEFT, sum]);
  }

  const rightSorted = Array.from(rightMap.entries()).sort((a, b) => b[1] - a[1]);
  const topRight = rightSorted.slice(0, MAX_RIGHT_NODES);
  const rightOthers = rightSorted.slice(MAX_RIGHT_NODES);
  if (rightOthers.length) {
    const sum = rightOthers.reduce((acc, [, v]) => acc + v, 0);
    topRight.push([OTHERS_RIGHT, sum]);
  }

  const leftTotal = topLeft.reduce((acc, [, v]) => acc + v, 0) || 1;
  const rightTotal = topRight.reduce((acc, [, v]) => acc + v, 0) || 1;

  const layoutColumn = (
    entries: [string, number][],
    total: number,
    column: "left" | "right",
    labelResolver: (name: string) => string
  ): { nodes: Node[]; height: number } => {
    const nodes: Node[] = entries.map(([name, value]) => {
      const isOthers = name === OTHERS_LEFT || name === OTHERS_RIGHT;
      const height = Math.max(NODE_MIN_H, Math.min(NODE_MAX_H, (value / total) * NODE_MAX_H));
      return {
        name,
        value,
        label: isOthers ? `${othersLabel} (${value})` : labelResolver(name),
        column,
        y: 0,
        height,
      };
    });
    const stackHeight = nodes.reduce((acc, n) => acc + n.height, 0);
    const gaps = (nodes.length - 1) * GAP;
    const height = Math.max(80, stackHeight + gaps + PAD_Y * 2);
    const extraGap = nodes.length > 1 ? Math.max(0, (height - PAD_Y * 2 - stackHeight - gaps) / (nodes.length - 1)) : 0;
    let y = PAD_Y;
    for (const n of nodes) {
      n.y = y;
      y += n.height + GAP + extraGap;
    }
    return { nodes, height };
  };

  const left = layoutColumn(topLeft, leftTotal, "left", (name) => name);
  const right = layoutColumn(topRight, rightTotal, "right", (name) => name);
  const height = Math.max(left.height, right.height);

  const centerLeft = (height - left.height) / 2;
  const centerRight = (height - right.height) / 2;
  for (const n of left.nodes) n.y += centerLeft;
  for (const n of right.nodes) n.y += centerRight;

  const leftNodeMap = new Map(left.nodes.map((n) => [n.name, n]));
  const rightNodeMap = new Map(right.nodes.map((n) => [n.name, n]));
  const leftOthersNames = new Set(leftOthers.map(([name]) => name));
  const rightOthersNames = new Set(rightOthers.map(([name]) => name));

  const edges: Edge[] = [];
  for (const [key, value] of pairValue) {
    const [actor, country] = key.split("\u0000");
    const lName = leftNodeMap.has(actor) ? actor : leftOthersNames.has(actor) ? OTHERS_LEFT : null;
    const rName = rightNodeMap.has(country) ? country : rightOthersNames.has(country) ? OTHERS_RIGHT : null;
    if (!lName || !rName) continue;
    const ln = leftNodeMap.get(lName)!;
    const rn = rightNodeMap.get(rName)!;
    const leftShare = value / ln.value;
    const rightShare = value / rn.value;
    edges.push({
      a: lName,
      c: rName,
      value,
      y1: ln.y + ln.height * (1 - leftShare) + (ln.height * leftShare) / 2,
      y2: rn.y + rn.height * (1 - rightShare) + (rn.height * rightShare) / 2,
      isFallback: pairFallback.get(key) ?? false,
    });
  }

  return { nodes: [...left.nodes, ...right.nodes], edges, height };
}

function LinkPath(x1: number, x2: number, y1: number, y2: number) {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export function ActorSankey({ links }: { links: ActorLink[] }) {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const countryNames = t.map.countries as Record<string, string>;
  const [hovered, setHovered] = useState<string | null>(null);
  const othersLabel =
    lang === "uk" ? "Інші" : lang === "pl" ? "Inne" : lang === "fr" ? "Autres" : lang === "de" ? "Andere" : "Others";
  const { nodes, edges, height } = useMemo(() => buildLayout(links, othersLabel), [links, othersLabel]);

  // Сусіди активного вузла — щоб підсвічувати лише пов'язане
  const activeNames = useMemo(() => {
    if (!hovered) return null;
    const s = new Set<string>([hovered]);
    for (const e of edges) {
      if (e.a === hovered) s.add(e.c);
      if (e.c === hovered) s.add(e.a);
    }
    return s;
  }, [hovered, edges]);

  if (links.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-text-muted">{t.sections.noThreats}</p>
      </div>
    );
  }

  const leftNodes = nodes.filter((n) => n.column === "left");
  const rightNodes = nodes.filter((n) => n.column === "right");
  const maxValue = Math.max(1, ...leftNodes.map((n) => n.value));

  const edgeDim = (e: Edge) => (activeNames ? !(activeNames.has(e.a) && activeNames.has(e.c)) : false);
  const nodeDim = (name: string) => (activeNames ? !activeNames.has(name) : false);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={t.sections.actorTracker}
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHovered(null)}
      >
        {/* Зв'язки */}
        {edges.map((e, i) => {
          const dim = edgeDim(e);
          return (
            <path
              key={i}
              d={LinkPath(NODE_WIDTH + 2, CHART_WIDTH - NODE_WIDTH - 2, e.y1, e.y2)}
              fill="none"
              stroke={actorColor(e.a)}
              strokeOpacity={dim ? 0.06 : hovered ? 0.85 : 0.38}
              strokeWidth={Math.max(1.5, Math.min(11, 2 + (e.value / maxValue) * 9))}
              strokeLinecap="round"
              strokeDasharray={e.isFallback ? "6 4" : undefined}
              style={{ transition: "stroke-opacity 180ms ease" }}
            />
          );
        })}

        {/* Вузли: актори (ліворуч) — клік відкриває «Базу записів» з фільтром */}
        {leftNodes.map((n) => {
          const dim = nodeDim(n.name);
          const isOthers = n.name === OTHERS_LEFT;
          return (
            <g
              key={n.name}
              className={isOthers ? "" : "cursor-pointer"}
              style={{ opacity: dim ? 0.3 : 1, transition: "opacity 180ms ease" }}
              onMouseEnter={() => setHovered(n.name)}
              onClick={
                isOthers
                  ? undefined
                  : () => router.push(`/records?actor=${encodeURIComponent(n.name)}`)
              }
            >
              <title>
                {isOthers
                  ? n.label
                  : `${n.label} (${n.value}) → ${lang === "uk" ? "База записів" : lang === "de" ? "Eintragsdatenbank" : lang === "pl" ? "Baza rekordów" : lang === "fr" ? "Base des enregistrements" : "Records database"}`}
              </title>
              <rect
                x={0}
                y={n.y}
                width={NODE_WIDTH}
                height={n.height}
                rx={3}
                fill={actorColor(n.name)}
                fillOpacity={0.92}
                stroke="#FFFFFF"
                strokeOpacity={0.22}
              />
              <text
                x={LEFT_LABEL_X}
                y={n.y + n.height / 2}
                dominantBaseline="middle"
                fontSize={12}
                fontWeight={600}
                fill="var(--text-primary)"
                stroke="var(--sankey-halo)"
                strokeWidth={3.5}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {truncate(n.label)}
                {!isOthers && (
                  <tspan fontWeight={400} fontSize={10.5} fill="var(--text-muted)" dx={5}>
                    {n.value}
                  </tspan>
                )}
              </text>
            </g>
          );
        })}

        {/* Вузли: країни (праворуч) */}
        {rightNodes.map((n) => {
          const dim = nodeDim(n.name);
          const isOthers = n.name === OTHERS_RIGHT;
          const flag = isOthers ? "" : isoToFlag(n.name);
          const label = isOthers
            ? n.label
            : `${flag ? `${flag} ` : ""}${countryName(n.name, countryNames)} (${n.value})`;
          return (
            <g
              key={n.name}
              style={{ opacity: dim ? 0.3 : 1, transition: "opacity 180ms ease" }}
              onMouseEnter={() => setHovered(n.name)}
            >
              <rect
                x={CHART_WIDTH - NODE_WIDTH}
                y={n.y}
                width={NODE_WIDTH}
                height={n.height}
                rx={3}
                fill="#F5F5F5"
                fillOpacity={0.92}
                stroke="#FFFFFF"
                strokeOpacity={0.22}
              />
              <text
                x={RIGHT_LABEL_X}
                y={n.y + n.height / 2}
                dominantBaseline="middle"
                fontSize={12}
                fontWeight={600}
                textAnchor="end"
                fill="var(--text-primary)"
                stroke="var(--sankey-halo)"
                strokeWidth={3.5}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {truncate(label, 28)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Легенда: пунктир = fallback */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border bg-panel px-3 py-2 text-[11px] text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <svg width="24" height="2"><line x1="0" y1="1" x2="24" y2="1" stroke="currentColor" strokeWidth="2" /></svg>
          {lang === "uk" ? "Підтверджений зв'язок (запис містить країну)" : lang === "de" ? "Bestätigte Verbindung" : "Confirmed link"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="24" height="2"><line x1="0" y1="1" x2="24" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" /></svg>
          {lang === "uk" ? "Типова ціль групи (немає прямого підтвердження)" : lang === "de" ? "Typisches Ziel (kein direkter Nachweis)" : "Typical target (no direct confirmation)"}
        </span>
      </div>
    </div>
  );
}
