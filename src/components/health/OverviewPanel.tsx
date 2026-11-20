import { MoonStars, Waveform } from "@phosphor-icons/react";
import type { SleepChartData } from "../../types/health";
import { Button } from "../md3/Button";
import { clockLabel, dateLabel, durationLabel } from "./healthFormat";

export function OverviewPanel({ chart, demo, onLog, onDemo, onSources, onChart }: {
  chart: SleepChartData;
  demo: boolean;
  onLog: () => void;
  onDemo: () => void;
  onSources: () => void;
  onChart: () => void;
}) {
  const metrics = chart.rolling30d;
  const recent = chart.daySummaries.filter((day) => !day.missingData).slice(-5).reverse();
  if (chart.episodes.length === 0) {
    return <section className="health-empty health-empty-overview">
      <MoonStars size={36} weight="duotone" aria-hidden="true" />
      <div><h2>Start with a night of sleep</h2>
        <p>Log sleep, import a file, or connect a wearable to see your sleep history here.</p>
      </div>
      <div className="health-actions health-actions-start">
        <Button variant="filled" onClick={onLog}>Log sleep</Button>
        <Button variant="tonal" onClick={onSources}>Manage data sources</Button>
        {!demo && <Button variant="text" onClick={onDemo}>Explore sample data</Button>}
      </div>
    </section>;
  }
  return <div className="health-overview">
    <section className="health-section">
      <div className="health-section-head"><h2>Sleep summary</h2><span>Latest 30 days in range</span></div>
      <dl className="health-metrics">
        <div><dt>Average main sleep</dt><dd>{durationLabel(metrics.meanTotalSleepMins)}</dd></div>
        <div><dt>Typical wake time</dt><dd>{clockLabel(metrics.circularWakeMeanMins)}</dd></div>
        <div><dt>Tracked nights</dt><dd>{metrics.nightsTracked}<small> / {metrics.nightsTracked + metrics.missingNights}</small></dd></div>
        <div><dt>Sleep regularity proxy</dt><dd>{metrics.sriProxy == null ? "—" : Math.round(metrics.sriProxy)}</dd></div>
      </dl>
      {metrics.sriStatus === "insufficient_consecutive_days" && <p>Regularity needs eight consecutive tracked days.</p>}
    </section>
    <section className="health-section">
      <div className="health-section-head">
        <h2><Waveform size={19} aria-hidden="true" /> Recent sleep</h2>
        <Button variant="text" onClick={onChart}>Open Sleep Chart</Button>
      </div>
      <ul className="health-recent">
        {recent.map((day) => <li key={day.localDate}>
          <time dateTime={day.localDate}>{dateLabel(day.localDate)}</time>
          <span>{day.mainSleepMins == null ? "No main sleep recorded" : durationLabel(day.mainSleepMins)}</span>
          <span>{day.napCount ? `${day.napCount} ${day.napCount === 1 ? "nap" : "naps"}` : ""}</span>
        </li>)}
      </ul>
    </section>
  </div>;
}
