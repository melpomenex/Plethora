const GLOBAL_GESTURE_EXCLUSION = [
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "[contenteditable='true']",
  "[role='button']",
  "[role='dialog']",
  "[data-gesture-lock]",
  "[data-horizontal-scroll]",
  ".swipeable-item",
  ".viewer-content",
  ".pdf-viewer",
  ".epub-viewer",
].join(",");

export function shouldIgnoreGlobalGesture(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest(GLOBAL_GESTURE_EXCLUSION))
  );
}

