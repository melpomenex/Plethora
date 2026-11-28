/**
 * Universal Study Workspace Launcher.
 *
 * Resolves any canonical `LearningActivity` into a single, deterministic workspace
 * launch plan and dispatches navigation without creating duplicate reader tabs.
 *
 * Document-backed reading and study activities always route into the single
 * canonical `DocumentViewerWrapper` host with mutually exclusive `"read" | "study"`
 * presentation mode, preserved reading location, and return-to-origin metadata.
 */

import type {
  LearningActivity,
  LearningActivityType,
} from "../../types/learningActivity";
import type {
  DocumentPresentationMode,
  StudyWorkspaceLayout,
} from "../../types/studyMode";
import type { TabType } from "../../stores/tabsStore";

export interface ReadingLocation {
  page?: number;
  cfi?: string;
  offset?: number;
  locator?: string;
}

export interface ReturnOriginRoute {
  tabId?: string;
  tabType: TabType;
  sessionId?: string;
  activityId?: string;
  scrollState?: Record<string, unknown>;
}

export interface WorkspaceLaunchOptions {
  preferredMode?: DocumentPresentationMode;
  preferredLayout?: StudyWorkspaceLayout;
  readingLocation?: ReadingLocation;
  returnTo?: ReturnOriginRoute;
  examIsolated?: boolean;
}

export type WorkspaceTargetSurface =
  | "document-viewer"
  | "review"
  | "study-plans"
  | "extracts"
  | "media-player";

export type AssistantSuppressionReason =
  | "exam_isolated"
  | "ai_excluded"
  | "local_only";

export interface WorkspaceLaunchPlan {
  activityId: string;
  activityType: LearningActivityType;
  surface: WorkspaceTargetSurface;
  tabType: TabType;
  routePath: string;
  canonicalReaderHost: "DocumentViewerWrapper" | null;
  reuseExistingReaderTab: boolean;
  documentId: string | null;
  entityId: string | null;
  presentationMode: DocumentPresentationMode | null;
  layout: StudyWorkspaceLayout | null;
  readingLocation: ReadingLocation | null;
  examIsolated: boolean;
  assistantSuppressed: boolean;
  assistantSuppressionReason: AssistantSuppressionReason | null;
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  returnTo: ReturnOriginRoute | null;
  payload: Record<string, unknown>;
}

export interface WorkspaceNavigateEvent {
  path: string;
  tabType: TabType;
  reuseExistingTab: boolean;
  state: {
    activityId: string;
    activityType: LearningActivityType;
    documentId: string | null;
    entityId: string | null;
    canonicalReaderHost: "DocumentViewerWrapper" | null;
    presentationMode: DocumentPresentationMode | null;
    layout: StudyWorkspaceLayout | null;
    readingLocation: ReadingLocation | null;
    examIsolated: boolean;
    assistantSuppressed: boolean;
    assistantSuppressionReason: AssistantSuppressionReason | null;
    returnTo: ReturnOriginRoute | null;
    payload: Record<string, unknown>;
  };
}

export type WorkspaceNavigateDispatcher = (event: WorkspaceNavigateEvent) => void;

function extractDocumentId(activity: LearningActivity): string | null {
  for (const ref of activity.sourceReferences) {
    if (ref.documentId) return ref.documentId;
    if (ref.entityKind === "document" && ref.entityId) return ref.entityId;
  }
  const resumeDocId = activity.resumeState?.documentId;
  return typeof resumeDocId === "string" && resumeDocId.length > 0
    ? resumeDocId
    : null;
}

function extractPrimaryEntityId(activity: LearningActivity): string | null {
  const firstRef = activity.sourceReferences[0];
  return firstRef?.entityId ?? null;
}

function extractReadingLocation(
  activity: LearningActivity,
  override?: ReadingLocation
): ReadingLocation | null {
  if (override && Object.keys(override).length > 0) {
    return { ...override };
  }
  const rs = activity.resumeState;
  if (!rs) return null;

  const loc: ReadingLocation = {};
  if (typeof rs.page === "number") loc.page = rs.page;
  if (typeof rs.cfi === "string" && rs.cfi.length > 0) loc.cfi = rs.cfi;
  if (typeof rs.offset === "number") loc.offset = rs.offset;
  if (typeof rs.locator === "string" && rs.locator.length > 0) {
    loc.locator = rs.locator;
  }
  return Object.keys(loc).length > 0 ? loc : null;
}

function resolveAssistantSuppression(
  examIsolated: boolean,
  isAiExcluded: boolean,
  isLocalOnly: boolean
): {
  assistantSuppressed: boolean;
  assistantSuppressionReason: AssistantSuppressionReason | null;
} {
  if (examIsolated) {
    return {
      assistantSuppressed: true,
      assistantSuppressionReason: "exam_isolated",
    };
  }
  if (isAiExcluded) {
    return {
      assistantSuppressed: true,
      assistantSuppressionReason: "ai_excluded",
    };
  }
  if (isLocalOnly) {
    return {
      assistantSuppressed: true,
      assistantSuppressionReason: "local_only",
    };
  }
  return {
    assistantSuppressed: false,
    assistantSuppressionReason: null,
  };
}

function resolveLayout(
  requested: StudyWorkspaceLayout | undefined,
  defaultLayout: StudyWorkspaceLayout,
  assistantSuppressed: boolean
): StudyWorkspaceLayout {
  const chosen = requested ?? defaultLayout;
  if (assistantSuppressed && chosen === "with-assistant") {
    return "focused";
  }
  return chosen;
}

/**
 * Build a canonical workspace launch plan for any `LearningActivity`.
 */
export function buildWorkspaceLaunchPlan(
  activity: LearningActivity,
  options: WorkspaceLaunchOptions = {}
): WorkspaceLaunchPlan {
  const documentId = extractDocumentId(activity);
  const entityId = extractPrimaryEntityId(activity);
  const readingLocation = extractReadingLocation(activity, options.readingLocation);
  const examIsolated = Boolean(
    options.examIsolated ||
      activity.examIsolated ||
      activity.activityType === "rubric_assessment"
  );
  const { assistantSuppressed, assistantSuppressionReason } =
    resolveAssistantSuppression(
      examIsolated,
      activity.isAiExcluded,
      activity.isLocalOnly
    );

  const returnTo: ReturnOriginRoute | null = options.returnTo
    ? {
        ...options.returnTo,
        activityId: options.returnTo.activityId ?? activity.id,
      }
    : null;

  const base = {
    activityId: activity.id,
    activityType: activity.activityType,
    documentId,
    entityId,
    readingLocation,
    examIsolated,
    assistantSuppressed,
    assistantSuppressionReason,
    isLocalOnly: activity.isLocalOnly,
    isAiExcluded: activity.isAiExcluded,
    returnTo,
  };

  switch (activity.activityType) {
    case "source_reading": {
      const presentationMode: DocumentPresentationMode =
        options.preferredMode ?? "read";
      const layout = resolveLayout(
        options.preferredLayout,
        "focused",
        assistantSuppressed
      );
      return {
        ...base,
        surface: "document-viewer",
        tabType: "document-viewer",
        routePath: documentId ? `/documents/${documentId}` : "/documents",
        canonicalReaderHost: "DocumentViewerWrapper",
        reuseExistingReaderTab: true,
        presentationMode,
        layout,
        payload: {
          mode: presentationMode,
          layout,
          conceptReferences: activity.conceptReferences,
        },
      };
    }

    case "guided_reading":
    case "comprehension_check":
    case "socratic_tutoring":
    case "reflection_formulation": {
      const presentationMode: DocumentPresentationMode =
        options.preferredMode ?? "study";
      const defaultLayout: StudyWorkspaceLayout =
        activity.activityType === "socratic_tutoring"
          ? "with-assistant"
          : "with-source";
      const layout = resolveLayout(
        options.preferredLayout,
        defaultLayout,
        assistantSuppressed
      );
      return {
        ...base,
        surface: "document-viewer",
        tabType: "document-viewer",
        routePath: documentId ? `/documents/${documentId}` : "/documents",
        canonicalReaderHost: "DocumentViewerWrapper",
        reuseExistingReaderTab: true,
        presentationMode,
        layout,
        payload: {
          mode: presentationMode,
          layout,
          activityType: activity.activityType,
          conceptReferences: activity.conceptReferences,
        },
      };
    }

    case "targeted_remediation": {
      if (documentId) {
        const presentationMode: DocumentPresentationMode =
          options.preferredMode ?? "study";
        const layout = resolveLayout(
          options.preferredLayout,
          "with-source",
          assistantSuppressed
        );
        return {
          ...base,
          surface: "document-viewer",
          tabType: "document-viewer",
          routePath: `/documents/${documentId}`,
          canonicalReaderHost: "DocumentViewerWrapper",
          reuseExistingReaderTab: true,
          presentationMode,
          layout,
          payload: {
            mode: presentationMode,
            layout,
            remediation: true,
            conceptReferences: activity.conceptReferences,
          },
        };
      }
      return {
        ...base,
        surface: "study-plans",
        tabType: "study-plans",
        routePath: "/study-plans",
        canonicalReaderHost: null,
        reuseExistingReaderTab: false,
        presentationMode: "study",
        layout: null,
        payload: {
          remediation: true,
          conceptReferences: activity.conceptReferences,
        },
      };
    }

    case "flashcard_review":
      return {
        ...base,
        surface: "review",
        tabType: "review",
        routePath: "/review",
        canonicalReaderHost: null,
        reuseExistingReaderTab: false,
        presentationMode: null,
        layout: null,
        payload: {
          entityId,
          conceptReferences: activity.conceptReferences,
        },
      };

    case "extract_review":
      if (documentId && options.preferredMode) {
        const layout = resolveLayout(
          options.preferredLayout,
          "with-source",
          assistantSuppressed
        );
        return {
          ...base,
          surface: "document-viewer",
          tabType: "document-viewer",
          routePath: `/documents/${documentId}`,
          canonicalReaderHost: "DocumentViewerWrapper",
          reuseExistingReaderTab: true,
          presentationMode: options.preferredMode,
          layout,
          payload: {
            extractId: entityId,
            mode: options.preferredMode,
            layout,
          },
        };
      }
      return {
        ...base,
        surface: "extracts",
        tabType: "extracts",
        routePath: "/extracts",
        canonicalReaderHost: null,
        reuseExistingReaderTab: false,
        presentationMode: null,
        layout: null,
        payload: {
          extractId: entityId,
          documentId,
        },
      };

    case "media_consumption":
      if (documentId) {
        const presentationMode: DocumentPresentationMode =
          options.preferredMode ?? "read";
        const layout = resolveLayout(
          options.preferredLayout,
          "focused",
          assistantSuppressed
        );
        return {
          ...base,
          surface: "document-viewer",
          tabType: "document-viewer",
          routePath: `/documents/${documentId}`,
          canonicalReaderHost: "DocumentViewerWrapper",
          reuseExistingReaderTab: true,
          presentationMode,
          layout,
          payload: {
            media: true,
            mode: presentationMode,
            layout,
          },
        };
      }
      return {
        ...base,
        surface: "media-player",
        tabType: "audiobook",
        routePath: "/audiobook",
        canonicalReaderHost: null,
        reuseExistingReaderTab: false,
        presentationMode: null,
        layout: null,
        payload: {
          entityId,
        },
      };

    case "rubric_assessment":
      return {
        ...base,
        surface: "study-plans",
        tabType: "study-plans",
        routePath: "/study-plans",
        canonicalReaderHost: null,
        reuseExistingReaderTab: false,
        presentationMode: null,
        layout: null,
        examIsolated: true,
        assistantSuppressed: true,
        assistantSuppressionReason: "exam_isolated",
        payload: {
          runner: "exam",
          examIsolated: true,
          suppressAssistant: true,
          suppressCoaching: true,
          entityId,
          goalReferences: activity.goalReferences,
          conceptReferences: activity.conceptReferences,
        },
      };

    case "free_response_practice":
    case "objective_question_practice":
    case "structured_problem_solving":
      if (documentId) {
        const presentationMode: DocumentPresentationMode =
          options.preferredMode ?? "study";
        const layout = resolveLayout(
          options.preferredLayout,
          "with-source",
          assistantSuppressed
        );
        return {
          ...base,
          surface: "document-viewer",
          tabType: "document-viewer",
          routePath: `/documents/${documentId}`,
          canonicalReaderHost: "DocumentViewerWrapper",
          reuseExistingReaderTab: true,
          presentationMode,
          layout,
          payload: {
            mode: presentationMode,
            layout,
            practiceType: activity.activityType,
            conceptReferences: activity.conceptReferences,
          },
        };
      }
      return {
        ...base,
        surface: "study-plans",
        tabType: "study-plans",
        routePath: "/study-plans",
        canonicalReaderHost: null,
        reuseExistingReaderTab: false,
        presentationMode: "study",
        layout: null,
        payload: {
          practiceType: activity.activityType,
          goalReferences: activity.goalReferences,
          conceptReferences: activity.conceptReferences,
        },
      };
  }
}

/**
 * Dispatch clean navigation for a `LearningActivity`, preserving return-to-origin
 * metadata and preventing duplicate reader tab creation.
 */
export function launchLearningActivity(
  activity: LearningActivity,
  dispatchNavigate: WorkspaceNavigateDispatcher,
  options: WorkspaceLaunchOptions = {}
): { plan: WorkspaceLaunchPlan; event: WorkspaceNavigateEvent } {
  const plan = buildWorkspaceLaunchPlan(activity, options);
  const event: WorkspaceNavigateEvent = {
    path: plan.routePath,
    tabType: plan.tabType,
    reuseExistingTab: plan.reuseExistingReaderTab,
    state: {
      activityId: plan.activityId,
      activityType: plan.activityType,
      documentId: plan.documentId,
      entityId: plan.entityId,
      canonicalReaderHost: plan.canonicalReaderHost,
      presentationMode: plan.presentationMode,
      layout: plan.layout,
      readingLocation: plan.readingLocation,
      examIsolated: plan.examIsolated,
      assistantSuppressed: plan.assistantSuppressed,
      assistantSuppressionReason: plan.assistantSuppressionReason,
      returnTo: plan.returnTo,
      payload: plan.payload,
    },
  };

  dispatchNavigate(event);
  return { plan, event };
}
