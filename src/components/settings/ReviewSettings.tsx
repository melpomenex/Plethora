import React from "react";
import { useI18n } from "../../lib/i18n";
import { SettingsSearchTarget } from "./search/SettingsSearchNavigation";
import { useSettingsStore } from "../../stores/settingsStore";
import { cn } from "../../utils";
import { Brain, SlidersHorizontal } from "@phosphor-icons/react";

export type QueueOrderingMode = "adaptive" | "strict_manual";

export interface ReviewSettingsProps {
  value?: QueueOrderingMode;
  onChange?: (mode: QueueOrderingMode) => void;
  className?: string;
}

export function ReviewSettings({
  value: propValue,
  onChange: propOnChange,
  className,
}: ReviewSettingsProps = {}) {
  const { t } = useI18n();
  const storeMode = useSettingsStore((s) => s.settings?.smartQueue?.queueOrderingMode);
  const storeRotationInterval = useSettingsStore((s) => s.settings?.smartQueue?.documentRotationInterval ?? 7);
  const updateSettingsCategory = useSettingsStore((s) => s.updateSettingsCategory);
  const [localMode, setLocalMode] = React.useState<QueueOrderingMode>("adaptive");
  const [rotationInterval, setRotationInterval] = React.useState<number>(storeRotationInterval);

  const currentMode = propValue ?? storeMode ?? localMode;

  const handleRotationChange = (val: number) => {
    const clamped = Math.max(1, Math.min(365, val));
    setRotationInterval(clamped);
    if (updateSettingsCategory) {
      updateSettingsCategory("smartQueue", { documentRotationInterval: clamped });
    }
  };

  const handleModeChange = (mode: QueueOrderingMode) => {
    setLocalMode(mode);
    if (updateSettingsCategory) {
      updateSettingsCategory("smartQueue", { queueOrderingMode: mode });
    }
    propOnChange?.(mode);
  };

  const options: Array<{
    id: QueueOrderingMode;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: "adaptive",
      label: "Adaptive",
      description: "Dynamic multi-factor ranking combining spaced repetition urgency, active goals, energy targets, and topic diversity.",
      icon: Brain,
    },
    {
      id: "strict_manual",
      label: "Strict Manual",
      description: "Strict priority-first ordering. Bypasses variety guards and interleaving to follow your manual priorities.",
      icon: SlidersHorizontal,
    },
  ];

  return (
    <div className={cn("space-y-6", className)}>
      <SettingsSearchTarget
        id="setting-queue-ordering-mode"
        label="Queue Ordering Mode"
        className="space-y-4 rounded-xl border border-border bg-card p-5"
      >
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Queue Ordering Mode
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Select how items are prioritized and sequenced in your review queue.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {options.map(({ id, label, description, icon: Icon }) => {
            const isSelected = currentMode === id;
            return (
              <label
                key={id}
                className={cn(
                  "relative flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all",
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-background hover:bg-muted/30"
                )}
              >
                <input
                  type="radio"
                  name="queue-ordering-mode"
                  value={id}
                  checked={isSelected}
                  onChange={() => handleModeChange(id)}
                  className="mt-1 text-primary focus:ring-primary"
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", isSelected ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-sm font-medium text-foreground">{label}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </SettingsSearchTarget>

      <SettingsSearchTarget
        id="setting-document-rotation-interval"
        label="Document Rotation Interval"
        className="space-y-4 rounded-xl border border-border bg-card p-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Document Rotation Interval
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Number of days between reading passes for rotational documents in your queue.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={rotationInterval}
              onChange={(e) => handleRotationChange(parseInt(e.target.value, 10) || 1)}
              className="w-20 rounded-md border border-border bg-background px-3 py-1.5 text-right text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>
      </SettingsSearchTarget>
    </div>
  );
}

export default ReviewSettings;
