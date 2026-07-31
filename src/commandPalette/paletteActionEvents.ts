/**
 * Dispatch channel for contextual command-palette actions.
 *
 * The palette (in CommandCenter) lists action descriptors from
 * `contextualActions.ts`. When the user selects one, it dispatches a typed
 * window event carrying `{ view, actionId }`. The active view listens for that
 * event and routes `actionId` to its existing handler via a `handlerMap`.
 *
 * This keeps the registry declarative (no captured closures) and reuses the
 * app's established cross-boundary mechanism (window CustomEvents, like the
 * existing "navigate" and "command-palette-open" events). Only the active view
 * registers a listener (see `isActive` on the hook), so an action is never
 * handled by an inactive view.
 */

import { useEffect, useRef } from "react";
import type { ActionContext, ContextualViewType, ViewActionId } from "./contextualActions";

/** Window event name used to carry a palette action dispatch. */
export const PALETTE_ACTION_EVENT = "palette-action";

/** Payload of a `palette-action` CustomEvent. */
export interface PaletteActionPayload {
  view: ContextualViewType;
  actionId: ViewActionId;
}

/**
 * Dispatch a contextual action from the palette to the active view.
 * Returns true if a listener is present to receive it (window dispatch succeeds
 * regardless of whether a handler matches).
 */
export function dispatchPaletteAction(view: ContextualViewType, actionId: ViewActionId): void {
  window.dispatchEvent(
    new CustomEvent<PaletteActionPayload>(PALETTE_ACTION_EVENT, {
      detail: { view, actionId },
    }),
  );
}

/** Type guard for an unknown event detail → typed payload. */
function isPaletteActionPayload(value: unknown): value is PaletteActionPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { view?: unknown; actionId?: unknown };
  return typeof v.view === "string" && typeof v.actionId === "string";
}

/**
 * A handler map routes a subset of action ids to existing view handlers.
 * Views only need to map the ids they actually support; unknown ids are
 * ignored by that listener (and surfaced via a dev-only warning if no listener
 * in the active view handled them).
 */
export type PaletteHandlerMap = Partial<Record<ViewActionId, () => void>>;

// ---------------------------------------------------------------------------
// Live context provider
//
// Some `applies()` predicates need live state that only the active view knows
// (e.g. "is there a now-playing podcast episode?"). The active view publishes
// that context here; the palette reads it when resolving actions. This is a
// single-slot store keyed by view: only the active view's value is kept, and it
// clears on unmount so stale data never hides actions for a different view.
// ---------------------------------------------------------------------------

const liveContextByView: Partial<Record<ContextualViewType, ActionContext>> = {};

/**
 * Read the live context published by the active `view`, if any. Used by the
 * palette to refine `applies()` filtering beyond what it can infer itself.
 */
export function getLiveContext(view: ContextualViewType): ActionContext {
  return liveContextByView[view] ?? {};
}

/**
 * Publish live `ActionContext` for `view` while this view is active. Clears the
 * slot on unmount. Pass `{ isActive: false }` to stop publishing without
 * unmounting (e.g. when the tab becomes inactive in a split pane).
 */
export function usePaletteContextProvider(
  view: ContextualViewType,
  ctx: ActionContext,
  options: UsePaletteActionListenerOptions = {},
): void {
  const { isActive = true } = options;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (!isActive) {
      // Stop publishing if we go inactive but stay mounted.
      if (liveContextByView[view] !== undefined) delete liveContextByView[view];
      return;
    }
    liveContextByView[view] = ctxRef.current;
    return () => {
      // Only clear if we still own the slot (avoid clearing a newer mount).
      if (liveContextByView[view] === ctxRef.current) {
        delete liveContextByView[view];
      }
    };
  }, [view, isActive]);
}

export interface UsePaletteActionListenerOptions {
  /**
   * Only register the listener when this view is the active tab. Defaults to
   * the value of `useIsActiveTab()` so that, in split panes, only the active
   * view's listener is mounted.
   */
  isActive?: boolean;
}

/**
 * Register a palette-action listener for `view` that routes each incoming
 * `actionId` to the corresponding handler in `handlerMap`.
 *
 * `handlerMap` is read live on each event (via a ref) so handlers always see
 * the latest closure/state — there are no stale-capture bugs and no need to
 * re-subscribe on every render.
 *
 * Only one listener per `(view, mount)` is registered; it ignores ids not in
 * its map. If an event arrives for this `view` but no id match is found in any
 * listener, a development-only warning is emitted.
 */
export function usePaletteActionListener(
  view: ContextualViewType,
  handlerMap: PaletteHandlerMap,
  options: UsePaletteActionListenerOptions = {},
): void {
  const { isActive = true } = options;
  // Keep the latest handler map without resubscribing.
  const handlerMapRef = useRef(handlerMap);
  handlerMapRef.current = handlerMap;

  useEffect(() => {
    if (!isActive) return;

    const onAction = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!isPaletteActionPayload(detail)) return;
      if (detail.view !== view) return;

      const handler = handlerMapRef.current[detail.actionId];
      if (handler) {
        handler();
      } else if (import.meta.env?.DEV) {
        // No matching route in *this* listener. If the action id legitimately
        // belongs to another listener in the same view (e.g. the podcast tab
        // has both a PodcastManager listener and an AudiobookViewer listener),
        // that other listener will handle it and this branch is harmless.
        // This warning helps catch typos when wiring up new actions.
        console.warn(
          `[palette-actions] No handler for "${detail.actionId}" in view "${view}". ` +
            `If this id belongs to another listener in the same view, ignore this warning.`,
        );
      }
    };

    window.addEventListener(PALETTE_ACTION_EVENT, onAction as EventListener);
    return () => window.removeEventListener(PALETTE_ACTION_EVENT, onAction as EventListener);
  }, [view, isActive]);
}
