import { useEffect, useRef } from "react";
import { Trash } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import type { OcclusionSession } from "./useOcclusionSession";

/**
 * Numbered, editable region list that mirrors the canvas.
 *
 * Each row shows the region's ordinal (creation order, matching the ordinal
 * rendered on the canvas), an editable label, and a delete control. Selecting
 * a row selects the region on the canvas (and asks the composer to pan it into
 * view); selecting a region on the canvas highlights its row and scrolls it
 * into view.
 */
export interface OcclusionRegionListProps {
  session: OcclusionSession;
  /** Called with a region id when the user clicks a row (list→canvas sync). */
  onRequestFocusRegion?: (id: string) => void;
}

export function OcclusionRegionList({ session, onRequestFocusRegion }: OcclusionRegionListProps) {
  const { t } = useI18n();
  const { regions, selection, apply } = session;
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const clickedByListRef = useRef(false);

  // Canvas→list sync: highlight + scroll the row into view when the selection
  // changes, unless the selection was just made by clicking this very row.
  useEffect(() => {
    const selected = selection[selection.length - 1];
    if (!selected) return;
    if (clickedByListRef.current) {
      clickedByListRef.current = false;
      return;
    }
    const row = rowRefs.current.get(selected);
    row?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  if (regions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        {t("occlusionComposer.regionListEmpty")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {regions.map((region, index) => {
        const isSelected = selection.includes(region.id ?? "");
        return (
          <li key={region.id || index}>
            <div
              ref={(node) => {
                rowRefs.current.set(region.id ?? String(index), node);
              }}
              data-testid={`region-list-row-${index + 1}`}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors",
                isSelected
                  ? "border-sky-400/70 bg-sky-500/10"
                  : "border-border bg-background hover:bg-muted/50",
              )}
              onClick={() => {
                clickedByListRef.current = true;
                apply({ type: "select", ids: [region.id ?? ""] });
                onRequestFocusRegion?.(region.id ?? "");
              }}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-semibold tabular-nums text-foreground">
                {index + 1}
              </span>
              <input
                value={region.label ?? ""}
                onChange={(event) => {
                  // Label edits must not change the selection; clicking the
                  // input should still select the region so the canvas shows it.
                  if (!isSelected) {
                    clickedByListRef.current = true;
                    apply({ type: "select", ids: [region.id ?? ""] });
                  }
                  apply({ type: "setLabel", id: region.id ?? "", label: event.target.value });
                }}
                onClick={(event) => event.stopPropagation()}
                placeholder={t("occlusionComposer.regionLabelPlaceholder")}
                aria-label={`${t("occlusionComposer.regionListTitle")} ${index + 1}`}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-foreground outline-none transition-colors focus:border-border focus:bg-background"
              />
              <button
                type="button"
                aria-label={`${t("occlusionComposer.delete")} ${index + 1}`}
                onClick={(event) => {
                  event.stopPropagation();
                  apply({ type: "deleteRegions", ids: [region.id ?? ""] });
                }}
                className="rounded p-1 text-destructive opacity-60 transition-opacity hover:opacity-100"
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
