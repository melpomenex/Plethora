/**
 * Smart Queues Settings
 * Configure adaptive queue ranking (DAQE), tuning knobs, and auto-refresh behavior
 */

import { ArrowsClockwise, Brain, Sliders, ShieldCheck } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { DaqeKnobPanel } from "../queue/DaqeKnobPanel";
import { DAQE_PRESETS, type DaqePresetId } from "../../lib/daqe/presets";
import type { DaqeKnobs } from "../../lib/daqe/knobs";

interface SmartQueuesSettingsProps {
  settings?: {
    autoRefresh: boolean;
    refreshInterval: number;
  };
  onUpdateSettings?: (updates: Partial<{ autoRefresh: boolean; refreshInterval: number }>) => void;
}

export function SmartQueuesSettings({
  settings: propSettings,
  onUpdateSettings: propOnUpdate,
}: SmartQueuesSettingsProps = {}) {
  const { t } = useI18n();
  const storeSmartQueue = useSettingsStore((s) => s.settings.smartQueue);
  const daqe = useSettingsStore((s) => s.settings.daqe);
  const updateSettingsCategory = useSettingsStore((s) => s.updateSettingsCategory);

  const autoRefresh = propSettings ? propSettings.autoRefresh : storeSmartQueue.autoRefresh;
  const refreshInterval = propSettings ? propSettings.refreshInterval : storeSmartQueue.refreshInterval;

  const handleUpdateRefresh = (updates: Partial<{ autoRefresh: boolean; refreshInterval: number }>) => {
    if (propOnUpdate) {
      propOnUpdate(updates);
    } else {
      updateSettingsCategory("smartQueue", updates);
    }
  };

  const handleKnobChange = (knobs: DaqeKnobs) => {
    updateSettingsCategory("daqe", { knobs, activePreset: null });
  };

  const handlePresetSelect = (presetId: DaqePresetId) => {
    const found = DAQE_PRESETS.find((p) => p.id === presetId);
    if (found) {
      updateSettingsCategory("daqe", {
        knobs: { ...found.knobs },
        activePreset: presetId,
        rankingEnabled: true,
      });
      updateSettingsCategory("smartQueue", {
        queueStrategyPreset: presetId,
      });
    }
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Brain className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">{t("settings.smartQueues")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("settings.smartQueuesDesc")}
          </p>
        </div>
      </div>

      {/* Adaptive Queue Ranking (DAQE) */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between border-b border-border/50 pb-4">
          <div className="flex items-start gap-3">
            <Sliders className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-foreground">
                Adaptive Queue Ranking (DAQE)
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                Dynamically rank due cards and reading items using memory urgency, cognitive energy fit, topic diversity, and dwell telemetry.
              </div>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={daqe.rankingEnabled}
            onClick={() =>
              updateSettingsCategory("daqe", { rankingEnabled: !daqe.rankingEnabled })
            }
            className={`relative w-12 h-6 shrink-0 rounded-full transition-colors ${
              daqe.rankingEnabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                daqe.rankingEnabled ? "left-7" : "left-1"
              }`}
            />
          </button>
        </div>

        {/* Cloud complexity privacy gate */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-sm font-medium text-foreground">
                Allow Cloud Complexity Analysis
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                Allows sending structural outlines (headings and item types without private text) to cloud models to estimate cognitive complexity.
              </div>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={daqe.allowRemoteDecisionModel}
            onClick={() =>
              updateSettingsCategory("daqe", {
                allowRemoteDecisionModel: !daqe.allowRemoteDecisionModel,
              })
            }
            className={`relative w-12 h-6 shrink-0 rounded-full transition-colors ${
              daqe.allowRemoteDecisionModel ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                daqe.allowRemoteDecisionModel ? "left-7" : "left-1"
              }`}
            />
          </button>
        </div>

        {/* Knob Panel */}
        <div className="pt-4 border-t border-border/50">
          <DaqeKnobPanel
            knobs={daqe.knobs}
            activePreset={daqe.activePreset}
            onKnobChange={handleKnobChange}
            onPresetSelect={handlePresetSelect}
            onScheduleRerank={() => {}}
            disabled={!daqe.rankingEnabled}
          />
        </div>
      </div>

      {/* Auto-Refresh Toggle */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <ArrowsClockwise className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-sm font-medium text-foreground">{t("settings.autoRefresh")}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {t("settings.autoRefreshDesc")}
              </div>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={() => handleUpdateRefresh({ autoRefresh: !autoRefresh })}
            className={`relative w-12 h-6 shrink-0 rounded-full transition-colors ${
              autoRefresh ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                autoRefresh ? "left-7" : "left-1"
              }`}
            />
          </button>
        </div>

        {/* Refresh Interval */}
        {autoRefresh && (
          <div className="pt-3 border-t border-border/50">
            <div className="flex items-center gap-3 mb-3">
              <ArrowsClockwise className="w-5 h-5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium text-foreground">{t("settings.refreshInterval")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("settings.refreshIntervalDesc")}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <input
                type="range"
                min="15"
                max="300"
                step="15"
                value={refreshInterval}
                onChange={(e) => handleUpdateRefresh({ refreshInterval: parseInt(e.target.value) })}
                className="flex-1 h-2 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
              />
              <div className="w-20 text-right">
                <span className="text-sm font-medium text-foreground">
                  {refreshInterval < 60
                    ? `${refreshInterval}s`
                    : `${Math.round(refreshInterval / 60)}m`}
                </span>
              </div>
            </div>

            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>15 sec</span>
              <span>5 min</span>
            </div>
          </div>
        )}
      </div>

      {/* Performance Note */}
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-sm text-muted-foreground">
          <strong>{t("settings.tip")}:</strong> {t("settings.autoRefreshTip")}
        </p>
      </div>
    </div>
  );
}
