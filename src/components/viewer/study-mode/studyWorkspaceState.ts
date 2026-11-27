import type {
  DocumentPresentationMode,
  StudyWorkspaceLayout,
} from "../../../types/studyMode";

const MODE_STORAGE_PREFIX = "plethora.studyMode.presentationMode.";
const SPLIT_WIDTH_STORAGE_KEY = "plethora.studyMode.sourceSplitPercent";

export const DEFAULT_SOURCE_SPLIT_PERCENT = 44;
export const MIN_SOURCE_SPLIT_PERCENT = 28;
export const MAX_SOURCE_SPLIT_PERCENT = 68;
export const DESKTOP_SPLIT_MIN_CONTAINER_PX = 860;

export function readRememberedPresentationMode(
  documentId: string,
  rememberModePerSource: boolean,
): DocumentPresentationMode {
  if (!rememberModePerSource || !documentId || typeof window === "undefined" || !window.localStorage) {
    return "read";
  }
  try {
    const saved = window.localStorage.getItem(`${MODE_STORAGE_PREFIX}${documentId}`);
    return saved === "study" ? "study" : "read";
  } catch {
    return "read";
  }
}

export function writeRememberedPresentationMode(
  documentId: string,
  mode: DocumentPresentationMode,
  rememberModePerSource: boolean,
): void {
  if (!rememberModePerSource || !documentId || typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(`${MODE_STORAGE_PREFIX}${documentId}`, mode);
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Coordinates the optional companion surface in Study Mode so that at most one
 * companion pane (either the canonical reader OR the Assistant) is visible at a time.
 */
export function toggleStudyWorkspaceLayout(
  current: StudyWorkspaceLayout,
  requested: "with-source" | "with-assistant",
): StudyWorkspaceLayout {
  return current === requested ? "focused" : requested;
}

export function clampSourceSplitPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SOURCE_SPLIT_PERCENT;
  return Math.max(MIN_SOURCE_SPLIT_PERCENT, Math.min(MAX_SOURCE_SPLIT_PERCENT, Math.round(value)));
}

export function readSourceSplitPercent(): number {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_SOURCE_SPLIT_PERCENT;
  }
  try {
    const raw = window.localStorage.getItem(SPLIT_WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_SOURCE_SPLIT_PERCENT;
    return clampSourceSplitPercent(Number(raw));
  } catch {
    return DEFAULT_SOURCE_SPLIT_PERCENT;
  }
}

export function writeSourceSplitPercent(percent: number): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(SPLIT_WIDTH_STORAGE_KEY, String(clampSourceSplitPercent(percent)));
  } catch {
    // Ignore storage errors
  }
}
