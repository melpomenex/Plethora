import React from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "../../utils";
import { useI18n } from "../../lib/i18n";

export interface ScrollComposition {
  documents: number;
  extracts: number;
  flashcards: number;
}

interface ScrollQueueSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  composition: ScrollComposition;
  autoProceed: boolean;
  ratingOrbsPosition?: "left" | "right" | "top" | "bottom";
  onUpdateSetting: (key: string, value: number | boolean | string) => void;
  onUpdateComposition: (composition: ScrollComposition) => void;
}

const COMPOSITION_SLIDERS = [
  { key: "documents", id: "composition-documents", labelKey: "queue.compositionDocuments" },
  { key: "extracts", id: "composition-extracts", labelKey: "queue.compositionExtracts" },
  { key: "flashcards", id: "composition-flashcards", labelKey: "queue.compositionFlashcards" },
] as const;

export const ScrollQueueSettings = React.memo(function ScrollQueueSettings({
  isOpen,
  onClose,
  composition,
  autoProceed,
  ratingOrbsPosition,
  onUpdateSetting,
  onUpdateComposition,
}: ScrollQueueSettingsProps) {
  const { t } = useI18n();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm pointer-events-auto">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">Queue Settings</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-6">
          <div>
            {COMPOSITION_SLIDERS.map(({ key, id, labelKey }) => (
              <div key={key} className="mb-5 last:mb-0">
                <div className="flex items-center justify-between mb-3">
                  <label htmlFor={id} className="text-sm font-medium text-foreground">
                    {t(labelKey)}
                  </label>
                  <span className="text-sm font-mono text-primary">{composition[key]}%</span>
                </div>
                <input
                  id={id}
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={composition[key]}
                  onChange={(e) =>
                    onUpdateComposition({
                      ...composition,
                      [key]: parseInt(e.target.value),
                    })
                  }
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-2">
              {t("queue.compositionHelp")}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label htmlFor="auto-proceed-toggle" className="text-sm font-medium text-foreground">Auto-proceed to next item</label>
              <p className="text-xs text-muted-foreground mt-1">
                Automatically navigate to the next item when a video or audio ends
              </p>
            </div>
            <button
              id="auto-proceed-toggle"
              onClick={() => onUpdateSetting("autoProceed", !autoProceed)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                autoProceed ? "bg-primary" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  autoProceed ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label htmlFor="rating-orbs-position" className="text-sm font-medium text-foreground">Rating Orbs Position</label>
              <p className="text-xs text-muted-foreground mt-1">
                Preferred position edge for rating buttons in Scroll Mode
              </p>
            </div>
            <select
              id="rating-orbs-position"
              value={ratingOrbsPosition ?? "right"}
              onChange={(e) => onUpdateSetting("ratingOrbsPosition", e.target.value)}
              className="bg-background border border-input rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 pointer-events-auto"
            >
              <option value="right">Right</option>
              <option value="left">Left</option>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
});
