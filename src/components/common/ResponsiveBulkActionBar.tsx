import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DotsThreeVertical, X } from "@phosphor-icons/react";
import { useMobileShell } from "../../hooks/useMobileShell";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils/cn";
import {
  MobileContextMenuSheet,
  mobileSheetItemClass,
} from "./MobileContextMenuSheet";

export interface BulkActionItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "muted" | "destructive" | "primary";
  title?: string;
  /** When true, only appears in the mobile overflow sheet, not in the primary scroll bar */
  showInOverflowOnly?: boolean;
  /** When true, never appears in the mobile overflow sheet */
  hideInOverflow?: boolean;
}

export interface ResponsiveBulkActionBarProps {
  selectedCount: number;
  totalCount?: number;
  selectedCountLabel?: ReactNode;
  onClearSelection?: () => void;
  actions?: BulkActionItem[];
  children?: ReactNode;
  /**
   * How to render on desktop viewports.
   * "inline" (default) renders in-place within the page flow/header.
   * "floating" renders fixed floating at the bottom on desktop too.
   */
  desktopPresentation?: "inline" | "floating";
  /** Override mobile shell detection (e.g. for testing) */
  forceMobile?: boolean;
  className?: string;
  /** Extra content rendered next to the count badge (e.g. processing spinner) */
  extraLeading?: ReactNode;
  /** Test ID for automated tests */
  testId?: string;
  /** Optional custom title for the mobile overflow sheet */
  overflowSheetTitle?: ReactNode;
}

export function ResponsiveBulkActionBar({
  selectedCount,
  selectedCountLabel,
  onClearSelection,
  actions,
  children,
  desktopPresentation = "inline",
  forceMobile,
  className,
  extraLeading,
  testId = "responsive-bulk-action-bar",
  overflowSheetTitle,
}: ResponsiveBulkActionBarProps) {
  const { t } = useI18n();
  const isMobileShell = useMobileShell();
  const isMobile = forceMobile ?? isMobileShell;
  const [overflowOpen, setOverflowOpen] = useState(false);

  if (selectedCount <= 0) return null;

  const defaultCountLabel = `${selectedCount} selected`;
  const countDisplay = selectedCountLabel ?? defaultCountLabel;

  const desktopButtonClass = (variant: BulkActionItem["variant"]) => {
    switch (variant) {
      case "destructive":
        return "px-3 py-1.5 bg-destructive text-destructive-foreground rounded text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex items-center gap-1.5 shrink-0";
      case "muted":
        return "px-3 py-1.5 bg-muted text-foreground rounded text-sm hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0";
      case "primary":
        return "px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex items-center gap-1.5 shrink-0";
      default:
        return "px-3 py-1.5 bg-background border border-border rounded text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0";
    }
  };

  const mobileButtonClass = (variant: BulkActionItem["variant"]) => {
    switch (variant) {
      case "destructive":
        return "flex items-center gap-1.5 px-3 py-2 rounded-xl border border-destructive/30 bg-destructive/10 text-xs font-medium text-destructive hover:bg-destructive/20 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all shrink-0 min-h-[38px]";
      case "muted":
        return "flex items-center gap-1.5 px-3 py-2 rounded-xl bg-muted text-xs font-medium text-foreground hover:bg-muted/80 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all shrink-0 min-h-[38px]";
      case "primary":
        return "flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all shrink-0 min-h-[38px]";
      default:
        return "flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-card text-xs font-medium text-foreground hover:bg-muted active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all shrink-0 min-h-[38px]";
    }
  };

  const visibleActions = actions?.filter((act) => !act.showInOverflowOnly) ?? [];
  const overflowActions = actions?.filter((act) => !act.hideInOverflow) ?? [];
  const hasOverflow = actions && actions.length > 3;

  // Mobile Floating Toolbar Presentation
  if (isMobile) {
    const mobileContent = (
      <>
        <div
          role="toolbar"
          aria-label={typeof countDisplay === "string" ? countDisplay : "Bulk actions"}
          data-testid={testId}
          className={cn(
            "responsive-bulk-action-bar fixed left-1/2 z-40 -translate-x-1/2 w-[min(42rem,calc(100vw-1.5rem))]",
            "bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]",
            "rounded-2xl border border-border/80 bg-card/95 p-2 shadow-2xl backdrop-blur-md",
            "animate-in fade-in slide-in-from-bottom-3 duration-200",
            className
          )}
        >
          <div className="flex items-center gap-2 w-full">
            {/* Leading count badge + 1-tap clear button */}
            <div className="flex items-center gap-1 shrink-0 rounded-full bg-primary/15 pl-2.5 pr-1 py-1 text-xs font-semibold text-primary">
              <span className="whitespace-nowrap">{countDisplay}</span>
              {onClearSelection && (
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="rounded-full p-0.5 text-primary/80 hover:text-primary hover:bg-primary/20 active:scale-95 transition-all"
                  aria-label={t("common.clear") || "Clear selection"}
                  title={t("common.clear") || "Clear selection"}
                >
                  <X className="w-3.5 h-3.5" weight="bold" />
                </button>
              )}
            </div>

            {extraLeading}

            {/* Horizontal touch scroll track for actions */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-pan-x flex-nowrap shrink min-w-0 py-0.5">
              {actions ? (
                visibleActions.map((act) => (
                  <button
                    key={act.id}
                    type="button"
                    disabled={act.disabled}
                    onClick={act.onClick}
                    title={act.title}
                    className={mobileButtonClass(act.variant)}
                  >
                    {act.icon}
                    <span className="whitespace-nowrap">{act.label}</span>
                  </button>
                ))
              ) : (
                children
              )}
            </div>

            {/* Overflow "More" (⋯) button for mobile bottom sheet */}
            {hasOverflow && (
              <button
                type="button"
                onClick={() => setOverflowOpen(true)}
                className="shrink-0 flex items-center justify-center p-2 rounded-xl border border-border bg-card text-foreground hover:bg-muted active:scale-95 transition-colors min-h-[38px] min-w-[38px]"
                aria-label="More actions"
                title="More actions"
              >
                <DotsThreeVertical className="w-4 h-4" weight="bold" />
              </button>
            )}
          </div>
        </div>

        {/* Mobile Overflow Bottom Sheet */}
        {hasOverflow && (
          <MobileContextMenuSheet
            open={overflowOpen}
            onClose={() => setOverflowOpen(false)}
            title={
              overflowSheetTitle ?? (
                <div className="flex items-center justify-between">
                  <span>{countDisplay}</span>
                  {onClearSelection && (
                    <button
                      type="button"
                      onClick={() => {
                        setOverflowOpen(false);
                        onClearSelection();
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                    >
                      {t("common.clear") || "Clear"}
                    </button>
                  )}
                </div>
              )
            }
          >
            {overflowActions.map((act) => (
              <button
                key={act.id}
                type="button"
                disabled={act.disabled}
                onClick={() => {
                  setOverflowOpen(false);
                  act.onClick();
                }}
                className={cn(
                  mobileSheetItemClass,
                  act.variant === "destructive" && "text-destructive hover:bg-destructive/10",
                  act.disabled && "opacity-40 pointer-events-none"
                )}
              >
                {act.icon && (
                  <span className="w-5 h-5 flex items-center justify-center shrink-0">
                    {act.icon}
                  </span>
                )}
                <span className="flex-1 text-left">{act.label}</span>
              </button>
            ))}
          </MobileContextMenuSheet>
        )}
      </>
    );

    return typeof document !== "undefined"
      ? createPortal(mobileContent, document.body)
      : mobileContent;
  }

  // Desktop Floating Toolbar Presentation
  if (desktopPresentation === "floating") {
    return (
      <div
        role="toolbar"
        aria-label={typeof countDisplay === "string" ? countDisplay : "Bulk actions"}
        data-testid={testId}
        className={cn(
          "responsive-bulk-action-bar fixed bottom-6 left-1/2 z-40 -translate-x-1/2 w-[min(56rem,calc(100vw-2rem))]",
          "rounded-xl border border-border bg-card/90 p-3 shadow-2xl backdrop-blur-md flex items-center justify-between gap-3",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary whitespace-nowrap">
            {countDisplay}
          </span>
          {onClearSelection && (
            <button
              type="button"
              onClick={onClearSelection}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label={t("common.clear") || "Clear selection"}
              title={t("common.clear") || "Clear selection"}
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {extraLeading}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-nowrap">
          {actions
            ? actions.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  disabled={act.disabled}
                  onClick={act.onClick}
                  title={act.title}
                  className={desktopButtonClass(act.variant)}
                >
                  {act.icon}
                  <span className="whitespace-nowrap">{act.label}</span>
                </button>
              ))
            : children}
        </div>
      </div>
    );
  }

  // Desktop Inline Header Presentation (Default)
  return (
    <div
      role="toolbar"
      aria-label={typeof countDisplay === "string" ? countDisplay : "Bulk actions"}
      data-testid={testId}
      className={cn(
        "responsive-bulk-action-bar-inline p-3 bg-primary/10 border border-primary/20 rounded-md flex items-center justify-between gap-3",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-primary whitespace-nowrap">
          {countDisplay}
        </span>
        {onClearSelection && (
          <button
            type="button"
            onClick={onClearSelection}
            className="rounded-full p-1 text-primary/70 hover:text-primary hover:bg-primary/20 transition-colors"
            aria-label={t("common.clear") || "Clear selection"}
            title={t("common.clear") || "Clear selection"}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {extraLeading}
      </div>
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-nowrap">
        {actions
          ? actions.map((act) => (
              <button
                key={act.id}
                type="button"
                disabled={act.disabled}
                onClick={act.onClick}
                title={act.title}
                className={desktopButtonClass(act.variant)}
              >
                {act.icon}
                <span className="whitespace-nowrap">{act.label}</span>
              </button>
            ))
          : children}
      </div>
    </div>
  );
}
