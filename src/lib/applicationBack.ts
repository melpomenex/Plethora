import { useTabsStore } from "../stores/tabsStore";
import { requestContextualBack } from "./contextualBack";
import { requestOverlayBack } from "./overlayStack";

export interface BackInput {
  source: "android-system" | "edge-fallback" | "ui";
  id: string;
  intent?: "hierarchy" | "leave-view";
}

export type BackDispatch =
  | { kind: "consumed"; outcome: "completed" | "pending" | "blocked"; transitionId?: string }
  | { kind: "root" }
  | { kind: "unavailable" };

const RECENT_BACK_ID_LIMIT = 256;
const recentBackIds: string[] = [];
const recentBackIdSet = new Set<string>();
let dispatching = false;
let generatedBackId = 0;

function rememberBackId(id: string): boolean {
  if (!id || id.length > 128 || recentBackIdSet.has(id)) return false;
  recentBackIds.push(id);
  recentBackIdSet.add(id);
  if (recentBackIds.length > RECENT_BACK_ID_LIMIT) {
    const expired = recentBackIds.shift();
    if (expired) recentBackIdSet.delete(expired);
  }
  return true;
}

/**
 * Dispatch application back in visual-layer order. Each layer reports whether
 * it consumed the request so a gesture or native event causes one transition.
 */
export function dispatchApplicationBack(input: BackInput): BackDispatch {
  if (!rememberBackId(input.id)) return { kind: "consumed", outcome: "blocked" };
  if (dispatching) return { kind: "consumed", outcome: "pending" };
  dispatching = true;
  try {
    if (requestOverlayBack()) return { kind: "consumed", outcome: "pending" };
    if (requestContextualBack(input)) return { kind: "consumed", outcome: "pending" };
    if (useTabsStore.getState().goToPreviousTab()) {
      return { kind: "consumed", outcome: "completed", transitionId: input.id };
    }

    const state = useTabsStore.getState();
    if (!state.navigationReady && state.tabs.length === 0) return { kind: "unavailable" };
    const currentPane = state.navigationPaneId ? state.findPaneById(state.navigationPaneId) : null;
    const activeId = currentPane?.type === "tabs" ? currentPane.activeTabId : null;
    const activeTab = state.tabs.find((tab) => tab.id === activeId);
    if (activeTab?.type === "dashboard" || state.tabs.length === 0) return { kind: "root" };
    if (state.activateDashboardFallback()) {
      return { kind: "consumed", outcome: "completed", transitionId: input.id };
    }
    return { kind: "unavailable" };
  } catch {
    return { kind: "consumed", outcome: "blocked" };
  } finally {
    dispatching = false;
  }
}

export function requestApplicationBack(): boolean {
  return requestApplicationBackIntent("hierarchy");
}

export function requestApplicationBackIntent(intent: "hierarchy" | "leave-view"): boolean {
  const id = `ui-${Date.now()}-${++generatedBackId}`;
  return dispatchApplicationBack({ source: "ui", id, intent }).kind === "consumed";
}

export function resetApplicationBackForTests(): void {
  recentBackIds.splice(0, recentBackIds.length);
  recentBackIdSet.clear();
  dispatching = false;
  generatedBackId = 0;
}
