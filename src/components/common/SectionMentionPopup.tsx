import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { BookOpen, CaretDown, CaretRight, CircleNotch, Hash, Selection } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { estimateTokens } from "../../utils/sectionIndex";
import { useI18n } from "../../lib/i18n";
import {
  sectionPickerOptionId,
  type SectionPickerRow,
} from "./sectionPickerModel";
import { useAnchoredFloatingLayer } from "./useAnchoredFloatingLayer";

export interface SectionMentionPopupProps {
  /** Visible rows from `useSectionPicker`, already expanded/filtered. */
  rows: SectionPickerRow[];
  query: string;
  activeIndex: number;
  onSelect: (node: SectionPickerRow["node"]) => void;
  onToggleExpand?: (nodeId: string) => void;
  onClearQuery?: () => void;
  onClose?: () => void;
  open: boolean;
  /** The text input the picker anchors above. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Optional host panel/sheet used to clamp the floating layer. */
  hostRef?: RefObject<HTMLElement | null>;
  documentTitle?: string;
  topLevelCount?: number;
  totalSectionCount?: number;
  /** Preferred maximum height in px (the layer may be smaller). */
  maxHeight?: number;
  /** Stacking order for the portaled layer (defaults to the menu layer). */
  layerZIndex?: string;
  /**
   * When set, the popup explains why `#` cannot offer sections in this
   * context instead of listing sections or showing a dead end.
   */
  unavailableReason?: string | null;
  /** Explains an empty but available catalog (no extractable text). */
  emptyReason?: string | null;
  isLoading?: boolean;
  loadingLabel?: string;
}

function formatTokenCount(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
}

function getTokenBadgeClass(tokens: number): string {
  if (tokens === 0) {
    return "bg-muted text-muted-foreground border-border/30";
  }
  if (tokens < 1000) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
  }
  if (tokens <= 4000) {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20";
  }
  return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20";
}

/**
 * Shared `#` section picker. Purely presentational: the host owns expansion
 * and the active row (via `useSectionPicker`) and this component portals a
 * measured floating layer above the input, so no composer scroll container
 * can clip it.
 */
export function SectionMentionPopup({
  rows,
  query,
  activeIndex,
  onSelect,
  onToggleExpand,
  onClearQuery,
  onClose,
  open,
  anchorRef,
  hostRef,
  documentTitle,
  topLevelCount,
  totalSectionCount,
  maxHeight = 320,
  layerZIndex = "var(--md-z-menu)",
  unavailableReason = null,
  emptyReason = null,
  isLoading = false,
  loadingLabel,
}: SectionMentionPopupProps) {
  const { t } = useI18n();
  const parentRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useAnchoredFloatingLayer({
    open,
    anchorRef,
    layerRef,
    hostRef,
    preferredMaxHeight: maxHeight,
  });

  const useVirtual = rows.length > 60;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  const activeRow = rows[activeIndex] ?? rows[0];
  const activeDescendantId = activeRow
    ? sectionPickerOptionId(activeRow.node.id)
    : undefined;

  useEffect(() => {
    if (!open) return;
    if (useVirtual) {
      // jsdom has no scroll viewport; a real browser always does.
      if (parentRef.current && parentRef.current.clientHeight > 0) {
        virtualizer.scrollToIndex(activeIndex, { align: "auto" });
      }
      return;
    }
    const nodeId = rows[activeIndex]?.node.id;
    if (nodeId) {
      rowRefs.current.get(nodeId)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open, rows, useVirtual, virtualizer]);

  const total = totalSectionCount ?? rows.length;
  const topLevel = topLevelCount ?? rows.filter((row) => row.depth === 0).length;
  const isSearch = Boolean(query);
  const showNoSectionsState = rows.length === 0 && !isSearch;
  const isUnavailable = Boolean(unavailableReason);

  const headerLabel = isUnavailable
    ? t("sectionMention.unavailableTitle")
    : isLoading
      ? (loadingLabel ?? t("sectionMention.indexLoading"))
      : showNoSectionsState
        ? t("sectionMention.noSectionsAvailable")
        : isSearch
          ? t("sectionMention.matchingSections", { count: rows.length })
          : (documentTitle || t("sectionMention.sectionsInDocument", { count: total }));

  const countsLabel = !isUnavailable && !isLoading && !showNoSectionsState && !isSearch
    ? t("sectionMention.outlineCounts", { top: topLevel, total })
    : isSearch && rows.length > 0
      ? `${rows.length}`
      : null;

  const renderRow = (row: SectionPickerRow, index: number) => {
    const { node } = row;
    const tokens = node.content ? estimateTokens(node.content) : 0;
    const breadcrumb = node.breadcrumb.length > 0 ? node.breadcrumb.join(" > ") : "";
    const isSelected = index === activeIndex;
    return (
      <div
        key={node.id}
        id={sectionPickerOptionId(node.id)}
        ref={(element) => {
          if (element) rowRefs.current.set(node.id, element);
          else rowRefs.current.delete(node.id);
        }}
        role="option"
        aria-selected={isSelected}
        aria-expanded={row.hasChildren && !isSearch ? row.expanded : undefined}
        data-section-picker-option={node.id}
        data-section-picker-active={isSelected ? "true" : "false"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(node)}
        className={`w-full cursor-pointer text-left px-2.5 py-1.5 flex flex-col gap-0.5 transition-colors ${
          isSelected ? "bg-muted border-l-2 border-primary" : "border-l-2 border-transparent hover:bg-muted"
        }`}
        style={{ paddingLeft: `${8 + row.depth * 14}px` }}
      >
        <div className="flex min-w-0 w-full items-center gap-1.5">
          {row.hasChildren && !isSearch ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={
                row.expanded
                  ? t("sectionMention.collapseSection", { title: node.title })
                  : t("sectionMention.expandSection", { title: node.title })
              }
              aria-expanded={row.expanded}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand?.(node.id);
              }}
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {row.expanded ? (
                <CaretDown className="h-3 w-3" aria-hidden="true" />
              ) : (
                <CaretRight className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
          )}
          {node.source === "selection" ? (
            <Selection className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" aria-hidden="true" />
          ) : row.depth === 0 ? (
            <BookOpen className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" aria-hidden="true" />
          ) : (
            <Hash className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {node.title}
          </span>
          {row.hasChildren && (
            <span className="flex-shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {t("sectionMention.subsectionCount", { count: node.children.length })}
            </span>
          )}
          <div className="flex flex-shrink-0 items-center gap-1">
            {node.source === "selection" && (
              <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                {t("sectionMention.selectionBadge")}
              </span>
            )}
            {node.page && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                p{node.page}
              </span>
            )}
            <span
              className={`flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium ${getTokenBadgeClass(tokens)}`}
              title={tokens > 0 ? `${tokens.toLocaleString()} tokens` : undefined}
            >
              {tokens > 0 ? `${formatTokenCount(tokens)} tokens` : "-- tokens"}
            </span>
          </div>
        </div>
        {(breadcrumb || node.preview) && (
          <div className="ml-5 flex min-w-0 flex-col gap-0.5">
            {breadcrumb && (
              <span className="truncate text-[11px] text-muted-foreground">{breadcrumb}</span>
            )}
            {node.preview && (
              <span className="truncate text-[11px] text-muted-foreground/80">
                {node.preview.slice(0, 80)}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={layerRef}
      data-section-picker
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
      style={{ visibility: "hidden", zIndex: layerZIndex }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate text-xs font-medium text-foreground" title={headerLabel}>
            {headerLabel}
          </span>
        </div>
        {countsLabel && (
          <span className="flex-shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {countsLabel}
          </span>
        )}
      </div>

      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ minHeight: "80px" }}
      >
        <div
          role="listbox"
          aria-label={t("sectionMention.pickerLabel")}
          aria-activedescendant={activeDescendantId}
          data-section-picker-list
        >
          {isUnavailable ? (
            <div className="p-4 text-center text-sm text-muted-foreground" role="note">
              <Hash className="mx-auto mb-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {unavailableReason}
            </div>
          ) : isLoading ? (
            <div
              className="flex min-h-24 items-center justify-center gap-2 px-4 text-sm text-muted-foreground"
              role="status"
            >
              <CircleNotch className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <span>{loadingLabel ?? t("sectionMention.indexLoading")}</span>
            </div>
          ) : showNoSectionsState ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {emptyReason ?? t("sectionMention.noSectionsAvailableBody")}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <p className="m-0">{t("sectionMention.noResults", { query })}</p>
              <p className="m-0 mt-1 text-xs">{t("sectionMention.noResultsHint")}</p>
              {onClearQuery && (
                <button
                  type="button"
                  onClick={onClearQuery}
                  className="mt-2 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                >
                  {t("sectionMention.clearQuery")}
                </button>
              )}
            </div>
          ) : useVirtual ? (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const row = rows[virtualItem.index];
                if (!row) return null;
                return (
                  <div
                    key={row.node.id}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    {renderRow(row, virtualItem.index)}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-1">{rows.map((row, index) => renderRow(row, index))}</div>
          )}
        </div>
      </div>

      {!isLoading && !isUnavailable && !showNoSectionsState && (
        <div className="flex flex-col gap-1 border-t border-border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
          <span>{t("sectionMention.focusScopeNotice")}</span>
          <div className="flex items-center gap-3">
            <span>↑↓ navigate</span>
            <span>←→ expand</span>
            <span>↵ select</span>
            <span>Esc close</span>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="ml-auto rounded px-1 text-muted-foreground hover:text-foreground"
                aria-label={t("common.close")}
              >
                ×
              </button>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
