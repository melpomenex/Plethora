import { bench } from "vitest";
import { seededRandom } from "../../test/bench-support";
import type { CanonicalSleepEpisode, SleepDaySummary, SleepStageType } from "../../types/health";
import { buildSleepTimeline } from "../sleepChartTransform";

const random = seededRandom(74);
const minute = 60_000;
const day = 1_440 * minute;
const stageTypes: SleepStageType[] = ["light", "deep", "light", "rem", "light", "awake"];
const summaries: SleepDaySummary[] = [];
const episodes: CanonicalSleepEpisode[] = [];

for (let index = 0; index < 1_095; index += 1) {
  const midnight = Date.UTC(2023, 0, 1) + index * day;
  const date = new Date(midnight).toISOString().slice(0, 10);
  const id = `night-${index}`;
  const start = midnight - Math.floor(random() * 90) * minute;
  const sleepMins = 360 + Math.floor(random() * 150);
  const end = start + sleepMins * minute;
  summaries.push({
    localDate: date, mainSleepId: id, mainSleepStartMs: start, mainSleepEndMs: end,
    mainSleepMins: sleepMins, totalSleepAllEpisodesMins: sleepMins, napCount: 0, totalNapMins: 0,
    timeInBedMins: sleepMins, efficiencyPct: null, wasoMins: null, awakeningsCount: 0,
    stageCoverageRatio: 1, awakePct: null, lightPct: null, deepPct: null, remPct: null,
    sleepOnsetLocalMins: null, wakeLocalMins: null, sleepMidpointLocalMins: null,
    overnightRmssdMs: null, overnightSdnnMs: null, restingHrBpm: null,
    recoveryScore: null, recoveryScaleMax: null, recoveryScoreName: null,
    hasSourceConflict: false, missingData: false,
  });
  episodes.push({
    id, primaryRawSessionId: id, primaryProviderId: "oura", anchorLocalDate: date,
    startAtMs: start, endAtMs: end, startTzOffsetSecs: 0, endTzOffsetSecs: 0,
    sleepKind: "main_sleep", userSleepKindOverride: null, totalSleepMins: sleepMins,
    timeInBedMins: sleepMins, sleepEfficiencyPct: null, wasoMins: null, stageCoverageRatio: 1,
    awakeMins: null, lightMins: null, deepMins: null, remMins: null,
    hasSourceConflict: false, conflictDurationDiffMins: null, qualityFlags: [],
    isSynthetic: true, members: [],
    stages: Array.from({ length: 24 }, (_, stage) => ({
      id: `${id}-${stage}`, rawSessionId: id, stageType: stageTypes[stage % stageTypes.length],
      startAtMs: start + Math.round((end - start) * stage / 24),
      endAtMs: start + Math.round((end - start) * (stage + 1) / 24),
      providerStageCode: null,
    })),
  });
}

let sink = 0;
bench("health-timeline/1095-nights", () => {
  const rows = buildSleepTimeline(summaries, episodes, [], 0);
  sink = rows.reduce((count, row) => count + row.segments.length, sink);
});
