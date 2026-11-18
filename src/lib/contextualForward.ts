import { useEffect, useRef } from "react";
import { useTabsStore } from "../stores/tabsStore";
import type { ForwardInput } from "./applicationBack";
import type { NavigationCompletion } from "./navigationFeedback";

export type ContextualForwardHandler = (input?: ForwardInput, completion?: NavigationCompletion) => boolean;
export type ContextualForwardOwner = { scope: "view"; paneId: string; tabId: string } | { scope: "global" };
export interface ContextualForwardOptions {
  priority?: number;
  owner?: ContextualForwardOwner;
  isEligible?: () => boolean;
}

interface ContextualForwardEntry {
  id: symbol;
  handler: ContextualForwardHandler;
  priority: number;
  order: number;
  owner?: ContextualForwardOwner;
  isEligible?: () => boolean;
}

const entries: ContextualForwardEntry[] = [];
let order = 0;

function isContextualEntryEligible(entry: ContextualForwardEntry): boolean {
  if (entry.owner?.scope === "view") {
    const state = useTabsStore.getState();
    const pane = state.findPaneContainingTab(entry.owner.tabId);
    if (!pane || pane.id !== entry.owner.paneId || pane.activeTabId !== entry.owner.tabId) return false;
    if (state.navigationPaneId && state.navigationPaneId !== pane.id) return false;
  }
  return !entry.isEligible || entry.isEligible();
}

export function registerContextualForwardHandler(
  handler: ContextualForwardHandler,
  priorityOrOptions: number | ContextualForwardOptions = 0,
): () => void {
  const options = typeof priorityOrOptions === "number" ? { priority: priorityOrOptions } : priorityOrOptions;
  const entry: ContextualForwardEntry = {
    id: Symbol("contextual-forward"),
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

export function requestContextualForward(input?: ForwardInput, completion?: NavigationCompletion): boolean {
  const ordered = [...entries].sort(
    (a, b) => b.priority - a.priority || b.order - a.order,
  );
  for (const entry of ordered) {
    if (!isContextualEntryEligible(entry)) continue;
    if (entry.handler(input, completion)) {
      if (completion && !completion.isDeferred() && !completion.isFinished()) completion.complete();
      return true;
    }
  }
  return false;
}

export function useContextualForward(
  handler: ContextualForwardHandler,
  options: ContextualForwardOptions,
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
    () => registerContextualForwardHandler((input, completion) => handlerRef.current(input, completion), {
      priority,
      owner: ownerScope === "global" ? { scope: "global" } : paneId && tabId ? { scope: "view", paneId, tabId } : undefined,
      isEligible: () => eligibilityRef.current?.() ?? true,
    }),
    [ownerScope, paneId, priority, tabId],
  );
}

export function resetContextualForwardHandlersForTests() {
  entries.splice(0, entries.length);
  order = 0;
}
