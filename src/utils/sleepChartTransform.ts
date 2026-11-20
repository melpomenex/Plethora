import type { CanonicalSleepEpisode, SleepChartData, SleepStageType, StudyOverlayPoint } from "../types/health";

const MINUTE = 60_000;
const DAY = 1_440 * MINUTE;

export interface TimelineSegment {
  key: string;
  left: number;
  width: number;
  stage: SleepStageType | "unstaged" | "nap";
}

export interface SleepTimelineRow {
  day: SleepChartData["daySummaries"][number];
  episodes: CanonicalSleepEpisode[];
  segments: TimelineSegment[];
  study: Array<{ point: StudyOverlayPoint; left: number }>;
}

function position(atMs: number, offset: number, midnight: number) {
  const minutes = (atMs + offset * 1_000 - midnight) / MINUTE;
  return Math.max(0, Math.min(100, (minutes + 720) / 21.6));
}

export function buildSleepTimeline(
  summaries: SleepChartData["daySummaries"],
  episodes: SleepChartData["episodes"],
  study: SleepChartData["studyOverlays"],
  timezoneOffset: number,
): SleepTimelineRow[] {
  const rows = new Map(summaries.map((day) => [day.localDate, {
    day, episodes: [], segments: [], study: [],
  } satisfies SleepTimelineRow as SleepTimelineRow]));

  for (const episode of episodes) {
    const row = rows.get(episode.anchorLocalDate);
    if (!row) continue;
    row.episodes.push(episode);
    const midnight = Date.parse(episode.anchorLocalDate);
    const startOffset = episode.startTzOffsetSecs ?? timezoneOffset;
    const endOffset = episode.endTzOffsetSecs ?? startOffset;
    const sleepLeft = position(episode.startAtMs, startOffset, midnight);
    const sleepRight = position(episode.endAtMs, endOffset, midnight);
    row.segments.push({
      key: episode.id, left: sleepLeft, width: Math.max(0, sleepRight - sleepLeft),
      stage: episode.sleepKind === "nap" ? "nap" : "unstaged",
    });
    for (const stage of episode.stages) {
      const left = position(stage.startAtMs, startOffset, midnight);
      const right = position(stage.endAtMs, endOffset, midnight);
      row.segments.push({ key: stage.id, left, width: Math.max(0, right - left), stage: stage.stageType });
    }
  }

  for (const point of study) {
    const local = point.startedAtMs + timezoneOffset * 1_000;
    const midnight = Math.floor(local / DAY) * DAY;
    const date = new Date(midnight).toISOString().slice(0, 10);
    rows.get(date)?.study.push({ point, left: position(point.startedAtMs, timezoneOffset, midnight) });
  }
  return Array.from(rows.values());
}
