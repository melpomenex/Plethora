import {
  Bookmarks,
  Clock,
  Crosshair,
  FloppyDisk,
  Sliders,
  Stack,
  Tag,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSavedQueueStore } from "../../stores/savedQueueStore";
import type { SavedQueue } from "../../types/savedQueue";
import { defaultDaqeKnobs, type DaqeKnobs } from "../../lib/daqe/knobs";
import {
  MAX_SESSION_GOAL_LENGTH,
  applySessionGoal,
  coerceSessionGoal,
} from "../../lib/daqe/sessionGoal";
import { applyPreset } from "../../lib/daqe/presets";
import { DaqeKnobPanel } from "../queue/DaqeKnobPanel";
import { DaqeDecisionModelSettings } from "../queue/DaqeDecisionModelSettings";
import type { DaqePresetId } from "../../lib/daqe/presets";

/** Whether two goal histories are the same list, for skipping a redundant write. */
function sameGoalList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

export interface SessionCustomization {
  sessionDurationMinutes: number;
  maxItems: number;
  filters: {
    tags: string[];
    categories: string[];
    priorityRange: { min: number; max: number };
    excludeSuspended: boolean;
  };
  itemTypes: {
    documents: boolean;
    extracts: boolean;
    learningItems: boolean;
  };
  semanticStudy?: {
    enabled: boolean;
    relatednessThreshold: number;
    focalTopic: string;
  };
}

export const DEFAULT_CUSTOMIZATION: SessionCustomization = {
  sessionDurationMinutes: 60,
  maxItems: 50,
  filters: {
    tags: [],
    categories: [],
    priorityRange: { min: 0, max: 100 },
    excludeSuspended: true,
  },
  itemTypes: {
    documents: true,
    extracts: true,
    learningItems: true,
  },
  semanticStudy: {
    enabled: false,
    relatednessThreshold: 30,
    focalTopic: "",
  },
};

interface SessionCustomizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  customization: SessionCustomization;
  onChange: (customization: SessionCustomization) => void;
  onApply: () => void;
  availableTags?: string[];
  availableCategories?: string[];
  /**
   * Whether to show the Adaptive Ranking section at all.
   *
   * Off by default for callers that are not the queue's session builder, so a
   * modal that configures something narrower does not silently grow a panel
   * that has nothing to do with it.
   */
  showDaque?: boolean;
  /**
   * Called after a knob or preset changes, so the queue can re-rank while the
   * modal is still open. Defaulted to a no-op: a caller that does not rank must
   * not crash on a slider drag.
   */
  onScheduleRerank?: () => void;
  onSavedQueueCreated?: (queue: SavedQueue) => void;
  onSavedQueueUpdated?: (queue: SavedQueue) => void;
}

export function SessionCustomizeModal({
  isOpen,
  onClose,
  customization,
  onChange,
  onApply,
  availableTags = [],
  availableCategories = [],
  showDaque = true,
  onScheduleRerank = () => {},
  onSavedQueueCreated,
  onSavedQueueUpdated,
}: SessionCustomizeModalProps) {
  const { t } = useI18n();
  const daqe = useSettingsStore((s) => s.settings.daqe);
  const updateSettingsCategory = useSettingsStore((s) => s.updateSettingsCategory);
  const daqeEnabled = daqe?.rankingEnabled ?? false;
  const daqeKnobs = daqe?.knobs ?? defaultDaqeKnobs();
  const daqeGoal = coerceSessionGoal(daqe?.sessionGoal);
  const daqeRecentGoals = daqe?.recentGoals ?? [];
  const [goalError, setGoalError] = useState<string | null>(null);
  // `null` means "no uncommitted edit", so the field follows settings — which is how
  // a chip click or a reset shows up in it without an effect to resync.
  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const displayedGoal = goalDraft ?? daqeGoal;

  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveQueueName, setSaveQueueName] = useState("");
  const [savedFeedback, setSavedFeedback] = useState(false);

  const activeQueue = useSavedQueueStore((s) => s.getActiveSavedQueue());
  const createSavedQueue = useSavedQueueStore((s) => s.createSavedQueue);
  const updateSavedQueue = useSavedQueueStore((s) => s.updateSavedQueue);

  const handleSaveAsNewQueue = async () => {
    if (!saveQueueName.trim()) return;
    const newQueue = await createSavedQueue({
      name: saveQueueName.trim(),
      filters: customization.filters,
      itemTypes: customization.itemTypes,
      sessionDurationMinutes: customization.sessionDurationMinutes,
      maxItems: customization.maxItems,
      sessionGoal: displayedGoal || undefined,
    });
    setShowSaveAs(false);
    setSaveQueueName("");
    onSavedQueueCreated?.(newQueue);
  };

  const handleUpdateActiveQueue = async () => {
    if (!activeQueue) return;
    const updated = await updateSavedQueue(activeQueue.id, {
      filters: customization.filters,
      itemTypes: customization.itemTypes,
      sessionDurationMinutes: customization.sessionDurationMinutes,
      maxItems: customization.maxItems,
      sessionGoal: displayedGoal || undefined,
    });
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
    onSavedQueueUpdated?.(updated);
  };

  const setDaqueEnabled = (enabled: boolean) =>
    updateSettingsCategory("daqe", { rankingEnabled: enabled });
  // Moving a knob clears preset attribution rather than leaving the panel crediting
  // a preset the user has edited away from.
  const setDaqueKnobs = (knobs: DaqeKnobs) =>
    updateSettingsCategory("daqe", { knobs, rankingEnabled: true });
  const setDaquePreset = (preset: DaqePresetId) =>
    updateSettingsCategory("daqe", {
      knobs: applyPreset(preset, daqeKnobs),
      rankingEnabled: true,
    });

  // The goal is committed on blur rather than on every keystroke. An over-long value
  // is *refused* rather than truncated, so writing through on each keystroke would
  // have to either store a goal the user rejected or blank the accepted one mid-word —
  // and it would record half-typed goals in the history and re-rank against them.
  const commitGoal = (raw: string) => {
    const commit = applySessionGoal(raw, daqeRecentGoals);
    setGoalDraft(null);
    if (!commit) {
      setGoalError(t("sessionGoal.tooLong", { max: MAX_SESSION_GOAL_LENGTH }));
      return;
    }
    setGoalError(null);
    if (commit.goal === daqeGoal && sameGoalList(commit.recentGoals, daqeRecentGoals)) {
      return;
    }
    updateSettingsCategory("daqe", {
      sessionGoal: commit.goal,
      recentGoals: commit.recentGoals,
    });
    onScheduleRerank();
  };

  const pickRecentGoal = (goal: string) => {
    const commit = applySessionGoal(goal, daqeRecentGoals);
    setGoalDraft(null);
    if (!commit) return;
    setGoalError(null);
    updateSettingsCategory("daqe", {
      sessionGoal: commit.goal,
      recentGoals: commit.recentGoals,
    });
    onScheduleRerank();
  };

  const handleReset = () => {
    // The goal lives in settings rather than in `DEFAULT_CUSTOMIZATION`, so the
    // one-liner reset cannot reach it. `recentGoals` is deliberately left alone: it
    // is a record of past sessions, not part of this session's configuration.
    updateSettingsCategory("daqe", { sessionGoal: "" });
    setGoalDraft(null);
    setGoalError(null);
    onChange(DEFAULT_CUSTOMIZATION);
    onScheduleRerank();
  };

  if (!isOpen) return null;

  const updateCustomization = (updates: Partial<SessionCustomization>) => {
    onChange({ ...customization, ...updates });
  };

  const updateFilters = (updates: Partial<SessionCustomization["filters"]>) => {
    onChange({
      ...customization,
      filters: { ...customization.filters, ...updates },
    });
  };

  const updateItemTypes = (updates: Partial<SessionCustomization["itemTypes"]>) => {
    onChange({
      ...customization,
      itemTypes: { ...customization.itemTypes, ...updates },
    });
  };

  const toggleTag = (tag: string) => {
    const tags = customization.filters.tags.includes(tag)
      ? customization.filters.tags.filter((t) => t !== tag)
      : [...customization.filters.tags, tag];
    updateFilters({ tags });
  };

  const toggleCategory = (category: string) => {
    const categories = customization.filters.categories.includes(category)
      ? customization.filters.categories.filter((c) => c !== category)
      : [...customization.filters.categories, category];
    updateFilters({ categories });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto m-4">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{t("sessionCustomize.title")}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
            aria-label={t("common.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Session Duration */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{t("sessionCustomize.sessionDuration")}</h3>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="15"
                max="180"
                step="15"
                value={customization.sessionDurationMinutes}
                onChange={(e) =>
                  updateCustomization({ sessionDurationMinutes: Number(e.target.value) })
                }
                className="flex-1"
              />
              <div className="min-w-[80px] text-sm text-foreground/80 text-right">
                {t("sessionCustomize.minutesShort", { count: customization.sessionDurationMinutes })}
              </div>
            </div>
            <div className="flex gap-2">
              {[30, 45, 60, 90, 120].map((duration) => (
                <button
                  key={duration}
                  onClick={() => updateCustomization({ sessionDurationMinutes: duration })}
                  className={`px-3 py-1 text-xs rounded border ${
                    customization.sessionDurationMinutes === duration
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted/60"
                  }`}
                >
                  {t("sessionCustomize.minutesCompact", { count: duration })}
                </button>
              ))}
            </div>
          </section>

          {/* Max Items */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Stack className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{t("sessionCustomize.maximumItems")}</h3>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={customization.maxItems}
                onChange={(e) => updateCustomization({ maxItems: Number(e.target.value) })}
                className="flex-1"
              />
              <div className="min-w-[80px] text-sm text-foreground/80 text-right">
                {t("sessionCustomize.itemsCount", { count: customization.maxItems })}
              </div>
            </div>
          </section>

          {/* Item Types */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Stack className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{t("sessionCustomize.itemTypes")}</h3>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={customization.itemTypes.documents}
                  onChange={(e) => updateItemTypes({ documents: e.target.checked })}
                  className="rounded"
                />
                {t("sessionCustomize.documents")}
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={customization.itemTypes.extracts}
                  onChange={(e) => updateItemTypes({ extracts: e.target.checked })}
                  className="rounded"
                />
                {t("sessionCustomize.extracts")}
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={customization.itemTypes.learningItems}
                  onChange={(e) => updateItemTypes({ learningItems: e.target.checked })}
                  className="rounded"
                />
                {t("sessionCustomize.learningItems")}
              </label>
            </div>
          </section>

          {/* Priority Range */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{t("sessionCustomize.priorityRange")}</h3>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-xs text-foreground/80 font-medium">{t("sessionCustomize.minimumPriority")}</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={customization.filters.priorityRange.min}
                  onChange={(e) =>
                    updateFilters({
                      priorityRange: {
                        ...customization.filters.priorityRange,
                        min: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
                <div className="text-xs text-foreground/80 text-right">
                  {customization.filters.priorityRange.min}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-xs text-foreground/80 font-medium">{t("sessionCustomize.maximumPriority")}</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={customization.filters.priorityRange.max}
                  onChange={(e) =>
                    updateFilters({
                      priorityRange: {
                        ...customization.filters.priorityRange,
                        max: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
                <div className="text-xs text-foreground/80 text-right">
                  {customization.filters.priorityRange.max}
                </div>
              </div>
            </div>
          </section>

          {/* Tags Filter */}
          {availableTags.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">{t("sessionCustomize.filterByTags")}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1 text-xs rounded border ${
                      customization.filters.tags.includes(tag)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted/60"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Categories Filter */}
          {availableCategories.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Stack className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">{t("sessionCustomize.filterByCategory")}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableCategories.map((category) => (
                  <button
                    key={category}
                    onClick={() => toggleCategory(category)}
                    className={`px-3 py-1 text-xs rounded border ${
                      customization.filters.categories.includes(category)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted/60"
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Exclude Suspended */}
          <section className="flex items-center justify-between p-3 bg-muted/30 rounded border border-border">
            <span className="text-sm text-foreground">{t("sessionCustomize.excludeSuspended")}</span>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={customization.filters.excludeSuspended}
                onChange={(e) => updateFilters({ excludeSuspended: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-background peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </section>

          {/* Adaptive Ranking (DAQE).

              A session's own settings decide *which* items appear; these decide
              the *order* of the ones that do. They live in settings rather than in
              the session draft because a preset is a durable choice about how the
              user reads, not a property of one sitting. That also means Cancel
              does not roll them back — Apply does, and Cancel leaves the last
              applied ranking alone. The section says so, because a control that
              ignores the button under it is worse than no control. */}
          {showDaque ? (
            <section className="space-y-4 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={daqeEnabled}
                    onChange={(e) => setDaqueEnabled(e.target.checked)}
                  />
                  {t("daqeKnob.enable")}
                </label>
              </div>
              <p className="text-[11px] opacity-70">{t("daqeKnob.cancelNote")}</p>

              {daqeEnabled ? (
                <>
                  {/* The goal, above the sliders it feeds: `goalRelevance` weights
                      this, and a weight the user dials in with nothing behind it is
                      the dead slider this field exists to fix. */}
                  <div className="space-y-2 border-b border-border pb-3">
                    <div className="flex items-center gap-2">
                      <Crosshair className="w-4 h-4 text-muted-foreground" />
                      <label
                        htmlFor="daqe-session-goal"
                        className="text-sm font-semibold text-foreground"
                      >
                        {t("sessionGoal.label")}
                      </label>
                    </div>
                    <input
                      id="daqe-session-goal"
                      type="text"
                      value={displayedGoal}
                      placeholder={t("sessionGoal.placeholder")}
                      aria-describedby="daqe-session-goal-desc"
                      aria-invalid={goalError ? true : undefined}
                      onChange={(event) => {
                        setGoalError(null);
                        setGoalDraft(event.target.value);
                      }}
                      onBlur={(event) => commitGoal(event.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <p
                      id="daqe-session-goal-desc"
                      className={`text-xs ${goalError ? "text-destructive" : "opacity-70"}`}
                    >
                      {goalError ?? t("sessionGoal.hint")}
                    </p>
                    {daqeRecentGoals.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {daqeRecentGoals.map((goal) => (
                          <button
                            key={goal}
                            type="button"
                            onClick={() => pickRecentGoal(goal)}
                            className="px-3 py-1 text-xs rounded border bg-background text-foreground border-border hover:bg-muted/60"
                          >
                            {goal}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <DaqeKnobPanel
                    knobs={daqeKnobs}
                    onKnobChange={setDaqueKnobs}
                    onPresetSelect={setDaquePreset}
                    onScheduleRerank={onScheduleRerank}
                  />
                  <div className="border-t border-border pt-3">
                    <DaqeDecisionModelSettings />
                  </div>
                </>
              ) : null}
            </section>
          ) : null}
        </div>

        {/* Save As Inline Bar */}
        {showSaveAs && (
          <div className="bg-muted/40 border-t border-border px-6 py-3 flex items-center gap-3">
            <Bookmarks className="w-4 h-4 text-primary shrink-0" />
            <input
              type="text"
              value={saveQueueName}
              onChange={(e) => setSaveQueueName(e.target.value)}
              placeholder={t("savedQueues.namePlaceholder") || "Queue name (e.g. Today's Focus)"}
              className="flex-1 px-3 py-1.5 text-sm rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveAsNewQueue();
                if (e.key === "Escape") setShowSaveAs(false);
              }}
            />
            <button
              type="button"
              onClick={() => void handleSaveAsNewQueue()}
              disabled={!saveQueueName.trim()}
              className="px-3 py-1.5 text-xs md:text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 font-medium"
            >
              {t("common.save") || "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowSaveAs(false)}
              className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("common.cancel") || "Cancel"}
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-xs text-foreground/70 hover:text-foreground"
            >
              {t("sessionCustomize.resetToDefaults")}
            </button>
            {!showSaveAs && (
              <>
                <button
                  type="button"
                  onClick={() => setShowSaveAs(true)}
                  className="px-3 py-1.5 text-xs border border-border rounded hover:bg-muted/60 text-foreground flex items-center gap-1.5"
                  title={t("savedQueues.saveAsNewQueue") || "Save as New Queue"}
                >
                  <Bookmarks className="w-3.5 h-3.5 text-primary" />
                  <span>{t("savedQueues.saveAsNewQueue") || "Save as New Queue"}</span>
                </button>
                {activeQueue && (
                  <button
                    type="button"
                    onClick={() => void handleUpdateActiveQueue()}
                    className="px-3 py-1.5 text-xs border border-border rounded hover:bg-muted/60 text-foreground flex items-center gap-1.5"
                    title={`${t("savedQueues.updateQueue") || "Update Queue"}: ${activeQueue.name}`}
                  >
                    <FloppyDisk className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{savedFeedback ? "✓ Saved!" : `${t("savedQueues.updateQueue") || "Update"} (${activeQueue.name})`}</span>
                  </button>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-background border border-border rounded hover:bg-muted/60 text-foreground"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={onApply}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium shadow-sm dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {t("sessionCustomize.applyCustomization")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
