import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowsVertical,
  CaretDown,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Clock,
  Copy,
  DotsThreeVertical,
  Download,
  Flame,
  FolderOpen,
  GraduationCap,
  MagnifyingGlass,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Prohibit,
  Stack,
  Tag,
  Target,
  Trash,
  Tray,
  Upload,
  X,
} from "@phosphor-icons/react";
import { useStudyDeckStore } from "../../stores/studyDeckStore";
import { useReviewStore } from "../../stores/reviewStore";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../common/Toast";
import { useConfirmDialog, ConfirmDialog } from "../common/ConfirmDialog";
import { getAllLearningItems, createLearningItem, exportDeckAsApkg, exportDeckAsCsv, type LearningItem } from "../../api/learning-items";
import { bulkSuspendItems, bulkUnsuspendItems, bulkDeleteItems } from "../../api/queue";
import { matchesDeck, swapDeckTags, shouldEnsureBrowserExtensionDeck } from "../../utils/studyDecks";
import { inferAnkiDeckNames } from "../../utils/ankiImport";
import { DynamicVirtualList } from "../common/VirtualList";
import { DeckManagerCardRow } from "./DeckManagerCardRow";
import { deleteLearningItem } from "../../lib/database";
// InlineCardEditor moved to CardPreviewPanel Edit tab
import { CardPreviewPanel } from "./CardPreviewPanel";
import { MobileCardDetailsSurface } from "./MobileCardDetailsSurface";
import { useResizablePanels } from "./useResizablePanels";
import { DeckStatsPanel } from "./DeckStatsPanel";
import { useMobileShell } from "../../hooks/useMobileShell";
import { useOverlayDismissal } from "../../hooks/useOverlayDismissal";
import type { StudyDeck } from "../../types/study-decks";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import { ResponsiveBulkActionBar, type BulkActionItem } from "../common/ResponsiveBulkActionBar";
import {
  DECK_MANAGER_CATEGORIES,
  DECK_MANAGER_SORTS,
  getDeckManagerCategoryCounts,
  matchesDeckManagerCategory,
  sortDeckManagerCards,
  type DeckManagerCategory,
  type DeckManagerSortDirection,
  type DeckManagerSortField,
} from "./deckManagerModel";

type SortField = DeckManagerSortField;
type SortDir = DeckManagerSortDirection;
type StateFilter = DeckManagerCategory;
type MobileSurface = "deck-picker" | "filters" | "actions" | "statistics" | "export" | "rename" | "retag";

interface DeckManagerProps {
  onBack: () => void;
  onStartReview?: () => Promise<void>;
  onEditInStudio?: (card: LearningItem) => void;
}

export function DeckManager({ onBack, onStartReview, onEditInStudio }: DeckManagerProps) {
  const { t } = useI18n();
  const toast = useToast();
  const confirmDialog = useConfirmDialog();
  const { decks, updateDeck, removeDeck, addDeck } = useStudyDeckStore();
  const selectedDeckId = useReviewStore((state) => state.selectedDeckId);
  const setSelectedDeckId = useReviewStore((state) => state.setSelectedDeckId);

  const sortedDecks = useMemo(() => {
    return [...(decks || [])].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
    );
  }, [decks]);

  const [allCards, setAllCards] = useState<LearningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDeckId, setExpandedDeckId] = useState<string | null>(selectedDeckId);

  useEffect(() => {
    if (selectedDeckId) {
      setExpandedDeckId(selectedDeckId);
      setSelectedDeckId(null);
    }
  }, [selectedDeckId, setSelectedDeckId]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [sortField, setSortField] = useState<SortField>("due_date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [stateFilter, setStateFilter] = useState<StateFilter>("");
  const [mobileSurface, setMobileSurface] = useState<MobileSurface | null>(null);
  const [deckPickerQuery, setDeckPickerQuery] = useState("");
  const [filterDraft, setFilterDraft] = useState<StateFilter>("");
  const [sortFieldDraft, setSortFieldDraft] = useState<SortField>("due_date");
  const [sortDirDraft, setSortDirDraft] = useState<SortDir>("asc");
  const [addRetagTags, setAddRetagTags] = useState("");
  const [removeRetagTags, setRemoveRetagTags] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showExportPicker, setShowExportPicker] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ deckId: string; x: number; y: number } | null>(null);
  const [renamingDeckId, setRenamingDeckId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [rightPanelView, setRightPanelView] = useState<"preview" | "stats">("preview");
  const isMobile = useMobileShell();
  const [mobileCardOpen, setMobileCardOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const previousMobileRef = useRef(isMobile);
  const { widths, containerRef, handlePointerDown } = useResizablePanels();

  // Load all learning items (extracted for reuse after card creation)
  const loadAllItems = useCallback(async () => {
    setLoading(true);
    try {
      const cards = await getAllLearningItems();
      setAllCards(Array.isArray(cards) ? cards : []);
    } catch {
      toast.error("Failed to load cards");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadAllItems();
  }, [loadAllItems]);

  // Ensure a "Browser Extension" deck exists once per mount when extension-
  // imported cards are present, so they are surfaced without manual setup.
  // Detection is by tag filter, not by name, so a renamed deck is not
  // duplicated. Guarded by a ref so a user deletion is respected for the
  // remainder of the session (the deck reappears on the next visit).
  const ensuredBrowserDeckRef = useRef(false);
  useEffect(() => {
    if (ensuredBrowserDeckRef.current) return;
    if (loading) return;
    if (allCards.length === 0) return;
    if (!shouldEnsureBrowserExtensionDeck(allCards, decks)) {
      ensuredBrowserDeckRef.current = true;
      return;
    }
    addDeck(
      t("review.deckManager.browserExtensionDeckName"),
      ["browser-extension"],
      undefined,
      "tags",
    );
    ensuredBrowserDeckRef.current = true;
  }, [loading, allCards, decks, addDeck, t]);

  // Repair card-only Anki imports that predate automatic study-deck creation.
  // Keep the once-per-mount guard so deleting a deck is respected until the
  // user leaves this surface, matching Browser Extension deck behavior.
  const ensuredAnkiDecksRef = useRef(false);
  useEffect(() => {
    if (ensuredAnkiDecksRef.current || loading) return;
    const names = inferAnkiDeckNames(allCards);
    if (names.length > 0) {
      useStudyDeckStore.getState().ensureDecksExist(names);
    }
    ensuredAnkiDecksRef.current = true;
  }, [loading, allCards]);

  useEffect(() => {
    const pendingCardId = sessionStorage.getItem("plethora:pending-flashcard-id");
    if (!pendingCardId || allCards.length === 0) return;
    if (allCards.some((card) => card.id === pendingCardId)) {
      setPreviewCardId(pendingCardId);
      setRightPanelView("preview");
      if (isMobile) setMobileCardOpen(true);
    }
    sessionStorage.removeItem("plethora:pending-flashcard-id");
  }, [allCards, isMobile]);

  // On mobile, auto-select first deck when cards load and none is selected
  useEffect(() => {
    if (isMobile && !loading && decks.length > 0 && !expandedDeckId) {
      setExpandedDeckId(decks[0].id);
    }
  }, [isMobile, loading, decks, expandedDeckId]);

  const getCardsForDeck = useCallback(
    (deck: StudyDeck): LearningItem[] => {
      return allCards.filter((card) => matchesDeck(card, deck));
    },
    [allCards]
  );

  // Compute counts per deck
  const deckCardCounts = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10);
    const map = new Map<string, { total: number; dueToday: number; suspended: number; leeches: number; newCards: number; learning: number; review: number; relearning: number }>();
    for (const deck of decks) {
      const cards = getCardsForDeck(deck);
      map.set(deck.id, {
        total: cards.length,
        dueToday: cards.filter((c) => !c.is_suspended && c.due_date?.slice(0, 10) <= now).length,
        suspended: cards.filter((c) => c.is_suspended).length,
        leeches: cards.filter((c) => c.lapses >= 5).length,
        newCards: cards.filter((c) => c.state === "New").length,
        learning: cards.filter((c) => c.state === "Learning").length,
        review: cards.filter((c) => c.state === "Review").length,
        relearning: cards.filter((c) => c.state === "Relearning").length,
      });
    }
    return map;
  }, [decks, getCardsForDeck]);

  const expandedDeck = decks.find((d) => d.id === expandedDeckId) ?? null;
  const expandedCards = useMemo(() => {
    if (!expandedDeck) return [];
    let cards = getCardsForDeck(expandedDeck);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      cards = cards.filter(
        (c) =>
          c.question.toLowerCase().includes(q) ||
          c.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    cards = cards.filter((card) => matchesDeckManagerCategory(card, stateFilter));
    return sortDeckManagerCards(cards, sortField, sortDir);
  }, [
    expandedDeck,
    getCardsForDeck,
    searchQuery,
    stateFilter,
    sortField,
    sortDir,
  ]);

  const previewCard = previewCardId
    ? expandedCards.find((c) => c.id === previewCardId) ?? null
    : null;

  // State filter counts for the active deck
  const stateFilterCounts = useMemo(() => {
    if (!expandedDeck) return getDeckManagerCategoryCounts([]);
    return getDeckManagerCategoryCounts(getCardsForDeck(expandedDeck));
  }, [expandedDeck, getCardsForDeck]);

  const scrollListToTop = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    if (typeof list.scrollTo === "function") list.scrollTo({ top: 0 });
    else list.scrollTop = 0;
  }, []);

  const handleSwitchDeck = useCallback((deckId: string | null) => {
    if (deckId === expandedDeckId) {
      setMobileSurface(null);
      return;
    }
    setExpandedDeckId(deckId);
    setSearchQuery("");
    setStateFilter("");
    setSelectedIds(new Set());
    setSelectionMode(false);
    setPreviewCardId(null);
    setMobileCardOpen(false);
    setMobileSurface(null);
    scrollListToTop();
  }, [expandedDeckId, scrollListToTop]);

  const handleSearchChange = useCallback((query: string) => {
    if (query !== searchQuery) setSelectedIds(new Set());
    setSearchQuery(query);
    scrollListToTop();
  }, [searchQuery, scrollListToTop]);

  const handleStateFilterChange = useCallback((category: StateFilter) => {
    if (category !== stateFilter) setSelectedIds(new Set());
    setStateFilter(category);
    scrollListToTop();
  }, [stateFilter, scrollListToTop]);

  const applyFilterDraft = useCallback(() => {
    if (filterDraft !== stateFilter) setSelectedIds(new Set());
    setStateFilter(filterDraft);
    setSortField(sortFieldDraft);
    setSortDir(sortDirDraft);
    setMobileSurface(null);
    scrollListToTop();
  }, [filterDraft, stateFilter, sortFieldDraft, sortDirDraft, scrollListToTop]);

  useEffect(() => {
    if (expandedDeckId && !decks.some((deck) => deck.id === expandedDeckId)) {
      setExpandedDeckId(isMobile ? sortedDecks[0]?.id ?? null : null);
      setSearchQuery("");
      setStateFilter("");
      setSelectedIds(new Set());
      setSelectionMode(false);
      setPreviewCardId(null);
      setMobileCardOpen(false);
      setMobileSurface(null);
      scrollListToTop();
    }
  }, [expandedDeckId, decks, sortedDecks, isMobile, scrollListToTop]);

  useEffect(() => {
    if (previousMobileRef.current === isMobile) return;
    previousMobileRef.current = isMobile;
    setMobileSurface(null);
    setSelectedIds(new Set());
    setSelectionMode(false);
    setMobileCardOpen(false);
  }, [isMobile]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (expandedCards.length > 0 && expandedCards.every((card) => selectedIds.has(card.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(expandedCards.map((c) => c.id)));
    }
  }, [selectedIds, expandedCards]);

  const enterSelectionMode = useCallback(() => {
    setMobileSurface(null);
    setSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, []);

  useOverlayDismissal(isMobile && selectionMode && mobileSurface === null, exitSelectionMode, 20);

  const openFilterSheet = useCallback(() => {
    setFilterDraft(stateFilter);
    setSortFieldDraft(sortField);
    setSortDirDraft(sortDir);
    setMobileSurface("filters");
  }, [stateFilter, sortField, sortDir]);

  const openDeckPicker = useCallback(() => {
    setDeckPickerQuery("");
    setMobileSurface("deck-picker");
  }, []);

  const openMobileActions = useCallback(() => setMobileSurface("actions"), []);

  const clearSearchAndFilters = useCallback(() => {
    handleSearchChange("");
    handleStateFilterChange("");
    setSelectedIds(new Set());
  }, [handleSearchChange, handleStateFilterChange]);

  const handleExpandCard = useCallback(
    (id: string) => {
      setPreviewCardId((prev) => (isMobile ? id : prev === id ? null : id));
      if (isMobile) setMobileCardOpen(true);
    },
    [isMobile]
  );

  const handleCardSave = useCallback(
    (updated: LearningItem) => {
      setAllCards((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
    },
    []
  );

  const handleBulkSuspend = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await bulkSuspendItems(ids);
      setAllCards((prev) =>
        prev.map((c) => (ids.includes(c.id) ? { ...c, is_suspended: true } : c))
      );
      toast.success(`Suspended ${ids.length} cards`);
      setSelectedIds(new Set());
    } catch {
      toast.error("Failed to suspend cards");
    }
  }, [selectedIds, toast]);

  const handleBulkUnsuspend = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await bulkUnsuspendItems(ids);
      setAllCards((prev) =>
        prev.map((c) =>
          ids.includes(c.id) ? { ...c, is_suspended: false } : c
        )
      );
      toast.success(`Unsuspended ${ids.length} cards`);
      setSelectedIds(new Set());
    } catch {
      toast.error("Failed to unsuspend cards");
    }
  }, [selectedIds, toast]);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await bulkDeleteItems(ids);
      setAllCards((prev) => prev.filter((c) => !ids.includes(c.id)));
      toast.success(`Deleted ${ids.length} cards`);
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    } catch {
      toast.error("Failed to delete cards");
    }
  }, [selectedIds, toast]);

  const handleBulkRetag = useCallback(
    async (tagsToAdd: string[], tagsToRemove: string[]) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      setAllCards((prev) =>
        prev.map((c) => {
          if (!ids.includes(c.id)) return c;
          let newTags = [...c.tags];
          for (const tag of tagsToAdd) {
            if (!newTags.includes(tag)) newTags.push(tag);
          }
          newTags = newTags.filter((t) => !tagsToRemove.includes(t));
          return { ...c, tags: newTags };
        })
      );
      setSelectedIds(new Set());
      setMobileSurface(null);
      toast.success(`Retagged ${ids.length} cards`);
    },
    [selectedIds, toast]
  );

  const handleLeechFilter = useCallback(() => {
    handleStateFilterChange("Leeches");
    setSortField("lapses");
    setSortDir("desc");
  }, [handleStateFilterChange]);

  const handleNewCard = useCallback(async () => {
    if (!expandedDeck) return;
    setMobileSurface(null);
    try {
      const newCard = await createLearningItem({
        item_type: "basic",
        question: "",
        answer: "",
        tags: expandedDeck.tagFilters.length > 0 ? expandedDeck.tagFilters : undefined,
        allow_duplicate: true,
      });
      toast.success(t("review.deckManager.newCardCreated"), t("review.deckManager.editCardInPanel"));
      // Select the new card and open edit tab
      setPreviewCardId(newCard.id);
      setRightPanelView("preview");
      // Reload to pick up the new card in the deck
      await loadAllItems();
      if (isMobile) setMobileCardOpen(true);
    } catch (error) {
      console.error("Failed to create card:", error);
      toast.error(t("common.error"), error instanceof Error ? error.message : "Failed to create card");
    }
  }, [expandedDeck, toast, t, loadAllItems, isMobile]);

  const handleStudyNow = useCallback(async () => {
    if (!expandedDeck || !onStartReview) return;
    try {
      const store = useStudyDeckStore.getState();
      store.clearDeckSelection();
      store.toggleDeckSelection(expandedDeck.id);
      await onStartReview();
    } catch (error) {
      console.error("Failed to start review:", error);
      toast.error(t("common.error"), error instanceof Error ? error.message : "Failed to start review");
    }
  }, [expandedDeck, onStartReview, toast, t]);

  // Context menu handlers for deck right-click
  const handleDeckContextMenu = useCallback((e: React.MouseEvent, deckId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ deckId, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleDeckRename = useCallback((deckId: string) => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;
    setRenamingDeckId(deckId);
    setRenameValue(deck.name);
    setContextMenu(null);
    if (isMobile) setMobileSurface("rename");
  }, [decks, isMobile]);

  const commitRename = useCallback(() => {
    if (renamingDeckId && renameValue.trim()) {
      updateDeck(renamingDeckId, { name: renameValue.trim() });
    }
    setRenamingDeckId(null);
    setRenameValue("");
    setMobileSurface(null);
  }, [renamingDeckId, renameValue, updateDeck]);

  const handleDeckDuplicate = useCallback((deckId: string) => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;
    addDeck(`${deck.name} (copy)`, deck.tagFilters);
    setContextMenu(null);
    setMobileSurface(null);
    toast.success(`Duplicated deck "${deck.name}"`);
  }, [decks, addDeck, toast]);

  const handleDeckDelete = useCallback((deckId: string) => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;
    setContextMenu(null);
    setMobileSurface(null);
    confirmDialog.confirm({
      title: t("deckManager.deleteDeck"),
      message: t("deckManager.deleteDeckConfirm", { name: deck.name }),
      variant: "danger",
      onConfirm: () => {
        removeDeck(deckId);
        if (expandedDeckId === deckId) handleSwitchDeck(null);
        toast.success(`Deleted deck "${deck.name}"`);
      },
    });
  }, [decks, removeDeck, expandedDeckId, handleSwitchDeck, toast, confirmDialog, t]);

  const handleDeckStudy = useCallback(async (deckId: string) => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;
    setContextMenu(null);
    // Select this deck in the study deck store
    const store = useStudyDeckStore.getState();
    store.clearDeckSelection();
    store.toggleDeckSelection(deckId);
    if (onStartReview) {
      await onStartReview();
    }
  }, [decks, onStartReview]);

  const handleDeckSuspendAll = useCallback(async (deckId: string) => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;
    const cards = allCards.filter((c) => matchesDeck(c, deck) && !c.is_suspended);
    if (cards.length === 0) { toast.info("No active cards to suspend"); setContextMenu(null); return; }
    try {
      await bulkSuspendItems(cards.map((c) => c.id));
      setAllCards((prev) => prev.map((c) => cards.some((tc) => tc.id === c.id) ? { ...c, is_suspended: true } : c));
      toast.success(`Suspended ${cards.length} cards`);
    } catch { toast.error("Failed to suspend cards"); }
    setContextMenu(null);
  }, [decks, allCards, toast]);

  const handleDeckUnsuspendAll = useCallback(async (deckId: string) => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;
    const cards = allCards.filter((c) => matchesDeck(c, deck) && c.is_suspended);
    if (cards.length === 0) { toast.info("No suspended cards to unsuspend"); setContextMenu(null); return; }
    try {
      await bulkUnsuspendItems(cards.map((c) => c.id));
      setAllCards((prev) => prev.map((c) => cards.some((tc) => tc.id === c.id) ? { ...c, is_suspended: false } : c));
      toast.success(`Unsuspended ${cards.length} cards`);
    } catch { toast.error("Failed to unsuspend cards"); }
    setContextMenu(null);
  }, [decks, allCards, toast]);

  const handleDeckExport = useCallback(async (deckId: string) => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;
    const cards = allCards.filter((c) => matchesDeck(c, deck));
    if (cards.length === 0) { toast.info("No cards to export"); setContextMenu(null); return; }
    const exportData = cards.map((c) => ({
      question: c.question,
      answer: c.answer,
      tags: c.tags,
      state: c.state,
      difficulty: c.difficulty,
      interval: c.interval,
      ease_factor: c.ease_factor,
      review_count: c.review_count,
      lapses: c.lapses,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deck.name.replace(/[^a-zA-Z0-9-_ ]/g, "_")}-export.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${cards.length} cards`);
    setContextMenu(null);
  }, [decks, allCards, toast]);

  const handleDeckExportApkg = useCallback(async (deckId: string) => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;
    setContextMenu(null);
    setMobileSurface(null);
    try {
      // Use Tauri file dialog to pick save location
      const { save } = await import("@tauri-apps/plugin-dialog");
      const filePath = await save({
        title: `Export "${deck.name}" as .apkg`,
        defaultPath: `${deck.name.replace(/[^a-zA-Z0-9-_ ]/g, "_")}.apkg`,
        filters: [{ name: "Anki Package", extensions: ["apkg"] }],
      });
      if (!filePath) return;
      toast.info("Exporting as .apkg...");
      const result = await exportDeckAsApkg(deck.name, filePath);
      toast.success(result);
    } catch (err) {
      toast.error(`Export failed: ${err}`);
    }
  }, [decks, toast]);

  const handleDeckExportCsv = useCallback(async (deckId: string) => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;
    setContextMenu(null);
    setMobileSurface(null);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const filePath = await save({
        title: `Export "${deck.name}" as tab-separated text`,
        defaultPath: `${deck.name.replace(/[^a-zA-Z0-9-_ ]/g, "_")}.txt`,
        filters: [{ name: "Text (Tab-separated)", extensions: ["txt"] }],
      });
      if (!filePath) return;
      toast.info("Exporting as CSV...");
      const result = await exportDeckAsCsv(deck.name, filePath);
      toast.success(result);
    } catch (err) {
      toast.error(`Export failed: ${err}`);
    }
  }, [decks, toast]);

  const handleToolbarExport = useCallback(async (format: "apkg" | "csv") => {
    if (!expandedDeck) return;
    if (format === "apkg") {
      await handleDeckExportApkg(expandedDeck.id);
    } else {
      await handleDeckExportCsv(expandedDeck.id);
    }
  }, [expandedDeck, handleDeckExportApkg, handleDeckExportCsv]);

  const handleCardSuspend = useCallback(async (cardId: string) => {
    try {
      await bulkSuspendItems([cardId]);
      setAllCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, is_suspended: true } : c))
      );
      toast.success(t("review.deckManager.suspended"));
    } catch {
      toast.error("Failed to suspend card");
    }
  }, [toast, t]);

  const handleCardUnsuspend = useCallback(async (cardId: string) => {
    try {
      await bulkUnsuspendItems([cardId]);
      setAllCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, is_suspended: false } : c))
      );
      toast.success(t("review.deckManager.unsuspended"));
    } catch {
      toast.error("Failed to unsuspend card");
    }
  }, [toast, t]);

  const handleCardDelete = useCallback(async (cardId: string) => {
    try {
      await bulkDeleteItems([cardId]);
      await deleteLearningItem(cardId);
      setAllCards((prev) => prev.filter((c) => c.id !== cardId));
      if (previewCardId === cardId) setPreviewCardId(null);
      toast.success("Card deleted");
    } catch {
      toast.error("Failed to delete card");
    }
  }, [toast, previewCardId]);

  const handleCardDuplicate = useCallback(async (card: LearningItem) => {
    try {
      const newCard = await createLearningItem({
        item_type: card.item_type,
        question: card.question,
        answer: card.answer,
        cloze_text: card.cloze_text,
        tags: card.tags,
        allow_duplicate: true,
      });
      await loadAllItems();
      toast.success("Card duplicated");
      setPreviewCardId(newCard.id);
    } catch {
      toast.error("Failed to duplicate card");
    }
  }, [toast, loadAllItems]);

  const handleCardMoveToDeck = useCallback(async (cardId: string, deckId: string) => {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return;
    const card = allCards.find((c) => c.id === cardId);
    if (!card) return;
    // Swap only the deck-filter tags, preserving provenance and user tags.
    const nextTags = swapDeckTags(card.tags ?? [], decks, deck);
    setAllCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, tags: nextTags } : c))
    );
    // Persist the tag change via database
    try {
      const { updateLearningItem } = await import("../../lib/database");
      await updateLearningItem(cardId, { tags: nextTags });
      toast.success(`Moved card to "${deck.name}"`);
    } catch {
      toast.error("Failed to move card");
      await loadAllItems(); // Reload to undo optimistic update
    }
  }, [decks, allCards, toast, loadAllItems]);

  const deckOptions = useMemo(
    () => sortedDecks.map((d) => ({ id: d.id, name: d.name })),
    [sortedDecks]
  );

  const toggleSort = useCallback(
    (field: SortField) => {
      scrollListToTop();
      if (sortField === field) {
        setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("asc");
      }
    },
    [sortField, scrollListToTop]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mobileSurface || confirmDialog.isOpen) return;
        if (contextMenu) { setContextMenu(null); return; }
        if (renamingDeckId) { setRenamingDeckId(null); setRenameValue(""); return; }
        if (isMobile && mobileCardOpen) {
          setMobileCardOpen(false);
          return;
        }
        if (isMobile && selectionMode) {
          exitSelectionMode();
          return;
        }
        if (previewCardId) {
          setPreviewCardId(null);
        } else if (expandedDeckId) {
          setExpandedDeckId(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu, confirmDialog.isOpen, expandedDeckId, exitSelectionMode, isMobile, mobileCardOpen, mobileSurface, previewCardId, renamingDeckId, selectionMode]);

  const allDeckCards = expandedDeck ? getCardsForDeck(expandedDeck) : [];

  // Inline stats for the active deck
  const inlineStats = useMemo(() => {
    if (!expandedDeck) return null;
    const cards = getCardsForDeck(expandedDeck);
    const now = new Date().toISOString().slice(0, 10);
    const dueToday = cards.filter((c) => !c.is_suspended && c.due_date?.slice(0, 10) <= now).length;
    const newCards = cards.filter((c) => c.state === "New").length;
    const learningCards = cards.filter((c) => c.state === "Learning" || c.state === "Relearning").length;
    const reviewCards = cards.filter((c) => c.state === "Review");
    const matureCards = reviewCards.filter((c) => c.interval >= 21).length;
    const reviewedCards = cards.filter((c) => c.review_count > 0);
    const retentionRate =
      reviewedCards.length > 0
        ? reviewedCards.reduce((sum, c) => {
            const lapseRate = c.review_count > 0 ? c.lapses / c.review_count : 0;
            return sum + (1 - lapseRate);
          }, 0) / reviewedCards.length
        : 0;
    return { total: cards.length, dueToday, newCards, learningCards, matureCards, retentionRate };
  }, [expandedDeck, getCardsForDeck]);

  const sortLabels: [SortField, string][] = DECK_MANAGER_SORTS.map(({ value, shortLabel }) => [value, shortLabel]);
  const filterChips = DECK_MANAGER_CATEGORIES.map(({ value: key, label }) => ({ key, label }));
  const hasNonDefaultSort = sortField !== "due_date" || sortDir !== "asc";
  const filterSortActive = Boolean(stateFilter) || hasNonDefaultSort;
  const sortSummary = hasNonDefaultSort
    ? `${DECK_MANAGER_SORTS.find(({ value }) => value === sortField)?.label ?? "Due"} ${sortDir === "asc" ? "ascending" : "descending"}`
    : "";
  const browseSummary = searchQuery || stateFilter || hasNonDefaultSort
    ? `${expandedCards.length} of ${allDeckCards.length} cards${searchQuery ? " · search" : ""}${stateFilter ? ` · ${stateFilter}` : ""}${sortSummary ? ` · ${sortSummary}` : ""}`
    : `${inlineStats?.total ?? 0} cards · ${inlineStats?.dueToday ?? 0} due`;
  const visibleDeckPickerDecks = sortedDecks.filter((deck) =>
    deck.name.toLocaleLowerCase().includes(deckPickerQuery.trim().toLocaleLowerCase()),
  );
  const mobileBulkActions: BulkActionItem[] = [
    {
      id: "suspend",
      label: "Suspend",
      icon: <Prohibit className="h-4 w-4" />,
      onClick: () => void handleBulkSuspend(),
      variant: "muted",
    },
    {
      id: "unsuspend",
      label: "Unsuspend",
      icon: <Play className="h-4 w-4" />,
      onClick: () => void handleBulkUnsuspend(),
      variant: "muted",
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash className="h-4 w-4" />,
      onClick: () => {
        const count = selectedIds.size;
        confirmDialog.confirm({
          title: `Delete ${count} cards?`,
          message: "This cannot be undone.",
          variant: "danger",
          onConfirm: () => void handleBulkDelete(),
        });
      },
      variant: "destructive",
    },
    {
      id: "retag",
      label: "Retag",
      icon: <Tag className="h-4 w-4" />,
      onClick: () => {
        setAddRetagTags("");
        setRemoveRetagTags("");
        setMobileSurface("retag");
      },
      showInOverflowOnly: true,
    },
  ];

  return (
    <>
    <div className="flex flex-col h-full bg-background">
      {isMobile ? (
        <header aria-label={t("review.deckManager.title")} className="deck-manager-mobile-header flex-shrink-0 border-b border-border bg-background">
          <div className="flex min-h-16 items-center gap-1 px-2">
            <button
              type="button"
              aria-label={selectionMode ? "Exit card selection" : t("review.backToHome")}
              onClick={() => selectionMode ? exitSelectionMode() : onBack()}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            {selectionMode ? (
              <>
                <div className="min-w-0 flex-1" aria-live="polite">
                  <h2 className="truncate text-base font-semibold">{selectedIds.size} selected</h2>
                  <p className="truncate text-xs text-muted-foreground">Select cards</p>
                </div>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  disabled={expandedCards.length === 0}
                  className="min-h-12 shrink-0 rounded-lg px-2 text-xs font-medium text-primary disabled:opacity-50"
                >
                  {expandedCards.length > 0 && expandedCards.every((card) => selectedIds.has(card.id)) ? "Deselect all" : "Select all results"}
                </button>
                <button
                  type="button"
                  onClick={exitSelectionMode}
                  className="min-h-12 shrink-0 rounded-lg px-2 text-sm font-medium text-primary"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  aria-label={expandedDeck ? `Choose deck. ${expandedDeck.name}. ${browseSummary}` : "Choose a deck"}
                  aria-expanded={mobileSurface === "deck-picker"}
                  onClick={openDeckPicker}
                  disabled={decks.length === 0}
                  className="flex min-h-14 min-w-0 flex-1 flex-col items-start justify-center rounded-lg px-2 text-left hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
                >
                  <span className="flex max-w-full items-center gap-1">
                    <span className="max-w-full truncate text-base font-semibold">{expandedDeck?.name ?? "Choose a deck"}</span>
                    <CaretDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </span>
                  <span className="max-w-full truncate text-xs text-muted-foreground" aria-live="polite">{browseSummary}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleStudyNow()}
                  disabled={!expandedDeck || !onStartReview}
                  className="flex min-h-12 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <GraduationCap className="h-5 w-5" aria-hidden="true" />
                  Study
                </button>
                <button
                  type="button"
                  aria-label="Deck actions"
                  onClick={openMobileActions}
                  disabled={!expandedDeck}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
                >
                  <DotsThreeVertical className="h-5 w-5" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
          <div className="flex min-h-14 items-center gap-2 border-t border-border/60 px-3 py-1">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                aria-label="Search cards"
                value={searchQuery}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder={t("review.deckManager.searchPlaceholder")}
                disabled={!expandedDeck}
                className="h-12 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              aria-label={`Filter & sort${filterSortActive ? ", active settings" : ""}`}
              aria-pressed={filterSortActive}
              onClick={openFilterSheet}
              disabled={!expandedDeck}
              className={`flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 ${filterSortActive ? "border-primary text-primary" : "border-border text-foreground"}`}
            >
              <ArrowsVertical className="h-4 w-4" aria-hidden="true" />
              <span>Filter &amp; sort</span>
              {filterSortActive && <span className="rounded-full border border-current px-1.5 text-[10px] font-bold">Active</span>}
            </button>
          </div>
        </header>
      ) : (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("review.backToHome")}
          </button>
          <span className="text-border">·</span>
          <h2 className="text-base font-semibold">{t("review.deckManager.title")}</h2>
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{allCards.length} cards · {decks.length} decks</span>
        </div>
      )}

      {/* Mobile card details surface */}
      {isMobile && (
        <MobileCardDetailsSurface
          open={mobileCardOpen}
          card={previewCard}
          deckName={expandedDeck?.name}
          onClose={() => setMobileCardOpen(false)}
          onCardUpdate={handleCardSave}
          onEditInStudio={onEditInStudio}
          onSuspend={handleCardSuspend}
          onUnsuspend={handleCardUnsuspend}
          onDelete={handleCardDelete}
          onDuplicate={handleCardDuplicate}
          onMoveToDeck={handleCardMoveToDeck}
          decks={deckOptions}
        />
      )}

      {/* Main 3-column layout */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <CircleNotch className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : decks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Tray className="h-10 w-10" />
            <p className="text-sm">{t("review.deckManager.noDecks")}</p>
          </div>
        ) : (
          <div className="flex h-full" ref={containerRef}>
            {/* LEFT SIDEBAR - Deck tree */}
            <div
              className="hidden md:flex flex-shrink-0 border-r border-border overflow-y-auto"
              style={{ width: widths.left }}
            >
              <div className="p-1.5 space-y-0.5">
                {sortedDecks.map((deck) => {
                  const counts = deckCardCounts.get(deck.id);
                  const isExpanded = expandedDeckId === deck.id;
                  const parts = deck.name.split("::");
                  const displayName = parts[parts.length - 1];
                  const level = parts.length - 1;

                  return (
                    <button
                      key={deck.id}
                      onClick={() =>
                        setExpandedDeckId(isExpanded ? null : deck.id)
                      }
                      onContextMenu={(e) => handleDeckContextMenu(e, deck.id)}
                      className={`w-full text-left px-2 py-1.5 rounded transition-colors ${
                        isExpanded
                          ? "bg-primary/10 border border-primary/20"
                          : "hover:bg-muted/50 border border-transparent"
                      }`}
                      style={{ paddingLeft: `${8 + level * 12}px` }}
                    >
                      <div className="flex items-center gap-1.5">
                        {isExpanded ? (
                          <CaretDown className="h-3 w-3 text-primary flex-shrink-0" />
                        ) : (
                          <CaretRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            {!isMobile && renamingDeckId === deck.id ? (
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitRename();
                                  if (e.key === "Escape") { setRenamingDeckId(null); setRenameValue(""); }
                                }}
                                className="text-sm font-medium bg-background border border-primary rounded px-1 py-0 w-full focus:outline-none"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <div className="text-sm font-medium truncate">{displayName}</div>
                            )}
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                            <span className="tabular-nums">{counts?.total ?? 0}</span>
                            {counts && counts.dueToday > 0 && (
                              <span className="text-primary tabular-nums font-medium">
                                {counts.dueToday} due
                              </span>
                            )}
                            {counts && counts.suspended > 0 && (
                              <span className="text-yellow-600 tabular-nums">
                                {counts.suspended} susp.
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Left drag handle */}
            <div
              onMouseDown={(e) => { e.preventDefault(); handlePointerDown("left", e.clientX); }}
              onTouchStart={(e) => { handlePointerDown("left", e.touches[0].clientX); }}
              className="hidden md:block w-1 hover:w-1.5 flex-shrink-0 cursor-col-resize transition-[width] duration-100 z-10 relative group"
              style={{ pointerEvents: "auto" }}
            >
              <div className="absolute inset-0 bg-border group-hover:bg-primary/50 transition-colors" />
            </div>

            {/* CENTER - Card table area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {expandedDeck ? (
                <>
                  {!isMobile && <div className="flex shrink-0 flex-col">
                  {/* Deck header with name */}
                  <div className="px-3 py-1.5 border-b border-border/50 flex items-center gap-2 flex-shrink-0">
                    <h3 className="text-base font-semibold">{expandedDeck.name}</h3>
                    <PencilSimple className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                      {expandedCards.length} shown
                    </span>
                  </div>

                  {/* Inline stats row */}
                  {inlineStats && (
                    <div className="px-3 py-1.5 border-b border-border/50 flex items-center gap-3 flex-shrink-0 overflow-x-auto">
                      <StatPill
                        icon={<Stack className="h-3 w-3" />}
                        label="TOTAL CARDS"
                        value={inlineStats.total}
                      />
                      <StatPill
                        icon={<Clock className="h-3 w-3" />}
                        label="DUE TODAY"
                        value={inlineStats.dueToday}
                        highlight={inlineStats.dueToday > 0}
                      />
                      <StatPill
                        icon={<Plus className="h-3 w-3" />}
                        label="NEW"
                        value={inlineStats.newCards}
                        color="text-blue-500"
                      />
                      <StatPill
                        icon={<Flame className="h-3 w-3" />}
                        label="LEARNING"
                        value={inlineStats.learningCards}
                        color="text-orange-500"
                      />
                      <StatPill
                        icon={<CheckCircle className="h-3 w-3" />}
                        label="MATURE"
                        value={inlineStats.matureCards}
                        color="text-green-500"
                      />
                      <StatPill
                        icon={<Target className="h-3 w-3" />}
                        label="RETENTION"
                        value={`${Math.round(inlineStats.retentionRate * 100)}%`}
                        color={inlineStats.retentionRate >= 0.85 ? "text-green-500" : inlineStats.retentionRate >= 0.7 ? "text-yellow-500" : "text-red-500"}
                      />
                    </div>
                  )}

                  {/* MagnifyingGlass + filter chips + actions */}
                  <div className={"px-3 py-1.5 border-b border-border/50 space-y-1.5 flex-shrink-0"}>
                    <div className={"flex items-center gap-2 " + (isMobile ? "flex-wrap" : "")}>
                      <div className={"relative " + (isMobile ? "flex-1" : "flex-1 max-w-xs")}>
                        <MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => handleSearchChange(e.target.value)}
                          placeholder={t("review.deckManager.searchPlaceholder")}
                          className="w-full pl-7 pr-6 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        {searchQuery && (
                          <button
                            aria-label="Clear search"
                            onClick={() => handleSearchChange("")}
                            className="absolute right-0.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className={"flex items-center gap-1 " + (isMobile ? "" : "ml-auto flex-shrink-0")}>
                        <div className="relative">
                          <button
                            onClick={() => setShowExportPicker(!showExportPicker)}
                            disabled={!expandedDeck}
                            className="flex items-center gap-1 text-xs px-3 py-1 rounded border border-border text-muted-foreground hover:border-primary/30 hover:text-foreground disabled:opacity-40"
                          >
                            <Upload className="h-3 w-3" /> {!isMobile && "Export to Anki"}
                          </button>
                          {showExportPicker && expandedDeck && (
                            <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-md shadow-lg py-1 min-w-[160px]">
                              <button
                                onClick={() => { setShowExportPicker(false); void handleToolbarExport("apkg"); }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted"
                              >
                                Anki Package (.apkg)
                              </button>
                              <button
                                onClick={() => { setShowExportPicker(false); void handleToolbarExport("csv"); }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted"
                              >
                                Tab-separated text (.txt)
                              </button>
                              <div className="border-t border-border my-1" />
                              <div className="px-3 py-1 text-[10px] text-muted-foreground">
                                {expandedCards.length} cards in deck
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => void handleNewCard()}
                          disabled={!expandedDeck}
                          className="flex items-center gap-1 text-xs px-3 py-1 rounded border border-border text-muted-foreground hover:border-primary/30 hover:text-foreground disabled:opacity-40"
                        >
                          <Plus className="h-3 w-3" /> {!isMobile && "New Card"}
                        </button>
                        <button className="flex items-center gap-1 text-xs px-3 py-1 rounded border border-border text-muted-foreground hover:border-primary/30 hover:text-foreground">
                          <Download className="h-3 w-3" /> {!isMobile && "Import"}
                        </button>
                        <button
                          onClick={() => void handleStudyNow()}
                          disabled={!expandedDeck}
                          className="flex items-center gap-1 text-xs px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-40"
                        >
                          <GraduationCap className="h-3 w-3" /> {!isMobile && "Study Now"}
                        </button>
                      </div>
                    </div>

                    {/* Filter chips */}
                    <div className={"flex items-center gap-1 " + (isMobile ? "flex-wrap" : "")}>
                      {filterChips.map(({ key, label }) => {
                          const count = stateFilterCounts[key];
                          const isActive = stateFilter === key;
                          return (
                            <button
                              key={key || "all"}
                              aria-pressed={isActive}
                              onClick={() => handleStateFilterChange(isActive ? "" : key)}
                              className={`text-xs px-2 py-0.5 rounded border transition-colors tabular-nums whitespace-nowrap ${
                                isActive
                                  ? "border-primary bg-primary/10 text-primary"
                                  : count > 0
                                    ? "border-border text-foreground hover:border-primary/30"
                                    : "border-border/50 text-muted-foreground/50"
                              }`}
                            >
                              {label} ({count})
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sort + select all row */}
                    <div className={"flex items-center gap-1 " + (isMobile ? "flex-wrap" : "")}>
                      <ArrowsVertical className="h-2.5 w-2.5 text-muted-foreground mr-0.5" />
                      {sortLabels.map(([field, label]) => (
                        <button
                          key={field}
                          onClick={() => toggleSort(field)}
                          className={`text-xs px-2 py-0.5 rounded transition-colors ${
                            sortField === field
                              ? "border border-primary bg-primary/10 text-primary"
                              : "hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          {label}
                          {sortField === field &&
                            (sortDir === "asc" ? " ↑" : " ↓")}
                        </button>
                      ))}
                      <div className={isMobile ? "flex items-center gap-1 mt-1" : "ml-auto flex items-center gap-1"}>
                        <button
                          onClick={handleSelectAll}
                          className="text-xs px-2 py-0.5 rounded hover:bg-muted text-muted-foreground"
                        >
                          {selectedIds.size === expandedCards.length && expandedCards.length > 0
                            ? "Deselect all"
                            : "Select all"}
                        </button>
                      </div>
                    </div>

                  {/* Bulk action toolbar */}
                  {selectedIds.size > 0 && (
                    <div className="px-3 py-1.5 border-b border-border/50 bg-primary/5 flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-pan-x flex-nowrap shrink-0">
                      <span className="text-xs text-primary font-semibold tabular-nums shrink-0 whitespace-nowrap">
                        {selectedIds.size} selected
                      </span>
                      <button
                        onClick={handleBulkSuspend}
                        className="flex shrink-0 whitespace-nowrap items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-border bg-background hover:bg-muted min-h-[32px] sm:min-h-0"
                      >
                        <Prohibit className="h-3 w-3" /> Suspend
                      </button>
                      <button
                        onClick={handleBulkUnsuspend}
                        className="flex shrink-0 whitespace-nowrap items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-border bg-background hover:bg-muted min-h-[32px] sm:min-h-0"
                      >
                        <Play className="h-3 w-3" /> Unsuspend
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="flex shrink-0 whitespace-nowrap items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 min-h-[32px] sm:min-h-0"
                      >
                        <Trash className="h-3 w-3" /> Delete
                      </button>
                      <div className="shrink-0">
                        <RetagPopover onRetag={handleBulkRetag} />
                      </div>
                    </div>
                  )}

                  {/* Delete confirmation */}
                  {showDeleteConfirm && (
                    <div className="px-3 py-1.5 border-b border-destructive/20 bg-destructive/5 flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-destructive">
                        Delete {selectedIds.size} cards? This cannot be undone.
                      </span>
                      <button
                        onClick={handleBulkDelete}
                        className="text-xs px-2 py-0.5 rounded bg-destructive text-destructive-foreground"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="text-xs px-2 py-0.5 rounded border border-border"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Column headers */}
                  <div className="flex items-center gap-2 px-3 py-1 border-b border-border/50 text-xs font-medium text-muted-foreground uppercase tracking-wider flex-shrink-0 select-none overflow-hidden">
                    <div className="w-4 flex-shrink-0" />
                    <div className={"flex-shrink-0 " + (isMobile ? "flex-1 min-w-0" : "w-[180px] lg:w-[200px]")}>Card</div>
                    {!isMobile && <div className="w-12 flex-shrink-0 hidden xl:block">Type</div>}
                    {!isMobile && (
                      <div className="w-16 flex-shrink-0 cursor-pointer hover:text-foreground" onClick={() => toggleSort("due_date")}>
                        Due {sortField === "due_date" && (sortDir === "asc" ? "↑" : "↓")}
                      </div>
                    )}
                    {!isMobile && (
                      <div className="w-20 flex-shrink-0 hidden md:block cursor-pointer hover:text-foreground" onClick={() => toggleSort("difficulty")}>
                        Difficulty {sortField === "difficulty" && (sortDir === "asc" ? "↑" : "↓")}
                      </div>
                    )}
                    {!isMobile && (
                      <div className="w-14 flex-shrink-0 hidden xl:block cursor-pointer hover:text-foreground" onClick={() => toggleSort("interval")}>
                        Stability {sortField === "interval" && (sortDir === "asc" ? "↑" : "↓")}
                      </div>
                    )}
                    {!isMobile && <div className="flex-1 min-w-0 hidden lg:block">Tags</div>}
                    {!isMobile && (
                      <div className="w-20 flex-shrink-0 hidden xl:block cursor-pointer hover:text-foreground" onClick={() => toggleSort("review_count")}>
                        Last Review
                      </div>
                    )}
                    {!isMobile && <div className="w-5 flex-shrink-0" />}
                  </div>
                  </div>}

                  {/* Card list */}
                  <div
                    ref={listRef}
                    className={`flex-1 min-h-0 overflow-y-auto ${isMobile && selectedIds.size > 0 ? "pb-[calc(9rem+env(safe-area-inset-bottom,0px))]" : ""}`}
                  >
                    {expandedCards.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <FolderOpen className="h-8 w-8" />
                        {searchQuery || stateFilter ? (
                          <>
                            <p className="text-sm">No cards match your search or filters.</p>
                            <button type="button" onClick={clearSearchAndFilters} className="min-h-11 rounded-lg border border-border px-4 text-sm text-primary hover:bg-muted">
                              Clear search and filters
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="text-sm">{t("review.deckManager.emptyDeck")}</p>
                            <button type="button" onClick={() => void handleNewCard()} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
                              New card
                            </button>
                          </>
                        )}
                      </div>
                    ) : isMobile ? (
                      /* Simple scrollable list on mobile — VirtualList needs precise container height */
                      <div className="divide-y divide-border/30">
                        {expandedCards.map((card) => (
                          <DeckManagerCardRow
                            key={card.id}
                            card={card}
                            isSelected={selectedIds.has(card.id)}
                            isExpanded={previewCardId === card.id}
                            onToggleSelect={handleToggleSelect}
                            onExpand={handleExpandCard}
                            isMobile={isMobile}
                            selectionMode={selectionMode}
                            onEditInStudio={onEditInStudio}
                            onSuspend={handleCardSuspend}
                            onUnsuspend={handleCardUnsuspend}
                            onDelete={handleCardDelete}
                            onDuplicate={handleCardDuplicate}
                            onMoveToDeck={handleCardMoveToDeck}
                            decks={deckOptions}
                          />
                        ))}
                      </div>
                    ) : (
                      <DynamicVirtualList
                        items={expandedCards}
                        estimateSize={44}
                        overscan={10}
                        renderItem={(card) => {
                          const isExpanded = previewCardId === card.id;
                          return (
                            <div key={card.id}>
                              <DeckManagerCardRow
                                card={card}
                                isSelected={selectedIds.has(card.id)}
                                isExpanded={isExpanded}
                                onToggleSelect={handleToggleSelect}
                                onExpand={handleExpandCard}
                                isMobile={isMobile}
                                selectionMode={selectionMode}
                                onEditInStudio={onEditInStudio}
                                onSuspend={handleCardSuspend}
                                onUnsuspend={handleCardUnsuspend}
                                onDelete={handleCardDelete}
                                onDuplicate={handleCardDuplicate}
                                onMoveToDeck={handleCardMoveToDeck}
                                decks={deckOptions}
                              />
                            </div>
                          );
                        }}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <Stack className="h-10 w-10" />
                  <p className="text-sm">{t("review.deckManager.selectDeck")}</p>
                </div>
              )}
            </div>

            {/* Right drag handle */}
            {expandedDeck && !isMobile && (
              <div
                onMouseDown={(e) => { e.preventDefault(); handlePointerDown("right", e.clientX); }}
                onTouchStart={(e) => { handlePointerDown("right", e.touches[0].clientX); }}
                className="hidden lg:block w-1 hover:w-1.5 flex-shrink-0 cursor-col-resize transition-[width] duration-100 z-10 relative group"
                style={{ pointerEvents: "auto" }}
              >
                <div className="absolute inset-0 bg-border group-hover:bg-primary/50 transition-colors" />
              </div>
            )}

            {/* RIGHT SIDEBAR - Card preview or deck stats */}
            {expandedDeck && !isMobile && (
              <div
                className="hidden lg:flex flex-col h-full border-l border-border flex-shrink-0"
                style={{ width: widths.right }}
              >
                {/* Panel toggle */}
                <div className="flex items-center border-b border-border px-2 flex-shrink-0">
                  <button
                    onClick={() => setRightPanelView("preview")}
                    className={`text-xs px-2 py-1.5 transition-colors ${
                      rightPanelView === "preview"
                        ? "text-primary font-medium border-b-2 border-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Card
                  </button>
                  <button
                    onClick={() => setRightPanelView("stats")}
                    className={`text-xs px-2 py-1.5 transition-colors ${
                      rightPanelView === "stats"
                        ? "text-primary font-medium border-b-2 border-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Stats
                  </button>
                </div>
                {rightPanelView === "preview" ? (
                  <CardPreviewPanel
                    card={previewCard}
                    onCardUpdate={handleCardSave}
                    onEditInStudio={onEditInStudio}
                  />
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <DeckStatsPanel
                      cards={allDeckCards}
                      deck={expandedDeck}
                      onLeechClick={handleLeechFilter}
                      onStudyNow={onStartReview ? handleStudyNow : undefined}
                      onNewCard={handleNewCard}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Deck context menu */}
      {contextMenu && (() => {
        const ctxDeck = decks.find((d) => d.id === contextMenu.deckId);
        if (!ctxDeck) return null;
        const ctxCounts = deckCardCounts.get(contextMenu.deckId);
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
            <div
              className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[180px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={() => handleDeckStudy(contextMenu.deckId)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />
                Study Deck
                {ctxCounts && ctxCounts.dueToday > 0 && (
                  <span className="ml-auto text-xs text-primary tabular-nums">{ctxCounts.dueToday} due</span>
                )}
              </button>
              <button
                onClick={() => handleDeckRename(contextMenu.deckId)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <PencilSimple className="h-3.5 w-3.5 text-muted-foreground" />
                Rename
              </button>
              <button
                onClick={() => handleDeckDuplicate(contextMenu.deckId)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                Duplicate
              </button>
              <button
                onClick={() => handleDeckExport(contextMenu.deckId)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                Export as JSON
              </button>
              <button
                onClick={() => handleDeckExportApkg(contextMenu.deckId)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                Export as .apkg
              </button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={() => handleDeckSuspendAll(contextMenu.deckId)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <Pause className="h-3.5 w-3.5 text-yellow-500" />
                Suspend All Cards
              </button>
              <button
                onClick={() => handleDeckUnsuspendAll(contextMenu.deckId)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <Play className="h-3.5 w-3.5 text-green-500" />
                Unsuspend All Cards
              </button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={() => handleDeckDelete(contextMenu.deckId)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-destructive/10 text-destructive transition-colors"
              >
                <Trash className="h-3.5 w-3.5" />
                Delete Deck
              </button>
            </div>
          </>
        );
      })()}
      {isMobile && selectionMode && (
        <ResponsiveBulkActionBar
          selectedCount={selectedIds.size}
          totalCount={expandedCards.length}
          selectedCountLabel={`${selectedIds.size} selected`}
          onClearSelection={() => setSelectedIds(new Set())}
          actions={mobileBulkActions}
          className="deck-manager-bulk-action-bar"
          overflowSheetTitle={`${selectedIds.size} selected`}
        />
      )}

      <ResponsiveDialogSheet
        open={isMobile && mobileSurface === "deck-picker"}
        onClose={() => setMobileSurface(null)}
        title="Choose a deck"
        description="Select a deck to browse its cards. Closing this sheet keeps your current list unchanged."
        presentation="sheet"
        className="deck-manager-sheet"
      >
        <div className="space-y-3">
          <label className="block">
            <span className="sr-only">Search decks</span>
            <input
              type="search"
              aria-label="Search decks"
              value={deckPickerQuery}
              onChange={(event) => setDeckPickerQuery(event.target.value)}
              placeholder="Find a deck…"
              className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            />
          </label>
          <div role="listbox" aria-label="Decks" className="divide-y divide-border">
            {visibleDeckPickerDecks.map((deck) => {
              const counts = deckCardCounts.get(deck.id);
              const selected = expandedDeckId === deck.id;
              return (
                <button
                  key={deck.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => handleSwitchDeck(deck.id)}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted ${selected ? "bg-primary/10 text-primary" : "text-foreground"}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" title={deck.name}>{deck.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {counts?.total ?? 0} {(counts?.total ?? 0) === 1 ? "card" : "cards"} · {counts?.dueToday ?? 0} due
                    </span>
                  </span>
                  {selected && <span className="shrink-0 text-sm font-semibold">Selected</span>}
                </button>
              );
            })}
            {visibleDeckPickerDecks.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No decks match that search.</p>
            )}
          </div>
        </div>
      </ResponsiveDialogSheet>

      <ResponsiveDialogSheet
        open={isMobile && mobileSurface === "filters"}
        onClose={() => setMobileSurface(null)}
        title="Filter & sort"
        description="Choose a category and sort order, then apply them together. Counts cover the whole deck."
        presentation="sheet"
        className="deck-manager-sheet"
        footer={(
          <div className="flex w-full items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => { setFilterDraft(""); setSortFieldDraft("due_date"); setSortDirDraft("asc"); }}
              className="min-h-12 rounded-xl px-4 text-sm font-medium text-primary hover:bg-muted"
            >
              Reset
            </button>
            <button type="button" onClick={applyFilterDraft} className="min-h-12 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground">
              Apply
            </button>
          </div>
        )}
      >
        <div className="space-y-6">
          <fieldset className="space-y-1">
            <legend className="mb-2 text-sm font-semibold">Category</legend>
            {DECK_MANAGER_CATEGORIES.map(({ value, label }) => (
              <label key={value || "all"} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
                <input
                  type="radio"
                  name="deck-manager-category"
                  value={value}
                  checked={filterDraft === value}
                  onChange={() => setFilterDraft(value)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="flex-1 text-sm">{label}</span>
                <span className="tabular-nums text-sm text-muted-foreground">{stateFilterCounts[value]}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="mb-2 text-sm font-semibold">Sort by</legend>
            {DECK_MANAGER_SORTS.map(({ value, label }) => (
              <label key={value} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
                <input
                  type="radio"
                  name="deck-manager-sort"
                  value={value}
                  checked={sortFieldDraft === value}
                  onChange={() => setSortFieldDraft(value)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Direction</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["asc", "desc"] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  aria-pressed={sortDirDraft === direction}
                  onClick={() => setSortDirDraft(direction)}
                  className={`min-h-12 rounded-xl border px-3 text-sm font-medium ${sortDirDraft === direction ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground"}`}
                >
                  {direction === "asc" ? "Ascending ↑" : "Descending ↓"}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </ResponsiveDialogSheet>

      <ResponsiveDialogSheet
        open={isMobile && mobileSurface === "actions"}
        onClose={() => setMobileSurface(null)}
        title={expandedDeck ? `${expandedDeck.name} actions` : "Deck actions"}
        description={expandedDeck ? `${allDeckCards.length} cards in this deck` : undefined}
        presentation="sheet"
        className="deck-manager-sheet"
      >
        {expandedDeck && (
          <div className="grid gap-2">
            <MobileDeckAction icon={<Stack className="h-5 w-5" />} label="Deck statistics" onClick={() => setMobileSurface("statistics")} />
            <MobileDeckAction icon={<Plus className="h-5 w-5" />} label="New card" onClick={() => void handleNewCard()} />
            <MobileDeckAction icon={<CheckCircle className="h-5 w-5" />} label="Select cards" onClick={enterSelectionMode} />
            <MobileDeckAction icon={<Upload className="h-5 w-5" />} label="Export" onClick={() => setMobileSurface("export")} />
            <MobileDeckAction icon={<PencilSimple className="h-5 w-5" />} label="Rename deck" onClick={() => handleDeckRename(expandedDeck.id)} />
            <MobileDeckAction icon={<Copy className="h-5 w-5" />} label="Duplicate deck" onClick={() => handleDeckDuplicate(expandedDeck.id)} />
            {(deckCardCounts.get(expandedDeck.id)?.suspended ?? 0) < allDeckCards.length && (
              <MobileDeckAction icon={<Pause className="h-5 w-5" />} label="Suspend active cards" onClick={() => { setMobileSurface(null); void handleDeckSuspendAll(expandedDeck.id); }} />
            )}
            {(deckCardCounts.get(expandedDeck.id)?.suspended ?? 0) > 0 && (
              <MobileDeckAction icon={<Play className="h-5 w-5" />} label="Unsuspend cards" onClick={() => { setMobileSurface(null); void handleDeckUnsuspendAll(expandedDeck.id); }} />
            )}
            <MobileDeckAction icon={<Trash className="h-5 w-5" />} label="Delete deck" destructive onClick={() => handleDeckDelete(expandedDeck.id)} />
          </div>
        )}
      </ResponsiveDialogSheet>

      <ResponsiveDialogSheet
        open={isMobile && mobileSurface === "statistics"}
        onClose={() => setMobileSurface(null)}
        title="Deck statistics"
        description={`${expandedDeck?.name ?? "Deck"} · whole-deck totals`}
        presentation="sheet"
        className="deck-manager-sheet"
      >
        {inlineStats && (
          <dl className="grid grid-cols-2 gap-3">
            {[
              ["Total cards", inlineStats.total],
              ["Due today", inlineStats.dueToday],
              ["New", inlineStats.newCards],
              ["Learning", inlineStats.learningCards],
              ["Mature", allDeckCards.filter((card) => card.state === "Review" && card.interval >= 21).length],
              ["Retention", `${Math.round(inlineStats.retentionRate * 100)}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-background p-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </ResponsiveDialogSheet>

      <ResponsiveDialogSheet
        open={isMobile && mobileSurface === "export"}
        onClose={() => setMobileSurface(null)}
        title="Export deck"
        description={`${expandedDeck?.name ?? "Deck"} · ${allDeckCards.length} cards · exports the whole deck`}
        presentation="sheet"
        className="deck-manager-sheet"
      >
        <div className="grid gap-2">
          <MobileDeckAction icon={<Download className="h-5 w-5" />} label="Anki Package (.apkg)" onClick={() => expandedDeck && void handleDeckExportApkg(expandedDeck.id)} />
          <MobileDeckAction icon={<Upload className="h-5 w-5" />} label="Tab-separated text (.txt)" onClick={() => expandedDeck && void handleDeckExportCsv(expandedDeck.id)} />
        </div>
      </ResponsiveDialogSheet>

      <ResponsiveDialogSheet
        open={isMobile && mobileSurface === "rename"}
        onClose={() => { setMobileSurface(null); setRenamingDeckId(null); setRenameValue(""); }}
        title="Rename deck"
        description="Choose a name for this deck."
        presentation="sheet"
        className="deck-manager-sheet"
        footer={(
          <div className="flex w-full justify-end gap-2">
            <button type="button" onClick={() => { setMobileSurface(null); setRenamingDeckId(null); setRenameValue(""); }} className="min-h-12 rounded-xl px-4 text-sm">Cancel</button>
            <button type="button" onClick={commitRename} disabled={!renameValue.trim()} className="min-h-12 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">Save</button>
          </div>
        )}
      >
        <label className="block space-y-2">
          <span className="text-sm font-medium">Deck name</span>
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") commitRename(); }}
            className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          />
        </label>
      </ResponsiveDialogSheet>

      <ResponsiveDialogSheet
        open={isMobile && mobileSurface === "retag"}
        onClose={() => setMobileSurface(null)}
        title="Retag selected cards"
        description={`${selectedIds.size} selected · separate multiple tags with commas`}
        presentation="sheet"
        className="deck-manager-sheet"
        footer={(
          <div className="flex w-full justify-end gap-2">
            <button type="button" onClick={() => setMobileSurface(null)} className="min-h-12 rounded-xl px-4 text-sm">Cancel</button>
            <button
              type="button"
              onClick={() => handleBulkRetag(addRetagTags.split(",").map((tag) => tag.trim()).filter(Boolean), removeRetagTags.split(",").map((tag) => tag.trim()).filter(Boolean))}
              disabled={!addRetagTags.trim() && !removeRetagTags.trim()}
              className="min-h-12 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        )}
      >
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Add tags</span>
            <input type="text" value={addRetagTags} onChange={(event) => setAddRetagTags(event.target.value)} placeholder="tag-one, tag-two" className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base" />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Remove tags</span>
            <input type="text" value={removeRetagTags} onChange={(event) => setRemoveRetagTags(event.target.value)} placeholder="tag-one, tag-two" className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base" />
          </label>
        </div>
      </ResponsiveDialogSheet>
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={confirmDialog.close}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        details={confirmDialog.details}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
      />
    </div>
    </>
  );
}

function StatPill({ icon, label, value, color, highlight }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <div className="text-[10px] text-muted-foreground leading-none">{label}</div>
        <div className={`text-sm font-semibold tabular-nums leading-tight ${color ?? (highlight ? "text-primary" : "text-foreground")}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

function MobileDeckAction({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-2 text-left text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${destructive ? "text-destructive" : "text-foreground"}`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      <CaretRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function RetagPopover({
  onRetag,
}: {
  onRetag: (add: string[], remove: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addTags, setAddTags] = useState("");
  const [removeTags, setRemoveTags] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-border hover:bg-muted"
      >
        <Tag className="h-2.5 w-2.5" /> Retag
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={addTags}
        onChange={(e) => setAddTags(e.target.value)}
        placeholder="+tags"
        className="w-16 text-xs px-1 py-0.5 rounded border border-border bg-background"
        autoFocus
      />
      <input
        type="text"
        value={removeTags}
        onChange={(e) => setRemoveTags(e.target.value)}
        placeholder="-tags"
        className="w-16 text-xs px-1 py-0.5 rounded border border-border bg-background"
      />
      <button
        onClick={() => {
          const add = addTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          const remove = removeTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          if (add.length || remove.length) {
            onRetag(add, remove);
          }
          setOpen(false);
          setAddTags("");
          setRemoveTags("");
        }}
        className="text-xs px-1.5 py-0.5 rounded bg-primary text-primary-foreground"
      >
        Apply
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setAddTags("");
          setRemoveTags("");
        }}
        className="text-xs px-1 py-0.5 rounded border border-border"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
