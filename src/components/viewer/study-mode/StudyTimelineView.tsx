import React, { useMemo } from "react";
import { ArrowRight, LinkSimple, Sparkle } from "@phosphor-icons/react";
import type { StudyModeArtifact, StudySourceAnchor } from "../../../types/studyMode";
import { formatAnchorLocationLabel } from "../../../lib/study-plans/studyMode/anchoring";

export interface StudyTimelineEvent {
  order: number;
  label: string;
  dateOrStage?: string;
  description: string;
  quote?: string;
}

export interface StudyTimelineViewProps {
  artifact: StudyModeArtifact;
  onJumpToQuote?: (quote: string) => void;
  onInspectAnchor?: (anchor: StudySourceAnchor) => void;
  onExplainEvent?: (label: string) => void;
  onPracticeEvent?: () => void;
}

function parseEvents(payload: Record<string, unknown>): StudyTimelineEvent[] {
  if (!Array.isArray(payload.events)) return [];
  return (payload.events as Array<Record<string, unknown>>).map((ev, index) => ({
    order: typeof ev.order === "number" ? ev.order : index + 1,
    label: String(ev.label ?? `Step ${index + 1}`),
    dateOrStage: ev.dateOrStage ? String(ev.dateOrStage) : undefined,
    description: String(ev.description ?? ""),
    quote:
      typeof ev.quote === "string"
        ? ev.quote
        : typeof ev.sourceQuote === "string"
        ? ev.sourceQuote
        : undefined,
  }));
}

export const StudyTimelineView: React.FC<StudyTimelineViewProps> = ({
  artifact,
  onJumpToQuote,
  onInspectAnchor,
  onExplainEvent,
  onPracticeEvent,
}) => {
  const events = useMemo(() => parseEvents(artifact.payload), [artifact.payload]);
  const title = String(artifact.payload.title ?? "Sequence & Timeline");
  const anchors = useMemo(() => {
    if (!Array.isArray(artifact.anchors)) return [];
    return artifact.anchors.filter(
      (a): a is StudySourceAnchor =>
        Boolean(a && typeof a === "object" && "locator" in (a as Record<string, unknown>)),
    );
  }, [artifact.anchors]);

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No timeline events were found in this artifact. Try regenerating from a section with sequential steps or dates.
      </div>
    );
  }

  return (
    <section
      aria-label={title}
      className="rounded-xl border border-border bg-card p-5 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">
            {events.length} ordered {events.length === 1 ? "stage" : "stages"} grounded in the current study scope
          </p>
        </div>
        {onPracticeEvent && (
          <button
            type="button"
            onClick={onPracticeEvent}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors"
          >
            <span>Practice sequence</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <ol className="relative space-y-4 border-l-2 border-primary/30 pl-5">
        {events.map((ev, idx) => {
          const eventAnchor = anchors[idx] ?? null;
          const jumpQuote = ev.quote ?? eventAnchor?.quote;
          return (
            <li key={`${ev.order}-${idx}`} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[29px] top-1 flex h-6 w-6 items-center justify-center rounded-full border border-primary/40 bg-background text-[11px] font-semibold text-primary"
              >
                {ev.order}
              </span>
              <div className="rounded-lg border border-border/80 bg-background/80 p-3.5 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="text-sm font-semibold text-foreground">{ev.label}</h4>
                  {ev.dateOrStage && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      {ev.dateOrStage}
                    </span>
                  )}
                </div>
                {ev.description && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{ev.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {eventAnchor && onInspectAnchor ? (
                    <button
                      type="button"
                      onClick={() => onInspectAnchor(eventAnchor)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      <LinkSimple className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>{eventAnchor.label ?? formatAnchorLocationLabel(eventAnchor)}</span>
                    </button>
                  ) : jumpQuote && onJumpToQuote ? (
                    <button
                      type="button"
                      onClick={() => onJumpToQuote(jumpQuote)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      <LinkSimple className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>Verify in source</span>
                    </button>
                  ) : null}
                  {onExplainEvent && (
                    <button
                      type="button"
                      onClick={() => onExplainEvent(ev.label)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <Sparkle className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>Explain stage</span>
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
