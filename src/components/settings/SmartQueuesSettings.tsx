/**
 * Queue Settings — the single home for everything about how the queue behaves.
 *
 * ## Why this is one section rather than two
 *
 * Adaptive ranking and queue refresh were briefly two settings tabs. They are not
 * two things: both answer "how does my queue behave", and splitting them meant a
 * reader who configured a decision model in one place saw different state in the
 * other, with no way to tell which was true. Ranking is now a section *here*.
 *
 * The one tab owns three things that belong together conceptually:
 *
 * - **Adaptive ranking** — the enable switch, the six knobs, the four presets,
 *   and the decision-model configuration.
 * - **Decision model** — Jev, Laya, Clef, OpenRouter decisions, or the
 *   deterministic fallback, plus the Laya weight download.
 * - **Auto-refresh** — a plain poller that has nothing to do with ranking and
 *   would have been a strange thing to move.
 *
 * ## Preset state has one home too
 *
 * The selected preset is stored once, in `smartQueue.queueStrategyPreset`, because
 * that is what the Queue toolbar's dropdown reads and writes. Whether the knobs
 * still *exactly* match it is derived from the knobs on every render
 * (`detectActivePreset`) rather than stored alongside — two fields for one
 * concept is how they drift, and they had already drifted.
 */

import React from "react";
import { ArrowsClockwise, Brain, Sliders } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { useQueueStore } from "../../stores/queueStore";
import { DaqeKnobPanel } from "../queue/DaqeKnobPanel";
import { DaqeDecisionModelSettings } from "../queue/DaqeDecisionModelSettings";
import { DecisionModelStatusLine } from "../queue/DecisionModelStatusLine";
import type { DecisionModelStatus } from "../../lib/daqe/decisionModelProbe";
import { applyPreset, type DaqePresetId } from "../../lib/daqe/presets";
import type { DaqeKnobs } from "../../lib/daqe/knobs";

interface SmartQueuesSettingsProps {
  settings?: {
    autoRefresh: boolean;
    refreshInterval: number;
  };
  onUpdateSettings?: (updates: Partial<{ autoRefresh: boolean; refreshInterval: number }>) => void;
  /**
   * The last observed probe outcome, so the section can state what is actually
   * ranking the queue.
   *
   * Lifted rather than owned: the probe runs in the picker below, and the status
   * line sits above it, so the result has to travel up. Defaults to "never
   * tested", which is the honest state for a fresh profile.
   */
  decisionStatus?: DecisionModelStatus;
}

export function SmartQueuesSettings({
  settings: propSettings,
  onUpdateSettings: propOnUpdate,
  decisionStatus = { configured: false },
}: SmartQueuesSettingsProps = {}) {
  const { t } = useI18n();
  const storeSmartQueue = useSettingsStore((s) => s.settings.smartQueue);
  const daqe = useSettingsStore((s) => s.settings.daqe);
  const updateSettingsCategory = useSettingsStore((s) => s.updateSettingsCategory);
  const applyRankSnapshot = useQueueStore((s) => s.applyRankSnapshot);

  const autoRefresh = propSettings ? propSettings.autoRefresh : storeSmartQueue.autoRefresh;
  const refreshInterval = propSettings
    ? propSettings.refreshInterval
    : storeSmartQueue.refreshInterval;

  /**
   * Re-rank from freshly written settings rather than this render's closure.
   *
   * The knobs are written by the panel above and the provider here, so reading
   * them back from the store is the only way to rank the values the user just
   * chose rather than the ones they were a moment ago.
   */
  const rerank = React.useCallback(() => {
    const current = useSettingsStore.getState().settings.daqe;
    if (!current.rankingEnabled) return;
    void applyRankSnapshot(current.knobs);
  }, [applyRankSnapshot]);

  // Moving a knob diverges from any preset, so attribution clears. Derived, not
  // stored — see the header note.
  const handleKnobChange = (knobs: DaqeKnobs) => {
    updateSettingsCategory("daqe", { knobs, rankingEnabled: true });
    rerank();
  };

  const handlePresetSelect = (presetId: DaqePresetId) => {
    updateSettingsCategory("daqe", {
      knobs: applyPreset(presetId, daqe.knobs),
      rankingEnabled: true,
    });
    // The dropdown in the Queue toolbar reads this field, so a preset chosen here
    // has to be written there too — one stored value, written from both places.
    updateSettingsCategory("smartQueue", { queueStrategyPreset: presetId });
    rerank();
  };

  const handleUpdateRefresh = (updates: Partial<{ autoRefresh: boolean; refreshInterval: number }>) => {
    if (propOnUpdate && propSettings) {
      propOnUpdate(updates);
      return;
    }
    updateSettingsCategory("smartQueue", updates);
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Brain className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">{t("settings.smartQueues")}</h3>
          <p className="text-sm text-muted-foreground">{t("settings.smartQueuesDesc")}</p>
        </div>
      </div>

      {/* ── Adaptive ranking ──────────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between border-b border-border/50 pb-4">
          <div className="flex items-start gap-3">
            <Sliders className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-foreground">{t("daqeSettings.title")}</div>
              <div className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                {t("daqeSettings.intro")}
              </div>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={daqe.rankingEnabled}
            onClick={() => {
              const enabled = !daqe.rankingEnabled;
              updateSettingsCategory("daqe", { rankingEnabled: enabled });
              if (enabled) rerank();
            }}
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

        {daqe.rankingEnabled ? (
          <>
            <DecisionModelStatusLine status={decisionStatus} />

            <DaqeKnobPanel
              knobs={daqe.knobs}
              onKnobChange={handleKnobChange}
              onPresetSelect={handlePresetSelect}
              onScheduleRerank={rerank}
            />

            <div className="pt-4 border-t border-border/50">
              <DaqeDecisionModelSettings onProviderChange={rerank} />
            </div>
          </>
        ) : null}
      </section>

      {/* ── Auto-refresh ──────────────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
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

        {autoRefresh ? (
          <div className="pt-3 border-t border-border/50">
            <div className="flex items-center gap-3 mb-3">
              <ArrowsClockwise className="w-5 h-5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t("settings.refreshInterval")}
                </div>
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
                onChange={(e) =>
                  handleUpdateRefresh({ refreshInterval: parseInt(e.target.value) })
                }
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
              <span>15 {t("common.secShort")}</span>
              <span>5 {t("common.minShort")}</span>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
