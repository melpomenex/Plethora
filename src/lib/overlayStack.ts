import { useTabsStore } from "../stores/tabsStore";
import type { NavigationCompletion } from "./navigationFeedback";

export type OverlayDismiss = () => void;
export type OverlayOwner = { scope: "view"; paneId: string; tabId: string } | { scope: "global" };

interface OverlayOptions {
  priority?: number;
  owner?: OverlayOwner;
  isEligible?: () => boolean;
}

export function resolveOverlayOwner(paneId?: string, tabId?: string): OverlayOwner {
  return paneId && tabId ? { scope: "view", paneId, tabId } : { scope: "global" };
}

interface OverlayEntry {
  id: symbol;
  dismiss: OverlayDismiss;
  priority: number;
  order: number;
  owner?: OverlayOptions["owner"];
  isEligible?: () => boolean;
  claimed: boolean;
}

const entries: OverlayEntry[] = [];
let order = 0;

export function registerOverlayDismissal(
  dismiss: OverlayDismiss,
  priorityOrOptions: number | OverlayOptions = 0,
): () => void {
  const options = typeof priorityOrOptions === "number" ? { priority: priorityOrOptions } : priorityOrOptions;
  const entry: OverlayEntry = {
    id: Symbol("overlay"),
    dismiss,
    priority: options.priority ?? 0,
    order: order++,
    owner: options.owner,
    isEligible: options.isEligible,
    claimed: false,
  };
  entries.push(entry);
  return () => {
    const index = entries.findIndex((candidate) => candidate.id === entry.id);
    if (index >= 0) entries.splice(index, 1);
  };
}

export function requestOverlayBack(completion?: NavigationCompletion): boolean {
  const ordered = [...entries].sort(
    (a, b) => b.priority - a.priority || b.order - a.order,
  );
  const entry = ordered.find((candidate) => {
    if (candidate.owner?.scope === "view") {
      const pane = useTabsStore.getState().findPaneContainingTab(candidate.owner.tabId);
      if (!pane || pane.id !== candidate.owner.paneId || pane.activeTabId !== candidate.owner.tabId) return false;
      const navigationPaneId = useTabsStore.getState().navigationPaneId;
      if (navigationPaneId && navigationPaneId !== pane.id) return false;
    }
    return !candidate.isEligible || candidate.isEligible();
  });
  if (!entry) return false;
  if (entry.claimed) {
    completion?.suppress();
    return true;
  }
  entry.claimed = true;
  entry.dismiss();
  if (completion && !completion.isDeferred() && !completion.isFinished()) completion.complete();
  return true;
}

export function resetOverlayStackForTests() {
  entries.splice(0, entries.length);
  order = 0;
}

