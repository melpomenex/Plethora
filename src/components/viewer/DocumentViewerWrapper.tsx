/**
 * Wrapper component that adds Assistant panel to DocumentViewer
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentViewer as BaseDocumentViewer } from "./DocumentViewer";
import { AssistantPanel, type AssistantContext, type AssistantPosition, READER_MIN_WIDTH } from "../assistant/AssistantPanel";
import { PwaAssistantButton } from "../assistant/PwaAssistantButton";
import { useDocumentStore, useSettingsStore } from "../../stores";
import * as documentsApi from "../../api/documents";
import { trimToTokenWindow } from "../../utils/tokenizer";
import { useFormFactor } from "../../hooks/useFormFactor";
import { useReadingSessionTracker } from "../../hooks/useReadingSessionTracker";
import { isPWA } from "../../lib/pwa";
import { useIsActiveTab } from "../common/Tabs";
import {
  getAssistantContextErrorMessage,
  resolveGenericAssistantContext,
  resolvePdfAssistantContext,
  resolveTwitterThreadAssistantContext,
  type ResolvedAssistantContext,
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
import type { SourceAnchor } from "../../types/languageLexicon";

const ASSISTANT_POSITION_KEY = "assistant-panel-position";

interface DocumentViewerWithAssistantProps {
  documentId: string;
  initialViewMode?: "document" | "extracts" | "cards";
  highlightQuery?: string;
  initialJump?: DocumentInitialJump;
  autoPlay?: boolean;
  focusedExtractId?: string;
  extractSourceContext?: ExtractSourceContext;
  // Origin the document was opened from. "documents" hides the rating orbs
  // (library browsing); "queue" keeps them (active review). Forwarded to the
  // underlying viewer so the tab-data signal survives the wrapper.
  openedFrom?: string;
  hideRatingOrbs?: boolean;
  /** Render the document in the Audio Edition player (AudiobooksTab Listen). */
  listenToEdition?: boolean;
}

export function DocumentViewer({
  documentId,
  initialViewMode,
  highlightQuery,
  initialJump,
  autoPlay,
  focusedExtractId,
  extractSourceContext,
  openedFrom,
  hideRatingOrbs,
  listenToEdition,
}: DocumentViewerWithAssistantProps) {
  const isActiveTab = useIsActiveTab();

  // Reading in the Reader now counts. Opening the document starts a session,
  // active reading feeds it, and navigating away ends it — so a document read
  // but never rated still shows the time it took.
  useReadingSessionTracker({ documentId, isActive: isActiveTab });

  const [selection, setSelection] = useState("");
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
  const [videoContext, setVideoContext] = useState<{
    videoId: string;
    title?: string;
    transcript?: string;
    currentTime?: number;
    duration?: number;
  } | null>(null);
  const currentDocument = useDocumentStore((state) => state.currentDocument);
  const settings = useSettingsStore((state) => state.settings);
  const contextWindowTokens = useSettingsStore((state) => state.settings.ai.maxTokens);
  const aiModel = useSettingsStore((state) => state.settings.ai.model);
  const pwaAssistantEnabled = useSettingsStore((state) => state.settings.ai.pwaAssistantButtonEnabled);
  const pwaAssistantSide = useSettingsStore((state) => state.settings.ai.pwaAssistantButtonSide);
  const [documentContent, setDocumentContent] = useState<string | undefined>(undefined);
  const [assistantContent, setAssistantContent] = useState<string | undefined>(undefined);
  const [assistantStatus, setAssistantStatus] = useState<"ready" | "loading" | "unavailable">("loading");
  const [assistantStatusMessage, setAssistantStatusMessage] = useState<string | undefined>(undefined);
  const [assistantSource, setAssistantSource] = useState<string | undefined>(undefined);
  const [mediaSections, setMediaSections] = useState<SectionNode[]>([]);
  const setSharedMediaSections = useDocumentOutlineStore((state) => state.setMediaSections);
  const [assistantPosition, setAssistantPosition] = useState<AssistantPosition>(() => {
    const saved = localStorage.getItem(ASSISTANT_POSITION_KEY);
    return saved === "left" ? "left" : "right";
  });
  const formFactor = useFormFactor();
  // Only hide assistant on phones, not on tablets or small screens.
  const isMobile = formFactor === "phone";
  const documents = useDocumentStore((state) => state.documents);
  const currentDoc = documents.find((doc) => doc.id === documentId) ?? currentDocument ?? null;
  const selectionRef = useRef(selection);
  const pdfContextTextRef = useRef(pdfContextText);
  const pdfOcrContextTextRef = useRef(pdfOcrContextText);
  const videoContextRef = useRef(videoContext);
  const scrollStateRef = useRef(scrollState);
  const documentContentRef = useRef<string | undefined>(documentContent);
  const assistantContentRef = useRef<string | undefined>(assistantContent);
  const currentDocRef = useRef(currentDoc);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`plethora.language-mode.${documentId}`, languageModeEnabled ? "on" : "off");
    }
  }, [documentId, languageModeEnabled]);

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
      contentFingerprint: `${documentId}:${currentDoc?.content?.length ?? 0}`,
      text: currentDoc?.content,
      source: {
        sourceType,
        documentId: isMedia ? undefined : documentId,
        mediaId: isMedia ? documentId : undefined,
        contentFingerprint: `${documentId}:${currentDoc?.content?.length ?? 0}`,
      },
    };
  }, [currentDoc?.content, currentDoc?.fileType, documentId]);

  const languageSourceAnchor = languageSource.source;

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
  }, [documentId, setSharedMediaSections]);

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

    // If video context is available, use it even when transcript is missing.
    if (videoContext?.videoId) {
      const transcriptText = videoContext.transcript?.trim();
      const videoText = transcriptText
        ? `Video: ${videoContext.title || videoContext.videoId}\nDuration: ${formatDuration(videoContext.duration || 0)}\n\nTRANSCRIPT:\n${transcriptText}`
        : `Video: ${videoContext.title || videoContext.videoId}\nDuration: ${formatDuration(videoContext.duration || 0)}\n\nTranscript: unavailable.`;
      
      trimToTokenWindow(videoText, maxTokens, aiModel, selection)
        .then((trimmed) => {
          if (isActive) {
            setAssistantContent(trimmed);
            setAssistantStatus("ready");
            setAssistantStatusMessage(undefined);
            setAssistantSource("video-transcript");
          }
        })
        .catch(() => {
          if (isActive) {
            setAssistantContent(videoText.slice(0, maxTokens * 4));
            setAssistantStatus("ready");
            setAssistantStatusMessage(undefined);
            setAssistantSource("video-transcript");
          }
        });
      
      return () => {
        isActive = false;
      };
    }

    // Otherwise use regular document content
    const baseContent = currentDoc?.metadata?.xThread?.structuredText ?? pdfContextText ?? currentDoc?.content ?? documentContent ?? selection;

    if (!baseContent) {
      setAssistantContent(undefined);
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
          setAssistantContent(trimmed);
          setAssistantStatus("ready");
          setAssistantStatusMessage(undefined);
          setAssistantSource(currentDoc?.fileType === "pdf" ? "pdf-window" : "document");
        }
      })
      .catch(() => {
        if (isActive) {
          setAssistantContent(baseContent.slice(0, maxTokens * 4));
          setAssistantStatus("ready");
          setAssistantStatusMessage(undefined);
          setAssistantSource(currentDoc?.fileType === "pdf" ? "pdf-window" : "document");
        }
      });

    return () => {
      isActive = false;
    };
  }, [currentDoc?.content, currentDoc?.fileType, documentContent, selection, contextWindowTokens, aiModel, pdfContextText, videoContext, debouncedScrollPercent]);

  const resolveContextForPrompt = useCallback(async (_prompt: string): Promise<ResolvedAssistantContext> => {
    const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 2000;
    const activeDoc = currentDocRef.current;
    const activeSelection = selectionRef.current;
    const pageNumber = scrollStateRef.current.pageNumber;

    if (videoContextRef.current?.videoId) {
      return resolveGenericAssistantContext(assistantContentRef.current, "video-transcript");
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
        };
      } catch {
        return {
          ...resolution,
          content: resolution.content.slice(0, maxTokens * 4),
        };
      }
    }

    if (activeDoc?.fileType === "pdf") {
      const preferOcr = settings.documents.ocr.autoOCR || settings.documents.ocr.autoExtractOnLoad;
      const resolution = await resolvePdfAssistantContext({
        document: activeDoc,
        liveWindowText: pdfContextTextRef.current,
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
      });

      if (resolution.status !== "ready" || !resolution.content) {
        return resolution;
      }

      try {
        const trimmed = await trimToTokenWindow(resolution.content, maxTokens, aiModel, activeSelection);
        return {
          ...resolution,
          content: trimmed,
        };
      } catch {
        return {
          ...resolution,
          content: resolution.content.slice(0, maxTokens * 4),
        };
      }
    }

    return resolveGenericAssistantContext(assistantContentRef.current, "document");
  }, [aiModel, contextWindowTokens, settings.documents.ocr.autoExtractOnLoad, settings.documents.ocr.autoOCR]);

  const assistantContext = useMemo<AssistantContext>(() => {
    const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 2000;

    const base = {
      documentId,
      selection: selection || undefined,
      content: assistantContent,
      contextWindowTokens: maxTokens,
      status: assistantStatus,
      statusMessage: assistantStatusMessage,
      source: assistantSource,
      sections: mediaSections.length > 0 ? mediaSections : undefined,
      resolveForPrompt: resolveContextForPrompt,
    };

    if (videoContext?.videoId) {
      return {
        ...base,
        type: "video" as const,
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
    resolveContextForPrompt,
    scrollState,
    selection,
    videoContext,
  ]);

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

  const documentViewer = (
    <LanguageLearningHostProvider
      hostId={`document-reader:${documentId}`}
      surface={languageSource.contentType === "media" ? "video" : openedFrom === "queue" ? "queue" : "reader"}
      source={languageSource}
      languageModeEnabled={languageModeEnabled}
    >
      <div
        className="relative flex-1 h-full min-h-0 overflow-hidden"
        style={{ minWidth: READER_MIN_WIDTH }}
      >
        <BaseDocumentViewer
        documentId={documentId}
        onSelectionChange={setSelection}
        onScrollPositionChange={setScrollState}
        initialViewMode={initialViewMode}
        highlightQuery={highlightQuery}
        initialJump={initialJump}
        autoPlay={autoPlay}
        listenToEdition={listenToEdition}
        focusedExtractId={focusedExtractId}
        extractSourceContext={extractSourceContext}
        onPdfContextTextChange={setPdfContextText}
        onPdfOcrContextTextChange={setPdfOcrContextText}
        contextPageWindow={2}
        onVideoContextChange={setVideoContext}
        onMediaSectionsChange={handleMediaSectionsChange}
        openedFrom={openedFrom}
        hideRatingOrbs={hideRatingOrbs}
        />
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
      </div>
    </LanguageLearningHostProvider>
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {isMobile ? (
        <>
          {documentViewer}
          {isPWA() && (
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

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
