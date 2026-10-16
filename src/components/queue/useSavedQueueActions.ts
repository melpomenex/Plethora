import { useCallback, useEffect, useRef } from "react";
import { useSavedQueueStore } from "../../stores/savedQueueStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useQueueStore } from "../../stores/queueStore";
import { useIsActiveTab } from "../common/Tabs";
import { useDestinationAction, useDestinationActionStore } from "../../commandPalette/destinationActions";
import { defaultDaqeKnobs } from "../../lib/daqe/knobs";
import { applyPreset, type DaqePresetId } from "../../lib/daqe/presets";
import type { SavedQueue } from "../../types/savedQueue";
import { DEFAULT_CUSTOMIZATION, type SessionCustomization } from "../review/SessionCustomizeModal";

export function savedQueueCustomization(queue: SavedQueue): SessionCustomization {
  return {
    sessionDurationMinutes: queue.sessionDurationMinutes,
    maxItems: queue.maxItems,
    filters: { ...queue.filters, tags: [...queue.filters.tags], categories: [...queue.filters.categories], priorityRange: { ...queue.filters.priorityRange } },
    itemTypes: { ...queue.itemTypes },
  };
}

export function savedQueueIsApplied(queue: SavedQueue | null, customization: SessionCustomization): boolean {
  if (!queue) return true;
  return customization.sessionDurationMinutes === queue.sessionDurationMinutes &&
    customization.maxItems === queue.maxItems &&
    JSON.stringify(customization.filters) === JSON.stringify(queue.filters) &&
    JSON.stringify(customization.itemTypes) === JSON.stringify(queue.itemTypes);
}

/** Same application path for dropdown, late loading, and palette reselection. */
export function useSavedQueueActions(
  apply: (configuration: SessionCustomization) => void,
  openManage: () => void,
  openNew: () => void,
) {
  const active = useIsActiveTab();
  const queue = useSavedQueueStore((state) => state.savedQueues.find((entry) => entry.id === state.activeQueueId) ?? null);
  const revision = useSavedQueueStore((state) => state.activationRevision);
  const loading = useSavedQueueStore((state) => state.isLoading);
  const lastApplied = useRef<{ profile: SavedQueue; revision: number } | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const applyQueue = useCallback((profile: SavedQueue) => {
    const currentRevision = useSavedQueueStore.getState().activationRevision;
    if (lastApplied.current?.profile === profile && lastApplied.current.revision === currentRevision) return;
    lastApplied.current = { profile, revision: currentRevision };
    applyRef.current(savedQueueCustomization(profile));
    const settings = useSettingsStore.getState();
    const daqe = settings.settings.daqe;
    const knobs = profile.daqePresetId
      ? applyPreset(profile.daqePresetId as DaqePresetId, daqe?.knobs ?? defaultDaqeKnobs())
      : daqe?.knobs ?? defaultDaqeKnobs();
    const rankingEnabled = Boolean(daqe?.rankingEnabled || profile.sessionGoal || profile.daqePresetId);
    settings.updateSettingsCategory("daqe", { sessionGoal: profile.sessionGoal ?? "", knobs, rankingEnabled });
    if (rankingEnabled) void useQueueStore.getState().applyRankSnapshot(knobs, profile.filters.tags);
  }, []);
  useEffect(() => {
    if (active && queue) applyQueue(queue);
    else if (active && !loading && !queue && lastApplied.current) {
      lastApplied.current = null;
      applyRef.current(DEFAULT_CUSTOMIZATION);
    }
  }, [active, queue, revision, loading, applyQueue]);
  useDestinationAction("queue", async (request) => {
    if (request.action === "manage") openManage();
    if (request.action === "new") openNew();
    if (request.action === "select") {
      await useSavedQueueStore.getState().activateSavedQueue(request.queueId);
      const selected = useSavedQueueStore.getState().getActiveSavedQueue();
      if (selected) applyQueue(selected);
    }
  }, useDestinationActionStore.getState().pending?.action !== "start" && (!loading || useDestinationActionStore.getState().pending?.action !== "select"));
  return { queue, applyQueue };
}
