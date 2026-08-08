/**
 * Tauri API wrapper for SuperMemo auto-postpone (supermemo-faithful-queue
 * Phase 3, tasks 3.11/3.12) — the priority-queue overflow handler.
 *
 * At session start, when outstanding material exceeds daily capacity, the
 * lowest-priority surplus is postponed. The decision runs on the backend
 * (`algorithms/postpone.rs`); these calls read/persist settings and run the
 * decision over the currently-due items.
 */

import { invokeCommand } from "../lib/tauri";

export interface AutoPostponeSettings {
  /** Master switch. When false, no element is auto-postponed. */
  enabled: boolean;
  /** Maximum outstanding elements to keep in a session. */
  daily_capacity: number;
  /** Elements at or above this 0-100 priority are never postponed. */
  priority_threshold: number;
  /** When true, difficulty biases the decision (harder items survive). */
  respect_difficulty: boolean;
}

export const DEFAULT_AUTO_POSTPONE_SETTINGS: AutoPostponeSettings = {
  enabled: true,
  daily_capacity: 50,
  priority_threshold: 70,
  respect_difficulty: true,
};

/** The outcome of a postpone decision. */
export interface PostponeDecision {
  /** Ids to keep outstanding (highest priority first). */
  keep: string[];
  /** Ids to postpone to a future date (lowest priority first). */
  postpone: string[];
}

/** Read the persisted auto-postpone settings (defaults if never set). */
export async function getAutoPostponeSettings(): Promise<AutoPostponeSettings> {
  return invokeCommand<AutoPostponeSettings>("get_auto_postpone_settings");
}

/** Persist the auto-postpone settings. */
export async function setAutoPostponeSettings(
  settings: AutoPostponeSettings,
): Promise<void> {
  await invokeCommand("set_auto_postpone_settings", { settings });
}

/**
 * Run the auto-postpone decision over the currently-due learning items.
 * Returns the keep/postpone split — build the session from `keep`.
 * When auto-postpone is disabled, every due item is in `keep`.
 */
export async function runAutoPostpone(): Promise<PostponeDecision> {
  return invokeCommand<PostponeDecision>("run_auto_postpone");
}
