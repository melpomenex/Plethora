/**
 * Knowledge Directory View — Scannable analytical tables/lists for
 * Concept Hubs & Bridges, Leech / Decay Hotspots, and Orphaned Documents.
 */

import { useState } from "react";
import {
  BookOpen,
  Crosshair,
  Flame,
  GitBranch,
  Highlighter,
  Lightbulb,
  LinkBreak,
  Cards,
} from "@phosphor-icons/react";
import { GraphNodeType } from "./KnowledgeGraph";
import type { DirectoryEntry, DirectoryInsights } from "./graphAtlasModel";
import { cn } from "../../utils/cn";

export interface KnowledgeDirectoryViewProps {
  insights: DirectoryInsights;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onFocusNode: (nodeId: string) => void;
}

type DirectoryTab = "hubs" | "hotspots" | "orphans";

function NodeTypeIcon({ type }: { type: GraphNodeType }) {
  switch (type) {
    case GraphNodeType.Document:
      return <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" />;
    case GraphNodeType.Extract:
      return <Highlighter className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
    case GraphNodeType.Concept:
      return <Lightbulb className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden="true" />;
    default:
      return <Cards className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
  }
}

function EntryRow({
  entry,
  isSelected,
  onSelect,
  onFocus,
}: {
  entry: DirectoryEntry;
  isSelected: boolean;
  onSelect: () => void;
  onFocus: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-primary/40",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <NodeTypeIcon type={entry.node.type} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {entry.node.label}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
            <span>{entry.clusterLabel}</span>
            <span>·</span>
            <span>{entry.degree} links</span>
            {entry.retrievability !== null && (
              <>
                <span>·</span>
                <span
                  className={cn(
                    entry.retrievability < 0.65
                      ? "text-destructive font-medium"
                      : entry.retrievability < 0.85
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {Math.round(entry.retrievability * 100)}% R
                </span>
              </>
            )}
            {entry.isLeech && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive/15 px-1.5 py-0.2 text-[10px] font-semibold text-destructive">
                <Flame className="h-2.5 w-2.5" weight="fill" aria-hidden="true" />
                Leech
              </span>
            )}
          </p>
        </div>
      </button>

      <button
        type="button"
        onClick={onFocus}
        title="Focus 1-hop web"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Focus Web</span>
      </button>
    </div>
  );
}

export function KnowledgeDirectoryView({
  insights,
  selectedNodeId,
  onSelectNode,
  onFocusNode,
}: KnowledgeDirectoryViewProps) {
  const [tab, setTab] = useState<DirectoryTab>("hubs");

  const tabs: Array<{ id: DirectoryTab; label: string; count: number; icon: typeof GitBranch }> = [
    { id: "hubs", label: "Connected Hubs", count: insights.hubs.length, icon: GitBranch },
    { id: "hotspots", label: "Memory Hotspots", count: insights.hotspots.length, icon: Flame },
    { id: "orphans", label: "Orphaned Docs", count: insights.orphans.length, icon: LinkBreak },
  ];

  const activeList =
    tab === "hubs"
      ? insights.hubs
      : tab === "hotspots"
        ? insights.hotspots
        : insights.orphans;

  return (
    <div
      data-testid="knowledge-directory-view"
      className="flex h-full flex-col overflow-hidden bg-background pt-14"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors tabular-nums",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{item.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px]",
                  active ? "bg-primary-foreground/20" : "bg-background/60",
                )}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeList.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center">
            <p className="text-sm font-medium text-foreground">Nothing to surface here</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {tab === "hotspots"
                ? "No low-retrievability or leech items match your current filters."
                : tab === "orphans"
                  ? "Every visible document has extracts or concept links."
                  : "No connected hubs found in the current filter."}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-2">
            {activeList.map((entry) => (
              <EntryRow
                key={entry.node.id}
                entry={entry}
                isSelected={selectedNodeId === entry.node.id}
                onSelect={() => onSelectNode(entry.node.id)}
                onFocus={() => onFocusNode(entry.node.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
