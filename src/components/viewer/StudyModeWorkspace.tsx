import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowsInSimple,
  ArrowsOutSimple,
  BookOpen,
  CaretLeft,
  CaretRight,
  ChartBar,
  ChatCircleText,
  ClockCounterClockwise,
  Compass,
  Exam,
  Lightbulb,
  LinkSimple,
  ListBullets,
  SlidersHorizontal,
  Sparkle,
  Trash,
  WarningCircle,
  WifiSlash,
  X,
} from "@phosphor-icons/react";
import {
  getConceptMasterySummary,
  getStudyPlanEvidence,
  listLearningGaps,
} from "../../api/learning-evidence";
import {
  createStudyFormativeQuestion,
  deleteStudyLearnerPreference,
  deleteStudyModeArtifact,
  deleteStudyModeArtifactsForScope,
  dismissStudyModeArtifact,
  findStudyModeSessionByScope,
  listStudyLearnerPreferences,
  listStudyModeArtifacts,
  markStudyModeArtifactsStale,
  recordStudyEfficacyEvent,
  restoreStudyModeArtifact,
  saveStudyModeArtifact,
  submitStudyFormativeAnswer,
  upsertStudyLearnerPreference,
  upsertStudyModeSession,
} from "../../api/study-mode";
import { isTauri } from "../../lib/tauri";
import { runTask } from "../../lib/ai/tasks/runTask";
import {
  studyModeAudioScriptTask,
  studyModeComponentTask,
  studyModeFormativeQuestionTask,
  studyModeMindMapTask,
  studyModeSlidesTask,
  studyModeTimelineTask,
} from "../../lib/ai/tasks/definitions/studyModeTasks";
import {
  buildStudyAnchorsFromPayload,
  formatAnchorLocationLabel,
} from "../../lib/study-plans/studyMode/anchoring";
import {
  buildStudyModeTutorPacket,
  type ContextualTutorPromptOption,
} from "../../lib/study-plans/studyMode/contextualTutor";
import { computeStudyProgressSnapshot } from "../../lib/study-plans/studyMode/evidenceProgress";
import {
  createInitialGuidedLoopState,
  getCurrentGuidedObjective,
  guidedLoopReducer,
} from "../../lib/study-plans/studyMode/guidedLoop";
import {
  buildSubjectPreferenceUpdate,
  getInlineAdjustment,
  type InlineAdjustmentId,
} from "../../lib/study-plans/studyMode/inlinePersonalization";
import { buildBoundedLearnerContext } from "../../lib/study-plans/studyMode/learnerContext";
import { verifyStudyModeArtifactDeterministic } from "../../lib/study-plans/studyMode/pedagogicalVerifier";
import {
  computeSemanticQuestionFingerprint,
  evaluatePracticeAnswerLocally,
  isSemanticallyDuplicateQuestion,
  selectAdaptiveDifficulty,
  type CorePracticeQuestionKind,
  type PracticeAnswerPayload,
  type PracticeEvaluationResult,
  type PracticeQuestionItem,
} from "../../lib/study-plans/studyMode/practiceEngine";
import { buildStudyScopeKey } from "../../lib/study-plans/studyMode/scopeKey";
import {
  DEFAULT_SESSION_SNAPSHOT,
  loadLocalSessionSnapshot,
  parseSessionSnapshot,
  pickNewerSnapshot,
  saveLocalSessionSnapshot,
  serializeSessionEnvelope,
} from "../../lib/study-plans/studyMode/sessionPersistence";
import {
  resolveStudyScopes,
  type StudyScopeOptionId,
} from "../../lib/study-plans/studyMode/sourceScopeResolver";
import {
  buildStudyAssistantContext,
  type StudyAssistantContextSummary,
} from "../../lib/study-plans/studyMode/studyAssistantContext";
import {
  classifyStudyModeError,
  type StudyModeErrorPresentation,
} from "../../lib/study-plans/studyMode/studyErrorTaxonomy";
import {
  isStudyTaskSuccess,
  useStudyTaskController,
} from "../../lib/study-plans/studyMode/taskController";
import { registerOverlayDismissal } from "../../lib/overlayStack";
import { useSettingsStore } from "../../stores/settingsStore";
import type { ConceptMasterySummary, KnowledgeGapView } from "../../types/learningEvidence";
import type { ExactSearchHitLocation } from "../../types/searchHit";
import type { SectionNode } from "../../utils/sectionIndex";
import type {
  StudyLearnerPreference,
  StudyModeArtifact,
  StudyModeExploreSubView,
  StudyModeKnowledgeAuthority,
  StudyModeSessionDuration,
  StudyModeSessionSnapshot,
  StudyModeViewTab,
  StudySourceAnchor,
  StudyWorkspaceLayout,
} from "../../types/studyMode";
import { StudyModePreferencesDrawer } from "./StudyModePreferencesDrawer";
import { TutorSheet } from "../tutor/TutorSheet";
import { ArtifactHistoryPanel } from "./study-mode/ArtifactHistoryPanel";
import { ContextualTutorBar } from "./study-mode/ContextualTutorBar";
import { GuidedLoopBanner } from "./study-mode/GuidedLoopBanner";
import { InlinePersonalizationChips } from "./study-mode/InlinePersonalizationChips";
import { InteractiveConceptMap } from "./study-mode/InteractiveConceptMap";
import { deriveStudyPathSteps } from "./study-mode/LearningPathPane";
import { PlayableAudioLessonPlayer } from "./study-mode/PlayableAudioLessonPlayer";
import { PlayableSlidesPlayer } from "./study-mode/PlayableSlidesPlayer";
import { PracticePanel } from "./study-mode/PracticePanel";
import { ProgressPanel } from "./study-mode/ProgressPanel";
import { StudyTimelineView } from "./study-mode/StudyTimelineView";

export interface StudyModeWorkspaceProps {
  documentId: string;
  documentTitle: string;
  docType?: string;
  sourceRevision: string;
  passageText: string;
  liveContextText?: string | null;
  sections?: SectionNode[];
  pdfPageNumber?: number | null;
  pdfTotalPages?: number | null;
  mediaCurrentTimeSeconds?: number | null;
  subjectKey?: string;
  knowledgeAuthority?: StudyModeKnowledgeAuthority;
  studyPlanContext?: {
    planId: string;
    versionId: string;
    topicId: string;
    segmentId?: string;
    topicTitle?: string;
  };
  studyTrailNav?: {
    stepLabel: string;
    canPrev: boolean;
    canNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  } | null;
  initialSelection?: string | null;
  currentLocator?: ExactSearchHitLocation | null;
  isMobile?: boolean;
  workspaceLayout?: StudyWorkspaceLayout;
  onToggleSource?: () => void;
  onToggleAssistant?: () => void;
  onOpenAiSettings?: () => void;
  onStudyAssistantContextChange?: (summary: StudyAssistantContextSummary) => void;
  onJumpToSource?: (quote?: string, locator?: ExactSearchHitLocation) => void;
  onExitStudyMode: () => void;
  onOpenTutor?: () => void;
  onPromoteFlashcard?: (prompt: string, explanation: string) => void;
}

type StudyPanelId = "learn" | "practice" | "explore" | "progress";

interface StudyPanelError {
  presentation: StudyModeErrorPresentation;
  retryAction?: () => void;
}

const PRIMARY_TABS: Array<{ id: StudyModeViewTab; label: string; shortcut: string }> = [
  { id: "learn", label: "Learn", shortcut: "Alt+1" },
  { id: "practice", label: "Practice", shortcut: "Alt+2" },
  { id: "explore", label: "Explore", shortcut: "Alt+3" },
  { id: "progress", label: "Progress", shortcut: "Alt+4" },
];

const EXPLORE_SUBVIEWS: Array<{ id: StudyModeExploreSubView; label: string; description: string }> = [
  { id: "concept_map", label: "Concept Map", description: "Interactive graph of key ideas" },
  { id: "timeline", label: "Timeline", description: "Chronological or logical sequence" },
  { id: "audio", label: "Audio Lesson", description: "Guided spoken walkthrough" },
  { id: "slides", label: "Slides", description: "Visual presentation deck" },
];

const LEARN_ACTIVITIES: Array<{
  kind: "explanation" | "summary" | "worked_example" | "misconceptions" | "memory_aid";
  title: string;
  description: string;
  buttonLabel: string;
  primary?: boolean;
}> = [
  {
    kind: "explanation",
    title: "Explain",
    description: "Understand difficult ideas in clear, structured steps",
    buttonLabel: "Alternative Explanation",
    primary: true,
  },
  {
    kind: "summary",
    title: "Summarize",
    description: "Distill the key takeaways and structure of this scope",
    buttonLabel: "Section Summary",
  },
  {
    kind: "worked_example",
    title: "Worked examples",
    description: "See core concepts applied step by step",
    buttonLabel: "Worked Example",
  },
  {
    kind: "misconceptions",
    title: "Common misconceptions",
    description: "Spot subtle traps and clarify frequent errors",
    buttonLabel: "Common Misconceptions",
  },
  {
    kind: "memory_aid",
    title: "Memory aids",
    description: "Analogies and cues to make key points stick",
    buttonLabel: "Memory Aid",
  },
];

function isTextInputElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function getArtifactAnchors(artifact: StudyModeArtifact): StudySourceAnchor[] {
  if (!Array.isArray(artifact.anchors)) return [];
  return artifact.anchors.filter(
    (a): a is StudySourceAnchor =>
      Boolean(a && typeof a === "object" && "locator" in (a as Record<string, unknown>)),
  );
}

const EMPTY_SECTIONS: SectionNode[] = [];

export const StudyModeWorkspace: React.FC<StudyModeWorkspaceProps> = ({
  documentId,
  documentTitle,
  docType = "text",
  sourceRevision,
  passageText,
  liveContextText = null,
  sections = EMPTY_SECTIONS,
  pdfPageNumber = null,
  pdfTotalPages = null,
  mediaCurrentTimeSeconds = null,
  subjectKey = "__global__",
  knowledgeAuthority = "source-only",
  studyPlanContext,
  studyTrailNav = null,
  initialSelection = null,
  currentLocator = null,
  isMobile = false,
  workspaceLayout = "focused",
  onToggleSource,
  onToggleAssistant,
  onOpenAiSettings,
  onStudyAssistantContextChange,
  onJumpToSource,
  onExitStudyMode,
  onOpenTutor,
  onPromoteFlashcard,
}) => {
  const studySettings = useSettingsStore((s) => s.settings.studyMode);

  // Source-aware scope resolution
  const [activeSelection, setActiveSelection] = useState<string | null>(
    initialSelection?.trim() ? initialSelection.trim() : null,
  );

  useEffect(() => {
    if (initialSelection?.trim()) {
      setActiveSelection(initialSelection.trim());
    }
  }, [initialSelection]);

  const resolvedScopes = useMemo(
    () =>
      resolveStudyScopes({
        documentId,
        documentTitle,
        docType,
        liveContextText,
        documentContent: passageText,
        selectionText: activeSelection,
        currentLocator,
        pdfPageNumber,
        pdfTotalPages,
        sections,
        mediaCurrentTimeSeconds,
        studyPlanContext,
      }),
    [
      activeSelection,
      currentLocator,
      docType,
      documentId,
      documentTitle,
      liveContextText,
      mediaCurrentTimeSeconds,
      passageText,
      pdfPageNumber,
      pdfTotalPages,
      sections,
      studyPlanContext,
    ],
  );

  const [selectedScopeId, setSelectedScopeId] = useState<StudyScopeOptionId>(
    resolvedScopes.defaultScopeId,
  );

  useEffect(() => {
    if (!resolvedScopes.options.some((o) => o.id === selectedScopeId)) {
      setSelectedScopeId(resolvedScopes.defaultScopeId);
    }
  }, [resolvedScopes.defaultScopeId, resolvedScopes.options, selectedScopeId]);

  const activeScope = useMemo(
    () =>
      resolvedScopes.options.find((o) => o.id === selectedScopeId) ??
      resolvedScopes.options[0],
    [resolvedScopes.options, selectedScopeId],
  );

  const scopeKind = activeScope?.scopeKind ?? "standalone_document";
  const effectivePassage = activeScope?.passageText ?? passageText;

  const scopeKey = useMemo(
    () =>
      buildStudyScopeKey({
        scopeKind,
        documentId,
        scopeIdentity: activeScope?.scopeIdentity ?? null,
        sourceRevision,
        studyPlanId: studyPlanContext?.planId ?? null,
        topicId: studyPlanContext?.topicId ?? null,
        segmentId: studyPlanContext?.segmentId ?? null,
        selectionText: activeScope?.id === "selected_passage" ? activeSelection : null,
        locator: activeScope?.locator ?? currentLocator,
      }),
    [
      activeScope?.id,
      activeScope?.locator,
      activeScope?.scopeIdentity,
      activeSelection,
      currentLocator,
      documentId,
      scopeKind,
      sourceRevision,
      studyPlanContext,
    ],
  );

  // Synchronous local hydration so activeTab never flashes on mount
  const initialLocal = useMemo(() => loadLocalSessionSnapshot(scopeKey), [scopeKey]);
  const initialSnap = initialLocal.snapshot ?? DEFAULT_SESSION_SNAPSHOT;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StudyModeViewTab>(initialSnap.activeTab);
  const [exploreSubView, setExploreSubView] = useState<StudyModeExploreSubView>(
    initialSnap.exploreSubView,
  );
  const [activeObjectiveId, setActiveObjectiveId] = useState<string | null>(
    initialSnap.activeObjectiveId,
  );
  const [sessionDurationMin, setSessionDurationMin] = useState<StudyModeSessionDuration>(
    initialSnap.sessionDurationMin,
  );
  const [focusMode, setFocusMode] = useState<boolean>(initialSnap.focusMode);
  const [lastLocator, setLastLocator] = useState<ExactSearchHitLocation | null>(
    currentLocator ?? initialSnap.lastLocator,
  );
  const [draftAnswer, setDraftAnswer] = useState<string>(initialSnap.draftAnswer ?? "");

  const [artifacts, setArtifacts] = useState<StudyModeArtifact[]>([]);
  const [selectedLearnArtifactId, setSelectedLearnArtifactId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<StudyLearnerPreference[]>([]);
  const [showCustomize, setShowCustomize] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmClearScope, setConfirmClearScope] = useState(false);
  const [activeAnchor, setActiveAnchor] = useState<StudySourceAnchor | null>(null);
  const [selectedConceptLabel, setSelectedConceptLabel] = useState<string | null>(null);
  const [citationNotice, setCitationNotice] = useState<string | null>(null);

  // Network offline vs. persistence error state
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine === false : false,
  );
  const [persistenceError, setPersistenceError] = useState<string | null>(initialLocal.error);
  const [panelErrors, setPanelErrors] = useState<Record<StudyPanelId, StudyPanelError | null>>({
    learn: null,
    practice: null,
    explore: null,
    progress: null,
  });

  // Independent, cancellable per-task controller + monotonic scope epoch guard
  const taskController = useStudyTaskController();
  const activeScopeEpochRef = useRef(0);

  // Guided Loop state (Freeform by default)
  const [guidedState, dispatchGuided] = useReducer(
    guidedLoopReducer,
    undefined,
    () => createInitialGuidedLoopState(),
  );

  // Adaptive Practice state
  const [activeQuestion, setActiveQuestion] = useState<PracticeQuestionItem | null>(null);
  const [lastEvaluation, setLastEvaluation] = useState<PracticeEvaluationResult | null>(null);
  const [sessionEvaluations, setSessionEvaluations] = useState<PracticeEvaluationResult[]>([]);
  const [priorQuestionPrompts, setPriorQuestionPrompts] = useState<string[]>([]);

  // Unified Learning Evidence state
  const [evidenceSummaries, setEvidenceSummaries] = useState<ConceptMasterySummary[]>([]);
  const [evidenceGaps, setEvidenceGaps] = useState<KnowledgeGapView[]>([]);
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);

  // Contextual Tutor state (reuses Plethora's existing TutorSheet)
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorPromptText, setTutorPromptText] = useState<string | null>(null);

  // Inline personalization state
  const [activeInlineAdjustment, setActiveInlineAdjustment] = useState<InlineAdjustmentId | null>(
    null,
  );
  const [savedDefaultNotice, setSavedDefaultNotice] = useState<{
    adjustmentLabel: string;
    subjectLabel: string;
    previousPreference: StudyLearnerPreference | null;
    savedSubjectKey: string;
  } | null>(null);

  // Track online/offline browser events
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Register transient overlays with Plethora's overlayStack for Escape & native mobile Back
  useEffect(() => {
    if (!showCustomize && !showHistory && !confirmClearScope) return;
    return registerOverlayDismissal(() => {
      if (confirmClearScope) {
        setConfirmClearScope(false);
        return true;
      }
      if (showCustomize) {
        setShowCustomize(false);
        return true;
      }
      if (showHistory) {
        setShowHistory(false);
        return true;
      }
      return false;
    });
  }, [confirmClearScope, showCustomize, showHistory]);

  const buildCurrentSnapshot = useCallback(
    (overrides?: Partial<StudyModeSessionSnapshot>): StudyModeSessionSnapshot => ({
      activeTab,
      exploreSubView,
      activeObjectiveId,
      activeQuestionId: activeQuestion?.id ?? null,
      draftAnswer,
      activeScopeId: selectedScopeId,
      sessionDurationMin,
      focusMode,
      lastLocator,
      leftPaneWidth: DEFAULT_SESSION_SNAPSHOT.leftPaneWidth,
      rightPaneWidth: DEFAULT_SESSION_SNAPSHOT.rightPaneWidth,
      leftPaneCollapsed: false,
      rightPaneCollapsed: false,
      updatedAt: new Date().toISOString(),
      ...overrides,
    }),
    [
      activeObjectiveId,
      activeQuestion?.id,
      activeTab,
      draftAnswer,
      exploreSubView,
      focusMode,
      lastLocator,
      selectedScopeId,
      sessionDurationMin,
    ],
  );

  // Persist snapshot locally and to SQLite session
  const persistSessionState = useCallback(
    async (overrides?: Partial<StudyModeSessionSnapshot>, explicitSessionId?: string | null) => {
      const snap = buildCurrentSnapshot(overrides);
      const localResult = saveLocalSessionSnapshot(scopeKey, snap);
      if (!localResult.ok && localResult.error) {
        setPersistenceError(localResult.error);
      }
      try {
        const upserted = await upsertStudyModeSession({
          id: explicitSessionId ?? sessionId,
          scopeKind,
          scopeKey,
          documentId,
          studyPlanId: studyPlanContext?.planId ?? null,
          planVersionId: studyPlanContext?.versionId ?? null,
          topicId: studyPlanContext?.topicId ?? null,
          segmentId: studyPlanContext?.segmentId ?? null,
          sourceRevision,
          knowledgeAuthority,
          activeView: snap.activeTab,
          lastLocatorJson: serializeSessionEnvelope(snap),
        });
        setSessionId(upserted.id);
        setPersistenceError(null);
      } catch (err) {
        setPersistenceError(
          err instanceof Error
            ? `Session persistence failed: ${err.message}`
            : "Could not save study session state to local database.",
        );
      }
    },
    [
      buildCurrentSnapshot,
      documentId,
      knowledgeAuthority,
      scopeKey,
      scopeKind,
      sessionId,
      sourceRevision,
      studyPlanContext,
    ],
  );

  // Load / restore session, artifacts, and preferences with stale-response epoch guard
  const loadScopeData = useCallback(async () => {
    const epoch = ++activeScopeEpochRef.current;
    taskController.cancelAllTasks();
    setCitationNotice(null);

    const localLoad = loadLocalSessionSnapshot(scopeKey);
    if (localLoad.error) {
      setPersistenceError(localLoad.error);
    }

    try {
      const existingSession = await findStudyModeSessionByScope({
        scopeKind,
        scopeKey,
        documentId,
        studyPlanId: studyPlanContext?.planId ?? null,
        topicId: studyPlanContext?.topicId ?? null,
        segmentId: studyPlanContext?.segmentId ?? null,
      });
      if (epoch !== activeScopeEpochRef.current) return;

      const remoteSnap = existingSession
        ? parseSessionSnapshot(existingSession.lastLocatorJson, existingSession.activeView)
        : null;
      const merged = pickNewerSnapshot(localLoad.snapshot, remoteSnap);

      setActiveTab(merged.activeTab);
      setExploreSubView(merged.exploreSubView);
      setActiveObjectiveId(merged.activeObjectiveId);
      setSessionDurationMin(merged.sessionDurationMin);
      setFocusMode(merged.focusMode);
      setDraftAnswer(merged.draftAnswer ?? "");
      if (merged.lastLocator) {
        setLastLocator(merged.lastLocator);
      }

      const session = await upsertStudyModeSession({
        id: existingSession?.id ?? null,
        scopeKind,
        scopeKey,
        documentId,
        studyPlanId: studyPlanContext?.planId ?? null,
        planVersionId: studyPlanContext?.versionId ?? null,
        topicId: studyPlanContext?.topicId ?? null,
        segmentId: studyPlanContext?.segmentId ?? null,
        sourceRevision,
        knowledgeAuthority,
        activeView: merged.activeTab,
        lastLocatorJson: serializeSessionEnvelope(merged),
      });
      if (epoch !== activeScopeEpochRef.current) return;
      setSessionId(session.id);

      if (sourceRevision) {
        await markStudyModeArtifactsStale(scopeKey, sourceRevision).catch(() => 0);
      }

      const [loadedArtifacts, loadedPrefs] = await Promise.all([
        listStudyModeArtifacts(scopeKey, true),
        listStudyLearnerPreferences(),
      ]);
      if (epoch !== activeScopeEpochRef.current) return;

      setArtifacts(loadedArtifacts);
      setPreferences(loadedPrefs);
      setPersistenceError(null);
    } catch (err) {
      if (epoch !== activeScopeEpochRef.current) return;
      setPersistenceError(
        err instanceof Error
          ? `Could not load saved Study Mode data: ${err.message}`
          : "Could not load saved Study Mode data.",
      );
    }
  }, [
    documentId,
    knowledgeAuthority,
    scopeKey,
    scopeKind,
    sourceRevision,
    studyPlanContext,
    taskController,
  ]);

  const loadScopeDataRef = useRef(loadScopeData);
  loadScopeDataRef.current = loadScopeData;

  useEffect(() => {
    void loadScopeDataRef.current();
  }, [scopeKey]);

  const setPanelError = useCallback((panel: StudyPanelId, err: StudyPanelError | null) => {
    setPanelErrors((prev) => ({ ...prev, [panel]: err }));
  }, []);

  const handleSelectTab = useCallback(
    (tab: StudyModeViewTab) => {
      setActiveTab(tab);
      void persistSessionState({ activeTab: tab });
    },
    [persistSessionState],
  );

  const handleSelectExploreSubView = useCallback(
    (sub: StudyModeExploreSubView) => {
      setExploreSubView(sub);
      void persistSessionState({ exploreSubView: sub });
    },
    [persistSessionState],
  );

  const handleToggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      void persistSessionState({ focusMode: next });
      return next;
    });
  }, [persistSessionState]);

  const handleChangeDuration = useCallback(
    (duration: StudyModeSessionDuration) => {
      setSessionDurationMin(duration);
      void persistSessionState({ sessionDurationMin: duration });
    },
    [persistSessionState],
  );

  const handleDraftAnswerChange = useCallback(
    (nextDraft: string) => {
      setDraftAnswer(nextDraft);
      saveLocalSessionSnapshot(scopeKey, buildCurrentSnapshot({ draftAnswer: nextDraft }));
    },
    [buildCurrentSnapshot, scopeKey],
  );

  const handleInspectAnchor = useCallback(
    (anchor: StudySourceAnchor) => {
      setActiveAnchor(anchor);
      setLastLocator(anchor.locator);
      setCitationNotice(null);
      void persistSessionState({ lastLocator: anchor.locator });
      if (onJumpToSource) {
        onJumpToSource(anchor.quote, anchor.locator);
      } else {
        setCitationNotice(
          anchor.quote
            ? `Cited excerpt: "${anchor.quote}" (open Source Comparison to view in context).`
            : "Open Source Comparison to inspect this citation in the original document.",
        );
      }
    },
    [onJumpToSource, persistSessionState],
  );

  const learnerContext = useMemo(
    () =>
      studySettings?.enablePersonalization
        ? buildBoundedLearnerContext({ subjectKey, preferences })
        : undefined,
    [preferences, studySettings?.enablePersonalization, subjectKey],
  );

  const handleGenerateComponent = useCallback(
    async (
      componentType:
        | "explanation"
        | "worked_example"
        | "misconceptions"
        | "memory_aid"
        | "summary",
      options?: { objectiveText?: string; styleAdjustment?: string },
    ) => {
      if (!effectivePassage.trim()) {
        setPanelError("learn", {
          presentation: classifyStudyModeError(new Error("No extractable passage text available"), {
            activityLabel: componentType.replace("_", " "),
            isOffline,
            localOnlyPreferred: studySettings?.localOnlyPreferred,
          }),
        });
        return;
      }

      const epoch = activeScopeEpochRef.current;
      setPanelError("learn", null);
      const startedAt = Date.now();
      const outcome = await taskController.runControlledTask(
        `learn:${componentType}`,
        async ({ signal, onChunk }) => {
          const result = await runTask(
            studyModeComponentTask,
            {
              sourceId: documentId,
              sourceTitle: documentTitle,
              passageText: effectivePassage,
              knowledgeAuthority,
              learnerContext,
              componentType,
              objectiveText: options?.objectiveText,
              styleAdjustment: options?.styleAdjustment,
            },
            {
              kind: studySettings?.localOnlyPreferred ? "ondevice" : undefined,
              signal,
              onChunk,
            },
          );
          const payload = result.output as unknown as Record<string, unknown>;
          const verification = verifyStudyModeArtifactDeterministic({
            artifactType: componentType,
            knowledgeAuthority,
            authorizedSourceIds: [documentId],
            expectedRevision: sourceRevision,
            artifactRevision: sourceRevision,
            sourceTexts: [effectivePassage],
            payload,
          });

          if (!verification.valid) {
            throw new Error(
              `Verification failed (${verification.issues.join(", ")}). Try again or inspect the original source.`,
            );
          }

          const anchors = buildStudyAnchorsFromPayload({
            documentId,
            sourceRevision,
            passageText: effectivePassage,
            payload,
            baseLocator: activeScope?.locator ?? currentLocator ?? lastLocator,
          });

          const saved = await saveStudyModeArtifact({
            sessionId,
            artifactType: componentType,
            scopeKey,
            sourceIds: [documentId],
            sourceRevision,
            anchors,
            segmentIds: studyPlanContext?.segmentId ? [studyPlanContext.segmentId] : [],
            conceptIds: [],
            objectiveIds: activeObjectiveId ? [activeObjectiveId] : [],
            planId: studyPlanContext?.planId ?? null,
            planVersionId: studyPlanContext?.versionId ?? null,
            taskId: studyModeComponentTask.id,
            providerId: result.providerId ?? null,
            modelId: result.baseModelName ?? null,
            knowledgeAuthority,
            validationStatus: "verified",
            qualityEval: verification.report,
            payload,
          });

          if (studySettings?.enableEfficacyMeasurement) {
            void recordStudyEfficacyEvent({
              sessionId,
              metricKind: "artifact_generated",
              latencyMs: Date.now() - startedAt,
              metadata: { artifactType: componentType },
            });
          }

          return saved;
        },
      );

      if (epoch !== activeScopeEpochRef.current) return;

      if (isStudyTaskSuccess(outcome)) {
        setArtifacts((prev) => [outcome.value, ...prev.filter((a) => a.id !== outcome.value.id)]);
        setSelectedLearnArtifactId(outcome.value.id);
      } else if (!outcome.cancelled) {
        setPanelError("learn", {
          presentation: classifyStudyModeError(outcome.rawError ?? outcome.error, {
            activityLabel: componentType.replace("_", " "),
            isOffline,
            localOnlyPreferred: studySettings?.localOnlyPreferred,
          }),
          retryAction: () => void handleGenerateComponent(componentType, options),
        });
      }
    },
    [
      activeObjectiveId,
      activeScope?.locator,
      currentLocator,
      documentId,
      documentTitle,
      effectivePassage,
      isOffline,
      knowledgeAuthority,
      lastLocator,
      learnerContext,
      scopeKey,
      sessionId,
      setPanelError,
      sourceRevision,
      studyPlanContext,
      studySettings?.enableEfficacyMeasurement,
      studySettings?.localOnlyPreferred,
      taskController,
    ],
  );

  const handleGenerateStructuredView = useCallback(
    async (kind: "mind_map" | "timeline" | "audio_script" | "slides") => {
      const activityLabel =
        kind === "mind_map"
          ? "concept map"
          : kind === "audio_script"
          ? "audio lesson"
          : kind;

      if (!effectivePassage.trim()) {
        setPanelError("explore", {
          presentation: classifyStudyModeError(new Error("No extractable passage text available"), {
            activityLabel,
            isOffline,
            localOnlyPreferred: studySettings?.localOnlyPreferred,
          }),
        });
        return;
      }

      const epoch = activeScopeEpochRef.current;
      setPanelError("explore", null);
      const outcome = await taskController.runControlledTask(
        `explore:${kind}`,
        async ({ signal, onChunk }) => {
          let payload: Record<string, unknown>;
          let taskId: string;
          let providerId: string | undefined;
          let modelId: string | undefined;
          const taskOpts = {
            kind: studySettings?.localOnlyPreferred ? ("ondevice" as const) : undefined,
            signal,
            onChunk,
          };

          if (kind === "mind_map") {
            const res = await runTask(
              studyModeMindMapTask,
              {
                sourceId: documentId,
                sourceTitle: documentTitle,
                passageText: effectivePassage,
                knowledgeAuthority,
                learnerContext,
              },
              taskOpts,
            );
            payload = res.output;
            taskId = studyModeMindMapTask.id;
            providerId = res.providerId;
            modelId = res.baseModelName;
          } else if (kind === "timeline") {
            const res = await runTask(
              studyModeTimelineTask,
              {
                sourceId: documentId,
                sourceTitle: documentTitle,
                passageText: effectivePassage,
                knowledgeAuthority,
                learnerContext,
              },
              taskOpts,
            );
            payload = res.output;
            taskId = studyModeTimelineTask.id;
            providerId = res.providerId;
            modelId = res.baseModelName;
          } else if (kind === "audio_script") {
            const res = await runTask(
              studyModeAudioScriptTask,
              {
                sourceId: documentId,
                sourceTitle: documentTitle,
                passageText: effectivePassage,
                knowledgeAuthority,
                learnerContext,
                mode: "teacher_student",
              },
              taskOpts,
            );
            payload = res.output;
            taskId = studyModeAudioScriptTask.id;
            providerId = res.providerId;
            modelId = res.baseModelName;
          } else {
            const res = await runTask(
              studyModeSlidesTask,
              {
                sourceId: documentId,
                sourceTitle: documentTitle,
                passageText: effectivePassage,
                knowledgeAuthority,
                learnerContext,
              },
              taskOpts,
            );
            payload = res.output;
            taskId = studyModeSlidesTask.id;
            providerId = res.providerId;
            modelId = res.baseModelName;
          }

          const verification = verifyStudyModeArtifactDeterministic({
            artifactType: kind,
            knowledgeAuthority,
            authorizedSourceIds: [documentId],
            expectedRevision: sourceRevision,
            artifactRevision: sourceRevision,
            sourceTexts: [effectivePassage],
            payload,
          });

          if (!verification.valid) {
            throw new Error(`Verification failed (${verification.issues.join(", ")}).`);
          }

          const anchors = buildStudyAnchorsFromPayload({
            documentId,
            sourceRevision,
            passageText: effectivePassage,
            payload,
            baseLocator: activeScope?.locator ?? currentLocator ?? lastLocator,
          });

          return saveStudyModeArtifact({
            sessionId,
            artifactType: kind,
            scopeKey,
            sourceIds: [documentId],
            sourceRevision,
            anchors,
            segmentIds: studyPlanContext?.segmentId ? [studyPlanContext.segmentId] : [],
            conceptIds: [],
            objectiveIds: activeObjectiveId ? [activeObjectiveId] : [],
            planId: studyPlanContext?.planId ?? null,
            planVersionId: studyPlanContext?.versionId ?? null,
            taskId,
            providerId: providerId ?? null,
            modelId: modelId ?? null,
            knowledgeAuthority,
            validationStatus: "verified",
            qualityEval: verification.report,
            payload,
          });
        },
      );

      if (epoch !== activeScopeEpochRef.current) return;

      if (isStudyTaskSuccess(outcome)) {
        setArtifacts((prev) => [outcome.value, ...prev.filter((a) => a.id !== outcome.value.id)]);
      } else if (!outcome.cancelled) {
        setPanelError("explore", {
          presentation: classifyStudyModeError(outcome.rawError ?? outcome.error, {
            activityLabel,
            isOffline,
            localOnlyPreferred: studySettings?.localOnlyPreferred,
          }),
          retryAction: () => void handleGenerateStructuredView(kind),
        });
      }
    },
    [
      activeObjectiveId,
      activeScope?.locator,
      currentLocator,
      documentId,
      documentTitle,
      effectivePassage,
      isOffline,
      knowledgeAuthority,
      lastLocator,
      learnerContext,
      scopeKey,
      sessionId,
      setPanelError,
      sourceRevision,
      studyPlanContext,
      studySettings?.localOnlyPreferred,
      taskController,
    ],
  );

  const scopeConceptId = studyPlanContext?.topicId ?? documentId;

  // Load unified learning evidence when Tauri backend is available
  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) return;
    setIsLoadingEvidence(true);
    const loadEvidence = async () => {
      try {
        const [planEv, gaps, conceptSummary] = await Promise.all([
          studyPlanContext?.planId
            ? getStudyPlanEvidence(studyPlanContext.planId).catch(() => null)
            : Promise.resolve(null),
          listLearningGaps(studyPlanContext?.planId ?? null, false).catch(() => []),
          getConceptMasterySummary(scopeConceptId).catch(() => null),
        ]);
        if (cancelled) return;
        const summaries: ConceptMasterySummary[] = [];
        if (planEv) {
          for (const node of planEv.nodes) {
            if (node.demonstrated) summaries.push(node.demonstrated);
          }
        }
        if (
          conceptSummary &&
          conceptSummary.conceptId &&
          !summaries.some((s) => s.conceptId === conceptSummary.conceptId)
        ) {
          summaries.push(conceptSummary);
        }
        setEvidenceSummaries(summaries);
        setEvidenceGaps(Array.isArray(gaps) ? gaps : []);
      } finally {
        if (!cancelled) setIsLoadingEvidence(false);
      }
    };
    void loadEvidence();
    return () => {
      cancelled = true;
    };
  }, [scopeConceptId, studyPlanContext?.planId]);

  const targetDifficulty = useMemo(() => {
    const scopeSummary = evidenceSummaries.find((s) => s.conceptId === scopeConceptId) ?? null;
    return selectAdaptiveDifficulty({
      masterySummary: scopeSummary,
      recentOutcomes: sessionEvaluations.map((e) => ({
        outcome: e.outcome,
        usedHint: e.usedHint,
        difficulty: e.difficulty,
      })),
      preferenceDifficulty: learnerContext?.questionDifficulty ?? null,
    });
  }, [evidenceSummaries, learnerContext?.questionDifficulty, scopeConceptId, sessionEvaluations]);

  const handleGeneratePracticeQuestion = useCallback(
    async (questionKind: CorePracticeQuestionKind) => {
      if (!effectivePassage.trim()) {
        setPanelError("practice", {
          presentation: classifyStudyModeError(new Error("No extractable passage text available"), {
            activityLabel: "practice question",
            isOffline,
            localOnlyPreferred: studySettings?.localOnlyPreferred,
          }),
        });
        return;
      }

      const epoch = activeScopeEpochRef.current;
      setPanelError("practice", null);
      setLastEvaluation(null);

      const outcome = await taskController.runControlledTask(
        "practice:generate",
        async ({ signal, onChunk }) => {
          const res = await runTask(
            studyModeFormativeQuestionTask,
            {
              sourceId: documentId,
              sourceTitle: documentTitle,
              passageText: effectivePassage,
              knowledgeAuthority,
              learnerContext,
              questionKind,
              targetDifficulty,
              priorPrompts: priorQuestionPrompts,
            },
            {
              kind: studySettings?.localOnlyPreferred ? "ondevice" : undefined,
              signal,
              onChunk,
            },
          );
          const data = res.output;
          const prompt = String(data.prompt ?? "").trim();
          if (isSemanticallyDuplicateQuestion(prompt, priorQuestionPrompts)) {
            throw new Error(
              "Generated question repeated an earlier check. Click Retry for a fresh angle.",
            );
          }

          const conceptIds = [scopeConceptId];
          const fingerprint = computeSemanticQuestionFingerprint({
            scopeKey,
            conceptIds,
            questionKind,
            prompt,
          });
          const anchors = buildStudyAnchorsFromPayload({
            documentId,
            sourceRevision,
            passageText: effectivePassage,
            payload: data,
            baseLocator: activeScope?.locator ?? currentLocator ?? lastLocator,
          });

          const backendKind =
            questionKind === "multiple_choice" ? "multiple_choice" : "short_answer";
          let backendQuestionId: string | null = null;
          if (isTauri()) {
            const clientView = await createStudyFormativeQuestion({
              scopeKey,
              sessionId,
              segmentId: studyPlanContext?.segmentId ?? null,
              conceptIds,
              objectiveIds: activeObjectiveId ? [activeObjectiveId] : [],
              questionKind: backendKind,
              prompt,
              options: Array.isArray(data.options) ? data.options.map(String) : null,
              answerKey: {
                correctIndex: typeof data.correctIndex === "number" ? data.correctIndex : 0,
                explanation: String(data.explanation ?? ""),
                distractorMisconceptions:
                  data.distractorMisconceptions && typeof data.distractorMisconceptions === "object"
                    ? data.distractorMisconceptions
                    : undefined,
              },
              rubric: Array.isArray(data.requiredKeyFacts)
                ? { requiredKeyFacts: data.requiredKeyFacts }
                : null,
              difficulty: targetDifficulty,
              questionFingerprint: fingerprint,
              sourceRefs: anchors,
              knowledgeAuthority,
              provenance: { taskId: studyModeFormativeQuestionTask.id, questionKind },
            }).catch(() => null);
            backendQuestionId = clientView?.id ?? null;
          }

          const questionItem: PracticeQuestionItem = {
            id: backendQuestionId ?? `pq_${fingerprint}_${priorQuestionPrompts.length + 1}`,
            backendQuestionId,
            scopeKey,
            conceptIds,
            questionKind,
            prompt,
            difficulty: targetDifficulty,
            questionFingerprint: fingerprint,
            hint: typeof data.hint === "string" ? data.hint : null,
            options: Array.isArray(data.options) ? data.options.map(String) : null,
            correctIndex: typeof data.correctIndex === "number" ? data.correctIndex : 0,
            expectedBlanks: Array.isArray(data.expectedBlanks)
              ? data.expectedBlanks.map(String)
              : null,
            orderingItems: Array.isArray(data.orderingItems)
              ? data.orderingItems.map(String)
              : null,
            correctOrder: Array.isArray(data.correctOrder) ? data.correctOrder.map(String) : null,
            scenarioText: typeof data.scenarioText === "string" ? data.scenarioText : null,
            requiredKeyFacts: Array.isArray(data.requiredKeyFacts)
              ? data.requiredKeyFacts.map(String)
              : null,
            explanation: String(data.explanation ?? "Review the cited source passage to verify."),
            distractorMisconceptions:
              data.distractorMisconceptions && typeof data.distractorMisconceptions === "object"
                ? (data.distractorMisconceptions as Record<string, string>)
                : null,
            anchors,
          };

          return questionItem;
        },
      );

      if (epoch !== activeScopeEpochRef.current) return;

      if (isStudyTaskSuccess(outcome)) {
        setActiveQuestion(outcome.value);
        setDraftAnswer("");
        setPriorQuestionPrompts((prev) => [...prev, outcome.value.prompt]);
        void persistSessionState({ activeQuestionId: outcome.value.id, draftAnswer: "" });
      } else if (!outcome.cancelled) {
        setPanelError("practice", {
          presentation: classifyStudyModeError(outcome.rawError ?? outcome.error, {
            activityLabel: "practice question",
            isOffline,
            localOnlyPreferred: studySettings?.localOnlyPreferred,
          }),
          retryAction: () => void handleGeneratePracticeQuestion(questionKind),
        });
      }
    },
    [
      activeObjectiveId,
      activeScope?.locator,
      currentLocator,
      documentId,
      documentTitle,
      effectivePassage,
      isOffline,
      knowledgeAuthority,
      lastLocator,
      learnerContext,
      persistSessionState,
      priorQuestionPrompts,
      scopeConceptId,
      scopeKey,
      sessionId,
      setPanelError,
      sourceRevision,
      studyPlanContext,
      studySettings?.localOnlyPreferred,
      targetDifficulty,
      taskController,
    ],
  );

  const handleSubmitPractice = useCallback(
    async (payload: PracticeAnswerPayload) => {
      if (!activeQuestion) return;
      const epoch = activeScopeEpochRef.current;
      setPanelError("practice", null);
      const outcome = await taskController.runControlledTask("practice:submit", async () => {
        const localEval = evaluatePracticeAnswerLocally(activeQuestion, payload);
        if (isTauri() && activeQuestion.backendQuestionId) {
          const serializedAnswer =
            payload.writtenText ??
            payload.blankAnswers?.join(" | ") ??
            payload.orderedItems?.join(" -> ") ??
            "";
          const res = await submitStudyFormativeAnswer({
            submissionKey: `sub:${activeQuestion.backendQuestionId}:${
              payload.selectedIndex ?? serializedAnswer.slice(0, 32)
            }`,
            questionId: activeQuestion.backendQuestionId,
            sessionId,
            selectedIndex:
              activeQuestion.questionKind === "multiple_choice" ? payload.selectedIndex : null,
            learnerResponse:
              activeQuestion.questionKind !== "multiple_choice" ? serializedAnswer : null,
            aiRubricScore:
              activeQuestion.questionKind !== "multiple_choice" ? localEval.score : null,
            aiFeedback:
              activeQuestion.questionKind !== "multiple_choice" ? localEval.feedback : null,
            aiMisconception: localEval.misconceptionDetected,
            usedHint: Boolean(payload.usedHint),
            recordEvidence: knowledgeAuthority !== "model-only",
          });
          return {
            questionId: activeQuestion.id,
            conceptIds: activeQuestion.conceptIds,
            outcome:
              res.outcome === "understood" || res.outcome === "partial"
                ? res.outcome
                : "needs_review",
            score: res.score,
            feedback: res.feedback,
            misconceptionDetected: res.misconceptionDetected ?? localEval.misconceptionDetected,
            graderOrigin: res.graderOrigin === "ai" ? "ai" : "deterministic",
            difficulty: activeQuestion.difficulty,
            usedHint: Boolean(payload.usedHint),
            evaluatedAt: res.createdAt,
          } satisfies PracticeEvaluationResult;
        }
        return localEval;
      });

      if (epoch !== activeScopeEpochRef.current) return;

      if (isStudyTaskSuccess(outcome)) {
        setLastEvaluation(outcome.value);
        setSessionEvaluations((prev) => [...prev, outcome.value]);
        setDraftAnswer("");
        void persistSessionState({ draftAnswer: "" });
        if (guidedState.mode === "guided" && guidedState.stage === "recall") {
          dispatchGuided({
            type: "RECORD_RECALL_OUTCOME",
            outcome: outcome.value.outcome,
            misconception: outcome.value.misconceptionDetected,
          });
        }
      } else if (!outcome.cancelled) {
        setPanelError("practice", {
          presentation: classifyStudyModeError(outcome.rawError ?? outcome.error, {
            activityLabel: "practice grading",
            isOffline,
            localOnlyPreferred: studySettings?.localOnlyPreferred,
          }),
          retryAction: () => void handleSubmitPractice(payload),
        });
      }
    },
    [
      activeQuestion,
      guidedState.mode,
      guidedState.stage,
      isOffline,
      knowledgeAuthority,
      persistSessionState,
      sessionId,
      setPanelError,
      studySettings?.localOnlyPreferred,
      taskController,
    ],
  );

  const effectiveSubjectKey = useMemo(
    () =>
      subjectKey && subjectKey !== "__global__"
        ? subjectKey
        : studyPlanContext?.topicId ?? documentTitle,
    [documentTitle, studyPlanContext?.topicId, subjectKey],
  );

  const handleApplyInlineAdjustment = useCallback(
    (id: InlineAdjustmentId) => {
      const opt = getInlineAdjustment(id);
      setActiveInlineAdjustment(id);
      setSavedDefaultNotice(null);
      void handleGenerateComponent("explanation", { styleAdjustment: opt.directive });
    },
    [handleGenerateComponent],
  );

  const handleSaveInlineDefault = useCallback(
    async (id: InlineAdjustmentId) => {
      const normalizedSubject = effectiveSubjectKey.trim().toLowerCase() || "__global__";
      const previous = preferences.find((p) => p.subjectKey === normalizedSubject) ?? null;
      const opt = getInlineAdjustment(id);
      const updateInput = buildSubjectPreferenceUpdate({
        subjectKey: normalizedSubject,
        adjustmentId: id,
        existingPreferences: preferences,
      });
      try {
        await upsertStudyLearnerPreference(updateInput);
        const updated = await listStudyLearnerPreferences();
        setPreferences(updated);
        setSavedDefaultNotice({
          adjustmentLabel: opt.label,
          subjectLabel: effectiveSubjectKey,
          previousPreference: previous,
          savedSubjectKey: normalizedSubject,
        });
      } catch (err) {
        setPersistenceError(
          err instanceof Error
            ? `Could not save subject default: ${err.message}`
            : "Could not save subject default.",
        );
      }
    },
    [effectiveSubjectKey, preferences],
  );

  const handleUndoInlineDefault = useCallback(async () => {
    if (!savedDefaultNotice) return;
    try {
      if (savedDefaultNotice.previousPreference) {
        const prev = savedDefaultNotice.previousPreference;
        await upsertStudyLearnerPreference({
          subjectKey: prev.subjectKey,
          knowledgeLevel: prev.knowledgeLevel,
          interests: prev.interests,
          familiarDomains: prev.familiarDomains,
          explanationDetail: prev.explanationDetail,
          vocabularyTolerance: prev.vocabularyTolerance,
          explanationLanguage: prev.explanationLanguage,
          teachingApproach: prev.teachingApproach,
          examplePreference: prev.examplePreference,
          questionDifficulty: prev.questionDifficulty,
        });
      } else {
        await deleteStudyLearnerPreference(savedDefaultNotice.savedSubjectKey);
      }
      const updated = await listStudyLearnerPreferences();
      setPreferences(updated);
      setSavedDefaultNotice(null);
      setActiveInlineAdjustment(null);
    } catch (err) {
      setPersistenceError(
        err instanceof Error
          ? `Could not undo preference change: ${err.message}`
          : "Could not undo preference change.",
      );
    }
  }, [savedDefaultNotice]);

  const activeObjectiveLabel = useMemo(() => {
    const guidedObj = getCurrentGuidedObjective(guidedState);
    if (guidedState.mode === "guided" && guidedObj) return guidedObj.label;
    return activeScope?.label ?? null;
  }, [activeScope?.label, guidedState]);

  const tutorPacket = useMemo(
    () =>
      buildStudyModeTutorPacket({
        documentId,
        documentTitle,
        passageText: effectivePassage,
        activeAnchor,
        activeObjectiveLabel,
        knowledgeAuthority,
        recentEvaluations: sessionEvaluations,
        learnerContext,
        studyPlanContext,
        selectedPrompt: tutorPromptText,
      }),
    [
      activeAnchor,
      activeObjectiveLabel,
      documentId,
      documentTitle,
      effectivePassage,
      knowledgeAuthority,
      learnerContext,
      sessionEvaluations,
      studyPlanContext,
      tutorPromptText,
    ],
  );

  const handleLaunchContextualTutor = useCallback(
    (promptOpt?: ContextualTutorPromptOption | string) => {
      const promptText =
        typeof promptOpt === "string" ? promptOpt : promptOpt?.promptText ?? null;
      setTutorPromptText(promptText);
      setTutorOpen(true);
      onOpenTutor?.();
    },
    [onOpenTutor],
  );

  const handleStartGuidedSession = useCallback(() => {
    const steps = deriveStudyPathSteps(effectivePassage, documentTitle);
    dispatchGuided({ type: "START_GUIDED", objectives: steps, startIndex: 0 });
    handleSelectTab("learn");
  }, [documentTitle, effectivePassage, handleSelectTab]);

  const handleDismissArtifact = useCallback(async (id: string) => {
    setArtifacts((prev) => prev.map((a) => (a.id === id ? { ...a, dismissed: true } : a)));
    try {
      await dismissStudyModeArtifact(id);
    } catch (err) {
      setPersistenceError(
        err instanceof Error ? `Failed to dismiss artifact: ${err.message}` : "Failed to dismiss artifact.",
      );
    }
  }, []);

  const handleRestoreArtifact = useCallback(async (id: string) => {
    setArtifacts((prev) => prev.map((a) => (a.id === id ? { ...a, dismissed: false } : a)));
    try {
      const restored = await restoreStudyModeArtifact(id);
      if (restored) {
        setArtifacts((prev) => prev.map((a) => (a.id === id ? restored : a)));
      }
    } catch (err) {
      setPersistenceError(
        err instanceof Error ? `Failed to restore artifact: ${err.message}` : "Failed to restore artifact.",
      );
    }
  }, []);

  const handleDeleteArtifact = useCallback(async (id: string) => {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    try {
      await deleteStudyModeArtifact(id);
    } catch (err) {
      setPersistenceError(
        err instanceof Error ? `Failed to delete artifact: ${err.message}` : "Failed to delete artifact.",
      );
    }
  }, []);

  const handleConfirmClearScopeArtifacts = useCallback(async () => {
    setConfirmClearScope(false);
    setArtifacts([]);
    setSelectedLearnArtifactId(null);
    try {
      await deleteStudyModeArtifactsForScope(scopeKey);
    } catch (err) {
      setPersistenceError(
        err instanceof Error ? `Failed to clear artifacts: ${err.message}` : "Failed to clear artifacts.",
      );
    }
  }, [scopeKey]);

  // Keyboard shortcuts: Alt+1..4 tabs, Alt+F focus mode, Alt+E explain, Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextInputElement(e.target)) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === "1") {
          e.preventDefault();
          handleSelectTab("learn");
        } else if (e.key === "2") {
          e.preventDefault();
          handleSelectTab("practice");
        } else if (e.key === "3") {
          e.preventDefault();
          handleSelectTab("explore");
        } else if (e.key === "4") {
          e.preventDefault();
          handleSelectTab("progress");
        } else if (e.key.toLowerCase() === "f") {
          e.preventDefault();
          handleToggleFocusMode();
        } else if (e.key.toLowerCase() === "e") {
          e.preventDefault();
          handleSelectTab("learn");
          void handleGenerateComponent("explanation");
        }
      } else if (e.key === "Escape") {
        if (confirmClearScope) {
          setConfirmClearScope(false);
        } else if (showCustomize) {
          setShowCustomize(false);
        } else if (showHistory) {
          setShowHistory(false);
        } else if (focusMode) {
          handleToggleFocusMode();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    confirmClearScope,
    focusMode,
    handleGenerateComponent,
    handleSelectTab,
    handleToggleFocusMode,
    showCustomize,
    showHistory,
  ]);

  const activeArtifacts = useMemo(() => artifacts.filter((a) => !a.dismissed), [artifacts]);
  const dismissedArtifacts = useMemo(() => artifacts.filter((a) => a.dismissed), [artifacts]);

  const learnArtifacts = useMemo(
    () =>
      activeArtifacts.filter((a) =>
        ["explanation", "worked_example", "misconceptions", "memory_aid", "summary"].includes(
          a.artifactType,
        ),
      ),
    [activeArtifacts],
  );

  const activeLearnArtifact = useMemo(() => {
    if (learnArtifacts.length === 0) return null;
    return learnArtifacts.find((a) => a.id === selectedLearnArtifactId) ?? learnArtifacts[0];
  }, [learnArtifacts, selectedLearnArtifactId]);

  const timelineArtifact = useMemo(
    () => activeArtifacts.find((a) => a.artifactType === "timeline"),
    [activeArtifacts],
  );
  const mindMapArtifact = useMemo(
    () => activeArtifacts.find((a) => a.artifactType === "mind_map"),
    [activeArtifacts],
  );
  const audioArtifact = useMemo(
    () => activeArtifacts.find((a) => a.artifactType === "audio_script"),
    [activeArtifacts],
  );
  const slidesArtifact = useMemo(
    () => activeArtifacts.find((a) => a.artifactType === "slides"),
    [activeArtifacts],
  );

  // Publish bounded study-aware context to the existing Assistant host (without answer-key leaks)
  useEffect(() => {
    if (!onStudyAssistantContextChange) return;
    const activeArt =
      activeTab === "learn"
        ? activeLearnArtifact
        : activeTab === "explore"
        ? exploreSubView === "concept_map"
          ? mindMapArtifact
          : exploreSubView === "timeline"
          ? timelineArtifact
          : exploreSubView === "audio"
          ? audioArtifact
          : slidesArtifact
        : null;

    const summary = buildStudyAssistantContext({
      documentTitle,
      scopeLabel: activeScope?.label ?? "Current document",
      scopeExcerpt: effectivePassage,
      activeTab,
      knowledgeAuthority,
      activeArtifact: activeArt,
      selectedConceptLabel,
      activeQuestion,
      activeQuestionSubmitted: Boolean(
        activeQuestion && lastEvaluation && lastEvaluation.questionId === activeQuestion.id,
      ),
      lastEvaluation,
      studyPlanContext,
    });
    onStudyAssistantContextChange(summary);
  }, [
    activeLearnArtifact,
    activeQuestion,
    activeScope?.label,
    activeTab,
    audioArtifact,
    documentTitle,
    effectivePassage,
    exploreSubView,
    knowledgeAuthority,
    lastEvaluation,
    mindMapArtifact,
    onStudyAssistantContextChange,
    selectedConceptLabel,
    slidesArtifact,
    studyPlanContext,
    timelineArtifact,
  ]);

  const progressSnapshot = useMemo(
    () =>
      computeStudyProgressSnapshot({
        scopeConceptId,
        scopeConceptLabel: studyPlanContext?.topicTitle ?? studyPlanContext?.topicId ?? documentTitle,
        supplementsViewed: activeArtifacts.length,
        masterySummaries: evidenceSummaries,
        gaps: evidenceGaps,
        sessionEvaluations,
        preferredDurationMin: sessionDurationMin,
      }),
    [
      activeArtifacts.length,
      documentTitle,
      evidenceGaps,
      evidenceSummaries,
      scopeConceptId,
      sessionDurationMin,
      sessionEvaluations,
      studyPlanContext?.topicId,
      studyPlanContext?.topicTitle,
    ],
  );

  const renderPanelError = (panelId: StudyPanelId) => {
    const err = panelErrors[panelId];
    if (!err) return null;
    const { presentation, retryAction } = err;
    return (
      <div
        role="alert"
        data-testid={`study-panel-error-${panelId}`}
        className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-foreground space-y-2.5"
      >
        <div className="flex items-start gap-2.5">
          <WarningCircle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
          <div className="flex-1 space-y-1">
            <div className="font-semibold text-destructive">{presentation.title}</div>
            <p className="text-muted-foreground leading-relaxed">{presentation.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {presentation.actions.includes("retry") && retryAction && (
            <button
              type="button"
              onClick={retryAction}
              className="px-3 py-1.5 rounded-md border border-destructive/40 bg-background text-foreground font-medium hover:bg-muted"
            >
              Retry
            </button>
          )}
          {presentation.actions.includes("open-ai-settings") && onOpenAiSettings && (
            <button
              type="button"
              onClick={onOpenAiSettings}
              className="px-3 py-1.5 rounded-md border border-border bg-background text-foreground hover:bg-muted"
            >
              Open AI Settings
            </button>
          )}
          {presentation.actions.includes("inspect-source") && onToggleSource && (
            <button
              type="button"
              onClick={onToggleSource}
              className="px-3 py-1.5 rounded-md border border-border bg-background text-foreground hover:bg-muted"
            >
              View Source
            </button>
          )}
          {presentation.actions.includes("narrow-scope") &&
            resolvedScopes.options.length > 1 &&
            selectedScopeId === "entire_document" && (
              <button
                type="button"
                onClick={() => {
                  const narrower = resolvedScopes.options.find((o) => o.id !== "entire_document");
                  if (narrower) setSelectedScopeId(narrower.id);
                  setPanelError(panelId, null);
                }}
                className="px-3 py-1.5 rounded-md border border-border bg-background text-foreground hover:bg-muted"
              >
                Use Current Section
              </button>
            )}
          <button
            type="button"
            onClick={() => setPanelError(panelId, null)}
            className="px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
        {presentation.technicalDetail && (
          <details className="pt-1 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">Technical details</summary>
            <pre className="mt-1.5 whitespace-pre-wrap break-words rounded bg-background/80 p-2 font-mono text-[10px]">
              {presentation.technicalDetail}
            </pre>
          </details>
        )}
      </div>
    );
  };

  const renderAnchorChips = (artifact: StudyModeArtifact) => {
    const anchors = getArtifactAnchors(artifact);
    if (anchors.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {anchors.slice(0, 4).map((anchor, idx) => (
          <button
            key={`${artifact.id}-anc-${idx}`}
            type="button"
            onClick={() => handleInspectAnchor(anchor)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            title={anchor.quote ?? "Jump to source anchor"}
          >
            <LinkSimple className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span>{anchor.label ?? formatAnchorLocationLabel(anchor)}</span>
          </button>
        ))}
      </div>
    );
  };

  const renderTaskControlButton = (
    taskKey: string,
    label: string,
    runningLabel: string,
    onClick: () => void,
    primary = false,
  ) => {
    const state = taskController.getTaskState(taskKey);
    const running = state.status === "running" || state.status === "streaming";
    return (
      <div className="inline-flex items-center gap-1.5">
        <button
          type="button"
          disabled={running}
          onClick={onClick}
          className={
            primary
              ? "px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-60 hover:opacity-90 transition-opacity"
              : "px-3 py-2 text-xs rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-60 transition-colors"
          }
        >
          {running ? runningLabel : label}
        </button>
        {running && (
          <button
            type="button"
            onClick={() => taskController.cancelTask(taskKey)}
            aria-label={`Cancel ${label}`}
            className="px-2.5 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"
          >
            Cancel
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className="flex flex-col h-full w-full min-w-0 bg-background text-foreground overflow-hidden"
      role="region"
      aria-label="Study Mode Workspace"
      data-testid="study-mode-workspace"
      data-focus-mode={focusMode ? "true" : "false"}
      data-layout-mode={isMobile ? "mobile" : "desktop"}
      data-workspace-layout={workspaceLayout}
    >
      {/* Compact Top Workspace Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={onExitStudyMode}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted transition-colors shrink-0"
            aria-label="Back to Reading"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Back to Reading</span>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold truncate text-foreground">{documentTitle}</h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                {knowledgeAuthority}
              </span>
              {isOffline && (
                <span
                  data-testid="study-mode-offline-badge"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0"
                >
                  <WifiSlash className="w-3 h-3" aria-hidden="true" />
                  Offline
                </span>
              )}
            </div>

            {!focusMode && (
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                <label className="inline-flex items-center gap-1.5">
                  <span className="sr-only">Study scope</span>
                  <select
                    aria-label="Study scope"
                    data-testid="study-scope-selector"
                    value={selectedScopeId}
                    onChange={(e) => setSelectedScopeId(e.target.value as StudyScopeOptionId)}
                    className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground max-w-[240px] truncate"
                  >
                    {resolvedScopes.options.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                {activeScope?.isPartialCoverage && (
                  <span
                    data-testid="study-scope-partial-badge"
                    className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    title={`Bounded to ${activeScope.passageText.length.toLocaleString()} of ${activeScope.totalSourceChars.toLocaleString()} characters`}
                  >
                    Bounded excerpt
                  </span>
                )}
                {activeSelection && activeScope?.id === "selected_passage" && (
                  <button
                    type="button"
                    onClick={() => setActiveSelection(null)}
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  >
                    <span>Clear selection</span>
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
                {studyTrailNav && (
                  <span className="inline-flex items-center gap-1 pl-1 border-l border-border">
                    <span>{studyTrailNav.stepLabel}</span>
                    <button
                      type="button"
                      disabled={!studyTrailNav.canPrev}
                      onClick={studyTrailNav.onPrev}
                      aria-label="Previous assigned passage"
                      className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                    >
                      <CaretLeft className="w-3 h-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={!studyTrailNav.canNext}
                      onClick={studyTrailNav.onNext}
                      aria-label="Next assigned passage"
                      className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                    >
                      <CaretRight className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Segmented Read / Study Switch */}
          <div
            role="group"
            aria-label="Document presentation mode"
            className="hidden md:inline-flex items-center rounded-lg border border-border bg-muted/60 p-0.5 text-xs"
          >
            <button
              type="button"
              onClick={onExitStudyMode}
              className="px-2.5 py-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            >
              Read
            </button>
            <button
              type="button"
              aria-pressed="true"
              className="px-2.5 py-1 rounded-md bg-background text-foreground font-medium shadow-xs"
            >
              Study
            </button>
          </div>

          {onToggleSource && (
            <button
              type="button"
              onClick={onToggleSource}
              aria-pressed={workspaceLayout === "with-source"}
              data-testid="study-toggle-source"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                workspaceLayout === "with-source"
                  ? "border-primary bg-primary/15 text-primary font-medium"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">View Source</span>
            </button>
          )}

          {onToggleAssistant && (
            <button
              type="button"
              onClick={onToggleAssistant}
              aria-pressed={workspaceLayout === "with-assistant"}
              data-testid="study-toggle-assistant"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                workspaceLayout === "with-assistant"
                  ? "border-primary bg-primary/15 text-primary font-medium"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              <ChatCircleText className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Ask Assistant</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleToggleFocusMode}
            aria-pressed={focusMode}
            title="Toggle Focus Mode (Alt+F)"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background hover:bg-muted"
          >
            {focusMode ? (
              <ArrowsInSimple className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ArrowsOutSimple className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span className="hidden lg:inline">{focusMode ? "Exit Focus" : "Focus"}</span>
          </button>

          {!focusMode && (
            <button
              type="button"
              onClick={() => setShowCustomize((v) => !v)}
              aria-expanded={showCustomize}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background hover:bg-muted"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Customize</span>
            </button>
          )}

          <button
            type="button"
            onClick={onExitStudyMode}
            className="px-2.5 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 md:hidden"
          >
            Exit Study Mode
          </button>
        </div>
      </header>

      {/* Primary Destination Bar: Learn | Practice | Explore | Progress */}
      <nav
        className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-card/50 shrink-0 overflow-x-auto"
        aria-label="Study Mode Destinations"
      >
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Study Mode Tools">
          {PRIMARY_TABS.map((tab) => {
            const Icon =
              tab.id === "learn"
                ? Sparkle
                : tab.id === "practice"
                ? Exam
                : tab.id === "explore"
                ? Compass
                : ChartBar;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                title={`${tab.label} (${tab.shortcut})`}
                onClick={() => handleSelectTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {!focusMode && (
          <div className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
            <span>Session:</span>
            {([5, 15, 30] as const).map((min) => (
              <button
                key={min}
                type="button"
                aria-pressed={sessionDurationMin === min}
                onClick={() => handleChangeDuration(min)}
                className={`px-2 py-0.5 rounded-md transition-colors ${
                  sessionDurationMin === min
                    ? "bg-primary/15 text-primary font-medium"
                    : "hover:bg-muted hover:text-foreground"
                }`}
              >
                {min}m
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* Non-blocking persistence warning */}
      {persistenceError && (
        <div
          role="status"
          data-testid="study-mode-persistence-warning"
          className="flex items-center justify-between gap-2 px-4 py-2 border-b border-destructive/30 bg-destructive/10 text-xs text-destructive shrink-0"
        >
          <span>{persistenceError}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadScopeData()}
              className="px-2 py-0.5 rounded border border-destructive/40 bg-background text-foreground hover:bg-muted"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setPersistenceError(null)}
              aria-label="Dismiss persistence warning"
              className="hover:opacity-80"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Citation recovery notice when reader jump isn't wired */}
      {citationNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-muted/40 text-xs text-foreground shrink-0"
        >
          <span>{citationNotice}</span>
          <button
            type="button"
            onClick={() => setCitationNotice(null)}
            aria-label="Dismiss citation notice"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Main Dedicated Learning Workspace */}
      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-5xl space-y-5">
          <GuidedLoopBanner
            state={guidedState}
            onExitGuided={() => dispatchGuided({ type: "EXIT_GUIDED" })}
            onAdvanceStage={() => dispatchGuided({ type: "ADVANCE_STAGE" })}
            onJumpToAnchor={() => {
              const obj = getCurrentGuidedObjective(guidedState);
              if (obj) {
                const quote = obj.excerpt.slice(0, 120);
                handleInspectAnchor({
                  sourceId: documentId,
                  sourceRevision,
                  quote,
                  locator: activeScope?.locator ?? currentLocator ?? lastLocator ?? { kind: "text", scrollPercent: 0, textQuote: quote },
                  label: obj.label,
                });
              }
            }}
            onGenerateExplanation={(style = "explanation") => {
              handleSelectTab("learn");
              void handleGenerateComponent(style);
            }}
            onStartRecallCheck={() => {
              handleSelectTab("practice");
              void handleGeneratePracticeQuestion("multiple_choice");
            }}
            onPromoteFlashcard={
              onPromoteFlashcard
                ? () => {
                    const obj = getCurrentGuidedObjective(guidedState);
                    onPromoteFlashcard(
                      obj?.label ?? documentTitle,
                      obj?.excerpt ?? effectivePassage.slice(0, 240),
                    );
                    dispatchGuided({ type: "RECORD_FLASHCARD_PROMOTED" });
                  }
                : undefined
            }
          />

          {showCustomize && (
            <StudyModePreferencesDrawer
              subjectKey={subjectKey}
              onClose={() => setShowCustomize(false)}
              onUpdated={setPreferences}
            />
          )}

          {/* LEARN DESTINATION */}
          {activeTab === "learn" && (
            <div className="space-y-6" role="tabpanel" aria-label="Learn">
              {renderPanelError("learn")}

              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">
                      Understand the material
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Choose how you want to study <span className="font-medium text-foreground">{activeScope?.label ?? documentTitle}</span>.
                    </p>
                  </div>
                  {guidedState.mode === "freeform" && (
                    <button
                      type="button"
                      onClick={handleStartGuidedSession}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-card hover:bg-muted font-medium transition-colors"
                    >
                      <Compass className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                      Start Guided Session
                    </button>
                  )}
                </div>

                {/* Activity Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {LEARN_ACTIVITIES.map((act) => {
                    const taskKey = `learn:${act.kind}`;
                    const state = taskController.getTaskState(taskKey);
                    const running = state.status === "running" || state.status === "streaming";
                    return (
                      <div
                        key={act.kind}
                        className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between gap-3 hover:border-primary/40 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Lightbulb className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                            <span className="text-sm font-semibold text-foreground">{act.title}</span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {act.description}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          {renderTaskControlButton(
                            taskKey,
                            act.buttonLabel,
                            "Generating...",
                            () => void handleGenerateComponent(act.kind),
                            act.primary,
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Socratic Tutor Card */}
                  <div className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between gap-3 hover:border-primary/40 transition-colors">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <ChatCircleText className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                        <span className="text-sm font-semibold text-foreground">Tutor</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Learn through interactive Socratic questioning grounded in this scope
                      </p>
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => handleLaunchContextualTutor()}
                        className="px-3 py-2 text-xs rounded-lg border border-border bg-background hover:bg-muted font-medium transition-colors"
                      >
                        Open Socratic Tutor
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {/* Streaming preview for active learn task */}
              {Object.entries(taskController.tasks)
                .filter(
                  ([key, st]) =>
                    key.startsWith("learn:") && st.status === "streaming" && st.streamPreview,
                )
                .map(([key, st]) => (
                  <div
                    key={key}
                    className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs text-muted-foreground font-mono whitespace-pre-wrap"
                  >
                    {st.streamPreview}
                  </div>
                ))}

              {/* Previously Generated Materials */}
              <section className="space-y-3 pt-2 border-t border-border/70">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ListBullets className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <h4 className="text-sm font-semibold text-foreground">
                      Generated materials ({learnArtifacts.length})
                    </h4>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowHistory((v) => !v)}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <ClockCounterClockwise className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        {showHistory
                          ? "Hide History"
                          : `Artifact History (${dismissedArtifacts.length})`}
                      </span>
                    </button>

                    {activeArtifacts.length > 0 && !confirmClearScope && (
                      <button
                        type="button"
                        onClick={() => setConfirmClearScope(true)}
                        className="px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"
                      >
                        Clear Scope
                      </button>
                    )}
                  </div>
                </div>

                {confirmClearScope && (
                  <div
                    role="alertdialog"
                    aria-label="Confirm clear study artifacts"
                    className="rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="text-foreground">
                      Permanently delete all {activeArtifacts.length} generated artifacts in this scope?
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmClearScope(false)}
                        className="px-2.5 py-1 rounded-md border border-border bg-background text-foreground hover:bg-muted"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleConfirmClearScopeArtifacts()}
                        className="px-2.5 py-1 rounded-md bg-destructive text-destructive-foreground hover:opacity-90"
                      >
                        Confirm Clear
                      </button>
                    </div>
                  </div>
                )}

                {showHistory && (
                  <ArtifactHistoryPanel
                    dismissedArtifacts={dismissedArtifacts}
                    onRestore={(id) => void handleRestoreArtifact(id)}
                    onDeletePermanently={(id) => void handleDeleteArtifact(id)}
                  />
                )}

                {learnArtifacts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-xs text-muted-foreground">
                    Select any learning activity above to generate source-grounded material on demand. Your original document is never modified.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {learnArtifacts.length > 1 && (
                      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Saved learning materials">
                        {learnArtifacts.map((art) => {
                          const selected = activeLearnArtifact?.id === art.id;
                          return (
                            <button
                              key={art.id}
                              type="button"
                              role="tab"
                              aria-selected={selected}
                              onClick={() => setSelectedLearnArtifactId(art.id)}
                              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                selected
                                  ? "border-primary bg-primary/15 text-foreground font-medium"
                                  : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                              }`}
                            >
                              {String(art.payload.title ?? art.artifactType)}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {activeLearnArtifact && (
                      <article
                        key={activeLearnArtifact.id}
                        className="rounded-xl border border-border bg-card p-5 space-y-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 pb-3">
                          <div className="space-y-0.5 min-w-0">
                            <h4 className="text-base font-semibold text-foreground">
                              {String(activeLearnArtifact.payload.title ?? activeLearnArtifact.artifactType)}
                            </h4>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="capitalize">
                                {activeLearnArtifact.artifactType.replace("_", " ")}
                              </span>
                              <span>·</span>
                              <span>{activeLearnArtifact.knowledgeAuthority}</span>
                              {activeLearnArtifact.isStale && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium">
                                  Source Updated (Stale)
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {onToggleSource && (
                              <button
                                type="button"
                                onClick={onToggleSource}
                                className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted"
                              >
                                Compare with source
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDismissArtifact(activeLearnArtifact.id)}
                              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                            >
                              Dismiss
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${String(activeLearnArtifact.payload.title ?? activeLearnArtifact.artifactType)}`}
                              onClick={() => void handleDeleteArtifact(activeLearnArtifact.id)}
                              className="text-muted-foreground hover:text-destructive p-1"
                            >
                              <Trash className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        <div className="max-w-prose text-sm leading-7 whitespace-pre-wrap text-foreground">
                          {String(activeLearnArtifact.payload.body ?? "")}
                        </div>

                        {renderAnchorChips(activeLearnArtifact)}

                        {activeLearnArtifact.artifactType === "explanation" && (
                          <InlinePersonalizationChips
                            activeAdjustmentId={activeInlineAdjustment}
                            subjectLabel={effectiveSubjectKey}
                            isBusy={taskController.isTaskRunning("learn:explanation")}
                            savedNotice={savedDefaultNotice}
                            onApplyAdjustment={handleApplyInlineAdjustment}
                            onSaveAsDefault={(id) => void handleSaveInlineDefault(id)}
                            onUndoSavedDefault={() => void handleUndoInlineDefault()}
                          />
                        )}
                      </article>
                    )}
                  </div>
                )}

                <ContextualTutorBar
                  hasRecentWrongAnswer={sessionEvaluations.some((e) => e.outcome !== "understood")}
                  isOffline={isOffline}
                  onLaunchTutor={handleLaunchContextualTutor}
                />
              </section>
            </div>
          )}

          {/* PRACTICE DESTINATION */}
          {activeTab === "practice" && (
            <div className="max-w-3xl mx-auto space-y-4" role="tabpanel" aria-label="Practice">
              {renderPanelError("practice")}
              <PracticePanel
                activeQuestion={activeQuestion}
                lastEvaluation={lastEvaluation}
                sessionEvaluations={sessionEvaluations}
                targetDifficulty={targetDifficulty}
                isGenerating={taskController.isTaskRunning("practice:generate")}
                isSubmitting={taskController.isTaskRunning("practice:submit")}
                initialDraftAnswer={draftAnswer}
                onDraftAnswerChange={handleDraftAnswerChange}
                onCancelGenerate={() => taskController.cancelTask("practice:generate")}
                onGenerateQuestion={(kind) => void handleGeneratePracticeQuestion(kind)}
                onSubmitAnswer={(payload) => void handleSubmitPractice(payload)}
                onInspectAnchor={handleInspectAnchor}
                onRequestWorkedExample={() => {
                  handleSelectTab("learn");
                  void handleGenerateComponent("worked_example");
                }}
                onOpenTutor={(prompt) => handleLaunchContextualTutor(prompt)}
                onPromoteFlashcard={onPromoteFlashcard}
              />
            </div>
          )}

          {/* EXPLORE DESTINATION */}
          {activeTab === "explore" && (
            <div className="space-y-5" role="tabpanel" aria-label="Explore">
              {renderPanelError("explore")}

              <div
                className="grid grid-cols-2 sm:grid-cols-4 gap-2"
                role="group"
                aria-label="Explore views"
              >
                {EXPLORE_SUBVIEWS.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    aria-label={sub.label}
                    aria-pressed={exploreSubView === sub.id}
                    onClick={() => handleSelectExploreSubView(sub.id)}
                    className={`text-left p-3 rounded-xl border transition-colors ${
                      exploreSubView === sub.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <div className="text-xs font-semibold text-foreground">{sub.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                      {sub.description}
                    </div>
                  </button>
                ))}
              </div>

              {exploreSubView === "concept_map" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Explore how concepts connect across <span className="font-medium text-foreground">{activeScope?.label ?? documentTitle}</span>.
                    </p>
                    {renderTaskControlButton(
                      "explore:mind_map",
                      mindMapArtifact ? "Regenerate Concept Map" : "Generate Concept Map",
                      "Generating...",
                      () => void handleGenerateStructuredView("mind_map"),
                      true,
                    )}
                  </div>
                  {mindMapArtifact ? (
                    <InteractiveConceptMap
                      payload={mindMapArtifact.payload}
                      evidenceConcepts={progressSnapshot.concepts}
                      onJumpToAnchor={(quote) => {
                        const anchor: StudySourceAnchor = {
                          sourceId: documentId,
                          sourceRevision,
                          quote,
                          locator:
                            activeScope?.locator ??
                            currentLocator ??
                            lastLocator ?? { kind: "text", scrollPercent: 0, textQuote: quote },
                        };
                        handleInspectAnchor(anchor);
                      }}
                      onExplainConcept={(conceptLabel) => {
                        setSelectedConceptLabel(conceptLabel);
                        handleSelectTab("learn");
                        void handleGenerateComponent("explanation", {
                          objectiveText: `Explain the concept: ${conceptLabel}`,
                        });
                      }}
                      onPracticeConcept={() => {
                        handleSelectTab("practice");
                        void handleGeneratePracticeQuestion("multiple_choice");
                      }}
                      onPromoteFlashcard={onPromoteFlashcard}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-xs text-muted-foreground">
                      Generate a source-grounded concept map to inspect relationships, prerequisites, and supporting passages on an interactive canvas.
                    </div>
                  )}
                </div>
              )}

              {exploreSubView === "timeline" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Visualize chronological or logical progressions grounded in the source.
                    </p>
                    {renderTaskControlButton(
                      "explore:timeline",
                      timelineArtifact ? "Regenerate Sequence / Timeline" : "Generate Sequence / Timeline",
                      "Generating...",
                      () => void handleGenerateStructuredView("timeline"),
                      true,
                    )}
                  </div>
                  {timelineArtifact ? (
                    <StudyTimelineView
                      artifact={timelineArtifact}
                      onInspectAnchor={handleInspectAnchor}
                      onJumpToQuote={(quote) => {
                        handleInspectAnchor({
                          sourceId: documentId,
                          sourceRevision,
                          quote,
                          locator:
                            activeScope?.locator ??
                            currentLocator ??
                            lastLocator ?? { kind: "text", scrollPercent: 0, textQuote: quote },
                        });
                      }}
                      onExplainEvent={(label) => {
                        handleSelectTab("learn");
                        void handleGenerateComponent("explanation", {
                          objectiveText: `Explain this stage in detail: ${label}`,
                        });
                      }}
                      onPracticeEvent={() => {
                        handleSelectTab("practice");
                        void handleGeneratePracticeQuestion("ordering");
                      }}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-xs text-muted-foreground">
                      Generate a sequence or timeline to trace ordered steps, historical milestones, or causal chains.
                    </div>
                  )}
                </div>
              )}

              {exploreSubView === "audio" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Listen to a guided teacher–student audio walkthrough with synced transcript.
                    </p>
                    {renderTaskControlButton(
                      "explore:audio_script",
                      audioArtifact ? "Regenerate Audio Lesson" : "Generate Audio Lesson Script",
                      "Generating Script...",
                      () => void handleGenerateStructuredView("audio_script"),
                      true,
                    )}
                  </div>
                  {audioArtifact ? (
                    <PlayableAudioLessonPlayer
                      artifact={audioArtifact}
                      scopeKey={scopeKey}
                      sourceRevision={sourceRevision}
                      isOffline={isOffline}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-xs text-muted-foreground">
                      Generate an audio lesson script to play through this section with Plethora&apos;s speech synthesis and synced transcript.
                    </div>
                  )}
                </div>
              )}

              {exploreSubView === "slides" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Step through key ideas in a distraction-free slide deck with source citations.
                    </p>
                    {renderTaskControlButton(
                      "explore:slides",
                      slidesArtifact ? "Regenerate Narrated Slides" : "Generate Narrated Slides",
                      "Generating Slides...",
                      () => void handleGenerateStructuredView("slides"),
                      true,
                    )}
                  </div>
                  {slidesArtifact ? (
                    <PlayableSlidesPlayer
                      artifact={slidesArtifact}
                      scopeKey={scopeKey}
                      sourceRevision={sourceRevision}
                      isOffline={isOffline}
                      onJumpToCitation={(quote) => {
                        handleInspectAnchor({
                          sourceId: documentId,
                          sourceRevision,
                          quote,
                          locator:
                            activeScope?.locator ??
                            currentLocator ??
                            lastLocator ?? { kind: "text", scrollPercent: 0, textQuote: quote },
                        });
                      }}
                      onPracticeSlide={() => {
                        handleSelectTab("practice");
                        void handleGeneratePracticeQuestion("multiple_choice");
                      }}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-xs text-muted-foreground">
                      Generate narrated slides to review structured bullet points with keyboard navigation and source verification.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PROGRESS DESTINATION */}
          {activeTab === "progress" && (
            <div className="max-w-3xl mx-auto space-y-4" role="tabpanel" aria-label="Progress">
              {renderPanelError("progress")}
              <ProgressPanel
                snapshot={progressSnapshot}
                isLoadingEvidence={isLoadingEvidence}
                onStartRecommended={(tab) => {
                  handleSelectTab(tab);
                  if (tab === "practice") {
                    void handleGeneratePracticeQuestion("multiple_choice");
                  }
                }}
              />
            </div>
          )}
        </div>
      </main>

      {/* Socratic Tutor Sheet */}
      {tutorOpen && (
        <TutorSheet
          open={tutorOpen}
          material={tutorPacket.material}
          topic={tutorPacket.topic}
          documentTitle={documentTitle}
          documentId={documentId}
          studyContext={tutorPacket.studyContext}
          onClose={() => setTutorOpen(false)}
        />
      )}
    </div>
  );
};
