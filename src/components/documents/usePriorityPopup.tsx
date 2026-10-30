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

import { useCallback, useEffect, useRef, useState } from "react";
import { Flag } from "@phosphor-icons/react";
import { useModal } from "../common/Modal";
import { useI18n } from "../../lib/i18n";
import {
  bulkSetDocumentPriority,
  updateDocumentPriority,
} from "../../api/documents";
import { updateLearningItemPriority } from "../../api/learning-items";
import type { Document } from "../../types/document";
import {
  PRIORITY_PRESETS,
  getPriorityInfo,
  getPriorityPreset,
  sliderToRating,
  resolveDisplaySlider,
} from "../../services/priority/priorityCommit";

export {
  PRIORITY_PRESETS,
  getPriorityInfo,
  getPriorityPreset,
  sliderToRating,
  resolveDisplaySlider,
};

export interface PriorityPopupResult {
  /** Whether the user committed a value. */
  committed: boolean;
  /** The committed slider value, or null if cancelled. */
  slider: number | null;
}

export interface UsePriorityPopupApi {
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
      docs: {
        id: string;
        prioritySlider?: number;
        priorityRating?: number;
        priorityExplicitlySet?: boolean;
      }[],
      options?: {
        forceBulk?: boolean;
        learningItemIds?: string[];
        /** Initial value and commit path for queue-owned targets. */
        initialSlider?: number;
        onCommit?: (slider: number) => Promise<void> | void;
      },
    ): Promise<PriorityPopupResult> => {
      // Cards carry their own priority (they are elements of the same queue),
      // so a selection may be documents, cards, or a mix. Only the document
      // ids drive the bulk/single write path below; cards are written
      // separately with the same committed value.
      const learningItemIds = options?.learningItemIds ?? [];
      if (ids.length === 0 && learningItemIds.length === 0 && !options?.onCommit) {
        return { committed: false, slider: null };
      }

      // Use the bulk write path when there is more than one document, or when
      // the caller explicitly requests it (e.g. the bulk Reprioritize button,
      // which should always route through the bulk command for consistency even
      // if only one row happens to be selected).
      const useBulkPath = options?.forceBulk === true || ids.length > 1;
      const totalCount = ids.length + learningItemIds.length;
      const isMass = totalCount > 1;
      // Seed the slider from the first selected doc (the active one). For a mass
      // set the user is choosing a new shared value, so the seed is just a hint.
      const seedDoc = docs.find((d) => d.id === ids[0]);
      const seed = options?.initialSlider !== undefined
        ? Math.max(0, Math.min(100, Math.round(options.initialSlider)))
        : seedDoc
          ? resolveDisplaySlider(seedDoc)
          : 50;

      let value = seed;
      let errorSetter: ((err: string | null) => void) | null = null;
      let committedSlider: number | null = null;

      const result = await modal.custom(
        <PriorityPopupBody
          initial={seed}
          isMass={isMass}
          count={ids.length}
          onChange={(v) => {
            value = v;
            errorSetter?.(null);
          }}
          onErrorRegister={(fn) => {
            errorSetter = fn;
          }}
        />,
        {
          title: isMass
            ? t("priority.popupTitleMass", { count: totalCount })
            : t("priority.popupTitle"),
          confirmText: t("priority.apply"),
          cancelText: t("priority.cancel"),
          onConfirm: async () => {
            const slider = Math.max(0, Math.min(100, Math.round(value)));
            try {
              if (options?.onCommit) {
                await options.onCommit(slider);
                committedSlider = slider;
                return true;
              }

              if (learningItemIds.length > 0) {
                // Sequential writes for cards; one failure must not lose the rest.
                for (const cardId of learningItemIds) {
                  await updateLearningItemPriority(cardId, slider);
                }
              }

              if (ids.length === 0) {
                committedSlider = slider;
                return true;
              }

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
                // slider is authoritative; server derives rating; pass 0.
                const updated = await updateDocumentPriority(ids[0], 0, slider);
                api?.updateDocument(ids[0], {
                  priorityRating: updated.priorityRating,
                  prioritySlider: updated.prioritySlider,
                  priorityScore: updated.priorityScore,
                  priorityExplicitlySet: true,
                });
              }

              committedSlider = slider;
              return true;
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              errorSetter?.(msg);
              throw error;
            }
          },
        },
      );

      if (!result || committedSlider === null) {
        return { committed: false, slider: null };
      }

      return { committed: true, slider: committedSlider };
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
  onErrorRegister,
}: {
  initial: number;
  isMass: boolean;
  count: number;
  onChange: (value: number) => void;
  onErrorRegister?: (setter: (err: string | null) => void) => void;
}) {
  const { t } = useI18n();
  const [slider, setSlider] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const info = getPriorityInfo(slider);
  const numberInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onErrorRegister?.(setError);
  }, [onErrorRegister]);

  // Focus + select the numeric input on open so the user can type a value
  // immediately, without an extra click. Modal's own focus trap defers to
  // whatever the content already focused, so this wins.
  useEffect(() => {
    numberInputRef.current?.focus();
    numberInputRef.current?.select();
  }, []);

  const commit = (v: number) => {
    const clamped = Math.max(0, Math.min(100, v));
    setSlider(clamped);
    setError(null);
    onChange(clamped);
  };

  return (
    <div className="space-y-4">
      {isMass && (
        <p className="text-xs text-muted-foreground">
          {t("priority.massHint", { count })}
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-error font-medium">
          {t("priority.saveFailed")} ({error})
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
            ref={numberInputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={slider}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, "");
              commit(digits ? parseInt(digits, 10) : 0);
            }}
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
