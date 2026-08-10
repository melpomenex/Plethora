import { useCallback, useMemo, useReducer } from "react";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";
import {
  type OcclusionMode,
  type OcclusionViewport,
  DEFAULT_OCCLUSION_VIEWPORT,
} from "../../utils/occlusion";

/**
 * Authoring-session state for the Image Occlusion Composer.
 *
 * Holds the regions, pending AI suggestions, selection, occlusion mode and
 * viewport in one place and routes every mutation through `apply(action)`.
 * History is a snapshot stack (`past`/`present`/`future`) over both regions
 * AND suggestions — suggestions are part of the session, so undoing an
 * accepted suggestion returns it to the pending state. The stack is capped at
 * 50 entries (a region is a handful of small fields, so this is trivially
 * small in memory).
 *
 * Continuous gestures must commit exactly ONE history entry: the canvas keeps
 * the in-flight geometry locally and calls `apply` once on pointer-up with the
 * final state — never once per pointer-move.
 */

/** A point-in-time snapshot of the authorable session content. */
export interface OcclusionSessionSnapshot {
  regions: ImageOcclusionRegion[];
  suggestions: ImageOcclusionRegion[];
}

export interface OcclusionSessionState extends OcclusionSessionSnapshot {
  selection: string[];
  mode: OcclusionMode;
  viewport: OcclusionViewport;
  past: OcclusionSessionSnapshot[];
  future: OcclusionSessionSnapshot[];
}

export type OcclusionSessionAction =
  /** Replace all regions (used to commit a draw/move/resize gesture result). */
  | { type: "replaceRegions"; regions: ImageOcclusionRegion[] }
  /**
   * Commit both regions and suggestions in one history entry. The canvas uses
   * this for gestures that also accept a pending suggestion (accept-on-edit).
   */
  | { type: "commit"; snapshot: OcclusionSessionSnapshot }
  /** Delete one or more regions. */
  | { type: "deleteRegions"; ids: string[] }
  /** Duplicate the given regions with an offset (percent), selecting the copies. */
  | { type: "duplicateRegions"; ids: string[]; offset?: { x: number; y: number } }
  /** Set (or clear) a region's label. */
  | { type: "setLabel"; id: string; label: string }
  /** Move a pending suggestion into the region list (one history entry). */
  | { type: "acceptSuggestion"; id: string }
  /** Drop a pending suggestion. */
  | { type: "rejectSuggestion"; id: string }
  /** Move every pending suggestion into the region list. */
  | { type: "acceptAllSuggestions" }
  /** Drop every pending suggestion. */
  | { type: "rejectAllSuggestions" }
  /** Replace the pending suggestions (landing a fresh AI result or refinement). */
  | { type: "replaceSuggestions"; suggestions: ImageOcclusionRegion[] }
  /** Selection changes are not history-covered. */
  | { type: "select"; ids: string[] }
  /** Mode switches do not alter geometry and are not history-covered. */
  | { type: "setMode"; mode: OcclusionMode }
  /** Viewport changes are not history-covered. */
  | { type: "setViewport"; viewport: OcclusionViewport }
  /** Pop the last committed snapshot into the present, pushing the present onto the future. */
  | { type: "undo" }
  /** Restore the most recently undone snapshot. */
  | { type: "redo" };

const HISTORY_CAP = 50;

let regionIdCounter = 0;
function nextRegionId(): string {
  regionIdCounter += 1;
  return `region-${Date.now()}-${regionIdCounter}`;
}

function clampIds(ids: string[]): string[] {
  return [...new Set(ids)].filter((id) => typeof id === "string" && id.length > 0);
}

function reducer(state: OcclusionSessionState, action: OcclusionSessionAction): OcclusionSessionState {
  switch (action.type) {
    case "commit": {
      return commit(state, action.snapshot);
    }
    case "replaceRegions": {
      return commit(state, { regions: action.regions, suggestions: state.suggestions });
    }
    case "deleteRegions": {
      const ids = new Set(clampIds(action.ids));
      if (ids.size === 0) return state;
      const regions = state.regions.filter((r) => !ids.has(r.id ?? ""));
      if (regions.length === state.regions.length) return state; // no-op
      return {
        ...commit(state, { regions, suggestions: state.suggestions }),
        selection: state.selection.filter((id) => !ids.has(id)),
      };
    }
    case "duplicateRegions": {
      const ids = new Set(clampIds(action.ids));
      if (ids.size === 0) return state;
      const offset = action.offset ?? { x: 5, y: 5 };
      const copies = state.regions
        .filter((r) => ids.has(r.id ?? ""))
        .map((region) => ({
          ...region,
          id: nextRegionId(),
          x: Math.max(0, Math.min(100 - region.width, region.x + offset.x)),
          y: Math.max(0, Math.min(100 - region.height, region.y + offset.y)),
          label: region.label,
        }));
      if (copies.length === 0) return state;
      const regions = [...state.regions, ...copies];
      return {
        ...commit(state, { regions, suggestions: state.suggestions }),
        selection: copies.map((c) => c.id ?? ""),
      };
    }
    case "setLabel": {
      const label = action.label.trim();
      const regions = state.regions.map((r) =>
        r.id === action.id ? { ...r, label: label || undefined } : r,
      );
      return commit(state, { regions, suggestions: state.suggestions });
    }
    case "acceptSuggestion": {
      const suggestion = state.suggestions.find((s) => s.id === action.id);
      if (!suggestion) return state;
      return {
        ...commit(state, {
          regions: [...state.regions, { ...suggestion }],
          suggestions: state.suggestions.filter((s) => s.id !== action.id),
        }),
        selection: [suggestion.id ?? ""],
      };
    }
    case "rejectSuggestion": {
      const next = state.suggestions.filter((s) => s.id !== action.id);
      if (next.length === state.suggestions.length) return state;
      return commit(state, { regions: state.regions, suggestions: next });
    }
    case "acceptAllSuggestions": {
      if (state.suggestions.length === 0) return state;
      return {
        ...commit(state, {
          regions: [...state.regions, ...state.suggestions.map((s) => ({ ...s }))],
          suggestions: [],
        }),
        selection: state.suggestions.map((s) => s.id ?? ""),
      };
    }
    case "rejectAllSuggestions": {
      if (state.suggestions.length === 0) return state;
      return commit(state, { regions: state.regions, suggestions: [] });
    }
    case "replaceSuggestions": {
      return commit(state, { regions: state.regions, suggestions: action.suggestions });
    }
    case "select":
      return { ...state, selection: clampIds(action.ids) };
    case "setMode":
      return state.mode === action.mode ? state : { ...state, mode: action.mode };
    case "setViewport":
      return state.viewport === action.viewport ? state : { ...state, viewport: action.viewport };
    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        ...previous,
        past: state.past.slice(0, -1),
        future: [{ regions: state.regions, suggestions: state.suggestions }, ...state.future],
        selection: [],
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        ...state,
        ...next,
        past: [...state.past, { regions: state.regions, suggestions: state.suggestions }],
        future: rest,
        selection: [],
      };
    }
    default:
      return state;
  }
}

function commit(
  state: OcclusionSessionState,
  snapshot: OcclusionSessionSnapshot,
): OcclusionSessionState {
  if (snapshot.regions === state.regions && snapshot.suggestions === state.suggestions) {
    return state;
  }
  const present: OcclusionSessionSnapshot = { regions: state.regions, suggestions: state.suggestions };
  return {
    ...state,
    regions: snapshot.regions,
    suggestions: snapshot.suggestions,
    past: [...state.past, present].slice(-HISTORY_CAP),
    future: [],
  };
}

export interface UseOcclusionSessionOptions {
  initialRegions?: ImageOcclusionRegion[];
  initialSuggestions?: ImageOcclusionRegion[];
  initialMode?: OcclusionMode;
  initialViewport?: OcclusionViewport;
}

export function useOcclusionSession(options?: UseOcclusionSessionOptions) {
  const [state, dispatch] = useReducer(reducer, options, (opts) => {
    const initial: OcclusionSessionSnapshot = {
      regions: opts?.initialRegions ?? [],
      suggestions: opts?.initialSuggestions ?? [],
    };
    return {
      ...initial,
      selection: [],
      mode: opts?.initialMode ?? "per-region",
      viewport: opts?.initialViewport ?? DEFAULT_OCCLUSION_VIEWPORT,
      past: [],
      future: [],
    };
  });

  const apply = useCallback((action: OcclusionSessionAction) => dispatch(action), []);

  const undo = useCallback(() => dispatch({ type: "undo" }), []);

  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  /**
   * Whether any history entry exists (including undone ones). True once any
   * mutation has been committed, which is what the composer uses to decide
   * whether closing would discard unsaved work.
   */
  const hasChanges = state.past.length > 0 || state.future.length > 0;

  const selectedRegions = useMemo(
    () => state.regions.filter((r) => state.selection.includes(r.id ?? "")),
    [state.regions, state.selection],
  );

  return {
    regions: state.regions,
    suggestions: state.suggestions,
    selection: state.selection,
    mode: state.mode,
    viewport: state.viewport,
    apply,
    undo,
    redo,
    canUndo,
    canRedo,
    hasChanges,
    selectedRegions,
  };
}

export type OcclusionSession = ReturnType<typeof useOcclusionSession>;
