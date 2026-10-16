import { useSavedQueueStore } from "../stores/savedQueueStore";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useTabsStore } from "../stores/tabsStore";
import { useIsActiveTab, usePaneId, useTabId } from "../components/common/Tabs/TabContent";
import { t } from "../lib/i18n";

export type DestinationAction =
  | { destination: "queue"; action: "manage" | "new" }
  | { destination: "queue"; action: "select" | "start"; queueId: string }
  | { destination: "documents"; action: "import" }
  | { destination: "review"; action: "create-card" }
  | { destination: "settings"; action: "section"; section: string };

export type DestinationRequest = DestinationAction & {
  id: number;
  paneId?: string;
  tabId?: string;
};

interface DestinationState {
  pending: DestinationRequest | null;
}

export const useDestinationActionStore = create<DestinationState>(() => ({ pending: null }));
let nextId = 0;
let finish: ((error?: Error) => void) | undefined;

export function settleDestinationAction(id: number, error?: Error): void {
  if (useDestinationActionStore.getState().pending?.id !== id) return;
  const complete = finish;
  finish = undefined;
  useDestinationActionStore.setState({ pending: null });
  complete?.(error);
}

/** Publish before navigation; destination acknowledges only after doing the work. */
export function requestDestinationAction(action: DestinationAction): Promise<void> {
  const old = useDestinationActionStore.getState().pending;
  if (old) settleDestinationAction(old.id, new DOMException("Superseded", "AbortError"));
  const tabs = useTabsStore.getState();
  const request: DestinationRequest = { ...action, id: ++nextId, paneId: tabs.navigationPaneId ?? tabs.getTabPaneIds()[0] };
  return new Promise<void>((resolve, reject) => {
    const onNavigate = (event: Event) => {
      if ((event as CustomEvent).detail !== `/${action.destination}`) {
        settleDestinationAction(request.id, new DOMException("Navigation cancelled", "AbortError"));
      }
    };
    const unsubscribe = useTabsStore.subscribe((state) => {
      const current = useDestinationActionStore.getState().pending;
      if (!current?.tabId || current.id !== request.id) return;
      const pane = state.findPaneById(current.paneId!);
      if (!pane || pane.type !== "tabs" || pane.activeTabId !== current.tabId) {
        settleDestinationAction(request.id, new DOMException("Destination closed", "AbortError"));
      }
    });
    const timeout = window.setTimeout(() => {
      settleDestinationAction(request.id, new Error(t("commandPalette.destinationUnavailable")));
    }, 30_000);
    finish = (error) => {
      clearTimeout(timeout);
      unsubscribe();
      window.removeEventListener("navigate", onNavigate);
      if (error) reject(error); else resolve();
    };
    window.addEventListener("navigate", onNavigate);
    useDestinationActionStore.setState({ pending: request });
    window.dispatchEvent(new CustomEvent("navigate", { detail: `/${action.destination}` }));
    const state = useTabsStore.getState();
    const destinationPaneId = state.navigationPaneId ?? request.paneId;
    const pane = destinationPaneId ? state.findPaneById(destinationPaneId) : null;
    const tab = pane?.type === "tabs" ? state.tabs.find((entry) => entry.id === pane.activeTabId) : null;
    if (tab?.type === action.destination && useDestinationActionStore.getState().pending?.id === request.id) {
      useDestinationActionStore.setState({ pending: { ...request, paneId: destinationPaneId, tabId: tab.id } });
    }
  });
}

export async function startPaletteScrollSession(): Promise<void> {
  const queueId = useSavedQueueStore.getState().activeQueueId;
  if (queueId) {
    await useSavedQueueStore.getState().activateSavedQueue(queueId);
    return requestDestinationAction({ destination: "queue", action: "start", queueId });
  }
  window.dispatchEvent(new CustomEvent("navigate", { detail: "/queue-scroll" }));
  return Promise.resolve();
}

/** Only the addressed active instance consumes a request, even with split panes. */
export function useDestinationAction(
  destination: DestinationAction["destination"],
  handler: (request: DestinationRequest) => void | Promise<void>,
  ready = true,
): void {
  const request = useDestinationActionStore((state) => state.pending);
  const active = useIsActiveTab();
  const paneId = usePaneId();
  const tabId = useTabId();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const running = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || !active || !request || request.destination !== destination || running.current === request.id) return;
    if (request.paneId && paneId !== request.paneId) return;
    if (request.tabId && tabId !== request.tabId) return;
    running.current = request.id;
    void Promise.resolve().then(() => {
      if (useDestinationActionStore.getState().pending?.id !== request.id) return;
      return handlerRef.current(request);
    }).then(
      () => settleDestinationAction(request.id),
      (error) => settleDestinationAction(request.id, error instanceof Error ? error : new Error(String(error))),
    );
  }, [request, destination, ready, active, paneId, tabId]);
}
