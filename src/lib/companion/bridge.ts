/**
 * Companion bridge helpers for domain call sites. Keeps coupling to the
 * companion internals at one import site and makes call sites trivially
 * testable (returns false / no-ops when the companion is disabled).
 */

import { useSettingsStore } from "../../stores/settingsStore";
import { notifyCompanion, useCompanionStore } from "./store";
import type { CompanionContext, CompanionEvent, CompanionSettings } from "./types";

export function getCompanionSettings(): CompanionSettings {
  return useSettingsStore.getState().settings.interface.companion;
}

export function getCompanionEnabled(): boolean {
  return getCompanionSettings()?.enabled === true;
}

export function buildCompanionContext(): CompanionContext {
  const now = Date.now();
  const runtime = useCompanionStore.getState();
  const active = document.activeElement;
  const typingActive =
    active instanceof HTMLElement &&
    (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
  const reviewDecisionActive = Boolean(
    active instanceof HTMLElement && active.closest('[data-rating-controls], .rating-orbs')
  );
  return {
    now,
    settings: getCompanionSettings(),
    msSinceLastSpeech: runtime.lastSpeechAt ? now - runtime.lastSpeechAt : Infinity,
    sessionSpeechCount: runtime.sessionSpeechCount,
    recentSpeechKeys: runtime.recentSpeechKeys,
    typingActive,
    reviewDecisionActive,
    modalOrFocusActive: Boolean(
      document.querySelector('[role="dialog"][data-open="true"], .modal-open')
    ),
  };
}

export function companionEvent(event: CompanionEvent): void {
  if (!getCompanionEnabled()) return;
  notifyCompanion(event, buildCompanionContext());
}
