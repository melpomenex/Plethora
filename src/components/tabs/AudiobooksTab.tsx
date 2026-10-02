import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Headphones,
  MagnifyingGlass,
  Plus,
  Funnel,
  TrendUp,
  Clock,
  BookOpen,
  CheckCircle,
  Archive,
  Star,
  Trash,
  Play,
  Pause,
  ArrowClockwise,
  ArrowCounterClockwise,
  X,
  SpeakerHigh,
  Waveform,
  Copy,
  Info,
  DotsThreeVertical,
} from "@phosphor-icons/react";
import { useDocumentStore, useTabsStore } from "../../stores";
import { Document } from "../../types/document";
import { AudiobookImportDialog } from "../import/AudiobookImportDialog";
import { CreateAudioEditionDialog } from "../audio/CreateAudioEditionDialog";
import { listAudioEditions, deleteAudioEdition } from "../../api/audioEditions";
import { useAudioEditionGenerationStore, type GenerationJob } from "../../stores/audioEditionGenerationStore";
import type { AudioEdition } from "../../types/audioEdition";
import { DocumentViewer } from "./TabRegistry";
import { cn } from "../../utils";
import { formatDuration } from "../../api/audiobooks";
import { isAudiobookDocument } from "./audiobookClassification";
import { useIsActiveTab, usePaneId } from "../common/Tabs";
import { useContextMenu, ContextMenu, ContextMenuItemType, type ContextMenuItem } from "../common/ContextMenu";
import { useModal } from "../common/Modal";
import { useToast } from "../common/Toast";

export function AudiobooksTab() {
  const { documents, loadDocuments, deleteDocument } = useDocumentStore();
  const { addTab } = useTabsStore();
  const paneId = usePaneId();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "not_started" | "in_progress" | "finished" | "dnf">("all");
  const [sortBy, setSortBy] = useState<"dateAdded" | "title" | "author" | "duration" | "progress">("dateAdded");
  const isActiveTab = useIsActiveTab();
  const editionContextMenu = useContextMenu("audio-edition-context-menu");
  const [configureDoc, setConfigureDoc] = useState<Document | null>(null);
  const modal = useModal();
  const toast = useToast();

  // Document Audio Editions (task 4.3 & 5.3): editions of non-audio documents with
  // generation badges + playback controls, plus live generation progress.
  const [editions, setEditions] = useState<AudioEdition[]>([]);
  const generationJobs = useAudioEditionGenerationStore((s) => s.jobs);

  const reloadEditions = useCallback(() => {
    let cancelled = false;
    void listAudioEditions()
      .then((list) => {
        if (!cancelled) setEditions(list ?? []);
      })
      .catch(() => {
        if (!cancelled) setEditions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isActiveTab) return;
    const cancelInitial = reloadEditions();

    // Subscribe to store updates: reload editions when jobs start, advance, or finish
    const unsub = useAudioEditionGenerationStore.subscribe((state, prevState) => {
      const activeChanged = state.activeJobs !== prevState.activeJobs;
      const jobCountChanged = Object.keys(state.jobs).length !== Object.keys(prevState.jobs).length;
      const anyJobStatusChanged = Object.values(state.jobs).some(
        (job) =>
          job.status !== prevState.jobs[job.editionId]?.status ||
          job.completedSections !== prevState.jobs[job.editionId]?.completedSections
      );
      if (activeChanged || jobCountChanged || anyJobStatusChanged) {
        reloadEditions();
      }
    });

    return () => {
      cancelInitial();
      unsub();
    };
  }, [isActiveTab, reloadEditions]);

  // Local storage keys for status overrides & listening stats
  const [dnfList, setDnfList] = useState<string[]>([]);
  const [listeningStats, setListeningStats] = useState({ today: 0, week: 0 });

  useEffect(() => {
    if (!isActiveTab) return;
    loadDocuments();
    // Load DNF list
    const dnf = localStorage.getItem("audiobook-dnf-list");
    if (dnf) {
      try {
        setDnfList(JSON.parse(dnf));
      } catch {
        // ignore
      }
    }

    // Load listening stats
    const stats = localStorage.getItem("audiobook-listening-stats-summary");
    if (stats) {
      try {
        setListeningStats(JSON.parse(stats));
      } catch {
        // ignore
      }
    }
  }, [isActiveTab, loadDocuments]);

  // Filter documents to get audiobooks
  const audiobooks = useMemo(() => {
    return documents.filter(isAudiobookDocument);
  }, [documents]);

  // Audio Editions of NON-audio documents (editions of audiobook files are
  // played through the book itself; transcript editions are internal anchor
  // sources and hidden from this shelf).
  const documentEditions = useMemo(() => {
    const docMap = new Map(documents.map((d) => [d.id, d]));
    return editions
      .filter(
        (e) =>
          e.provider !== "transcript" &&
          docMap.has(e.sourceDocumentId) &&
          !isAudiobookDocument(docMap.get(e.sourceDocumentId)!)
      )
      .map((edition) => ({
        edition,
        document: docMap.get(edition.sourceDocumentId),
        job: generationJobs[edition.id],
      }));
  }, [editions, documents, generationJobs]);

  // Enrich books with status derived from progress + manual DNF override
  const enrichedBooks = useMemo(() => {
    return audiobooks.map((book) => {
      let status: "not_started" | "in_progress" | "finished" | "dnf" = "not_started";
      
      if (dnfList.includes(book.id)) {
        status = "dnf";
      } else {
        const progress = book.progressPercent || 0;
        if (progress === 100) {
          status = "finished";
        } else if (progress > 0) {
          status = "in_progress";
        }
      }

      return {
        ...book,
        computedStatus: status,
      };
    });
  }, [audiobooks, dnfList]);

  // Filter and Search
  const filteredBooks = useMemo(() => {
    return enrichedBooks
      .filter((book) => {
        // Status filter
        if (statusFilter !== "all" && book.computedStatus !== statusFilter) {
          return false;
        }

        // Search text
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          const titleMatch = book.title?.toLowerCase().includes(query);
          const authorMatch = book.metadata?.author?.toLowerCase().includes(query);
          const tagsMatch = book.tags?.some((t) => t.toLowerCase().includes(query));
          return titleMatch || authorMatch || tagsMatch;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === "title") {
          return (a.title || "").localeCompare(b.title || "");
        }
        if (sortBy === "author") {
          return (a.metadata?.author || "").localeCompare(b.metadata?.author || "");
        }
        if (sortBy === "duration") {
          const durA = a.metadata?.fileSize || 0; // fallback if no duration
          const durB = b.metadata?.fileSize || 0;
          return durB - durA;
        }
        if (sortBy === "progress") {
          return (b.progressPercent || 0) - (a.progressPercent || 0);
        }
        // Default: dateAdded desc
        return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
      });
  }, [enrichedBooks, statusFilter, searchQuery, sortBy]);

  // Calculations for Stats Dashboard
  const stats = useMemo(() => {
    const total = enrichedBooks.length;
    const completed = enrichedBooks.filter((b) => b.computedStatus === "finished").length;
    const inProgress = enrichedBooks.filter((b) => b.computedStatus === "in_progress").length;
    
    return {
      total,
      completed,
      inProgress,
      todayMins: Math.round(listeningStats.today / 60),
      weekMins: Math.round(listeningStats.week / 60),
    };
  }, [enrichedBooks, listeningStats]);

  const handleOpenBook = (book: Document) => {
    addTab({
      title: book.title,
      icon: <Headphones className="w-4 h-4 text-primary" />,
      type: "document-viewer",
      content: DocumentViewer,
      closable: true,
      data: { documentId: book.id },
    }, paneId);
  };

  /** Open a document directly in the Audio Edition player (task 4.3). */
  const handleListenToEdition = (
    doc: Document | undefined,
    edition: AudioEdition,
    fromSeconds = 0
  ) => {
    if (!doc) return;
    addTab({
      title: doc.title,
      icon: <Headphones className="w-4 h-4 text-primary" />,
      type: "document-viewer",
      content: DocumentViewer,
      closable: true,
      data: {
        documentId: doc.id,
        listenToEdition: true,
        autoPlay: true,
        initialJump: { kind: "audio", timeSeconds: fromSeconds },
      },
    }, paneId);
  };

  const handleToggleDnf = (id: string, isCurrentlyDnf: boolean) => {
    let updated: string[];
    if (isCurrentlyDnf) {
      updated = dnfList.filter((item) => item !== id);
    } else {
      updated = [...dnfList, id];
    }
    setDnfList(updated);
    localStorage.setItem("audiobook-dnf-list", JSON.stringify(updated));
  };

  const handleDeleteBook = async (id: string) => {
    const confirmed = await modal.confirm(
      "Are you sure you want to delete this audiobook from your library?",
      "Delete Audiobook",
      { variant: "danger", confirmText: "Delete" }
    );
    if (confirmed) {
      await deleteDocument(id);
      loadDocuments();
    }
  };

  const handleDeleteAudioEdition = useCallback(
    async (edition: AudioEdition, doc?: Document) => {
      const title = doc?.title ?? "this document";
      const confirmed = await modal.confirm(
        `Are you sure you want to delete the audio edition for "${title}"? This will permanently delete all synthesized audio files for this edition.`,
        "Delete Audio Edition",
        { variant: "danger", confirmText: "Delete" }
      );
      if (!confirmed) return;

      try {
        const job = generationJobs[edition.id];
        if (job && (job.status === "generating" || job.status === "paused")) {
          await useAudioEditionGenerationStore.getState().cancelJob(edition.id);
        }
        await deleteAudioEdition(edition.id);
        reloadEditions();
        toast.success("Audio edition deleted");
      } catch (err: any) {
        console.error("Failed to delete audio edition:", err);
        toast.error("Failed to delete audio edition", err?.message);
      }
    },
    [generationJobs, modal, reloadEditions, toast]
  );

  const handleOpenSourceDocument = useCallback(
    (doc?: Document) => {
      if (!doc) return;
      addTab(
        {
          title: doc.title,
          icon: <BookOpen className="w-4 h-4 text-primary" />,
          type: "document-viewer",
          content: DocumentViewer,
          closable: true,
          data: { documentId: doc.id },
        },
        paneId
      );
    },
    [addTab, paneId]
  );

  const showEditionContextMenu = useCallback(
    (
      position: { x: number; y: number },
      edition: AudioEdition,
      doc?: Document,
      job?: GenerationJob
    ) => {
      const sections = edition.sections ?? [];
      const readyCount = sections.filter((s) => s.generationStatus === "ready").length;
      const canPlay = readyCount > 0;
      const isGenerating = job ? job.status === "generating" : edition.status === "generating";
      const isPaused = job?.status === "paused";
      const isFailed = job ? job.status === "error" : edition.status === "failed";
      const hasFailedSections = sections.some((s) => s.generationStatus === "failed");
      const canResume = isPaused || (!isGenerating && readyCount < sections.length);

      const items: ContextMenuItem[] = [
        {
          id: "play",
          label: "Listen to Audio Edition",
          icon: <Play className="w-4 h-4 fill-current" />,
          disabled: !canPlay,
          onClick: () => {
            handleListenToEdition(doc, edition);
          },
        },
        {
          id: "play-beginning",
          label: "Listen from Beginning",
          icon: <ArrowCounterClockwise className="w-4 h-4" />,
          disabled: !canPlay,
          onClick: () => {
            handleListenToEdition(doc, edition, 0);
          },
        },
        {
          id: "open-source-doc",
          label: "Open Source Document",
          icon: <BookOpen className="w-4 h-4" />,
          disabled: !doc,
          onClick: () => {
            handleOpenSourceDocument(doc);
          },
        },
        { id: "sep-gen", type: ContextMenuItemType.Separator, label: "" },
      ];

      if (isGenerating) {
        items.push({
          id: "pause-gen",
          label: "Pause Generation",
          icon: <Pause className="w-4 h-4" />,
          onClick: () => {
            useAudioEditionGenerationStore.getState().pauseJob(edition.id);
          },
        });
        items.push({
          id: "cancel-gen",
          label: "Cancel Generation",
          icon: <X className="w-4 h-4" />,
          onClick: async () => {
            await useAudioEditionGenerationStore.getState().cancelJob(edition.id);
            reloadEditions();
          },
        });
      } else if (canResume) {
        items.push({
          id: "resume-gen",
          label: "Resume Generation",
          icon: <Play className="w-4 h-4 fill-current" />,
          onClick: async () => {
            await useAudioEditionGenerationStore.getState().resumeJob(edition.id);
          },
        });
        if (isPaused) {
          items.push({
            id: "cancel-gen",
            label: "Cancel Generation",
            icon: <X className="w-4 h-4" />,
            onClick: async () => {
              await useAudioEditionGenerationStore.getState().cancelJob(edition.id);
              reloadEditions();
            },
          });
        }
      }

      if (isFailed || hasFailedSections) {
        items.push({
          id: "retry-gen",
          label: "Retry Failed Sections",
          icon: <ArrowClockwise className="w-4 h-4" />,
          onClick: async () => {
            await useAudioEditionGenerationStore.getState().retryFailedSections(edition.id);
          },
        });
      }

      if (doc) {
        items.push({
          id: "reconfigure",
          label: "Recreate / New Edition Settings...",
          icon: <SpeakerHigh className="w-4 h-4" />,
          onClick: () => {
            setConfigureDoc(doc);
          },
        });
      }

      items.push({ id: "sep-info", type: ContextMenuItemType.Separator, label: "" });

      items.push({
        id: "copy-title",
        label: "Copy Title",
        icon: <Copy className="w-4 h-4" />,
        onClick: () => {
          const title = doc?.title ?? "Document";
          void navigator.clipboard.writeText(title);
          toast.success("Title copied to clipboard");
        },
      });

      items.push({
        id: "copy-details",
        label: "Copy Edition Details",
        icon: <Info className="w-4 h-4" />,
        onClick: () => {
          const details = `${doc?.title ?? "Document"} — ${edition.provider}/${edition.model} (${edition.voice || "default"}), ${readyCount}/${sections.length} sections ready`;
          void navigator.clipboard.writeText(details);
          toast.success("Edition details copied to clipboard");
        },
      });

      items.push({ id: "sep-danger", type: ContextMenuItemType.Separator, label: "" });

      items.push({
        id: "delete-edition",
        label: "Delete Audio Edition",
        icon: <Trash className="w-4 h-4 text-destructive" />,
        type: ContextMenuItemType.Danger,
        onClick: () => {
          void handleDeleteAudioEdition(edition, doc);
        },
      });

      editionContextMenu.showMenu(position, items);
    },
    [
      editionContextMenu,
      handleDeleteAudioEdition,
      handleListenToEdition,
      handleOpenSourceDocument,
      reloadEditions,
      toast,
    ]
  );

  const handleEditionContextMenu = useCallback(
    (
      e: React.MouseEvent,
      edition: AudioEdition,
      doc?: Document,
      job?: GenerationJob
    ) => {
      e.preventDefault();
      e.stopPropagation();
      showEditionContextMenu({ x: e.clientX, y: e.clientY }, edition, doc, job);
    },
    [showEditionContextMenu]
  );

  const handleDotsClick = useCallback(
    (
      e: React.MouseEvent,
      edition: AudioEdition,
      doc?: Document,
      job?: GenerationJob
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      showEditionContextMenu({ x: rect.left, y: rect.bottom + 4 }, edition, doc, job);
    },
    [showEditionContextMenu]
  );

  // Generate cover art fallback style
  const getCoverFallbackStyle = (title: string) => {
    const hues = [200, 240, 280, 320, 360, 40];
    const sum = title.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hue = hues[sum % hues.length];
    return {
      background: `linear-gradient(135deg, hsl(${hue}, 70%, 40%), hsl(${(hue + 60) % 360}, 70%, 20%))`,
    };
  };

  return (
    <div className="h-full flex flex-col bg-background text-foreground overflow-y-auto p-6 md:p-8">
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
            Audiobooks Shelf
          </h1>
          <p className="text-muted-foreground mt-1">
            Listen, track progress, and practice incremental reading of audiobooks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsImportOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 border border-border bg-card text-foreground font-semibold rounded-lg hover:bg-muted transition-colors"
          >
            <Plus className="w-5 h-5 font-bold" />
            Import Audiobook
          </button>
        </div>
      </div>

      {/* Statistics Dashboard */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="p-5 bg-card border border-border rounded-xl flex items-center gap-4">
          <div className="p-3 rounded-lg bg-primary/10 text-primary">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Today's Listening</div>
            <div className="text-2xl font-bold">{stats.todayMins}m</div>
          </div>
        </div>
        
        <div className="p-5 bg-card border border-border rounded-xl flex items-center gap-4">
          <div className="p-3 rounded-lg bg-purple-500/10 text-purple-500">
            <TrendUp className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">This Week</div>
            <div className="text-2xl font-bold">{stats.weekMins}m</div>
          </div>
        </div>

        <div className="p-5 bg-card border border-border rounded-xl flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-500/10 text-blue-500">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Total Books</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
        </div>

        <div className="p-5 bg-card border border-border rounded-xl flex items-center gap-4">
          <div className="p-3 rounded-lg bg-green-500/10 text-green-500">
            <CheckCircle className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Completed</div>
            <div className="text-2xl font-bold">{stats.completed}</div>
          </div>
        </div>
      </div>

      {/* Toolbar / Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 mb-6 bg-card border border-border rounded-xl">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by title, author, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Filters and sorting */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 bg-background border border-border rounded-lg p-1">
            {(["all", "not_started", "in_progress", "finished", "dnf"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors",
                  statusFilter === status
                    ? "bg-card text-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {status.replace("_", " ")}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 bg-background border border-border rounded-lg text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="dateAdded">Recently Added</option>
              <option value="title">Title</option>
              <option value="author">Author</option>
              <option value="duration">Duration</option>
              <option value="progress">Progress</option>
            </select>
          </div>
        </div>
      </div>

      {/* Document Audio Editions shelf (task 4.3) — editions of text
          documents (EPUB/PDF/articles) with generation badges and playback
          controls. The transcript-provider entries are implicit per-book
          anchor sources, not listenable editions, so they are hidden. */}
      {documentEditions.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <SpeakerHigh className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Audio Editions ({documentEditions.length})
            </h2>
            <span className="text-xs text-muted-foreground">
              — TTS editions of documents in your library
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {documentEditions.map(({ edition, document: doc, job }) => {
              const sections = edition.sections ?? [];
              const readyCount = sections.filter((s) => s.generationStatus === "ready").length;
              const totalDuration = sections.reduce((acc, s) => acc + (s.durationSec || 0), 0);

              const isGenerating = job ? job.status === "generating" : edition.status === "generating";
              const isPaused = job?.status === "paused";
              const isFailed = job ? job.status === "error" : edition.status === "failed";
              const isCompleted =
                (job ? job.status === "completed" : edition.status === "ready") ||
                (readyCount > 0 && readyCount === sections.length && !isGenerating && !isPaused && !isFailed);

              const progressPercent =
                job?.progressPercent ??
                (sections.length > 0 ? Math.round((readyCount / sections.length) * 100) : 0);

              let badge: { label: string; cls: string };
              if (isGenerating) {
                badge = {
                  label: `Generating ${progressPercent}%`,
                  cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
                };
              } else if (isPaused) {
                badge = {
                  label: `Paused (${progressPercent}%)`,
                  cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
                };
              } else if (isCompleted) {
                badge = {
                  label: `${readyCount}/${sections.length} ready`,
                  cls: "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20",
                };
              } else if (isFailed) {
                badge = {
                  label: "Failed",
                  cls: "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20",
                };
              } else if (readyCount > 0) {
                badge = {
                  label: `${readyCount}/${sections.length} ready`,
                  cls: "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20",
                };
              } else {
                badge = {
                  label: edition.status || "Draft",
                  cls: "bg-muted text-muted-foreground",
                };
              }
              const canPlay = readyCount > 0;

              return (
                <div
                  key={edition.id}
                  data-testid={`edition-card-${edition.id}`}
                  onContextMenu={(e) => handleEditionContextMenu(e, edition, doc, job)}
                  className="flex flex-col gap-2 p-3 bg-card border border-border rounded-xl hover:border-primary/40 transition-colors select-none"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{doc?.title ?? "Document"}</span>
                        <span
                          data-testid={`edition-status-badge-${edition.id}`}
                          className={cn("px-1.5 py-0.5 text-[10px] font-semibold rounded shrink-0", badge.cls)}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {edition.provider}/{edition.model} · {formatDuration(totalDuration)}
                        {job ? ` · ${job.completedSections}/${job.totalSections} sections` : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isGenerating && (
                        <button
                          onClick={() => useAudioEditionGenerationStore.getState().pauseJob(edition.id)}
                          title="Pause generation"
                          aria-label="Pause generation"
                          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pause className="w-4 h-4" />
                        </button>
                      )}
                      {isPaused && (
                        <button
                          onClick={() => void useAudioEditionGenerationStore.getState().resumeJob(edition.id)}
                          title="Resume generation"
                          aria-label="Resume generation"
                          className="p-2 rounded-lg hover:bg-muted text-primary transition-colors"
                        >
                          <Play className="w-4 h-4 fill-current" />
                        </button>
                      )}
                      {(isGenerating || isPaused) && (
                        <button
                          onClick={() => void useAudioEditionGenerationStore.getState().cancelJob(edition.id)}
                          title="Cancel generation"
                          aria-label="Cancel generation"
                          className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                      {isFailed && (
                        <button
                          onClick={() => void useAudioEditionGenerationStore.getState().retryFailedSections(edition.id)}
                          title="Retry failed sections"
                          aria-label="Retry failed sections"
                          className="p-2 rounded-lg hover:bg-muted text-amber-600 transition-colors"
                        >
                          <ArrowClockwise className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleListenToEdition(doc, edition)}
                        disabled={!canPlay}
                        title={canPlay ? "Listen to Audio Edition" : "No sections generated yet"}
                        aria-label={`Listen to audio edition of ${doc?.title ?? "document"}`}
                        className={cn(
                          "p-2.5 rounded-full transition-all shrink-0 ml-1",
                          canPlay
                            ? "bg-primary text-primary-foreground hover:scale-105"
                            : "bg-muted text-muted-foreground/40 cursor-not-allowed"
                        )}
                      >
                        <Play className="w-4 h-4 fill-current" />
                      </button>
                      <button
                        onClick={(e) => handleDotsClick(e, edition, doc, job)}
                        title="More options"
                        aria-label={`More options for audio edition of ${doc?.title ?? "document"}`}
                        data-testid={`edition-menu-button-${edition.id}`}
                        className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-0.5"
                      >
                        <DotsThreeVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Progress bar and section status */}
                  {(isGenerating || isPaused || (job && job.status === "error" && job.completedSections < job.totalSections)) && (
                    <div className="pt-1 border-t border-border/50">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                        <span>
                          {job?.currentSectionId
                            ? `Section ${(job.completedSections ?? 0) + 1} of ${job.totalSections ?? sections.length}`
                            : `${job?.completedSections ?? readyCount} of ${job?.totalSections ?? sections.length} sections`}
                        </span>
                        <span className="font-mono">{progressPercent}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full transition-all duration-300 rounded-full",
                            isPaused ? "bg-amber-500" : isFailed ? "bg-red-500" : "bg-primary"
                          )}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bookshelf Shelf Cover Grid */}
      {filteredBooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground bg-card border border-dashed border-border rounded-xl">
          <Headphones className="w-16 h-16 mb-4 opacity-40 text-primary" />
          <h3 className="text-lg font-semibold mb-1">No audiobooks found</h3>
          <p className="text-sm max-w-sm">
            {searchQuery || statusFilter !== "all"
              ? "Try adjusting your filters or search query."
              : "Import an audiobook file (MP3, M4B) to add it to your bookshelf."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {filteredBooks.map((book) => {
            const isDnf = book.computedStatus === "dnf";
            const progress = book.progressPercent || 0;
            const initials = book.title?.substring(0, 2).toUpperCase() || "AB";
            const hasCover = !!book.coverImageUrl;

            return (
              <div
                key={book.id}
                className="group relative flex flex-col bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300"
              >
                {/* Cover Art Box */}
                <div className="aspect-[3/4] bg-muted relative overflow-hidden flex items-center justify-center">
                  {hasCover ? (
                    <img
                      src={book.coverImageUrl}
                      alt={book.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div
                      style={getCoverFallbackStyle(book.title)}
                      className="w-full h-full flex flex-col items-center justify-center p-4 text-center select-none"
                    >
                      <span className="text-3xl font-extrabold text-white/50 mb-2">{initials}</span>
                      <Headphones className="w-8 h-8 text-white/40" />
                    </div>
                  )}

                  {/* Play Overlay */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={() => handleOpenBook(book)}
                      className="p-3 bg-primary text-primary-foreground rounded-full hover:scale-110 transition-transform"
                      title="Play Audiobook"
                    >
                      <Play className="w-6 h-6 fill-current" />
                    </button>
                  </div>

                  {/* Status Tag */}
                  <div className="absolute top-2 left-2 flex gap-1">
                    <span
                      className={cn(
                        "px-2 py-0.5 text-[10px] font-bold rounded shadow-sm uppercase tracking-wider text-white",
                        book.computedStatus === "finished" && "bg-green-600",
                        book.computedStatus === "in_progress" && "bg-blue-600",
                        book.computedStatus === "not_started" && "bg-gray-600",
                        book.computedStatus === "dnf" && "bg-orange-600"
                      )}
                    >
                      {book.computedStatus.replace("_", " ")}
                    </span>
                  </div>

                  {/* Actions Dropdown / Context hover */}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleToggleDnf(book.id, isDnf)}
                      className="p-1.5 bg-black/70 hover:bg-orange-600 text-white rounded transition-colors"
                      title={isDnf ? "Remove DNF Status" : "Mark as DNF (Did Not Finish)"}
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteBook(book.id)}
                      className="p-1.5 bg-black/70 hover:bg-red-600 text-white rounded transition-colors"
                      title="Delete book"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Duration Overlay */}
                  {book.metadata?.fileSize && (
                    <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 text-white text-[10px] font-semibold rounded">
                      {formatDuration(book.metadata.fileSize / 128000)} {/* rough approximation */}
                    </div>
                  )}

                  {/* Progress Line */}
                  <div className="absolute bottom-0 left-0 w-full h-1 bg-black/30">
                    <div
                      style={{ width: `${progress}%` }}
                      className="h-full bg-gradient-to-r from-primary to-purple-500"
                    />
                  </div>
                </div>

                {/* Metadata Details */}
                <div className="p-3 flex-1 flex flex-col justify-between min-w-0">
                  <div className="min-w-0">
                    <h4
                      onClick={() => handleOpenBook(book)}
                      className="text-sm font-semibold text-foreground truncate hover:text-primary cursor-pointer"
                      title={book.title}
                    >
                      {book.title}
                    </h4>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {book.metadata?.author || "Unknown Author"}
                    </p>
                  </div>
                  
                  {/* Progress Stats */}
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-2 border-t border-border/40 pt-2">
                    <span>Progress: {progress}%</span>
                    {book.currentPage && book.currentPage > 0 ? (
                      <span>{Math.round(book.currentPage / 60)}m read</span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Audio Edition Context Menu */}
      <ContextMenu
        menuId="audio-edition-context-menu"
        items={editionContextMenu.items}
        visible={editionContextMenu.visible}
        position={editionContextMenu.position}
        onClose={editionContextMenu.hideMenu}
      />

      {/* Configure & Recreate Dialog */}
      {configureDoc && (
        <CreateAudioEditionDialog
          isOpen={Boolean(configureDoc)}
          onClose={() => setConfigureDoc(null)}
          document={configureDoc}
          onCreated={() => {
            setConfigureDoc(null);
            reloadEditions();
            toast.success("Audio edition created");
          }}
        />
      )}

      {/* Import dialog */}
      <AudiobookImportDialog
        isOpen={isImportOpen}
        onClose={() => {
          setIsImportOpen(false);
          loadDocuments();
        }}
        onOpenDocument={handleOpenBook}
      />
    </div>
  );
}
