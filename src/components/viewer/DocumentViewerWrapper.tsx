import { useRegisterMobileAssistant, useMobileAssistantController } from "../assistant/mobile/MobileAssistantContext";
import type { VideoViewerContext } from "../../lib/ai/assistant/scopes";
/**
 * Wrapper component that adds Assistant panel to DocumentViewer
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { DocumentViewer as BaseDocumentViewer } from "./DocumentViewer";
import { AssistantPanel, type AssistantContext, type AssistantPosition, READER_MIN_WIDTH } from "../assistant/AssistantPanel";
import { PwaAssistantButton } from "../assistant/PwaAssistantButton";
import { useDocumentStore, useSettingsStore, useTabsStore } from "../../stores";
import { MobileDocumentWrapper } from "../mobile/MobileDocumentWrapper";
import * as documentsApi from "../../api/documents";
import { trimToTokenWindow } from "../../utils/tokenizer";
import { useFormFactor } from "../../hooks/useFormFactor";
import { useReadingSessionTracker } from "../../hooks/useReadingSessionTracker";
import { isPWA } from "../../lib/pwa";
import { useIsActiveTab } from "../common/Tabs";
import { useTabId } from "../common/Tabs/TabContent";
import { createRetryableLazy } from "../../utils/retryableLazy";
import { registerOverlayDismissal } from "../../lib/overlayStack";
import { moveStudyPassage, useStudyTrail } from "../../lib/study-plans/reading/trailController";
import type { ExactSearchHitLocation } from "../../types/searchHit";
import type { DocumentPresentationMode, StudyWorkspaceLayout } from "../../types/studyMode";
import type { StudyAssistantContextSummary } from "../../lib/study-plans/studyMode/studyAssistantContext";
import {
  clampSourceSplitPercent,
  readRememberedPresentationMode,
  readSourceSplitPercent,
  toggleStudyWorkspaceLayout,
  writeRememberedPresentationMode,
  writeSourceSplitPercent,
} from "./study-mode/studyWorkspaceState";

const StudyModeWorkspace = createRetryableLazy("StudyModeWorkspace", () =>
  import("./StudyModeWorkspace").then((m) => ({ default: m.StudyModeWorkspace })),
);
import {
  getAssistantContextErrorMessage,
  resolveGenericAssistantContext,
  resolvePdfContextForPrompt,
  type ResolveAssistantPromptOptions,
  resolveTwitterThreadAssistantContext,
  type ResolvedAssistantContext,
  type PdfTextWindow,
} from "../../utils/assistantContext";
import type { DocumentInitialJump, ExtractSourceContext } from "../../types/extractNavigation";
import type { SectionNode } from "../../utils/sectionIndex";
import { useDocumentOutlineStore } from "../../stores/documentOutlineStore";
import { consumeAskPlethora } from "../../utils/audioCaptureNavigation";
import { LanguageLearningHostProvider } from "../../contexts/LanguageLearningHostContext";
import { LanguageReaderHostPanel } from "../language/LanguageReaderHostPanel";
import { LanguageReaderActionOverlay } from "../language/LanguageReaderActionOverlay";
import { LanguageTutorHost } from "../language/LanguageTutorHost";
import { LanguagePracticeOverlay } from "../language/LanguagePracticeOverlay";
import { LanguageReadingAssistOverlay } from "../language/LanguageReadingAssistOverlay";
import { LanguageProfileSuggestionBanner } from "../common/LanguageProfileSuggestionBanner";
import { LanguageProfileAssociationPrompt } from "../language/LanguageProfileAssociationPrompt";
import { useLanguageHostProductionBindings } from "../../lib/languageHost";
import { useLanguageProfileStore } from "../../stores/languageProfileStore";
import type { DetectionEvidence, ContentType } from "../../types/languageProfile";
import { useOptionalLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import type { SourceAnchor } from "../../types/languageLexicon";
import type { MarketingSceneApplication } from "../../lib/marketingCapture/sceneApplicators";

const ASSISTANT_POSITION_KEY = "assistant-panel-position";

interface DocumentViewerWithAssistantProps {
  documentId: string;
  initialViewMode?: "document" | "extracts" | "cards";
  highlightQuery?: string;
  initialJump?: DocumentInitialJump;
  autoPlay?: boolean;
  focusedExtractId?: string;
  focusedVideoExtractId?: string;
  extractSourceContext?: ExtractSourceContext;
  // Origin the document was opened from. Only "queue" keeps the rating orbs
  // (active review). Forwarded to the underlying viewer so the tab-data signal
  // survives the wrapper.
  openedFrom?: string;
  hideRatingOrbs?: boolean;
  /** Render the document in the Audio Edition player (AudiobooksTab Listen). */
  listenToEdition?: boolean;
  /** When true, the viewer is embedded inside another surface (e.g. Queue Scroll). */
  embedded?: boolean;
  onSelectionChange?: (selection: string) => void;
  onScrollPositionChange?: (state: { pageNumber?: number; scrollPercent?: number }) => void;
  onPdfContextTextChange?: (text: string, window?: PdfTextWindow) => void;
  onPdfOcrContextTextChange?: (text: string | null) => void;
  contextPageWindow?: number;
  onExtractCreated?: (extract: import("../../api/extracts").Extract, sourceContext?: ExtractSourceContext) => void;
  extractPostCreateBehavior?: "show-extracts" | "stay-in-reader";
  onEnded?: () => void;
  onArchive?: () => void;
  /** Use the owning queue item's priority target instead of this document's. */
  onPriorityShortcut?: () => void;
  onVideoContextChange?: (context: VideoViewerContext | null) => void;
  onMediaSectionsChange?: (sections: SectionNode[]) => void;
  /** Deterministic real-reader state used only by the explicit marketing capture host. */
  captureReader?: MarketingSceneApplication["reader"];
  captureCardPreview?: MarketingSceneApplication["cardPreview"];
}

function LanguageProfileAssociationGate({
  contentType,
  contentId,
  onAssociated,
}: {
  contentType: ContentType;
  contentId: string;
  onAssociated: () => void;
}) {
  const host = useOptionalLanguageLearningHost();
  const associations = useLanguageProfileStore((state) => state.associations);
  const disabled = associations.some((association) => association.contentType === contentType && association.contentId === contentId && association.mode === "disabled");
  if (!host || host.snapshot.status !== "unavailable" || disabled) {
    return null;
  }
  return (
    <LanguageProfileAssociationPrompt
      contentType={contentType}
      contentId={contentId}
      onAssociated={onAssociated}
    />
  );
}

export function DocumentViewer({
  documentId,
  initialViewMode,
  highlightQuery,
  initialJump,
  autoPlay,
  focusedExtractId,
  focusedVideoExtractId,
  extractSourceContext,
  openedFrom,
  hideRatingOrbs,
  listenToEdition,
  embedded,
  onSelectionChange: onSelectionChangeProp,
  onScrollPositionChange: onScrollPositionChangeProp,
  onPdfContextTextChange: onPdfContextTextChangeProp,
  onPdfOcrContextTextChange: onPdfOcrContextTextChangeProp,
  contextPageWindow,
  onExtractCreated,
  extractPostCreateBehavior,
  onEnded,
  onArchive,
  onPriorityShortcut,
  onVideoContextChange: onVideoContextChangeProp,
  onMediaSectionsChange: onMediaSectionsChangeProp,
  captureReader,
  captureCardPreview,
}: DocumentViewerWithAssistantProps) {
  const isActiveTab = useIsActiveTab();
  const tabId = useTabId();
  const addTab = useTabsStore((state) => state.addTab);

  // Reading in the Reader now counts. Opening the document starts a session,
  // active reading feeds it, and navigating away ends it — so a document read
  // but never rated still shows the time it took.
  useReadingSessionTracker({ documentId, isActive: isActiveTab });

  const [selection, setSelection] = useState("");
  const handleSelectionChange = useCallback((value: string) => {
    setSelection(value);
    onSelectionChangeProp?.(value);
  }, [onSelectionChangeProp]);
  const [languageModeEnabled, setLanguageModeEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(`plethora.language-mode.${documentId}`) === "on";
  });
  const [scrollState, setScrollState] = useState<{ pageNumber?: number; scrollPercent?: number }>({});
  const [debouncedScrollPercent, setDebouncedScrollPercent] = useState<number | undefined>(undefined);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedScrollPercent(scrollState.scrollPercent);
    }, 500);
    return () => clearTimeout(timer);
  }, [scrollState.scrollPercent]);
  const [pdfContextText, setPdfContextText] = useState<string | undefined>(undefined);
  const [pdfOcrContextText, setPdfOcrContextText] = useState<string | null>(null);
  const [videoContext, setVideoContext] = useState<VideoViewerContext | null>(null);
  const currentDocument = useDocumentStore((state) => state.currentDocument);
  const settings = useSettingsStore((state) => state.settings);
  const contextWindowTokens = useSettingsStore((state) => state.settings.ai.maxTokens);
  const aiModel = useSettingsStore((state) => state.settings.ai.model);
  const pwaAssistantEnabled = useSettingsStore((state) => state.settings.ai.pwaAssistantButtonEnabled);
  const pwaAssistantSide = useSettingsStore((state) => state.settings.ai.pwaAssistantButtonSide);
  const [documentContent, setDocumentContent] = useState<string | undefined>(undefined);
  const [assistantContent, setAssistantContent] = useState<string | undefined>(undefined);
  // Coverage is read through assistantCoverageRef inside resolveContextForPrompt;
  // the render value is not consumed directly.
  const [, setAssistantCoverage] = useState<"full" | "window" | undefined>(undefined);
  const [assistantStatus, setAssistantStatus] = useState<"ready" | "loading" | "unavailable">("loading");
  const [assistantStatusMessage, setAssistantStatusMessage] = useState<string | undefined>(undefined);
  const [assistantSource, setAssistantSource] = useState<string | undefined>(undefined);
  const [mediaSections, setMediaSections] = useState<SectionNode[]>([]);
  const setSharedMediaSections = useDocumentOutlineStore((state) => state.setMediaSections);
  const [assistantPosition, setAssistantPosition] = useState<AssistantPosition>(() => {
    const saved = localStorage.getItem(ASSISTANT_POSITION_KEY);
    return saved === "left" ? "left" : "right";
  });
  const mobileAssistant = useMobileAssistantController();
  const formFactor = useFormFactor();
  // Only hide assistant on phones, not on tablets or small screens.
  const isMobile = Boolean(mobileAssistant) || formFactor === "phone";
  const documents = useDocumentStore((state) => state.documents);
  const currentDoc = documents.find((doc) => doc.id === documentId) ?? currentDocument ?? null;
  const rememberModePerSource = Boolean(settings.studyMode?.rememberModePerSource);

  // Authoritative per-document Read vs. Study presentation mode & layout coordinator
  const [presentationMode, setPresentationMode] = useState<DocumentPresentationMode>(() =>
    embedded ? "read" : readRememberedPresentationMode(documentId, rememberModePerSource),
  );
  const [studyLayout, setStudyLayout] = useState<StudyWorkspaceLayout>("focused");
  const [studySelectionSeed, setStudySelectionSeed] = useState<string | null>(null);
  const [studyJumpRequest, setStudyJumpRequest] = useState<{
    id: number;
    quote?: string;
    locator?: ExactSearchHitLocation;
  } | null>(null);
  const [studyAssistantSummary, setStudyAssistantSummary] =
    useState<StudyAssistantContextSummary | null>(null);
  const [sourceSplitPercent, setSourceSplitPercent] = useState<number>(() => readSourceSplitPercent());
  const promoteFlashcardRef = useRef<((prompt: string, explanation: string) => void) | null>(null);
  const readerSurfaceHostRef = useRef<HTMLDivElement | null>(null);
  const workspaceHostRef = useRef<HTMLDivElement | null>(null);

  // Reset presentation mode cleanly when switching to a different document
  useEffect(() => {
    setPresentationMode(
      embedded ? "read" : readRememberedPresentationMode(documentId, rememberModePerSource),
    );
    setStudyLayout("focused");
    setStudySelectionSeed(null);
    setStudyAssistantSummary(null);
  }, [documentId, embedded, rememberModePerSource]);

  const handleEnterStudyMode = useCallback(
    (options?: { selectionText?: string | null }) => {
      if (embedded) return;
      if (options?.selectionText?.trim()) {
        setStudySelectionSeed(options.selectionText.trim());
      } else if (selectionRef.current?.trim()) {
        setStudySelectionSeed(selectionRef.current.trim());
      }
      setPresentationMode("study");
      setStudyLayout("focused");
      writeRememberedPresentationMode(documentId, "study", rememberModePerSource);
    },
    [documentId, embedded, rememberModePerSource],
  );

  const handleExitStudyMode = useCallback(() => {
    setPresentationMode("read");
    setStudyLayout("focused");
    writeRememberedPresentationMode(documentId, "read", rememberModePerSource);
  }, [documentId, rememberModePerSource]);

  const handleToggleStudySource = useCallback(() => {
    setStudyLayout((prev) => toggleStudyWorkspaceLayout(prev, "with-source"));
  }, []);

  const handleToggleStudyAssistant = useCallback(() => {
    setStudyLayout((prev) => toggleStudyWorkspaceLayout(prev, "with-assistant"));
  }, []);

  const handleStudyJumpToSource = useCallback(
    (quote?: string, locator?: ExactSearchHitLocation) => {
      setStudyLayout("with-source");
      setStudyJumpRequest((prev) => ({
        id: (prev?.id ?? 0) + 1,
        quote,
        locator,
      }));
    },
    [],
  );

  const handleOpenAiSettings = useCallback(() => {
    addTab({
      title: "Settings",
      icon: "settings",
      type: "settings",
      content: null as unknown as React.ComponentType,
      closable: true,
    });
  }, [addTab]);

  const handleRegisterPromoteFlashcard = useCallback(
    (handler: ((prompt: string, explanation: string) => void) | null) => {
      promoteFlashcardRef.current = handler;
    },
    [],
  );

  // Mark hidden reader container inert while focused/with-assistant Study Mode owns the workspace
  const isReaderSuspendedByStudy =
    !embedded && presentationMode === "study" && studyLayout !== "with-source";
  useEffect(() => {
    const el = readerSurfaceHostRef.current as (HTMLDivElement & { inert?: boolean }) | null;
    if (el) {
      el.inert = isReaderSuspendedByStudy;
    }
  }, [isReaderSuspendedByStudy]);

  // Register transient Study Mode companion view on mobile with overlayStack for native Back
  useEffect(() => {
    if (embedded || presentationMode !== "study" || studyLayout === "focused") return;
    return registerOverlayDismissal(() => {
      setStudyLayout("focused");
      return true;
    });
  }, [embedded, presentationMode, studyLayout]);

  const startSourceSplitResize = useCallback(
    (startX: number) => {
      const container = workspaceHostRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const startPercent = sourceSplitPercent;
      const onMove = (ev: MouseEvent) => {
        const deltaPct = ((ev.clientX - startX) / rect.width) * 100;
        setSourceSplitPercent(clampSourceSplitPercent(startPercent + deltaPct));
      };
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const deltaPct = ((ev.clientX - startX) / rect.width) * 100;
        writeSourceSplitPercent(clampSourceSplitPercent(startPercent + deltaPct));
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sourceSplitPercent],
  );

  // Study Trail / Study Plan integration
  const studyTrailState = useStudyTrail((state) =>
    tabId && state.tabId === tabId ? state : null,
  );
  const activeStudyPlanContext = useMemo(() => {
    const active = studyTrailState?.active;
    const req = studyTrailState?.request;
    if (!active || !req) return undefined;
    const topic = active.topics.find((n) => n.nodeId === req.assignment.topicId);
    return {
      planId: active.detail.plan.id,
      versionId: active.detail.version.id,
      topicId: req.assignment.topicId,
      segmentId: req.assignment.id,
      topicTitle: topic?.title,
    };
  }, [studyTrailState?.active, studyTrailState?.request]);

  const activeStudyTrailNav = useMemo(() => {
    const active = studyTrailState?.active;
    const req = studyTrailState?.request;
    if (!active || !req) return null;
    const idx = active.assignments.findIndex((a) => a.id === req.assignment.id);
    if (idx < 0) return null;
    return {
      stepLabel: `Passage ${idx + 1}/${active.assignments.length}`,
      canPrev: idx > 0,
      canNext: idx + 1 < active.assignments.length,
      onPrev: () => void moveStudyPassage(-1),
      onNext: () => void moveStudyPassage(1),
    };
  }, [studyTrailState?.active, studyTrailState?.request]);

  // Live canonical locator for Study Mode
  const studyCurrentLocator = useMemo<ExactSearchHitLocation | null>(() => {
    const docType = (currentDoc?.fileType || "text").toLowerCase();
    if (docType === "pdf") {
      return { kind: "pdf", pageNumber: Math.max(1, scrollState.pageNumber ?? currentDoc?.currentPage ?? 1) };
    }
    if (docType === "epub" && currentDoc?.currentCfi) {
      return { kind: "epub", cfi: currentDoc.currentCfi };
    }
    if (docType === "youtube" || docType === "video" || docType === "audio") {
      return {
        kind: docType === "youtube" ? "youtube" : docType === "audio" ? "audio" : "video",
        timeSeconds: Math.max(0, Math.floor(videoContext?.currentTime ?? 0)),
      };
    }
    return {
      kind: docType === "html" ? "html" : docType === "markdown" ? "markdown" : "text",
      scrollPercent: scrollState.scrollPercent ?? currentDoc?.currentScrollPercent ?? 0,
    };
  }, [
    currentDoc?.currentCfi,
    currentDoc?.currentPage,
    currentDoc?.currentScrollPercent,
    currentDoc?.fileType,
    scrollState.pageNumber,
    scrollState.scrollPercent,
    videoContext?.currentTime,
  ]);

  const outlineEntry = useDocumentOutlineStore((state) => state.outlineByDocId.get(documentId));
  const sharedMediaSections = useDocumentOutlineStore((state) =>
    state.mediaSectionsByDocId.get(documentId),
  );
  const studySections = useMemo<SectionNode[]>(() => {
    if (mediaSections.length > 0) return mediaSections;
    if (sharedMediaSections && sharedMediaSections.length > 0) return sharedMediaSections;
    if (outlineEntry?.pdfOutline && outlineEntry.pdfOutline.length > 0) {
      return outlineEntry.pdfOutline.map((item, idx) => ({
        id: `pdf-outline-${idx}`,
        title: item.title,
        level: 1,
        breadcrumb: [item.title],
        page: item.pageNumber,
        preview: item.title,
        content: "",
        children: [],
        parentId: null,
        source: "pdf-outline",
        documentId,
      }));
    }
    if (outlineEntry?.epubToc && outlineEntry.epubToc.length > 0) {
      return outlineEntry.epubToc.map((item, idx) => {
        const title = item.label || item.title || `Chapter ${idx + 1}`;
        return {
          id: `epub-toc-${idx}`,
          title,
          level: 1,
          breadcrumb: [title],
          href: item.href,
          preview: title,
          content: "",
          children: [],
          parentId: null,
          source: "epub-toc",
          documentId,
        };
      });
    }
    return [];
  }, [documentId, mediaSections, outlineEntry, sharedMediaSections]);
  const selectionRef = useRef(selection);
  const pdfContextTextRef = useRef(pdfContextText);
  const pdfTextWindowRef = useRef<PdfTextWindow | undefined>(undefined);
  const pdfOcrContextTextRef = useRef(pdfOcrContextText);
  const videoContextRef = useRef(videoContext);
  const scrollStateRef = useRef(scrollState);
  const documentContentRef = useRef<string | undefined>(documentContent);
  const assistantContentRef = useRef<string | undefined>(assistantContent);
  const assistantCoverageRef = useRef<"full" | "window" | undefined>(undefined);
  const currentDocRef = useRef(currentDoc);

  // Global master opt-in (settings v11): Language Learning surfaces exist
  // only when explicitly enabled. Global OFF dominates the per-document
  // preference, which is preserved untouched for a later re-enable.
  const languageLearningEnabled = settings.languageLearning?.enabled === true;
  const languageSuggestionsEnabled = settings.languageLearning?.suggestionsEnabled !== false;
  const effectiveLanguageModeEnabled = languageLearningEnabled && languageModeEnabled;

  useEffect(() => {
    // While the feature is globally disabled the per-document preference is
    // NOT written: the toggle that would change it is absent, and rewriting
    // the stored value here would silently wipe the user's prior choice.
    if (typeof window === "undefined" || !languageLearningEnabled) return;
    window.localStorage.setItem(`plethora.language-mode.${documentId}`, languageModeEnabled ? "on" : "off");
  }, [documentId, languageModeEnabled, languageLearningEnabled]);

  const languageContentFingerprint = useMemo(
    () => currentDoc?.dateModified ?? currentDoc?.id ?? documentId,
    [currentDoc?.dateModified, currentDoc?.id, documentId],
  );
  const languageSource = useMemo(() => {
    const type = currentDoc?.fileType || "text";
    const isMedia = type === "youtube" || type === "video" || type === "audio";
    const sourceType: SourceAnchor["sourceType"] = type === "epub"
      ? "epub"
      : type === "pdf"
        ? "pdf"
        : type === "html"
          ? "html"
          : type === "markdown"
            ? "markdown"
            : isMedia
              ? "media"
              : "text";
    return {
      contentType: isMedia ? "media" as const : "document" as const,
      contentId: documentId,
      contentFingerprint: `${documentId}:${languageContentFingerprint}`,
      text: currentDoc?.content,
      source: {
        sourceType,
        documentId: isMedia ? undefined : documentId,
        mediaId: isMedia ? documentId : undefined,
        contentFingerprint: `${documentId}:${languageContentFingerprint}`,
      },
    };
  }, [currentDoc?.content, currentDoc?.fileType, documentId, languageContentFingerprint]);

  const languageSourceAnchor = languageSource.source;
  const languageSurface = languageSource.contentType === "media" ? "video" as const : openedFrom === "queue" ? "queue" as const : "reader" as const;
  const languageBindings = useLanguageHostProductionBindings(languageSurface);
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);
  const projectionEpoch = useLanguageProfileStore((state) => state.projectionEpoch);
  const [hostRefreshToken, setHostRefreshToken] = useState(0);
  const documentLanguage = useMemo(() => {
    const metadata = currentDoc?.metadata;
    if (!metadata || typeof metadata !== "object") return "";
    const language = (metadata as { language?: string }).language;
    return typeof language === "string" ? language : "";
  }, [currentDoc?.metadata]);
  const detectionEvidence = useMemo<DetectionEvidence | null>(() => {
    const language = documentLanguage || activeProfile?.targetLanguage;
    if (!language) return null;
    return { language, detector: documentLanguage ? "document-metadata" : "active-profile", source: "reader" };
  }, [activeProfile?.targetLanguage, documentLanguage]);

  const projectionEpochRef = useRef(projectionEpoch);
  useEffect(() => {
    if (projectionEpochRef.current === projectionEpoch) return;
    projectionEpochRef.current = projectionEpoch;
    setHostRefreshToken((value) => value + 1);
  }, [projectionEpoch]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // Deferred Ask Plethora (openspec add-audio-editions-and-hands-free-study-
  // mode, task 7.5): when the Inbox queues a captured passage for this
  // document, scope the assistant context to it by seeding the selection so
  // Document Q&A opens pre-scoped to what the listener asked about.
  useEffect(() => {
    const pending = consumeAskPlethora(documentId);
    if (pending?.passage) {
      setSelection(pending.passage);
    }
  }, [documentId]);

  useEffect(() => {
    pdfContextTextRef.current = pdfContextText;
  }, [pdfContextText]);

  useEffect(() => {
    pdfOcrContextTextRef.current = pdfOcrContextText;
  }, [pdfOcrContextText]);

  useEffect(() => {
    videoContextRef.current = videoContext;
  }, [videoContext]);

  useEffect(() => {
    scrollStateRef.current = scrollState;
  }, [scrollState]);

  useEffect(() => {
    documentContentRef.current = documentContent;
  }, [documentContent]);

  useEffect(() => {
    assistantContentRef.current = assistantContent;
  }, [assistantContent]);

  useEffect(() => {
    currentDocRef.current = currentDoc;
  }, [currentDoc]);

  useEffect(() => {
    setMediaSections([]);
  }, [documentId]);

  const handleMediaSectionsChange = useCallback((sections: SectionNode[]) => {
    setMediaSections(sections);
    if (documentId) setSharedMediaSections(documentId, sections);
    onMediaSectionsChangeProp?.(sections);
  }, [documentId, onMediaSectionsChangeProp, setSharedMediaSections]);

  useEffect(() => {
    if (!isActiveTab) return;
    let isActive = true;
    setPdfContextText(undefined);
    setPdfOcrContextText(null);

    const loadDocumentContent = async () => {
      // No document is open (e.g. the viewer mounted at launch before a tab is
      // selected). Guard against the empty id: get_document rejects with
      // "missing required key id" otherwise, which spams the console at startup.
      if (!documentId) {
        setDocumentContent(undefined);
        return;
      }
      try {
        const doc = await documentsApi.getDocument(documentId);
        if (isActive) {
          setDocumentContent(doc?.content ?? undefined);
        }
      } catch (error) {
        console.error("Failed to load document content for assistant:", error);
        if (isActive) {
          setDocumentContent(undefined);
        }
      }
    };

    loadDocumentContent();

    return () => {
      isActive = false;
    };
  }, [documentId, isActiveTab]);

  useEffect(() => {
    let isActive = true;
    const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 2000;

    if (videoContext?.videoId) {
      const transcript = videoContext.transcript?.trim();
      setAssistantContent(transcript || undefined);
      setAssistantCoverage(transcript ? "full" : undefined);
      assistantCoverageRef.current = transcript ? "full" : undefined;
      setAssistantStatus(transcript ? "ready" : videoContext.transcriptStatus === "loading" ? "loading" : "unavailable");
      setAssistantStatusMessage(transcript ? undefined : "Transcript unavailable");
      setAssistantSource(transcript ? "video-transcript" : undefined);
      return;
    }

    // Otherwise use regular document content
    const baseContent = currentDoc?.metadata?.xThread?.structuredText ?? pdfContextText ?? currentDoc?.content ?? documentContent ?? selection;

    if (!baseContent) {
      setAssistantContent(undefined);
      setAssistantCoverage(undefined);
      assistantCoverageRef.current = undefined;
      setAssistantStatus(currentDoc?.fileType === "pdf" ? "loading" : "unavailable");
      setAssistantStatusMessage(
        currentDoc?.fileType === "pdf"
          ? getAssistantContextErrorMessage("loading")
          : getAssistantContextErrorMessage("unavailable")
      );
      setAssistantSource(undefined);
      return () => {
        isActive = false;
      };
    }

    trimToTokenWindow(baseContent, maxTokens, aiModel, selection, debouncedScrollPercent)
      .then((trimmed) => {
        if (isActive) {
          const coverage = trimmed === baseContent ? "full" : "window";
          setAssistantContent(trimmed);
          setAssistantCoverage(coverage);
          assistantCoverageRef.current = coverage;
          setAssistantStatus("ready");
          setAssistantStatusMessage(undefined);
          setAssistantSource(currentDoc?.fileType === "pdf" ? "pdf-window" : "document");
        }
      })
      .catch(() => {
        if (isActive) {
          setAssistantContent(baseContent.slice(0, maxTokens * 4));
          setAssistantCoverage("window");
          assistantCoverageRef.current = "window";
          setAssistantStatus("ready");
          setAssistantStatusMessage(undefined);
          setAssistantSource(currentDoc?.fileType === "pdf" ? "pdf-window" : "document");
        }
      });

    return () => {
      isActive = false;
    };
  }, [currentDoc?.content, currentDoc?.fileType, documentContent, selection, contextWindowTokens, aiModel, pdfContextText, videoContext?.videoId, videoContext?.transcript, videoContext?.transcriptStatus, debouncedScrollPercent]);

  const resolveContextForPrompt = useCallback(async (prompt: string, options?: ResolveAssistantPromptOptions): Promise<ResolvedAssistantContext> => {
    const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 2000;
    const activeDoc = currentDocRef.current;
    const activeSelection = selectionRef.current;
    const pageNumber = scrollStateRef.current.pageNumber;

    if (videoContextRef.current?.videoId) {
      return resolveGenericAssistantContext(
        videoContextRef.current.transcript,
        "video-transcript",
        activeSelection,
      );
    }

    if (activeDoc?.metadata?.xThread) {
      const resolution = resolveTwitterThreadAssistantContext(activeDoc, activeSelection);
      if (resolution.status !== "ready" || !resolution.content) {
        return resolution;
      }
      try {
        const trimmed = await trimToTokenWindow(resolution.content, maxTokens, aiModel, activeSelection);
        return {
          ...resolution,
          content: trimmed,
          coverage: trimmed === resolution.content ? "full" : "window",
        };
      } catch {
        return {
          ...resolution,
          content: resolution.content.slice(0, maxTokens * 4),
          coverage: "window",
        };
      }
    }

    if (activeDoc?.fileType === "pdf") {
      const preferOcr = settings.documents.ocr.autoOCR || settings.documents.ocr.autoExtractOnLoad;
      return resolvePdfContextForPrompt(prompt, {
        document: activeDoc,
        liveWindowText: pdfContextTextRef.current,
        liveWindow: pdfTextWindowRef.current,
        storedDocumentText: activeDoc.content ?? documentContentRef.current,
        ocrText: pdfOcrContextTextRef.current,
        selection: activeSelection,
        pageNumber,
        contextPageWindow: 2,
        preferOcr,
        extractedTextLoader: activeDoc.id
          ? async () => {
              const result = await documentsApi.extractDocumentText(activeDoc.id);
              return result.content;
            }
          : undefined,
      }, maxTokens, aiModel, options);
    }

    return {
      ...resolveGenericAssistantContext(
        assistantContentRef.current,
        "document",
        activeSelection,
      ),
      coverage: assistantCoverageRef.current,
    };
  }, [aiModel, contextWindowTokens, settings.documents.ocr.autoExtractOnLoad, settings.documents.ocr.autoOCR]);

  const assistantContext = useMemo<AssistantContext>(() => {
    const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 2000;
    const effectiveAssistantContent =
      presentationMode === "study" && studyAssistantSummary
        ? studyAssistantSummary.contextText
        : assistantContent;

    const base = {
      documentId,
      selection: selection || undefined,
      content: effectiveAssistantContent,
      contextWindowTokens: maxTokens,
      status: presentationMode === "study" && studyAssistantSummary ? ("ready" as const) : assistantStatus,
      statusMessage: presentationMode === "study" && studyAssistantSummary ? undefined : assistantStatusMessage,
      source: presentationMode === "study" && studyAssistantSummary ? "study-mode-scope" : assistantSource,
      coverage: assistantCoverageRef.current,
      sections: mediaSections.length > 0 ? mediaSections : undefined,
      resolveForPrompt: resolveContextForPrompt,
      getPdfPageSource: () => pdfTextWindowRef.current?.source,
    };

    if (videoContext?.videoId) {
      return {
        ...base,
        type: "video" as const,
        transcriptStatus: videoContext.transcriptStatus ?? (videoContext.transcript?.trim() ? "ready-full" as const : "unavailable" as const),
        retryTranscript: () => window.dispatchEvent(new CustomEvent("plethora:retry-transcript", { detail: { documentId } })),
        position: { currentTime: videoContext.currentTime },
        metadata: {
          title: videoContext.title,
          duration: videoContext.duration,
          videoId: videoContext.videoId,
        },
      };
    }

    return {
      ...base,
      type: "document" as const,
      position: scrollState,
      metadata: {
        // Generated cards use this title for their document deck. The
        // audiobook context previously omitted it, so successful card writes
        // had document_id but an empty tag list.
        title: currentDoc?.title,
      },
    };
  }, [
    assistantContent,
    assistantSource,
    assistantStatus,
    assistantStatusMessage,
    contextWindowTokens,
    currentDoc?.title,
    documentId,
    mediaSections,
    presentationMode,
    resolveContextForPrompt,
    scrollState,
    selection,
    studyAssistantSummary,
    videoContext,
  ]);

  useRegisterMobileAssistant(assistantContext, { revision: documentId, disabled: Boolean(embedded), unavailableReason: selection ? "selection" : undefined });

  const handlePositionChange = (newPosition: AssistantPosition) => {
    setAssistantPosition(newPosition);
    localStorage.setItem(ASSISTANT_POSITION_KEY, newPosition);
  };

  // Consume the assistant's live width (the same value the panel clamps to
  // ASSISTANT_MIN_WIDTH..ASSISTANT_MAX_WIDTH) so the host owns the split and
  // can keep the reader from collapsing. The reader keeps a usable floor via
  // `minWidth: READER_MIN_WIDTH` below; the EPUB's own ResizeObserver turns
  // the resulting width change into a live `rendition.resize` reflow.
  const assistantWidthRef = useRef<number | null>(null);

  const assistantPanel = (
    <AssistantPanel
      context={assistantContext}
      className="flex-shrink-0"
      position={assistantPosition}
      onPositionChange={handlePositionChange}
      onWidthChange={(width) => {
        assistantWidthRef.current = width;
      }}
    />
  );

  const readerContent = (
    <div
      className="relative flex-1 h-full min-h-0 overflow-hidden"
      style={{ minWidth: READER_MIN_WIDTH }}
    >
      {effectiveLanguageModeEnabled && languageSuggestionsEnabled && detectionEvidence && (
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-20">
          <div className="pointer-events-auto mx-auto max-w-lg">
            <LanguageProfileSuggestionBanner
              contentType={languageSource.contentType}
              contentId={languageSource.contentId}
              evidence={detectionEvidence}
            />
          </div>
        </div>
      )}
      {effectiveLanguageModeEnabled && (
        <LanguageProfileAssociationGate
          contentType={languageSource.contentType}
          contentId={languageSource.contentId}
          onAssociated={() => setHostRefreshToken((value) => value + 1)}
        />
      )}
      <BaseDocumentViewer
        documentId={documentId}
        embedded={embedded}
        onSelectionChange={handleSelectionChange}
        onScrollPositionChange={(state) => {
          setScrollState(state);
          onScrollPositionChangeProp?.(state);
        }}
        initialViewMode={initialViewMode}
        highlightQuery={highlightQuery}
        initialJump={initialJump}
        autoPlay={autoPlay}
        listenToEdition={listenToEdition}
        focusedExtractId={focusedExtractId}
        focusedVideoExtractId={focusedVideoExtractId}
        extractSourceContext={extractSourceContext}
        onPdfContextTextChange={(text, window) => {
          if (window) pdfTextWindowRef.current = window;
          setPdfContextText(text);
          onPdfContextTextChangeProp?.(text, window);
        }}
        onPdfOcrContextTextChange={(text) => {
          setPdfOcrContextText(text);
          onPdfOcrContextTextChangeProp?.(text);
        }}
        contextPageWindow={contextPageWindow ?? 2}
        onVideoContextChange={(context) => {
          setVideoContext(context);
          onVideoContextChangeProp?.(context);
        }}
        onMediaSectionsChange={handleMediaSectionsChange}
        onExtractCreated={onExtractCreated}
        extractPostCreateBehavior={extractPostCreateBehavior}
        onEnded={onEnded}
        onArchive={onArchive}
        onPriorityShortcut={onPriorityShortcut}
        openedFrom={openedFrom}
        hideRatingOrbs={hideRatingOrbs}
        captureReader={captureReader}
        captureCardPreview={captureCardPreview}
        presentationMode={embedded ? "read" : presentationMode}
        onEnterStudyMode={embedded ? undefined : handleEnterStudyMode}
        onExitStudyMode={embedded ? undefined : handleExitStudyMode}
        onRegisterPromoteFlashcard={embedded ? undefined : handleRegisterPromoteFlashcard}
        studyJumpRequest={studyJumpRequest}
        />
      {languageLearningEnabled && (
        <>
          <LanguageReaderHostPanel
            documentId={documentId}
            selectedText={selection}
            sourceAnchor={languageSourceAnchor}
            languageModeEnabled={languageModeEnabled}
            onLanguageModeChange={setLanguageModeEnabled}
          />
          <LanguageReaderActionOverlay />
          <LanguageTutorHost />
          <LanguagePracticeOverlay />
          <LanguageReadingAssistOverlay />
        </>
      )}
    </div>
  );

  // Master opt-in gate: with Language Learning disabled the entire host stack
  // (provider, banner, gate, panel, overlays) is NOT mounted — the reader
  // behaves as though the feature does not exist. Hooks above still run
  // unconditionally per the rules of hooks; only rendering is gated.
  const documentViewer = languageLearningEnabled ? (
    <LanguageLearningHostProvider
      key={`lang-host:${documentId}:${projectionEpoch}:${hostRefreshToken}`}
      hostId={`document-reader:${documentId}`}
      surface={languageSurface}
      source={languageSource}
      languageModeEnabled={effectiveLanguageModeEnabled}
      resolveCapabilities={languageBindings.resolveCapabilities}
      shadowingProviders={languageBindings.shadowingProviders}
      writingProvider={languageBindings.writingProvider}
      pronunciationManifest={languageBindings.pronunciationManifest}
      readingAssistRegistry={languageBindings.readingAssistRegistry}
    >
      {readerContent}
    </LanguageLearningHostProvider>
  ) : (
    readerContent
  );

  if (embedded) {
    return documentViewer;
  }

  const studyWorkspaceNode =
    presentationMode === "study" && currentDoc ? (
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
              Loading Study Mode...
            </div>
          }
        >
          <StudyModeWorkspace
            documentId={currentDoc.id}
            documentTitle={currentDoc.title}
            docType={currentDoc.fileType || "text"}
            sourceRevision={currentDoc.contentHash ?? currentDoc.dateModified ?? ""}
            passageText={currentDoc.content ?? documentContent ?? ""}
            liveContextText={
              pdfContextText ?? pdfOcrContextText ?? videoContext?.transcript ?? assistantContent ?? null
            }
            sections={studySections}
            pdfPageNumber={scrollState.pageNumber ?? currentDoc.currentPage ?? null}
            pdfTotalPages={currentDoc.totalPages ?? null}
            mediaCurrentTimeSeconds={videoContext?.currentTime ?? null}
            studyPlanContext={activeStudyPlanContext}
            studyTrailNav={activeStudyTrailNav}
            initialSelection={studySelectionSeed}
            currentLocator={studyCurrentLocator}
            isMobile={isMobile}
            workspaceLayout={studyLayout}
            onToggleSource={handleToggleStudySource}
            onToggleAssistant={handleToggleStudyAssistant}
            onOpenAiSettings={handleOpenAiSettings}
            onStudyAssistantContextChange={setStudyAssistantSummary}
            onJumpToSource={handleStudyJumpToSource}
            onExitStudyMode={handleExitStudyMode}
            onPromoteFlashcard={(prompt, explanation) => {
              promoteFlashcardRef.current?.(prompt, explanation);
            }}
          />
        </Suspense>
      </div>
    ) : null;

  // Dedicated Study Mode workspace presentation (mutually exclusive from Read Mode)
  if (presentationMode === "study") {
    const showCanonicalReader = studyLayout === "with-source";
    const showAssistantInStudy = studyLayout === "with-assistant";

    return (
      <div
        ref={workspaceHostRef}
        className="flex h-full min-h-0 w-full overflow-hidden bg-background"
        data-document-presentation-mode="study"
        data-study-workspace-layout={studyLayout}
      >
        {/* Single canonical reader instance: hidden + inert unless Source Comparison is active */}
        <div
          ref={readerSurfaceHostRef}
          aria-hidden={!showCanonicalReader}
          data-testid="study-canonical-reader-host"
          className={
            showCanonicalReader
              ? isMobile
                ? "flex flex-col flex-1 min-w-0 h-full overflow-hidden"
                : "flex flex-col shrink-0 h-full overflow-hidden border-r border-border"
              : "hidden"
          }
          style={
            showCanonicalReader && !isMobile
              ? { width: `${sourceSplitPercent}%`, minWidth: READER_MIN_WIDTH }
              : undefined
          }
        >
          {showCanonicalReader && isMobile && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
              <button
                type="button"
                onClick={() => setStudyLayout("focused")}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Back to Study Mode</span>
              </button>
              <span className="text-xs text-muted-foreground truncate">{currentDoc?.title}</span>
            </div>
          )}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {isMobile ? (
              <MobileDocumentWrapper
                documentId={documentId}
                documentTitle={currentDoc?.title ?? ""}
                className="flex-1 min-w-0 min-h-0 overflow-hidden"
              >
                {documentViewer}
              </MobileDocumentWrapper>
            ) : (
              documentViewer
            )}
          </div>
        </div>

        {/* Desktop resizable divider between Canonical Source and Study Workspace */}
        {showCanonicalReader && !isMobile && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize source comparison pane"
            onMouseDown={(e) => startSourceSplitResize(e.clientX)}
            className="w-1.5 cursor-col-resize bg-border/60 hover:bg-primary/50 transition-colors shrink-0"
          />
        )}

        {/* Active Study Mode Workspace (hidden on mobile only while full-screen source comparison is active) */}
        {(!isMobile || !showCanonicalReader) && studyWorkspaceNode}

        {/* Existing Assistant Panel (replaces source pane; never a 3rd column) */}
        {!isMobile && showAssistantInStudy && assistantPanel}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden" data-document-presentation-mode="read">
      {isMobile ? (
        <>
          <MobileDocumentWrapper
            documentId={documentId}
            documentTitle={currentDoc?.title ?? ""}
            className="flex-1 min-w-0 min-h-0 overflow-hidden"
          >
            {documentViewer}
          </MobileDocumentWrapper>
          {isPWA() && !mobileAssistant && (
            <PwaAssistantButton
              context={assistantContext}
              enabled={pwaAssistantEnabled}
              side={pwaAssistantSide}
            />
          )}
        </>
      ) : assistantPosition === "left" ? (
        <>
          {assistantPanel}
          {documentViewer}
        </>
      ) : (
        <>
          {documentViewer}
          {assistantPanel}
        </>
      )}
    </div>
  );
}
