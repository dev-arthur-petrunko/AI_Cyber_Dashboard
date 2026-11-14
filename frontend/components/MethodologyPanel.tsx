"use client";

import { useState } from "react";
import { useTranslation } from "./LanguageContext";

type Item = { title: string; text: string };

const LABELS: Record<string, string> = {
  uk: "Як рахуються метрики",
  en: "How metrics are calculated",
  pl: "Jak liczone są metryki",
  fr: "Comment les métriques sont calculées",
  de: "Wie die Metriken berechnet werden",
};

const ITEMS: Record<string, Item[]> = {
  uk: [
    {
      title: "Severity (критичність)",
      text: "Визначається за ключовими словами в заголовку/тегах: Critical → High → Medium → Low → Unknown. Якщо запис має офіційний CVSS — використовується він. Якщо ні — наші ключові слова (CRITICAL_KEYWORDS, HIGH_KEYWORDS тощо). Теги з джерела (BSI: kritisch/hoch/mittel) мають пріоритет над текстовим скануванням.",
    },
    {
      title: "CVSS vs Власна оцінка (local_score)",
      text: 'Коли джерело надало CVSS — показується як «CVSS: X.X». Коли ні — рахується власна оцінка (0–10) за формулою: база severity + bonus за exploit_maturity + EPSS × 2.0 + keyword bonus. Позначається як «internal». Ключові слова НЕ враховуються повторно: якщо "critical" вже визначив severity=Critical, бонус +0.6 за нього НЕ нараховується.',
    },
    {
      title: "EPSS (ймовірність експлуатації)",
      text: "EPSS оновлюється тільки для записів, де score ще NULL. Один раз записаний EPSS не перераховується — може бути застарілим на тижні/місяці. EPSS × 2.0 додається до local_score як максимум +2.0.",
    },
    {
      title: "Score clamp (обмеження)",
      text: "Raw score нормалізується sigmoid-подібною функцією для значень > 8.0, щоб верхній діапазон залишався розрізним: raw 10.0 → 9.3, raw 12.0 → 9.7. Замість лінійного clamp(min(10)), який робив Critical+In the wild+EPSS 0.6 і Critical+In the wild+EPSS 0.99 неотличимими.",
    },
    {
      title: "Географія країн",
      text: "by_country агрегує ВСІ записи (без фільтра region) і шукає країни в: (1) поле country, (2) тегах, (3) перших 300 символах summary. ISO2-коди нормалізуються (CN→China, RU→Russia). Одна загроза може стосуватися кількох країн — сума згадувань > кількості записів.",
    },
    {
      title: "DDoS (Cloudflare Radar)",
      text: "Дані завжди глобальні — Cloudflare Radar не підтримує фільтр за країною-запитом. Layer 7 країни-цілі також глобальні. Series часу та Layer 3 фільтруються за scope.",
    },
    {
      title: "Vendor",
      text: "Витягується з заголовка/тегів/продуктів за словником VENDOR_KEYWORDS. Графік показує топ-8 вендорів; «Інше / не визначено» = записи без розпізнаного вендора плюс вендори поза топ-8, тому сума стовпців завжди дорівнює total.",
    },
    {
      title: "ActorSankey (групи-актори → країни)",
      text: "Суцільні лінії = країна взята з запису (пряме підтвердження). Пунктирні = типова ціль групи з ACTOR_TARGETS (немає прямого підтвердження в записі).",
    },
  ],
  en: [
    {
      title: "Severity",
      text: "Determined by keywords in title/tags: Critical → High → Medium → Low → Unknown. Official CVSS overrides keywords. Feed tags (BSI: kritisch/hoch/mittel) have priority over text scanning.",
    },
    {
      title: "CVSS vs Internal Score",
      text: 'When source provides CVSS, it\'s shown as "CVSS: X.X". Otherwise an internal score (0–10) is computed: severity base + exploit_maturity + EPSS×2.0 + keyword bonus. Keywords used for severity inference are NOT double-counted.',
    },
    {
      title: "EPSS",
      text: "EPSS is only enriched for NULL values and never recalculated — may be stale by weeks/months. EPSS × 2.0 adds up to +2.0 to local_score.",
    },
    {
      title: "Score normalization",
      text: "Raw score uses sigmoid-like compression above 8.0 to preserve discrimination: raw 10.0 → 9.3, raw 12.0 → 9.7. Replaces linear clamp(min(10)) that made high scores indistinguishable.",
    },
    {
      title: "Country geography",
      text: "by_country aggregates ALL records (no region filter) and searches for countries in: (1) country field, (2) tags, (3) first 300 chars of summary. ISO2 codes normalized. One threat may relate to multiple countries.",
    },
    {
      title: "DDoS (Cloudflare Radar)",
      text: "Data is always global — Cloudflare Radar does not support country-scoped queries. Layer 7 target countries are also global.",
    },
    {
      title: "Vendor",
      text: "Extracted from title/tags/products via VENDOR_KEYWORDS dictionary. Records without recognized vendor shown as \"Other / unrecognized\" in chart.",
    },
    {
      title: "ActorSankey",
      text: "Solid lines = country from record data (confirmed). Dashed lines = typical group target from ACTOR_TARGETS (no direct confirmation in record).",
    },
  ],
  pl: [
    {
      title: "Severity (ważność)",
      text: "Określana na podstawie słów kluczowych w tytule/tagach: Critical → High → Medium → Low → Unknown. Jeśli rekord ma oficjalny CVSS — używany jest on. Jeśli nie — nasze słowa kluczowe (CRITICAL_KEYWORDS, HIGH_KEYWORDS itp.). Tagi ze źródła (BSI: kritisch/hoch/mittel) mają priorytet nad skanowaniem tekstu.",
    },
    {
      title: "CVSS vs ocena własna (local_score)",
      text: 'Gdy źródło podało CVSS — wyświetlane jako «CVSS: X.X». Gdy nie — liczona jest ocena własna (0–10) wg wzoru: baza severity + bonus za exploit_maturity + EPSS × 2.0 + bonus za słowa kluczowe. Oznaczana jako «internal». Słowa kluczowe NIE są liczone podwójnie: jeśli "critical" już ustalił severity=Critical, bonus +0.6 za niego NIE jest naliczany.',
    },
    {
      title: "EPSS (prawdopodobieństwo eksploatacji)",
      text: "EPSS jest wzbogacany tylko dla rekordów, gdzie score jest jeszcze NULL. Raz zapisany EPSS nie jest przeliczany — może być nieaktualny o tygodnie/miesiące. EPSS × 2.0 dodaje do local_score maksymalnie +2.0.",
    },
    {
      title: "Normalizacja wyniku (clamp)",
      text: "Raw score jest normalizowany funkcją w stylu sigmoid dla wartości > 8.0, aby górny zakres pozostał rozróżnialny: raw 10.0 → 9.3, raw 12.0 → 9.7. Zamiast liniowego clamp(min(10)), który czynił Critical+In the wild+EPSS 0.6 i Critical+In the wild+EPSS 0.99 nieodróżnialnymi.",
    },
    {
      title: "Geografia krajów",
      text: "by_country agreguje WSZYSTKIE rekordy (bez filtra region) i szuka krajów w: (1) polu country, (2) tagach, (3) pierwszych 300 znakach summary. Kody ISO2 są normalizowane (CN→China, RU→Russia). Jedno zagrożenie może dotyczyć kilku krajów — suma wzmianek > liczby rekordów.",
    },
    {
      title: "DDoS (Cloudflare Radar)",
      text: "Dane są zawsze globalne — Cloudflare Radar nie obsługuje zapytań ograniczonych do kraju. Kraje-celowe Layer 7 również są globalne.",
    },
    {
      title: "Vendor",
      text: "Wyciągany z tytułu/tagów/produktów za pomocą słownika VENDOR_KEYWORDS. Wykres pokazuje top-8 dostawców; «Inne / nieokreślone» = rekordy bez rozpoznanego dostawcy plus dostawcy poza top-8, więc suma zawsze zgadza się z total.",
    },
    {
      title: "ActorSankey (grupy-aktorzy → kraje)",
      text: "Linie ciągłe = kraj z danych rekordu (potwierdzone). Linie przerywane = typowy cel grupy z ACTOR_TARGETS (brak bezpośredniego potwierdzenia w rekordzie).",
    },
  ],
  fr: [
    {
      title: "Severity (gravité)",
      text: "Déterminée par les mots-clés dans le titre/tags : Critical → High → Medium → Low → Unknown. Si l'enregistrement a un CVSS officiel, il est utilisé. Sinon, nos mots-clés (CRITICAL_KEYWORDS, HIGH_KEYWORDS, etc.). Les tags de la source (BSI : kritisch/hoch/mittel) ont priorité sur l'analyse du texte.",
    },
    {
      title: "CVSS vs score interne (local_score)",
      text: 'Quand la source fournit un CVSS, il est affiché comme « CVSS : X.X ». Sinon un score interne (0–10) est calculé : base severity + bonus exploit_maturity + EPSS × 2.0 + bonus mots-clés. Marquée « internal ». Les mots-clés ne sont PAS comptés deux fois : si "critical" a déjà défini severity=Critical, le bonus +0.6 n\'est pas appliqué.',
    },
    {
      title: "EPSS (probabilité d'exploitation)",
      text: "EPSS n'est enrichi que pour les enregistrements dont le score est encore NULL. Une fois enregistré, EPSS n'est jamais recalculé — il peut être obsolète de semaines/mois. EPSS × 2.0 ajoute jusqu'à +2.0 au local_score.",
    },
    {
      title: "Normalisation du score (clamp)",
      text: "Le score brut est normalisé par une fonction de type sigmoïde pour les valeurs > 8.0, afin que la tranche haute reste discernable : raw 10.0 → 9.3, raw 12.0 → 9.7. Au lieu du clamp linéaire min(10) qui rendait Critical+In the wild+EPSS 0.6 et Critical+In the wild+EPSS 0.99 indistinguables.",
    },
    {
      title: "Géographie des pays",
      text: "by_country agrège TOUS les enregistrements (sans filtre de région) et cherche les pays dans : (1) le champ country, (2) les tags, (3) les 300 premiers caractères du résumé. Les codes ISO2 sont normalisés (CN→China, RU→Russia). Une menace peut concerner plusieurs pays — la somme des mentions > nombre d'enregistrements.",
    },
    {
      title: "DDoS (Cloudflare Radar)",
      text: "Les données sont toujours globales — Cloudflare Radar ne prend pas en charge les requêtes limitées à un pays. Les pays cibles Layer 7 sont aussi globaux.",
    },
    {
      title: "Vendor",
      text: "Extrait du titre/tags/produits via le dictionnaire VENDOR_KEYWORDS. Le graphique affiche le top-8 des fournisseurs ; « Autres / non reconnu » = enregistrements sans fournisseur reconnu plus les fournisseurs hors top-8, donc la somme correspond toujours au total.",
    },
    {
      title: "ActorSankey (groupes d'acteurs → pays)",
      text: "Lignes pleines = pays issu des données de l'enregistrement (confirmé). Lignes pointillées = cible type du groupe d'après ACTOR_TARGETS (pas de confirmation directe dans l'enregistrement).",
    },
  ],
  de: [
    {
      title: "Severity (Schweregrad)",
      text: "Wird anhand von Schlüsselwörtern im Titel/Tags bestimmt: Critical → High → Medium → Low → Unknown. Wenn ein Datensatz einen offiziellen CVSS hat, wird dieser verwendet. Sonst unsere Schlüsselwörter (CRITICAL_KEYWORDS, HIGH_KEYWORDS usw.). Quell-Tags (BSI: kritisch/hoch/mittel) haben Vorrang vor dem Textscan.",
    },
    {
      title: "CVSS vs. interner Score (local_score)",
      text: 'Wenn die Quelle einen CVSS liefert, wird er als «CVSS: X.X» angezeigt. Sonst wird ein interner Score (0–10) berechnet: Severity-Basis + exploit_maturity-Bonus + EPSS × 2.0 + Schlüsselwort-Bonus. Als «internal» markiert. Schlüsselwörter werden NICHT doppelt gezählt: Wenn "critical" bereits severity=Critical bestimmt hat, wird der Bonus +0.6 dafür NICHT angewendet.',
    },
    {
      title: "EPSS (Exploitationswahrscheinlichkeit)",
      text: "EPSS wird nur für Datensätze angereichert, deren Score noch NULL ist. Einmal gespeichert wird EPSS nie neu berechnet — kann um Wochen/Monate veraltet sein. EPSS × 2.0 addiert maximal +2.0 zum local_score.",
    },
    {
      title: "Score-Normalisierung (clamp)",
      text: "Der Rohscore wird für Werte > 8,0 über eine sigmoid-ähnliche Funktion normalisiert, damit der obere Bereich unterscheidbar bleibt: raw 10.0 → 9.3, raw 12.0 → 9.7. Statt des linearen clamp(min(10)), der Critical+In the wild+EPSS 0.6 und Critical+In the wild+EPSS 0.99 ununterscheidbar machte.",
    },
    {
      title: "Geografie der Länder",
      text: "by_country aggregiert ALLE Datensätze (ohne Regionsfilter) und sucht Länder in: (1) Feld country, (2) Tags, (3) den ersten 300 Zeichen der Zusammenfassung. ISO2-Codes werden normalisiert (CN→China, RU→Russia). Eine Bedrohung kann mehrere Länder betreffen — die Summe der Erwähnungen > Anzahl der Datensätze.",
    },
    {
      title: "DDoS (Cloudflare Radar)",
      text: "Die Daten sind immer global — Cloudflare Radar unterstützt keine länderspezifischen Abfragen. Die Layer-7-Zielländer sind ebenfalls global.",
    },
    {
      title: "Vendor",
      text: "Wird aus Titel/Tags/Produkten über das VENDOR_KEYWORDS-Wörterbuch extrahiert. Das Diagramm zeigt die Top-8-Anbieter; «Andere / unerkannt» = Datensätze ohne erkannten Anbieter plus Anbieter außerhalb der Top-8, sodass die Summe immer dem Total entspricht.",
    },
    {
      title: "ActorSankey (Akteursgruppen → Länder)",
      text: "Durchgezogene Linien = Land aus den Datensatzdaten (bestätigt). Gestrichelte Linien = typisches Gruppenziel aus ACTOR_TARGETS (keine direkte Bestätigung im Datensatz).",
    },
  ],
};

export function MethodologyPanel() {
  const [open, setOpen] = useState(false);
  const { lang } = useTranslation();
  const items = ITEMS[lang] ?? ITEMS.en;
  const label = LABELS[lang] ?? LABELS.en;

  return (
    <div className="animate-fade-in-up glass-card rounded-xl border border-border shadow-sm overflow-hidden" style={{ animationDelay: "340ms" }}>
      <button
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-panel-raised sm:px-5 sm:py-4"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-text-secondary transition-colors group-hover:text-signal">
          <svg className="h-4 w-4 text-info" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {label}
        </span>
        <svg className={`h-4 w-4 text-text-muted transition-transform duration-300 ${open ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 sm:px-5">
          <div className="space-y-3">
            {items.map((item, i) => (
              <div key={i}>
                <h4 className="text-xs font-bold uppercase tracking-wider text-signal">{item.title}</h4>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary sm:text-xs">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
