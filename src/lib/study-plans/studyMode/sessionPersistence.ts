import type {
  StudyModeExploreSubView,
  StudyModeSessionDuration,
  StudyModeSessionSnapshot,
  StudyModeViewTab,
} from "../../../types/studyMode";
import { normalizeStudyModeTab } from "../../../types/studyMode";

const STORAGE_PREFIX = "plethora.studyMode.session.";

export const DEFAULT_SESSION_SNAPSHOT: StudyModeSessionSnapshot = {
  activeTab: "learn",
  exploreSubView: "concept_map",
  activeObjectiveId: null,
  activeQuestionId: null,
  draftAnswer: null,
  activeScopeId: null,
  sessionDurationMin: 15,
  focusMode: false,
  lastLocator: null,
  leftPaneWidth: 240,
  rightPaneWidth: 420,
  leftPaneCollapsed: false,
  rightPaneCollapsed: false,
  updatedAt: "",
};

function sanitizeDuration(value: unknown): StudyModeSessionDuration {
  if (value === 5 || value === 15 || value === 30) return value;
  return 15;
}

function sanitizeExploreSubView(value: unknown): StudyModeExploreSubView {
  if (
    value === "concept_map" ||
    value === "timeline" ||
    value === "audio" ||
    value === "slides"
  ) {
    return value;
  }
  return "concept_map";
}

export function parseSessionSnapshot(
  rawJson: string | null | undefined,
  fallbackActiveView?: string | null
): StudyModeSessionSnapshot {
  const normalizedFallback = normalizeStudyModeTab(fallbackActiveView);
  const base: StudyModeSessionSnapshot = {
    ...DEFAULT_SESSION_SNAPSHOT,
    activeTab: normalizedFallback.tab,
    exploreSubView: normalizedFallback.exploreSubView ?? "concept_map",
  };

  if (!rawJson) return base;
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const normalizedTab = normalizeStudyModeTab(
      typeof parsed.activeTab === "string" ? parsed.activeTab : fallbackActiveView
    );
    return {
      activeTab: normalizedTab.tab,
      exploreSubView:
        parsed.exploreSubView !== undefined
          ? sanitizeExploreSubView(parsed.exploreSubView)
          : normalizedTab.exploreSubView ?? base.exploreSubView,
      activeObjectiveId:
        typeof parsed.activeObjectiveId === "string" ? parsed.activeObjectiveId : null,
      activeQuestionId:
        typeof parsed.activeQuestionId === "string" ? parsed.activeQuestionId : null,
      draftAnswer: typeof parsed.draftAnswer === "string" ? parsed.draftAnswer : null,
      activeScopeId: typeof parsed.activeScopeId === "string" ? parsed.activeScopeId : null,
      sessionDurationMin: sanitizeDuration(parsed.sessionDurationMin),
      focusMode: Boolean(parsed.focusMode),
      lastLocator:
        parsed.lastLocator && typeof parsed.lastLocator === "object"
          ? (parsed.lastLocator as StudyModeSessionSnapshot["lastLocator"])
          : null,
      leftPaneWidth:
        typeof parsed.leftPaneWidth === "number" && parsed.leftPaneWidth >= 180
          ? Math.min(420, parsed.leftPaneWidth)
          : DEFAULT_SESSION_SNAPSHOT.leftPaneWidth,
      rightPaneWidth:
        typeof parsed.rightPaneWidth === "number" && parsed.rightPaneWidth >= 280
          ? Math.min(720, parsed.rightPaneWidth)
          : DEFAULT_SESSION_SNAPSHOT.rightPaneWidth,
      leftPaneCollapsed: Boolean(parsed.leftPaneCollapsed),
      rightPaneCollapsed: Boolean(parsed.rightPaneCollapsed),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return base;
  }
}

export function loadLocalSessionSnapshot(scopeKey: string): {
  snapshot: StudyModeSessionSnapshot | null;
  error: string | null;
} {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return { snapshot: null, error: null };
    }
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${scopeKey}`);
    if (!raw) return { snapshot: null, error: null };
    return { snapshot: parseSessionSnapshot(raw), error: null };
  } catch (err) {
    return {
      snapshot: null,
      error: err instanceof Error ? err.message : "Failed to read local study session state.",
    };
  }
}

export function saveLocalSessionSnapshot(
  scopeKey: string,
  snapshot: StudyModeSessionSnapshot
): { ok: boolean; error: string | null } {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return { ok: true, error: null };
    }
    const payload: StudyModeSessionSnapshot = {
      ...snapshot,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(`${STORAGE_PREFIX}${scopeKey}`, JSON.stringify(payload));
    return { ok: true, error: null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save local study session state.",
    };
  }
}

export function serializeSessionEnvelope(snapshot: StudyModeSessionSnapshot): string {
  return JSON.stringify({
    ...snapshot,
    updatedAt: snapshot.updatedAt || new Date().toISOString(),
  });
}

export function pickNewerSnapshot(
  localSnap: StudyModeSessionSnapshot | null,
  remoteSnap: StudyModeSessionSnapshot | null
): StudyModeSessionSnapshot {
  if (localSnap && remoteSnap) {
    const localTime = Date.parse(localSnap.updatedAt || "") || 0;
    const remoteTime = Date.parse(remoteSnap.updatedAt || "") || 0;
    return localTime > remoteTime ? localSnap : remoteSnap;
  }
  return remoteSnap ?? localSnap ?? { ...DEFAULT_SESSION_SNAPSHOT };
}

export function isValidStudyTab(value: string): value is StudyModeViewTab {
  return value === "learn" || value === "practice" || value === "explore" || value === "progress";
}
