import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LearningInsightsReport, PerformanceBucketPoint } from "../../types/health";

const metricPanels = [
  ["sleepDurationBuckets", "Sleep duration"],
  ["awakeDurationBuckets", "Time since waking"],
  ["timeOfDayBuckets", "Time of day"],
  ["hrvRmssdBuckets", "HRV · RMSSD"],
  ["hrvSdnnBuckets", "HRV · SDNN"],
  ["restingHrBuckets", "Resting heart rate"],
] as const;

export function EvidenceSufficiency({ report }: { report: LearningInsightsReport }) {
  if (report.sufficiency.meetsCoreGuardrails) return null;
  return <section className="health-section" aria-label="Data sufficiency">
    <h3>There is not enough reliable data to identify a pattern.</h3>
    <p>{report.sufficiency.pairedFsrsReviews} paired reviews across {report.sufficiency.pairedSessions} study sessions.</p>
    <ul className="health-reasons">{report.sufficiency.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
  </section>;
}

export function LearningPerformancePanel({ report }: { report: LearningInsightsReport }) {
  const [metric, setMetric] = useState<(typeof metricPanels)[number][0]>("sleepDurationBuckets");
  return <div className="health-overview">
    <EvidenceSufficiency report={report} />
    <section className="health-section">
      <div className="health-section-head"><h2>Review performance</h2>
        <label className="health-inline-field">Group reviews by
          <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
            {metricPanels.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <p>Adjusted recall compares observed recall with FSRS-7 predictions from earlier reviews.</p>
      <PerformanceBuckets buckets={report[metric]} />
    </section>
    <section className="health-section"><h2>Nap comparison</h2>
      <p>{report.napComparison.sufficientMatches && report.napComparison.residualDelta != null
        ? `Adjusted recall difference ${report.napComparison.residualDelta.toFixed(3)} across ${report.napComparison.matchedPairs} matched session pairs.`
        : "More comparable study sessions are needed to estimate a nap association."}</p>
    </section>
    {report.assessmentBreakdowns.length > 0 && <section className="health-section">
      <h2>Assessments</h2>
      <div className="health-table-scroll"><table className="health-data-table">
        <thead><tr><th>Mode</th><th>Finalized attempts</th><th>Sleep-paired</th><th>Average score</th></tr></thead>
        <tbody>{report.assessmentBreakdowns.map((mode) => <tr key={mode.mode}>
          <th>{mode.mode}</th><td>{mode.attempts}</td><td>{mode.sleepPairedAttempts}</td><td>{mode.meanScorePct == null ? "—" : `${mode.meanScorePct.toFixed(1)}%`}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
    <section className="health-section">
      <h2>Learning Windows</h2><p>{report.learningWindows.explanation}</p>
      {report.learningWindows.recommendedWindowLabel && <p>{report.learningWindows.recommendedWindowLabel}</p>}
    </section>
  </div>;
}

function PerformanceBuckets({ buckets }: { buckets: PerformanceBucketPoint[] }) {
  return <>
    {buckets.some((bucket) => bucket.sufficient && bucket.meanFsrsResidual != null) &&
      <div className="health-plot" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={buckets} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke="var(--color-outline-variant)" />
          <XAxis dataKey="label" minTickGap={24} stroke="var(--color-on-surface-variant)" />
          <YAxis width={45} stroke="var(--color-on-surface-variant)" /><Tooltip />
          <Bar dataKey="meanFsrsResidual" fill="var(--color-primary)" name="Adjusted recall" isAnimationActive={false} />
        </BarChart></ResponsiveContainer>
      </div>}
    <div className="health-table-scroll"><table className="health-data-table">
      <caption className="sr-only">Adjusted recall and review time by group</caption>
      <thead><tr><th>Group</th><th>Reviews</th><th>Adjusted recall</th><th>Median time</th></tr></thead>
      <tbody>{buckets.map((bucket) => <tr key={bucket.label}>
        <th>{bucket.label}</th><td>{bucket.reviews}</td><td>{bucket.sufficient ? bucket.meanFsrsResidual?.toFixed(3) ?? "—" : "Insufficient data"}</td>
        <td>{bucket.sufficient && bucket.medianLatencySecs != null ? `${bucket.medianLatencySecs.toFixed(1)}s` : "—"}</td>
      </tr>)}</tbody>
    </table></div>
  </>;
}
