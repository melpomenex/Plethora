import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, DotsSixVertical, EyeSlash, Trash } from "@phosphor-icons/react";
import { IconButton } from "../md3";
import { Switch } from "../common/Switch";
import { cn } from "../../utils/cn";
import type { DashboardSectionId } from "../../stores/dashboardLayoutStore";

export interface DashboardCustomizeSectionFrameProps {
  sectionId: DashboardSectionId;
  label: string;
  isCustomizing: boolean;
  isVisible: boolean;
  isFirst: boolean;
  isLast: boolean;
  isDragging?: boolean;
  dropIndicator?: "before" | "after" | null;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleVisible: (visible: boolean) => void;
  onRemove?: () => void;
  removeLabel?: string;
  onDragHandlePointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  moveUpLabel: string;
  moveDownLabel: string;
  visibilityLabel: string;
  dragHandleLabel: string;
  hiddenBadgeLabel: string;
  children: ReactNode;
}

export function DashboardCustomizeSectionFrame({
  sectionId,
  label,
  isCustomizing,
  isVisible,
  isFirst,
  isLast,
  isDragging = false,
  dropIndicator = null,
  onMoveUp,
  onMoveDown,
  onToggleVisible,
  onRemove,
  removeLabel,
  onDragHandlePointerDown,
  moveUpLabel,
  moveDownLabel,
  visibilityLabel,
  dragHandleLabel,
  hiddenBadgeLabel,
  children,
}: DashboardCustomizeSectionFrameProps) {
  if (!isCustomizing) {
    return isVisible ? <>{children}</> : null;
  }

  return (
    <section
      data-dashboard-section-id={sectionId}
      data-dashboard-section-visible={isVisible ? "true" : "false"}
      aria-label={label}
      className={cn(
        "relative mb-6 md:mb-8 rounded-xl border p-3 md:p-4 transition-colors",
        isVisible
          ? "border-outline-variant bg-surface-container-low/40"
          : "border-dashed border-outline-variant/80 bg-surface-container-low/25 opacity-80",
        isDragging && "ring-2 ring-primary bg-surface-container/60",
      )}
    >
      {dropIndicator === "before" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-2.5 left-3 right-3 h-1 rounded-full bg-primary"
        />
      )}
      {dropIndicator === "after" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-2.5 left-3 right-3 h-1 rounded-full bg-primary"
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onPointerDown={onDragHandlePointerDown}
            aria-label={dragHandleLabel}
            className={cn(
              "md-state flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-lg text-on-surface-variant active:cursor-grabbing",
              "touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            )}
          >
            <DotsSixVertical className="h-5 w-5" weight="bold" aria-hidden="true" />
          </button>

          <span className="truncate text-sm font-semibold text-on-surface">
            {label}
          </span>

          {!isVisible && (
            <span className="inline-flex items-center gap-1 rounded-full border border-outline-variant bg-surface-container px-2.5 py-0.5 text-xs font-medium text-on-surface-variant">
              <EyeSlash className="h-3.5 w-3.5" aria-hidden="true" />
              {hiddenBadgeLabel}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <IconButton
            type="button"
            variant="standard"
            size="md"
            icon={ArrowUp}
            aria-label={moveUpLabel}
            disabled={isFirst}
            onClick={onMoveUp}
          />
          <IconButton
            type="button"
            variant="standard"
            size="md"
            icon={ArrowDown}
            aria-label={moveDownLabel}
            disabled={isLast}
            onClick={onMoveDown}
          />
          <Switch
            checked={isVisible}
            onCheckedChange={onToggleVisible}
            aria-label={visibilityLabel}
            touchTarget
          />
          {onRemove && (
            <IconButton
              type="button"
              variant="standard"
              size="md"
              icon={Trash}
              aria-label={removeLabel || `Remove ${label}`}
              onClick={onRemove}
              className="text-on-surface-variant hover:text-destructive"
            />
          )}
        </div>
      </div>

      {isVisible && <div className="mt-2">{children}</div>}
    </section>
  );
}
