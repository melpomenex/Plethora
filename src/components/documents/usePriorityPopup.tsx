/**
 * Priority popup hook.
 *
 * Opens a continuous 0-100 priority slider popup (with a numeric input and the
 * five named preset chips) that sets priority for one or many documents:
 *  - one id  → single set via `updateDocumentPriority`
 *  - N ids   → mass set via `bulkSetDocumentPriority`, with a per-item result
 *              report (succeeded/failed) like the other bulk actions
 *
 * Also used from the document reader for its single open document.
 *
 * The popup opens through the app's shared modal system (`modal.custom`), so it
 * inherits the centered placement, backdrop, Escape-to-cancel, and confirm/
 * cancel footer. Cancelling applies no change and leaves any selection intact.
 */

import { useCallback, useState } from "react";
import { Flag } from "@phosphor-icons/react";
import { useModal } from "../common/Modal";
import { useI18n } from "../../lib/i18n";
import {
  bulkSetDocumentPriority,
  updateDocumentPriority,
} from "../../api/documents";
import type { Document } from "../../types/document";

/** Display-only bucket info for a 0-100 slider value. Matches the backend. */
const PRIORITY_PRESETS = [
  { value: 10, labelKey: "priority.lowest", color: "#6B7280" },
  { value: 30, labelKey: "priority.low", color: "#9CA3AF" },
  { value: 50, labelKey: "priority.normal", color: "#3B82F6" },
  { value: 70, labelKey: "priority.high", color: "#F59E0B" },
  { value: 90, labelKey: "priority.highest", color: "#EF4444" },
] as const;

export function getPriorityInfo(slider: number) {
  if (slider >= 81) return PRIORITY_PRESETS[4];
  if (slider >= 61) return PRIORITY_PRESETS[3];
  if (slider >= 41) return PRIORITY_PRESETS[2];
  if (slider >= 21) return PRIORITY_PRESETS[1];
  return PRIORITY_PRESETS[0];
}

/** Resolve a document's slider field for display (mirrors backend resolve). */
export function resolveDisplaySlider(doc: { prioritySlider?: number; priorityRating?: number }): number {
  if ((doc.prioritySlider ?? 0) > 0) return doc.prioritySlider!;
  const rating = doc.priorityRating ?? 0;
  if (rating > 0) {
    return ([0, 10, 30, 50, 70, 90] as const)[Math.min(5, Math.max(0, rating))];
  }
  return 50; // neutral midpoint for unset documents
}

interface PriorityPopupResult {
  /** Whether the user committed a value. */
  committed: boolean;
  /** The committed slider value, or null if cancelled. */
  slider: number | null;
}

interface UsePriorityPopupApi {
  updateDocument: (id: string, updates: Partial<Document>) => void;
}

/**
 * @param api.updateDocument store action to patch the in-memory document after a
 *   single-doc commit, so the UI updates without a reload. Required for the
 *   single-doc path; unused (bulk path refreshes its own list) when N>1.
 */
export function usePriorityPopup(api?: UsePriorityPopupApi) {
  const modal = useModal();
  const { t } = useI18n();

  const open = useCallback(
    async (
      ids: string[],
      docs: { id: string; prioritySlider?: number; priorityRating?: number }[],
      options?: { forceBulk?: boolean },
    ): Promise<PriorityPopupResult> => {
      if (ids.length === 0) return { committed: false, slider: null };

      // Use the bulk write path when there is more than one document, or when
      // the caller explicitly requests it (e.g. the bulk Reprioritize button,
      // which should always route through the bulk command for consistency even
      // if only one row happens to be selected).
      const useBulkPath = options?.forceBulk === true || ids.length > 1;
      const isMass = ids.length > 1;
      // Seed the slider from the first selected doc (the active one). For a mass
      // set the user is choosing a new shared value, so the seed is just a hint.
      const seedDoc = docs.find((d) => d.id === ids[0]);
      const seed = seedDoc ? resolveDisplaySlider(seedDoc) : 50;

      // The modal content is rendered once; we hold the live value in a ref-like
      // closure variable so the confirm handler reads the latest without
      // re-mounting. useState inside the content would reset on each render.
      let value = seed;

      const result = await modal.custom(
        <PriorityPopupBody
          initial={seed}
          isMass={isMass}
          count={ids.length}
          onChange={(v) => (value = v)}
        />,
        {
          title: isMass
            ? t("priority.popupTitleMass", { count: ids.length })
            : t("priority.popupTitle"),
          confirmText: t("priority.apply"),
          cancelText: t("priority.cancel"),
        },
      );

      if (!result) return { committed: false, slider: null };
      const slider = Math.max(0, Math.min(100, Math.round(value)));

      if (useBulkPath) {
        const bulk = await bulkSetDocumentPriority(ids, slider);
        const failedCount = bulk.failed.length;
        if (failedCount > 0) {
          await modal.alert(
            t("priority.bulkPartial", {
              succeeded: bulk.succeeded.length,
              failed: failedCount,
            }),
            t("priority.setTitle"),
          );
        }
      } else {
        // rating arg is derived server-side; pass 0 so the slider is authoritative.
        const updated = await updateDocumentPriority(ids[0], 0, slider);
        api?.updateDocument(ids[0], {
          priorityRating: updated.priorityRating,
          prioritySlider: updated.prioritySlider,
          priorityScore: updated.priorityScore,
        });
      }

      return { committed: true, slider };
    },
    [modal, t, api],
  );

  return { open };
}

/** Internal popup body: slider + numeric input + preset chips. */
function PriorityPopupBody({
  initial,
  isMass,
  count,
  onChange,
}: {
  initial: number;
  isMass: boolean;
  count: number;
  onChange: (value: number) => void;
}) {
  const { t } = useI18n();
  const [slider, setSlider] = useState(initial);
  const info = getPriorityInfo(slider);

  const commit = (v: number) => {
    const clamped = Math.max(0, Math.min(100, v));
    setSlider(clamped);
    onChange(clamped);
  };

  return (
    <div className="space-y-4">
      {isMass && (
        <p className="text-xs text-muted-foreground">
          {t("priority.massHint", { count })}
        </p>
      )}

      {/* Preset chips */}
      <div className="grid grid-cols-5 gap-1.5">
        {PRIORITY_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => commit(preset.value)}
            className={
              "flex flex-col items-center gap-1 p-2 rounded-md border transition-all " +
              (slider === preset.value
                ? "border-ring bg-muted"
                : "border-border bg-card hover:bg-muted/70")
            }
            title={t(preset.labelKey)}
          >
            <Flag className="h-4 w-4" style={{ color: preset.color }} fill={preset.color} />
            <span className="text-[10px] text-muted-foreground leading-none">
              {t(preset.labelKey)}
            </span>
          </button>
        ))}
      </div>

      {/* Slider + numeric input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t("priority.adjust")}</span>
          <input
            type="number"
            min={0}
            max={100}
            value={slider}
            onChange={(e) => commit(parseInt(e.target.value || "0", 10))}
            className="w-16 px-2 py-1 text-sm text-center bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label={t("priority.adjust")}
          />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={slider}
          onChange={(e) => commit(parseInt(e.target.value, 10))}
          aria-label={t("priority.adjust")}
          className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
          style={{ accentColor: info.color }}
        />
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">0</span>
          <span className="font-medium" style={{ color: info.color }}>
            {slider}
          </span>
          <span className="text-muted-foreground">100</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("priority.higherPriorityNote")}
      </p>
    </div>
  );
}
