import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { useStudyDeckStore } from "../../stores/studyDeckStore";
import {
  getArenaOptimizationStatus,
  optimizeAlgorithmParams,
  type ArenaOptimizationStatus,
} from "../../api/algorithm";
import {
  getSm20ArenaStats,
  optimizeSm20Fsrs,
  optimizeSm20M4,
  type ArenaStats,
} from "../../api/review";
import { CANONICAL_FSRS_PARAMETER_LENGTH } from "../../utils/fsrsParameters";
import {
  ARENA_MODEL_LABELS,
  SELECTABLE_SCHEDULERS,
  schedulerDescriptionKey,
  schedulerLabel,
} from "../../lib/schedulerCatalog";
import { isPrecisionScheduler } from "../../lib/schedulerIdentity";
import { NumericInput } from "../common";
import { AlgorithmArenaModeControl } from "../review/AlgorithmArenaModeControl";
import { tourAnchor } from "../onboarding/tour/anchors";
import { Sparkle } from "@phosphor-icons/react";

export function LearningSettings() {
  const { t } = useI18n();
  const { settings, updateSettings } = useSettingsStore();
  const { decks } = useStudyDeckStore();
  const [newScopeType, setNewScopeType] = useState<"deck" | "tag">("deck");
  const [newScopeId, setNewScopeId] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizerMessage, setOptimizerMessage] = useState<string | null>(null);
  const [arenaOptStatus, setArenaOptStatus] = useState<ArenaOptimizationStatus | null>(null);
  const [arenaStats, setArenaStats] = useState<ArenaStats | null>(null);
  const [sm20OptRunning, setSm20OptRunning] = useState<"fsrs" | "m4" | null>(null);
  const [sm20OptMessage, setSm20OptMessage] = useState<string | null>(null);

  const refreshArena = () =>
    getSm20ArenaStats()
      .then(setArenaStats)
      .catch(() => setArenaStats(null));

  useEffect(() => {
    if (!isPrecisionScheduler(settings.learning.algorithm)) return;
    void getArenaOptimizationStatus()
      .then(setArenaOptStatus)
      .catch(() => setArenaOptStatus(null));
    void refreshArena();
  }, [settings.learning.algorithm]);

  const scopedOverrides = settings.learning.scopedFsrsOverrides ?? [];

  return (
    <div className="space-y-6">
      {/* On-Device AI Learning System Banner */}
      <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3">
        <Sparkle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-semibold text-foreground">
            On-Device AI Learning System Active
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Card extraction ("Learn this"), Socratic tutoring, Ask Library RAG, active recall reading prompts, and automated occlusion assist are configured under the <strong>AI & Learning</strong> tab.
          </p>
        </div>
      </div>

      {/* Algorithm Selection */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("learningSettings.algorithm")}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="algorithm-select" className="block text-sm font-medium text-foreground mb-2">
              Spaced Repetition Algorithm
            </label>
            <select
              id="algorithm-select"
              value={settings.learning.algorithm}
              onChange={(e) =>
                updateSettings({
                  learning: { ...settings.learning, algorithm: e.target.value as any },
                })
              }
              {...tourAnchor("reviewAlgorithmSetting")}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            >
              {SELECTABLE_SCHEDULERS.map((scheduler) => (
                <option key={scheduler.id} value={scheduler.id}>
                  {scheduler.id === "fsrs" ? `${scheduler.label} (Recommended)` : scheduler.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              {t(schedulerDescriptionKey(settings.learning.algorithm))}
            </p>
          </div>

          {isPrecisionScheduler(settings.learning.algorithm) && (
            <div className="border border-border rounded-lg p-4 space-y-3">
              <div>
                <h4 className="font-medium text-foreground">Algorithm Arena</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Plethora Precision runs five scheduling models in parallel — Plethora
                  Classic, Classic 15, Classic 19, Plethora Precision and FSRS — and
                  shifts weight toward whichever predicts your recall best. The Classic
                  baselines learn automatically on every review; Precision and FSRS can
                  additionally be fitted to your review history below.
                </p>
              </div>

              {!settings.learning.precisionPureKernel && <AlgorithmArenaModeControl />}

              <div className="border-t border-border pt-3">
                <SettingToggle
                  label={`Pure ${schedulerLabel("precision")} Mode (M4 kernel only)`}
                  description="Bypasses the Algorithm Arena blend to schedule with the pure Precision M4 model alone. Arena scoring and weights adaptation continue in the background so you can compare their performance."
                  checked={settings.learning.precisionPureKernel}
                  onChange={(checked) =>
                    updateSettings({
                      learning: { ...settings.learning, precisionPureKernel: checked },
                    })
                  }
                />
              </div>

              {arenaStats && Array.isArray(arenaStats.model_names) && arenaStats.model_names.length > 0 && (
                <div className="space-y-1">
                  {settings.learning.precisionPureKernel && (
                    <div className="text-xs font-semibold text-amber-500 mb-1">
                      Running in Pure M4 Mode (Arena blend weights below are not used for scheduling)
                    </div>
                  )}
                  <div className="grid grid-cols-5 gap-1 text-center text-xs">
                    {arenaStats.model_names.map((name, i) => (
                      <div key={name} className="bg-muted/50 rounded-md py-1.5">
                        <div className="text-muted-foreground">
                          {name}
                          {                          (name === ARENA_MODEL_LABELS.m5 && arenaStats.fsrs_optimized) ||
                          (name === ARENA_MODEL_LABELS.m4 && arenaStats.m4_optimized)
                            ? " ★"
                            : ""}
                        </div>
                        <div className="font-semibold text-foreground">
                          {arenaStats.weights[i]?.toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {arenaStats.r_metric != null
                      ? `R-Metric: ${arenaStats.r_metric >= 0 ? "+" : ""}${arenaStats.r_metric.toFixed(1)}% vs ${ARENA_MODEL_LABELS.m3} alone · ${arenaStats.total_scored} scored reviews`
                      : `Weights adapt as reviews accumulate (${arenaStats.total_scored} scored so far; ★ = personalized parameters active).`}
                  </div>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                {ARENA_MODEL_LABELS.m2} optimizer: {arenaOptStatus?.m2_optimizer_initialized ? "initialized" : "fresh (will initialize on first review)"}
                {arenaOptStatus?.m3_matrix_cells_populated != null
                  ? ` · ${ARENA_MODEL_LABELS.m3} matrix cells: ${arenaOptStatus.m3_matrix_cells_populated}/${arenaOptStatus.m3_matrix_total_cells ?? 9261}`
                  : ""}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={async () => {
                    try {
                      setSm20OptRunning("fsrs");
                      setSm20OptMessage(null);
                      const result = await optimizeSm20Fsrs();
                      setSm20OptMessage(result.message);
                      await refreshArena();
                    } catch (error) {
                      setSm20OptMessage(error instanceof Error ? error.message : "FSRS optimization failed");
                    } finally {
                      setSm20OptRunning(null);
                    }
                  }}
                  disabled={sm20OptRunning !== null}
                  className="px-3 py-2 rounded-md border border-border text-sm text-foreground disabled:opacity-50"
                >
                  {sm20OptRunning === "fsrs" ? "Optimizing FSRS…" : "Optimize FSRS competitor"}
                </button>
                <button
                  onClick={async () => {
                    try {
                      setSm20OptRunning("m4");
                      setSm20OptMessage(null);
                      const result = await optimizeSm20M4();
                      setSm20OptMessage(result.message);
                      await refreshArena();
                    } catch (error) {
                      setSm20OptMessage(error instanceof Error ? error.message : `${schedulerLabel("precision")} optimization failed`);
                    } finally {
                      setSm20OptRunning(null);
                    }
                  }}
                  disabled={sm20OptRunning !== null}
                  className="px-3 py-2 rounded-md border border-border text-sm text-foreground disabled:opacity-50"
                >
                  {sm20OptRunning === "m4" ? `Optimizing ${schedulerLabel("precision")}…` : `Optimize ${schedulerLabel("precision")} parameters`}
                </button>
                <button
                  onClick={async () => {
                    try {
                      setIsOptimizing(true);
                      const status = await getArenaOptimizationStatus();
                      setArenaOptStatus(status);
                      await refreshArena();
                    } catch {
                      // ignore refresh errors
                    } finally {
                      setIsOptimizing(false);
                    }
                  }}
                  disabled={isOptimizing}
                  className="px-3 py-2 rounded-md border border-border text-sm text-foreground disabled:opacity-50"
                >
                  {isOptimizing ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              {sm20OptMessage && (
                <p className="text-xs text-muted-foreground">{sm20OptMessage}</p>
              )}
              {optimizerMessage && (
                <p className="text-xs text-muted-foreground">{optimizerMessage}</p>
              )}
            </div>
          )}

          {(settings.learning.algorithm === "fsrs" || settings.learning.algorithm === "adaptive") && (
          <div>
            <label htmlFor="fsrs-retention" className="block text-sm font-medium text-foreground mb-2">
              {settings.learning.algorithm === "adaptive" ? "Forgetting Index" : "Desired Retention"}: {Math.round(settings.learning.fsrsParams.desiredRetention * 100)}%
            </label>
            <input
              type="range"
              id="fsrs-retention"
              min="70"
              max="99"
              value={settings.learning.fsrsParams.desiredRetention * 100}
              onChange={(e) =>
                updateSettings({
                  learning: {
                    ...settings.learning,
                    fsrsParams: {
                      ...settings.learning.fsrsParams,
                      desiredRetention: parseInt(e.target.value) / 100,
                    },
                  },
                })
              }
              className="w-full"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {settings.learning.algorithm === "adaptive"
                ? "Lower = more frequent reviews (default 90%)"
                : "Higher retention = more frequent reviews"}
            </p>
            {settings.learning.algorithm === "fsrs" && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={async () => {
                    try {
                      setIsOptimizing(true);
                      setOptimizerMessage(null);
                      const result = await optimizeAlgorithmParams({
                        min_ease_factor: 1.3,
                        initial_ease_factor: 2.5,
                        desired_retention: settings.learning.fsrsParams.desiredRetention,
                      });
                      updateSettings({
                        learning: {
                          ...settings.learning,
                          fsrsParams: {
                            ...settings.learning.fsrsParams,
                            personalizedWeights: result.fsrs_weights,
                            lastOptimizationAt: new Date().toISOString(),
                            optimizedReviewCount: result.history_count,
                          },
                        },
                      });
                      const quality = result.history_count >= result.minimum_history_required
                        ? "Personalized weights applied."
                        : "Applied provisional weights (limited history).";
                      setOptimizerMessage(
                        `${quality} Reviews used: ${result.history_count}/${result.minimum_history_required}.`
                      );
                    } catch (error) {
                      setOptimizerMessage(error instanceof Error ? error.message : "Failed to run optimizer");
                    } finally {
                      setIsOptimizing(false);
                    }
                  }}
                  disabled={isOptimizing}
                  className="px-3 py-2 rounded-md border border-border text-sm text-foreground disabled:opacity-50"
                >
                  {isOptimizing ? "Optimizing..." : "Run Personal FSRS Optimizer"}
                </button>
                {settings.learning.fsrsParams.personalizedWeights?.length === CANONICAL_FSRS_PARAMETER_LENGTH && (
                  <span className="text-xs text-green-500">FSRS-6 profile active (21 params)</span>
                )}
              </div>
            )}
            {optimizerMessage && (
              <p className="mt-2 text-xs text-muted-foreground">{optimizerMessage}</p>
            )}
          </div>
          )}

          {settings.learning.algorithm === "fsrs" && (
          <div className="border border-border rounded-lg p-4 space-y-3">
            <div>
              <h4 className="font-medium text-foreground">{t("learningSettings.scopedOverrides")}</h4>
              <p className="text-xs text-muted-foreground">
                Precedence is global → deck → tag. Tag overrides win when both match.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select
                value={newScopeType}
                onChange={(e) => setNewScopeType(e.target.value as "deck" | "tag")}
                className="px-2 py-2 rounded-md border border-border bg-background text-foreground"
              >
                <option value="deck">Deck</option>
                <option value="tag">Tag</option>
              </select>
              {newScopeType === "deck" ? (
                <select
                  value={newScopeId}
                  onChange={(e) => setNewScopeId(e.target.value)}
                  className="px-2 py-2 rounded-md border border-border bg-background text-foreground md:col-span-2"
                >
                  <option value="">Select deck</option>
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={newScopeId}
                  onChange={(e) => setNewScopeId(e.target.value)}
                  placeholder="tag-name"
                  className="px-2 py-2 rounded-md border border-border bg-background text-foreground md:col-span-2"
                />
              )}
            </div>

            <button
              onClick={() => {
                const trimmed = newScopeId.trim();
                if (!trimmed) return;
                updateSettings({
                  learning: {
                    ...settings.learning,
                    scopedFsrsOverrides: [
                      ...scopedOverrides,
                      {
                        id: `${newScopeType}-${trimmed}-${Date.now()}`,
                        scopeType: newScopeType,
                        scopeId: trimmed,
                        desiredRetention: settings.learning.fsrsParams.desiredRetention,
                        maximumInterval: settings.learning.fsrsParams.maximumInterval,
                        enabled: true,
                      },
                    ],
                  },
                });
                setNewScopeId("");
              }}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
            >
              Add override
            </button>

            <div className="space-y-2">
              {scopedOverrides.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("learningSettings.noScopedOverrides")}</p>
              )}
              {scopedOverrides.map((override) => (
                <div key={override.id} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-foreground">
                      {override.scopeType === "deck" ? "Deck" : "Tag"}:{" "}
                      <span className="font-medium">{override.scopeId}</span>
                    </div>
                    <button
                      onClick={() =>
                        updateSettings({
                          learning: {
                            ...settings.learning,
                            scopedFsrsOverrides: scopedOverrides.filter((entry) => entry.id !== override.id),
                          },
                        })
                      }
                      className="text-xs text-destructive"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-muted-foreground">
                      Retention
                      <NumericInput
                        min={0.7}
                        max={0.99}
                        step={0.01}
                        value={override.desiredRetention ?? settings.learning.fsrsParams.desiredRetention}
                        onChange={(value) =>
                          updateSettings({
                            learning: {
                              ...settings.learning,
                              scopedFsrsOverrides: scopedOverrides.map((entry) =>
                                entry.id === override.id
                                  ? { ...entry, desiredRetention: value }
                                  : entry
                              ),
                            },
                          })
                        }
                        className="mt-1 w-full px-2 py-1 rounded border border-border bg-background text-foreground"
                      />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Max interval
                      <NumericInput
                        min={1}
                        max={36500}
                        value={override.maximumInterval ?? settings.learning.fsrsParams.maximumInterval}
                        onChange={(value) =>
                          updateSettings({
                            learning: {
                              ...settings.learning,
                              scopedFsrsOverrides: scopedOverrides.map((entry) =>
                                entry.id === override.id
                                  ? { ...entry, maximumInterval: value }
                                  : entry
                              ),
                            },
                          })
                        }
                        className="mt-1 w-full px-2 py-1 rounded border border-border bg-background text-foreground"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>

      {/* New Cards */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("learningSettings.newCards")}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="newCardsPerDay" className="block text-sm font-medium text-foreground mb-2">
              New Cards per Day
            </label>
            <NumericInput
              id="newCardsPerDay"
              min={0}
              max={100}
              value={settings.learning.newCardsPerDay}
              onChange={(value) =>
                updateSettings({
                  learning: { ...settings.learning, newCardsPerDay: value },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
          </div>

          <div>
            <label htmlFor="initialInterval" className="block text-sm font-medium text-foreground mb-2">
              Initial Interval (days)
            </label>
            <NumericInput
              id="initialInterval"
              min={0}
              max={30}
              value={settings.learning.initialInterval}
              onChange={(value) =>
                updateSettings({
                  learning: { ...settings.learning, initialInterval: value },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
          </div>
        </div>
      </div>

      {/* Reviews */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("learningSettings.reviews")}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="reviewsPerDay" className="block text-sm font-medium text-foreground mb-2">
              Reviews per Day Limit
            </label>
            <NumericInput
              id="reviewsPerDay"
              min={0}
              max={1000}
              value={settings.learning.reviewsPerDay}
              onChange={(value) =>
                updateSettings({
                  learning: { ...settings.learning, reviewsPerDay: value },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Set to 0 for unlimited reviews
            </p>
          </div>

          <div>
            <label htmlFor="maxReviewTime" className="block text-sm font-medium text-foreground mb-2">
              Max Review Time per Card (seconds)
            </label>
            <NumericInput
              id="maxReviewTime"
              min={5}
              max={300}
              value={settings.learning.maxReviewTime}
              onChange={(value) =>
                updateSettings({
                  learning: { ...settings.learning, maxReviewTime: value },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
          </div>
        </div>
      </div>

      {/* Lapses */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("learningSettings.lapses")}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="lapseSteps" className="block text-sm font-medium text-foreground mb-2">
              Lapse Steps (minutes)
            </label>
            <input
              type="text"
              id="lapseSteps"
              value={settings.learning.lapseSteps.join(", ")}
              onChange={(e) =>
                updateSettings({
                  learning: {
                    ...settings.learning,
                    lapseSteps: e.target.value.split(",").map((s) => parseInt(s.trim()) || 10),
                  },
                })
              }
              placeholder="10, 20, 30"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Comma-separated values in minutes (e.g., "10, 20, 30")
            </p>
          </div>

          <div>
            <label htmlFor="lapseInterval" className="block text-sm font-medium text-foreground mb-2">
              Relearning Interval (days)
            </label>
            <NumericInput
              id="lapseInterval"
              min={1}
              max={30}
              value={settings.learning.lapseInterval}
              onChange={(value) =>
                updateSettings({
                  learning: { ...settings.learning, lapseInterval: value },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
          </div>
        </div>
      </div>

      {/* Graduated Interval */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("learningSettings.graduatedInterval")}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="graduatingInterval" className="block text-sm font-medium text-foreground mb-2">
              Graduating Interval (days)
            </label>
            <NumericInput
              id="graduatingInterval"
              min={1}
              max={30}
              value={settings.learning.graduatingInterval}
              onChange={(value) =>
                updateSettings({
                  learning: { ...settings.learning, graduatingInterval: value },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Interval at which a card graduates from learning to review
            </p>
          </div>

          <div>
            <label htmlFor="easyInterval" className="block text-sm font-medium text-foreground mb-2">
              Easy Interval (days)
            </label>
            <NumericInput
              id="easyInterval"
              min={1}
              max={60}
              value={settings.learning.easyInterval}
              onChange={(value) =>
                updateSettings({
                  learning: { ...settings.learning, easyInterval: value },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Interval when "Easy" is pressed on new card
            </p>
          </div>
        </div>
      </div>

      {/* Leech Threshold */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("learningSettings.leechCards")}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="leechThreshold" className="block text-sm font-medium text-foreground mb-2">
              Leech Threshold (lapses)
            </label>
            <NumericInput
              id="leechThreshold"
              min={3}
              max={20}
              value={settings.learning.leechThreshold}
              onChange={(value) =>
                updateSettings({
                  learning: { ...settings.learning, leechThreshold: value },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Cards with more lapses will be tagged as leeches and suspended
            </p>
          </div>
        </div>
      </div>

      {/* Timezone */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("learningSettings.timezone")}</h3>
        <div>
          <label htmlFor="timezone" className="block text-sm font-medium text-foreground mb-2">
            Your Timezone
          </label>
          <select
            id="timezone"
            value={settings.learning.timezone}
            onChange={(e) =>
              updateSettings({
                learning: { ...settings.learning, timezone: e.target.value },
              })
            }
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
          >
            <option value="auto">Auto-detect</option>
            <option value="America/New_York">Eastern Time</option>
            <option value="America/Chicago">Central Time</option>
            <option value="America/Denver">Mountain Time</option>
            <option value="America/Los_Angeles">Pacific Time</option>
            <option value="Europe/London">GMT (London)</option>
            <option value="Europe/Paris">Central European (Paris)</option>
            <option value="Asia/Tokyo">Japan Time</option>
            <option value="Asia/Shanghai">China Time</option>
            <option value="Australia/Sydney">Australia Eastern Time</option>
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Determines when a new day starts for reviews
          </p>
        </div>
      </div>

      {/* Postpone Settings */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("postpone.settingsTitle")}</h3>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("postpone.settingsDescription")}
          </p>

          {/* Toggle: Auto-Postpone */}
          <SettingToggle
            label={t("postpone.autoPostponeEnabled")}
            description={t("postpone.autoPostponeEnabledDescription")}
            checked={settings.learning.postpone.autoPostponeEnabled}
            onChange={(checked) =>
              updateSettings({
                learning: { ...settings.learning, postpone: { ...settings.learning.postpone, autoPostponeEnabled: checked } },
              })
            }
          />

          {/* Toggle: Simple Mode */}
          <SettingToggle
            label={t("postpone.simpleMode")}
            description={t("postpone.simpleModeDescription")}
            checked={settings.learning.postpone.simpleMode}
            onChange={(checked) =>
              updateSettings({
                learning: { ...settings.learning, postpone: { ...settings.learning.postpone, simpleMode: checked } },
              })
            }
          />

          {/* Toggle: Randomization */}
          <SettingToggle
            label={t("postpone.randomize")}
            description={t("postpone.randomizeDescription")}
            checked={settings.learning.postpone.randomize}
            onChange={(checked) =>
              updateSettings({
                learning: { ...settings.learning, postpone: { ...settings.learning.postpone, randomize: checked } },
              })
            }
          />

          {/* Item parameters */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">{t("postpone.itemParams")}</h4>
            <div className="grid grid-cols-2 gap-3">
              <NumberSetting
                label={t("postpone.itemIncrease")}
                value={settings.learning.postpone.itemIncrease}
                min={0} max={200}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, itemIncrease: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.itemMinIncrease")}
                value={settings.learning.postpone.itemMinIncrease}
                min={0} max={365}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, itemMinIncrease: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.itemMaxIncrease")}
                value={settings.learning.postpone.itemMaxIncrease}
                min={0} max={365}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, itemMaxIncrease: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.itemCap")}
                value={settings.learning.postpone.itemCap}
                min={1} max={36500}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, itemCap: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.itemFloor")}
                value={settings.learning.postpone.itemFloor}
                min={0} max={365}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, itemFloor: v } },
                  })
                }
              />
            </div>
          </div>

          {/* Topic (document) parameters */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">{t("postpone.topicParams")}</h4>
            <div className="grid grid-cols-2 gap-3">
              <NumberSetting
                label={t("postpone.topicIncrease")}
                value={settings.learning.postpone.topicIncrease}
                min={0} max={200}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, topicIncrease: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.topicMinIncrease")}
                value={settings.learning.postpone.topicMinIncrease}
                min={0} max={365}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, topicMinIncrease: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.topicMaxIncrease")}
                value={settings.learning.postpone.topicMaxIncrease}
                min={0} max={365}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, topicMaxIncrease: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.topicCap")}
                value={settings.learning.postpone.topicCap}
                min={1} max={36500}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, topicCap: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.topicFloor")}
                value={settings.learning.postpone.topicFloor}
                min={0} max={365}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, topicFloor: v } },
                  })
                }
              />
            </div>
          </div>

          {/* Eligibility thresholds */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">{t("postpone.eligibilityThresholds")}</h4>
            <div className="grid grid-cols-2 gap-3">
              <NumberSetting
                label={t("postpone.minElapsed")}
                value={settings.learning.postpone.minElapsed}
                min={0} max={365}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, minElapsed: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.minPriority")}
                value={settings.learning.postpone.minPriority}
                min={0} max={100}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, minPriority: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.minPriority2")}
                value={settings.learning.postpone.minPriority2}
                min={0} max={100}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, minPriority2: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.minStability")}
                value={settings.learning.postpone.minStability}
                min={0} max={365}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, minStability: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.topicPriorityMin")}
                value={settings.learning.postpone.topicPriorityMin}
                min={0} max={100}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, topicPriorityMin: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.topicRepMin")}
                value={settings.learning.postpone.topicRepMin}
                min={0} max={365}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, topicRepMin: v } },
                  })
                }
              />
              <NumberSetting
                label={t("postpone.topicElapsedMin")}
                value={settings.learning.postpone.topicElapsedMin}
                min={0} max={365}
                onChange={(v) =>
                  updateSettings({
                    learning: { ...settings.learning, postpone: { ...settings.learning.postpone, topicElapsedMin: v } },
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <label className="relative inline-flex items-center cursor-pointer shrink-0">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
      </label>
    </div>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1">{label}</label>
      <NumericInput
        min={min}
        max={max}
        value={value}
        onChange={onChange}
        className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm min-h-[44px]"
      />
    </div>
  );
}
