import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageContext";
import { AgentProvider } from "@/components/agent/AgentProvider";
import { Language, translations } from "@/lib/i18n";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-sans",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-mono",
});

const LANGS: Language[] = ["uk", "en", "pl", "fr", "de"];

function getLang(): Language {
  const value = cookies().get("lang")?.value;
  return (LANGS as string[]).includes(value ?? "") ? (value as Language) : "uk";
}

export function generateMetadata(): Metadata {
  const lang = getLang();
  return {
    title: "Cyber Sentinel",
    description: translations[lang].meta.description,
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
                themeColor: "#050505",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLang();
  return (
    <html lang={lang} suppressHydrationWarning className={`${inter.variable} ${jetbrains.variable} dark`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const theme = localStorage.getItem('theme');
                  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = theme ? theme === 'dark' : true;
                document.documentElement.classList.toggle('dark', isDark);
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        {/* Фон: матовий чорний без анімацій/частинок (запит власника) */}
        <LanguageProvider>
          <AgentProvider>
            <div className="relative z-10">
              {children}
            </div>
          </AgentProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
