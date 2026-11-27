import React, { useMemo } from "react";
import { Clock, ListBullets, Path } from "@phosphor-icons/react";
import type { StudyModeSessionDuration } from "../../../types/studyMode";

export interface StudyPathStep {
  id: string;
  label: string;
  excerpt: string;
}

export interface LearningPathPaneProps {
  documentTitle: string;
  passageText: string;
  activeObjectiveId: string | null;
  sessionDurationMin: StudyModeSessionDuration;
  hasActiveSelection: boolean;
  studyPlanTopicLabel?: string | null;
  onSelectObjective: (step: StudyPathStep) => void;
  onChangeDuration: (duration: StudyModeSessionDuration) => void;
  onClearSelectionScope: () => void;
}

const DURATIONS: StudyModeSessionDuration[] = [5, 15, 30];

export function deriveStudyPathSteps(passageText: string, documentTitle: string): StudyPathStep[] {
  const blocks = passageText
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  if (blocks.length === 0) {
    return [
      {
        id: "step-0",
        label: documentTitle || "Current Passage",
        excerpt: passageText.trim().slice(0, 140),
      },
    ];
  }

  return blocks.slice(0, 12).map((block, index) => {
    const firstLine = block.split("\n")[0].replace(/^#+\s*/, "").trim();
    const label =
      firstLine.length > 48
        ? `${firstLine.slice(0, 45).trim()}…`
        : firstLine || `Section ${index + 1}`;
    return {
      id: `step-${index}`,
      label,
      excerpt: block,
    };
  });
}

export const LearningPathPane: React.FC<LearningPathPaneProps> = ({
  documentTitle,
  passageText,
  activeObjectiveId,
  sessionDurationMin,
  hasActiveSelection,
  studyPlanTopicLabel,
  onSelectObjective,
  onChangeDuration,
  onClearSelectionScope,
}) => {
  const steps = useMemo(
    () => deriveStudyPathSteps(passageText, documentTitle),
    [documentTitle, passageText]
  );

  return (
    <aside
      aria-label="Learning Path"
      className="flex flex-col h-full bg-card/40 text-foreground border-r border-border overflow-hidden"
    >
      <div className="px-3 py-2.5 border-b border-border space-y-2 shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Path className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          <span className="truncate">Learning Path</span>
        </div>
        {studyPlanTopicLabel && (
          <p className="text-[11px] text-muted-foreground truncate">{studyPlanTopicLabel}</p>
        )}
        <div className="flex items-center gap-1" role="group" aria-label="Session duration">
          <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mr-0.5" aria-hidden="true" />
          {DURATIONS.map((mins) => (
            <button
              key={mins}
              type="button"
              aria-pressed={sessionDurationMin === mins}
              onClick={() => onChangeDuration(mins)}
              className={`px-2 py-0.5 text-[11px] rounded font-medium transition-colors ${
                sessionDurationMin === mins
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {mins}m
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {hasActiveSelection && (
          <button
            type="button"
            onClick={onClearSelectionScope}
            className="w-full text-left px-2.5 py-1.5 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/15 mb-1.5"
          >
            ← Back to full passage
          </button>
        )}
        <div className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          <ListBullets className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Sections ({steps.length})</span>
        </div>
        {steps.map((step, index) => {
          const selected = activeObjectiveId === step.id || (!activeObjectiveId && index === 0);
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onSelectObjective(step)}
              className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors ${
                selected
                  ? "bg-primary/15 text-foreground font-medium ring-1 ring-primary/30"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <div className="truncate">
                <span className="text-[10px] opacity-70 mr-1.5">{index + 1}.</span>
                {step.label}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
};
