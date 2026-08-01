export interface DocumentSelectionModifiers {
  shiftKey?: boolean;
  toggleKey?: boolean;
  /**
   * Set by the row checkbox. Checkboxes always toggle; row bodies follow
   * file-explorer semantics where a plain click replaces the selection.
   */
  checkbox?: boolean;
}

export interface DocumentSelectionState {
  selectedIds: ReadonlySet<string>;
  anchorId: string | null;
  toggledIds: ReadonlySet<string>;
}

export interface DocumentSelectionResult {
  selectedIds: Set<string>;
  anchorId: string | null;
  toggledIds: Set<string>;
}

/**
 * Keep range-selection order deterministic even when dashboard sections show
 * the same document more than once.
 */
export function uniqueDocumentIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

function rangeBetween(ids: readonly string[], firstId: string, secondId: string): string[] | null {
  const firstIndex = ids.indexOf(firstId);
  const secondIndex = ids.indexOf(secondId);
  if (firstIndex === -1 || secondIndex === -1) return null;

  const start = Math.min(firstIndex, secondIndex);
  const end = Math.max(firstIndex, secondIndex);
  return ids.slice(start, end + 1);
}

/**
 * Add or remove a single document, ignoring the platform toggle modifier.
 *
 * Row bodies use {@link selectDocumentsByClick} instead, where a plain click
 * replaces the selection the way a file explorer does. Routing a checkbox
 * through that handler left a checked box with no way to clear it, because a
 * plain click on an already-selected document re-selects only that document.
 */
export function toggleDocumentSelection(
  state: DocumentSelectionState,
  clickedId: string,
): DocumentSelectionResult {
  const selectedIds = new Set(state.selectedIds);
  const toggledIds = new Set(state.toggledIds);

  if (selectedIds.has(clickedId)) {
    selectedIds.delete(clickedId);
    toggledIds.delete(clickedId);
    // Clearing the anchor's own row leaves range selection without an origin.
    const anchorId = state.anchorId === clickedId ? null : state.anchorId;
    return { selectedIds, anchorId, toggledIds };
  }

  selectedIds.add(clickedId);
  toggledIds.add(clickedId);
  return { selectedIds, anchorId: clickedId, toggledIds };
}

/**
 * Apply checkbox selection semantics. An unmodified click toggles the clicked
 * document so a checked box is always clearable; Shift still extends a range
 * from the anchor, matching the row-body gesture.
 */
export function selectDocumentsByCheckbox(
  state: DocumentSelectionState,
  orderedIds: readonly string[],
  clickedId: string,
  modifiers: DocumentSelectionModifiers = {},
): DocumentSelectionResult {
  if (modifiers.shiftKey) {
    return selectDocumentsByClick(state, orderedIds, clickedId, { shiftKey: true });
  }
  return toggleDocumentSelection(state, clickedId);
}

/**
 * Apply file-explorer-style selection semantics to an ordered document list.
 * Shift ranges are inclusive and replace the previous range; modifier-toggled
 * documents remain selected as independent additions to that range.
 */
export function selectDocumentsByClick(
  state: DocumentSelectionState,
  orderedIds: readonly string[],
  clickedId: string,
  modifiers: DocumentSelectionModifiers = {},
): DocumentSelectionResult {
  const visibleIds = uniqueDocumentIds(orderedIds);
  const selectedIds = new Set(state.selectedIds);
  const toggledIds = new Set(state.toggledIds);
  const isVisible = visibleIds.includes(clickedId);

  if (modifiers.shiftKey && state.anchorId && isVisible) {
    const range = rangeBetween(visibleIds, state.anchorId, clickedId);
    if (range) {
      return {
        selectedIds: new Set([...range, ...toggledIds]),
        anchorId: state.anchorId,
        toggledIds,
      };
    }
  }

  if (modifiers.toggleKey) {
    if (selectedIds.has(clickedId)) {
      selectedIds.delete(clickedId);
      toggledIds.delete(clickedId);
    } else {
      selectedIds.add(clickedId);
      toggledIds.add(clickedId);
    }
    return { selectedIds, anchorId: clickedId, toggledIds };
  }

  return {
    selectedIds: new Set([clickedId]),
    anchorId: clickedId,
    toggledIds: new Set(),
  };
}
