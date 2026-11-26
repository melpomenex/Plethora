import { useEffect } from "react";
import { BookOpen, Brain, CaretRight, Play, Scissors, Stack } from "@phosphor-icons/react";
import { useQueueStore } from "../../../stores/queueStore";
import type { QueueItem } from "../../../types/queue";

export interface UpNextQueueWidgetProps {
  onOpenQueue: () => void;
  onOpenScrollMode: () => void;
  onOpenItem: (item: QueueItem) => void;
}

export function UpNextQueueWidget({
  onOpenQueue,
  onOpenScrollMode,
  onOpenItem,
}: UpNextQueueWidgetProps) {
  const items = useQueueStore((s) => s.items);
  const filteredItems = useQueueStore((s) => s.filteredItems);
  const isLoading = useQueueStore((s) => s.isLoading);
  const loadQueue = useQueueStore((s) => s.loadQueue);

  useEffect(() => {
    if (items.length === 0) {
      void loadQueue().catch(() => {});
    }
  }, [items.length, loadQueue]);

  const previewItems = (filteredItems.length > 0 ? filteredItems : items).slice(0, 4);

  const getItemIcon = (item: QueueItem) => {
    if (item.itemType === "learning-item") return Brain;
    if (item.itemType === "extract") return Scissors;
    return BookOpen;
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-blue-500/10 p-1.5 text-blue-500">
            <Stack className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Up Next in Queue</h3>
            <p className="text-[11px] text-muted-foreground">
              {previewItems.length > 0 ? `${items.length} items queued` : "Your reading & review queue"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenScrollMode}
            className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Play className="h-3 w-3" weight="fill" aria-hidden="true" />
            Scroll Mode
          </button>
          <button
            type="button"
            onClick={onOpenQueue}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            View all
            <CaretRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {isLoading && previewItems.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3">Loading queue items...</p>
      ) : previewItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center">
          <p className="text-xs text-muted-foreground">No items in your queue yet.</p>
          <button
            type="button"
            onClick={onOpenQueue}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            Open Reading Queue
          </button>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-background/50">
          {previewItems.map((item) => {
            const Icon = getItemIcon(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenItem(item)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent first:rounded-t-lg last:rounded-b-lg"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate text-xs md:text-sm font-medium text-foreground">
                    {item.documentTitle || "Untitled item"}
                  </span>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                  {item.itemType.replace("-", " ")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
