import { useState } from "react";
import type { LearningInsightsReport, PersonalInsight } from "../../types/health";
import { Button } from "../md3/Button";
import { HealthDialog } from "./HealthDialog";
import { EvidenceSufficiency } from "./LearningPerformancePanel";

export function PersonalPatternsPanel({ report }: { report: LearningInsightsReport }) {
  const [selected, setSelected] = useState<PersonalInsight | null>(null);
  return <div className="health-overview">
    <EvidenceSufficiency report={report} />
    <section className="health-section">
      <h2>Personal Patterns</h2>
      <p>These are associations in your own history. Inspect the sample and methods behind each result.</p>
      {report.insights.length ? <ul className="health-pattern-list">
        {report.insights.map((insight) => <li key={insight.id}>
          <div><h3>{insight.title}</h3><p>{insight.summary}</p></div>
          <Button variant="tonal" onClick={() => setSelected(insight)}>Inspect evidence</Button>
        </li>)}
      </ul> : <p>No patterns are available for this selection.</p>}
    </section>
    {selected && <HealthDialog title={selected.title} onClose={() => setSelected(null)}>
      <p>{selected.summary}</p>
      <dl className="health-evidence">
        <div><dt>Paired reviews</dt><dd>{selected.evidence.sampleReviews}</dd></div>
        <div><dt>Study sessions</dt><dd>{selected.evidence.sampleSessions}</dd></div>
        <div><dt>Tracked days</dt><dd>{selected.evidence.distinctDays}</dd></div>
        <div><dt>Coverage</dt><dd>{Math.round(selected.evidence.coverageRatio * 100)}%</dd></div>
        <div><dt>{selected.evidence.effectSizeLabel}</dt><dd>{selected.evidence.effectSize?.toFixed(3) ?? "Unavailable"}</dd></div>
        <div><dt>95% confidence interval</dt><dd>{selected.evidence.ciLow != null && selected.evidence.ciHigh != null
          ? `${selected.evidence.ciLow.toFixed(3)} to ${selected.evidence.ciHigh.toFixed(3)}` : "Unavailable"}</dd></div>
        <div><dt>Adjusted q-value</dt><dd>{selected.evidence.qValue?.toPrecision(3) ?? "Unavailable"}</dd></div>
      </dl>
      {!!selected.evidence.confoundersControlled.length && <p>Adjusted for {selected.evidence.confoundersControlled.join(", ")}.</p>}
      <ul className="health-reasons">{selected.evidence.limitations.map((note) => <li key={note}>{note}</li>)}</ul>
      <div className="health-actions"><Button variant="text" onClick={() => setSelected(null)}>Close</Button></div>
    </HealthDialog>}
  </div>;
}
