import { useEffect, useMemo, useState } from "react";
import { Archive, Books, Lightning, Scissors, X } from "@phosphor-icons/react";
import {
  splitDocumentByHeadings,
  type DocumentHeadingChunk,
} from "../../utils/documentHeadingSplitter";
import { isEditableEventTarget } from "../queue/EndOfItemTriageBar";

export type AirlockRouteTier = "active_course" | "evergreen" | "reference";

export interface AirlockCommitPayload {
  tier: AirlockRouteTier;
  prioritySlider: 10 | 65 | 95;
  status: "active" | "archived";
  title: string;
  chunks: DocumentHeadingChunk[];
}

export interface IngestionAirlockModalProps {
  isOpen: boolean;
  title: string;
  content: string;
  initialPreChunk?: boolean;
  onCommit: (payload: AirlockCommitPayload) => Promise<void> | void;
  onClose: () => void;
}

const TIER_CONFIG: Record<
  AirlockRouteTier,
  { prioritySlider: 10 | 65 | 95; status: "active" | "archived" }
> = {
  active_course: { prioritySlider: 10, status: "active" },
  evergreen: { prioritySlider: 65, status: "active" },
  reference: { prioritySlider: 95, status: "archived" },
};

export function IngestionAirlockModal({
  isOpen,
  title,
  content,
  initialPreChunk = false,
  onCommit,
  onClose,
}: IngestionAirlockModalProps) {
  const [editableTitle, setEditableTitle] = useState(title);
  const [preChunkByHeadings, setPreChunkByHeadings] = useState(initialPreChunk);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setEditableTitle(title);
  }, [title]);

  useEffect(() => {
    setPreChunkByHeadings(initialPreChunk);
  }, [initialPreChunk]);

  const chunks = useMemo(() => {
    if (!preChunkByHeadings) {
      return [
        {
          index: 0,
          heading: editableTitle || "Full Document",
          content: content.trim(),
          charLength: content.trim().length,
        },
      ];
    }
    return splitDocumentByHeadings(content);
  }, [content, editableTitle, preChunkByHeadings]);

  const commitTier = async (tier: AirlockRouteTier) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const cfg = TIER_CONFIG[tier];
      await onCommit({
        tier,
        prioritySlider: cfg.prioritySlider,
        status: cfg.status,
        title: editableTitle.trim() || title,
        chunks,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (isEditableEventTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "1") {
        event.preventDefault();
        void commitTier("active_course");
      } else if (event.key === "2") {
        event.preventDefault();
        void commitTier("evergreen");
      } else if (event.key === "3") {
        event.preventDefault();
        void commitTier("reference");
      } else if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        setPreChunkByHeadings((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ingestion Airlock"
      data-ingestion-airlock="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card text-foreground shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Ingestion Airlock</h2>
            <p className="text-xs text-muted-foreground">
              Route incoming material with [1], [2], or [3] before it enters your queue
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close airlock"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <div>
            <label
              htmlFor="airlock-title-input"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Document Title
            </label>
            <input
              id="airlock-title-input"
              type="text"
              value={editableTitle}
              onChange={(e) => setEditableTitle(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-medium">
                <Scissors className="h-4 w-4 text-primary" />
                <span>Pre-Chunk by Chapter / H2 Headings</span>
                <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  C
                </kbd>
              </span>
              <input
                type="checkbox"
                checked={preChunkByHeadings}
                onChange={(e) => setPreChunkByHeadings(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
            </label>

            {preChunkByHeadings && (
              <div
                data-airlock-chunk-preview="true"
                className="mt-2.5 space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground"
              >
                <div className="font-medium text-foreground">
                  Will split into {chunks.length} section{chunks.length === 1 ? "" : "s"}
                </div>
                <ul className="max-h-28 space-y-0.5 overflow-y-auto pl-3 list-disc">
                  {chunks.map((c) => (
                    <li key={c.index} className="truncate">
                      {c.heading} ({c.charLength} chars)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void commitTier("active_course")}
              className="flex flex-col items-start gap-1 rounded-xl border border-primary/40 bg-primary/10 p-3 text-left hover:bg-primary/20 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Lightning className="h-3.5 w-3.5" />
                Active Course [1]
              </span>
              <span className="text-[11px] text-muted-foreground">
                Priority 10 • Queue immediately
              </span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void commitTier("evergreen")}
              className="flex flex-col items-start gap-1 rounded-xl border border-border bg-background p-3 text-left hover:bg-muted disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Books className="h-3.5 w-3.5 text-emerald-500" />
                Evergreen [2]
              </span>
              <span className="text-[11px] text-muted-foreground">
                Priority 65 • Normal intake
              </span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void commitTier("reference")}
              className="flex flex-col items-start gap-1 rounded-xl border border-border bg-background p-3 text-left hover:bg-muted disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                Reference Only [3]
              </span>
              <span className="text-[11px] text-muted-foreground">
                Vault • Archived from SRS
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
