import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowsClockwise,
  ArrowUp,
  CaretDown,
  Check,
  Copy,
  DotsThree,
  PencilSimple,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import type { SavedView } from "../../stores/savedViewsStore";

export interface SavedViewsMenuProps {
  savedViews: SavedView[];
  activeViewId: string | null;
  isActiveViewModified?: boolean;
  variant?: "desktop" | "mobile";
  onApplyView: (viewId: string) => void;
  onClearActiveView: () => void;
  onSaveView: () => void | Promise<void>;
  onRenameView: (viewId: string) => void | Promise<void>;
  onUpdateView: (viewId: string) => void;
  onDuplicateView: (viewId: string) => void;
  onMoveView: (viewId: string, direction: "up" | "down") => void;
  onDeleteView: (viewId: string) => void;
}

export function SavedViewsMenu({
  savedViews,
  activeViewId,
  isActiveViewModified = false,
  variant = "desktop",
  onApplyView,
  onClearActiveView,
  onSaveView,
  onRenameView,
  onUpdateView,
  onDuplicateView,
  onMoveView,
  onDeleteView,
}: SavedViewsMenuProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [openActionsViewId, setOpenActionsViewId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeView = savedViews.find((v) => v.id === activeViewId) ?? null;
  const isMobile = variant === "mobile";

  useEffect(() => {
    if (!isOpen) {
      setOpenActionsViewId(null);
      return;
    }

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
        setOpenActionsViewId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (openActionsViewId) {
          setOpenActionsViewId(null);
        } else {
          setIsOpen(false);
          triggerRef.current?.focus();
        }
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, openActionsViewId]);

  const closeMenu = () => {
    setIsOpen(false);
    setOpenActionsViewId(null);
  };

  return (
    <div className={isMobile ? "relative flex-1" : "relative"} ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`${
          isMobile
            ? "w-full px-3 py-2.5 min-h-[44px] justify-between"
            : "px-3 py-2.5 min-w-[140px] max-w-[220px] justify-between"
        } rounded-lg text-sm font-medium flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
          activeView
            ? "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
            : "bg-background border border-border text-foreground hover:bg-muted/60"
        }`}
        aria-label={t("documentsView.savedViews")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-testid={`saved-views-trigger-${variant}`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{activeView?.name ?? t("documentsView.savedViews")}</span>
          {activeView && isActiveViewModified && (
            <span
              className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"
              title={t("documentsView.viewModified")}
              aria-label={t("documentsView.viewModified")}
            />
          )}
        </span>
        <CaretDown
          className={`w-4 h-4 flex-shrink-0 text-muted-foreground transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={t("documentsView.savedViews")}
          data-testid={`saved-views-menu-${variant}`}
          className={`absolute right-0 top-full mt-1 ${
            isMobile ? "w-72 max-w-[calc(100vw-2rem)]" : "w-72"
          } bg-card border border-border rounded-xl shadow-lg z-50 py-1.5`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              void onSaveView();
            }}
            className={`w-full px-3 ${
              isMobile ? "py-2.5 min-h-[44px]" : "py-2"
            } flex items-center gap-2.5 text-sm text-primary hover:bg-primary/5 focus:bg-primary/10 focus:outline-none transition-colors`}
          >
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Plus className="w-4 h-4" />
            </div>
            <span className="font-medium truncate">{t("documentsView.saveCurrentView")}</span>
          </button>

          <div className="my-1 border-t border-border" />

          <div className="max-h-64 overflow-y-auto">
            {savedViews.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                {t("documentsView.noSavedViews")}
              </div>
            ) : (
              savedViews.map((view, index) => {
                const isActive = activeViewId === view.id;
                const actionsOpen = openActionsViewId === view.id;
                const isFirst = index === 0;
                const isLast = index === savedViews.length - 1;

                return (
                  <div key={view.id} className="px-1.5 py-0.5">
                    <div
                      className={`flex items-center gap-1 rounded-lg transition-colors ${
                        isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/60"
                      }`}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onApplyView(view.id);
                          closeMenu();
                        }}
                        className={`flex-1 min-w-0 px-2 ${
                          isMobile ? "py-2.5 min-h-[44px]" : "py-2"
                        } flex items-center gap-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-primary rounded-lg`}
                        title={view.name}
                      >
                        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                          {isActive ? <Check className="w-4 h-4" /> : null}
                        </span>
                        <span className="truncate font-medium">{view.name}</span>
                        {isActive && isActiveViewModified && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 flex-shrink-0">
                            {t("documentsView.modified")}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        aria-label={t("documentsView.viewActions", { name: view.name })}
                        aria-expanded={actionsOpen}
                        aria-haspopup="menu"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenActionsViewId((prev) => (prev === view.id ? null : view.id));
                        }}
                        className={`${
                          isMobile ? "min-h-[44px] min-w-[44px]" : "min-h-[32px] min-w-[32px]"
                        } flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary flex-shrink-0`}
                      >
                        <DotsThree className="w-4 h-4" weight="bold" />
                      </button>
                    </div>

                    {actionsOpen && (
                      <div
                        role="menu"
                        aria-label={t("documentsView.viewActions", { name: view.name })}
                        className="mt-1 ml-4 mr-1 p-1 bg-muted/40 border border-border rounded-lg space-y-0.5"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeMenu();
                            void onRenameView(view.id);
                          }}
                          className={`w-full px-2.5 ${
                            isMobile ? "py-2.5 min-h-[44px]" : "py-1.5"
                          } flex items-center gap-2 text-xs text-foreground hover:bg-muted rounded-md focus:outline-none focus:ring-2 focus:ring-primary`}
                        >
                          <PencilSimple className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{t("documentsView.renameView")}</span>
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onUpdateView(view.id);
                            closeMenu();
                          }}
                          className={`w-full px-2.5 ${
                            isMobile ? "py-2.5 min-h-[44px]" : "py-1.5"
                          } flex items-center gap-2 text-xs text-foreground hover:bg-muted rounded-md focus:outline-none focus:ring-2 focus:ring-primary`}
                        >
                          <ArrowsClockwise className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{t("documentsView.updateWithCurrentFilters")}</span>
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onDuplicateView(view.id);
                            closeMenu();
                          }}
                          className={`w-full px-2.5 ${
                            isMobile ? "py-2.5 min-h-[44px]" : "py-1.5"
                          } flex items-center gap-2 text-xs text-foreground hover:bg-muted rounded-md focus:outline-none focus:ring-2 focus:ring-primary`}
                        >
                          <Copy className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{t("documentsView.duplicateView")}</span>
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          disabled={isFirst}
                          onClick={() => onMoveView(view.id, "up")}
                          className={`w-full px-2.5 ${
                            isMobile ? "py-2.5 min-h-[44px]" : "py-1.5"
                          } flex items-center gap-2 text-xs text-foreground hover:bg-muted rounded-md focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40 disabled:pointer-events-none`}
                        >
                          <ArrowUp className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{t("documentsView.moveViewUp")}</span>
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          disabled={isLast}
                          onClick={() => onMoveView(view.id, "down")}
                          className={`w-full px-2.5 ${
                            isMobile ? "py-2.5 min-h-[44px]" : "py-1.5"
                          } flex items-center gap-2 text-xs text-foreground hover:bg-muted rounded-md focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40 disabled:pointer-events-none`}
                        >
                          <ArrowDown className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{t("documentsView.moveViewDown")}</span>
                        </button>

                        <div className="my-1 border-t border-border" />

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onDeleteView(view.id);
                            setOpenActionsViewId(null);
                          }}
                          className={`w-full px-2.5 ${
                            isMobile ? "py-2.5 min-h-[44px]" : "py-1.5"
                          } flex items-center gap-2 text-xs text-destructive hover:bg-destructive/10 rounded-md focus:outline-none focus:ring-2 focus:ring-destructive`}
                        >
                          <Trash className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{t("documentsView.deleteView")}</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {activeViewId !== null && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClearActiveView();
                  closeMenu();
                }}
                className={`w-full px-3 ${
                  isMobile ? "py-2.5 min-h-[44px]" : "py-2"
                } flex items-center gap-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary transition-colors`}
              >
                <X className="w-4 h-4 flex-shrink-0" />
                <span>{t("documentsView.clearActiveView")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
