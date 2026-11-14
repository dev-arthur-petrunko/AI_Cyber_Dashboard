"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchTimeline } from "@/lib/api";
import { Timeline } from "@/lib/types";
import { CyberTimeline } from "@/components/CyberTimeline";
import { AdminShell } from "@/components/AdminShell";
import { useTranslation } from "@/components/LanguageContext";

export default function TimelinePage() {
  const params = useParams<{ cve: string }>();
  const { t } = useTranslation();
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchTimeline(params.cve).then(({ data, isDemo }) => {
      setTimeline(data);
      setIsDemo(isDemo);
      setLoading(false);
    });
  }, [params.cve]);

  return (
    <AdminShell title={t.timeline.title}>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-0.5 w-6 rounded-full bg-gradient-to-r from-text-primary to-text-muted" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.3em] text-text-secondary">
              VULNERABILITY TIMELINE
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-text-primary sm:text-2xl">
            <span className="bg-gradient-to-r from-text-primary to-text-muted bg-clip-text text-transparent">
              {params.cve}
            </span>
          </h1>
          <p className="mt-1 text-sm text-text-secondary">{t.timeline.title}</p>
        </div>

        {isDemo && !loading && (
          <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning shadow-sm">
            ⚠️ {t.timeline.demoWarning}
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-border bg-panel p-8 text-center shadow-sm">
            <div className="inline-block h-8 w-8 spinner-glow" />
            <p className="mt-3 text-sm text-text-muted">{t.timeline.loading}</p>
          </div>
        ) : (
          timeline && <CyberTimeline timeline={timeline} />
        )}
      </div>
    </AdminShell>
  );
}
