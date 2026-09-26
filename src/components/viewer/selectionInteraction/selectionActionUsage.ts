/**
 * Local, content-free usage counts for selection actions, used to keep the
 * user's most-chosen actions easiest to reach on the compact anchored bar
 * (hyperlink-selection-context-actions, design D8).
 *
 * Counts record invocation INTENT only — which action id was chosen, never
 * the selected text or any document content. They stay on this device
 * (localStorage; deliberately not part of cross-device sync) and never
 * leave the app.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SelectionActionDescriptor, SelectionActionId } from "./selectionActionRegistry";

/**
 * Minimum total recorded invocations before the bar adapts its order —
 * below this the canonical order applies, so a new user's bar never
 * jump-reorders on the first few selections.
 */
export const BAR_ADAPTATION_MIN_INVOCATIONS = 8;

interface SelectionActionUsageState {
  counts: Partial<Record<SelectionActionId, number>>;
  recordInvocation: (id: SelectionActionId) => void;
  /** Test/maintenance hook: clear all counts. */
  resetUsage: () => void;
}

export const useSelectionActionUsageStore = create<SelectionActionUsageState>()(
  persist(
    (set) => ({
      counts: {},
      recordInvocation: (id) =>
        set((state) => ({
          counts: { ...state.counts, [id]: (state.counts[id] ?? 0) + 1 },
        })),
      resetUsage: () => ({ counts: {} }),
    }),
    {
      name: "plethora-selection-action-usage",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** Record an invocation from anywhere (event handlers, non-React modules). */
export function recordSelectionActionInvocation(id: SelectionActionId): void {
  useSelectionActionUsageStore.getState().recordInvocation(id);
}

export type SelectionActionCounts = SelectionActionUsageState["counts"];

/** Total invocations recorded across all actions. */
export function totalInvocationCount(counts: SelectionActionCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
}

/**
 * Order bar actions most-used-first. Until enough signal exists
 * (`BAR_ADAPTATION_MIN_INVOCATIONS` total invocations) the canonical
 * registry order is returned unchanged; afterwards ties still fall back to
 * canonical order (Array#sort is stable), so the order only changes when
 * relative usage actually changes — never jittering between equals.
 *
 * Ranking happens AFTER availability filtering: gating is never weakened by
 * popularity.
 */
export function rankBarActionsByUsage(
  actions: SelectionActionDescriptor[],
  counts: SelectionActionCounts,
): SelectionActionDescriptor[] {
  if (totalInvocationCount(counts) < BAR_ADAPTATION_MIN_INVOCATIONS) {
    return actions;
  }
  return [...actions].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
}
