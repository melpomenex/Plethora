import React from "react";
import { ArrowRight, Clock, Sparkle, WarningCircle } from "@phosphor-icons/react";
import type {
  ConceptProgressStatus,
  StudyProgressSnapshot,
} from "../../../lib/study-plans/studyMode/evidenceProgress";
import type { StudyModeViewTab } from "../../../types/studyMode";

export interface ProgressPanelProps {
  snapshot: StudyProgressSnapshot;
  isLoadingEvidence: boolean;
  onStartRecommended: (tab: StudyModeViewTab) => void;
}

const STATUS_LABELS: Record<ConceptProgressStatus, string> = {
  "not-assessed": "Not assessed",
  "insufficient-evidence": "Insufficient evidence",
  "needs-attention": "Needs practice",
  developing: "Developing",
  "demonstrated-consistently": "Demonstrated",
};

const STATUS_CLASSES: Record<ConceptProgressStatus, string> = {
  "not-assessed": "bg-muted text-muted-foreground",
  "insufficient-evidence": "bg-muted text-muted-foreground",
  "needs-attention": "bg-destructive/15 text-destructive",
  developing: "bg-primary/15 text-primary",
  "demonstrated-consistently": "bg-primary text-primary-foreground",
};

export const ProgressPanel: React.FC<ProgressPanelProps> = ({
  snapshot,
  isLoadingEvidence,
  onStartRecommended,
}) => {
  return (
    <div className="space-y-4" data-testid="study-progress-panel">
      {/* Exposure vs. Understanding vs. Retention */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <div className="text-[11px] text-muted-foreground">Exposure</div>
          <div className="text-base font-semibold" data-testid="progress-exposure-value">
            {snapshot.exposure.supplementsViewed}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Supplements viewed · {snapshot.exposure.conceptsTouched} concept(s)
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <div className="text-[11px] text-muted-foreground">Understanding</div>
          <div className="text-base font-semibold" data-testid="progress-understanding-value">
            {snapshot.understanding.label}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {snapshot.understanding.insufficientEvidence
              ? "Insufficient evidence"
              : `${snapshot.understanding.needsPracticeCount} need(s) practice`}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <div className="text-[11px] text-muted-foreground">Retention</div>
          <div className="text-base font-semibold" data-testid="progress-retention-value">
            {snapshot.retention.label}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {snapshot.retention.hasFsrsEvidence
              ? "FSRS multi-day evidence"
              : "No FSRS reviews yet"}
          </div>
        </div>
      </div>

      {/* Actionable Recommended Next Session */}
      <div
        data-testid="progress-recommended-session"
        className="rounded-lg border border-primary/35 bg-primary/5 p-3.5 space-y-2 text-xs"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <Sparkle className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            <span>Recommended Next Session</span>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-background border border-border text-muted-foreground">
            <Clock className="w-3 h-3" aria-hidden="true" />
            ~{snapshot.recommendedNext.estimatedMinutes} min
          </span>
        </div>
        <div className="font-medium text-foreground">{snapshot.recommendedNext.title}</div>
        <p className="text-muted-foreground">{snapshot.recommendedNext.reason}</p>
        <button
          type="button"
          onClick={() => onStartRecommended(snapshot.recommendedNext.targetTab)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90"
        >
          Start Recommended Session
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Per-Concept Evidence Breakdown */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <h4 className="font-semibold text-foreground">Concept Evidence Breakdown</h4>
          {isLoadingEvidence && (
            <span className="text-[11px] text-muted-foreground">Syncing evidence...</span>
          )}
        </div>
        <ul className="space-y-2">
          {snapshot.concepts.map((concept) => (
            <li
              key={concept.conceptId}
              className="rounded-lg border border-border bg-card p-3 space-y-1.5 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{concept.conceptLabel}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${STATUS_CLASSES[concept.status]}`}
                >
                  {STATUS_LABELS[concept.status]}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                <span>Evidence records: {concept.evidenceCount}</span>
                <span>
                  Observed score:{" "}
                  {concept.observedMean !== null
                    ? `${Math.round(concept.observedMean * 100)}%`
                    : "Not assessed"}
                </span>
                {concept.uncertaintyReasons.length > 0 && (
                  <span>
                    Uncertainty: {concept.uncertaintyReasons.slice(0, 2).join(", ").replace(/-/g, " ")}
                  </span>
                )}
              </div>
              {concept.misconceptions.length > 0 && (
                <div className="flex items-start gap-1.5 pt-1 text-[11px] text-destructive">
                  <WarningCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{concept.misconceptions[0]}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
