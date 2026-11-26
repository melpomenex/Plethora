import { useEffect } from "react";
import { Bookmarks, Brain, Check } from "@phosphor-icons/react";
import { useSavedQueueStore } from "../../../stores/savedQueueStore";
import { useStudyDeckStore } from "../../../stores/studyDeckStore";
import { useCollectionStore } from "../../../stores/collectionStore";
import { cn } from "../../../utils/cn";

export interface SavedQueuesWidgetProps {
  onOpenQueue: () => void;
}

export function SavedQueuesWidget({ onOpenQueue }: SavedQueuesWidgetProps) {
  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const savedQueues = useSavedQueueStore((s) => s.savedQueues);
  const activeQueueId = useSavedQueueStore((s) => s.activeQueueId);
  const loadSavedQueues = useSavedQueueStore((s) => s.loadSavedQueues);
  const activateSavedQueue = useSavedQueueStore((s) => s.activateSavedQueue);

  const decks = useStudyDeckStore((s) => s.decks);
  const activeDeckIds = useStudyDeckStore((s) => s.activeDeckIds);
  const toggleDeckSelection = useStudyDeckStore((s) => s.toggleDeckSelection);

  useEffect(() => {
    if (savedQueues.length === 0) {
      void loadSavedQueues(activeCollectionId).catch(() => {});
    }
  }, [activeCollectionId, loadSavedQueues, savedQueues.length]);

  const handleSelectQueue = (queueId: string) => {
    void activateSavedQueue(queueId).then(() => {
      onOpenQueue();
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-cyan-500/10 p-1.5 text-cyan-500">
            <Bookmarks className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Saved Queues & Study Decks</h3>
            <p className="text-[11px] text-muted-foreground">
              Switch focus scope or launch a saved queue
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Saved Queues
          </p>
          {savedQueues.length === 0 ? (
            <p className="text-xs text-muted-foreground">No saved queues yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {savedQueues.slice(0, 6).map((q) => {
                const isActive = q.id === activeQueueId;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => handleSelectQueue(q.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      isActive
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background text-foreground hover:bg-accent",
                    )}
                  >
                    <Bookmarks className="h-3 w-3" aria-hidden="true" />
                    <span className="truncate max-w-[140px]">{q.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Study Decks
          </p>
          {decks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No study decks configured.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {decks.slice(0, 6).map((deck) => {
                const isActive = activeDeckIds.includes(deck.id);
                return (
                  <button
                    key={deck.id}
                    type="button"
                    onClick={() => toggleDeckSelection(deck.id)}
                    aria-pressed={isActive}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      isActive
                        ? "border-purple-500/40 bg-purple-500/10 text-purple-400"
                        : "border-border bg-background text-foreground hover:bg-accent",
                    )}
                  >
                    {isActive ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <Brain className="h-3 w-3" aria-hidden="true" />
                    )}
                    <span className="truncate max-w-[140px]">{deck.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
