import React, {
  Component,
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  memo,
} from "react";
import { useTabsStore, type Tab } from "../../../stores/tabsStore";
import { useI18n } from "../../../lib/i18n";

interface TabContentProps {
  tabs: Tab[];
  activeTabId: string | null;
  paneId?: string;
}

// Context to provide pane ID to tab content components
const PaneIdContext = createContext<string | undefined>(undefined);

/**
 * Hook to get the current pane ID from within a tab component.
 * Use this when you need to add tabs to the same pane.
 */
export function usePaneId(): string | undefined {
  return useContext(PaneIdContext);
}

// Context to provide tab active status to sub-components
const ActiveTabContext = createContext<boolean>(true);

export function useIsActiveTab(): boolean {
  return useContext(ActiveTabContext);
}

interface TabWrapperProps {
  content: React.ComponentType<any>;
  data?: Record<string, unknown>;
  isActive: boolean;
  paneId?: string;
}

const TabWrapper = memo(
  function TabWrapper({ content: ContentComponent, data, paneId }: TabWrapperProps) {
    return (
      <PaneIdContext.Provider value={paneId}>
        <ContentComponent {...(data || {})} />
      </PaneIdContext.Provider>
    );
  },
  (prevProps, nextProps) => {
    // If a tab is inactive and remains inactive, completely skip rendering!
    if (!prevProps.isActive && !nextProps.isActive) {
      return true;
    }
    // If it transitions from active to inactive, freeze its current render elements!
    if (prevProps.isActive && !nextProps.isActive) {
      return true;
    }
    // Tab data is updated immutably by the tabs store. Comparing the reference
    // avoids serializing every tab's restore payload on each activation while
    // still re-rendering when an explicit tab-data update creates a new object.
    return (
      prevProps.isActive === nextProps.isActive &&
      prevProps.content === nextProps.content &&
      prevProps.paneId === nextProps.paneId &&
      prevProps.data === nextProps.data
    );
  }
);

function TabLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div
          className="inline-block w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin"
          style={{ borderWidth: "3px" }}
        />
        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function TabErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="text-center max-w-md">
        <div className="text-4xl mb-3">⚠️</div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {t("tabs.contentError")}
        </h3>
        <p className="text-sm text-muted-foreground mb-4 break-words">{error.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
        >
          {t("tabs.retryLoad")}
        </button>
      </div>
    </div>
  );
}

interface TabErrorBoundaryProps {
  children: React.ReactNode;
  /** Bumped by the retry button to remount the subtree below. */
  resetKey: number;
  renderFallback: (error: Error) => React.ReactNode;
}

/**
 * Scoped to a single tab, so a tab that throws shows an error in its own area
 * instead of taking its pane — and every sibling tab — down with it.
 */
class TabErrorBoundary extends Component<TabErrorBoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: TabErrorBoundaryProps) {
    // A retry bumps `resetKey`; clear the captured error so children remount.
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error) {
    console.error("[TabContent] Tab content failed to render:", error);
  }

  render() {
    if (this.state.error) {
      return this.props.renderFallback(this.state.error);
    }
    return this.props.children;
  }
}

/**
 * One mounted tab: its own suspense boundary and its own error boundary.
 *
 * Both boundaries are per tab rather than per pane. A single boundary around
 * the whole pane meant any tab whose lazy chunk had not resolved replaced the
 * *pane's* content with the loader, and any tab that threw unmounted the pane.
 */
function MountedTab({ tab, isActive, paneId }: { tab: Tab; isActive: boolean; paneId?: string }) {
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((key) => key + 1), []);

  return (
    <TabErrorBoundary
      resetKey={retryKey}
      renderFallback={(error) => <TabErrorState error={error} onRetry={retry} />}
    >
      <Suspense fallback={<TabLoader />}>
        <TabWrapper
          key={retryKey}
          content={tab.content}
          data={tab.data}
          isActive={isActive}
          paneId={paneId}
        />
      </Suspense>
    </TabErrorBoundary>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-6xl mb-4">📭</div>
        <h3 className="text-xl font-semibold text-foreground mb-2">
          No tabs open
        </h3>
        <p className="text-muted-foreground">
          Open a tab to get started
        </p>
      </div>
    </div>
  );
}

export function TabContent({ tabs, activeTabId, paneId }: TabContentProps) {
  // Tabs this pane has actually shown. A tab is mounted only after it has been
  // active at least once: restoring a twelve-tab session used to mount twelve
  // component trees — twelve sets of mount effects, subscriptions and fetches —
  // to display one. Once mounted a tab stays mounted, so switching away and
  // back still preserves its state.
  //
  // This is tracked here, from renders this pane performed, rather than read
  // from the store, so `TabContent` remains drivable from plain props. The
  // store contributes only the other half: which tabs the resident cap has
  // evicted and must therefore come back down.
  const activatedRef = useRef<Set<string>>(new Set());
  const evictedTabIds = useTabsStore((state) => state.evictedTabIds);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    if (activeTab) activatedRef.current.add(activeTab.id);
  }, [activeTab]);

  if (!activeTab) {
    return <EmptyState />;
  }

  return (
    <div className="h-full w-full overflow-hidden bg-background min-h-0">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab.id;
        // The active tab mounts on this very render — the effect above has not
        // run yet the first time a tab is shown.
        const isMounted =
          isActive || (activatedRef.current.has(tab.id) && !evictedTabIds.has(tab.id));
        return (
          <div
            key={tab.id}
            className={isActive ? "h-full w-full animate-tab-enter" : "hidden h-full w-full"}
            aria-hidden={!isActive}
          >
            {isMounted && (
              <ActiveTabContext.Provider value={isActive}>
                <MountedTab tab={tab} isActive={isActive} paneId={paneId} />
              </ActiveTabContext.Provider>
            )}
          </div>
        );
      })}
    </div>
  );
}
