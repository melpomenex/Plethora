import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../utils/cn";

/**
 * Material 3 list item: leading/icon/content/trailing slots over a flat
 * surface-container row with state layers. Use inside lists and menus.
 */
export interface ListItemProps extends HTMLAttributes<HTMLDivElement> {
  headline: React.ReactNode;
  supporting?: React.ReactNode;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
  disabled?: boolean;
  selected?: boolean;
  compact?: boolean;
}

export const ListItem = forwardRef<HTMLDivElement, ListItemProps>(function ListItem(
  { headline, supporting, trailing, leading, disabled, selected, compact, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role="listitem"
      aria-disabled={disabled || undefined}
      aria-selected={selected ?? undefined}
      className={cn(
        "md-state flex w-full items-center gap-3 rounded-xl px-4 transition-colors",
        compact ? "min-h-10 py-1.5" : "min-h-12 py-2",
        selected ? "bg-secondary-container/60" : "bg-transparent",
        disabled ? "pointer-events-none opacity-40" : "cursor-pointer hover:bg-surface-container-high",
        className,
      )}
      {...props}
    >
      {leading && <span className="flex shrink-0 items-center text-on-surface-variant">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-on-surface", compact ? "text-sm" : "md-body-large")}>
          {headline}
        </span>
        {supporting && (
          <span className="mt-0.5 block truncate md-body-small text-on-surface-variant">{supporting}</span>
        )}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-on-surface-variant">{trailing}</span>}
    </div>
  );
});

export function Divider({ className, inset }: { className?: string; inset?: boolean }) {
  return (
    <hr
      className={cn("border-0 border-t border-outline-variant", inset && "ml-16", className)}
    />
  );
}
