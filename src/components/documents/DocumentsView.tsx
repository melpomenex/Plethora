import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  CaretLeft,
  CaretRight,
  Check,
  CircleNotch,
  Clock,
  Columns,
  DotsThree,
  Download,
  TextT as FileTextIcon,
  FolderOpen,
  Funnel,
  Globe,
  GridFour,
  Headphones,
  Link,
  List,
  MagnifyingGlass,
  Flag,
  Pause,
  Plus,
  Sparkle,
  Stack,
  TextT,
  Trash,
  WarningCircle,
  X,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { useDocumentStore } from "../../stores/documentStore";
import { useCollectionStore } from "../../stores/collectionStore";
import { useStudyDeckStore } from "../../stores/studyDeckStore";
import { AnnaArchiveSearch } from "../import/AnnaArchiveSearch";
import { ArxivImportDialog } from "../import/ArxivImportDialog";
import { WebArticleImportDialog } from "../import/WebArticleImportDialog";
import { AudiobookImportDialog } from "../import/AudiobookImportDialog";
import { ImportProgressIndicator } from "../import/ImportProgressIndicator";
import { MarkdownBundlePreview, type ImportBundleOptions } from "../import/MarkdownBundlePreview";
import { EmptyDocuments, EmptySearch } from "../common/EmptyState";
import { tourAnchor } from "../onboarding/tour/anchors";
import { ConfirmDialog, useConfirmDialog } from "../common/ConfirmDialog";
import { DocumentCardSkeleton, DocumentGridSkeleton } from "../common/Skeleton";
import { DragDropUpload } from "../common/DragDropUpload";
import type { MarkdownBundle } from "../../utils/markdownBundleImport";
import { useMarkdownBundleImport } from "../../hooks/useMarkdownBundleImport";
import type { Document } from "../../types/document";
import type { Collection } from "../../types/collection";
import {
  DocumentSortDirection,
  DocumentSortKey,
  DocumentViewMode,
  formatRelativeTime,
  getLastTouched,
  getNextAction,
  getPriorityReason,
  getPrioritySignal,
  getPriorityTier,
  getProgressSegments,
  getSmartSection,
  matchesDocumentSearch,
  parseDocumentSearch,
  sortDocuments,
} from "../../utils/documentsView";
import {
  bulkMoveDocumentsToCollection,
  importYouTubeVideo,
  resolveDocumentCover,
  setDocumentCover,
  updateDocument as updateDocumentApi,
} from "../../api/documents";
import { getYouTubeThumbnail, extractYouTubeTimestamp } from "../../api/youtube";
import { bulkSuspendItems } from "../../api/queue";
import { useMobileShell } from "../../hooks/useMobileShell";
import { useLongPress } from "../../hooks/useLongPress";
import { useIsActiveTab } from "../common/Tabs";
import { invokeCommand, isTauri, isNativeMobile } from "../../lib/tauri";
import { renderPdfCover } from "../../lib/pdfCoverRender";
import { DocumentFileSyncBadge } from "../sync/DocumentFileSyncBadge";
import { importAnkiPackage } from "../../utils/ankiImport";
import { useI18n } from "../../lib/i18n";
import { findCompanionDoc } from "../../utils/documentPairing";
import { useTranscriptionQueueStore } from "../../stores/transcriptionQueueStore";
import { enqueueAutoTranscription } from "../../api/transcription";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTranscriptionStore } from "../../stores/useTranscriptionStore";
import { useToast } from "../common/Toast";
import { useModal } from "../common/Modal";
import { AdaptiveContentHeader, AdaptiveInspector } from "../adaptive";
import {
  selectDocumentsByCheckbox,
  selectDocumentsByClick,
  uniqueDocumentIds,
  type DocumentSelectionModifiers,
} from "./documentSelection";
import { usePriorityPopup, resolveDisplaySlider, getPriorityInfo } from "./usePriorityPopup";
import { getShortcutCombo, eventMatchesCombo } from "../common/KeyboardShortcuts";

const MODE_STORAGE_KEY = "documentsViewMode";
const SAVED_VIEWS_KEY = "documentsSavedViews";
const MAX_VISIBLE_TAGS = 3;

type CompactDocumentFilter = "all" | "priority" | "recent" | "active" | "parked" | "highlights" | "cards";

function extractYouTubeId(urlOrId: string): string {
  if (!urlOrId) return "";

  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
    return urlOrId;
  }

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match) return match[1];
  }

  return "";
}

function getDocumentCoverUrl(doc: Document): string | null {
  if (doc.coverImageUrl) return doc.coverImageUrl;
  if (doc.fileType === "youtube") {
    const videoId = extractYouTubeId(doc.filePath ?? "");
    return videoId ? getYouTubeThumbnail(videoId) : null;
  }
  return null;
}

function getCoverFallbackIcon(fileType: Document["fileType"]) {
  if (fileType === "youtube") return YoutubeLogo;
  if (fileType === "pdf") return TextT;
  if (fileType === "audio") return Headphones;
  return BookOpen;
}

function coverFallbackGradient(fileType: Document["fileType"]): string {
  switch (fileType) {
    case "pdf": return "bg-gradient-to-br from-red-900/60 via-red-800/30 to-transparent";
    case "epub": return "bg-gradient-to-br from-blue-900/60 via-blue-800/30 to-transparent";
    case "youtube": return "bg-gradient-to-br from-red-950/60 via-red-900/30 to-transparent";
    case "audio": return "bg-gradient-to-br from-amber-900/60 via-amber-800/30 to-transparent";
    case "video": return "bg-gradient-to-br from-violet-900/60 via-violet-800/30 to-transparent";
    case "markdown": return "bg-gradient-to-br from-emerald-900/60 via-emerald-800/30 to-transparent";
    default: return "bg-gradient-to-br from-slate-900/60 via-slate-800/30 to-transparent";
  }
}

type SavedView = {
  id: string;
  name: string;
  query: string;
  sortKey: DocumentSortKey;
  sortDirection: DocumentSortDirection;
  mode: DocumentViewMode;
  compactDocumentsView?: boolean;
  showNextAction: boolean;
  fileTypeFilter: string;
};

const defaultSortByKey: Record<DocumentSortKey, DocumentSortDirection> = {
  priority: "desc",
  lastTouched: "desc",
  added: "desc",
  title: "asc",
  type: "asc",
  extracts: "desc",
  cards: "desc",
};

interface DocumentsViewProps {
  onOpenDocument?: (doc: Document) => void;
  onReadAlong?: (audioDoc: Document, epubDoc: Document) => void;
  enableYouTubeImport?: boolean;
}

export function DocumentsView({ onOpenDocument, onReadAlong, enableYouTubeImport = true }: DocumentsViewProps) {
  const { t } = useI18n();
  const { settings, updateSettingsCategory } = useSettingsStore();
  const compactDocumentsView = settings.interface?.compactDocumentsView ?? false;
  const {
    documents,
    isLoading,
    isImporting,
    isSegmenting,
    importProgress,
    error,
    loadDocuments,
    loadDocumentsPage,
    openFilePickerAndImport,
    importFromFiles,
    importFromFolder,
    updateDocument,
    deleteDocument,
    bulkDelete,
    segmentDocument,
  } = useDocumentStore();
  const collections = useCollectionStore((state) => state.collections);
  const createCollection = useCollectionStore((state) => state.createCollection);
  const activeCollectionId = useCollectionStore((state) => state.activeCollectionId);
  const switchCollection = useCollectionStore((state) => state.switchCollection);

  const [mode, setMode] = useState<DocumentViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    return stored === "list" ? "list" : "grid";
  });
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<DocumentSortKey>("priority");
  const [sortDirection, setSortDirection] = useState<DocumentSortDirection>("desc");
  const [showNextAction, setShowNextAction] = useState(true);
  const [selectedFileType, setSelectedFileType] = useState<string>("all");
  const [compactFilter, setCompactFilter] = useState<CompactDocumentFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [selectionToggledIds, setSelectionToggledIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listCtxDoc, setListCtxDoc] = useState<{ doc: Document; pos: { x: number; y: number } } | null>(null);
  const listCtxRef = useRef<HTMLDivElement>(null);
  // Ref to the document currently being long-pressed (set on touchstart so the
  // long-press timer's callback knows which doc to open the menu for).
  const longPressDocRef = useRef<Document | null>(null);
  const docLongPress = useLongPress((pos) => {
    if (longPressDocRef.current) {
      setListCtxDoc({ doc: longPressDocRef.current, pos });
    }
  });
  const [listPairPicker, setListPairPicker] = useState<Document | null>(null);
  const [listPairSearch, setListPairSearch] = useState("");

  // Confirmation dialog for destructive actions
  const confirmDialog = useConfirmDialog();
  const toast = useToast();
  const modal = useModal();
  const priorityPopup = usePriorityPopup({ updateDocument });

  const isMobile = useMobileShell();
  const isActiveTab = useIsActiveTab();
  const [isInspectorOpen, setInspectorOpen] = useState(() => !isMobile);
  const [_collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const [showYouTubeImport, setShowYouTubeImport] = useState(false);
  const [showAnnaArchiveSearch, setShowAnnaArchiveSearch] = useState(false);
  const [showArxivImport, setShowArxivImport] = useState(false);
  const [showWebArticleImport, setShowWebArticleImport] = useState(false);
  const [showAudiobookImport, setShowAudiobookImport] = useState(false);
  const [showMarkdownBundlePreview, setShowMarkdownBundlePreview] = useState(false);
  const [detectedBundle, setDetectedBundle] = useState<MarkdownBundle | null>(null);
  const [, setBundleFiles] = useState<File[]>([]);
  const { importBundle } = useMarkdownBundleImport();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [ytdlpAvailable, setYtdlpAvailable] = useState<boolean | null>(null);
  const [ytdlpInstalling, setYtdlpInstalling] = useState(false);
  const [ytdlpInstallMessage, setYtdlpInstallMessage] = useState<string | null>(null);

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = window.localStorage.getItem(SAVED_VIEWS_KEY);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored) as SavedView[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isActiveTab) return;
    void loadDocuments();
  }, [isActiveTab, loadDocuments]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 100);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODE_STORAGE_KEY, mode);
    }
  }, [mode]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews));
    }
  }, [savedViews]);

  useEffect(() => {
    if (!showYouTubeImport) return;
    setYtdlpInstallMessage(null);
    if (!isTauri() || isNativeMobile()) {
      // yt-dlp can't be installed on native mobile (Android/iOS). Treat mobile
      // like the PWA: don't gate the import on a yt-dlp check — the browser
      // backend creates the document without it, and transcripts are fetched
      // via the hosted readsync.org API.
      setYtdlpAvailable(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const available = await invokeCommand<boolean>("check_ytdlp");
        if (!cancelled) {
          setYtdlpAvailable(available);
          if (available) {
            setYtdlpInstallMessage(null);
          }
        }
      } catch {
        if (!cancelled) {
          setYtdlpAvailable(false);
        }
      }
    })();
  }, [showYouTubeImport]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showYouTubeImport) {
        setShowYouTubeImport(false);
        setYoutubeUrl("");
        setYoutubeError(null);
      }
    };

    if (showYouTubeImport) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [showYouTubeImport]);

  const searchTokens = useMemo(() => parseDocumentSearch(debouncedSearch), [debouncedSearch]);

  const availableFileTypes = useMemo(() => {
    const types = new Set(documents.map((doc) => doc.fileType));
    return Array.from(types).sort();
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    let base = documents.filter((doc) => matchesDocumentSearch(doc, searchTokens));
    // Collection filtering is now handled by the backend (collection_id on documents)
    if (selectedFileType !== "all") {
      base = base.filter((doc) => doc.fileType === selectedFileType);
    }
    if (compactDocumentsView && compactFilter !== "all") {
      base = base.filter((doc) => {
        switch (compactFilter) {
          case "priority":
            return !doc.isArchived && getPriorityTier(doc) === "high";
          case "recent":
            return Date.now() - new Date(doc.dateAdded).getTime() < 7 * 24 * 60 * 60 * 1000;
          case "active":
            return (doc.progressPercent ?? 0) > 0 || doc.extractCount > 0 || doc.learningItemCount > 0;
          case "parked":
            return doc.isArchived || getPriorityTier(doc) === "low";
          case "highlights":
            return doc.extractCount > 0;
          case "cards":
            return doc.learningItemCount > 0;
          default:
            return true;
        }
      });
    }
    return base;
  }, [compactDocumentsView, compactFilter, documents, searchTokens, selectedFileType]);

  const sortedDocuments = useMemo(() => {
    return sortDocuments(filteredDocuments, sortKey, sortDirection);
  }, [filteredDocuments, sortKey, sortDirection]);
  const orderedDocumentIds = useMemo(
    () => uniqueDocumentIds(sortedDocuments.map((doc) => doc.id)),
    [sortedDocuments]
  );

  // Track which doc IDs we've already processed for cover resolution.
  // This prevents re-firing resolveDocumentCover on every sortedDocuments change.
  const processedDocIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isTauri() || (mode !== "grid" && !compactDocumentsView)) return;

    const pendingDocs = sortedDocuments.filter((doc) => {
      if (doc.coverImageUrl) return false;
      if (processedDocIdsRef.current.has(doc.id)) return false;
      if (doc.fileType === "pdf") {
        // PDFs previously resolved to "fallback" get a second chance via the
        // client-side first-page renderer (see renderPdfCover), so do NOT skip
        // them here the way non-PDF fallbacks are skipped.
        return true;
      }
      if (doc.fileType === "audio") {
        // Audiobooks previously resolved to "fallback" also get a second
        // chance: the backend's ffmpeg-free cover extractor (lofty) was added
        // after these docs were imported, so re-resolving gives them a shot
        // at the newly-available embedded-cover path. See the
        // `fix-audiobook-cover-extraction` change.
        return true;
      }
      if (doc.coverImageSource === "fallback") return false;
      return true;
    });

    if (pendingDocs.length === 0) return;
    // Claim every pending id up-front so a re-render of this effect (e.g. when
    // sortedDocuments changes) doesn't re-fire resolution for the same docs.
    pendingDocs.forEach((doc) => processedDocIdsRef.current.add(doc.id));

    let cancelled = false;

    // Resolve sequentially. The PDF render path loads + rasterizes a page per
    // document via pdfjs; running many in parallel would spike memory and jank
    // the grid. Non-PDF resolution is cheap but is kept on the same chain for
    // simplicity and a bounded concurrency of one.
    void (async () => {
      for (const doc of pendingDocs) {
        if (cancelled) return;
        try {
          await resolveOneDocumentCover(doc);
        } catch (error) {
          console.warn(`Failed to resolve cover for document ${doc.id}:`, error);
        }
      }
    })();

    async function resolveOneDocumentCover(doc: Document): Promise<void> {
      // Step 1: backend resolver (embedded image / YouTube / Anna's Archive).
      // For PDFs already marked "fallback" we know this found nothing before,
      // so skip straight to the render path and avoid re-querying Anna.
      let resolved = doc;
      if (doc.fileType !== "pdf" || doc.coverImageSource !== "fallback") {
        const updated = await resolveDocumentCover(doc.id);
        if (updated) {
          applyCoverUpdate(doc.id, updated.coverImageUrl, updated.coverImageSource);
          resolved = updated;
        }
      }
      if (resolved.coverImageUrl) return; // backend (or prior render) already found a cover

      // Step 2: PDF-only client-side first-page render fallback.
      if (doc.fileType !== "pdf") return;
      const dataUrl = await renderPdfCover(doc.id);
      if (cancelled || !dataUrl) return; // render failed/timeout → keep icon placeholder
      const updated = await setDocumentCover(doc.id, dataUrl);
      if (updated) {
        applyCoverUpdate(doc.id, updated.coverImageUrl, updated.coverImageSource);
      }
    }

    function applyCoverUpdate(
      id: string,
      coverImageUrl: string | undefined,
      coverImageSource: string | undefined,
    ): void {
      const current = useDocumentStore.getState().documents.find((d) => d.id === id);
      if (current?.coverImageUrl === coverImageUrl) return;
      updateDocument(id, { coverImageUrl, coverImageSource });
    }

    return () => {
      cancelled = true;
    };
  }, [compactDocumentsView, mode, sortedDocuments, updateDocument]);

  const _sectionedDocuments = useMemo(() => {
    const sections: Record<string, Document[]> = {};
    for (const doc of sortedDocuments) {
      const section = getSmartSection(doc);
      if (!sections[section]) sections[section] = [];
      sections[section].push(doc);
    }
    return sections;
  }, [sortedDocuments]);

  useEffect(() => {
    const visibleIds = new Set(sortedDocuments.map((doc) => doc.id));
    setSelectedIds((prev) => new Set(Array.from(prev).filter((id) => visibleIds.has(id))));
    setSelectionToggledIds((prev) => new Set(Array.from(prev).filter((id) => visibleIds.has(id))));
    setSelectionAnchorId((prev) => (prev && visibleIds.has(prev) ? prev : null));
    if (activeId && !visibleIds.has(activeId)) {
      setActiveId(sortedDocuments[0]?.id ?? null);
    }
  }, [sortedDocuments, activeId]);

  const handleImport = useCallback(async () => {
    try {
      const importedDocs = await openFilePickerAndImport();
      if (onOpenDocument && importedDocs.length > 0) {
        onOpenDocument(importedDocs[0]);
      }
    } catch (err) {
      console.error("Failed to import documents:", err);
    }
  }, [openFilePickerAndImport, onOpenDocument]);

  const handleImportFolder = useCallback(async () => {
    try {
      const importedDocs = await importFromFolder();
      if (onOpenDocument && importedDocs.length > 0) {
        onOpenDocument(importedDocs[0]);
      }
    } catch (err) {
      console.error("Failed to import folder:", err);
    }
  }, [importFromFolder, onOpenDocument]);

  useEffect(() => {
    const handleImportShortcut = () => {
      void handleImport();
    };

    window.addEventListener("import-document", handleImportShortcut as EventListener);
    return () =>
      window.removeEventListener("import-document", handleImportShortcut as EventListener);
  }, [handleImport]);

  const handleDragDropFiles = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0) return;
      try {
        const importedDocs = await importFromFiles(filePaths);
        if (onOpenDocument && importedDocs.length > 0) {
          onOpenDocument(importedDocs[0]);
        }
      } catch (err) {
        console.error("Failed to import dropped files:", err);
      }
    },
    [importFromFiles, onOpenDocument]
  );

  const handleAnkiPackage = useCallback(
    async (filePath: string) => {
      try {
        const decks = await importAnkiPackage(filePath);
        // TODO: Show a dialog to let user select which decks to import
        // For now, just log success
        await loadDocuments();
      } catch (err) {
        console.error("Failed to import Anki package:", err);
      }
    },
    [loadDocuments]
  );

  const handleStudyJsonDeck = useCallback(
    async (filePath: string) => {
      try {
        const result = await invokeCommand<{ deck_name: string; cards_imported: number }>(
          "import_study_json_file",
          { filePath, collectionId: useCollectionStore.getState().activeCollectionId }
        );
        useStudyDeckStore.getState().ensureDecksExist([result.deck_name]);
        await loadDocuments();
      } catch (err) {
        console.error("Failed to import JSON deck:", err);
      }
    },
    [loadDocuments]
  );

  const handleBundleDetected = useCallback((bundle: MarkdownBundle, files: File[]) => {
    setDetectedBundle(bundle);
    setBundleFiles(files);
    setShowMarkdownBundlePreview(true);
  }, []);

  const handleBundleImport = useCallback(
    async (options: ImportBundleOptions) => {
      if (!detectedBundle) return;

      try {
        const doc = await importBundle(detectedBundle, options);
        await loadDocuments();
        setShowMarkdownBundlePreview(false);
        setDetectedBundle(null);
        setBundleFiles([]);

        if (onOpenDocument) {
          onOpenDocument(doc);
        }
      } catch (err) {
        console.error("[DocumentsView] Failed to import bundle:", err);
        throw err;
      }
    },
    [detectedBundle, importBundle, loadDocuments, onOpenDocument]
  );

  const handleYouTubeImport = async () => {
    if (!youtubeUrl.trim()) {
      setYoutubeError(t("documentsView.pleaseEnterYoutubeUrl"));
      return;
    }
    if (isTauri() && !isNativeMobile() && ytdlpAvailable === false) {
      setYoutubeError(t("documentsView.ytdlpNotInstalled"));
      return;
    }
    setYoutubeLoading(true);
    setYoutubeError(null);
    try {
      const collectionId = useCollectionStore.getState().activeCollectionId;
      const document = await importYouTubeVideo(youtubeUrl.trim(), collectionId);

      // Extract timestamp from URL if present (e.g., ?t=933)
      const timestamp = extractYouTubeTimestamp(youtubeUrl.trim());
      if (timestamp !== null && timestamp > 0) {
        await updateDocumentApi(document.id, { currentPage: timestamp } as any);
      }

      await loadDocuments();
      setShowYouTubeImport(false);
      setYoutubeUrl("");
      if (onOpenDocument) {
        onOpenDocument(document);
      }
    } catch (err) {
      setYoutubeError(err instanceof Error ? err.message : "Failed to import YouTube video");
    } finally {
      setYoutubeLoading(false);
    }
  };

  const handleInstallYtdlp = async () => {
    setYtdlpInstalling(true);
    setYoutubeError(null);
    setYtdlpInstallMessage(null);
    try {
      const version = await invokeCommand<string>("setup_ytdlp_auto");
      setYtdlpAvailable(true);
      setYtdlpInstallMessage(`yt-dlp installed (${version}).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to install yt-dlp";
      setYtdlpAvailable(false);
      setYoutubeError(message);
    } finally {
      setYtdlpInstalling(false);
    }
  };

  const clearDocumentSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionAnchorId(null);
    setSelectionToggledIds(new Set());
  }, []);

  const handleSelectRow = (doc: Document, modifiers: DocumentSelectionModifiers = {}) => {
    const current = {
      selectedIds,
      anchorId: selectionAnchorId,
      toggledIds: selectionToggledIds,
    };
    const next = modifiers.checkbox
      ? selectDocumentsByCheckbox(current, orderedDocumentIds, doc.id, modifiers)
      : selectDocumentsByClick(current, orderedDocumentIds, doc.id, modifiers);
    setSelectedIds(next.selectedIds);
    setSelectionAnchorId(next.anchorId);
    setSelectionToggledIds(next.toggledIds);
    // Unchecking a box should not promote that document in the inspector.
    if (next.selectedIds.has(doc.id)) setActiveId(doc.id);
  };

  const handleBulkArchive = () => {
    if (selectedIds.size === 0) return;

    const selectedDocs = documents.filter((d) => selectedIds.has(d.id));
    const docTitles = selectedDocs.map((d) => d.title || "Untitled");

    confirmDialog.confirm({
      title: t("documentsView.archiveTitle"),
      message: t("documentsView.archiveMessage", { count: selectedIds.size }),
      variant: "warning",
      itemName: "document",
      itemCount: selectedIds.size,
      details: docTitles,
      onConfirm: () => {
        selectedIds.forEach((id) => {
          updateDocument(id, { isArchived: true });
        });
        clearDocumentSelection();
      },
    });
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;

    const selectedDocs = documents.filter((d) => selectedIds.has(d.id));
    const docTitles = selectedDocs.map((d) => d.title || "Untitled");

    confirmDialog.confirm({
      title: t("documentsView.deleteTitle"),
      message: t("documentsView.deleteMessage", { count: selectedIds.size }),
      variant: "danger",
      itemName: "document",
      itemCount: selectedIds.size,
      details: docTitles,
      onConfirm: async () => {
        const ids = Array.from(selectedIds);
        const result = await bulkDelete(ids);
        clearDocumentSelection();
        setActiveId(null);
        if (result.failed.length > 0) {
          toast.error(
            t("documentsView.bulkDeletePartial", {
              succeeded: result.succeeded.length,
              total: ids.length,
              failed: result.failed.length,
            })
          );
        }
      },
    });
  };

  const handleDeleteDocument = (doc: Document) => {
    confirmDialog.confirm({
      title: t("documentsView.deleteTitle"),
      message: t("documentsView.deleteSingleMessage", { title: doc.title }),
      variant: "danger",
      itemName: "document",
      itemCount: 1,
      details: [doc.title || "Untitled"],
      onConfirm: async () => {
        await deleteDocument(doc.id);
        if (activeId === doc.id) {
          setActiveId(null);
        }
      },
    });
  };

  const handleTranscribe = async (doc: Document) => {
    if (!doc.filePath) return;
    const settings = useSettingsStore.getState().settings.audioTranscription;
    try {
      // 1. Fetch available profiles to find installed/downloaded ones
      const transcriptionStore = useTranscriptionStore.getState();
      let profiles = transcriptionStore.profiles;
      if (profiles.length === 0) {
        try {
          await transcriptionStore.fetchProfiles();
          profiles = useTranscriptionStore.getState().profiles;
        } catch (err) {
          console.warn("Failed to fetch transcription profiles:", err);
        }
      }

      const installed = profiles.filter((p) => p.installed);

      // 2. Define quality ranks for local models (highest quality first)
      const MODEL_QUALITY_RANK = [
        "parakeet-tdt-ctc-110m",  // Parakeet TDT-CTC 110M - ~126MB (SOTA English, very fast)
        "sense-voice-small",      // SenseVoice Small - ~234MB (SOTA zh/en/ja/ko/yue)
        "small",                  // Whisper Small (Multilingual Balanced) - ~488MB
        "distil-small.en",        // Whisper Distil Small (English Fast) - ~336MB
        "base",                   // Whisper Base (Multilingual Fast) - ~148MB
      ];

      // Determine model to use
      let bestModelId = settings.preferredModelId;
      const isPreferredInstalled = installed.some((p) => p.id === bestModelId);

      if (!bestModelId || !isPreferredInstalled) {
        if (installed.length > 0) {
          // Sort installed by rank
          const sortedInstalled = [...installed].sort((a, b) => {
            let rankA = MODEL_QUALITY_RANK.indexOf(a.id);
            let rankB = MODEL_QUALITY_RANK.indexOf(b.id);
            if (rankA === -1) rankA = 999;
            if (rankB === -1) rankB = 999;
            return rankA - rankB;
          });
          bestModelId = sortedInstalled[0].id;
        } else {
          bestModelId = "distil-small.en"; // Fallback default
        }
      }

      const isGroq = settings.provider === "groq";
      const finalModelId = isGroq ? "groq-whisper" : bestModelId;

      // 3. Route transcription based on model & provider
      await enqueueAutoTranscription(
        doc.id,
        doc.filePath,
        settings.provider,
        finalModelId,
        settings.language || "en",
      );
      toast.info(
        "Transcription Queued",
        `"${doc.title || "audio"}" has been enqueued for background transcription.`
      );
    } catch (error: any) {
      console.error("Failed to transcribe:", error);
      confirmDialog.confirm({
        title: "Transcription Failed",
        message: "Could not start transcription because the audio file was not found on your system. Please verify that the file exists and is accessible.",
        variant: "warning",
        itemName: "document",
        itemCount: 1,
        details: [doc.title || "Untitled", `Path: ${doc.filePath}`],
        confirmLabel: "OK",
        onConfirm: () => {},
      });
    }
  };

  /**
   * Report a bulk outcome and release the selection.
   *
   * Every bulk action funnels through here so a partial failure always names
   * its reasons instead of finishing silently, and so the action bar cannot
   * survive its own action.
   */
  const finishBulkAction = (
    action: string,
    succeeded: string[],
    failures: { id: string; reason: string }[],
  ) => {
    clearDocumentSelection();
    if (failures.length === 0) {
      toast.success(action, t("documentsView.bulkSucceeded", { count: succeeded.length }));
      return;
    }
    toast.error(
      action,
      `${t("documentsView.bulkDeletePartial", {
        succeeded: succeeded.length,
        total: succeeded.length + failures.length,
        failed: failures.length,
      })} ${failures.map((failure) => failure.reason).join("; ")}`,
    );
  };

  /**
   * Apply an update to every selected document, collecting per-document
   * failures rather than aborting the batch on the first one.
   */
  const applyToSelection = async (
    action: string,
    apply: (doc: Document) => Promise<unknown> | unknown,
  ) => {
    const succeeded: string[] = [];
    const failures: { id: string; reason: string }[] = [];
    for (const id of Array.from(selectedIds)) {
      const doc = documents.find((item) => item.id === id);
      if (!doc) {
        failures.push({ id, reason: `${id}: not found` });
        continue;
      }
      try {
        await apply(doc);
        succeeded.push(id);
      } catch (error) {
        failures.push({
          id,
          reason: `${doc.title || id}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    finishBulkAction(action, succeeded, failures);
  };

  // These three used window.prompt(), which the desktop WebView suppresses
  // entirely (wry implements no runJavaScriptTextInputPanel delegate), so the
  // buttons appeared to do nothing at all. They now use the in-app modal.
  const handleBulkTag = async () => {
    if (selectedIds.size === 0) return;
    const tag = (await modal.prompt(t("documentsView.addTagPrompt"), "", t("documentsView.tag")))?.trim();
    if (!tag) return;
    await applyToSelection(t("documentsView.tag"), (doc) => {
      const nextTags = new Set(doc.tags);
      nextTags.add(tag);
      return updateDocument(doc.id, { tags: Array.from(nextTags) });
    });
  };

  const handleBulkReprioritize = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const docs = sortedDocuments.filter((d) => ids.includes(d.id));
    const { committed } = await priorityPopup.open(ids, docs, { forceBulk: true });
    if (committed) {
      // Mass-set wrote through bulk_set_document_priority; refresh every row.
      await loadDocuments?.();
      clearDocumentSelection();
    }
  };

  const handleBulkMoveCollection = async () => {
    if (selectedIds.size === 0) return;
    const names = collections.map((collection) => collection.name).join(", ");
    const targetName = (
      await modal.prompt(
        t("documentsView.moveCollectionPrompt", { names }),
        "",
        t("documentsView.move"),
      )
    )?.trim();
    if (!targetName) return;

    const documentIds = Array.from(selectedIds);
    try {
      const existing = collections.find(
        (collection) => collection.name.toLowerCase() === targetName.toLowerCase()
      );
      const target = existing ?? (await createCollection(targetName));
      // update_document deliberately omits collection_id, so the move needs
      // its own command rather than a spread through updateDocument.
      const result = await bulkMoveDocumentsToCollection(documentIds, target.id);
      finishBulkAction(
        t("documentsView.move"),
        result.succeeded,
        result.failed.map((id, index) => ({ id, reason: result.errors[index] ?? id })),
      );
      await loadDocuments();
    } catch (error) {
      finishBulkAction(t("documentsView.move"), [], [
        {
          id: "",
          reason: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
  };

  /**
   * Suspend removes documents from the reading queue without archiving or
   * deleting them (same reversible is_dismissed flag the Queue view's
   * per-item Suspend uses). With no override this acts on the current
   * selection and clears it afterward (toolbar button); a context-menu click
   * on a document outside the selection passes an explicit single id instead
   * and leaves the unrelated selection alone.
   */
  const handleBulkSuspend = async (idsOverride?: string[]) => {
    const usingSelection = idsOverride === undefined;
    const ids = idsOverride ?? Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const result = await bulkSuspendItems(ids);
      if (usingSelection) {
        finishBulkAction(
          t("documentsView.suspend"),
          result.succeeded,
          result.failed.map((id, index) => ({ id, reason: result.errors[index] ?? id })),
        );
      } else if (result.failed.length > 0) {
        toast.error(t("documentsView.suspend"), result.errors[0] ?? result.failed[0]);
      } else {
        toast.success(
          t("documentsView.suspend"),
          t("documentsView.bulkSucceeded", { count: result.succeeded.length }),
        );
      }
      await loadDocuments();
    } catch (error) {
      toast.error(t("documentsView.suspend"), error instanceof Error ? error.message : String(error));
    }
  };

  const handleSort = (key: DocumentSortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection(defaultSortByKey[key]);
  };

  const activeDocument = useMemo(
    () => sortedDocuments.find((doc) => doc.id === activeId) ?? null,
    [sortedDocuments, activeId]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }

      // Escape clears a multi-document selection (dismisses the bulk action bar).
      if (event.key === "Escape" && selectedIds.size > 0) {
        event.preventDefault();
        setSelectedIds(new Set());
        setSelectionAnchorId(null);
        setSelectionToggledIds(new Set());
        return;
      }

      // Priority popup: opens for the current selection (single or mass set).
      const priorityCombo = getShortcutCombo("doc.priority");
      if (priorityCombo && eventMatchesCombo(event, priorityCombo)) {
        event.preventDefault();
        // Operate on the explicit selection; if none, fall back to the active row.
        const targetIds = selectedIds.size > 0 ? Array.from(selectedIds) : activeId ? [activeId] : [];
        if (targetIds.length === 0) return;
        const docs = sortedDocuments.filter((d) => targetIds.includes(d.id));
        void priorityPopup.open(targetIds, docs).then(({ committed }) => {
          // For a mass set, refresh the document list so all rows reflect the
          // new value; the single-doc path already patched the store.
          if (committed && targetIds.length > 1) {
            void loadDocuments?.();
          }
        });
        return;
      }

      if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        setInspectorOpen((prev) => !prev);
        return;
      }

      if (mode === "list" && (event.key.toLowerCase() === "j" || event.key.toLowerCase() === "k")) {
        event.preventDefault();
        if (sortedDocuments.length === 0) return;
        const currentIndex = sortedDocuments.findIndex((doc) => doc.id === activeId);
        const delta = event.key.toLowerCase() === "j" ? 1 : -1;
        const nextIndex =
          currentIndex === -1
            ? 0
            : Math.min(sortedDocuments.length - 1, Math.max(0, currentIndex + delta));
        const nextDoc = sortedDocuments[nextIndex];
        setActiveId(nextDoc.id);
        setSelectedIds(new Set([nextDoc.id]));
        setSelectionAnchorId(nextDoc.id);
        setSelectionToggledIds(new Set());
        return;
      }

      if (event.key === "Enter") {
        const doc = activeDocument ?? sortedDocuments[0];
        if (doc && onOpenDocument) {
          onOpenDocument(doc);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeDocument, activeId, mode, onOpenDocument, selectedIds, sortedDocuments, updateDocument]);

  const handleSaveView = async () => {
    const name = (await modal.prompt(t("documentsView.nameViewPrompt")))?.trim();
    if (!name) return;
    const view: SavedView = {
      id: `${Date.now()}`,
      name,
      query: searchInput,
      sortKey,
      sortDirection,
      mode,
      compactDocumentsView,
      showNextAction,
      fileTypeFilter: selectedFileType,
    };
    setSavedViews((prev) => [...prev, view]);
    setActiveViewId(view.id);
  };

  const handleApplyView = (viewId: string) => {
    if (!viewId) {
      setActiveViewId(null);
      setSelectedFileType("all");
      return;
    }
    const view = savedViews.find((item) => item.id === viewId);
    if (!view) return;
    setSearchInput(view.query);
    setDebouncedSearch(view.query);
    setSortKey(view.sortKey);
    setSortDirection(view.sortDirection);
    setMode(view.mode);
    updateSettingsCategory("interface", { compactDocumentsView: view.compactDocumentsView ?? false });
    setShowNextAction(view.showNextAction);
    setSelectedFileType(view.fileTypeFilter ?? "all");
    setActiveViewId(view.id);
  };

  const handleViewModeChange = (nextMode: DocumentViewMode) => {
    setMode(nextMode);
    if (compactDocumentsView) {
      updateSettingsCategory("interface", { compactDocumentsView: false });
    }
  };

  const handleCompactViewChange = () => {
    updateSettingsCategory("interface", { compactDocumentsView: true });
  };

  const _toggleSection = (section: string) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <DragDropUpload
      onFilesImported={handleDragDropFiles}
      onAnkiPackage={handleAnkiPackage}
      onStudyJsonDeck={handleStudyJsonDeck}
      onBundleDetected={handleBundleDetected}
      className="h-full"
    >
      <div className="h-full flex flex-col bg-cream">
        {/* Header */}
        <div className="border-b border-border bg-card p-3 sm:p-4" data-responsive-surface="documents">
          <AdaptiveContentHeader
            className="p-0 pb-3"
            title={t("documentsView.title")}
            description={t("documentsView.headerSummary", { count: sortedDocuments.length })}
            primaryAction={
              <button
                onClick={handleImport}
                disabled={isImporting}
                {...tourAnchor("documentsImportButton")}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
                <span>{isImporting ? t("documentsView.importing") : t("documentsView.importDocument")}</span>
              </button>
            }
            secondaryActions={
              <button
                onClick={handleImportFolder}
                disabled={isImporting}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-foreground hover:bg-muted/80 disabled:opacity-50"
              >
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
                {t("documentsView.importFolder")}
              </button>
            }
            overflowActions={[
              ...(enableYouTubeImport
                ? [{ id: "youtube", label: t("documentsView.importYouTube"), icon: <YoutubeLogo className="h-4 w-4" />, onSelect: () => setShowYouTubeImport(true) }]
                : []),
              { id: "arxiv", label: t("documentsView.arxiv"), icon: <FileTextIcon className="h-4 w-4" />, onSelect: () => setShowArxivImport(true) },
              { id: "web", label: t("documentsView.webArticle"), icon: <Globe className="h-4 w-4" />, onSelect: () => setShowWebArticleImport(true) },
              { id: "audio", label: t("documentsView.audiobook"), icon: <Headphones className="h-4 w-4" />, onSelect: () => setShowAudiobookImport(true) },
              { id: "folder", label: t("documentsView.importFolder"), icon: <FolderOpen className="h-4 w-4" />, onSelect: handleImportFolder, disabled: isImporting },
            ]}
          />

          {/* Controls Bar */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-0 order-1 sm:min-w-[200px]">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t("documentsView.searchPlaceholder")}
                className="w-full pl-9 pr-3 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-shadow"
              />
            </div>

            {/* Mobile Controls Row - View Toggle + Views + Funnel */}
            <div className="flex sm:hidden items-center gap-2 order-2">
              {/* View Mode Toggle */}
              <DocumentsViewSwitcher
                mode={mode}
                compactDocumentsView={compactDocumentsView}
                compact={true}
                onModeChange={handleViewModeChange}
                onCompactChange={handleCompactViewChange}
              />

              {/* Type Funnel */}
              <div className="relative">
                <select
                  value={selectedFileType}
                  onChange={(event) => setSelectedFileType(event.target.value)}
                  className="pl-3 pr-8 py-2 bg-background border border-border rounded-lg text-sm text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                >
                  <option value="all">{t("documentsView.all")}</option>
                  {availableFileTypes.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  <Funnel className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>

              {/* Saved Views */}
              <MobileSavedViewsMenu
                savedViews={savedViews}
                activeViewId={activeViewId}
                onApplyView={handleApplyView}
                onSaveView={handleSaveView}
              />
            </div>

            {/* Desktop Controls */}
            <div className="hidden sm:flex items-center gap-2">
              {/* View Mode Toggle */}
              <DocumentsViewSwitcher
                mode={mode}
                compactDocumentsView={compactDocumentsView}
                onModeChange={handleViewModeChange}
                onCompactChange={handleCompactViewChange}
              />

              <button
                onClick={() => setInspectorOpen((prev) => !prev)}
                className="px-3 py-2 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors"
              >
                {isInspectorOpen
                  ? t("documentsView.hideInspector")
                  : t("documentsView.showInspector")}
              </button>

              {/* Type Funnel */}
              <div className="relative">
                <Funnel className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <select
                  value={selectedFileType}
                  onChange={(event) => setSelectedFileType(event.target.value)}
                  className="pl-8 pr-7 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                >
                  <option value="all">{t("documentsView.allTypes")}</option>
                  {availableFileTypes.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg
                    className="w-4 h-4 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </div>

              {/* Saved Views */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select
                    value={activeViewId ?? ""}
                    onChange={(event) => handleApplyView(event.target.value)}
                    className="pl-3 pr-7 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  >
                    <option value="">{t("documentsView.savedViews")}</option>
                    {savedViews.map((view) => (
                      <option key={view.id} value={view.id}>
                        {view.name}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg
                      className="w-4 h-4 text-muted-foreground"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
                <button
                  onClick={handleSaveView}
                  className="px-3 py-2.5 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors"
                >
                  {t("documentsView.saveView")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-4 p-4 bg-destructive/10 border border-destructive text-destructive rounded-lg">
            {error}
          </div>
        )}

        {isImporting && importProgress.total > 0 && (
          <div className="mx-4 mt-4">
            <ImportProgressIndicator
              fileName={importProgress.fileName}
              importType="unknown"
              current={importProgress.current}
              total={importProgress.total}
              status="processing"
              statusMessage={
                importProgress.fileName
                  ? t("documentsView.processingFile", { name: importProgress.fileName })
                  : t("documentsView.importingDocuments")
              }
            />
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="mx-4 mt-4 p-3 bg-primary/10 border border-primary/20 rounded-md flex items-center justify-between">
            <span className="text-sm text-primary">
              {t("documentsView.selectedCount", { count: selectedIds.size })}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const visibleIds = sortedDocuments.map((doc) => doc.id);
                  const allSelected =
                    visibleIds.length > 0 &&
                    visibleIds.every((id) => selectedIds.has(id));
                  if (allSelected) {
                    clearDocumentSelection();
                  } else {
                    setSelectedIds(new Set(visibleIds));
                    setSelectionAnchorId(null);
                    setSelectionToggledIds(new Set());
                  }
                }}
                className="px-3 py-1.5 bg-background border border-border rounded text-sm text-foreground hover:bg-muted"
              >
                {(() => {
                  const visibleIds = sortedDocuments.map((doc) => doc.id);
                  const allSelected =
                    visibleIds.length > 0 &&
                    visibleIds.every((id) => selectedIds.has(id));
                  return allSelected
                    ? t("documentsView.clearSelection")
                    : t("documentsView.selectAll");
                })()}
              </button>
              <button
                onClick={handleBulkTag}
                className="px-3 py-1.5 bg-background border border-border rounded text-sm text-foreground hover:bg-muted"
              >
                {t("documentsView.tag")}
              </button>
              <button
                onClick={handleBulkMoveCollection}
                className="px-3 py-1.5 bg-background border border-border rounded text-sm text-foreground hover:bg-muted"
              >
                {t("documentsView.move")}
              </button>
              <button
                onClick={handleBulkReprioritize}
                className="px-3 py-1.5 bg-background border border-border rounded text-sm text-foreground hover:bg-muted"
              >
                {t("documentsView.reprioritize")}
              </button>
              <button
                onClick={() => void handleBulkSuspend()}
                className="px-3 py-1.5 bg-background border border-border rounded text-sm text-foreground hover:bg-muted flex items-center gap-1"
              >
                <Pause className="w-3 h-3" />
                {t("documentsView.suspend")}
              </button>
              <button
                onClick={handleBulkArchive}
                className="px-3 py-1.5 bg-muted text-foreground rounded text-sm hover:bg-muted/80"
              >
                {t("documentsView.archive")}
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded text-sm hover:opacity-90 flex items-center gap-1"
              >
                <Trash className="w-3 h-3" />
                {t("documentsView.delete")}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden documents-layout">
          <div className="flex-1 overflow-auto p-4 documents-content">
            {isLoading ? (
              mode === "list" || compactDocumentsView ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <DocumentCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <DocumentGridSkeleton count={8} />
              )
            ) : compactDocumentsView ? (
              <CompactLibraryView
                documents={documents}
                sortedDocuments={sortedDocuments}
                collections={collections}
                activeCollectionId={activeCollectionId}
                switchCollection={switchCollection}
                compactFilter={compactFilter}
                setCompactFilter={setCompactFilter}
                selectedIds={selectedIds}
                activeId={activeId}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSort}
                showNextAction={showNextAction}
                setShowNextAction={setShowNextAction}
                onOpenDocument={onOpenDocument}
                onSelectRow={handleSelectRow}
                searchQuery={debouncedSearch}
                onClearSearch={() => setSearchInput("")}
                onImport={handleImport}
                onImportFolder={handleImportFolder}
                onClearFilter={() => setCompactFilter("all")}
                onUpdate={updateDocument}
                onOpenPopup={(doc) => void priorityPopup.open([doc.id], [doc])}
                onContextMenu={(doc, event) =>
                  setListCtxDoc({ doc, pos: { x: event.clientX, y: event.clientY } })
                }
              />
            ) : sortedDocuments.length === 0 ? (
              debouncedSearch ? (
                <EmptySearch query={debouncedSearch} onClear={() => setSearchInput("")} />
              ) : (
                <EmptyDocuments onImport={handleImport} onImportFolder={handleImportFolder} />
              )
            ) : mode === "list" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground px-3">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => handleSort("priority")}
                      className="hover:text-foreground"
                    >
                      {t("documentsView.sortPriority")}
                    </button>
                    <button onClick={() => handleSort("title")} className="hover:text-foreground">
                      {t("documentsView.sortTitle")}
                    </button>
                    <button onClick={() => handleSort("added")} className="hover:text-foreground">
                      {t("documentsView.sortAdded")}
                    </button>
                    <button onClick={() => handleSort("type")} className="hover:text-foreground">
                      {t("documentsView.sortType")}
                    </button>
                    <button
                      onClick={() => handleSort("extracts")}
                      className="hover:text-foreground"
                    >
                      {t("documentsView.sortExtracts")}
                    </button>
                    <button onClick={() => handleSort("cards")} className="hover:text-foreground">
                      {t("documentsView.sortCards")}
                    </button>
                    <button
                      onClick={() => handleSort("lastTouched")}
                      className="hover:text-foreground"
                    >
                      {t("documentsView.sortLastTouched")}
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showNextAction}
                      onChange={(event) => setShowNextAction(event.target.checked)}
                    />
                    {t("documentsView.nextAction")}
                  </label>
                </div>

                <div className="space-y-2">
                  {sortedDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={(event) => {
                        if (isMobile) {
                          onOpenDocument?.(doc);
                          return;
                        }
                        handleSelectRow(doc, {
                          shiftKey: event.shiftKey,
                          toggleKey: event.metaKey || event.ctrlKey,
                        });
                        if (event.detail > 1) {
                          onOpenDocument?.(doc);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setListCtxDoc({ doc, pos: { x: e.clientX, y: e.clientY } });
                      }}
                      onTouchStart={(e) => { longPressDocRef.current = doc; docLongPress.onTouchStart(e); }}
                      onTouchMove={docLongPress.onTouchMove}
                      onTouchEnd={docLongPress.onTouchEnd}
                      onTouchCancel={docLongPress.onTouchCancel}
                      className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                        selectedIds.has(doc.id)
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(doc.id)}
                          onChange={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSelectRow(doc, { checkbox: true, shiftKey: event.shiftKey });
                          }}
                          aria-label={`Select ${doc.title}`}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <PriorityBadge doc={doc} />
                              <div className="min-w-0">
                                <div className="font-semibold text-foreground truncate">
                                  {doc.title}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {getPriorityReason(doc)}
                                </div>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatRelativeTime(getLastTouched(doc))}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="px-2 py-0.5 rounded bg-muted/60 text-muted-foreground">
                              {doc.fileType}
                            </span>
                            <DocumentFileSyncBadge doc={doc} />
                            {(doc.fileType === 'audio' || doc.fileType === 'video') && (() => {
                              const store = useTranscriptionQueueStore.getState();
                              const entry = store.getEntryForDocument(doc.id);
                              if (!entry || entry.status === 'completed') return null;
                              const progress = entry.status === 'processing' ? store.activeProgress : 0;
                              const isPreparing = entry.status === 'processing' && store.activePhase === 'preparing';
                              return (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                  entry.status === 'processing' ? 'bg-blue-500/20 text-blue-600' :
                                  entry.status === 'failed' ? 'bg-red-500/20 text-red-600' :
                                  'bg-amber-500/20 text-amber-600'
                                }`}>
                                  {isPreparing ? '⏳ Preparing...' :
                                   entry.status === 'processing' ? `⏳ ${progress}%` :
                                   entry.status === 'failed' ? '✗ Failed' :
                                   '⏎ Pending'}
                                </span>
                              );
                            })()}
                            <ProgressBar doc={doc} />
                            {showNextAction && (
                              <span className="px-2 py-0.5 rounded bg-primary/10 text-primary">
                                {getNextAction(doc)}
                              </span>
                            )}
                            <TagsInline tags={doc.tags} />
                          </div>
                          {isMobile && (
                            <div className="mt-3">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenDocument?.(doc);
                                }}
                                className="px-3 py-2 bg-primary text-primary-foreground rounded text-xs mobile-density-tap"
                              >
                                {t("documentsView.openRead")}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <LibraryDashboard
                documents={sortedDocuments}
                filteredDocuments={filteredDocuments}
                selectedFileType={selectedFileType}
                setSelectedFileType={setSelectedFileType}
                selectedIds={selectedIds}
                onOpenDocument={onOpenDocument}
                onSelectRow={handleSelectRow}
                onDelete={handleDeleteDocument}
                onUpdate={updateDocument}
                onTranscribe={handleTranscribe}
                onReadAlong={onReadAlong}
                isMobile={isMobile}
                onOpenPopup={(doc) => {
                  // Selection-aware: if the right-clicked doc is part of the
                  // current selection, mass-set the whole selection; else just it.
                  const inSelection = selectedIds.has(doc.id);
                  const ids = inSelection ? Array.from(selectedIds) : [doc.id];
                  const docs = inSelection
                    ? sortedDocuments.filter((d) => selectedIds.has(d.id))
                    : [doc];
                  void priorityPopup.open(ids, docs, { forceBulk: inSelection });
                }}
              />
            )}
          </div>

          {/* List mode context menu (rendered via portal) */}
          {listCtxDoc && createPortal(
            <Fragment>
              <div className="fixed inset-0 z-[9998]" onContextMenu={(e) => { e.preventDefault(); setListCtxDoc(null); }} onClick={() => setListCtxDoc(null)} />
              <div ref={listCtxRef} className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[200px]" style={{ left: listCtxDoc.pos.x, top: listCtxDoc.pos.y }}>
                <button
                  className="flex items-center gap-2.5 w-full text-left px-3 py-1.5 text-sm hover:bg-muted text-foreground"
                  onClick={() => { setListCtxDoc(null); onOpenDocument?.(listCtxDoc.doc); }}
                >
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  Open
                </button>
                {(() => {
                  const companions = onReadAlong ? findCompanionDoc(listCtxDoc.doc, documents) : [];
                  const best = companions[0];
                  if (!best) return null;
                  const audioDoc = listCtxDoc.doc.fileType === "audio" ? listCtxDoc.doc : best.doc;
                  const epubDoc = listCtxDoc.doc.fileType === "epub" ? listCtxDoc.doc : best.doc;
                  return (
                    <button
                      className="flex items-center gap-2.5 w-full text-left px-3 py-1.5 text-sm hover:bg-muted text-foreground"
                      onClick={() => { setListCtxDoc(null); onReadAlong?.(audioDoc, epubDoc); }}
                    >
                      {listCtxDoc.doc.fileType === "audio"
                        ? <Columns className="h-3.5 w-3.5 text-blue-500" />
                        : <Headphones className="h-3.5 w-3.5 text-blue-500" />}
                      {listCtxDoc.doc.fileType === "audio"
                        ? `Read Along with ${best.doc.title}`
                        : `Listen Along with ${best.doc.title}`}
                    </button>
                  );
                })()}
                {onReadAlong && (listCtxDoc.doc.fileType === "audio" || listCtxDoc.doc.fileType === "epub") && (
                  <button
                    className="flex items-center gap-2.5 w-full text-left px-3 py-1.5 text-sm hover:bg-muted text-foreground"
                    onClick={() => { setListCtxDoc(null); setListPairPicker(listCtxDoc.doc); }}
                  >
                    <Link className="h-3.5 w-3.5 text-muted-foreground" />
                    Pair with...
                  </button>
                )}
                <button
                  className="flex items-center gap-2.5 w-full text-left px-3 py-1.5 text-sm hover:bg-muted text-foreground"
                  onClick={() => {
                    const clicked = listCtxDoc.doc;
                    setListCtxDoc(null);
                    const inSelection = selectedIds.has(clicked.id);
                    const ids = inSelection ? Array.from(selectedIds) : [clicked.id];
                    const docs = inSelection
                      ? sortedDocuments.filter((d) => selectedIds.has(d.id))
                      : [clicked];
                    void priorityPopup.open(ids, docs, { forceBulk: inSelection });
                  }}
                >
                  <Flag className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("priority.popupTitle")}
                </button>
                <button
                  className="flex items-center gap-2.5 w-full text-left px-3 py-1.5 text-sm hover:bg-muted text-foreground"
                  onClick={() => {
                    const clicked = listCtxDoc.doc;
                    setListCtxDoc(null);
                    const inSelection = selectedIds.has(clicked.id);
                    void handleBulkSuspend(inSelection ? undefined : [clicked.id]);
                  }}
                >
                  <Pause className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("documentsView.suspend")}
                </button>
                <div className="h-px bg-border my-1" />
                <button
                  className="flex items-center gap-2.5 w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                  onClick={() => { setListCtxDoc(null); handleDeleteDocument(listCtxDoc.doc); }}
                >
                  <Trash className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </Fragment>,
            document.body
          )}

          {/* List mode pair picker */}
          {listPairPicker && (() => {
            const targetType = listPairPicker.fileType === "audio" ? "epub" : "audio";
            const candidates = documents.filter(
              d => d.id !== listPairPicker.id && d.fileType === targetType && !d.isArchived
            );
            const filtered = listPairSearch
              ? candidates.filter(d => d.title.toLowerCase().includes(listPairSearch.toLowerCase()))
              : candidates;
            const typeLabel = targetType === "epub" ? "EPUB" : "audiobook";
            return createPortal(
              <Fragment>
                <div className="fixed inset-0 z-[9998]" onClick={() => { setListPairPicker(null); setListPairSearch(""); }} />
                <div className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-xl w-[320px] max-h-[400px] flex flex-col"
                  style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
                  <div className="p-3 border-b border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Pair with {typeLabel}</span>
                      <button onClick={() => { setListPairPicker(null); setListPairSearch(""); }} className="text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search..."
                      value={listPairSearch}
                      onChange={(e) => setListPairSearch(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md"
                    />
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {filtered.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No {typeLabel}s found</p>
                    ) : filtered.map(d => (
                      <button
                        key={d.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                        onClick={() => {
                          setListPairPicker(null);
                          setListPairSearch("");
                          const audioDoc = listPairPicker.fileType === "audio" ? listPairPicker : d;
                          const epubDoc = listPairPicker.fileType === "epub" ? listPairPicker : d;
                          onReadAlong?.(audioDoc, epubDoc);
                        }}
                      >
                        <BookOpen className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{d.title}</span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{d.fileType}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </Fragment>,
              document.body
            );
          })()}

          <AdaptiveInspector
            open={isInspectorOpen}
            onClose={() => setInspectorOpen(false)}
            title={t("documentsView.inspector")}
            className="documents-inspector"
          >
              {!activeDocument ? (
                <div className="text-sm text-muted-foreground">
                  {t("documentsView.selectDocumentDetails")}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">
                      {t("documentsView.sortTitle")}
                    </div>
                    <div className="text-sm font-semibold text-foreground">
                      {activeDocument.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {activeDocument.fileType}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <PriorityBadge doc={activeDocument} />
                    <span className="text-xs text-muted-foreground">
                      {getPriorityReason(activeDocument)}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div>
                      {t("documentsView.added")}: {formatRelativeTime(activeDocument.dateAdded)}
                    </div>
                    <div>
                      {t("documentsView.lastTouched")}:{" "}
                      {formatRelativeTime(getLastTouched(activeDocument))}
                    </div>
                    <div>
                      {t("documentsView.created")}:{" "}
                      {formatRelativeTime(activeDocument.metadata?.createdAt)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground mb-2">
                      {t("documentsView.readingProgress")}
                    </div>
                    <DocumentProgressIndicator doc={activeDocument} />
                    <div className="mt-3">
                      <div className="text-xs text-muted-foreground mb-2">
                        {t("documentsView.learningProgress")}
                      </div>
                      <ProgressBar doc={activeDocument} />
                      <div className="text-xs text-muted-foreground mt-2">
                        {t("documentsView.extractsCards", {
                          extracts: activeDocument.extractCount,
                          cards: activeDocument.learningItemCount,
                        })}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground mb-2">{t("graph.tags")}</div>
                    <div className="flex flex-wrap gap-2">
                      {activeDocument.tags.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {t("documentsView.noTags")}
                        </span>
                      ) : (
                        activeDocument.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-1 text-xs bg-primary/10 text-primary rounded"
                          >
                            {tag}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground mb-2">
                      {t("documentsView.actions")}
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => onOpenDocument?.(activeDocument)}
                        className="px-3 py-2 bg-primary text-primary-foreground rounded text-sm"
                      >
                        {t("documentsView.openRead")}
                      </button>
                      <button
                        onClick={() => onOpenDocument?.(activeDocument)}
                        className="px-3 py-2 bg-background border border-border rounded text-sm text-foreground"
                      >
                        {t("documentsView.extract")}
                      </button>
                      {activeDocument.extractCount === 0 && (
                        <button
                          onClick={async () => {
                            if (!segmentDocument) return;
                            await segmentDocument(activeDocument.id, activeDocument.fileType);
                          }}
                          disabled={isSegmenting}
                          className="px-3 py-2 bg-background border border-border rounded text-sm text-foreground disabled:opacity-50"
                        >
                          {isSegmenting ? "Segmenting..." : "Segment"}
                        </button>
                      )}
                      <button
                        onClick={() =>
                          updateDocument(activeDocument.id, {
                            priorityRating: (activeDocument.priorityRating ?? 0) + 1,
                            priorityScore: (activeDocument.priorityScore ?? 0) + 10,
                          })
                        }
                        className="px-3 py-2 bg-background border border-border rounded text-sm text-foreground"
                      >
                        Reprioritize
                      </button>
                      <button
                        onClick={() => updateDocument(activeDocument.id, { isArchived: true })}
                        className="px-3 py-2 bg-muted text-foreground rounded text-sm hover:bg-muted/80"
                      >
                        Archive
                      </button>
                      <button
                        onClick={() => handleDeleteDocument(activeDocument)}
                        className="px-3 py-2 bg-destructive text-destructive-foreground rounded text-sm hover:opacity-90 flex items-center justify-center gap-1"
                      >
                        <Trash className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground mb-2">
                      {t("documentsView.relatedItems")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("documentsView.noRelatedItems")}
                    </div>
                  </div>
                </div>
              )}
          </AdaptiveInspector>
        </div>

        {enableYouTubeImport && showYouTubeImport && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-lg w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <YoutubeLogo className="w-5 h-5 text-red-500" />
                  <h2 className="text-lg font-semibold text-foreground">
                    {t("documentsView.youtubeImportTitle")}
                  </h2>
                </div>
                <button
                  onClick={() => {
                    setShowYouTubeImport(false);
                    setYoutubeUrl("");
                    setYoutubeError(null);
                  }}
                  className="p-1 text-muted-foreground hover:text-foreground rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {t("documentsView.youtubeUrlLabel")}
                  </label>
                  <input
                    type="url"
                    value={youtubeUrl}
                    onChange={(event) => setYoutubeUrl(event.target.value)}
                    placeholder={t("documentsView.youtubeUrlPlaceholder")}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    disabled={youtubeLoading}
                  />
                </div>

                {youtubeError && (
                  <div className="p-3 bg-destructive/10 border border-destructive text-destructive rounded-lg text-sm">
                    {youtubeError}
                  </div>
                )}

                {ytdlpAvailable === false && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                    <div className="flex items-start gap-2">
                      <WarningCircle className="w-4 h-4 mt-0.5" />
                      <div className="text-sm">
                        <div>{t("documentsView.ytDlpMissing")}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            onClick={handleInstallYtdlp}
                            disabled={!isTauri() || ytdlpInstalling}
                            className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                          >
                            {ytdlpInstalling ? (
                              <CircleNotch className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                            {ytdlpInstalling
                              ? t("documentsView.installing")
                              : t("documentsView.installYtdlp")}
                          </button>
                          <a
                            href="https://github.com/yt-dlp/yt-dlp#installation"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline text-sm"
                          >
                            {t("documentsView.manualInstallGuide")}
                          </a>
                        </div>
                        {!isTauri() && (
                          <div className="mt-2 text-xs text-destructive/80">
                            {t("documentsView.oneClickInstallDesktop")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {ytdlpInstallMessage && (
                  <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-2 text-green-500 text-sm">
                    <Check className="w-4 h-4" />
                    <span>{ytdlpInstallMessage}</span>
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  {t("documentsView.ytdlpRequiredNote")}
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setShowYouTubeImport(false);
                      setYoutubeUrl("");
                      setYoutubeError(null);
                    }}
                    disabled={youtubeLoading}
                    className="px-4 py-2 text-muted-foreground hover:text-foreground rounded-md transition-colors"
                  >
                    {t("documentsView.cancel")}
                  </button>
                  <button
                    onClick={handleYouTubeImport}
                    disabled={youtubeLoading}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
                  >
                    {youtubeLoading ? t("documentsView.importing") : t("documentsView.import")}
                    <Link className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showAnnaArchiveSearch && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-lg w-full max-w-4xl max-h-[90vh] overflow-auto">
              <AnnaArchiveSearch
                onImportComplete={async (path) => {
                  // After download, trigger document import from the downloaded path
                  try {
                    const imported = await importFromFiles([path]);
                    if (onOpenDocument && imported.length > 0) {
                      onOpenDocument(imported[0]);
                    }
                  } catch (error) {
                    console.error("Failed to import downloaded book:", error);
                  }
                  setShowAnnaArchiveSearch(false);
                }}
                onClose={() => setShowAnnaArchiveSearch(false)}
              />
            </div>
          </div>
        )}

        {/* ArXiv Import Dialog */}
        <ArxivImportDialog
          isOpen={showArxivImport}
          onClose={() => setShowArxivImport(false)}
          onOpenDocument={onOpenDocument}
        />

        {/* Web Article Import Dialog */}
        <WebArticleImportDialog
          isOpen={showWebArticleImport}
          onClose={() => setShowWebArticleImport(false)}
          onOpenDocument={onOpenDocument}
        />

        {/* Audiobook Import Dialog */}
        <AudiobookImportDialog
          isOpen={showAudiobookImport}
          onClose={() => setShowAudiobookImport(false)}
          onOpenDocument={onOpenDocument}
        />

        {/* Markdown Bundle Preview */}
        {detectedBundle && (
          <MarkdownBundlePreview
            bundle={detectedBundle}
            isOpen={showMarkdownBundlePreview}
            onClose={() => {
              setShowMarkdownBundlePreview(false);
              setDetectedBundle(null);
              setBundleFiles([]);
            }}
            onImport={handleBundleImport}
          />
        )}

        {/* Confirmation Dialog for bulk operations */}
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          onClose={confirmDialog.close}
          onConfirm={confirmDialog.onConfirm}
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          details={confirmDialog.details}
          itemName={confirmDialog.itemName}
          itemCount={confirmDialog.itemCount}
        />
      </div>
    </DragDropUpload>
  );
}

function PriorityBadge({ doc }: { doc: Document }) {
  const tier = getPriorityTier(doc);
  const signal = getPrioritySignal(doc);
  const tierStyles =
    tier === "high"
      ? "bg-red-500/15 text-red-600"
      : tier === "medium"
        ? "bg-amber-500/15 text-amber-600"
        : "bg-emerald-500/15 text-emerald-600";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${tierStyles}`}>{signal}</span>
  );
}

/**
 * Adjust a document's priority (1-5 rating scale) without opening it.
 *
 * Routes through the same `update_document_priority` backend command the
 * detail inspector's own adjustment control uses, rather than reimplementing
 * the rating→score formula locally — that keeps `priorityScore` correct
 * (`calculate_document_priority_score` combines rating and slider) instead of
 * drifting from whatever local approximation a second implementation might use.
 */
function PriorityStepper({
  doc,
  onUpdate,
  onOpenPopup,
}: {
  doc: Document;
  onUpdate: (id: string, updates: Partial<Document>) => void;
  onOpenPopup?: (doc: Document) => void;
}) {
  const { t } = useI18n();
  const slider = resolveDisplaySlider(doc);
  const info = getPriorityInfo(slider);

  // When the popup is available, the whole chip opens it (single-doc set).
  // When absent (e.g. legacy callers), fall back to a +1 nudge via the API.
  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (onOpenPopup) {
      onOpenPopup(doc);
      return;
    }
    const rating = doc.priorityRating ?? 0;
    const nextRating = Math.min(5, rating + 1);
    if (nextRating === rating) return;
    const { updateDocumentPriority } = await import("../../api/documents");
    const updated = await updateDocumentPriority(doc.id, nextRating, doc.prioritySlider ?? 0);
    onUpdate(doc.id, {
      priorityRating: updated.priorityRating,
      priorityScore: updated.priorityScore,
      prioritySlider: updated.prioritySlider,
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`${t("priority.setTitle")} · ${slider}`}
      aria-label={t("priority.setTitle")}
      className="flex items-center gap-1 px-1.5 h-5 rounded text-[11px] font-medium border border-border bg-muted/40 hover:bg-muted transition-colors"
    >
      <Flag
        className="h-3 w-3"
        style={{ color: info.color }}
        fill={info.color}
      />
      <span style={{ color: info.color }}>{slider}</span>
    </button>
  );
}

function ProgressBar({ doc }: { doc: Document }) {
  const { extracts, cards, total, extractRatio, cardRatio } = getProgressSegments(doc);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-24 bg-muted/60 rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-primary/70"
          style={{ width: `${extractRatio * 100}%` }}
        />
        {total > 0 && (
          <div
            className="absolute top-0 h-full bg-foreground/30"
            style={{ width: `${cardRatio * 100}%`, left: `${extractRatio * 100}%` }}
          />
        )}
      </div>
      <span className="text-[11px] text-muted-foreground">
        {extracts} / {cards}
      </span>
    </div>
  );
}

function DocumentProgressIndicator({ doc }: { doc: Document }) {
  const { t } = useI18n();
  const progressPercent = doc.progressPercent ?? 0;
  const currentPage = doc.currentPage ?? 1;
  const totalPages = doc.totalPages ?? 0;

  // Try to get position from positionJson if available
  let positionText = "";
  let hasPosition = false;

  if ((doc as any).positionJson) {
    try {
      const positionJson = (doc as any).positionJson;
      const position = typeof positionJson === "string" ? JSON.parse(positionJson) : positionJson;
      if (position) {
        hasPosition = true;
        switch (position.type) {
          case "page":
            positionText = t("documentsView.pagePosition", { page: position.page });
            break;
          case "scroll":
            positionText = t("documentsView.percentThrough", {
              percent: Math.round(position.percent),
            });
            break;
          case "cfi":
            positionText = t("documentsView.epubLocationSaved");
            break;
          case "time": {
            const minutes = Math.floor(position.seconds / 60);
            const seconds = Math.floor(position.seconds % 60);
            const secondsPadded = seconds.toString().padStart(2, "0");
            positionText = t("documentsView.videoPosition", { minutes, seconds: secondsPadded });
            break;
          }
          default:
            positionText = t("documentsView.positionSaved");
        }
      }
    } catch {
      // Failed to parse position, fall back to legacy fields
    }
  }

  // Legacy fallback if no positionJson found
  if (!hasPosition) {
    if (totalPages > 0) {
      positionText = t("documentsView.pageOfTotal", { current: currentPage, total: totalPages });
    } else if (progressPercent > 0) {
      positionText = t("documentsView.percentThrough", { percent: Math.round(progressPercent) });
    } else {
      positionText = t("documentsView.notStarted");
    }
  }

  const displayProgress =
    progressPercent > 0
      ? progressPercent
      : totalPages > 0
        ? ((currentPage - 1) / totalPages) * 100
        : 0;

  return (
    <div className="space-y-2">
      {/* Progress bar with percentage */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, displayProgress))}%` }}
          />
        </div>
        <span className="text-xs font-medium text-foreground min-w-[40px] text-right">
          {Math.round(displayProgress)}%
        </span>
      </div>

      {/* Position text */}
      <div className="text-xs text-muted-foreground">{positionText}</div>

      {/* Additional status indicators */}
      <div className="flex items-center gap-2 mt-2">
        {displayProgress > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 text-[10px] font-medium">
            {t("documentsView.readingStatus")}
          </span>
        )}
        {doc.dateLastReviewed && (
          <span className="text-[10px] text-muted-foreground">
            {t("documentsView.lastReviewed", { time: formatRelativeTime(doc.dateLastReviewed) })}
          </span>
        )}
      </div>
    </div>
  );
}

interface CompactLibraryViewProps {
  documents: Document[];
  sortedDocuments: Document[];
  collections: Collection[];
  activeCollectionId?: string | null;
  switchCollection?: (id: string) => Promise<void> | void;
  compactFilter: CompactDocumentFilter;
  setCompactFilter: (filter: CompactDocumentFilter) => void;
  selectedIds: Set<string>;
  activeId: string | null;
  sortKey: DocumentSortKey;
  sortDirection: DocumentSortDirection;
  onSort: (key: DocumentSortKey) => void;
  showNextAction: boolean;
  setShowNextAction: (show: boolean) => void;
  onOpenDocument?: (doc: Document) => void;
  onSelectRow: (doc: Document, modifiers?: DocumentSelectionModifiers) => void;
  searchQuery: string;
  onClearSearch: () => void;
  onImport: () => void;
  onImportFolder: () => void;
  onClearFilter: () => void;
  onUpdate: (id: string, updates: Partial<Document>) => void;
  onOpenPopup?: (doc: Document) => void;
  onContextMenu?: (doc: Document, event: React.MouseEvent) => void;
}

function CompactLibraryView({
  documents,
  sortedDocuments,
  collections,
  activeCollectionId,
  switchCollection,
  compactFilter,
  onUpdate,
  setCompactFilter,
  selectedIds,
  activeId,
  sortKey,
  sortDirection,
  onSort,
  showNextAction,
  setShowNextAction,
  onOpenDocument,
  onSelectRow,
  searchQuery,
  onClearSearch,
  onImport,
  onImportFolder,
  onClearFilter,
  onOpenPopup,
  onContextMenu,
}: CompactLibraryViewProps) {
  const { t } = useI18n();
  const now = Date.now();
  const recentCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const filterCounts: Record<CompactDocumentFilter, number> = {
    all: documents.length,
    priority: documents.filter((doc) => !doc.isArchived && getPriorityTier(doc) === "high").length,
    recent: documents.filter((doc) => new Date(doc.dateAdded).getTime() >= recentCutoff).length,
    active: documents.filter(
      (doc) => (doc.progressPercent ?? 0) > 0 || doc.extractCount > 0 || doc.learningItemCount > 0
    ).length,
    parked: documents.filter((doc) => doc.isArchived || getPriorityTier(doc) === "low").length,
    highlights: documents.filter((doc) => doc.extractCount > 0).length,
    cards: documents.filter((doc) => doc.learningItemCount > 0).length,
  };

  const filters: Array<{
    id: CompactDocumentFilter;
    label: string;
    icon: React.ElementType;
  }> = [
    { id: "all", label: t("documentsView.allDocuments"), icon: Stack },
    { id: "priority", label: t("documentsView.inPriorityQueue"), icon: Sparkle },
    { id: "recent", label: t("documentsView.recentlyImported"), icon: Clock },
    { id: "active", label: t("documentsView.activeReading"), icon: BookOpen },
    { id: "parked", label: t("documentsView.parked"), icon: FolderOpen },
  ];

  const secondaryFilters: Array<{
    id: CompactDocumentFilter;
    label: string;
    icon: React.ElementType;
  }> = [
    { id: "highlights", label: t("documentsView.hasHighlights"), icon: Sparkle },
    { id: "cards", label: t("documentsView.hasCards"), icon: TextT },
  ];
  const activeFilterLabel = filters.concat(secondaryFilters).find((filter) => filter.id === compactFilter)?.label ?? filters[0].label;

  return (
    <div className="flex min-h-full gap-4 pb-4">
      <aside className="hidden w-[188px] shrink-0 flex-col border-r border-border/70 pr-4 lg:flex">
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            {t("documentsView.library")}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {documents.length}
          </span>
        </div>

        <nav className="space-y-1" aria-label={t("documentsView.libraryFilters")}>
          {filters.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setCompactFilter(id)}
              aria-current={compactFilter === id ? "page" : undefined}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                compactFilter === id
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" weight={compactFilter === id ? "fill" : "regular"} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="font-mono text-[10px] tabular-nums opacity-70">{filterCounts[id]}</span>
            </button>
          ))}
        </nav>

        <div className="my-4 h-px bg-border/70" />

        <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t("documentsView.collections")}
        </div>
        <div className="space-y-1">
          {collections.slice(0, 6).map((collection) => {
            const collectionCount = documents.filter((doc) => doc.collectionId === collection.id).length;
            const isActive = activeCollectionId === collection.id;
            return (
              <button
                key={collection.id}
                type="button"
                disabled={!switchCollection}
                onClick={() => void switchCollection?.(collection.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                <span className="font-mono text-[10px] tabular-nums opacity-70">{collectionCount}</span>
              </button>
            );
          })}
          {collections.length === 0 && (
            <span className="block px-2 text-xs text-muted-foreground">{t("documentsView.noCollections")}</span>
          )}
        </div>

        <div className="my-4 h-px bg-border/70" />

        <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t("documentsView.signals")}
        </div>
        <div className="space-y-1">
          {secondaryFilters.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setCompactFilter(id)}
              aria-current={compactFilter === id ? "page" : undefined}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                compactFilter === id
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="font-mono text-[10px] tabular-nums opacity-70">{filterCounts[id]}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{activeFilterLabel}</span>
            <span className="mx-1.5 text-border">·</span>
            {t("documentsView.showingDocuments", { shown: sortedDocuments.length, total: documents.length })}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showNextAction}
                onChange={(event) => setShowNextAction(event.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              {t("documentsView.nextAction")}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{t("documentsView.sortBy")}</span>
              <select
                value={sortKey}
                onChange={(event) => onSort(event.target.value as DocumentSortKey)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="priority">{t("documentsView.sortPriority")}</option>
                <option value="lastTouched">{t("documentsView.sortLastTouched")}</option>
                <option value="added">{t("documentsView.sortAdded")}</option>
                <option value="title">{t("documentsView.sortTitle")}</option>
                <option value="extracts">{t("documentsView.sortExtracts")}</option>
                <option value="cards">{t("documentsView.sortCards")}</option>
              </select>
              <span className="font-mono text-[10px]" aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
            </label>
          </div>
        </div>

        <div className="mb-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none lg:hidden">
          {filters.concat(secondaryFilters).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setCompactFilter(id)}
              aria-current={compactFilter === id ? "page" : undefined}
              className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                compactFilter === id
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {label} <span className="ml-1 font-mono text-[10px] opacity-70">{filterCounts[id]}</span>
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card/70">
          {sortedDocuments.length > 0 ? (
            <>
              <div className="hidden grid-cols-[minmax(220px,2.2fr)_minmax(130px,1fr)_64px_64px_92px_54px_78px] items-center gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid">
                <span className="text-left">{t("documentsView.sortTitle")}</span>
                <span className="text-left">{t("documentsView.readingProgress")}</span>
                <span>{t("documentsView.sortExtracts")}</span>
                <span>{t("documentsView.sortCards")}</span>
                <span>{t("documentsView.sortLastTouched")}</span>
                <span>{t("documentsView.sortPriority")}</span>
                <span className="text-right">{t("documentsView.actions")}</span>
              </div>

              <div className="divide-y divide-border/70">
                {sortedDocuments.map((doc) => (
                  <CompactDocumentRow
                    key={doc.id}
                    doc={doc}
                    selected={selectedIds.has(doc.id)}
                    active={activeId === doc.id}
                    showNextAction={showNextAction}
                    onSelect={(modifiers) => onSelectRow(doc, modifiers)}
                    onOpen={() => onOpenDocument?.(doc)}
                    onUpdate={onUpdate}
                    onOpenPopup={onOpenPopup}
                    onContextMenu={onContextMenu ? (e) => onContextMenu(doc, e) : undefined}
                  />
                ))}
              </div>
            </>
          ) : (
            <CompactLibraryEmptyState
              hasDocuments={documents.length > 0}
              searchQuery={searchQuery}
              onClearSearch={onClearSearch}
              onImport={onImport}
              onImportFolder={onImportFolder}
              onClearFilter={onClearFilter}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function CompactLibraryEmptyState({
  hasDocuments,
  searchQuery,
  onClearSearch,
  onImport,
  onImportFolder,
  onClearFilter,
}: {
  hasDocuments: boolean;
  searchQuery: string;
  onClearSearch: () => void;
  onImport: () => void;
  onImportFolder: () => void;
  onClearFilter: () => void;
}) {
  const { t } = useI18n();

  if (searchQuery) {
    return <EmptySearch query={searchQuery} onClear={onClearSearch} />;
  }

  if (!hasDocuments) {
    return <EmptyDocuments onImport={onImport} onImportFolder={onImportFolder} />;
  }

  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Funnel className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{t("documentsView.noDocumentsInView")}</h3>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {t("documentsView.noDocumentsInViewDesc")}
      </p>
      <button
        type="button"
        onClick={onClearFilter}
        className="mt-4 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        {t("documentsView.showAllDocuments")}
      </button>
    </div>
  );
}

function CompactDocumentRow({
  doc,
  selected,
  active,
  showNextAction,
  onSelect,
  onOpen,
  onUpdate,
  onOpenPopup,
  onContextMenu,
}: {
  doc: Document;
  selected: boolean;
  active: boolean;
  showNextAction: boolean;
  onSelect: (modifiers?: DocumentSelectionModifiers) => void;
  onOpen: () => void;
  onUpdate: (id: string, updates: Partial<Document>) => void;
  onOpenPopup?: (doc: Document) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const { t } = useI18n();
  const coverUrl = getDocumentCoverUrl(doc);
  const CoverIcon = getCoverFallbackIcon(doc.fileType);
  const progress = Math.max(
    0,
    Math.min(100, doc.progressPercent ?? doc.currentScrollPercent ?? (doc.totalPages ? ((doc.currentPage ?? 1) / doc.totalPages) * 100 : 0))
  );
  const positionLabel = doc.totalPages
    ? `${doc.currentPage ?? 1} / ${doc.totalPages}`
    : progress > 0
      ? `${Math.round(progress)}%`
      : t("documentsView.notStarted");
  const sourceLabel = doc.metadata?.author || doc.metadata?.siteName || doc.metadata?.source || doc.category || doc.fileType;
  const typeStyles: Record<string, string> = {
    pdf: "bg-red-500/15 text-red-500",
    epub: "bg-blue-500/15 text-blue-500",
    youtube: "bg-red-600/15 text-red-500",
    audio: "bg-amber-500/15 text-amber-500",
    video: "bg-violet-500/15 text-violet-500",
    markdown: "bg-emerald-500/15 text-emerald-500",
    html: "bg-cyan-500/15 text-cyan-500",
    other: "bg-muted text-muted-foreground",
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") onOpen();
    if (event.key === " ") {
      event.preventDefault();
      onSelect({
        shiftKey: event.shiftKey,
        toggleKey: event.metaKey || event.ctrlKey,
      });
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu?.(event);
      }}
      onClick={(event) => {
        onSelect({
          shiftKey: event.shiftKey,
          toggleKey: event.metaKey || event.ctrlKey,
        });
        if (event.detail > 1) onOpen();
      }}
      onKeyDown={handleKeyDown}
      className={`group cursor-pointer px-3 py-3 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/60 ${
        selected || active ? "bg-primary/5" : "hover:bg-muted/40"
      }`}
    >
      <div className="flex items-start gap-2.5 lg:hidden">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect({ checkbox: true, shiftKey: event.shiftKey });
          }}
          aria-label={`Select ${doc.title}`}
          className="mt-1 rounded border-border text-primary focus:ring-primary"
        />
        <CompactDocumentTile doc={doc} coverUrl={coverUrl} CoverIcon={CoverIcon} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">{doc.title}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{sourceLabel}</div>
            </div>
            <PriorityStepper doc={doc} onUpdate={onUpdate} onOpenPopup={onOpenPopup} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/80 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{positionLabel}</span>
            <span>{doc.extractCount} {t("documentsView.extractsShort")}</span>
            <span>{doc.learningItemCount} {t("documentsView.cardsShort")}</span>
            <span>{formatRelativeTime(getLastTouched(doc))}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <TagsInline tags={doc.tags} />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              className="shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground opacity-100 transition-opacity hover:opacity-90 focus:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
            >
              {t("documentsView.openRead")}
            </button>
          </div>
          {showNextAction && (
            <div className="mt-2 text-[11px] font-medium text-primary">{getNextAction(doc)}</div>
          )}
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(220px,2.2fr)_minmax(130px,1fr)_64px_64px_92px_54px_78px] items-center gap-3 lg:grid">
        <div className="flex min-w-0 items-center gap-2.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect({ checkbox: true, shiftKey: event.shiftKey });
            }}
            aria-label={`Select ${doc.title}`}
            className="rounded border-border text-primary focus:ring-primary"
          />
          <CompactDocumentTile doc={doc} coverUrl={coverUrl} CoverIcon={CoverIcon} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{doc.title}</span>
              {doc.isFavorite && <Sparkle className="h-3.5 w-3.5 shrink-0 text-amber-500" weight="fill" />}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{sourceLabel}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${typeStyles[doc.fileType] ?? typeStyles.other}`}>
                {doc.fileType}
              </span>
            </div>
            <div className="mt-1 truncate text-[10px] text-muted-foreground">{doc.tags.slice(0, 3).join(" · ") || t("documentsView.noTags")}</div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/80" style={{ width: `${progress}%` }} />
            </div>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
          </div>
          <div className="mt-1 truncate text-[10px] text-muted-foreground">{positionLabel}</div>
        </div>

        <span className="font-mono text-xs tabular-nums text-muted-foreground">{doc.extractCount}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{doc.learningItemCount}</span>
        <span className="truncate text-[11px] text-muted-foreground">{formatRelativeTime(getLastTouched(doc))}</span>
        <PriorityStepper doc={doc} onUpdate={onUpdate} onOpenPopup={onOpenPopup} />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="justify-self-end rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-medium text-foreground opacity-0 transition-opacity hover:bg-muted focus:opacity-100 group-hover:opacity-100"
        >
          {t("documentsView.open")}
        </button>
      </div>
    </div>
  );
}

function CompactDocumentTile({
  doc,
  coverUrl,
  CoverIcon,
}: {
  doc: Document;
  coverUrl: string | null;
  CoverIcon: React.ElementType;
}) {
  return (
    <div className="relative h-11 w-8 shrink-0 overflow-hidden rounded border border-border bg-muted/60">
      {coverUrl ? (
        <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className={`flex h-full w-full items-center justify-center ${coverFallbackGradient(doc.fileType)}`}>
          <CoverIcon className="h-4 w-4 text-foreground/70" />
        </div>
      )}
    </div>
  );
}

function TagsInline({ tags }: { tags: string[] }) {
  const { t } = useI18n();
  if (!tags || tags.length === 0) {
    return <span className="text-xs text-muted-foreground">{t("documentsView.noTags")}</span>;
  }
  const visible = tags.slice(0, MAX_VISIBLE_TAGS);
  const remaining = tags.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tag) => (
        <span key={tag} className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">
          {tag}
        </span>
      ))}
      {remaining > 0 && (
        <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">
          +{remaining}
        </span>
      )}
    </div>
  );
}

/*
 * LibraryDashboard — the redesigned grid view with stats, filter chips,
 * and horizontal card rows for "Continue Where You Left Off" & "Recently Added".
 */
interface LibraryDashboardProps {
  documents: Document[];
  filteredDocuments: Document[];
  selectedFileType: string;
  setSelectedFileType: (type: string) => void;
  selectedIds: Set<string>;
  onOpenDocument?: (doc: Document) => void;
  onSelectRow: (doc: Document, modifiers?: DocumentSelectionModifiers) => void;
  onDelete: (doc: Document) => void;
  onUpdate: (id: string, updates: Partial<Document>) => void;
  onTranscribe?: (doc: Document) => void;
  onReadAlong?: (audioDoc: Document, epubDoc: Document) => void;
  onOpenPopup?: (doc: Document) => void;
  isMobile: boolean;
}

function LibraryDashboard({
  documents,
  filteredDocuments,
  selectedFileType,
  setSelectedFileType,
  selectedIds,
  onOpenDocument,
  onSelectRow,
  onDelete,
  onUpdate,
  onTranscribe,
  onReadAlong,
  onOpenPopup,
  isMobile,
}: LibraryDashboardProps) {
  const rowRef1 = useRef<HTMLDivElement>(null);
  const rowRef2 = useRef<HTMLDivElement>(null);

  // Stats
  const totalItems = documents.length;
  const inProgress = documents.filter(
    (d) => (d.progressPercent ?? 0) > 0 || d.extractCount > 0 || d.learningItemCount > 0
  ).length;
  const unprocessed = documents.filter(
    (d) => d.extractCount === 0 && d.learningItemCount === 0 && (d.progressPercent ?? 0) === 0
  ).length;
  const highlights = documents.reduce((sum, d) => sum + d.extractCount, 0);
  const readyToReview = documents.filter((d) => d.learningItemCount > 0).length;

  // Sections
  const continueDocs = useMemo(
    () =>
      filteredDocuments
        .filter((d) => (d.progressPercent ?? 0) > 0 || d.extractCount > 0)
        .sort((a, b) => {
          const timeDiff = new Date(getLastTouched(b)).getTime() - new Date(getLastTouched(a)).getTime();
          if (timeDiff !== 0) return timeDiff;
          // Stable secondary sort by ID to prevent layout thrashing
          return a.id.localeCompare(b.id);
        })
        .slice(0, 12),
    [filteredDocuments]
  );

  const recentDocs = useMemo(
    () =>
      [...filteredDocuments]
        .sort((a, b) => {
          const timeDiff = new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.id.localeCompare(b.id);
        })
        .slice(0, 12),
    [filteredDocuments]
  );

  // Funnel chips
  const allTypes = useMemo(() => {
    const types = new Set(documents.map((d) => d.fileType));
    return Array.from(types).sort();
  }, [documents]);

  const scrollRow = (ref: React.RefObject<HTMLDivElement | null>, dir: "left" | "right") => {
    if (!ref.current) return;
    ref.current.scrollBy({ left: dir === "left" ? -320 : 320, behavior: "smooth" });
  };

  const stats = [
    { label: "Total Items", value: totalItems, icon: <Stack className="w-4 h-4" /> },
    { label: "In Progress", value: inProgress, icon: <CircleNotch className="w-4 h-4" /> },
    { label: "Unprocessed", value: unprocessed, icon: <TextT className="w-4 h-4" /> },
    { label: "Highlights", value: highlights, icon: <Sparkle className="w-4 h-4" /> },
    { label: "Ready to Review", value: readyToReview, icon: <BookOpen className="w-4 h-4" /> },
  ];

  const statColors = ["text-foreground", "text-blue-500", "text-amber-500", "text-emerald-500", "text-purple-500"];

  return (
    <div {...tourAnchor("documentsGrid")} className="space-y-5 pb-4">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="bg-card border border-border rounded-xl p-3 flex items-center gap-3"
          >
            <div className={"p-2 rounded-lg bg-muted/60 text-muted-foreground"}>
              {s.icon}
            </div>
            <div className="flex flex-col">
              <span className={`text-xl font-bold ${statColors[i]}`}>{s.value}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Funnel Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setSelectedFileType("all")}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            selectedFileType === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          All
        </button>
        {allTypes.map((type) => (
          <button
            key={type}
            onClick={() => setSelectedFileType(type)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              selectedFileType === type
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Continue Where You Left Off */}
      <HorizontalSection
        title="Continue Where You Left Off"
        docs={continueDocs}
        selectedIds={selectedIds}
        onOpenDocument={onOpenDocument}
        onSelectRow={onSelectRow}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onTranscribe={onTranscribe}
        onReadAlong={onReadAlong}
        onOpenPopup={onOpenPopup}
        isMobile={isMobile}
        scrollRef={rowRef1}
        onScrollLeft={() => scrollRow(rowRef1, "left")}
        onScrollRight={() => scrollRow(rowRef1, "right")}
      />

      {/* Recently Added */}
      <HorizontalSection
        title="Recently Added"
        docs={recentDocs}
        selectedIds={selectedIds}
        onOpenDocument={onOpenDocument}
        onSelectRow={onSelectRow}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onTranscribe={onTranscribe}
        onReadAlong={onReadAlong}
        onOpenPopup={onOpenPopup}
        isMobile={isMobile}
        scrollRef={rowRef2}
        onScrollLeft={() => scrollRow(rowRef2, "left")}
        onScrollRight={() => scrollRow(rowRef2, "right")}
      />
    </div>
  );
}

/* Horizontal card row */
interface HorizontalSectionProps {
  title: string;
  docs: Document[];
  selectedIds: Set<string>;
  onOpenDocument?: (doc: Document) => void;
  onSelectRow: (doc: Document, modifiers?: DocumentSelectionModifiers) => void;
  onDelete: (doc: Document) => void;
  onUpdate: (id: string, updates: Partial<Document>) => void;
  onTranscribe?: (doc: Document) => void;
  onReadAlong?: (audioDoc: Document, epubDoc: Document) => void;
  onOpenPopup?: (doc: Document) => void;
  isMobile: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScrollLeft: () => void;
  onScrollRight: () => void;
}

function HorizontalSection({
  title,
  docs,
  selectedIds,
  onOpenDocument,
  onSelectRow,
  onDelete,
  onUpdate,
  onTranscribe,
  onReadAlong,
  onOpenPopup,
  isMobile,
  scrollRef,
  onScrollLeft,
  onScrollRight,
}: HorizontalSectionProps) {
  // Convert vertical wheel scrolling to horizontal scroll
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    // Only hijack vertical scrolls; let horizontal scroll-through work normally.
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      e.currentTarget.scrollLeft += e.deltaY;
    }
  }, []);

  if (docs.length === 0) return null;
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onScrollLeft}
            className="p-1.5 rounded-md bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <CaretLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onScrollRight}
            className="p-1.5 rounded-md bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <CaretRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory"
      >
        {docs.map((doc) => (
          <LibraryCard
            key={doc.id}
            doc={doc}
            selected={selectedIds.has(doc.id)}
            onSelect={(modifiers) => onSelectRow(doc, modifiers)}
            onOpen={() => onOpenDocument?.(doc)}
            onDelete={onDelete}
            onUpdate={onUpdate}
            onTranscribe={onTranscribe ? () => onTranscribe(doc) : undefined}
            onReadAlong={onReadAlong}
            onOpenPopup={onOpenPopup ? () => onOpenPopup(doc) : undefined}
            isMobile={isMobile}
          />
        ))}
      </div>
    </section>
  );
}

/* Wider horizontal document card with right-click context menu */
function LibraryCard({
  doc,
  selected,
  onSelect,
  onOpen,
  onDelete,
  onUpdate,
  onTranscribe,
  onReadAlong,
  onOpenPopup,
  isMobile,
}: {
  doc: Document;
  selected: boolean;
  onSelect: (modifiers?: DocumentSelectionModifiers) => void;
  onOpen: () => void;
  onDelete: (doc: Document) => void;
  onUpdate: (id: string, updates: Partial<Document>) => void;
  onTranscribe?: () => void;
  onReadAlong?: (audioDoc: Document, epubDoc: Document) => void;
  onOpenPopup?: () => void;
  isMobile: boolean;
}) {
  const modal = useModal();
  const { t } = useI18n();
  const coverUrl = getDocumentCoverUrl(doc);
  const CoverIcon = getCoverFallbackIcon(doc.fileType);
  const progress = doc.progressPercent ?? 0;
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const [showPairPicker, setShowPairPicker] = useState(false);
  const [pairSearch, setPairSearch] = useState("");
  // Long-press (touch-hold) opens the same context menu as right-click.
  const cardLongPress = useLongPress((pos) => setCtxPos(pos));

  const typeColors: Record<string, string> = {
    pdf: "bg-red-500/15 text-red-400",
    epub: "bg-blue-500/15 text-blue-400",
    youtube: "bg-red-600/15 text-red-500",
    audio: "bg-amber-500/15 text-amber-400",
    video: "bg-violet-500/15 text-violet-400",
    markdown: "bg-emerald-500/15 text-emerald-400",
    html: "bg-cyan-500/15 text-cyan-400",
    other: "bg-muted text-muted-foreground",
  };
  const typeColor = typeColors[doc.fileType] ?? typeColors.other;

  // Close context menu on click outside (but not on the menu itself)
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ctxPos) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxPos(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxPos]);

  const menuItems: Array<{
    label: string;
    icon: React.ReactNode;
    color?: string;
    divider?: boolean;
    action: () => void;
  }> = useMemo(() => {
    const allDocs = useDocumentStore.getState().documents;
    const companions = onReadAlong ? findCompanionDoc(doc, allDocs) : [];
    const bestCompanion = companions[0] ?? null;

    return [
    {
      label: "Open",
      icon: <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />,
      action: () => onOpen(),
    },
    ...(bestCompanion ? [{
      label: doc.fileType === "audio"
        ? `Read Along with ${bestCompanion.doc.title}`
        : `Listen Along with ${bestCompanion.doc.title}`,
      icon: doc.fileType === "audio"
        ? <Columns className="h-3.5 w-3.5 text-blue-500" />
        : <Headphones className="h-3.5 w-3.5 text-blue-500" />,
      action: () => {
        const audioDoc = doc.fileType === "audio" ? doc : bestCompanion.doc;
        const epubDoc = doc.fileType === "epub" ? doc : bestCompanion.doc;
        onReadAlong?.(audioDoc, epubDoc);
      },
    } as { label: string; icon: React.ReactNode; color?: string; divider?: boolean; action: () => void }] : []),
    ...((doc.fileType === "audio" || doc.fileType === "epub") && onReadAlong ? [{
      label: "Pair with...",
      icon: <Link className="h-3.5 w-3.5 text-muted-foreground" />,
      action: () => { setCtxPos(null); setShowPairPicker(true); },
    } as { label: string; icon: React.ReactNode; color?: string; divider?: boolean; action: () => void }] : []),
    {
      label: doc.isFavorite ? "Remove from Favorites" : "Add to Favorites",
      icon: <Sparkle className={"h-3.5 w-3.5 " + (doc.isFavorite ? "text-amber-500" : "text-muted-foreground")} />,
      action: () => onUpdate(doc.id, { isFavorite: !doc.isFavorite }),
    },
    {
      label: "Add Tag",
      icon: <Plus className="h-3.5 w-3.5 text-muted-foreground" />,
      action: async () => {
        const tag = (await modal.prompt(t("documentsView.addTagPrompt"), "", "Add Tag"))?.trim();
        if (!tag) return;
        const next = new Set(doc.tags);
        next.add(tag);
        onUpdate(doc.id, { tags: Array.from(next) });
      },
    },
    ...(onOpenPopup ? [{
      label: t("priority.popupTitle"),
      icon: <Flag className="h-3.5 w-3.5 text-muted-foreground" />,
      action: () => onOpenPopup(),
    } as { label: string; icon: React.ReactNode; color?: string; divider?: boolean; action: () => void }] : []),
    { label: "", icon: null, divider: true, action: () => {} },
    ...(doc.fileType === "audio" || doc.fileType === "video" ? [{
      label: "Transcribe",
      icon: <Headphones className="h-3.5 w-3.5 text-blue-500" />,
      action: () => onTranscribe?.(),
    } as { label: string; icon: React.ReactNode; color?: string; divider?: boolean; action: () => void }] : []),
    { label: "", icon: null, divider: true, action: () => {} },
    {
      label: doc.isArchived ? "Unarchive" : "Archive",
      icon: <TextT className={"h-3.5 w-3.5 " + (doc.isArchived ? "text-emerald-500" : "text-muted-foreground")} />,
      action: () => onUpdate(doc.id, { isArchived: !doc.isArchived }),
    },
    { label: "", icon: null, divider: true, action: () => {} },
    {
      label: "Delete",
      icon: <Trash className="h-3.5 w-3.5" />,
      color: "text-destructive",
      action: () => onDelete(doc),
    },
  ]; }, [doc, onOpen, onDelete, onUpdate, onReadAlong, onOpenPopup, modal, t]);

  return (
    <div className="relative">
      <div
        onClick={(event) => {
          if (isMobile) { onOpen(); return; }
          onSelect({
            shiftKey: event.shiftKey,
            toggleKey: event.metaKey || event.ctrlKey,
          });
          if (event.detail > 1) onOpen();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxPos({ x: e.clientX, y: e.clientY });
        }}
        onTouchStart={cardLongPress.onTouchStart}
        onTouchMove={cardLongPress.onTouchMove}
        onTouchEnd={cardLongPress.onTouchEnd}
        onTouchCancel={cardLongPress.onTouchCancel}
        className={"snap-start flex-shrink-0 w-[280px] sm:w-[320px] rounded-xl border bg-card cursor-pointer transition-all hover:shadow-lg hover:shadow-black/10 hover:-translate-y-0.5 group " + (selected ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-border/80")}
      >
        {/* Cover */}
        <div className="relative h-[160px] sm:h-[180px] overflow-hidden rounded-t-xl bg-muted/40">
          {coverUrl ? (
            <img src={coverUrl} alt={doc.title} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center gap-2">
              <div className={"absolute inset-0 " + coverFallbackGradient(doc.fileType)} />
              <CoverIcon className="w-12 h-12 text-white/70 relative z-10" />
              <span className="text-xs font-medium text-white/50 uppercase tracking-wide relative z-10">{doc.fileType}</span>
            </div>
          )}
          <span className={"absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md text-[11px] font-semibold backdrop-blur-sm " + typeColor}>{doc.fileType}</span>
          {progress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
              <div className="h-full bg-primary/80 transition-all" style={{ width: progress + "%" }} />
            </div>
          )}
          {!isMobile && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ checkbox: true, shiftKey: e.shiftKey });
              }}
              aria-label={`Select ${doc.title}`}
              className="absolute top-2.5 right-2.5 w-4 h-4 rounded bg-background/80 backdrop-blur-sm border-border"
            />
          )}
        </div>

        {/* Info */}
        <div className="p-3 flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">{doc.title}</h3>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatRelativeTime(getLastTouched(doc))}</span>
            {doc.extractCount > 0 && <span>{doc.extractCount} highlights</span>}
            {doc.learningItemCount > 0 && <span>{doc.learningItemCount} cards</span>}
          </div>
          {(doc.extractCount > 0 || doc.learningItemCount > 0) && <ProgressBar doc={doc} />}
          {doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {doc.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="px-1.5 py-0.5 text-[10px] bg-primary/10 text-primary/80 rounded">{tag}</span>
              ))}
              {doc.tags.length > 2 && (
                <span className="px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground rounded">+{doc.tags.length - 2}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Context Menu (rendered via portal) */}
      {ctxPos && createPortal(
        <Fragment>
          <div className="fixed inset-0 z-[9998]" onContextMenu={(e) => { e.preventDefault(); setCtxPos(null); }} />
          <div ref={menuRef} className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[200px]" style={{ left: ctxPos.x, top: ctxPos.y }}>
            {menuItems.map((item, i) =>
              item.divider ? (
                <div key={i} className="h-px bg-border my-1" />
              ) : (
                <button
                  key={i}
                  onClick={() => { setCtxPos(null); item.action(); }}
                  className={"flex items-center gap-2.5 w-full text-left px-3 py-1.5 text-sm transition-colors " + (item.color ? "hover:bg-destructive/10 " + item.color : "hover:bg-muted text-foreground")}
                >
                  {item.icon}
                  {item.label}
                </button>
              )
            )}
          </div>
        </Fragment>,
        document.body
      )}

      {/* Pair Picker */}
      {showPairPicker && (() => {
        const targetType = doc.fileType === "audio" ? "epub" : "audio";
        const allDocs = useDocumentStore.getState().documents;
        const candidates = allDocs.filter(
          d => d.id !== doc.id && d.fileType === targetType && !d.isArchived
        );
        const filtered = pairSearch
          ? candidates.filter(d => d.title.toLowerCase().includes(pairSearch.toLowerCase()))
          : candidates;
        const typeLabel = targetType === "epub" ? "EPUB" : "audiobook";
        return createPortal(
          <Fragment>
            <div className="fixed inset-0 z-[9998]" onClick={() => { setShowPairPicker(false); setPairSearch(""); }} />
            <div className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-xl w-[320px] max-h-[400px] flex flex-col"
              style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
              <div className="p-3 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Pair with {typeLabel}</span>
                  <button onClick={() => { setShowPairPicker(false); setPairSearch(""); }} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <input
                  autoFocus
                  type="text"
                  placeholder="Search..."
                  value={pairSearch}
                  onChange={(e) => setPairSearch(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md"
                />
              </div>
              <div className="overflow-y-auto flex-1">
                {filtered.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No {typeLabel}s found</p>
                ) : filtered.map(d => (
                  <button
                    key={d.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                    onClick={() => {
                      setShowPairPicker(false);
                      setPairSearch("");
                      const audioDoc = doc.fileType === "audio" ? doc : d;
                      const epubDoc = doc.fileType === "epub" ? doc : d;
                      onReadAlong?.(audioDoc, epubDoc);
                    }}
                  >
                    <BookOpen className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{d.title}</span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">{d.fileType}</span>
                  </button>
                ))}
              </div>
            </div>
          </Fragment>,
          document.body
        );
      })()}
    </div>
  );
}

/**
 * Mobile Import Menu
 *
 * A compact dropdown menu for mobile devices that consolidates all import options.
 * Reduces visual clutter while keeping all functionality accessible.
 */
interface MobileImportMenuProps {
  enableYouTubeImport?: boolean;
  onYouTubeClick: () => void;
  onArxivClick: () => void;
  onWebArticleClick: () => void;
  onAudiobookClick: () => void;
  onAnnaArchiveClick: () => void;
  onFolderClick?: () => void;
}

function MobileImportMenu({
  enableYouTubeImport,
  onYouTubeClick,
  onArxivClick,
  onWebArticleClick,
  onAudiobookClick,
  onAnnaArchiveClick,
  onFolderClick,
}: MobileImportMenuProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2.5 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="More import options"
        aria-expanded={isOpen}
      >
        <DotsThree className="w-5 h-5" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-card border border-border rounded-xl shadow-lg z-50 py-1.5 animate-in fade-in slide-in-from-top-1">
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("documentsView.importFrom")}
          </div>

          {enableYouTubeImport && (
            <button
              onClick={() => handleAction(onYouTubeClick)}
              className="w-full px-3 py-2.5 flex items-center gap-3 text-sm text-foreground hover:bg-muted/60 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <YoutubeLogo className="w-4 h-4 text-red-500" />
              </div>
              <span>{t("documentsView.importYouTube")}</span>
            </button>
          )}

          <button
            onClick={() => handleAction(onArxivClick)}
            className="w-full px-3 py-2.5 flex items-center gap-3 text-sm text-foreground hover:bg-muted/60 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
              <FileTextIcon className="w-4 h-4 text-orange-500" />
            </div>
            <span>{t("documentsView.arxiv")}</span>
          </button>

          <button
            onClick={() => handleAction(onWebArticleClick)}
            className="w-full px-3 py-2.5 flex items-center gap-3 text-sm text-foreground hover:bg-muted/60 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <Globe className="w-4 h-4 text-blue-500" />
            </div>
            <span>{t("documentsView.webArticle")}</span>
          </button>

          <button
            onClick={() => handleAction(onAudiobookClick)}
            className="w-full px-3 py-2.5 flex items-center gap-3 text-sm text-foreground hover:bg-muted/60 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <Headphones className="w-4 h-4 text-amber-600" />
            </div>
            <span>{t("documentsView.audiobook")}</span>
          </button>

          {onFolderClick && isTauri() && (
            <button
              onClick={() => handleAction(onFolderClick)}
              className="w-full px-3 py-2.5 flex items-center gap-3 text-sm text-foreground hover:bg-muted/60 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <FolderOpen className="w-4 h-4 text-emerald-600" />
              </div>
              <span>{t("documentsView.importFolderMobile")}</span>
            </button>
          )}

          {(false as boolean) && isTauri() && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                onClick={() => handleAction(onAnnaArchiveClick)}
                className="w-full px-3 py-2.5 flex items-center gap-3 text-sm text-foreground hover:bg-muted/60 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-4 h-4 text-purple-500" />
                </div>
                <span>{t("documentsView.annasArchive")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Mobile Saved Views Menu
 *
 * A compact dropdown for saved views on mobile devices.
 * Consolidates view selection and save functionality.
 */
interface MobileSavedViewsMenuProps {
  savedViews: SavedView[];
  activeViewId: string | null;
  onApplyView: (viewId: string) => void;
  onSaveView: () => void;
}

function MobileSavedViewsMenu({
  savedViews,
  activeViewId,
  onApplyView,
  onSaveView,
}: MobileSavedViewsMenuProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeView = savedViews.find((v) => v.id === activeViewId);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative flex-1" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center justify-between gap-2 transition-colors min-h-[44px] ${
          activeView
            ? "bg-primary/10 text-primary border border-primary/20"
            : "bg-background border border-border text-foreground hover:bg-muted/60"
        }`}
        aria-label={t("documentsView.savedViews")}
        aria-expanded={isOpen}
      >
        <span className="truncate">{activeView?.name ?? t("documentsView.savedViews")}</span>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-card border border-border rounded-xl shadow-lg z-50 py-1.5 animate-in fade-in slide-in-from-top-1">
          <button
            onClick={() => {
              onSaveView();
              setIsOpen(false);
            }}
            className="w-full px-3 py-2.5 flex items-center gap-3 text-sm text-primary hover:bg-primary/5 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Plus className="w-4 h-4" />
            </div>
            <span className="font-medium">{t("documentsView.saveCurrentView")}</span>
          </button>

          {savedViews.length > 0 && <div className="my-1 border-t border-border" />}

          <div className="max-h-48 overflow-y-auto">
            {savedViews.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                {t("documentsView.noSavedViews")}
              </div>
            ) : (
              savedViews.map((view) => (
                <button
                  key={view.id}
                  onClick={() => {
                    onApplyView(view.id);
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 flex items-center gap-3 text-sm transition-colors ${
                    activeViewId === view.id
                      ? "bg-primary/5 text-primary"
                      : "text-foreground hover:bg-muted/60"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      activeViewId === view.id ? "bg-primary/10" : "bg-muted"
                    }`}
                  >
                    {view.compactDocumentsView ? (
                      <Columns
                        className={`w-4 h-4 ${activeViewId === view.id ? "text-primary" : "text-muted-foreground"}`}
                      />
                    ) : view.mode === "grid" ? (
                      <GridFour
                        className={`w-4 h-4 ${activeViewId === view.id ? "text-primary" : "text-muted-foreground"}`}
                      />
                    ) : (
                      <List
                        className={`w-4 h-4 ${activeViewId === view.id ? "text-primary" : "text-muted-foreground"}`}
                      />
                    )}
                  </div>
                  <span className="truncate">{view.name}</span>
                  {activeViewId === view.id && <Check className="w-4 h-4 ml-auto flex-shrink-0" />}
                </button>
              ))
            )}
          </div>

          {savedViews.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                onClick={() => {
                  onApplyView("");
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                {t("documentsView.resetToDefault")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface DocumentsViewSwitcherProps {
  mode: DocumentViewMode;
  compactDocumentsView: boolean;
  compact?: boolean;
  onModeChange: (mode: DocumentViewMode) => void;
  onCompactChange: () => void;
}

function DocumentsViewSwitcher({
  mode,
  compactDocumentsView,
  compact = false,
  onModeChange,
  onCompactChange,
}: DocumentsViewSwitcherProps) {
  const { t } = useI18n();
  const activeMode = compactDocumentsView ? "compact" : mode;
  const options = [
    {
      id: "grid" as const,
      label: t("documentsView.grid"),
      ariaLabel: t("documentsView.gridView"),
      icon: GridFour,
    },
    {
      id: "list" as const,
      label: t("documentsView.list"),
      ariaLabel: t("documentsView.listView"),
      icon: List,
    },
    {
      id: "compact" as const,
      label: t("documentsView.compact"),
      ariaLabel: t("documentsView.compactView"),
      icon: Columns,
    },
  ];

  return (
    <div
      role="group"
      aria-label={t("documentsView.viewMode")}
      className="flex items-center gap-1 rounded-lg bg-muted/40 p-1"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = activeMode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              if (option.id === "compact") {
                onCompactChange();
              } else {
                onModeChange(option.id);
              }
            }}
            aria-label={option.ariaLabel}
            aria-pressed={isActive}
            className={`flex items-center gap-1.5 rounded-md text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 ${
              compact ? "p-2" : "px-2.5 py-1.5"
            } ${
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title={option.ariaLabel}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {!compact && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
