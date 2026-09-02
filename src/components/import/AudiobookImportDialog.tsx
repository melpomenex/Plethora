/**
 * Audiobook Import Dialog
 * 
 * Import audiobooks with metadata fetching, cover art selection,
 * and transcript management options. Supports both single file and
 * batch/directory import.
 */

import { useState, useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bookmark,
  CaretLeft,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Clock,
  FolderOpen,
  Headphones,
  Image,
  List,
  MagnifyingGlass,
  Microphone,
  SkipForward,
  Sparkle,
  SpeakerHigh,
  Stack,
  TextT,
  Trash,
  Translate,
  Upload,
  User,
  Warning,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { cn } from "../../utils";
import { useDocumentStore } from "../../stores/documentStore";
import { useCollectionStore } from "../../stores/collectionStore";
import { useToast } from "../common/Toast";
import { updateDocument as updateDocumentApi, openFilePicker, importDocumentFromFileStreamed, pickFolderDocuments, pickFilesMobile } from "../../api/documents";
import {
  AudiobookMetadata,
  AudiobookChapter,
  AudiobookTranscript,
  parseAudiobookMetadata,
  searchAudiobookCover,
  extractAudioCoverArt,
  searchAudiobookMetadata,
  generateTranscript,
  importTranscriptFromFile,
  formatDuration,
  AUDIOBOOK_FORMATS,
  BatchImportResult,
  detectMultiPartAudiobook,
  MultiPartAudiobook,
  importMultipartAudiobook,
} from "../../api/audiobooks";
import { formatDisplayChapterTitle, inferDirectoryTitle } from "../../utils/audiobookMultipart";
import { planAudiobookImports } from "../../utils/audiobookImportPlanner";
import { isTauri, isNativeMobile } from "../../lib/tauri";
import { logAudiobookDiagnostic } from "../../lib/audiobookDiagnostics";
import { showTranscriptionResolutionFailure } from "../../lib/transcriptionResolutionFailure";
import { useMobileShell } from "../../hooks/useMobileShell";
import type { Document } from "../../types/document";

interface AudiobookImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDocument?: (doc: Document) => void;
}



interface BatchItem {
  id: string;
  filePath: string;
  fileName: string;
  status: "pending" | "loading" | "ready" | "error";
  metadata?: Partial<AudiobookMetadata>;
  coverOptions?: string[];
  selectedCover?: string;
  transcript?: AudiobookTranscript | null;
  error?: string;
}

export interface ChapterItem {
  id: string;
  path: string;
  fileName: string;
  title: string;
  duration?: number;
  partNumber: number;
}

type ImportMode = "single" | "batch";
type ImportStep = "select" | "metadata" | "transcript" | "confirm";

export function AudiobookImportDialog({
  isOpen,
  onClose,
  onOpenDocument,
}: AudiobookImportDialogProps) {
  const [importMode, setImportMode] = useState<ImportMode>("single");
  const [currentStep, setCurrentStep] = useState<ImportStep>("select");
  
  // Single file state
  const [filePath, setFilePath] = useState<string>("");
  const [metadata, setMetadata] = useState<Partial<AudiobookMetadata>>({});
  const [coverOptions, setCoverOptions] = useState<string[]>([]);
  const [selectedCover, setSelectedCover] = useState<string>("");
  const [chapters, setChapters] = useState<AudiobookChapter[]>([]);
  const [transcript, setTranscript] = useState<AudiobookTranscript | null>(null);
  
  // Batch import state
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  
  // Common state
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingTranscript, setIsGeneratingTranscript] = useState(false);
  const [transcriptProgress, setTranscriptProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Partial<AudiobookMetadata>[]>([]);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  
  // Multi-part book state
  const [multiPartBook, setMultiPartBook] = useState<MultiPartAudiobook | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [showAllParts, setShowAllParts] = useState(false);
  const [chaptersList, setChaptersList] = useState<ChapterItem[]>([]);

  // Audio preview state
  const audioRef = useRef<HTMLAudioElement>(null);
  const [, setIsPlaying] = useState(false);
  const [, setPreviewDuration] = useState(0);

  const { importFromFiles, loadDocuments } = useDocumentStore();
  const { success: showSuccess, error: showError, info: showInfo } = useToast();
  const isMobileShell = useMobileShell();
  const onMobile = isNativeMobile();
  // Native mobile IS Tauri, but its dialog plugin returns unreadable content://
  // URIs and there's no ffmpeg for the directory scanner — so the only platform
  // where the desktop directory/folder path is unavailable is pure browser/PWA.
  const folderImportAvailable = isTauri();
  const collectionId = useCollectionStore.getState().activeCollectionId;

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setImportMode("single");
      setCurrentStep("select");
      setFilePath("");
      setMetadata({});
      setCoverOptions([]);
      setSelectedCover("");
      setChapters([]);
      setTranscript(null);
      setBatchItems([]);
      setMultiPartBook(null);
      setSelectedFiles([]);
      setShowAllParts(false);
      setChaptersList([]);

      setError(null);
      setSearchQuery("");
      setSearchResults([]);
      setImportProgress({ current: 0, total: 0 });
      setIsPlaying(false);
      setPreviewDuration(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  const probeChapterDurations = async (items: ChapterItem[]) => {
    if (!isTauri() || onMobile) return;
    try {
      const updated = [...items];
      let totalSec = 0;
      let hasChanges = false;
      for (let i = 0; i < updated.length; i++) {
        try {
          const probed = await parseAudiobookMetadata(updated[i].path);
          if (probed.duration && probed.duration > 0) {
            updated[i] = { ...updated[i], duration: probed.duration };
            totalSec += probed.duration;
            hasChanges = true;
          }
          if (probed.title && probed.title.trim() && !updated[i].title.startsWith("Chapter ")) {
            updated[i] = { ...updated[i], title: probed.title.trim() };
            hasChanges = true;
          }
        } catch {
          // continue on probe error
        }
      }
      if (hasChanges) {
        setChaptersList([...updated]);
        if (totalSec > 0) {
          setMetadata((prev) => ({ ...prev, duration: totalSec }));
        }
      }
    } catch (err) {
      console.warn("[AudiobookImport] Failed to probe chapter durations", err);
    }
  };

  const handleChapterTitleChange = (id: string, newTitle: string) => {
    setChaptersList((prev) =>
      prev.map((ch) => (ch.id === id ? { ...ch, title: newTitle } : ch))
    );
  };

  const handleMoveChapter = (index: number, direction: "up" | "down") => {
    setChaptersList((prev) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(targetIndex, 0, moved);
      return copy.map((ch, i) => ({ ...ch, partNumber: i + 1 }));
    });
  };

  const handleRemoveChapter = (id: string) => {
    setChaptersList((prev) => {
      const filtered = prev.filter((ch) => ch.id !== id).map((ch, i) => ({ ...ch, partNumber: i + 1 }));
      const totalDur = filtered.reduce((acc, ch) => acc + (ch.duration || 0), 0);
      setMetadata((m) => ({ ...m, duration: totalDur }));
      return filtered;
    });
  };

  const handleModeToggle = async (mode: ImportMode) => {
    if (mode === importMode) return;
    if (mode === "batch") {
      setImportMode("batch");
      setCurrentStep("metadata");
      if (chaptersList.length > 0) {
        const items: BatchItem[] = chaptersList.map((ch, idx) => ({
          id: `item-${idx}`,
          filePath: ch.path,
          fileName: ch.fileName,
          status: "ready",
          metadata: {
            title: ch.title,
            author: metadata.author,
            duration: ch.duration,
          },
        }));
        setBatchItems(items);
        await loadBatchMetadata(items);
      }
    } else {
      setImportMode("single");
      setCurrentStep("metadata");
      if (batchItems.length > 0) {
        const parts = batchItems.map((b, idx) => ({
          filePath: b.filePath,
          partNumber: idx + 1,
          duration: b.metadata?.duration,
          chapterTitle: b.metadata?.title || formatDisplayChapterTitle(b.fileName, idx),
        }));
        const allPaths = batchItems.map((b) => b.filePath);
        const inferred = inferDirectoryTitle(allPaths);
        const combinedBook: MultiPartAudiobook = {
          title: metadata.title || inferred?.title || "Audiobook",
          author: metadata.author || inferred?.author,
          parts,
          totalDuration: parts.reduce((acc, p) => acc + (p.duration || 0), 0),
        };
        setMultiPartBook(combinedBook);
        setSelectedFiles(allPaths);
        const chList: ChapterItem[] = parts.map((p, idx) => ({
          id: `chapter-${idx}-${p.filePath}`,
          path: p.filePath,
          fileName: batchItems[idx]?.fileName || p.filePath.split(/[/\\]/).pop() || `Part ${idx + 1}`,
          title: p.chapterTitle || `Chapter ${idx + 1}`,
          duration: p.duration,
          partNumber: idx + 1,
        }));
        setChaptersList(chList);
        setMetadata({
          title: combinedBook.title,
          author: combinedBook.author,
          duration: combinedBook.totalDuration,
        });
      }
    }
  };

  // Handle file selection (single or multiple)
  const handleFileSelect = async () => {
    try {
      let files: string[] = [];
      let stagedItems: any[] = [];

      if (onMobile) {
        const staged = await pickFilesMobile({
          multiple: true,
          extensions: AUDIOBOOK_FORMATS,
        });
        if (!staged || staged.length === 0) return;
        files = staged.map((f) => f.path);
        stagedItems = staged;
      } else {
        const selected = await openFilePicker({
          title: "Select Audiobook Files",
          multiple: true,
          filters: [
            {
              name: "Audiobooks",
              extensions: AUDIOBOOK_FORMATS,
            },
          ],
        });
        if (!selected || selected.length === 0) return;
        files = selected;
      }

      if (files.length > 1) {
        const detectedMultiPart = detectMultiPartAudiobook(files);
        const inferred = inferDirectoryTitle(files);
        const bookTitle = detectedMultiPart?.title || inferred?.title || "Audiobook";
        const bookAuthor = detectedMultiPart?.author || inferred?.author;

        const initialChapters: ChapterItem[] = files.map((filePath, index) => {
          const fileName = onMobile && stagedItems[index]
            ? stagedItems[index].fileName
            : filePath.split(/[/\\]/).pop() || filePath;
          const detectedPart = detectedMultiPart?.parts.find((p) => p.filePath === filePath);
          return {
            id: `chapter-${index}-${filePath}`,
            path: filePath,
            fileName,
            title: detectedPart?.chapterTitle || formatDisplayChapterTitle(fileName, index),
            duration: detectedPart?.duration,
            partNumber: index + 1,
          };
        });

        setSelectedFiles(files);
        setChaptersList(initialChapters);
        setMultiPartBook(detectedMultiPart || {
          title: bookTitle,
          author: bookAuthor,
          parts: initialChapters.map((c) => ({
            filePath: c.path,
            partNumber: c.partNumber,
            chapterTitle: c.title,
          })),
          totalDuration: 0,
        });

        // Also prepare batch items in case user toggles to separate audiobooks
        const items: BatchItem[] = files.map((filePath, index) => {
          const fileName = onMobile && stagedItems[index]
            ? stagedItems[index].fileName
            : filePath.split(/[/\\]/).pop() || filePath;
          return {
            id: `item-${index}`,
            filePath,
            fileName,
            status: "pending",
          };
        });
        setBatchItems(items);

        setMetadata({
          title: bookTitle,
          author: bookAuthor,
          duration: 0,
        });

        const [embeddedCover, covers, metaResults] = await Promise.all([
          extractAudioCoverArt(files[0]),
          searchAudiobookCover(bookTitle, bookAuthor),
          searchAudiobookMetadata(bookTitle, bookAuthor),
        ]);

        const allCovers = embeddedCover ? [embeddedCover, ...covers] : covers;
        setCoverOptions(allCovers);
        setSearchResults(metaResults);
        if (allCovers.length > 0) setSelectedCover(allCovers[0]);
        if (metaResults.length > 0) {
          setMetadata((prev) => ({ ...prev, ...metaResults[0] }));
        }

        setImportMode("single");
        setCurrentStep("metadata");
        void probeChapterDurations(initialChapters);
        showSuccess("Audiobook tracks ready", `${files.length} parts combined for "${bookTitle}"`);
        return;
      }

      await loadSingleFile(files[0]);
    } catch (err) {
      console.error("[AudiobookImport] File selection error:", err);
      showError("File selection failed", "Could not open file picker");
    }
  };

  // Handle directory selection for batch/combined import. Uses the folder-import plugin
  // (pickFolderDocuments), which works on desktop AND native mobile.
  const handleDirectorySelect = async () => {
    if (!folderImportAvailable) {
      showInfo(
        "Directory import not available",
        "In the web app, please use 'Single File' mode and select multiple files to import them."
      );
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let staged: Awaited<ReturnType<typeof pickFolderDocuments>> = [];
      try {
        staged = await pickFolderDocuments(AUDIOBOOK_FORMATS);
      } catch (scanErr) {
        console.error("[AudiobookImport] Folder pick failed:", scanErr);
        showError(
          "Folder picker not available",
          "The folder import feature isn't available in this build. Please use 'Single File' mode and select multiple files instead."
        );
        setImportMode("single");
        setCurrentStep("select");
        setIsLoading(false);
        return;
      }

      if (staged.length === 0) {
        // User cancelled, or folder had no audiobook files.
        setIsLoading(false);
        return;
      }

      const audiobookFiles = staged.map((s) => s.path);

      // Semantic planning: inspect folder structure
      const plan = planAudiobookImports(staged, { rootIsPickedFolder: true });
      const detectedMultiPart = detectMultiPartAudiobook(audiobookFiles);

      // By default in the Audiobook dialog, a picked directory forms a unified audiobook
      const targetBookPlan = plan.audiobooks[0];
      const inferred = inferDirectoryTitle(audiobookFiles);
      const bookTitle = targetBookPlan?.title || detectedMultiPart?.title || inferred?.title || "Audiobook";
      const bookAuthor = targetBookPlan?.author || detectedMultiPart?.author || inferred?.author;

      const filesToUse = targetBookPlan
        ? targetBookPlan.files.map((f) => f.path)
        : audiobookFiles;

      const initialChapters: ChapterItem[] = filesToUse.map((path, idx) => {
        const stagedItem = staged.find((s) => s.path === path);
        const fileName = stagedItem?.fileName || path.split(/[/\\]/).pop() || `Part ${idx + 1}`;
        const detectedPart = detectedMultiPart?.parts.find((p) => p.filePath === path);
        return {
          id: `chapter-${idx}-${path}`,
          path,
          fileName,
          title: detectedPart?.chapterTitle || formatDisplayChapterTitle(fileName, idx),
          duration: detectedPart?.duration,
          partNumber: idx + 1,
        };
      });

      setSelectedFiles(filesToUse);
      setChaptersList(initialChapters);
      setMultiPartBook(detectedMultiPart || {
        title: bookTitle,
        author: bookAuthor,
        parts: initialChapters.map((c) => ({
          filePath: c.path,
          partNumber: c.partNumber,
          chapterTitle: c.title,
        })),
        totalDuration: 0,
      });

      // Prepare batch items in case user switches mode to separate audiobooks
      const items: BatchItem[] = staged.map((s, index) => ({
        id: `item-${index}`,
        filePath: s.path,
        fileName: s.fileName,
        status: "pending",
      }));
      setBatchItems(items);

      setMetadata({
        title: bookTitle,
        author: bookAuthor,
        duration: 0,
      });

      const [embeddedCover, covers, metaResults] = await Promise.all([
        extractAudioCoverArt(filesToUse[0]),
        searchAudiobookCover(bookTitle, bookAuthor),
        searchAudiobookMetadata(bookTitle, bookAuthor),
      ]);

      const allCovers = embeddedCover ? [embeddedCover, ...covers] : covers;
      setCoverOptions(allCovers);
      setSearchResults(metaResults);
      if (allCovers.length > 0) setSelectedCover(allCovers[0]);
      if (metaResults.length > 0) {
        setMetadata((prev) => ({ ...prev, ...metaResults[0] }));
      }

      setImportMode("single");
      setCurrentStep("metadata");
      void probeChapterDurations(initialChapters);
      showSuccess("Audiobook folder ready", `${filesToUse.length} parts combined for "${bookTitle}"`);
      return;
    } catch (err) {
      console.error("[AudiobookImport] Directory selection error:", err);
      setError(err instanceof Error ? err.message : "Failed to open directory");
      showError("Directory import failed", err instanceof Error ? err.message : "Unknown error");
      setImportMode("single");
      setCurrentStep("select");
    } finally {
      setIsLoading(false);
    }
  };

  const loadBatchMetadata = async (items: BatchItem[]) => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setImportProgress({ current: i + 1, total: items.length });
      
      try {
        setBatchItems(prev => prev.map(b =>
          b.id === item.id ? { ...b, status: "loading" } : b
        ));

        // On mobile there's no ffmpeg and (for HTML-input picks) the file isn't
        // staged yet, so derive basic metadata from the filename. For mobile
        // folder picks the staged path IS readable, but ffmpeg still isn't
        // available, so the filename path is used there too.
        let parsed: AudiobookMetadata;
        if (onMobile) {
          const nameWithoutExt = item.fileName.replace(/\.[^/.]+$/, "");
          const parts = nameWithoutExt.split(" - ");
          const title = parts.length >= 2 ? parts.slice(1).join(" - ").trim() : nameWithoutExt;
          const author = parts.length >= 2 ? parts[0].trim() : undefined;
          parsed = {
            title,
            author,
            duration: 0,
            chapters: [{ id: 1, title: "Chapter 1", startTime: 0 }],
          };
        } else {
          parsed = await parseAudiobookMetadata(item.filePath);
        }

        // Extract embedded cover and search for online covers in parallel.
        // Extraction is ffmpeg-free (in-process lofty), so it runs on every
        // platform including Android.
        const [embeddedCover, covers, metaResults] = await Promise.all([
          extractAudioCoverArt(item.filePath),
          searchAudiobookCover(parsed.title, parsed.author),
          searchAudiobookMetadata(parsed.title, parsed.author),
        ]);

        const allCovers = embeddedCover ? [embeddedCover, ...covers] : covers;

        const bestMatch = metaResults[0] || {};
        setBatchItems(prev => prev.map(b =>
          b.id === item.id ? {
            ...b,
            status: "ready",
            metadata: {
              ...parsed,
              ...bestMatch,
              duration: parsed.duration || bestMatch.duration || 0,
            },
            coverOptions: allCovers,
            selectedCover: allCovers[0] || "",
            transcript: null,
          } : b
        ));
        
      } catch {
        setBatchItems(prev => prev.map(b => 
          b.id === item.id ? {
            ...b,
            status: "error",
            error: "Failed to load metadata",
          } : b
        ));
      }
    }
    
    // Move to metadata step
    setCurrentStep("metadata");
  };

  const loadSingleFile = async (path: string) => {
    setFilePath(path);
    setIsLoading(true);
    setImportMode("single");

    try {
      // On mobile there's no ffmpeg to parse embedded tags, and the file isn't
      // staged to a readable path until after import, so derive basic metadata
      // from the filename and rely on online lookups for the rest.
      let parsed: AudiobookMetadata;
      if (onMobile) {
        const fileName = path.split(/[/\\]/).pop() || path;
        const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
        const parts = nameWithoutExt.split(" - ");
        const title = parts.length >= 2 ? parts.slice(1).join(" - ").trim() : nameWithoutExt;
        const author = parts.length >= 2 ? parts[0].trim() : undefined;
        parsed = {
          title,
          author,
          duration: 0,
          chapters: [{ id: 1, title: "Chapter 1", startTime: 0 }],
        };
      } else {
        parsed = await parseAudiobookMetadata(path);
      }
      setMetadata(parsed);
      setChapters(parsed.chapters || []);

      // Extract embedded cover and search for online covers in parallel.
      // Extraction is ffmpeg-free (in-process lofty) and runs on every
      // platform, including Android where the file has already been staged
      // into app-private storage by the folder-import plugin before this runs.
      const [embeddedCover, covers, metaResults] = await Promise.all([
        extractAudioCoverArt(path),
        searchAudiobookCover(parsed.title, parsed.author),
        searchAudiobookMetadata(parsed.title, parsed.author),
      ]);

      const allCovers = embeddedCover ? [embeddedCover, ...covers] : covers;
      setCoverOptions(allCovers);
      setSearchResults(metaResults);
      if (allCovers.length > 0) {
        setSelectedCover(allCovers[0]);
      }

      if (metaResults.length > 0) {
        const bestMatch = metaResults[0];
        setMetadata(prev => ({
          ...prev,
          ...bestMatch,
          duration: prev.duration || bestMatch.duration || 0,
        }));
      }

      setCurrentStep("metadata");
    } catch {
      setError("Failed to parse audiobook metadata");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsLoading(true);
    logAudiobookDiagnostic("import", {
      filePath: filePath || selectedFiles[0],
      status: "started",
    });
    try {
      const [covers, metaResults] = await Promise.all([
        searchAudiobookCover(searchQuery, metadata.author),
        searchAudiobookMetadata(searchQuery, metadata.author),
      ]);
      
      setCoverOptions(covers);
      setSearchResults(metaResults);
      if (covers.length > 0 && !selectedCover) {
        setSelectedCover(covers[0]);
      }
    } catch {
      showError("Search failed", "Could not fetch metadata");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTranscriptionError = (message: string, retry?: () => void) => {
    if (message.includes('Groq API key not configured')) {
      showTranscriptionResolutionFailure(
        { ok: false, reason: "missing-groq-key" },
        { error: showError, info: showInfo, success: showSuccess },
        retry,
      );
    } else if (message.includes('Rate limit')) {
      showError(
        "Groq Rate Limit Reached",
        message,
        {
          action: {
            label: "Switch to Local",
            onClick: () => {
              window.dispatchEvent(new CustomEvent('navigate-to-settings', {
                detail: { section: 'audio-transcription' },
              }));
            },
          },
        }
      );
    } else if (message.includes('25MB limit')) {
      showError(
        "File Too Large for Groq",
        "This audiobook exceeds Groq's 25MB free tier limit. Consider using local STT instead.",
        {
          action: {
            label: "Switch to Local",
            onClick: () => {
              window.dispatchEvent(new CustomEvent('navigate-to-settings', {
                detail: { section: 'audio-transcription' },
              }));
            },
          },
        }
      );
    } else {
      const match = message.match(/Model '([^']+)' is not installed/i);
      if (match) {
        const missingModelId = match[1];
        showTranscriptionResolutionFailure(
          {
            ok: false,
            reason: "model-not-installed",
            modelId: missingModelId,
            modelLabel: missingModelId,
          },
          { error: showError, info: showInfo, success: showSuccess },
          retry,
        );
      } else {
        showError("Transcription failed", message || "Unknown error");
      }
    }
  };

  const startTranscription = async () => {
    // On mobile the audio file isn't staged to a readable path until after
    // import, so import-time transcription can't read it yet. The working Groq
    // path lives in the audiobook player (transcribe_audio_file_groq runs on
    // the staged file). Guide the user there instead of failing silently.
    if (onMobile) {
      showInfo(
        "Transcribe after import",
        "Open the audiobook in the player and tap the transcript button to transcribe it with Groq."
      );
      return;
    }
    setIsGeneratingTranscript(true);
    setTranscriptProgress(0);
    showInfo(
      "Transcription started",
      "Your audiobook is being transcribed in the background. You can continue with the import."
    );
    try {
      const result = await generateTranscript(filePath, (progress) => {
        setTranscriptProgress(progress);
      });
      setTranscript(result);
      showSuccess(
        "Transcript complete",
        `"${metadata.title || "Audiobook"}" has been transcribed and is ready for incremental reading.`,
        { duration: 8000 }
      );
    } catch (err) {
      handleTranscriptionError(err instanceof Error ? err.message : String(err), () => void startTranscription());
    } finally {
      setIsGeneratingTranscript(false);
    }
  };

  const handleGenerateTranscript = () => {
    void startTranscription();
  };

  const handleImportTranscript = async () => {
    try {
      const files = await openFilePicker({
        title: "Select Transcript",
        multiple: false,
        filters: [
          { name: "Text files", extensions: ["txt", "json", "srt", "vtt"] },
        ],
      });
      
      if (files && files.length > 0) {
        const result = await importTranscriptFromFile(files[0]);
        setTranscript(result);
        showSuccess("Transcript imported", "Your transcript has been loaded");
      }
    } catch (err) {
      showError("Import failed", err instanceof Error ? err.message : "Unknown error");
    }
  };

  // Import single audiobook (handles both single file and multi-part)
  const handleImport = async () => {
    if (!filePath && !multiPartBook) return;

    setIsLoading(true);
    try {
      let doc: Document;

      if (multiPartBook && (chaptersList.length > 0 || selectedFiles.length > 0)) {
        const partsToImport = chaptersList.length > 0
          ? chaptersList.map((ch) => ({
              path: ch.path,
              fileName: ch.fileName,
              title: ch.title,
            }))
          : selectedFiles.map((path, idx) => ({
              path,
              fileName: path.split(/[/\\]/).pop() || `Part ${idx + 1}`,
              title: formatDisplayChapterTitle(path, idx),
            }));

        const result = await importMultipartAudiobook({
          files: partsToImport,
          title: metadata.title || multiPartBook.title,
          author: metadata.author || multiPartBook.author,
          fallbackTitle: multiPartBook.title,
          fallbackAuthor: multiPartBook.author,
          coverUrl: selectedCover || undefined,
          tags: ["audiobook", "audio", "multi-part", ...(metadata.genre || [])],
          collectionId,
        });
        doc = result.document;
        if (!result.deduplicated) {
          await loadDocuments();
        }

        // Calculate and persist cumulative chapter timeline
        let cumulativeTime = 0;
        const effectiveList = chaptersList.length > 0
          ? chaptersList
          : partsToImport.map((p, i) => ({
              id: `chapter-${i}`,
              path: p.path,
              fileName: p.fileName,
              title: p.title,
              duration: 0,
              partNumber: i + 1,
            }));

        const calculatedChapters: AudiobookChapter[] = effectiveList.map((ch, idx) => {
          const start = cumulativeTime;
          const dur = ch.duration || 0;
          cumulativeTime += dur;
          return {
            id: idx + 1,
            title: ch.title || `Chapter ${idx + 1}`,
            startTime: start,
            endTime: cumulativeTime,
            duration: dur,
          };
        });

        const audiobookData = {
          documentId: doc.id,
          chapters: calculatedChapters,
          transcript,
          metadata,
        };
        localStorage.setItem(`audiobook-${doc.id}`, JSON.stringify(audiobookData));
        setChapters(calculatedChapters);
      } else {
        const imported = await importFromFiles([filePath]);
        if (imported.length === 0) throw new Error("Failed to import audiobook");
        doc = imported[0];

        // Update with metadata - explicitly set fileType to 'audio' via API
        await updateDocumentApi(doc.id, {
          ...doc,
          title: metadata.title || doc.title,
          fileType: "audio",
          tags: ["audiobook", "audio", ...(metadata.genre || [])],
          coverImageUrl: selectedCover,
          metadata: {
            author: metadata.author,
            subject: metadata.description?.substring(0, 200),
            keywords: metadata.genre,
            language: metadata.language,
          },
        } as Document);

        // If we have a transcript, save it
        if (transcript?.fullText) {
          const { updateDocumentContent } = await import("../../api/documents");
          await updateDocumentContent(doc.id, transcript.fullText);
        }

        const audiobookData = {
          documentId: doc.id,
          chapters,
          transcript,
          metadata,
        };
        localStorage.setItem(`audiobook-${doc.id}`, JSON.stringify(audiobookData));
      }
      
      await loadDocuments();
      logAudiobookDiagnostic("import", {
        documentId: doc.id,
        filePath: doc.filePath,
        status: "success",
      });
      showSuccess("Audiobook imported", `"${metadata.title}" has been added to your library`);
      
      setTimeout(() => {
        onClose();
        if (onOpenDocument) {
          onOpenDocument(doc);
        }
      }, 800);
    } catch (err) {
      logAudiobookDiagnostic("import", {
        filePath: filePath || selectedFiles[0],
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
      }, "error");
      showError("Import failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBatchImport = async () => {
    const readyItems = batchItems.filter(item => item.status === "ready");
    
    if (readyItems.length === 0) {
      showError("No ready items", "Please wait for metadata to load");
      return;
    }
    
    setIsLoading(true);
    setImportProgress({ current: 0, total: readyItems.length });
    
    const results: BatchImportResult = {
      successful: [],
      failed: [],
      total: readyItems.length,
    };
    
    for (let i = 0; i < readyItems.length; i++) {
      const item = readyItems[i];
      setImportProgress({ current: i + 1, total: readyItems.length });
      
      try {
        logAudiobookDiagnostic("import", {
          filePath: item.filePath,
          status: "started",
        });
        const imported = await importFromFiles([item.filePath]);

        if (imported.length === 0) {
          throw new Error("Import failed");
        }

        const doc = imported[0];
        
        await updateDocumentApi(doc.id, {
          ...doc,
          title: item.metadata?.title || doc.title,
          fileType: "audio",
          tags: ["audiobook", "audio", ...(item.metadata?.genre || [])],
          coverImageUrl: item.selectedCover,
          metadata: {
            author: item.metadata?.author,
            subject: item.metadata?.description?.substring(0, 200),
            keywords: item.metadata?.genre,
            language: item.metadata?.language,
          },
        } as Document);
        
        const audiobookData = {
          documentId: doc.id,
          chapters: [],
          transcript: item.transcript,
          metadata: item.metadata,
        };
        localStorage.setItem(`audiobook-${doc.id}`, JSON.stringify(audiobookData));
        
        results.successful.push({
          filePath: item.filePath,
          document: doc,
          metadata: item.metadata || {},
        });
        logAudiobookDiagnostic("import", {
          documentId: doc.id,
          filePath: doc.filePath,
          status: "success",
        });
        
      } catch (err) {
        logAudiobookDiagnostic("import", {
          filePath: item.filePath,
          status: "failed",
          message: err instanceof Error ? err.message : "Import failed",
        }, "error");
        results.failed.push({
          filePath: item.filePath,
          error: err instanceof Error ? err.message : "Import failed",
        });
      }
    }
    
    await loadDocuments();
    
    if (results.failed.length === 0) {
      showSuccess(
        "Import complete",
        `${results.successful.length} audiobooks imported successfully`
      );
    } else {
      showError(
        "Import partially failed",
        `${results.successful.length} imported, ${results.failed.length} failed`
      );
    }
    
    setTimeout(() => {
      onClose();
      // Open first successful document
      if (onOpenDocument && results.successful.length > 0) {
        onOpenDocument(results.successful[0].document);
      }
    }, 1500);
    
    setIsLoading(false);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setPreviewDuration(audioRef.current.duration);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col",
        isMobileShell
          ? "bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          : "items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      )}
    >
      <div
        className={cn(
          "relative flex w-full flex-col overflow-hidden bg-card border border-border",
          isMobileShell
            ? "h-full"
            : "h-[90vh] max-w-6xl rounded-xl shadow-2xl"
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-center justify-between border-b border-border bg-card",
            isMobileShell ? "px-4 py-3" : "px-6 py-4"
          )}
        >
          <div className="flex items-center gap-3">
            {isMobileShell && (
              <button
                onClick={onClose}
                className="-ml-1 rounded-full p-1.5 text-foreground hover:bg-muted active:scale-95 transition"
                aria-label="Back"
              >
                <ArrowLeft className="h-6 w-6" />
              </button>
            )}
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <Headphones className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {importMode === "batch" ? "Import Audiobooks" : "Import Audiobook"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {importMode === "batch" 
                  ? `${batchItems.filter(i => i.status === "ready").length} of ${batchItems.length} ready`
                  : "Add audiobooks with transcripts for incremental learning"
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(batchItems.length > 1 || (multiPartBook && chaptersList.length > 1)) && currentStep !== "select" && (
              <div className="flex items-center rounded-lg border border-border bg-muted/60 p-1 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => void handleModeToggle("single")}
                  className={cn(
                    "rounded-md px-3 py-1 transition-colors",
                    importMode === "single"
                      ? "bg-background text-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Combine into single book
                </button>
                <button
                  type="button"
                  onClick={() => void handleModeToggle("batch")}
                  className={cn(
                    "rounded-md px-3 py-1 transition-colors",
                    importMode === "batch"
                      ? "bg-background text-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Separate audiobooks
                </button>
              </div>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Progress Steps - only show for single mode */}
        {importMode === "single" && (
          <div className="flex items-center gap-2 border-b border-border bg-card/50 px-6 py-3">
            {[
              { id: "select", label: "Select File", icon: Upload },
              { id: "metadata", label: "Metadata", icon: Image },
              { id: "transcript", label: "Transcript", icon: TextT },
              { id: "confirm", label: "Confirm", icon: CheckCircle },
            ].map((step, index) => {
              const isActive = currentStep === step.id;
              const isPast = [
                "select",
                "metadata",
                "transcript",
                "confirm",
              ].indexOf(currentStep) > index;
              
              return (
                <div key={step.id} className="flex items-center">
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                      isActive && "bg-primary text-primary-foreground",
                      isPast && "text-primary",
                      !isActive && !isPast && "text-muted-foreground"
                    )}
                  >
                    <step.icon className="h-4 w-4" />
                    {step.label}
                  </div>
                  {index < 3 && (
                    <CaretRight className="h-4 w-4 mx-1 text-muted-foreground" />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {/* Step 1: File Selection */}
          {currentStep === "select" && (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="mb-6 rounded-full bg-amber-500/10 p-6">
                <Headphones className="h-12 w-12 text-amber-500" />
              </div>
              <h3 className="mb-2 text-xl font-semibold text-foreground">
                Import Audiobooks
              </h3>
              <p className="mb-8 max-w-md text-sm text-muted-foreground">
                Import a single audiobook or select a directory to batch import multiple files.
                We'll automatically fetch metadata and cover art.
              </p>

              <div className={cn(
                "flex gap-4",
                isMobileShell ? "w-full max-w-sm flex-col" : "flex-wrap justify-center"
              )}>
                {/* Single file import */}
                <button
                  onClick={handleFileSelect}
                  disabled={isLoading}
                  className={cn(
                    "flex flex-col items-center gap-3 rounded-xl border-2 border-border bg-card p-6 hover:border-primary/50 hover:bg-muted/30 transition-all disabled:opacity-50",
                    isMobileShell && "w-full"
                  )}
                >
                  <div className="rounded-full bg-primary/10 p-3">
                    <Upload className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Single File</p>
                    <p className="text-xs text-muted-foreground">Import one or more audiobooks</p>
                  </div>
                </button>

                {/* Directory import — available on desktop AND native mobile
                    (folder-import plugin stages files to readable paths). Only
                    disabled in pure browser/PWA. */}
                <button
                  onClick={handleDirectorySelect}
                  disabled={isLoading || !folderImportAvailable}
                  className={cn(
                    "flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all",
                    isMobileShell && "w-full",
                    folderImportAvailable
                      ? "border-border bg-card hover:border-primary/50 hover:bg-muted/30 disabled:opacity-50"
                      : "border-dashed border-border/50 bg-muted/20 opacity-60 cursor-not-allowed"
                  )}
                  title={folderImportAvailable ? "Import all audiobooks in a folder" : "Directory import requires the app — use Single File mode to select multiple files"}
                >
                  <div className="rounded-full bg-amber-500/10 p-3">
                    <FolderOpen className="h-6 w-6 text-amber-500" />
                  </div>
                  <div>
                    <p className="font-medium">Directory</p>
                    <p className="text-xs text-muted-foreground">
                      {folderImportAvailable ? "Import all audiobooks in folder" : "App only"}
                    </p>
                  </div>
                  {!folderImportAvailable && (
                    <span className="text-[10px] text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      Use Single File mode
                    </span>
                  )}
                </button>
              </div>
              
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {AUDIOBOOK_FORMATS.map(format => (
                  <span key={format} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground uppercase">
                    .{format}
                  </span>
                ))}
              </div>
              
              {error && (
                <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Batch Mode - Loading */}
          {importMode === "batch" && currentStep === "select" && isLoading && (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <CircleNotch className="h-12 w-12 animate-spin text-primary mb-4" />
              <h3 className="mb-2 text-xl font-semibold">Scanning Directory...</h3>
              <p className="text-muted-foreground">
                Found {batchItems.length} audiobook files
              </p>
            </div>
          )}

          {/* Batch Mode - Metadata Review */}
          {importMode === "batch" && currentStep === "metadata" && (
            <div className="flex h-full flex-col">
              {/* Progress */}
              <div className="border-b border-border bg-card/50 px-6 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">
                    Processing {importProgress.current} of {importProgress.total} files
                  </span>
                  <span className="text-sm font-medium">
                    {Math.round((importProgress.current / importProgress.total) * 100)}%
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                  />
                </div>
              </div>
              
              {/* Batch items grid */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className={cn(
                  "grid gap-4",
                  isMobileShell ? "grid-cols-1" : "grid-cols-2 md:grid-cols-3"
                )}>
                  {batchItems.map((item) => (
                    <div 
                      key={item.id}
                      className={cn(
                        "rounded-xl border-2 p-4 transition-all",
                        item.status === "ready" 
                          ? "border-green-500/30 bg-green-500/5" 
                          : item.status === "error"
                          ? "border-destructive/30 bg-destructive/5"
                          : item.status === "loading"
                          ? "border-primary/30 bg-primary/5"
                          : "border-border bg-card"
                      )}
                    >
                      {/* Status indicator */}
                      <div className="flex items-center justify-between mb-3">
                        <span className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          item.status === "ready" && "bg-green-500/10 text-green-600",
                          item.status === "error" && "bg-destructive/10 text-destructive",
                          item.status === "loading" && "bg-primary/10 text-primary",
                          item.status === "pending" && "bg-muted text-muted-foreground"
                        )}>
                          {item.status === "ready" && "Ready"}
                          {item.status === "error" && "Error"}
                          {item.status === "loading" && "Loading..."}
                          {item.status === "pending" && "Pending"}
                        </span>
                        {item.status === "ready" && <CheckCircle className="h-4 w-4 text-green-500" />}
                        {item.status === "error" && <Warning className="h-4 w-4 text-destructive" />}
                      </div>
                      
                      {/* Cover */}
                      <div className="aspect-square rounded-lg bg-muted mb-3 overflow-hidden">
                        {item.selectedCover ? (
                          <img 
                            src={item.selectedCover} 
                            alt="" 
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <Headphones className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      
                      {/* Info */}
                      <h4 className="font-medium text-sm truncate mb-1">
                        {item.metadata?.title || item.fileName}
                      </h4>
                      <p className="text-xs text-muted-foreground truncate mb-2">
                        {item.metadata?.author || "Unknown author"}
                      </p>
                      
                      {item.metadata?.duration && (
                        <p className="text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 inline mr-1" />
                          {formatDuration(item.metadata.duration)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Actions */}
              <div className="border-t border-border bg-card p-4 flex justify-between">
                <button
                  onClick={() => {
                    setImportMode("single");
                    setCurrentStep("select");
                    setBatchItems([]);
                  }}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  Back
                </button>
                <button
                  onClick={() => setCurrentStep("transcript")}
                  disabled={batchItems.filter(i => i.status === "ready").length === 0}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  Continue
                  <CaretRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Metadata - Single Mode */}
          {importMode === "single" && currentStep === "metadata" && (
            <div className="flex h-full">
              {/* Left: Cover Art */}
              <div className="w-80 border-r border-border bg-card/50 p-6 overflow-y-auto">
                <h3 className="mb-4 text-sm font-semibold text-foreground">Cover Art</h3>
                
                <div className="mb-4 aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                  {selectedCover ? (
                    <img
                      src={selectedCover}
                      alt="Cover"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Headphones className="h-16 w-16 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
                
                {coverOptions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Alternative covers:</p>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {coverOptions.slice(0, 5).map((cover, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedCover(cover)}
                          className={cn(
                            "h-16 w-16 flex-shrink-0 overflow-hidden rounded border-2 transition-all",
                            selectedCover === cover
                              ? "border-primary"
                              : "border-transparent hover:border-muted"
                          )}
                        >
                          <img src={cover} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-muted-foreground">Search covers:</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by title..."
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                    />
                    <button
                      onClick={handleSearch}
                      disabled={isLoading}
                      className="rounded-lg bg-muted p-1.5 hover:bg-muted/80"
                    >
                      <MagnifyingGlass className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                
                {/* Multi-part info */}
                {multiPartBook && (
                  <div className="mt-6 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Stack className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-medium text-amber-600">Multi-Part Book</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      {selectedFiles.length} parts detected
                    </p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {multiPartBook.parts.map((part) => (
                        <div key={part.partNumber} className="text-xs flex items-center gap-1">
                          <span className="text-muted-foreground">Part {part.partNumber}:</span>
                          <span className="truncate flex-1">{part.filePath.split(/[/\\]/).pop()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Right: Metadata Form */}
              <div className="flex-1 overflow-y-auto p-6">
                <h3 className="mb-4 text-sm font-semibold text-foreground">Book Details</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Title
                    </label>
                    <input
                      type="text"
                      value={metadata.title || ""}
                      onChange={(e) => setMetadata(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Author
                      </label>
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <input
                          type="text"
                          value={metadata.author || ""}
                          onChange={(e) => setMetadata(prev => ({ ...prev, author: e.target.value }))}
                          className="flex-1 bg-transparent text-sm outline-none"
                        />
                      </div>
                    </div>
                    
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Narrator
                      </label>
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                        <Microphone className="h-4 w-4 text-muted-foreground" />
                        <input
                          type="text"
                          value={metadata.narrator || ""}
                          onChange={(e) => setMetadata(prev => ({ ...prev, narrator: e.target.value }))}
                          className="flex-1 bg-transparent text-sm outline-none"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Duration
                      </label>
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        {formatDuration(metadata.duration || 0)}
                      </div>
                    </div>
                    
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Language
                      </label>
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                        <Translate className="h-4 w-4 text-muted-foreground" />
                        <input
                          type="text"
                          value={metadata.language || "en"}
                          onChange={(e) => setMetadata(prev => ({ ...prev, language: e.target.value }))}
                          className="flex-1 bg-transparent text-sm outline-none"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Description
                    </label>
                    <textarea
                      value={metadata.description || ""}
                      onChange={(e) => setMetadata(prev => ({ ...prev, description: e.target.value }))}
                      rows={3}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
                    />
                  </div>
                  
                  {searchResults.length > 0 && (
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Search Results - Click to apply:
                      </p>
                      <div className="space-y-2">
                        {searchResults.slice(0, 3).map((result, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setMetadata(prev => ({ ...prev, ...result }));
                              if (result.coverUrl) setSelectedCover(result.coverUrl);
                            }}
                            className="w-full rounded-lg bg-background p-2 text-left text-sm hover:bg-muted transition-colors"
                          >
                            <p className="font-medium">{result.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {result.author} • {result.publisher}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Multi-part Chapter Review */}
                  {multiPartBook && chaptersList.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <List className="h-4 w-4 text-primary" />
                          <h4 className="text-sm font-semibold text-foreground">
                            Chapters & Parts ({chaptersList.length})
                          </h4>
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                          Total: {formatDuration(metadata.duration || chaptersList.reduce((acc, c) => acc + (c.duration || 0), 0))}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">
                        Review, edit chapter titles, reorder tracks, or exclude unwanted files before importing.
                      </p>
                      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                        {chaptersList.map((ch, idx) => (
                          <div
                            key={ch.id}
                            className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 p-2 text-xs transition-colors"
                          >
                            <div className="flex flex-col gap-0.5 text-muted-foreground">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMoveChapter(idx, "up")}
                                className="hover:text-foreground disabled:opacity-30 p-0.5 rounded"
                                title="Move up"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === chaptersList.length - 1}
                                onClick={() => handleMoveChapter(idx, "down")}
                                className="hover:text-foreground disabled:opacity-30 p-0.5 rounded"
                                title="Move down"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>
                            <span className="w-5 font-mono text-muted-foreground text-center shrink-0">
                              {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <input
                                type="text"
                                value={ch.title}
                                onChange={(e) => handleChapterTitleChange(ch.id, e.target.value)}
                                placeholder={`Chapter ${idx + 1}`}
                                className="w-full rounded border border-border/80 bg-background px-2 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                              <span className="text-[10px] text-muted-foreground truncate block mt-0.5">
                                {ch.fileName}
                              </span>
                            </div>
                            {ch.duration ? (
                              <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                                {formatDuration(ch.duration)}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => handleRemoveChapter(ch.id)}
                              disabled={chaptersList.length <= 1}
                              className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 shrink-0 transition-colors"
                              title="Exclude track"
                            >
                              <Trash className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => setCurrentStep("transcript")}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    Next: Transcript
                    <CaretRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Transcript */}
          {currentStep === "transcript" && (
            <div className="flex h-full flex-col p-6">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Transcript Options</h3>
              <p className="mb-6 text-sm text-muted-foreground">
                A transcript enables incremental reading, text search, and creating flashcards 
                from specific sections of the audiobook.
              </p>
              
              {importMode === "single" ? (
                // Single mode transcript options
                transcript ? (
                  <div className="flex-1 rounded-lg border border-border bg-muted/30 p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-green-500" />
                        <span className="font-medium">Transcript Ready</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {transcript.segments.length.toLocaleString()} segments • {" "}
                        {transcript.fullText.split(/\s+/).length.toLocaleString()} words
                      </span>
                    </div>
                    
                    <div className="h-64 overflow-y-auto rounded-lg bg-background p-4 text-sm text-muted-foreground">
                      {transcript.fullText.substring(0, 1000)}...
                    </div>
                    
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => setTranscript(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
                      >
                        Remove & Start Over
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    <button
                      onClick={() => void handleGenerateTranscript()}
                      disabled={isGeneratingTranscript}
                      className={cn(
                        "flex flex-col items-center rounded-xl border-2 bg-card p-6 text-center transition-all hover:bg-muted/30 disabled:opacity-50",
                        isGeneratingTranscript
                          ? "border-primary/50 bg-primary/5"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div className="mb-3 rounded-full bg-primary/10 p-3">
                        {isGeneratingTranscript ? (
                          <CircleNotch className="h-6 w-6 text-primary animate-spin" />
                        ) : (
                          <Sparkle className="h-6 w-6 text-primary" />
                        )}
                      </div>
                      <h4 className="mb-1 font-medium">
                        {isGeneratingTranscript ? "Transcribing..." : "Generate with AI"}
                      </h4>
                      <p className="text-xs text-muted-foreground text-center">
                        {isGeneratingTranscript
                          ? "You can continue with the import while this runs"
                          : onMobile
                            ? "Transcribe via Groq after import from the player"
                            : "Use local STT or Groq Cloud to transcribe"}
                      </p>
                      {isGeneratingTranscript && (
                        <div className="mt-3 w-full px-2">
                          <div className="flex justify-between text-xs text-muted-foreground mb-1">
                             <span>Progress</span>
                             <span>{transcriptProgress}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div
                               className="h-full bg-primary transition-all duration-300"
                               style={{ width: `${transcriptProgress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </button>
                    
                    <button
                      onClick={handleImportTranscript}
                      className="flex flex-col items-center rounded-xl border-2 border-border bg-card p-6 text-center transition-all hover:border-primary/50 hover:bg-muted/30"
                    >
                      <div className="mb-3 rounded-full bg-blue-500/10 p-3">
                        <Upload className="h-6 w-6 text-blue-500" />
                      </div>
                      <h4 className="mb-1 font-medium">Import Transcript</h4>
                      <p className="text-xs text-muted-foreground">
                        Import TXT, JSON, SRT, or VTT file
                      </p>
                    </button>
                    
                    <button
                      onClick={() => setCurrentStep("confirm")}
                      className="flex flex-col items-center rounded-xl border-2 border-border bg-card p-6 text-center transition-all hover:border-primary/50 hover:bg-muted/30"
                    >
                      <div className="mb-3 rounded-full bg-muted p-3">
                        <SkipForward className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <h4 className="mb-1 font-medium">Skip for Now</h4>
                      <p className="text-xs text-muted-foreground">
                        Add a transcript later from the document menu
                      </p>
                    </button>
                  </div>
                )
              ) : (
                // Batch mode - simplified transcript info
                <div className="flex-1 rounded-lg border border-border bg-muted/30 p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <WarningCircle className="h-5 w-5 text-amber-500" />
                    <p className="font-medium">Batch Import Note</p>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    For batch imports, transcripts can be added later for individual audiobooks 
                    from their document menus. This keeps the import process fast while still 
                    allowing you to transcribe books as needed.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {batchItems.filter(i => i.status === "ready").length} audiobooks ready to import.
                  </p>
                </div>
              )}
              
              <div className="mt-6 flex justify-between items-center">
                <button
                  onClick={() => setCurrentStep("metadata")}
                  className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
                >
                  <CaretLeft className="h-4 w-4" />
                  Back
                </button>
                {isGeneratingTranscript && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CircleNotch className="h-3 w-3 animate-spin text-primary" />
                    Transcription continues in the background
                  </span>
                )}
                <button
                  onClick={() => setCurrentStep("confirm")}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  {isGeneratingTranscript ? "Continue to Import" : "Next: Confirm"}
                  <CaretRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Confirm */}
          {currentStep === "confirm" && (
            <div className="flex h-full p-6">
              <div className="flex-1 space-y-6">
                <h3 className="text-sm font-semibold text-foreground">
                  Review & Import
                  {importMode === "batch" && ` (${batchItems.filter(i => i.status === "ready").length} files)`}
                </h3>
                
                {importMode === "single" ? (
                  // Single file or multi-part summary
                  <div className="flex gap-4 rounded-xl border border-border bg-card p-4">
                    {selectedCover ? (
                      <img
                        src={selectedCover}
                        alt=""
                        className="h-32 w-32 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-muted">
                        <Headphones className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}
                    
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold">{metadata.title}</h4>
                      <p className="text-sm text-muted-foreground">by {metadata.author}</p>
                      
                      <div className="mt-2 flex flex-wrap gap-2">
                        {multiPartBook && (
                          <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">
                            <Stack className="h-3 w-3" />
                            {selectedFiles.length} parts
                          </span>
                        )}
                        {metadata.narrator && (
                          <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            <Headphones className="h-3 w-3" />
                            Narrated by {metadata.narrator}
                          </span>
                        )}
                        <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDuration(metadata.duration || 0)}
                        </span>
                        {transcript && (
                          <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-600">
                            <TextT className="h-3 w-3" />
                            Transcript included
                          </span>
                        )}
                      </div>
                      
                      {multiPartBook && (
                        <div className="mt-2 text-xs text-muted-foreground border-t border-border/60 pt-2">
                          <p className="font-medium mb-1 text-foreground">
                            Chapters ({chaptersList.length > 0 ? chaptersList.length : multiPartBook.parts.length}):
                          </p>
                          {chaptersList.length > 0 ? (
                            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                              {chaptersList.map((ch, idx) => (
                                <div key={ch.id} className="flex items-center justify-between text-xs py-0.5">
                                  <span className="truncate flex-1 pr-2 font-medium">
                                    {idx + 1}. {ch.title}
                                  </span>
                                  {ch.duration ? (
                                    <span className="font-mono text-muted-foreground shrink-0">
                                      {formatDuration(ch.duration)}
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1 items-center">
                              {(showAllParts ? multiPartBook.parts : multiPartBook.parts.slice(0, 12)).map((part) => (
                                <span key={part.partNumber} className="bg-muted px-1.5 py-0.5 rounded">
                                  Part {part.partNumber}
                                </span>
                              ))}
                              {multiPartBook.parts.length > 12 && (
                                <button
                                  type="button"
                                  onClick={() => setShowAllParts(!showAllParts)}
                                  className="text-primary font-medium hover:underline px-1.5 py-0.5 transition-colors"
                                >
                                  {showAllParts ? "Show less" : `+ ${multiPartBook.parts.length - 12} more`}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {metadata.description}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="max-h-80 overflow-y-auto">
                      {batchItems.filter(i => i.status === "ready").map((item) => (
                        <div 
                          key={item.id}
                          className="flex items-center gap-3 p-3 border-b border-border/50 last:border-0"
                        >
                          {item.selectedCover ? (
                            <img 
                              src={item.selectedCover} 
                              alt="" 
                              className="h-12 w-12 rounded object-cover"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
                              <Headphones className="h-6 w-6 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {item.metadata?.title || item.fileName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.metadata?.author || "Unknown author"} • {" "}
                              {formatDuration(item.metadata?.duration || 0)}
                            </p>
                          </div>
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Features list */}
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <h5 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    What you'll be able to do
                  </h5>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <SpeakerHigh className="h-4 w-4 text-primary" />
                      Listen with full audiobook controls (speed, bookmarks, sleep timer)
                    </li>
                    {importMode === "single" && transcript ? (
                      <li className="flex items-center gap-2">
                        <TextT className="h-4 w-4 text-primary" />
                        Read along with synchronized transcript
                      </li>
                    ) : null}
                    <li className="flex items-center gap-2">
                      <Bookmark className="h-4 w-4 text-primary" />
                      Create extracts and flashcards from any section
                    </li>
                    <li className="flex items-center gap-2">
                      <List className="h-4 w-4 text-primary" />
                      Navigate by chapters
                    </li>
                  </ul>
                </div>
                
                {/* Navigation */}
                <div className="flex justify-between pt-4">
                  <button
                    onClick={() => setCurrentStep("transcript")}
                    className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
                  >
                    <CaretLeft className="h-4 w-4" />
                    Back
                  </button>
                  <button
                    onClick={importMode === "batch" ? handleBatchImport : handleImport}
                    disabled={isLoading}
                    className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {isLoading ? (
                      <>
                        <CircleNotch className="h-4 w-4 animate-spin" />
                        {importMode === "batch" 
                          ? `Importing ${importProgress.current} of ${importProgress.total}...`
                          : "Importing..."
                        }
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        Import {importMode === "batch" ? `${batchItems.filter(i => i.status === "ready").length} Audiobooks` : "Audiobook"}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Hidden audio element for preview */}
        {filePath && importMode === "single" && (
          <audio
            ref={audioRef}
            src={isTauri() ? undefined : filePath}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        )}
      </div>
    </div>
  );
}
