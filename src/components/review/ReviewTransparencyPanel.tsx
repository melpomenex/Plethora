import { useEffect, useState } from "react";
import { Flask, Info } from "@phosphor-icons/react";
import {
  formatInterval,
  getArenaStats,
  type LearningItem,
  type PreviewIntervals,
  type ArenaStats,
} from "../../api/review";
import { parseAdaptiveState, adaptiveRetrievability, type AdaptiveState } from "../../lib/adaptiveScheduler";
import { parsePrecisionState, precisionRetrievability, type PrecisionState } from "../../lib/precisionScheduler";
import { useSettingsStore } from "../../stores/settingsStore";
import { schedulerLabel } from "../../lib/schedulerCatalog";
import {
  isAdaptiveScheduler,
  isPrecisionScheduler,
  normalizeSchedulerId,
} from "../../lib/schedulerIdentity";

interface ReviewTransparencyPanelProps {
  card: LearningItem;
  previewIntervals: PreviewIntervals | null;
}

const ALGORITHM_LABELS: Record<string, string> = {
  fsrs: `${schedulerLabel("fsrs")} Transparency`,
  adaptive: `${schedulerLabel("adaptive")} Transparency`,
  precision: `${schedulerLabel("precision")} Transparency`,
};

function getAlgorithmLabel(algorithmType?: string): string {
  const canonical = normalizeSchedulerId(algorithmType ?? "fsrs");
  return ALGORITHM_LABELS[canonical] ?? `${schedulerLabel("fsrs")} Transparency`;
}

export function ReviewTransparencyPanel({ card, previewIntervals }: ReviewTransparencyPanelProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [showSuspendNote, setShowSuspendNote] = useState(false);
  const [arenaStats, setArenaStats] = useState<ArenaStats | null>(null);
  const { settings } = useSettingsStore();

  // The global setting determines which algorithm the next review will use (matches submitReview behavior).
  // Card's algorithm_type is only used to detect stored state for display purposes.
  const activeAlgorithm = settings.learning.algorithm;

  // Algorithm Arena weights change slowly (per committed review) — fetch once
  // per mount; tolerate absence (non-Tauri surfaces, old backend).
  useEffect(() => {
    if (!isPrecisionScheduler(activeAlgorithm)) return;
    let cancelled = false;
    getArenaStats()
      .then((stats) => {
        if (!cancelled) setArenaStats(stats);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeAlgorithm]);
  const hasAdaptiveState = !!card.algorithm_state && card.algorithm_state.startsWith("{") && card.algorithm_state.includes('"stability"') && (isAdaptiveScheduler(card.algorithm_type) || card.algorithm_state.includes('"repetition"'));
  const hasPrecisionState = !!card.algorithm_state && isPrecisionScheduler(card.algorithm_type);
  const adaptiveState: AdaptiveState | null = hasAdaptiveState ? parseAdaptiveState(card.algorithm_state) : null;
  const precisionState: PrecisionState | null = hasPrecisionState ? parsePrecisionState(card.algorithm_state) : null;

  const stability = adaptiveState
    ? adaptiveState.stability
    : precisionState
    ? precisionState.stability
    : card.memory_state?.stability;
  const difficulty = adaptiveState
    ? adaptiveState.difficulty
    : precisionState
    ? precisionState.difficulty
    : card.memory_state?.difficulty;
  const retrievability = adaptiveState && adaptiveState.stability > 0
    ? adaptiveRetrievability(adaptiveState.stability, adaptiveState.elapsed)
    : precisionState && precisionState.stability > 0
    ? precisionRetrievability(
        precisionState.stability,
        card.last_review_date
          ? (Date.now() - new Date(card.last_review_date).getTime()) / (86400 * 1000)
          : 0
      )
    : (card.memory_state as any)?.retrievability;

  return (
    <div className="bg-card border border-border rounded-lg p-3 md:p-4 space-y-2 md:space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Flask className="w-4 h-4" />
          {getAlgorithmLabel(activeAlgorithm)}
        </div>
        <button
          onClick={() => setShowRaw((prev) => !prev)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {showRaw ? "Hide raw" : "Show raw"}
        </button>
      </div>

      <div className="text-xs text-muted-foreground">
        Stability {stability?.toFixed(2) ?? "n/a"} • Difficulty{" "}
        {difficulty?.toFixed(2) ?? "n/a"}
        {retrievability != null && (
          <> • Retrievability {(retrievability * 100).toFixed(1)}%</>
        )}
      </div>

      {adaptiveState && (
        <div className="text-xs text-muted-foreground">
          Reps {adaptiveState.repetition} • Lapses {adaptiveState.lapses}
        </div>
      )}
      {precisionState && (
        <div className="text-xs text-muted-foreground">
          Reps {precisionState.repetition} • Lapses {precisionState.lapses}
        </div>
      )}

      {isPrecisionScheduler(activeAlgorithm) && arenaStats && (
        <div className="text-xs text-muted-foreground">
          {settings.learning.precisionPureKernel ? (
            <span className="text-amber-500 font-semibold block mb-0.5">
              Pure {schedulerLabel("precision")} Mode (scheduling with M4 only; Arena weights not used):
            </span>
          ) : null}
          Arena{" "}
          {arenaStats.model_names
            .map((name, i) => `${name} ${Math.round(arenaStats.weights[i] ?? 0)}`)
            .join(" · ")}
          {arenaStats.r_metric != null && (
            <>
              {" "}• R-Metric {arenaStats.r_metric >= 0 ? "+" : ""}
              {arenaStats.r_metric.toFixed(1)}%
            </>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Info className="w-3 h-3" />
          Simulated next intervals
        </div>
        {previewIntervals?.grade_intervals ? (
          <div className="grid grid-cols-3 gap-2 text-xs">
            {previewIntervals.grade_intervals.map((interval, grade) => (
              <div key={grade} className="bg-muted/50 rounded-md p-1.5 md:p-2">
                <div className="text-muted-foreground">
                  {grade} · {["Blackout", "Wrong", "Almost", "Hard", "Good", "Easy"][grade] ?? ""}
                </div>
                <div className="text-foreground font-semibold">
                  {formatInterval(interval)}
                </div>
              </div>
            ))}
          </div>
        ) : previewIntervals ? (
          <div className="grid grid-cols-2 gap-2 text-xs">
            {([
              ["again", "Again"],
              ["hard", "Hard"],
              ["good", "Good"],
              ["easy", "Easy"],
            ] as const).map(([key, label]) => (
              <div key={key} className="bg-muted/50 rounded-md p-1.5 md:p-2">
                <div className="text-muted-foreground">{label}</div>
                <div className="text-foreground font-semibold">
                  {formatInterval(previewIntervals[key])}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No preview available.</div>
        )}
        <button
          onClick={() => setShowSuspendNote((prev) => !prev)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {showSuspendNote ? "Hide suspend simulation" : "Simulate suspension"}
        </button>
        {showSuspendNote && (
          <div className="text-[11px] text-muted-foreground">
            Suspension pauses scheduling; the next review is deferred until you unsuspend the card.
          </div>
        )}
      </div>

      {showRaw && (
        <pre className="text-[10px] whitespace-pre-wrap bg-background border border-border rounded p-2">
{JSON.stringify(card, null, 2)}
        </pre>
      )}
    </div>
  );
}
