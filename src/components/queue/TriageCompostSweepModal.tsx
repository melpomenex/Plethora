import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArrowUp,
  CheckCircle,
  Sparkle,
  Trash,
  X,
} from "@phosphor-icons/react";
import { isEditableEventTarget } from "./EndOfItemTriageBar";

export interface CompostCandidate {
  id: string;
  title: string;
  content: string;
  prioritySlider: number;
  postponeCount: number;
  documentTitle?: string;
}

export function getStaleCompostCandidates<
  T extends { postponeCount?: number; postpone_count?: number }
>(items: T[], minPostpones = 3): T[] {
  return items.filter(
    (item) => (item.postponeCount ?? item.postpone_count ?? 0) >= minPostpones
  );
}

export function buildFallbackCompostSummary(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "Archived extract summary.";
  const sentences = clean.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 0) {
    return sentences.slice(0, 2).join(" ").trim().slice(0, 220);
  }
  return clean.slice(0, 180);
}

export interface CompostReceiptEntry {
  id: string;
  title: string;
  action: "boosted" | "demoted" | "summarized" | "archived";
}

export interface TriageCompostSweepModalProps {
  isOpen: boolean;
  candidates: CompostCandidate[];
  onKeepAndBoost: (candidate: CompostCandidate, nextSlider: number) => Promise<void> | void;
  onDemoteToVault: (candidate: CompostCandidate) => Promise<void> | void;
  onSummarizeAndDrop: (
    candidate: CompostCandidate,
    summaryText: string
  ) => Promise<void> | void;
  onArchiveOrDelete: (candidate: CompostCandidate) => Promise<void> | void;
  onClose: () => void;
}

export function TriageCompostSweepModal({
  isOpen,
  candidates,
  onKeepAndBoost,
  onDemoteToVault,
  onSummarizeAndDrop,
  onArchiveOrDelete,
  onClose,
}: TriageCompostSweepModalProps) {
  const [cursor, setCursor] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [receipts, setReceipts] = useState<CompostReceiptEntry[]>([]);

  useEffect(() => {
    if (isOpen) {
      setCursor(0);
      setReceipts([]);
      setIsBusy(false);
    }
  }, [isOpen]);

  const current = cursor < candidates.length ? candidates[cursor] : null;

  const runAction = useCallback(
    async (action: CompostReceiptEntry["action"]) => {
      if (!current || isBusy) return;
      setIsBusy(true);
      try {
        if (action === "boosted") {
          const nextSlider = Math.max(1, current.prioritySlider - 15);
          await onKeepAndBoost(current, nextSlider);
        } else if (action === "demoted") {
          await onDemoteToVault(current);
        } else if (action === "summarized") {
          const summary = buildFallbackCompostSummary(current.content);
          await onSummarizeAndDrop(current, summary);
        } else {
          await onArchiveOrDelete(current);
        }
        setReceipts((prev) => [
          ...prev,
          { id: current.id, title: current.title, action },
        ]);
        setCursor((prev) => prev + 1);
      } finally {
        setIsBusy(false);
      }
    },
    [
      current,
      isBusy,
      onKeepAndBoost,
      onDemoteToVault,
      onSummarizeAndDrop,
      onArchiveOrDelete,
    ]
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        isEditableEventTarget(e.target) ||
        isEditableEventTarget(document.activeElement)
      ) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (!current) return;
      const lower = e.key.toLowerCase();
      if (lower === "j") {
        e.preventDefault();
        void runAction("boosted");
      } else if (lower === "k") {
        e.preventDefault();
        void runAction("demoted");
      } else if (lower === "l") {
        e.preventDefault();
        void runAction("summarized");
      } else if (e.key === "Backspace") {
        e.preventDefault();
        void runAction("archived");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, current, runAction, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-compost-sweep-modal="true"
      role="dialog"
      aria-modal="true"
      aria-label="Triage & Compost Queue Sweep"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h2 className="text-lg font-semibold">Triage & Compost Sweep</h2>
            <p className="text-xs text-muted-foreground">
              {current
                ? `Item ${cursor + 1} of ${candidates.length} • Postponed ${current.postponeCount}x`
                : `Sweep complete • ${receipts.length} processed`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sweep"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {current ? (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium text-foreground truncate">
                {current.documentTitle || current.title}
              </span>
              <span>Priority P{current.prioritySlider}</span>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-muted/25 p-4 text-sm leading-relaxed">
              {current.content}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runAction("boosted")}
                className="flex flex-col items-start gap-1 rounded-xl border border-border bg-muted/40 p-3 text-left text-xs hover:bg-muted transition-colors"
              >
                <span className="flex items-center gap-1.5 font-semibold text-emerald-500">
                  <ArrowUp className="h-3.5 w-3.5" />
                  Keep & Boost
                </span>
                <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
                  J
                </kbd>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runAction("demoted")}
                className="flex flex-col items-start gap-1 rounded-xl border border-border bg-muted/40 p-3 text-left text-xs hover:bg-muted transition-colors"
              >
                <span className="flex items-center gap-1.5 font-semibold text-amber-500">
                  <Archive className="h-3.5 w-3.5" />
                  Demote (+90d)
                </span>
                <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
                  K
                </kbd>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runAction("summarized")}
                className="flex flex-col items-start gap-1 rounded-xl border border-border bg-muted/40 p-3 text-left text-xs hover:bg-muted transition-colors"
              >
                <span className="flex items-center gap-1.5 font-semibold text-blue-500">
                  <Sparkle className="h-3.5 w-3.5" />
                  Summarize & Drop
                </span>
                <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
                  L
                </kbd>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runAction("archived")}
                className="flex flex-col items-start gap-1 rounded-xl border border-border bg-muted/40 p-3 text-left text-xs hover:bg-muted transition-colors"
              >
                <span className="flex items-center gap-1.5 font-semibold text-destructive">
                  <Trash className="h-3.5 w-3.5" />
                  Delete / Archive
                </span>
                <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
                  Backspace
                </kbd>
              </button>
            </div>
          </div>
        ) : (
          <div data-compost-receipt="true" className="mt-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-500 font-medium text-sm">
              <CheckCircle className="h-5 w-5" />
              <span>Session Receipt ({receipts.length} items triaged)</span>
            </div>
            {receipts.length > 0 && (
              <ul className="max-h-48 overflow-y-auto space-y-1.5 text-xs">
                {receipts.map((r) => (
                  <li
                    key={`${r.id}-${r.action}`}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
                  >
                    <span className="truncate">{r.title}</span>
                    <span className="font-mono uppercase text-[10px] text-muted-foreground">
                      {r.action}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
