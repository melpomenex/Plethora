import { Check, Plus, X } from "@phosphor-icons/react";
import { DASHBOARD_WIDGET_CATALOG } from "./widgets";
import type { DashboardSectionId, DashboardWidgetId } from "../../stores/dashboardLayoutStore";
import { cn } from "../../utils/cn";

export interface WidgetGalleryPanelProps {
  sectionOrder: DashboardSectionId[];
  hiddenSections: DashboardSectionId[];
  onAddWidget: (id: DashboardWidgetId) => void;
  onRemoveWidget: (id: DashboardWidgetId) => void;
  onClose: () => void;
}

export function WidgetGalleryPanel({
  sectionOrder,
  hiddenSections,
  onAddWidget,
  onRemoveWidget,
  onClose,
}: WidgetGalleryPanelProps) {
  return (
    <div
      data-testid="dashboard-widget-gallery"
      className="mb-6 rounded-xl border border-primary/30 bg-surface-container-low p-4 md:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-on-surface">
            Add Dashboard Widgets
          </h2>
          <p className="text-xs text-on-surface-variant">
            Add interactive widgets to tailor your Dashboard. You can reorder or remove them anytime.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close widget gallery"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {DASHBOARD_WIDGET_CATALOG.map((widget) => {
          const Icon = widget.icon;
          const isAdded =
            sectionOrder.includes(widget.id) && !hiddenSections.includes(widget.id);
          return (
            <div
              key={widget.id}
              data-widget-gallery-id={widget.id}
              className={cn(
                "flex flex-col justify-between rounded-xl border p-3.5 transition-colors",
                isAdded
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-card",
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className={cn(widget.iconBg, "rounded-lg p-2")}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {widget.category}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-foreground">
                  {widget.title}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {widget.description}
                </p>
              </div>

              <div className="mt-3 pt-2.5 border-t border-border flex justify-end">
                {isAdded ? (
                  <button
                    type="button"
                    onClick={() => onRemoveWidget(widget.id)}
                    aria-label={`Remove ${widget.title} widget`}
                    className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Added
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAddWidget(widget.id)}
                    aria-label={`Add ${widget.title} widget`}
                    className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add widget
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
