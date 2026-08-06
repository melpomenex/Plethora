/**
 * The single decision behind Extract Mode: should this selection become an
 * extract right now?
 *
 * It lives here rather than inline in DocumentViewer so the rule is testable
 * without mounting a ~7000-line component. Every viewer (PDF, EPUB, Markdown,
 * HTML) routes its selection through the same `updateSelection` state, so one
 * gate covers all four.
 */
export interface ExtractModeGateInput {
  /** Is the toggle on? */
  isExtractMode: boolean;
  /** Extract Mode only applies while reading, not in the other view modes. */
  viewMode: string;
  /** The current selection, as the viewer reported it. */
  selectedText: string;
  /** True while a previous auto-extract is still in flight. */
  busy: boolean;
}

export function shouldAutoExtract({
  isExtractMode,
  viewMode,
  selectedText,
  busy,
}: ExtractModeGateInput): boolean {
  if (!isExtractMode) return false;
  if (viewMode !== "document") return false;
  // Re-entrancy guard: creating an extract mutates the DOM (highlight), which
  // re-fires the selection callbacks. Without this the same passage would be
  // extracted twice.
  if (busy) return false;
  return selectedText.trim().length > 0;
}
