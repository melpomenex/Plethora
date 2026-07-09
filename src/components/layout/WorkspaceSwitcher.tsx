import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useTabsStore } from "../../stores/tabsStore";
import { getTabIcon } from "../tabs/TabIcons";
import { ActionButton } from "../common/UI";
import { useI18n } from "../../lib/i18n";

interface WorkspaceSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorkspaceSwitcher({ isOpen, onClose }: WorkspaceSwitcherProps) {
  const { t } = useI18n();
  const tabs = useTabsStore((state) => state.tabs);
  const rootPane = useTabsStore((state) => state.rootPane);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);
  const findPaneContainingTab = useTabsStore((state) => state.findPaneContainingTab);
  const getTabPaneIds = useTabsStore((state) => state.getTabPaneIds);
  const closedTabs = useTabsStore((state) => state.closedTabs);
  const reopenLastClosedTab = useTabsStore((state) => state.reopenLastClosedTab);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const openTabs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tabs
      .map((tab) => {
        const pane = findPaneContainingTab(tab.id);
        return {
          tab,
          paneId: pane?.id,
          isActive: pane?.activeTabId === tab.id,
          paneLabel: pane ? t("workspace.pane", { index: getTabPaneIds().indexOf(pane.id) + 1 }) : t("workspace.title"),
        };
      })
      .filter(({ tab }) => !normalizedQuery || tab.title.toLowerCase().includes(normalizedQuery));
  }, [findPaneContainingTab, query, rootPane, tabs]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("workspace.switchWorkspace")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <MagnifyingGlass className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            placeholder={t("workspace.searchOpenTabs")}
            aria-label={t("workspace.searchOpenTabs")}
          />
          <ActionButton variant="tertiary" size="icon" aria-label={t("workspace.closeSwitcher")} onClick={onClose}>
            <X className="h-5 w-5" aria-hidden="true" />
          </ActionButton>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("workspace.openTabs")}</p>
          {openTabs.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("workspace.noMatchingTabs")}</p>
          ) : (
            openTabs.map(({ tab, paneId, isActive, paneLabel }) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  if (paneId) setActiveTab(paneId, tab.id);
                  onClose();
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="text-muted-foreground" aria-hidden="true">{getTabIcon(tab.type)}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{tab.title}</span>
                <span className="text-xs text-muted-foreground">{isActive ? t("workspace.active") : paneLabel}</span>
              </button>
            ))
          )}
          {closedTabs.length > 0 && !query.trim() && (
            <>
              <p className="mt-3 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("workspace.recentlyClosed")}</p>
              <button
                type="button"
                onClick={() => {
                  reopenLastClosedTab();
                  onClose();
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ArrowCounterClockwise className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t("workspace.reopen", { title: closedTabs[closedTabs.length - 1]?.title ?? "" })}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
