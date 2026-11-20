import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { WarningCircle } from "@phosphor-icons/react";
import type { CanonicalSleepEpisode, SleepChartData } from "../../types/health";
import { buildSleepTimeline } from "../../utils/sleepChartTransform";
import { Button } from "../md3/Button";
import { clockLabel, dateLabel, durationLabel, sourceTimestamp } from "./healthFormat";

const stageLabels = {
  unstaged: "Asleep (unstaged)", nap: "Nap", light: "Light", deep: "Deep", rem: "REM", awake: "Awake",
} as const;
const PAGE_SIZE = 45;
const timelineHours = ["12:00 −1", "18:00", "00:00", "06:00", "12:00", "18:00", "00:00"];

export function SleepChartPanel({ chart, tz, demo, onEdit }: {
  chart: SleepChartData;
  tz: number;
  demo: boolean;
  onEdit: (episode: CanonicalSleepEpisode) => void;
}) {
  const rows = useMemo(() => buildSleepTimeline(chart.daySummaries, chart.episodes, chart.studyOverlays, tz),
    [chart.daySummaries, chart.episodes, chart.studyOverlays, tz]);
  const [selected, setSelected] = useState<string | null>(null);
  const [olderPage, setOlderPage] = useState(0);
  const patternId = useId();
  const page = Math.min(olderPage, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  const pageEnd = rows.length - page * PAGE_SIZE;
  const visibleRows = rows.slice(Math.max(0, pageEnd - PAGE_SIZE), pageEnd);
  const row = visibleRows.find((item) => item.day.localDate === selected) ??
    [...visibleRows].reverse().find((item) => !item.day.missingData) ?? visibleRows[0];
  const inspectorId = `${patternId}-inspector`;
  const keyboardHintId = `${patternId}-keyboard`;
  const points = useMemo(() => chart.daySummaries.map((day) => ({
    date: day.localDate,
    hours: day.mainSleepMins == null ? null : day.mainSleepMins / 60,
    rmssd: day.overnightRmssdMs, sdnn: day.overnightSdnnMs, restingRate: day.restingHrBpm,
  })), [chart.daySummaries]);
  const curve = useMemo(() => chart.alertnessCurve.points.map((point) => ({
    time: point.localLabel, alertness: point.alertness,
    band: [Math.max(0, point.alertness - point.uncertaintyHalfWidth), Math.min(1, point.alertness + point.uncertaintyHalfWidth)],
  })), [chart.alertnessCurve.points]);

  return (
    <div className="health-overview">
      <figure className="health-section health-timeline-figure">
        <figcaption><h2>Sleep by day</h2><p>Times use the source’s local clock. Select a day to inspect the recorded intervals.</p></figcaption>
        <svg className="health-timeline-definitions" aria-hidden="true" width="0" height="0">
          <defs>
            <pattern id={`${patternId}-deep`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(35)">
              <rect width="5" height="5" fill="var(--color-primary)" /><path d="M 0 0 V 5" stroke="var(--color-on-primary-container)" strokeWidth="2" />
            </pattern>
            <pattern id={`${patternId}-rem`} patternUnits="userSpaceOnUse" width="5" height="5">
              <rect width="5" height="5" fill="var(--color-tertiary-container)" /><path d="M 0 0 V 5" stroke="var(--color-tertiary)" strokeWidth="2" />
            </pattern>
          </defs>
        </svg>
        <ul className="health-legend" aria-label="Sleep stage legend">
          {Object.entries(stageLabels).map(([key, label]) => <li key={key}>
            <span className={`health-stage health-stage-${key}`} aria-hidden="true" />{label}
          </li>)}
          {chart.studyOverlays.length > 0 && <li><span className="health-study-key" aria-hidden="true" />Study session</li>}
        </ul>
        {rows.length > PAGE_SIZE && <div className="health-controls" aria-label="Timeline date pages">
          <Button variant="text" disabled={pageEnd <= PAGE_SIZE} onClick={() => setOlderPage(page + 1)}>Earlier dates</Button>
          <span>{dateLabel(visibleRows[0].day.localDate)} to {dateLabel(visibleRows[visibleRows.length - 1].day.localDate)}</span>
          <Button variant="text" disabled={page === 0} onClick={() => setOlderPage(page - 1)}>Later dates</Button>
        </div>}
        <div className="health-chart-top" aria-hidden="true">
          <span>Wake date</span>
          <span className="health-timeline-ticks">{timelineHours.map((label, index) =>
            <span key={index} style={{ left: `${index * 100 / 6}%` }}>{label}</span>)}</span>
          <span>Total</span>
        </div>
        <div className="sr-only" id={keyboardHintId}>Use the up and down arrow keys to select a date.</div>
        <div className="health-timeline-scroll" role="group" aria-label="Select a date" aria-describedby={keyboardHintId}>
          {visibleRows.map((item, index) => <button key={item.day.localDate} type="button" className="health-timeline-row"
            aria-pressed={row?.day.localDate === item.day.localDate}
            tabIndex={row?.day.localDate === item.day.localDate ? 0 : -1}
            aria-controls={inspectorId}
            onClick={() => setSelected(item.day.localDate)}
            onKeyDown={(event) => {
              const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
              if (!step || !visibleRows[index + step]) return;
              event.preventDefault();
              const sibling = step > 0 ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
              if (sibling instanceof HTMLElement) sibling.focus();
              setSelected(visibleRows[index + step].day.localDate);
            }}>
            <time dateTime={item.day.localDate}>{dateLabel(item.day.localDate)}</time>
            <svg className="health-timeline-track" aria-hidden="true" width="100%" height="16">
              {item.day.missingData && <line className="health-missing-line" x1="0" x2="100%" y1="8" y2="8" />}
              {item.segments.map((segment) => <rect key={segment.key} className={`health-mark health-mark-${segment.stage}`}
                x={`${segment.left}%`} width={`${segment.width}%`} y="2" height="12" rx="2"
                fill={segment.stage === "deep" || segment.stage === "rem" ? `url(#${patternId}-${segment.stage})` : undefined} />)}
              {item.study.map(({ point, left }) => <line key={point.sessionId} className="health-study-marker"
                x1={`${left}%`} x2={`${left}%`} y1="0" y2="16" />)}
            </svg>
            <span>{item.day.missingData ? "No data" : durationLabel(item.day.totalSleepAllEpisodesMins)}</span>
          </button>)}
        </div>
        <div className="sr-only"><table>
          <caption>Sleep duration, naps, and stage availability by day</caption>
          <thead><tr><th>Date</th><th>Main sleep</th><th>Naps</th><th>Stage coverage</th><th>Study sessions</th></tr></thead>
          <tbody>{rows.map(({ day, study }) => <tr key={day.localDate}><th>{day.localDate}</th>
            <td>{day.missingData ? "No records" : durationLabel(day.mainSleepMins)}</td>
            <td>{day.napCount}</td><td>{Math.round(day.stageCoverageRatio * 100)}%</td><td>{study.length}</td>
          </tr>)}</tbody>
        </table></div>
      </figure>
      {row && <section id={inspectorId} className="health-section" aria-label="Day inspector">
        <h2>{dateLabel(row.day.localDate)}</h2>
        {row.day.missingData ? <p>No sleep is recorded for this date.</p> : <>
          <p>Sleep {durationLabel(row.day.mainSleepMins)} · Naps {durationLabel(row.day.totalNapMins)} · Wake {clockLabel(row.day.wakeLocalMins)}</p>
          {row.day.hasSourceConflict && <p className="health-warning"><WarningCircle size={19} /> Sources disagree about the length of sleep.</p>}
          <ul className="health-recent">
            {row.episodes.map((episode) => <li key={episode.id}><div>
              <strong>{episode.sleepKind === "nap" ? "Nap" : "Main sleep"}</strong>
              <p>{sourceTimestamp(episode.startAtMs, episode.startTzOffsetSecs)} to {sourceTimestamp(episode.endAtMs, episode.endTzOffsetSecs)} · {durationLabel(episode.totalSleepMins)}</p>
              <p>{episode.stageCoverageRatio < 0.7 ? "Asleep (unstaged). Sleep stage coverage is below 70%." : "Detailed sleep stages available."}</p>
              {episode.members.length > 0 && <details><summary>Sources</summary><ul>
                {episode.members.map((member) => <li key={member.rawSessionId}>{member.sourceAppBundle ?? member.providerId.replaceAll("_", " ")} · {member.relationship.replaceAll("_", " ")} · {durationLabel(member.durationMins)}</li>)}
              </ul></details>}
              {episode.stages.length > 0 && <details><summary>Recorded stage intervals</summary><ul>
                {episode.stages.map((stage) => <li key={stage.id}>
                  {stageLabels[stage.stageType as keyof typeof stageLabels] ?? stage.stageType.replaceAll("_", " ")}
                  {" · "}{sourceTimestamp(stage.startAtMs, episode.startTzOffsetSecs)} to {sourceTimestamp(stage.endAtMs, episode.startTzOffsetSecs)}
                </li>)}
                {episode.startTzOffsetSecs !== episode.endTzOffsetSecs && <li>Stage times use the event’s starting offset.</li>}
              </ul></details>}
            </div>{episode.primaryProviderId === "manual" && !demo && <Button variant="tonal" onClick={() => onEdit(episode)}>Edit entry</Button>}</li>)}
          </ul>
        </>}
      </section>}
      {points.some((point) => point.hours != null) && <figure className="health-section">
        <figcaption><h2>Sleep duration</h2><p>Hours of main sleep. Gaps indicate missing records.</p></figcaption>
        <div className="health-plot" aria-hidden="true"><ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} accessibilityLayer={false}><CartesianGrid vertical={false} stroke="var(--color-outline-variant)" />
            <XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={40} stroke="var(--color-on-surface-variant)" />
            <YAxis unit="h" width={40} stroke="var(--color-on-surface-variant)" />
            <Tooltip labelFormatter={(label) => dateLabel(String(label))} />
            <Line type="linear" dataKey="hours" name="Sleep" stroke="var(--color-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer></div>
      </figure>}
      {points.some((point) => point.rmssd != null || point.sdnn != null || point.restingRate != null) &&
        <table className="health-data-table"><caption>Overnight biometrics</caption><thead>
          <tr><th>Date</th><th>RMSSD (ms)</th><th>SDNN (ms)</th><th>Resting HR (bpm)</th></tr>
        </thead><tbody>{points.filter((point) => point.rmssd != null || point.sdnn != null || point.restingRate != null)
          .slice(-14).reverse().map((point) => <tr key={point.date}><th>{dateLabel(point.date)}</th><td>{point.rmssd?.toFixed(1) ?? "—"}</td>
            <td>{point.sdnn?.toFixed(1) ?? "—"}</td><td>{point.restingRate?.toFixed(0) ?? "—"}</td></tr>)}</tbody></table>}
      {curve.length > 0 && <figure className="health-section">
        <figcaption><h2>Exploratory alertness</h2><p>{chart.alertnessCurve.methodologyNote}</p></figcaption>
        <div className="health-plot" aria-hidden="true"><ResponsiveContainer width="100%" height="100%">
          <AreaChart data={curve} accessibilityLayer={false}><XAxis dataKey="time" minTickGap={42} stroke="var(--color-on-surface-variant)" />
            <YAxis width={40} domain={[0, 1]} stroke="var(--color-on-surface-variant)" /><Tooltip />
            <Area dataKey="band" name="Uncertainty" fill="var(--color-primary-container)" stroke="none" isAnimationActive={false} />
            <Area dataKey="alertness" name="Estimated alertness" fill="none" stroke="var(--color-primary)" strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer></div>
        <div className="sr-only"><table><caption>Estimated alertness and uncertainty</caption>
          <thead><tr><th>Time</th><th>Alertness</th><th>Lower bound</th><th>Upper bound</th></tr></thead>
          <tbody>{curve.map((point, index) => <tr key={index}><th>{point.time}</th><td>{point.alertness.toFixed(2)}</td>
            <td>{point.band[0].toFixed(2)}</td><td>{point.band[1].toFixed(2)}</td></tr>)}</tbody>
        </table></div>
      </figure>}
    </div>
  );
}
