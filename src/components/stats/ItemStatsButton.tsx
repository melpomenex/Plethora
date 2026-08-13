import { lazy, Suspense, useRef, useState } from "react";
import { ChartBar } from "@phosphor-icons/react";
import type { StatsItemType } from "../../api/item-stats";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";

// Lazily imported so the modal and the charting it pulls in stay out of the
// entry chunk no matter which surface offers the button.
const ItemStatsModal = lazy(() =>
  import("./ItemStatsModal").then((module) => ({ default: module.ItemStatsModal })),
);

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
        <Suspense fallback={null}>
          <ItemStatsModal
            itemType={itemType}
            itemId={itemId}
            title={title}
            onClose={() => {
              setIsOpen(false);
              buttonRef.current?.focus();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
