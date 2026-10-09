import { useEffect, useRef } from "react";
import { useTabsStore } from "../stores/tabsStore";
import type { BackInput } from "./applicationBack";

export type ContextualBackHandler = (input?: BackInput) => boolean;
export type ContextualBackOwner = { scope: "view"; paneId: string; tabId: string } | { scope: "global" };
export interface ContextualBackOptions {
  priority?: number;
  owner?: ContextualBackOwner;
  isEligible?: () => boolean;
}

interface ContextualBackEntry {
  id: symbol;
  handler: ContextualBackHandler;
  priority: number;
  order: number;
  owner?: ContextualBackOwner;
  isEligible?: () => boolean;
}

const entries: ContextualBackEntry[] = [];
let order = 0;

function isContextualEntryEligible(entry: ContextualBackEntry): boolean {
  if (entry.owner?.scope === "view") {
    const state = useTabsStore.getState();
    const pane = state.findPaneContainingTab(entry.owner.tabId);
    if (!pane || pane.id !== entry.owner.paneId || pane.activeTabId !== entry.owner.tabId) return false;
    if (state.navigationPaneId && state.navigationPaneId !== pane.id) return false;
  }
  return !entry.isEligible || entry.isEligible();
}

export function registerContextualBackHandler(
  handler: ContextualBackHandler,
  priorityOrOptions: number | ContextualBackOptions = 0,
): () => void {
  const options = typeof priorityOrOptions === "number" ? { priority: priorityOrOptions } : priorityOrOptions;
  const entry: ContextualBackEntry = {
    id: Symbol("contextual-back"),
    handler,
    priority: options.priority ?? 0,
    order: order++,
    owner: options.owner,
    isEligible: options.isEligible,
  };
  entries.push(entry);

  return () => {
    const index = entries.findIndex((candidate) => candidate.id === entry.id);
    if (index >= 0) entries.splice(index, 1);
  };
}

export function requestContextualBack(input?: BackInput): boolean {
  const ordered = [...entries].sort(
    (a, b) => b.priority - a.priority || b.order - a.order,
  );
  for (const entry of ordered) {
    if (!isContextualEntryEligible(entry)) continue;
    if (entry.handler(input)) return true;
  }
  return false;
}

export function useContextualBack(
  handler: ContextualBackHandler,
  options: ContextualBackOptions,
): void {
  const ownerScope = options.owner?.scope;
  const paneId = options.owner?.scope === "view" ? options.owner.paneId : undefined;
  const tabId = options.owner?.scope === "view" ? options.owner.tabId : undefined;
  const priority = options.priority ?? 0;
  const isEligible = options.isEligible;
  const handlerRef = useRef(handler);
  const eligibilityRef = useRef(isEligible);
  handlerRef.current = handler;
  eligibilityRef.current = isEligible;
  useEffect(
    () => registerContextualBackHandler((input) => handlerRef.current(input), {
      priority,
      owner: ownerScope === "global" ? { scope: "global" } : paneId && tabId ? { scope: "view", paneId, tabId } : undefined,
      isEligible: () => eligibilityRef.current?.() ?? true,
    }),
    [ownerScope, paneId, priority, tabId],
  );
}

export function resetContextualBackHandlersForTests() {
  entries.splice(0, entries.length);
  order = 0;
}
