const NON_VIEWER_OVERLAY_SELECTOR =
  "[data-assistant-panel='true'], .context-menu, [role='dialog']";

function toElement(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

/**
 * Returns true when a browser Selection is anchored inside this DocumentViewer's
 * own content surface and not inside `.textLayer`, the Assistant panel, or overlays.
 */
export function isDesktopSelectionInViewerContent(
  selection: Selection | null,
  viewerRoot: Element | null,
): boolean {
  if (!selection) return false;
  const anchorElement = toElement(selection.anchorNode);
  const focusElement = toElement(selection.focusNode);

  if (anchorElement?.closest(".textLayer") || focusElement?.closest(".textLayer")) {
    return false;
  }
  if (
    anchorElement?.closest(NON_VIEWER_OVERLAY_SELECTOR) ||
    focusElement?.closest(NON_VIEWER_OVERLAY_SELECTOR)
  ) {
    return false;
  }
  if (!selection.toString().trim()) {
    return true;
  }
  if (!viewerRoot || !anchorElement || !focusElement) {
    return false;
  }
  return (
    viewerRoot.contains(anchorElement) &&
    viewerRoot.contains(focusElement) &&
    Boolean(anchorElement.closest("[data-document-content='true']")) &&
    Boolean(focusElement.closest("[data-document-content='true']"))
  );
}

/**
 * Returns true when a mobile selection is anchored inside this DocumentViewer's
 * own content surface (`.prose`, `.textLayer`, or `[data-document-content='true']`)
 * and not inside the Assistant panel or overlays.
 */
export function isMobileSelectionInViewerContent(
  selection: Selection | null,
  viewerRoot: Element | null,
): boolean {
  if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) {
    return false;
  }
  const anchorElement = toElement(selection.anchorNode);
  const focusElement = toElement(selection.focusNode);

  if (
    anchorElement?.closest(NON_VIEWER_OVERLAY_SELECTOR) ||
    focusElement?.closest(NON_VIEWER_OVERLAY_SELECTOR)
  ) {
    return false;
  }

  const inViewer = (el: Element | null) =>
    Boolean(
      el &&
      viewerRoot?.contains(el) &&
      (el.closest("[data-document-content='true']") ||
        el.closest(".prose") ||
        el.closest(".textLayer")),
    );

  return inViewer(anchorElement) || inViewer(focusElement);
}

/**
 * Returns true when a mousedown outside the floating extract button should
 * clear the active document selection. Interactions with the extract button,
 * dialogs, context menus, or the Assistant panel must NOT clear selection.
 */
export function shouldDismissViewerSelectionOnMouseDown(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest(
    "[data-extract-button='true'], [role='dialog'], .context-menu, [data-assistant-panel='true']",
  );
}
