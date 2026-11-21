import { Component, lazy, Suspense, useCallback, useRef, useState, type ReactNode } from "react";
import { ChartBar } from "@phosphor-icons/react";
import type { StatsItemType } from "../../api/item-stats";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";

// Lazily imported so the modal and the charting it pulls in stay out of the
// entry chunk no matter which surface offers the button.
const ItemStatsModal = lazy(() =>
  import("./ItemStatsModal").then((module) => ({ default: module.ItemStatsModal })),
);

interface ItemStatsErrorBoundaryProps {
  children: ReactNode;
  onClose: () => void;
  title: string;
}

interface ItemStatsErrorBoundaryState {
  error: Error | null;
}

/**
 * Contains rendering failures inside the auxiliary Statistics modal so a chart
 * or stats error never propagates to `TabErrorBoundary` and unmounts an active
 * PDF/EPUB reader.
 */
class ItemStatsErrorBoundary extends Component<
  ItemStatsErrorBoundaryProps,
  ItemStatsErrorBoundaryState
> {
  state: ItemStatsErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ItemStatsErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[ItemStatsButton] Statistics modal error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) this.props.onClose();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={this.props.title}
            className="w-full max-w-md rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl space-y-3"
          >
            <h2 className="text-sm font-semibold">{this.props.title}</h2>
            <p className="text-xs text-destructive break-words">{this.state.error.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={this.props.onClose}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Opens the Item Statistics view for one item.
 *
 * The same modal, with the same values, wherever it is triggered from — the
 * Queue's Details popover, the Documents library, the Reader, or Flashcard
 * Studio. Only the trigger differs.
 *
 * Focus returns to this button on dismissal, so a keyboard user is not
 * dropped at the top of the page.
 */

export interface ItemStatsButtonProps {
  itemType: StatsItemType;
  itemId: string;
  title: string;
  className?: string;
  /** Icon-only trigger for toolbars; the label stays as the accessible name. */
  iconOnly?: boolean;
}

export function ItemStatsButton({
  itemType,
  itemId,
  title,
  className,
  iconOnly = false,
}: ItemStatsButtonProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const label = t("itemStats.openStats");

  const handleClose = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors motion-reduce:transition-none hover:text-foreground",
          iconOnly ? "p-1.5" : "px-2 py-1",
          className,
        )}
      >
        <ChartBar className="h-4 w-4" />
        {!iconOnly && <span>{label}</span>}
      </button>

      {isOpen && (
        <ItemStatsErrorBoundary onClose={handleClose} title={title}>
          <Suspense fallback={null}>
            <ItemStatsModal
              itemType={itemType}
              itemId={itemId}
              title={title}
              onClose={handleClose}
            />
          </Suspense>
        </ItemStatsErrorBoundary>
      )}
    </>
  );
}
