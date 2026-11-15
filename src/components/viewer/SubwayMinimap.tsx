import { ChatCircle, FileText, GitBranch, Scissors } from "@phosphor-icons/react";
import { cn } from "../../utils";

export type SubwayMasteryStatus = "mastered" | "in_queue" | "unread";

export function classifyNodeMastery(stats: {
  stability?: number;
  reps?: number;
  nextReview?: string | null;
}): SubwayMasteryStatus {
  if (stats.stability !== undefined && stats.stability >= 21) {
    return "mastered";
  }
  if ((stats.reps ?? 0) > 0 || Boolean(stats.nextReview)) {
    return "in_queue";
  }
  return "unread";
}

const MASTERY_META: Record<
  SubwayMasteryStatus,
  { label: string; dotClass: string; badgeClass: string }
> = {
  mastered: {
    label: "Mastered",
    dotClass: "bg-emerald-500",
    badgeClass: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  },
  in_queue: {
    label: "In Queue",
    dotClass: "bg-amber-500",
    badgeClass: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  },
  unread: {
    label: "Unread",
    dotClass: "bg-slate-400",
    badgeClass: "bg-muted text-muted-foreground border-border",
  },
};

export interface SubwayCardNode {
  id: string;
  label: string;
  itemType: string;
  stability?: number;
  reps?: number;
  nextReview?: string | null;
}

export interface SubwayExtractNode {
  id: string;
  title: string;
  stability?: number;
  reps?: number;
  nextReview?: string | null;
  cards: SubwayCardNode[];
}

export interface SubwayMinimapTarget {
  kind: "extract" | "card";
  id: string;
  extractId?: string;
}

export interface SubwayMinimapProps {
  documentTitle: string;
  extracts: SubwayExtractNode[];
  activeExtractId?: string;
  onSelectExtract?: (extractId: string) => void;
  onOpenSideBySide?: (target: SubwayMinimapTarget) => void;
  className?: string;
}

export function SubwayMinimap({
  documentTitle,
  extracts,
  activeExtractId,
  onSelectExtract,
  onOpenSideBySide,
  className,
}: SubwayMinimapProps) {
  return (
    <nav
      data-subway-minimap="true"
      aria-label="Document extract hierarchy minimap"
      className={cn(
        "rounded-xl border border-border bg-card/80 p-3 text-xs text-foreground",
        className
      )}
    >
      {/* Level 0: Root Document */}
      <div className="flex items-center gap-2 font-semibold text-foreground pb-2">
        <span className="h-3 w-3 rounded-full bg-primary shrink-0 ring-2 ring-primary/25" />
        <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="truncate" title={documentTitle}>
          {documentTitle}
        </span>
      </div>

      {/* Level 1: Child Extracts */}
      {extracts.length === 0 ? (
        <div className="ml-1.5 border-l-2 border-border pl-4 py-1 text-muted-foreground">
          No extracts yet
        </div>
      ) : (
        <ul className="ml-1.5 border-l-2 border-border pl-4 space-y-2">
          {extracts.map((ext) => {
            const extStatus = classifyNodeMastery(ext);
            const extMeta = MASTERY_META[extStatus];
            const isActive = activeExtractId === ext.id;

            return (
              <li key={ext.id} data-subway-extract-id={ext.id} className="relative">
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute -left-[21px] top-2 h-2.5 w-2.5 rounded-full border-2 border-background",
                    extMeta.dotClass
                  )}
                />
                <div
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors",
                    isActive ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/70"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectExtract?.(ext.id);
                      onOpenSideBySide?.({ kind: "extract", id: ext.id });
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <Scissors className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{ext.title}</span>
                  </button>
                  <span
                    className={cn(
                      "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium",
                      extMeta.badgeClass
                    )}
                  >
                    {extMeta.label}
                  </span>
                </div>

                {/* Level 2: Grandchild Flashcards */}
                {ext.cards.length > 0 && (
                  <ul className="ml-3 mt-1 border-l border-dashed border-border/80 pl-3 space-y-1">
                    {ext.cards.map((card) => {
                      const cardStatus = classifyNodeMastery(card);
                      const cardMeta = MASTERY_META[cardStatus];

                      return (
                        <li key={card.id} data-subway-card-id={card.id} className="relative">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute -left-[16px] top-2 h-2 w-2 rounded-full",
                              cardMeta.dotClass
                            )}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onOpenSideBySide?.({
                                kind: "card",
                                id: card.id,
                                extractId: ext.id,
                              })
                            }
                            className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/60 transition-colors"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <ChatCircle className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <span className="truncate text-muted-foreground">
                                {card.label}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded border px-1 py-0.5 text-[9px] font-medium",
                                cardMeta.badgeClass
                              )}
                            >
                              {cardMeta.label}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}

export { GitBranch as SubwayMinimapIcon };
