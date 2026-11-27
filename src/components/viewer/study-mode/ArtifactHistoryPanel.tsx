import React from "react";
import { ArrowCounterClockwise, ClockCounterClockwise, Trash } from "@phosphor-icons/react";
import type { StudyModeArtifact } from "../../../types/studyMode";

export interface ArtifactHistoryPanelProps {
  dismissedArtifacts: StudyModeArtifact[];
  onRestore: (artifactId: string) => void;
  onDeletePermanently: (artifactId: string) => void;
}

export const ArtifactHistoryPanel: React.FC<ArtifactHistoryPanelProps> = ({
  dismissedArtifacts,
  onRestore,
  onDeletePermanently,
}) => {
  if (dismissedArtifacts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted-foreground">
        No dismissed or archived study artifacts in this scope yet.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-border bg-card p-3 space-y-2"
      role="region"
      aria-label="Artifact History and Recovery"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <ClockCounterClockwise className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
        <span>Artifact History ({dismissedArtifacts.length})</span>
      </div>
      <ul className="space-y-2">
        {dismissedArtifacts.map((art) => (
          <li
            key={art.id}
            className="flex items-center justify-between gap-2 rounded border border-border bg-background/70 px-2.5 py-2 text-xs"
          >
            <div className="min-w-0">
              <div className="font-medium truncate">
                {String(art.payload.title ?? art.artifactType)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {art.artifactType} · {art.isStale ? "Prior revision" : "Dismissed"}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onRestore(art.id)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted text-foreground"
              >
                <ArrowCounterClockwise className="w-3 h-3" aria-hidden="true" />
                Restore
              </button>
              <button
                type="button"
                onClick={() => onDeletePermanently(art.id)}
                aria-label={`Delete ${String(art.payload.title ?? art.artifactType)} permanently`}
                className="inline-flex items-center p-1 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"
              >
                <Trash className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
