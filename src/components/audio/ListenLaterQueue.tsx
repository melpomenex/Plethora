/**
 * Listen Later Queue Drawer (tasks 8.4 + 8.5)
 *
 * Reorderable queue of documents/articles for continuous audio playback:
 * jump to an item, remove/reorder, total duration, lazy vs. immediate
 * synthesis scheduling, and prefetch of the next item near the end of the
 * current one (wired in the audio player).
 */

import { useState } from "react";
import {
  X,
  Trash,
  Play,
  ArrowUp,
  ArrowDown,
  Clock,
  SpeakerHigh,
  Lightning,
  Hourglass,
  Cards,
} from "@phosphor-icons/react";
import { useListenLaterStore } from "../../stores/listenLaterStore";
import { useDocumentStore } from "../../stores/documentStore";
import { useTabsStore } from "../../stores/tabsStore";
import { formatAudioDuration } from "../../utils/audioEditionEstimation";
import { cn } from "../../utils";
import { createElement } from "react";
import { BookOpen, TextT } from "@phosphor-icons/react";

function fileTypeIcon(fileType: string) {
  switch (fileType) {
    case "epub":
      return createElement(BookOpen, { className: "w-4 h-4 text-blue-500" });
    case "pdf":
      return createElement(TextT, { className: "w-4 h-4 text-red-500" });
    default:
      return createElement(TextT, { className: "w-4 h-4 text-muted-foreground" });
  }
}

export function ListenLaterQueue({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queue = useListenLaterStore((s) => s.queue);
  const currentIndex = useListenLaterStore((s) => s.currentIndex);
  const schedulerMode = useListenLaterStore((s) => s.schedulerMode);
  const reorderQueue = useListenLaterStore((s) => s.reorderQueue);
  const removeItem = useListenLaterStore((s) => s.removeItem);
  const clearQueue = useListenLaterStore((s) => s.clearQueue);
  const setSchedulerMode = useListenLaterStore((s) => s.setSchedulerMode);
  const ensureItemSynthesized = useListenLaterStore((s) => s.ensureItemSynthesized);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!isOpen) return null;

  const totalDuration = queue.reduce((acc, item) => acc + item.durationSec, 0);

  const playItem = (documentId: string, title: string) => {
    void import("../viewer/DocumentViewerWrapper").then(({ DocumentViewer: PlayerTab }) => {
      useTabsStore.getState().addTab({
        title,
        icon: <SpeakerHigh className="w-4 h-4 text-primary" />,
        type: "document-viewer",
        content: PlayerTab,
        closable: true,
        data: {
          documentId,
          listenToEdition: true,
          autoPlay: true,
          initialJump: { kind: "audio", timeSeconds: 0 },
        },
      });
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="bg-card text-card-foreground border border-border w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        role="dialog"
        aria-modal="true"
        aria-label="Listen Later queue"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Cards size={20} weight="bold" />
            </div>
            <div>
              <h2 className="text-base font-semibold leading-tight">Listen Later</h2>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <Clock size={11} />
                {queue.length} items · {formatAudioDuration(totalDuration)} total
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="Close queue"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scheduler mode */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border/60">
          <span className="text-xs font-medium text-muted-foreground">Synthesis scheduling</span>
          <div className="flex items-center gap-1 bg-muted/60 border border-border rounded-lg p-1">
            <button
              onClick={() => setSchedulerMode("lazy")}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                schedulerMode === "lazy" ? "bg-card text-foreground shadow" : "text-muted-foreground"
              )}
              title="Synthesize each item only when it becomes current (prefetched near the end of the previous item)"
            >
              <Hourglass size={12} />
              Lazy
            </button>
            <button
              onClick={() => setSchedulerMode("immediate")}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                schedulerMode === "immediate" ? "bg-card text-foreground shadow" : "text-muted-foreground"
              )}
              title="Synthesize all queued items now"
            >
              <Lightning size={12} />
              Immediate
            </button>
          </div>
        </div>

        {/* Queue list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {queue.length === 0 && (
            <div className="p-10 text-center text-xs text-muted-foreground italic">
              Queue is empty. Add documents or articles from the library to listen continuously.
            </div>
          )}

          {queue.map((item, index) => {
            const isCurrent = index === currentIndex;
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                  isCurrent
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-card hover:border-primary/30"
                )}
              >
                <span className="text-[11px] font-mono text-muted-foreground w-5 text-center shrink-0">
                  {index + 1}
                </span>
                <span className="shrink-0">{fileTypeIcon(item.fileType)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{item.title}</span>
                    {isCurrent && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-primary/10 text-primary shrink-0">
                        Up now
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {item.author || "Unknown"} · {formatAudioDuration(item.durationSec)}
                    {item.isSynthesized ? " · ready" : item.editionId ? " · generating" : " · not synthesized"}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {!item.isSynthesized && (
                    <button
                      onClick={async () => {
                        setBusyId(item.id);
                        await ensureItemSynthesized(item);
                        setBusyId(null);
                      }}
                      disabled={busyId === item.id}
                      className="p-1.5 text-muted-foreground hover:text-primary rounded-lg hover:bg-muted transition-colors"
                      title="Synthesize now"
                      aria-label={`Synthesize ${item.title}`}
                    >
                      <Lightning size={14} className={busyId === item.id ? "animate-pulse" : ""} />
                    </button>
                  )}
                  <button
                    onClick={() => playItem(item.documentId, item.title)}
                    className="p-1.5 bg-primary text-primary-foreground rounded-full hover:scale-105 transition-transform"
                    title="Play"
                    aria-label={`Play ${item.title}`}
                  >
                    <Play size={12} className="fill-current" />
                  </button>
                  <button
                    onClick={() => reorderQueue(index, Math.max(0, index - 1))}
                    disabled={index === 0}
                    className="p-1 text-muted-foreground hover:text-foreground rounded disabled:opacity-30"
                    title="Move up"
                    aria-label={`Move ${item.title} up`}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    onClick={() => reorderQueue(index, Math.min(queue.length - 1, index + 1))}
                    disabled={index === queue.length - 1}
                    className="p-1 text-muted-foreground hover:text-foreground rounded disabled:opacity-30"
                    title="Move down"
                    aria-label={`Move ${item.title} down`}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    onClick={() => removeItem(item.id)}
                    className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                    title="Remove"
                    aria-label={`Remove ${item.title}`}
                  >
                    <Trash size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {queue.length > 0 && (
          <div className="px-6 py-3 border-t border-border flex justify-end">
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Clear all {queue.length} items?</span>
                <button
                  onClick={() => {
                    clearQueue();
                    setConfirmClear(false);
                  }}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-destructive text-white hover:opacity-90 transition-opacity"
                >
                  Yes, clear
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear queue
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
