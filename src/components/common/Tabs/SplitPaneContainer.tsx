import { useState, useRef, useCallback, useEffect, memo, Fragment } from "react";
import { Pane, TabPane, SplitPane, SplitDirection, Tab } from "../../../stores/tabsStore";
import { useSettingsStore } from "../../../stores";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";

interface SplitPaneContainerProps {
  pane: Pane;
  tabs: Tab[];
  onSetActiveTab: (paneId: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onMoveTab: (fromIndex: number, toIndex: number, paneId: string) => void;
  onMoveTabToPane: (tabId: string, fromPaneId: string, toPaneId: string, targetIndex?: number) => void;
  onSplitPane: (paneId: string, tabId: string, direction: SplitDirection, side: "before" | "after") => void;
  onMoveTabToSplit: (tabId: string, fromPaneId: string, targetPaneId: string, direction: SplitDirection, side: "before" | "after") => void;
  onSpawnTabInSplit: (paneId: string, tabId: string, direction: SplitDirection, side: "before" | "after") => void;
  onResizeSplit: (splitPaneId: string, sizes: number[]) => void;
  onCollapseSplit: (splitPaneId: string, childPaneId: string) => void;
  draggedTabId: string | null;
  draggedTabSourcePaneId: string | null;
  onDragStart: (tabId: string, sourcePaneId: string) => void;
  onDragEnd: () => void;
}

// Drop indicator position
interface DropIndicator {
  paneId: string;
  position: "top" | "bottom" | "left" | "right" | "center";
}

/**
 * This pane's own tabs, with a stable array identity.
 *
 * The workspace holds one `tabs` array for every pane, so touching a single
 * tab gives every pane a new array and reconciles every pane's bar and content.
 * Slicing alone does not fix that — a fresh slice is still a fresh identity —
 * so the previous slice is reused whenever it holds the same tab objects in the
 * same order, which lets the memoized views below actually skip.
 */
function usePaneTabs(tabs: Tab[], tabIds: string[]): Tab[] {
  const cached = useRef<Tab[]>([]);
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const next: Tab[] = [];
  for (const id of tabIds) {
    const tab = byId.get(id);
    if (tab) next.push(tab);
  }
  const previous = cached.current;
  if (previous.length === next.length && previous.every((tab, index) => tab === next[index])) {
    return previous;
  }
  cached.current = next;
  return next;
}

export function SplitPaneContainer({
  pane,
  tabs,
  onSetActiveTab,
  onCloseTab,
  onMoveTab,
  onMoveTabToPane,
  onSplitPane,
  onMoveTabToSplit,
  onSpawnTabInSplit,
  onResizeSplit,
  onCollapseSplit,
  draggedTabId,
  draggedTabSourcePaneId,
  onDragStart,
  onDragEnd,
}: SplitPaneContainerProps) {
  if (pane.type === "split") {
    return (
      <SplitView
        pane={pane}
        tabs={tabs}
        onSetActiveTab={onSetActiveTab}
        onCloseTab={onCloseTab}
        onMoveTab={onMoveTab}
        onMoveTabToPane={onMoveTabToPane}
        onSplitPane={onSplitPane}
        onMoveTabToSplit={onMoveTabToSplit}
        onSpawnTabInSplit={onSpawnTabInSplit}
        onResizeSplit={onResizeSplit}
        onCollapseSplit={onCollapseSplit}
        draggedTabId={draggedTabId}
        draggedTabSourcePaneId={draggedTabSourcePaneId}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );
  }

  return (
    <TabPaneSlot
      pane={pane}
      tabs={tabs}
      onSetActiveTab={onSetActiveTab}
      onCloseTab={onCloseTab}
      onMoveTab={onMoveTab}
      onMoveTabToPane={onMoveTabToPane}
      onSplitPane={onSplitPane}
      onMoveTabToSplit={onMoveTabToSplit}
      onSpawnTabInSplit={onSpawnTabInSplit}
      draggedTabId={draggedTabId}
      draggedTabSourcePaneId={draggedTabSourcePaneId}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    />
  );
}

interface SplitViewProps extends Omit<SplitPaneContainerProps, "pane"> {
  pane: SplitPane;
}

function SplitView({
  pane,
  tabs,
  onSetActiveTab,
  onCloseTab,
  onMoveTab,
  onMoveTabToPane,
  onSplitPane,
  onMoveTabToSplit,
  onSpawnTabInSplit,
  onResizeSplit,
  onCollapseSplit,
  draggedTabId,
  draggedTabSourcePaneId,
  onDragStart,
  onDragEnd,
}: SplitViewProps) {
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const startSizesRef = useRef<number[]>([]);
  const resizeIndexRef = useRef(0);

  const handleResizeStart = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsResizing(true);
    startPosRef.current = { x: e.clientX, y: e.clientY };
    startSizesRef.current = [...pane.sizes];
    resizeIndexRef.current = index;

    document.body.style.cursor = pane.direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, [pane.sizes, pane.direction]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const delta = pane.direction === "horizontal"
        ? (e.clientX - startPosRef.current.x) / rect.width * 100
        : (e.clientY - startPosRef.current.y) / rect.height * 100;

      const newSizes = [...startSizesRef.current];
      const idx = resizeIndexRef.current;
      
      newSizes[idx] = Math.max(15, Math.min(85, newSizes[idx] + delta));
      newSizes[idx + 1] = Math.max(15, Math.min(85, 100 - newSizes[idx]));
      
      // Normalize to 100%
      const total = newSizes.reduce((a, b) => a + b, 0);
      const normalizedSizes = newSizes.map(s => s / total * 100);

      onResizeSplit(pane.id, normalizedSizes);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, pane.direction, pane.id, onResizeSplit]);

  const isHorizontal = pane.direction === "horizontal";

  return (
    <div
      ref={containerRef}
      className={`flex ${isHorizontal ? "flex-row" : "flex-col"} w-full h-full overflow-hidden`}
    >
      {pane.children.map((child, index) => (
        <Fragment key={child.id}>
          <div
            className="flex flex-col overflow-hidden"
            style={{ 
              flex: `0 0 ${pane.sizes[index]}%`,
              minWidth: isHorizontal ? "150px" : undefined,
              minHeight: !isHorizontal ? "100px" : undefined,
            }}
          >
            <SplitPaneContainer
              pane={child}
              tabs={tabs}
              onSetActiveTab={onSetActiveTab}
              onCloseTab={onCloseTab}
              onMoveTab={onMoveTab}
              onMoveTabToPane={onMoveTabToPane}
              onSplitPane={onSplitPane}
              onMoveTabToSplit={onMoveTabToSplit}
              onSpawnTabInSplit={onSpawnTabInSplit}
              onResizeSplit={onResizeSplit}
              onCollapseSplit={onCollapseSplit}
              draggedTabId={draggedTabId}
              draggedTabSourcePaneId={draggedTabSourcePaneId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          </div>
          
          {/* Resize Handle */}
          {index < pane.children.length - 1 && (
            <div
              className={`
                ${isHorizontal 
                  ? "w-1.5 hover:w-2.5 cursor-col-resize border-l border-border h-full" 
                  : "h-1.5 hover:h-2.5 cursor-row-resize border-t border-border w-full"
                }
                bg-muted/50 hover:bg-primary/30 transition-all flex-shrink-0
                active:bg-primary/50 relative group
              `}
              onMouseDown={(e) => handleResizeStart(index, e)}
              title="Drag to resize"
            >
              {/* Invisible touch/mouse target expansion for better UX */}
              <div 
                className={`absolute inset-0 ${
                  isHorizontal ? "-left-1.5 -right-1.5" : "-top-1.5 -bottom-1.5"
                }`}
              />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

interface TabPaneViewProps extends Omit<SplitPaneContainerProps, "pane" | "onResizeSplit" | "onCollapseSplit"> {
  pane: TabPane;
}

/**
 * Narrows the workspace-wide `tabs` array to this pane's own tabs before
 * handing off to the memoized view. Kept as its own (unmemoized) component so
 * the slice is computed in the parent's render — a slice computed *inside*
 * `TabPaneView` would still leave the full array in its props, and memo would
 * never skip.
 */
function TabPaneSlot({ pane, tabs, ...rest }: TabPaneViewProps) {
  const paneTabs = usePaneTabs(tabs, pane.tabIds);
  return <TabPaneView pane={pane} tabs={paneTabs} {...rest} />;
}

function TabPaneViewImpl({
  pane,
  tabs,
  onSetActiveTab,
  onCloseTab,
  onMoveTab,
  onMoveTabToPane,
  onSplitPane,
  onMoveTabToSplit,
  onSpawnTabInSplit,
  draggedTabId,
  draggedTabSourcePaneId,
  onDragStart,
  onDragEnd,
}: TabPaneViewProps) {
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Already narrowed to this pane by TabPaneSlot.
  const paneTabs = tabs;
  const activeTab = paneTabs.find((t) => t.id === pane.activeTabId);
  const splitViewSpawn = useSettingsStore((s) => s.settings.interface.splitViewSpawn);

  const shouldSpawnSplitForEvent = (e: React.MouseEvent) => {
    if (!splitViewSpawn) return false;
    if (e.button !== splitViewSpawn.button) return false;

    switch (splitViewSpawn.modifier) {
      case "none":
        return !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      case "ctrl":
        return e.ctrlKey;
      case "alt":
        return e.altKey;
      case "shift":
        return e.shiftKey;
      case "meta":
        return e.metaKey;
      default:
        return false;
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    
    if (!draggedTabId) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    // Calculate distances to each edge.
    // Use separate thresholds so left/right splitting doesn't become hard to trigger on short panes.
    const xEdgeThreshold = Math.min(180, Math.max(80, width * 0.25));
    const yEdgeThreshold = Math.min(140, Math.max(60, height * 0.2));
    
    const distLeft = x;
    const distRight = width - x;
    const distTop = y;
    const distBottom = height - y;
    
    let position: DropIndicator["position"];
    
    const inLeftZone = distLeft < xEdgeThreshold;
    const inRightZone = distRight < xEdgeThreshold;
    const inTopZone = distTop < yEdgeThreshold;
    const inBottomZone = distBottom < yEdgeThreshold;
    
    // Find the closest edge
    const minDist = Math.min(
      inLeftZone ? distLeft : Infinity,
      inRightZone ? distRight : Infinity,
      inTopZone ? distTop : Infinity,
      inBottomZone ? distBottom : Infinity
    );
    
    if (minDist === Infinity) {
      position = "center";
    } else if (minDist === distLeft) {
      position = "left";
    } else if (minDist === distRight) {
      position = "right";
    } else if (minDist === distTop) {
      position = "top";
    } else {
      position = "bottom";
    }

    setDropIndicator({ paneId: pane.id, position });
    setIsDraggingOver(true);
  }, [draggedTabId, pane.id]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only clear if leaving the container entirely
    if (!(e.relatedTarget instanceof Node) || !containerRef.current?.contains(e.relatedTarget)) {
      setDropIndicator(null);
      setIsDraggingOver(false);
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedTabId || !dropIndicator) {
      setDropIndicator(null);
      setIsDraggingOver(false);
      return;
    }

    const { position } = dropIndicator;

    if (position === "center") {
      // Move tab to this pane
      if (draggedTabSourcePaneId && draggedTabSourcePaneId !== pane.id) {
        onMoveTabToPane(draggedTabId, draggedTabSourcePaneId, pane.id);
      }
    } else {
      // Split pane
      const direction = position === "left" || position === "right" ? "horizontal" : "vertical";
      const side = position === "left" || position === "top" ? "before" : "after";

      if (draggedTabSourcePaneId === pane.id) {
        // Split own pane: the tab is here, so move it into a new sibling pane.
        onSplitPane(pane.id, draggedTabId, direction, side);
      } else if (draggedTabSourcePaneId) {
        // Tab lives in another pane — move it into a new pane beside this one.
        onMoveTabToSplit(draggedTabId, draggedTabSourcePaneId, pane.id, direction, side);
      }
    }

    setDropIndicator(null);
    setIsDraggingOver(false);
    onDragEnd();
  }, [draggedTabId, draggedTabSourcePaneId, dropIndicator, pane.id, onMoveTabToPane, onSplitPane, onMoveTabToSplit, onDragEnd]);

  // Stable identities so the memoized TabBar can actually skip: without these,
  // a re-render of this pane (a drag starting anywhere, for instance) would
  // hand the bar three fresh functions and force it to reconcile.
  const handleTabClick = useCallback(
    (tabId: string) => onSetActiveTab(pane.id, tabId),
    [onSetActiveTab, pane.id],
  );
  const handleTabMove = useCallback(
    (fromIndex: number, toIndex: number) => onMoveTab(fromIndex, toIndex, pane.id),
    [onMoveTab, pane.id],
  );
  const handleTabDragStart = useCallback(
    (tabId: string) => onDragStart(tabId, pane.id),
    [onDragStart, pane.id],
  );

  const getIndicatorStyles = () => {
    if (!dropIndicator || dropIndicator.paneId !== pane.id) return null;

    const baseClasses = "absolute bg-primary/50 border-2 border-primary z-50 pointer-events-none transition-all";
    
    switch (dropIndicator.position) {
      case "left":
        return `${baseClasses} left-0 top-0 bottom-0 w-1/2`;
      case "right":
        return `${baseClasses} right-0 top-0 bottom-0 w-1/2`;
      case "top":
        return `${baseClasses} top-0 left-0 right-0 h-1/2`;
      case "bottom":
        return `${baseClasses} bottom-0 left-0 right-0 h-1/2`;
      case "center":
        return `${baseClasses} inset-0 bg-primary/20`;
      default:
        return null;
    }
  };

  return (
    <div
      ref={containerRef}
      data-tab-pane={pane.id}
      className={`
        flex flex-col h-full w-full overflow-hidden
        ${isDraggingOver ? "ring-2 ring-primary/30" : ""}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
    >
      {/* Tab Bar */}
      <div className="flex-shrink-0">
        <TabBar
          tabs={paneTabs}
          activeTabId={pane.activeTabId}
          paneId={pane.id}
          onTabClick={handleTabClick}
          onTabClose={onCloseTab}
          onTabMove={handleTabMove}
          onMoveTabToPane={onMoveTabToPane}
          onDragStart={handleTabDragStart}
          onDragEnd={onDragEnd}
          onSplitPane={onSplitPane}
        />
      </div>

      {/* Tab Content */}
      <div
        className={`flex-1 min-h-0 relative ${draggedTabId ? "pointer-events-none" : ""}`}
        onMouseDownCapture={(e) => {
          if (!pane.activeTabId) return;
          if (!shouldSpawnSplitForEvent(e)) return;
          e.preventDefault();
          e.stopPropagation();
          // "horizontal" direction = split panes side-by-side (vertical divider).
          onSpawnTabInSplit(pane.id, pane.activeTabId, "horizontal", "after");
        }}
      >
        {activeTab ? (
          <TabContent tabs={paneTabs} activeTabId={pane.activeTabId} paneId={pane.id} />
        ) : (
          <EmptyPaneState />
        )}
        
        {/* Drop Indicator Overlay */}
        {getIndicatorStyles() && (
          <div className={getIndicatorStyles() || undefined}>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="bg-primary text-primary-foreground px-3 py-1 rounded text-sm font-medium shadow-lg">
                {dropIndicator?.position === "center" ? "Move here" : `Split ${dropIndicator?.position}`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Memoized: a pane re-renders only when its own tabs, its own pane node, or the
 * drag state change. Every callback it receives is a stable store action or a
 * `useCallback` from `Tabs`, and `updatePaneInTree` leaves sibling pane nodes
 * identity-stable, so a change confined to one pane stops at that pane.
 */
const TabPaneView = memo(TabPaneViewImpl);

function EmptyPaneState() {
  return (
    <div className="flex items-center justify-center h-full bg-background">
      <div className="text-center">
        <div className="text-6xl mb-4">📭</div>
        <h3 className="text-xl font-semibold text-foreground mb-2">
          No tabs in this pane
        </h3>
        <p className="text-muted-foreground">
          Drag a tab here to move it to this pane
        </p>
      </div>
    </div>
  );
}
