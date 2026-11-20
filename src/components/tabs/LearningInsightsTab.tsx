import { useEffect, useMemo, useState } from "react";
import { MoonStars } from "@phosphor-icons/react";
import { healthApi } from "../../api/health";
import { isTauri } from "../../lib/tauri";
import { useHealthStore, type HealthView } from "../../stores/healthStore";
import type { CanonicalSleepEpisode, LearningInsightsReport, SleepChartData } from "../../types/health";
import { DataSourcesPanel } from "../health/DataSourcesPanel";
import { LearningPerformancePanel } from "../health/LearningPerformancePanel";
import { ManualSleepDialog } from "../health/ManualSleepDialog";
import { OverviewPanel } from "../health/OverviewPanel";
import { PersonalPatternsPanel } from "../health/PersonalPatternsPanel";
import { SleepChartPanel } from "../health/SleepChartPanel";
import { defaultHealthRange, healthError, localDateInput } from "../health/healthFormat";
import { Button } from "../md3/Button";
import "../health/health.css";

const views: Array<[HealthView, string]> = [
  ["overview", "Overview"], ["sleep-chart", "Sleep Chart"], ["learning-performance", "Learning Performance"],
  ["personal-patterns", "Personal Patterns"], ["data-sources", "Data Sources"],
];

export function LearningInsightsTab() {
  const view = useHealthStore((state) => state.view);
  const setView = useHealthStore((state) => state.setView);
  const range = useHealthStore((state) => state.range);
  const setRange = useHealthStore((state) => state.setRange);
  const demo = useHealthStore((state) => state.demo);
  const setDemo = useHealthStore((state) => state.setDemo);
  const includeLearning = useHealthStore((state) => state.includeLearning);
  const setIncludeLearning = useHealthStore((state) => state.setIncludeLearning);
  const revision = useHealthStore((state) => state.revision);
  const invalidate = useHealthStore((state) => state.invalidate);
  const plan = useHealthStore((state) => state.plan);
  const setPlan = useHealthStore((state) => state.setPlan);
  const [windowSize, setWindowSize] = useState("90");
  const [customStart, setCustomStart] = useState(() => localDateInput(new Date(defaultHealthRange().startMs)));
  const [customEnd, setCustomEnd] = useState(() => localDateInput(new Date()));
  const [chart, setChart] = useState<SleepChartData | null>(null);
  const [overviewReport, setOverviewReport] = useState<LearningInsightsReport | null>(null);
  const [report, setReport] = useState<LearningInsightsReport | null>(null);
  const [entry, setEntry] = useState<CanonicalSleepEpisode | true | null>(null);
  const [error, setError] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const fallbackRange = useMemo(() => defaultHealthRange(), []);
  const selectedRange = range ?? fallbackRange;
  const showsChart = view === "overview" || view === "sleep-chart";
  const showsAnalysis = view === "learning-performance" || view === "personal-patterns";

  useEffect(() => {
    if (!isTauri() || !showsChart) return;
    let current = true;
    setChart(null);
    setError("");
    healthApi.getSleepChart(selectedRange, demo, includeLearning)
      .then((data) => { if (current) setChart(data); })
      .catch((cause) => { if (current) setError(healthError(cause)); });
    return () => { current = false; };
  }, [selectedRange, demo, includeLearning, revision, showsChart]);

  useEffect(() => {
    if (!isTauri() || !showsAnalysis) return;
    let current = true;
    setOverviewReport(null);
    setError("");
    healthApi.getLearningInsights(selectedRange, demo)
      .then((value) => { if (current) setOverviewReport(value); })
      .catch((cause) => { if (current) setError(healthError(cause)); });
    return () => { current = false; };
  }, [selectedRange, demo, revision, showsAnalysis]);

  useEffect(() => {
    if (!isTauri() || !showsAnalysis || !plan || demo) return;
    let current = true;
    setReport(null);
    setError("");
    healthApi.getStudyPlanInsights(selectedRange, plan).then((value) => { if (current) setReport(value); })
      .catch((cause) => { if (current) setError(healthError(cause)); });
    return () => { current = false; };
  }, [selectedRange, demo, revision, showsAnalysis, plan]);

  async function toggleDemo() {
    setError("");
    setDemoBusy(true);
    try {
      await setDemo(!demo);
      if (!demo) setPlan("");
    } catch (cause) {
      setError(healthError(cause));
    } finally {
      setDemoBusy(false);
    }
  }

  function applyCustom() {
    const start = new Date(`${customStart}T00:00:00`);
    const end = new Date(`${customEnd}T23:59:59`);
    if (!Number.isFinite(start.getTime()) || !(end > start)) {
      setError("Choose a valid start and end date.");
      return;
    }
    if (end.getTime() - start.getTime() > 1095 * 86_400_000) {
      setError("Select up to three years.");
      return;
    }
    setRange({ startMs: start.getTime(), endMs: end.getTime(), tzOffsetSecs: -end.getTimezoneOffset() * 60 });
  }

  const analysis = plan && !demo ? report : overviewReport;
  return <div className="health-workspace-scroll">
    <div className="health-workspace">
      <header className="health-header">
        <div><h1>Learning Insights</h1><p>View your sleep history alongside reviews and study activity.</p></div>
        {isTauri() && <Button variant="tonal" onClick={() => setEntry(true)} disabled={demo}>Log sleep</Button>}
      </header>
      {!isTauri() ? <section className="health-empty"><MoonStars size={30} aria-hidden="true" />
        <h2>Health Vault is available in the native app</h2>
        <p>Open Plethora on desktop or mobile to view health records stored on that device.</p>
      </section> : <>
        <nav className="health-nav" aria-label="Learning Insights views">
          {views.map(([id, label]) => <button type="button" key={id} aria-pressed={view === id}
            onClick={() => { setError(""); setView(id); }}>{label}</button>)}
        </nav>
        {demo && <div className="health-demo"><span><strong>Sample data.</strong> This view uses synthetic sleep records.</span>
          <Button variant="text" disabled={demoBusy} onClick={() => void toggleDemo()}>Exit sample data</Button>
        </div>}
        {view !== "data-sources" && <div className="health-controls">
          <label className="health-inline-field">Date range
            <select value={windowSize} onChange={(e) => {
              const value = e.target.value;
              setWindowSize(value);
              if (value !== "custom") setRange(defaultHealthRange(Number(value)));
            }}>
              <option value="1">Today</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
              <option value="365">1 year</option><option value="custom">Custom dates</option>
            </select>
          </label>
          {windowSize === "custom" && <>
            <label className="health-inline-field">From <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} /></label>
            <label className="health-inline-field">Through <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></label>
            <Button variant="tonal" onClick={applyCustom}>Apply dates</Button>
          </>}
          {view === "sleep-chart" && <label className="health-inline-field">
            <input type="checkbox" disabled={demo} checked={includeLearning && !demo} onChange={(e) => setIncludeLearning(e.target.checked)} /> Study sessions
          </label>}
          {showsAnalysis && !demo && <label className="health-inline-field">Study Plan
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="">All study activity</option>
              {plan && !overviewReport?.studyPlans.some((item) => item.id === plan) && <option value={plan}>Selected Study Plan</option>}
              {overviewReport?.studyPlans.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>}
        </div>}
        {error && <p className="health-error" role="alert">{error} <Button variant="text" onClick={invalidate}>Retry</Button></p>}
        {!error && ((showsChart && !chart) || (showsAnalysis && !analysis)) && <p role="status">Loading insights…</p>}
        {view === "overview" && chart && <OverviewPanel chart={chart} demo={demo} onLog={() => setEntry(true)}
          onDemo={() => void toggleDemo()} onSources={() => setView("data-sources")} onChart={() => setView("sleep-chart")} />}
        {view === "sleep-chart" && chart && <SleepChartPanel chart={chart} tz={selectedRange.tzOffsetSecs ?? 0} demo={demo} onEdit={setEntry} />}
        {view === "learning-performance" && analysis && <LearningPerformancePanel report={analysis} />}
        {view === "personal-patterns" && analysis && <PersonalPatternsPanel report={analysis} />}
        {view === "data-sources" && <DataSourcesPanel />}
      </>}
      {entry && <ManualSleepDialog episode={entry === true ? undefined : entry}
        onClose={() => setEntry(null)} onSaved={() => { setEntry(null); invalidate(); }} />}
    </div>
  </div>;
}
