import { useEffect, useState } from "react";
import { CaretRight, MoonStars, X } from "@phosphor-icons/react";
import { healthApi } from "../../api/health";
import { isTauri } from "../../lib/tauri";
import { useHealthStore } from "../../stores/healthStore";
import { useTabsStore } from "../../stores/tabsStore";
import type { LearningInsightsReport, SleepChartData } from "../../types/health";
import { createCanonicalTab } from "../tabs/TabRegistry";
import { defaultHealthRange, durationLabel } from "./healthFormat";

const HIDE_CARD_KEY = "plethora.dashboard.hideSleepLearning";

function readHiddenPreference(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(HIDE_CARD_KEY) === "1";
  } catch {
    return false;
  }
}

function dayInitial(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "·";
  return new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" }).format(d);
}

export function SleepLearningDashboardCard() {
  const available = isTauri();
  const demo = useHealthStore((s) => s.demo);
  const revision = useHealthStore((s) => s.revision);
  const setView = useHealthStore((s) => s.setView);
  const addTab = useTabsStore((s) => s.addTab);

  const [hidden, setHidden] = useState<boolean>(readHiddenPreference);
  const [chart, setChart] = useState<SleepChartData | null>(null);
  const [report, setReport] = useState<LearningInsightsReport | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!available || hidden) return;
    let active = true;
    const range7d = defaultHealthRange(7);
    const range30d = defaultHealthRange(30);

    void healthApi
      .getSleepChart(range7d, demo, false)
      .then((data) => {
        if (!active) return;
        setChart(data);
        setLoaded(true);
        if (!demo && data.episodes.length > 0) {
          void healthApi
            .getLearningInsights(range30d, false)
            .then((insights) => {
              if (active) setReport(insights);
            })
            .catch(() => {
              if (active) setReport(null);
            });
        } else {
          setReport(null);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [available, demo, hidden, revision]);

  if (!available || hidden) return null;

  const openInsights = (targetView: "overview" | "data-sources" = "overview") => {
    setView(targetView);
    addTab(createCanonicalTab("learning-insights"));
  };

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDE_CARD_KEY, "1");
    } catch {}
  };

  const hasData = Boolean(chart && chart.episodes.length > 0);
  const rolling7d = chart?.rolling7d;
  const days = (chart?.daySummaries ?? []).slice(-7);
  const maxMins = days.reduce((m, d) => Math.max(m, d.mainSleepMins ?? 0), 480);

  if (!loaded && !chart) {
    return (
      <section
        aria-label="Sleep & Learning"
        className="border border-border rounded-xl p-4 md:p-5 flex flex-col justify-between"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MoonStars className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">Sleep &amp; Learning</h2>
          </div>
          <span className="text-xs text-muted-foreground">Last 7 days</span>
        </div>
        <p className="py-6 text-xs text-muted-foreground">Loading sleep summary…</p>
        <button
          type="button"
          onClick={() => openInsights("overview")}
          className="self-end text-xs text-primary hover:text-primary/80 flex items-center gap-1"
        >
          View Learning Insights
          <CaretRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </section>
    );
  }

  if (!hasData) {
    return (
      <section
        aria-label="Sleep & Learning"
        className="border border-border rounded-xl p-4 md:p-5 flex flex-col justify-between gap-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <MoonStars className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">Sleep &amp; Learning</h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss Sleep & Learning card"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Connect a wearable, import sleep records, or log sleep manually to see how rest aligns with your reviews.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openInsights("data-sources")}
            className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Connect wearable
          </button>
          <button
            type="button"
            onClick={() => openInsights("overview")}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            Log sleep
          </button>
        </div>
      </section>
    );
  }

  const secondaryLabel = rolling7d?.sriProxy != null ? "Regularity" : "Bedtime var.";
  const secondaryValue =
    rolling7d?.sriProxy != null
      ? `${Math.round(rolling7d.sriProxy)}%`
      : rolling7d?.circularBedtimeSdMins != null
      ? `±${Math.round(rolling7d.circularBedtimeSdMins)}m`
      : "—";

  const trackedValue = rolling7d ? `${rolling7d.nightsTracked}/7` : "—";
  const topInsight = !demo ? report?.insights?.[0] : undefined;

  return (
    <section
      aria-label="Sleep & Learning"
      className="border border-border rounded-xl p-4 md:p-5 flex flex-col justify-between gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MoonStars className="w-4 h-4 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold text-foreground">Sleep &amp; Learning</h2>
          {demo && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              Sample data
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">Last 7 days</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-left">
        <div>
          <div className="text-base font-bold text-foreground">
            {durationLabel(rolling7d?.meanTotalSleepMins)}
          </div>
          <div className="text-[11px] text-muted-foreground">Avg. sleep</div>
        </div>
        <div>
          <div className="text-base font-bold text-foreground">{secondaryValue}</div>
          <div className="text-[11px] text-muted-foreground">{secondaryLabel}</div>
        </div>
        <div>
          <div className="text-base font-bold text-foreground">{trackedValue}</div>
          <div className="text-[11px] text-muted-foreground">Tracked</div>
        </div>
      </div>

      {days.length > 0 && (
        <div aria-label="7-day sleep duration" className="space-y-1">
          <div className="flex items-end gap-1.5 h-12 pt-1">
            {days.map((day) => {
              const mins = day.mainSleepMins ?? 0;
              const pct = day.missingData || mins <= 0 ? 12 : Math.max(18, Math.round((mins / maxMins) * 100));
              return (
                <div key={day.localDate} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <div
                    title={
                      day.missingData
                        ? `${day.localDate}: No sleep recorded`
                        : `${day.localDate}: ${durationLabel(day.mainSleepMins)}`
                    }
                    className={`w-full rounded-sm transition-all ${
                      day.missingData ? "bg-muted/60 border border-dashed border-border" : "bg-primary/80"
                    }`}
                    style={{ height: `${pct}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1.5 text-[10px] text-muted-foreground text-center">
            {days.map((day) => (
              <span key={`${day.localDate}-lbl`} className="flex-1">
                {dayInitial(day.localDate)}
              </span>
            ))}
          </div>
        </div>
      )}

      {topInsight && (
        <p className="text-xs text-muted-foreground line-clamp-2">{topInsight.title}</p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => openInsights("overview")}
          className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
        >
          View Learning Insights
          <CaretRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
