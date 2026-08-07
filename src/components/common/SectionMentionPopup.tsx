import { useMemo, useRef, useState, useEffect } from "react";
import { BookOpen, Hash, Selection } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SectionNode } from "../../utils/sectionIndex";
import { estimateTokens } from "../../utils/sectionIndex";
import { useI18n } from "../../lib/i18n";

interface SectionMentionPopupProps {
  tree: SectionNode[];
  flat: SectionNode[];
  query: string;
  selectedIndex: number;
  onSelect: (node: SectionNode) => void;
  onClose?: () => void;
  open: boolean;
  maxHeight?: number;
  /** Live document selection offered as the first entry when one exists. */
  selectionEntry?: SectionNode | null;
}

function matchesQuery(node: SectionNode, q: string): boolean {
  if (!q) return true;
  const lowerQ = q.toLowerCase();
  return (
    node.title.toLowerCase().includes(lowerQ) ||
    node.content.toLowerCase().includes(lowerQ)
  );
}

function scoreNode(node: SectionNode, q: string): number {
  if (!q) return 0;
  const lowerQ = q.toLowerCase();
  const titleLower = node.title.toLowerCase();
  const breadcrumbLower = node.breadcrumb.join(" > ").toLowerCase();
  const previewLower = node.preview.toLowerCase();

  let score = 0;

  if (titleLower.startsWith(lowerQ)) score += 100;
  else if (titleLower.includes(lowerQ)) score += 50;

  score += breadcrumbLower.includes(lowerQ) ? 20 : 0;
  score += previewLower.includes(lowerQ) ? 5 : 0;

  const titleWeight = titleLower.includes(lowerQ) ? 2 : 1;
  score *= titleWeight;

  score -= node.level * 0.5;

  return score;
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return (
    <>
      {before}
      <mark className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">{match}</mark>
      {after}
    </>
  );
}

export function SectionMentionPopup({
  tree: _tree,
  flat,
  query,
  selectedIndex,
  onSelect,
  open,
  maxHeight = 320,
  selectionEntry,
}: SectionMentionPopupProps) {
  const { t } = useI18n();
  const parentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!query) {
      const initial = new Set<string>();
      flat.slice(0, 3).forEach((n) => {
        if (n.children.length > 0) initial.add(n.id);
      });
      setExpanded(initial);
    }
  }, [flat, query]);

  // The live selection (when one exists and matches the query) is offered as
  // the first entry, ahead of the structural/heuristic sections.
  const entries = useMemo(() => {
    if (selectionEntry && matchesQuery(selectionEntry, query)) {
      return [selectionEntry, ...flat];
    }
    return flat;
  }, [selectionEntry, flat, query]);

  const filtered = useMemo(() => {
    if (!query) {
      return entries;
    }
    const scored = entries
      .map((n) => ({ node: n, score: scoreNode(n, query) }))
      // A selection entry matching only its deep content scores 0 with the
      // heading-oriented scorer but must still appear (and stay first).
      .filter((s) => s.score > 0 || (s.node.source === "selection" && matchesQuery(s.node, query)))
      .sort((a, b) => {
        const aSel = a.node.source === "selection" ? 1 : 0;
        const bSel = b.node.source === "selection" ? 1 : 0;
        return bSel - aSel || b.score - a.score || a.node.level - b.node.level;
      })
      .slice(0, 100)
      .map((s) => s.node);
    return scored;
  }, [entries, query]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });

  const useVirtual = filtered.length > 100;

  if (!open) return null;

  const isBareHash = !query;
  const hasSections = flat.length > 0;
  const showNoSectionsState = !hasSections && !selectionEntry;

  return (
    <div
      className="absolute bottom-full left-0 mb-2 w-[380px] max-w-[90vw] bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden flex flex-col"
      role="listbox"
      aria-label="Sections"
    >
      <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">
            {showNoSectionsState
              ? t("sectionMention.noSectionsAvailable")
              : isBareHash
              ? t("sectionMention.sectionsInDocument", { count: entries.length })
              : t("sectionMention.matchingSections", { count: filtered.length })}
          </span>
        </div>
        {!showNoSectionsState && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0">
            {isBareHash ? "Type to filter…" : `${filtered.length} results`}
          </span>
        )}
      </div>

      <div
        ref={parentRef}
        className="overflow-y-auto"
        style={{ maxHeight: `${maxHeight}px`, minHeight: "80px" }}
      >
        {showNoSectionsState ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {t("sectionMention.noSectionsAvailableBody")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No sections match "{query}"<br />
            <span className="text-xs">Try a different keyword or clear # to see all</span>
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
              const node = filtered[virtualItem.index];
              const isSelected = virtualItem.index === selectedIndex;
              return (
                <div
                  key={node.id}
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
                  <Row
                    node={node}
                    query={query}
                    isSelected={isSelected}
                    levelIndent={node.level}
                    onSelect={() => onSelect(node)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((node, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <Row
                  key={node.id}
                  node={node}
                  query={query}
                  isSelected={isSelected}
                  levelIndent={node.level}
                  onSelect={() => onSelect(node)}
                  showExpand={isBareHash && node.children.length > 0}
                  expanded={expanded.has(node.id)}
                  onToggleExpand={() => {
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      return next;
                    });
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="px-2 py-1.5 border-t border-border bg-muted/20 text-[10px] text-muted-foreground flex items-center gap-3">
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>Esc close</span>
        {isBareHash && <span>Tab expand</span>}
      </div>
    </div>
  );
}

function formatTokenCount(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
}

function getTokenBadgeClass(tokens: number): string {
  if (tokens < 1000) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
  }
  if (tokens <= 4000) {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20";
  }
  return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20";
}

function Row({
  node,
  query,
  isSelected,
  levelIndent,
  onSelect,
  showExpand,
  expanded,
  onToggleExpand,
}: {
  node: SectionNode;
  query: string;
  isSelected: boolean;
  levelIndent: number;
  onSelect: () => void;
  showExpand?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const breadcrumbStr = node.breadcrumb.length > 0 ? node.breadcrumb.join(" > ") : "";
  const tokens = useMemo(() => {
    return node.content ? estimateTokens(node.content) : 0;
  }, [node.content]);

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={`w-full text-left px-2.5 py-1.5 flex flex-col gap-0.5 hover:bg-muted transition-colors ${
        isSelected ? "bg-muted border-l-2 border-primary" : "border-l-2 border-transparent"
      }`}
      style={{ paddingLeft: `${8 + levelIndent * 8}px` }}
    >
      <div className="flex items-center gap-1.5 min-w-0 w-full">
        {showExpand && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.();
            }}
            className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {expanded ? "▾" : "▸"}
          </span>
        )}
        {node.source === "selection" ? (
          <Selection className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
        ) : node.level === 1 ? (
          <BookOpen className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />
        ) : (
          <Hash className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        )}
        <span className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">
          <HighlightMatch text={node.title} query={query} />
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {node.source === "selection" && (
            <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">
              Selection
            </span>
          )}
          {node.page && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
              p{node.page}
            </span>
          )}
          {tokens > 0 && (
            <span
              className={`text-[9px] font-mono font-medium px-1.5 py-0.5 rounded border transition-colors flex items-center gap-0.5 ${getTokenBadgeClass(
                tokens
              )}`}
              title={`${tokens.toLocaleString()} tokens`}
            >
              {formatTokenCount(tokens)} tokens
            </span>
          )}
        </div>
      </div>
      {(breadcrumbStr || node.preview) && (
        <div className="flex flex-col gap-0.5 ml-5 min-w-0">
          {breadcrumbStr && (
            <span className="text-[11px] text-muted-foreground truncate">
              <HighlightMatch text={breadcrumbStr} query={query} />
            </span>
          )}
          {node.preview && (
            <span className="text-[11px] text-muted-foreground/80 truncate">
              {node.preview.slice(0, 80)}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
