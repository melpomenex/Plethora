import { useMemo, useState, type ElementType } from "react";
import { Check, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import type { DashboardQuickActionId } from "../../stores/dashboardLayoutStore";
import { cn } from "../../utils/cn";

export type QuickActionCategory =
  | "all"
  | "import"
  | "study"
  | "media"
  | "knowledge"
  | "tools";

export interface QuickActionCatalogItem {
  id: DashboardQuickActionId;
  title: string;
  description: string;
  category: Exclude<QuickActionCategory, "all">;
  shortcut?: string;
  icon: ElementType;
  iconBg: string;
  isDefault?: boolean;
}

export interface QuickActionsPickerProps {
  catalog: QuickActionCatalogItem[];
  activeOrder: DashboardQuickActionId[];
  hiddenIds: DashboardQuickActionId[];
  onAdd: (id: DashboardQuickActionId) => void;
  onRemove: (id: DashboardQuickActionId) => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Array<{ id: QuickActionCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "study", label: "Study & Review" },
  { id: "import", label: "Import & Capture" },
  { id: "media", label: "Reading & Media" },
  { id: "knowledge", label: "Knowledge & AI" },
  { id: "tools", label: "Tools & Navigation" },
];

export function QuickActionsPicker({
  catalog,
  activeOrder,
  hiddenIds,
  onAdd,
  onRemove,
  onClose,
}: QuickActionsPickerProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<QuickActionCategory>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
      );
    });
  }, [catalog, category, query]);

  return (
    <div
      data-testid="quick-actions-picker"
      className="mt-4 rounded-xl border border-outline-variant bg-surface-container-low p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">
            Add Quick Actions
          </h3>
          <p className="text-xs text-on-surface-variant">
            Choose any toolbar action or dashboard shortcut to pin to Quick Actions.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close quick actions picker"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <MagnifyingGlass
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search toolbar & dashboard actions..."
            aria-label="Search quick actions"
            className="w-full rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {CATEGORY_LABELS.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                category === cat.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-container text-on-surface-variant hover:text-on-surface",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No actions match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
          {filtered.map((item) => {
            const Icon = item.icon;
            const isAddedAndVisible =
              activeOrder.includes(item.id) && !hiddenIds.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  isAddedAndVisible ? onRemove(item.id) : onAdd(item.id)
                }
                aria-pressed={isAddedAndVisible}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border p-2.5 text-left transition-colors",
                  isAddedAndVisible
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card hover:bg-accent",
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className={cn(item.iconBg, "rounded-lg p-2 shrink-0")}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {item.title}
                      </span>
                      {item.shortcut && (
                        <kbd className="hidden sm:inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {item.shortcut}
                        </kbd>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>

                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    isAddedAndVisible
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {isAddedAndVisible ? (
                    <>
                      <Check className="h-3 w-3" aria-hidden="true" />
                      Added
                    </>
                  ) : (
                    <>
                      <Plus className="h-3 w-3" aria-hidden="true" />
                      Add
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
