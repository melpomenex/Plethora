import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { usePaneId, useTabId, useIsActiveTab } from "../../common/Tabs/TabContent";
import { useTabsStore } from "../../../stores/tabsStore";
import type { AssistantContext } from "../AssistantPanel";
import { MobileAssistantRegistry } from "./contextRegistry";

interface MobileAssistantController { registry: MobileAssistantRegistry; open: () => void; setOpen: (handler: (() => void) | undefined) => void; dismiss: () => void; setDismiss: (handler: (() => void) | undefined) => void }
const Context = createContext<MobileAssistantController | null>(null);
export function MobileAssistantContextProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => {
    let openHandler: (() => void) | undefined;
    let dismissHandler: (() => void) | undefined;
    return { registry: new MobileAssistantRegistry(), open: () => openHandler?.(), setOpen: (handler: (() => void) | undefined) => { openHandler = handler; }, dismiss: () => dismissHandler?.(), setDismiss: (handler: (() => void) | undefined) => { dismissHandler = handler; } };
  }, []);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useMobileAssistantController() { return useContext(Context); }

/** Readers publish existing context; no text extraction or content listeners here. */
export function useRegisterMobileAssistant(context: AssistantContext | undefined, options: { revision: string; disabled?: boolean; priority?: number; controlsVisible?: boolean; unavailableReason?: string }) {
  const controller = useContext(Context);
  const ownerPaneId = usePaneId();
  const ownerTabId = useTabId();
  const active = useIsActiveTab();
  const latest = useRef(context);
  latest.current = context;
  // Position ticks stay in a ref. Submit samples the current authoritative reader.
  const source = context?.documentId ?? context?.url;
  const title = context?.metadata?.title;
  const status = context?.status;
  const transcriptStatus = context?.transcriptStatus;
  const selection = context?.selection;
  useEffect(() => {
    if (!controller || !ownerPaneId || !ownerTabId || !active || options.disabled || !latest.current) return;
    return controller.registry.register({
      ownerPaneId, ownerTabId, revision: options.revision, priority: options.priority,
      controlsVisible: options.controlsVisible, unavailableReason: options.unavailableReason,
      context: { ...latest.current, snapshotForSubmit: () => (latest.current?.documentId ?? latest.current?.url) === source ? latest.current ?? { type: "general" } : { type: "general" } },
    });
  }, [controller, ownerPaneId, ownerTabId, active, options.disabled, options.revision, options.priority, options.controlsVisible, options.unavailableReason, source, title, status, transcriptStatus, selection]);
}

export function useActiveMobileAssistantContext() {
  const controller = useContext(Context);
  const navigationPaneId = useTabsStore(s => s.navigationPaneId);
  const rootPane = useTabsStore(s => s.rootPane);
  const tabs = useTabsStore(s => s.tabs);
  const registry = controller?.registry;
  const subscribe = useCallback((listener: () => void) => registry?.subscribe(listener) ?? (() => {}), [registry]);
  const snapshot = useCallback(() => registry?.getSnapshot() ?? 0, [registry]);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  // Resolve through the same pane lookup used by overlay ownership.
  const activeTab = tabs.find(tab => {
    const pane = useTabsStore.getState().findPaneContainingTab(tab.id);
    return pane?.activeTabId === tab.id && (!navigationPaneId || pane.id === navigationPaneId);
  });
  const pane = activeTab ? useTabsStore.getState().findPaneContainingTab(activeTab.id) : undefined;
  const registration = registry?.resolve({ paneId: pane?.id, tabId: activeTab?.id });
  const removed = registration ? registry?.isRemoved(registration) : false;
  const context: AssistantContext = registration && !removed ? registration.context : { type: "general" };
  // rootPane is intentionally subscribed: activation changes without changing tabs.
  void rootPane;
  return { context, registration, removed, ownerKey: `${pane?.id ?? ""}:${activeTab?.id ?? ""}`, viewLabel: activeTab?.title ?? "Assistant", review: activeTab?.type === "review", remove: () => registration && registry?.remove(registration), restore: () => registration && registry?.restore(registration) };
}

/** Explicit interaction owners suspend invocation without observing reader gestures. */
export function useMobileAssistantBlock(reason: string, blocked: boolean) {
  const controller = useContext(Context);
  const ownerPaneId = usePaneId();
  const ownerTabId = useTabId();
  const active = useIsActiveTab();
  useEffect(() => {
    if (!blocked || !controller || !active || !ownerPaneId || !ownerTabId) return;
    controller.dismiss();
    return controller.registry.register({ ownerPaneId, ownerTabId, revision: reason, priority: 100,
      context: { type: "general" }, unavailableReason: reason });
  }, [controller, blocked, active, ownerPaneId, ownerTabId, reason]);
}
