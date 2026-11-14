"use client";

// Спільна геометрія світу для карт-планет (DdosMap, ThreatMap).
// Джерело: world-atlas/countries-110m.json (Natural Earth 110m, id = ISO-numeric).
// Містить фікс приєднання Криму до України (804): у даних NE Крим
// є окремим полігоном Росії (643) — переносимо його за центроїдом.

import { feature } from "topojson-client";
import worldTopo from "world-atlas/countries-110m.json";

/* ISO 3166-1 numeric → ISO2 (world-atlas зберігає id як numeric-рядок) */
export const NUMERIC_TO_ISO2: Record<string, string> = {
  "004": "AF", "008": "AL", "012": "DZ", "024": "AO", "031": "AZ",
  "032": "AR", "036": "AU", "040": "AT", "044": "BS", "048": "BH",
  "050": "BD", "051": "AM", "052": "BB", "056": "BE", "064": "BT",
  "068": "BO", "070": "BA", "076": "BR", "084": "BZ", "090": "SB",
  "096": "BN", "100": "BG", "104": "MM", "108": "BI", "112": "BY",
  "116": "KH", "120": "CM", "124": "CA", "140": "CF", "148": "TD",
  "152": "CL", "156": "CN", "158": "TW", "170": "CO", "178": "CG",
  "180": "CD", "188": "CR", "191": "HR", "192": "CU", "203": "CZ",
  "204": "BJ", "208": "DK", "214": "DO", "218": "EC", "222": "SV",
  "226": "GQ", "231": "ET", "232": "ER", "233": "EE", "242": "FJ",
  "246": "FI", "250": "FR", "260": "TF", "262": "DJ", "266": "GA",
  "268": "GE", "270": "GM", "275": "PS", "276": "DE", "288": "GH",
  "292": "GI", "300": "GR", "304": "GL", "320": "GT", "324": "GN",
  "328": "GY", "332": "HT", "340": "HN", "344": "HK", "348": "HU",
  "352": "IS", "356": "IN", "360": "ID", "364": "IR", "368": "IQ",
  "372": "IE", "376": "IL", "380": "IT", "384": "CI", "388": "JM",
  "392": "JP", "398": "KZ", "400": "JO", "404": "KE", "408": "KP",
  "410": "KR", "414": "KW", "417": "KG", "418": "LA", "422": "LB",
  "426": "LS", "428": "LV", "430": "LR", "434": "LY", "440": "LT",
  "442": "LU", "450": "MG", "454": "MW", "458": "MY", "466": "ML",
  "478": "MR", "484": "MX", "496": "MN", "498": "MD", "499": "ME",
  "504": "MA", "508": "MZ", "512": "OM", "516": "NA", "524": "NP",
  "528": "NL", "540": "NC", "554": "NZ", "558": "NI", "562": "NE",
  "566": "NG", "578": "NO", "583": "FM", "586": "PK", "591": "PA",
  "598": "PG", "600": "PY", "604": "PE", "608": "PH", "616": "PL",
  "620": "PT", "624": "GW", "626": "TL", "630": "PR", "634": "QA",
  "642": "RO", "643": "RU", "646": "RW", "682": "SA", "686": "SN",
  "688": "RS", "694": "SL", "702": "SG", "703": "SK", "704": "VN",
  "705": "SI", "706": "SO", "710": "ZA", "716": "ZW", "724": "ES",
  "728": "SS", "729": "SD", "740": "SR", "748": "SZ", "752": "SE",
  "756": "CH", "760": "SY", "762": "TJ", "764": "TH", "768": "TG",
  "776": "TO", "780": "TT", "784": "AE", "788": "TN", "792": "TR",
  "795": "TM", "800": "UG", "804": "UA", "807": "MK", "818": "EG",
  "826": "GB", "834": "TZ", "840": "US", "854": "BF", "858": "UY",
  "860": "UZ", "862": "VE", "882": "WS", "887": "YE", "894": "ZM",
  "383": "XK",
};

/* Приблизні центроїди країн для маркерів/дуг [lat, lng] */
export const CENTROIDS: Record<string, [number, number]> = {
  US: [39, -98], CA: [56, -106], MX: [23, -102], BR: [-10, -52],
  AR: [-34, -64], CL: [-33, -71], CO: [4, -73], PE: [-9, -75],
  GB: [54, -2], FR: [46, 2], DE: [51, 10], NL: [52.2, 5.3],
  ES: [40, -3], IT: [42.8, 12.5], PL: [52, 19], SE: [62, 15],
  NO: [61, 9], FI: [64, 26], DK: [56, 10], CH: [46.8, 8.2],
  AT: [47.5, 14.5], PT: [39.5, -8], IE: [53, -8], GR: [39, 22],
  RO: [46, 25], CZ: [49.8, 15.5], HU: [47, 19], BG: [43, 25],
  UA: [49, 32], BY: [53, 28], RU: [61, 90], MD: [47, 28.5],
  RS: [44, 21], HR: [45.2, 16.4], SK: [48.7, 19.5], LT: [55.3, 23.9],
  LV: [56.9, 24.9], EE: [58.7, 25.5], CN: [35, 104], JP: [36, 138],
  KR: [36.5, 127.8], IN: [21, 78], ID: [-2, 118], SG: [1.35, 103.8],
  MY: [4, 102], VN: [16, 106], TH: [15, 101], PH: [12, 122],
  TW: [23.7, 121], HK: [22.3, 114.2], KZ: [48, 68], UZ: [41, 64],
  BD: [24, 90], LK: [7, 81], NP: [28, 84], PK: [30, 69],
  TR: [39, 35], IL: [31.4, 34.9], AE: [24, 54], SA: [24, 45],
  QA: [25.3, 51.2], EG: [26, 30], IQ: [33, 43], IR: [32, 53],
  LB: [33.9, 35.9], SY: [35, 38], JO: [31, 36], ZA: [-29, 24],
  NG: [9.6, 7.9], KE: [0.5, 37.8], MA: [31.8, -7], DZ: [28, 2.6],
  TN: [34, 9], AU: [-25, 134], NZ: [-42, 172], AF: [33.9, 67.7],
};

/* Вікно центроїда півострова Крим (empirично для NE 110m: ≈ [34.31, 45.49]).
   Сусідній Таманський півострів (~37°E) у вікно не потрапляє. */
const CRIMEA_BOX = { minLon: 32.5, maxLon: 36.2, minLat: 44.3, maxLat: 46.3 };

type LL = [number, number];
type Ring = LL[];
type Poly = Ring[];

function ringCentroid(ring: Ring): LL {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / Math.max(1, ring.length), y / Math.max(1, ring.length)];
}

function geomPolys(geom: any): Poly[] | null {
  if (geom?.type === "Polygon") return [geom.coordinates as Poly];
  if (geom?.type === "MultiPolygon") return geom.coordinates as Poly[];
  return null;
}

/**
 * Переносить кримський полігон з Росії (643) до України (804),
 * якщо він ще там знаходиться. Ідемпотентно: якщо дані вже
 * містять Крим у складі України — нічого не робить.
 */
function fixCrimea(features: any[]): void {
  const byId = new Map<string, any>();
  for (const f of features) byId.set(String(f.id ?? "").padStart(3, "0"), f);
  const ru = byId.get("643");
  const ua = byId.get("804");
  if (!ru || !ua) return;

  const ruPolys = geomPolys(ru.geometry);
  if (!ruPolys) return;

  const moved: Poly[] = [];
  const kept = ruPolys.filter((poly) => {
    const [lon, lat] = ringCentroid(poly[0]);
    const inCrimea =
      lon >= CRIMEA_BOX.minLon && lon <= CRIMEA_BOX.maxLon &&
      lat >= CRIMEA_BOX.minLat && lat <= CRIMEA_BOX.maxLat;
    if (inCrimea) moved.push(poly);
    return !inCrimea;
  });
  if (!moved.length) return;

  ru.geometry = { type: "MultiPolygon", coordinates: kept };

  const uaPolys = geomPolys(ua.geometry);
  if (!uaPolys) return;
  ua.geometry = { type: "MultiPolygon", coordinates: [...uaPolys, ...moved] };
}

export type CountryFeature = { f: any; iso2: string };

let _cache: CountryFeature[] | null = null;

/** FeatureCollection світу з фіксом Криму (мемоізовано на модуль). */
export function countryFeatures(): CountryFeature[] {
  if (_cache) return _cache;
  const fc = feature(worldTopo as any, (worldTopo as any).objects.countries) as any;
  const feats = fc.features as any[];
  fixCrimea(feats);
  _cache = feats.map((f) => ({
    f,
    iso2: NUMERIC_TO_ISO2[String(f.id ?? "").padStart(3, "0")] ?? "",
  }));
  return _cache;
}

/* Детермінований PRNG для зірок/декору (SSR/CSR збігаються) */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
