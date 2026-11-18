/**
 * Persistent right-hand Context Inspector for a selected node in the
 * Knowledge Atlas, Focus Web, or Directory.
 */

import {
  ArrowSquareOut,
  BookOpen,
  Cards,
  Crosshair,
  Flame,
  Highlighter,
  Lightbulb,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import { GraphNodeType, type GraphNode } from "./KnowledgeGraph";
import type { GroupedNeighbors } from "./graphAtlasModel";
import { cn } from "../../utils/cn";

export interface KnowledgeContextInspectorProps {
  node: GraphNode;
  grouped: GroupedNeighbors;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
  onFocusNode: (nodeId: string) => void;
  onOpenInApp: (node: GraphNode) => void;
  onDeleteNode: (nodeId: string) => void;
}

function getTypeMeta(type: GraphNodeType) {
  switch (type) {
    case GraphNodeType.Document:
      return { label: "Document", icon: BookOpen, tone: "bg-primary/15 text-primary" };
    case GraphNodeType.Extract:
      return {
        label: "Extract",
        icon: Highlighter,
        tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      };
    case GraphNodeType.Concept:
      return {
        label: "Concept",
        icon: Lightbulb,
        tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
      };
    case GraphNodeType.Flashcard:
      return {
        label: "Flashcard",
        icon: Cards,
        tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      };
    default:
      return { label: "Item", icon: BookOpen, tone: "bg-muted text-muted-foreground" };
  }
}

function ConnectionGroup({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: GraphNode[];
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title} ({items.length})
      </h4>
      <div className="flex flex-col gap-1">
        {items.slice(0, 12).map((item) => {
          const meta = getTypeMeta(item.type);
          const Icon = meta.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-muted/60"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          );
        })}
        {items.length > 12 && (
          <p className="px-1 text-[11px] text-muted-foreground">
            +{items.length - 12} more connected items
          </p>
        )}
      </div>
    </div>
  );
}

export function KnowledgeContextInspector({
  node,
  grouped,
  onClose,
  onSelectNode,
  onFocusNode,
  onOpenInApp,
  onDeleteNode,
}: KnowledgeContextInspectorProps) {
  const meta = getTypeMeta(node.type);
  const Icon = meta.icon;
  const retrievability =
    typeof node.metadata?.retrievability === "number"
      ? node.metadata.retrievability
      : null;
  const isLeech = node.metadata?.isLeech === true;
  const interval =
    typeof node.metadata?.interval === "number" ? node.metadata.interval : null;

  return (
    <aside
      data-testid="knowledge-context-inspector"
      aria-label="Node inspector"
      className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card lg:w-96"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                meta.tone,
              )}
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
              {meta.label}
            </span>
            {isLeech && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                <Flame className="h-3 w-3" weight="fill" aria-hidden="true" />
                Leech
              </span>
            )}
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug text-foreground">
            {node.label}
          </h3>
          {node.category && (
            <p className="mt-0.5 text-xs text-muted-foreground">{node.category}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Primary Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onFocusNode(node.id)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Focus Web</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenInApp(node)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <ArrowSquareOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Open</span>
          </button>
        </div>

        {/* FSRS Memory Metrics */}
        {(retrievability !== null || interval !== null) && (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-background p-3 tabular-nums">
            {retrievability !== null && (
              <div>
                <p className="text-[11px] text-muted-foreground">Retrievability</p>
                <p className="text-sm font-semibold text-foreground">
                  {Math.round(retrievability * 100)}%
                </p>
              </div>
            )}
            {interval !== null && (
              <div>
                <p className="text-[11px] text-muted-foreground">Interval</p>
                <p className="text-sm font-semibold text-foreground">{interval}d</p>
              </div>
            )}
          </div>
        )}

        {/* Content / Excerpt */}
        {node.description && (
          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Content
            </h4>
            <p className="max-h-40 overflow-y-auto rounded-xl border border-border/60 bg-background p-3 text-xs leading-relaxed text-foreground/90">
              {node.description}
            </p>
          </div>
        )}

        {/* Tags */}
        {node.tags && node.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {node.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Grouped Connections */}
        <div className="space-y-3">
          <ConnectionGroup
            title="Parent / Source"
            items={grouped.parents}
            onSelect={onSelectNode}
          />
          <ConnectionGroup
            title="Linked Concepts"
            items={grouped.concepts}
            onSelect={onSelectNode}
          />
          <ConnectionGroup
            title="Extracts & Cards"
            items={grouped.children}
            onSelect={onSelectNode}
          />
          <ConnectionGroup
            title="Related"
            items={grouped.related}
            onSelect={onSelectNode}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => onOpenInApp(node)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <PencilSimple className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Edit in workspace</span>
        </button>
        <button
          type="button"
          onClick={() => onDeleteNode(node.id)}
          className="inline-flex items-center gap-1 text-xs font-medium text-destructive hover:underline"
        >
          <Trash className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Delete</span>
        </button>
      </div>
    </aside>
  );
}
