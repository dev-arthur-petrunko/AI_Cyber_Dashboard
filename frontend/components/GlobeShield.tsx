"use client";

/**
 * GlobeShield — анімована планета з орбітою та щитом кібербезу.
 * Замінює перемикач Україна/Світ: сайт тепер глобальний,
 * а цей віджет позначає глобальне охоплення моніторингу.
 * Чиста SVG + CSS-анімація, без зовнішніх залежностей.
 */
export function GlobeShield() {
  return (
    <span
      className="group relative inline-flex h-9 w-9 items-center justify-center sm:h-10 sm:w-10"
      title="Global cyber threat monitoring"
      aria-hidden
    >
      {/* М'яке світіння навколо */}
      <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/10 blur-md transition-opacity duration-500 group-hover:bg-primary/20" />

      <svg viewBox="0 0 44 44" className="h-full w-full">
        <defs>
          <radialGradient id="gs-sphere" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#E5E5E5" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#9CA3AF" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#111111" stopOpacity="0.9" />
          </radialGradient>
          <linearGradient id="gs-shield" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F5F5F5" />
            <stop offset="100%" stopColor="#9CA3AF" />
          </linearGradient>
          <clipPath id="gs-clip">
            <circle cx="19" cy="21" r="12" />
          </clipPath>
        </defs>

        {/* Орбіта зі супутником-сканером */}
        <circle cx="19" cy="21" r="16.5" fill="none" stroke="#9CA3AF" strokeOpacity="0.35" strokeDasharray="2 4" />
        <g className="globe-orbit">
          <circle cx="19" cy="4.5" r="1.5" fill="#D4D4D4" />
          <circle cx="19" cy="4.5" r="3" fill="#D4D4D4" opacity="0.25" />
        </g>

        {/* Сфера */}
        <circle cx="19" cy="21" r="12" fill="url(#gs-sphere)" stroke="#A3A3A3" strokeOpacity="0.55" strokeWidth="0.8" />

        {/* Сітка координат: широти статичні, меридіани дрейфують */}
        <g clipPath="url(#gs-clip)" stroke="#D4D4D4" strokeOpacity="0.5" fill="none" strokeWidth="0.6">
          <path d="M7 16h24M6.6 21h24.8M7 26h24" />
          <g className="globe-drift">
            <ellipse cx="10" cy="21" rx="3.6" ry="12" />
            <ellipse cx="18" cy="21" rx="3.6" ry="12" />
            <ellipse cx="26" cy="21" rx="3.6" ry="12" />
            <ellipse cx="34" cy="21" rx="3.6" ry="12" />
          </g>
        </g>

        {/* Щит кібербезу */}
        <g className="shield-pulse">
          <path
            d="M31.5 25.5l8-2.6v5.4c0 4.8-3.2 8.2-8 9.7-4.8-1.5-8-4.9-8-9.7v-5.4l8 2.6z"
            fill="url(#gs-shield)"
            fillOpacity="0.95"
            stroke="#111111"
            strokeWidth="1"
          />
          <path
            d="M28.2 31.6l2.4 2.4 4.4-4.6"
            stroke="#111111"
            strokeWidth="1.7"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </span>
  );
}
