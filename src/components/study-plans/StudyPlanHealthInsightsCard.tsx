import { useEffect, useState } from "react";
import { MoonStars } from "@phosphor-icons/react";
import { healthApi } from "../../api/health";
import { isTauri } from "../../lib/tauri";
import { useHealthStore } from "../../stores/healthStore";
import { useTabsStore } from "../../stores/tabsStore";
import type { PersonalInsight } from "../../types/health";
import { defaultHealthRange } from "../health/healthFormat";
import { Button } from "../md3/Button";
import { createCanonicalTab } from "../tabs/TabRegistry";
import "../health/health.css";

export function StudyPlanHealthInsightsCard({ planId }: { planId: string }) {
  const revision = useHealthStore((state) => state.revision);
  const [result, setResult] = useState<{ planId: string; insight: PersonalInsight } | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const range = defaultHealthRange();
    healthApi.getSleepChart(range, false, false).then(async (chart) => {
      if (!active || !chart.episodes.length) return null;
      return healthApi.getStudyPlanInsights(range, planId);
    }).then((report) => {
      if (!active) return;
      const insight = report?.insights.find((entry) => entry.status === "supported");
      setResult(insight ? { planId, insight } : null);
    }).catch(() => { if (active) setResult(null); });
    return () => { active = false; };
  }, [planId, revision]);

  if (!result || result.planId !== planId) return null;

  return <aside className="health-section" aria-label="Study Plan sleep insights">
    <div className="health-section-head"><h2><MoonStars size={18} aria-hidden="true" /> Sleep and study</h2>
      <Button variant="text" onClick={() => {
        useHealthStore.getState().setDemo(false).catch(() => {});
        useHealthStore.getState().setPlan(planId);
        useHealthStore.getState().setView("personal-patterns");
        useTabsStore.getState().addTab(createCanonicalTab("learning-insights"));
      }}>View evidence</Button>
    </div>
    <p>{result.insight.summary}</p>
  </aside>;
}
