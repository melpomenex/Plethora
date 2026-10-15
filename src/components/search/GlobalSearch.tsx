/**
 * Global search system
 * Fast, full-text search across all content types
 * Enhanced with URL import capability
 *
 * Since `revamp-command-palette` the component has two presentation paths:
 * - Hub mode (`controller` supplied): the reference command hub — search
 *   field, scope pills, Quick Actions, Resume reading, Ask Plethora — with
 *   modal focus containment, input-owned selection, and a note composer.
 * - Standalone mode (no `controller`): the original controlled/uncontrolled
 *   search surface, preserved for external consumers and its regression
 *   tests. Shared state (query, URL import, debounce, filters) is identical.
 */

import { useState, useCallback, useEffect, useMemo, useRef, useId } from "react";
import { createPortal } from "react-dom";
import {
  Clock,
  Link,
  MagnifyingGlass,
  Sliders,
  Sparkle,
  Star,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useURLDetector, URLType } from "../../hooks/useURLDetector";
import { useURLMetadata, useURLImport, useDuplicateCheck } from "../../hooks/useURLMetadata";
import { ImportPreview, type ImportOptions } from "../import/ImportPreview";
import { useToast } from "../../components/common/Toast";
import type { SearchHit } from "../../types/searchHit";
import {
  dispatchCommandPaletteOpen,
  isCommandPaletteOpenShortcut,
} from "../../utils/commandPaletteShortcut";
import type { Command } from "../common/CommandPalette";
import { useDialogFocus } from "../md3/Dialog";
import { useI18n } from "../../lib/i18n";
import { useUIStore } from "../../stores/uiStore";
import type {
  PaletteActionId,
  PaletteActionInvocation,
  PaletteHomeModel,
  PaletteScope,
  PaletteSuggestion,
} from "../../commandPalette/types";
import type { PaletteNoteDraft } from "../../commandPalette/noteDraft";
import { usePaletteNoteDraftStore } from "../../commandPalette/noteDraft";
import type { ContextualViewType, ViewActionId } from "../../commandPalette/contextualActions";
import { commandScopes, filterResultsByScope } from "../../commandPalette/facets";
import { PALETTE_QUICK_ACTION_ORDER } from "../../commandPalette/quickActions";
import { navigateTo } from "../../commandPalette/catalogue";
import { APP_SECTION_DESTINATIONS } from "./sectionRegistry";
import { PaletteHome } from "./palette/PaletteHome";
import { PaletteScopeBar } from "./palette/PaletteScopeBar";
import {
  PaletteNoResults,
  PaletteResults,
  optionId,
} from "./palette/PaletteResults";
import { PaletteBrowseList, type PaletteBrowseRow } from "./palette/PaletteBrowseList";
import { PaletteNoteComposer } from "./palette/PaletteNoteComposer";
import {
  PaletteUiContext,
  isCompositionEvent,
  paletteOpenShortcutLabel,
  type PaletteTransientSurface,
} from "./palette/paletteUi";

/**
 * Search result types
 */
export enum SearchResultType {
  Document = "document",
  Extract = "extract",
  Flashcard = "flashcard",
  Category = "category",
  Tag = "tag",
  Command = "command",
  Figure = "figure",
  Media = "media",
}

/**
 * Search result
 */
export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  content?: string;
  excerpt?: string;
  highlights?: string[];
  score: number;
  metadata?: {
    documentId?: string;
    category?: string;
    tags?: string[];
    modifiedAt?: Date;
    createdAt?: Date;
    fileType?: string;
    transcriptMatch?: boolean;
    highlightQuery?: string;
    primaryHit?: SearchHit;
    secondaryHits?: SearchHit[];
    action?: () => void | Promise<void>;
    sectionId?: string;
    targetPath?: string;
    resultKind?: "section" | "command" | "rss-article" | "podcast-episode" | "contextual-action" | "help-article" | "ask-plethora" | "learning-item" | "extract";
    articleId?: string;
    feedId?: string;
    episodeId?: string;
    shortcut?: string;
    /** Figure asset URL (data URL or file path) */
    figureUrl?: string;
    pageNumber?: number;
    timestampMs?: number;
    /** Contextual action dispatch target (when resultKind === "contextual-action"). */
    contextualView?: "document-viewer" | "rss" | "podcast" | "audiobook";
    contextualActionId?: string;
    /** Learning-item destination (when resultKind === "learning-item"). */
    cardId?: string;
    /** Palette scopes this result is eligible under (scope enforcement). */
    scopes?: PaletteScope[];
    /** Optional group label used to visually cluster related results. */
    groupLabel?: string;
  };
}

/**
 * Search query
 */
export interface SearchQuery {
  query: string;
  types?: SearchResultType[];
  categories?: string[];
  tags?: string[];
  /** Palette scope intent, enforced at provider boundaries. */
  paletteScope?: PaletteScope;
  /** Active collection the request was issued for (stale-response guard). */
  paletteCollectionId?: string | null;
  dateRange?: {
    start: Date;
    end: Date;
  };
  operators?: SearchOperator[];
}

/**
 * MagnifyingGlass operator
 */
export interface SearchOperator {
  type: "and" | "or" | "not" | "phrase" | "wildcard" | "fuzzy";
  value: string;
}

/**
 * Saved search
 */
export interface SavedSearch {
  id: string;
  name: string;
  query: SearchQuery;
  createdAt: Date;
  lastUsed?: Date;
}

/**
 * Typed hub controller supplied by `CommandCenter`.
 *
 * Presentation components never call stores/native APIs directly: they render
 * the home model and hand every action to this shared executor.
 */
export interface PaletteHubController {
  /** Bounded home snapshot (loading states included; never fabricated data). */
  home: PaletteHomeModel;
  /** Platform-gated global command catalogue. */
  commands: Command[];
  /** Extra bounded example prompts for See examples. */
  expandedExamples: PaletteSuggestion[];
  /** Shared executor for every non-local hub action. */
  dispatch: (invocation: PaletteActionInvocation) => void;
  /** Contextual action activation (closes palette, dispatches to the view). */
  onContextualAction: (view: ContextualViewType, actionId: ViewActionId) => void;
  /** Persist a note; resolves null on success or an error message. */
  saveNote: (draft: PaletteNoteDraft) => Promise<string | null>;
}

/**
 * Global search component
 */
export function GlobalSearch({
  onSearch,
  onResultClick,
  onNavigateToDocument,
  recentSearches = [],
  savedSearches = [],
  onSaveSearch,
  hideTrigger = false,
  isOpen: controlledOpen,
  onOpenChange,
  controller,
}: {
  onSearch: (query: SearchQuery) => Promise<SearchResult[]>;
  onResultClick: (result: SearchResult) => void;
  onNavigateToDocument?: (documentId: string) => void;
  recentSearches?: string[];
  savedSearches?: SavedSearch[];
  onSaveSearch?: (name: string, query: SearchQuery) => void;
  hideTrigger?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  controller?: PaletteHubController;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = controlledOpen ?? uncontrolledOpen;
  const setIsOpen = useCallback((open: boolean) => {
    onOpenChange?.(open);
    if (controlledOpen === undefined) {
      setUncontrolledOpen(open);
    }
  }, [controlledOpen, onOpenChange]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetryToken, setSearchRetryToken] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<{
    types: SearchResultType[];
    categories: string[];
    tags: string[];
  }>({
    types: [],
    categories: [],
    tags: [],
  });
  // Hub browse state lives here because it participates in the search request
  // decision (View all filters the catalogue locally, never the providers).
  const [scope, setScope] = useState<PaletteScope>("all");
  const [browseAll, setBrowseAll] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const selectedResultRef = useRef<HTMLDivElement | null>(null);
  const latestSearchRequestRef = useRef(0);

  // URL detection and import state
  const urlDetection = useURLDetector(query);
  const { data: urlMetadata, isLoading: isMetadataLoading, error: metadataError } = useURLMetadata(
    urlDetection.type,
    urlDetection.url,
    { debounceMs: 500, enabled: urlDetection.isURL }
  );
  const { importURL, isImporting } = useURLImport();
  const duplicateCheck = useDuplicateCheck(urlDetection.type, urlDetection.url);
  const toast = useToast();
  const [importOptions, setImportOptions] = useState<ImportOptions>({ tags: [], collectionId: undefined });

  const isURLMode = urlDetection.isURL && urlDetection.type !== URLType.Unknown;

  // Debounced search
  const debouncedSearch = useMemo(
    () =>
      debounce(async (searchQuery: SearchQuery) => {
        const requestId = ++latestSearchRequestRef.current;
        setIsSearching(true);
        try {
          const searchResults = await onSearch(searchQuery);
          if (requestId !== latestSearchRequestRef.current) {
            return;
          }
          setResults(searchResults);
          setSearchError(null);
          setSelectedIndex(0);
        } catch (error) {
          if (requestId !== latestSearchRequestRef.current) {
            return;
          }
          // Recoverable failure: the original query stays in the input and a
          // retry re-runs the same scoped request.
          setSearchError(error instanceof Error ? error.message : String(error));
          setResults([]);
        } finally {
          if (requestId === latestSearchRequestRef.current) {
            setIsSearching(false);
          }
        }
      }, 150),
    [onSearch]
  );

  // Update search when query or filters change (skip when in URL mode)
  useEffect(() => {
    if (isURLMode) {
      // Don't search when URL is detected
      latestSearchRequestRef.current += 1;
      setResults([]);
      setIsSearching(false);
      return;
    }

    if (controller) {
      // Hub: only typed queries hit the providers; empty-input scope views and
      // View all are answered from bounded local data.
      if (!query.trim() || browseAll) {
        latestSearchRequestRef.current += 1;
        setResults([]);
        setIsSearching(false);
        setSearchError(null);
        return;
      }
      const searchQuery: SearchQuery = {
        query: query.trim(),
        paletteScope: scope,
        paletteCollectionId: controller.home.collectionId,
        types: filters.types.length > 0 ? filters.types : undefined,
        categories: filters.categories.length > 0 ? filters.categories : undefined,
        tags: filters.tags.length > 0 ? filters.tags : undefined,
      };
      debouncedSearch(searchQuery);
      return;
    }

    if (query.trim()) {
      const searchQuery: SearchQuery = {
        query: query.trim(),
        types: filters.types.length > 0 ? filters.types : undefined,
        categories: filters.categories.length > 0 ? filters.categories : undefined,
        tags: filters.tags.length > 0 ? filters.tags : undefined,
      };
      debouncedSearch(searchQuery);
    } else {
      // Empty query: still ask for results so contextual "Actions in this view"
      // can be surfaced as the default palette content. The search handler
      // returns contextual actions (or an empty list) for an empty query.
      const searchQuery: SearchQuery = { query: "" };
      debouncedSearch(searchQuery);
    }
  }, [query, filters, debouncedSearch, isURLMode, controller, scope, browseAll, searchRetryToken]);

  // Reset hub state on an ordinary open and consume any explicit prefill.
  useEffect(() => {
    if (!isOpen) return;
    if (!controller) {
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    const pending = useUIStore.getState().commandPaletteQuery.trim();
    setQuery(pending);
    if (pending) {
      useUIStore.getState().setCommandPaletteQuery("");
    }
    setResults([]);
    setIsSearching(false);
    setSelectedIndex(0);
    setScope("all");
    setBrowseAll(false);
    setFilters({ types: [], categories: [], tags: [] });
    setShowFilters(false);
    latestSearchRequestRef.current += 1;
  }, [isOpen, controller]);

  // Focus input when opened (standalone path; the hub owns focus via the
  // modal focus lifecycle).
  useEffect(() => {
    if (isOpen && !controller) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, controller]);

  useEffect(() => {
    if (!isOpen || results.length === 0) return;

    setSelectedIndex((current) => Math.max(0, Math.min(current, results.length - 1)));
  }, [isOpen, results.length]);

  useEffect(() => {
    if (!isOpen || isURLMode || controller) return;

    selectedResultRef.current?.scrollIntoView?.({
      block: "nearest",
    });
  }, [isOpen, isURLMode, selectedIndex, results, controller]);

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      onResultClick(result);
      setIsOpen(false);
      setQuery("");
      setResults([]);
    },
    [onResultClick, setIsOpen]
  );

  const handleURLImport = useCallback(async (options: ImportOptions) => {
    if (!urlDetection.isURL) return;

    try {
      const result = await importURL(urlDetection.type, urlDetection.url, {
        tags: options.tags,
        collectionId: options.collectionId,
      });

      // Get document ID from result (structure varies by import type)
      const documentId = (result as any)?.document_id || (result as any)?.id;

      if (urlDetection.type === URLType.Twitter && options.twitterMode !== "video") {
        if (documentId && onNavigateToDocument) {
          onNavigateToDocument(documentId);
        }
        setIsOpen(false);
        setQuery("");
        setImportOptions({ tags: [], collectionId: undefined });
        return;
      }

      const title = urlMetadata
        ? (urlDetection.type === URLType.YouTube
            ? `Imported: ${(urlMetadata as any).title}`
            : urlDetection.type === URLType.RSSFeed
            ? `Subscribed to: ${(urlMetadata as any).title}`
            : urlDetection.type === URLType.Twitter
            ? `Imported video: ${(urlMetadata as any).title}`
            : `Imported: ${(urlMetadata as any).title}`)
        : `Imported: ${urlDetection.url}`;

      toast.success(title, "Click to view", {
        action: {
          label: "Open",
          onClick: () => {
            if (documentId && onNavigateToDocument) {
              onNavigateToDocument(documentId);
            }
            setIsOpen(false);
          },
        },
      } as any);

      // Clear for next import and refocus input
      setQuery("");
      setImportOptions({ tags: [], collectionId: undefined });

      // Refocus input for next import
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (err) {
      toast.error(
        "Import failed",
        err instanceof Error ? err.message : "Unknown error"
      );
    }
  }, [urlDetection, urlMetadata, importURL, toast, setIsOpen, onNavigateToDocument]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) {
        if (isCommandPaletteOpenShortcut(e)) {
          e.preventDefault();
          dispatchCommandPaletteOpen();
        }
        return;
      }

      if (controller) {
        // The hub owns keyboard behavior while open (panel-scoped handling).
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (results.length > 0) {
            setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (results.length > 0) {
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case "Enter":
          e.preventDefault();
          if (isURLMode && urlDetection.isURL && !isImporting) {
            handleURLImport(importOptions);
          } else if (results[selectedIndex]) {
            handleResultClick(results[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          if (isURLMode) {
            // Clear URL and return to search mode
            setQuery("");
            setResults([]);
          } else {
            setIsOpen(false);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, results, selectedIndex, setIsOpen, isURLMode, urlMetadata, isImporting, importOptions, handleURLImport, handleResultClick, controller]);

  const toggleTypeFilter = useCallback((type: SearchResultType) => {
    setFilters((prev) => ({
      ...prev,
      types: prev.types.includes(type)
        ? prev.types.filter((t) => t !== type)
        : [...prev.types, type],
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ types: [], categories: [], tags: [] });
  }, []);

  const hasActiveFilters =
    filters.types.length > 0 ||
    filters.categories.length > 0 ||
    filters.tags.length > 0;

  return (
    <>
      {/* Trigger Button */}
      {!hideTrigger && (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-background border border-border rounded-md hover:bg-muted transition-colors"
        >
          <MagnifyingGlass className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Search...</span>
          <kbd className="ml-auto px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded">
            ⌘K
          </kbd>
        </button>
      )}

      {/* Hub mode: reference command hub */}
      {isOpen && controller && (
        <CommandHubLayer
          controller={controller}
          query={query}
          setQuery={setQuery}
          inputRef={inputRef}
          results={results}
          isSearching={isSearching}
          searchError={searchError}
          onRetrySearch={() => setSearchRetryToken((n) => n + 1)}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          filters={filters}
          setFilters={setFilters}
          clearFilters={clearFilters}
          hasActiveFilters={hasActiveFilters}
          toggleTypeFilter={toggleTypeFilter}
          recentSearches={recentSearches}
          savedSearches={savedSearches}
          onSaveSearch={onSaveSearch}
          onResultClick={handleResultClick}
          onClose={() => setIsOpen(false)}
          isURLMode={isURLMode}
          urlType={urlDetection.type}
          url={urlDetection.url}
          urlMetadata={urlMetadata}
          isMetadataLoading={isMetadataLoading}
          metadataError={metadataError}
          onImport={handleURLImport}
          isImporting={isImporting}
          importOptions={importOptions}
          setImportOptions={setImportOptions}
          duplicateCheck={duplicateCheck}
          onNavigateToDocument={onNavigateToDocument}
          scope={scope}
          setScope={setScope}
          browseAll={browseAll}
          setBrowseAll={setBrowseAll}
        />
      )}

      {/* Standalone mode: original controlled search surface */}
      {isOpen && !controller && (
        <div className="adaptive-dialog-layer adaptive-search-layer animate-glass-fade-in">
          {/* Backdrop with blur */}
          <button
            type="button"
            className="adaptive-dialog-backdrop"
            aria-label="Close search"
            onClick={() => setIsOpen(false)}
          />

          {/* MagnifyingGlass Panel with glass styling */}
          <div
            className="adaptive-dialog-panel adaptive-dialog-centered adaptive-search-panel glass-panel-heavy animate-glass-scale-in"
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            data-gesture-lock
            data-responsive-surface="search-import"
          >
            {/* Accessibility announcements */}
            <output
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              {isURLMode && !isMetadataLoading && "URL detected. Press Enter to import."}
              {isImporting && "Importing..."}
            </output>

            {/* MagnifyingGlass Input */}
            <div className="flex items-center gap-3 px-4 py-3 glass-divider">
              {isURLMode ? (
                <Link className="w-5 h-5 text-primary-400" />
              ) : (
                <MagnifyingGlass className="w-5 h-5 text-muted-foreground" />
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isURLMode ? "Press Enter to import..." : "Search library, commands, or type ? for Ask Plethora..."}
                className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="p-1.5 glass-button rounded-lg"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`p-2 rounded-lg transition-all ${
                  hasActiveFilters
                    ? "bg-primary-400/20 text-primary-300 backdrop-blur-sm"
                    : "glass-button"
                }`}
                aria-label="Search filters"
                aria-expanded={showFilters}
              >
                <Sliders className="w-4 h-4" />
              </button>
            </div>

            {/* Filters */}
            {showFilters && (
              <div className="p-4 glass-panel-light">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground">Filters</span>
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="text-xs text-primary-300 hover:text-primary-200 transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {/* Type Filters */}
                <div className="mb-3">
                  <span className="text-xs text-muted-foreground mb-1 block">
                    Content Type
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {Object.values(SearchResultType).map((type) => (
                      <button
                        key={type}
                        onClick={() => toggleTypeFilter(type)}
                        className={`px-3 py-1.5 text-xs rounded-full transition-all ${
                          filters.types.includes(type)
                            ? "bg-primary-400/30 text-primary-200 backdrop-blur-sm border border-primary-400/30"
                            : "glass-button text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Results */}
            <div
              ref={resultsRef}
              className="adaptive-search-results max-h-96 overflow-y-auto"
            >
              {/* URL Import Mode */}
              {isURLMode ? (
                <section
                  aria-label="URL import preview"
                  aria-busy={isMetadataLoading}
                  className="transition-opacity duration-200"
                >
                  <ImportPreview
                    urlType={urlDetection.type}
                    url={urlDetection.url}
                    data={urlMetadata}
                    isLoading={isMetadataLoading}
                    error={metadataError}
                    onImport={handleURLImport}
                    isImporting={isImporting}
                    onOptionsChange={setImportOptions}
                    duplicateCheck={duplicateCheck}
                    onOpenExisting={onNavigateToDocument}
                  />
                </section>
              ) : !query ? (
                <div className="p-6">
                  {/* Recent Searches */}
                  {recentSearches.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Recent
                      </h3>
                      <div className="space-y-1">
                        {recentSearches.slice(0, 5).map((search, i) => (
                          <button
                            key={i}
                            onClick={() => setQuery(search)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted rounded text-left"
                          >
                            <Clock className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm">{search}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Saved Searches */}
                  {savedSearches.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Saved Searches
                      </h3>
                      <div className="space-y-1">
                        {savedSearches.map((saved) => (
                          <button
                            key={saved.id}
                            onClick={() => setQuery(saved.query.query)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted rounded text-left"
                          >
                            <Star className="w-4 h-4 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{saved.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {saved.query.query}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : isSearching ? (
                <div className="p-8 text-center text-muted-foreground">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  <p className="mt-2 text-sm">Searching...</p>
                </div>
              ) : results.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <MagnifyingGlass className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No results found</p>
                  <p className="text-xs mt-1">Try different keywords or filters</p>
                </div>
              ) : (
                <div>
                  {results.map((result, index) => {
                  const prevGroup = index > 0 ? results[index - 1]?.metadata?.groupLabel : undefined;
                  const showGroupHeader =
                    !!result.metadata?.groupLabel && result.metadata.groupLabel !== prevGroup;
                  return (
                    <div key={result.id}>
                      {showGroupHeader && (
                        <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                          {result.metadata?.groupLabel}
                        </div>
                      )}
                    <div
                      ref={index === selectedIndex ? selectedResultRef : undefined}
                      role="button"
                      tabIndex={-1}
                      onMouseDown={(e) => {
                        // Prevent input blur on click; keep palette focus behavior stable.
                        e.preventDefault();
                      }}
                      onClick={() => handleResultClick(result)}
                      className={`group relative w-full flex items-start gap-3 px-4 py-3 transition-colors text-left cursor-pointer ${
                        index === selectedIndex
                          ? "bg-primary-400/10 backdrop-blur-sm border-l-2 border-primary-400"
                          : "hover:bg-glass-100"
                      }`}
                    >
                      {/* Type Icon or Thumbnail */}
                      {result.metadata?.figureUrl ? (
                        <img
                          src={result.metadata.figureUrl}
                          alt={result.title}
                          className="flex-shrink-0 w-10 h-10 rounded object-cover border border-border"
                        />
                      ) : (
                        <div
                          className={`flex-shrink-0 w-8 h-8 rounded flex items-center justify-center ${
                            result.type === SearchResultType.Document
                              ? "bg-blue-500/10 text-blue-500"
                              : result.type === SearchResultType.Extract
                              ? "bg-purple-500/10 text-purple-500"
                              : result.type === SearchResultType.Flashcard
                              ? "bg-green-500/10 text-green-500"
                              : result.type === SearchResultType.Figure
                              ? "bg-rose-500/10 text-rose-500"
                              : result.type === SearchResultType.Media
                              ? "bg-amber-500/10 text-amber-500"
                              : "bg-muted"
                          }`}
                        >
                          <span className="text-xs font-semibold uppercase">
                            {result.type[0]}
                          </span>
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {result.title}
                          {result.highlights && result.highlights.length > 0 && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({result.highlights.length} matches)
                            </span>
                          )}
                        </p>

                        {result.excerpt && (
                          <p
                            className="text-sm text-muted-foreground line-clamp-2"
                            dangerouslySetInnerHTML={{ __html: result.excerpt }}
                          />
                        )}

                        <div className="flex items-center gap-2 mt-1">
                          {result.metadata?.shortcut && (
                            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted text-muted-foreground rounded border border-border">
                              {result.metadata.shortcut}
                            </kbd>
                          )}
                          {result.metadata?.transcriptMatch && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30">
                              Transcript
                            </span>
                          )}
                          {result.metadata?.category && (
                            <span className="text-xs px-1.5 py-0.5 bg-muted rounded">
                              {result.metadata.category}
                            </span>
                          )}
                          {result.metadata?.tags?.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="text-xs px-1.5 py-0.5 bg-accent text-accent-foreground rounded"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                        {result.excerpt && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {result.excerpt}
                          </p>
                        )}

                        {/* More matches (hover) */}
                        {result.metadata?.secondaryHits && result.metadata.secondaryHits.length > 0 && (
                          <div className="mt-2 hidden group-hover:block">
                            <div className="text-[11px] text-muted-foreground mb-1">
                              More matches in this document
                            </div>
                            <div className="space-y-1">
                              {result.metadata.secondaryHits.slice(0, 5).map((hit) => (
                                <button
                                  key={hit.id}
                                  type="button"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const synthetic: SearchResult = {
                                      ...result,
                                      metadata: {
                                        ...result.metadata,
                                        primaryHit: hit,
                                      },
                                    };
                                    handleResultClick(synthetic);
                                  }}
                                  className="w-full text-left px-2 py-1 rounded bg-background/60 border border-border hover:bg-background transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    {hit.label && (
                                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                        {hit.label}
                                      </span>
                                    )}
                                    {hit.excerptHtml ? (
                                      <span
                                        className="text-[12px] text-muted-foreground line-clamp-1"
                                        dangerouslySetInnerHTML={{ __html: hit.excerptHtml }}
                                      />
                                    ) : (
                                      <span className="text-[12px] text-muted-foreground line-clamp-1">
                                        Jump to match
                                      </span>
                                    )}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Score */}
                      <div className="flex-shrink-0 text-xs text-muted-foreground">
                        {Math.round(result.score * 100)}%
                      </div>
                    </div>
                    </div>
                  );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 glass-panel-light">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-4">
                  {isURLMode ? (
                    <>
                      <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 glass-button rounded text-[10px]">
                          ↵
                        </kbd>
                        Import
                      </span>
                      <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 glass-button rounded text-[10px]">
                          ESC
                        </kbd>
                        Clear
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 glass-button rounded text-[10px]">
                          ↑↓
                        </kbd>
                        Navigate
                      </span>
                      <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 glass-button rounded text-[10px]">
                          ↵
                        </kbd>
                        Select
                      </span>
                      <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 glass-button rounded text-[10px]">
                          ?
                        </kbd>
                        Help
                      </span>
                      <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 glass-button rounded text-[10px]">
                          ESC
                        </kbd>
                        Close
                      </span>
                    </>
                  )}
                </div>
                {!isURLMode && query && (
                  <button
                    onClick={() => {
                      if (onSaveSearch) {
                        const searchQuery: SearchQuery = {
                          query: query.trim(),
                          types: filters.types.length > 0 ? filters.types : undefined,
                        };
                        onSaveSearch(query.trim(), searchQuery);
                      }
                    }}
                    className="hover:text-foreground flex items-center gap-1 glass-button px-2 py-1 rounded-lg transition-colors"
                  >
                    <Star className="w-3 h-3" />
                    Save search
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Recoverable search-provider failure: the query is retained and Retry
 * re-runs the same scoped request. Rendered inside the hub body.
 */
function PaletteSearchError({ query, onRetry }: { query: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="ch-empty" role="alert">
      <WarningCircle className="ch-empty-glyph" aria-hidden="true" />
      <p className="ch-empty-title">{t("palette.searchFailed")}</p>
      <p className="ch-empty-hint">{t("palette.searchFailedHint", { query })}</p>
      <button type="button" className="ch-btn ch-btn--secondary" onClick={onRetry}>
        {t("common.retry")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Hub layer                                                                  */
/* ------------------------------------------------------------------------- */

interface CommandHubLayerProps {
  controller: PaletteHubController;
  query: string;
  setQuery: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  results: SearchResult[];
  isSearching: boolean;
  searchError: string | null;
  onRetrySearch: () => void;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  filters: { types: SearchResultType[]; categories: string[]; tags: string[] };
  setFilters: React.Dispatch<
    React.SetStateAction<{ types: SearchResultType[]; categories: string[]; tags: string[] }>
  >;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  toggleTypeFilter: (type: SearchResultType) => void;
  recentSearches: string[];
  savedSearches: SavedSearch[];
  onSaveSearch?: (name: string, query: SearchQuery) => void;
  onResultClick: (result: SearchResult) => void;
  onClose: () => void;
  isURLMode: boolean;
  urlType: URLType;
  url: string;
  urlMetadata: unknown;
  isMetadataLoading: boolean;
  metadataError: unknown;
  onImport: (options: ImportOptions) => Promise<void>;
  isImporting: boolean;
  importOptions: ImportOptions;
  setImportOptions: (options: ImportOptions) => void;
  duplicateCheck: unknown;
  onNavigateToDocument?: (documentId: string) => void;
  scope: PaletteScope;
  setScope: (scope: PaletteScope) => void;
  browseAll: boolean;
  setBrowseAll: (value: boolean) => void;
}

type HomeSelectionItem =
  | { kind: "contextual"; index: number }
  | { kind: "tile"; index: number };

function CommandHubLayer(props: CommandHubLayerProps) {
  const { t } = useI18n();
  const {
    controller,
    query,
    setQuery,
    inputRef,
    results,
    isSearching,
    selectedIndex,
    setSelectedIndex,
    filters,
    clearFilters,
    hasActiveFilters,
    toggleTypeFilter,
    recentSearches,
    savedSearches,
    onSaveSearch,
    onResultClick,
    onClose,
    isURLMode,
    urlType,
    url,
    urlMetadata,
    isMetadataLoading,
    metadataError,
    onImport,
    isImporting,
    importOptions,
    setImportOptions,
    duplicateCheck,
    onNavigateToDocument,
    scope,
    setScope,
    browseAll,
    setBrowseAll,
    searchError,
    onRetrySearch,
  } = props;

  const { home, commands, expandedExamples } = controller;

  const [transient, setTransient] = useState<PaletteTransientSurface | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [noteComposing, setNoteComposing] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [homeSelection, setHomeSelection] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const draft = usePaletteNoteDraftStore((state) => state.draft);
  const setDraft = usePaletteNoteDraftStore((state) => state.setDraft);
  const noteDirty = usePaletteNoteDraftStore((state) => state.dirty);

  const listboxId = `ch-listbox${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const bodyRef = useRef<HTMLDivElement>(null);

  const uiContextValue = useMemo(
    () => ({
      transient,
      openTransient: (surface: PaletteTransientSurface) => setTransient(surface),
      closeTransient: () => setTransient(null),
    }),
    [transient]
  );

  // Escape precedence: innermost transient surface → examples → browse/search
  // extras → URL clear → composer return → close.
  const escapeRef = useRef<() => void>(() => {});
  escapeRef.current = () => {
    if (transient) {
      if (transient === "examples") {
        setExamplesOpen(false);
        setTransient(null);
        return;
      }
      setTransient(null);
      return;
    }
    if (examplesOpen) {
      setExamplesOpen(false);
      return;
    }
    if (browseAll) {
      setBrowseAll(false);
      return;
    }
    if (isURLMode) {
      setQuery("");
      return;
    }
    if (noteComposing) {
      // Leave the composer; the draft stays recoverable in this session.
      setNoteComposing(false);
      return;
    }
    onClose();
  };

  const panelRef = useDialogFocus(true, () => escapeRef.current(), inputRef);

  // Real modal containment: inert background, locked scroll.
  useEffect(() => {
    const root = typeof document !== "undefined" ? document.getElementById("root") : null;
    root?.setAttribute("inert", "");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      root?.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const openViewAll = useCallback(() => {
    setBrowseAll(true);
    setTransient(null);
    setExamplesOpen(false);
    setSelectedIndex(0);
  }, [setBrowseAll, setSelectedIndex]);

  // Palette-local Ctrl/Cmd+/ — only while the palette is open (this component
  // is unmounted with the palette, so closed editors keep their shortcut).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        openViewAll();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openViewAll]);

  /* ----------------------------------------------------------------------- */
  /* Local catalogue rows (browse + empty-input scope views)                  */
  /* ----------------------------------------------------------------------- */

  const commandRow = useCallback(
    (cmd: Command, group: string): PaletteBrowseRow => ({
      id: `cmd-${cmd.id}`,
      title: cmd.label,
      description: cmd.description,
      icon: cmd.icon,
      shortcut: cmd.shortcut,
      group,
      activate: async () => {
        await cmd.action();
        onClose();
      },
    }),
    [onClose]
  );

  const sectionRow = useCallback(
    (section: (typeof APP_SECTION_DESTINATIONS)[number]): PaletteBrowseRow => ({
      id: `section-${section.id}`,
      title: section.label,
      description: t("palette.openSection", { name: section.label }),
      group: t("palette.group.navigation"),
      activate: () => {
        navigateTo(section.path);
        onClose();
      },
    }),
    [onClose, t]
  );

  const contextualRows = useMemo(
    () =>
      home.contextualActions.map((action) => ({
        id: `ctx-${action.view}-${action.actionId}`,
        title: action.title,
        description: action.subtitle,
        shortcut: action.shortcutHint,
        group: t("palette.actionsInView"),
        activate: () => controller.onContextualAction(action.view, action.actionId),
      })),
    [home.contextualActions, controller, t]
  );

  const browseRows = useMemo<PaletteBrowseRow[]>(() => {
    const term = query.trim().toLowerCase();
    const rows: PaletteBrowseRow[] = [];

    const settingsCommands = commands.filter((cmd) =>
      commandScopes(String(cmd.category), cmd.id).includes("settings")
    );
    const libraryCommands = commands.filter((cmd) =>
      commandScopes(String(cmd.category), cmd.id).includes("library")
    );
    const actionCommands = commands.filter((cmd) =>
      commandScopes(String(cmd.category), cmd.id).includes("actions")
    );

    if (browseAll) {
      commands.forEach((cmd) => rows.push(commandRow(cmd, String(cmd.category))));
      APP_SECTION_DESTINATIONS.forEach((section) => rows.push(sectionRow(section)));
    } else if (scope === "actions") {
      rows.push(...contextualRows);
      actionCommands.forEach((cmd) => rows.push(commandRow(cmd, String(cmd.category))));
    } else if (scope === "settings") {
      settingsCommands.forEach((cmd) => rows.push(commandRow(cmd, String(cmd.category))));
      APP_SECTION_DESTINATIONS.filter((section) =>
        section.path.includes("settings")
      ).forEach((section) => rows.push(sectionRow(section)));
    } else if (scope === "library") {
      libraryCommands.forEach((cmd) => rows.push(commandRow(cmd, t("palette.group.navigation"))));
      APP_SECTION_DESTINATIONS.forEach((section) => rows.push(sectionRow(section)));
    } else if (scope === "documents") {
      const seen = new Set<string>();
      const recent = [
        home.recent.status === "ready" ? home.recent.item : null,
        home.resume.status === "ready" ? home.resume.item : null,
      ];
      recent.forEach((item) => {
        if (!item || seen.has(item.documentId)) return;
        seen.add(item.documentId);
        rows.push({
          id: `recent-${item.documentId}`,
          title: item.title,
          description: t("palette.openDocument"),
          group: t("palette.group.recentDocuments"),
          activate: () => controller.dispatch({ id: "palette.openRecent", documentId: item.documentId }),
        });
      });
    }

    if (!term) {
      if (browseAll) {
        recentSearches.slice(0, 5).forEach((search) =>
          rows.push({
            id: `recent-search-${search}`,
            title: search,
            group: t("palette.group.recentSearches"),
            activate: () => {
              setBrowseAll(false);
              setQuery(search);
            },
          })
        );
        savedSearches.forEach((saved) =>
          rows.push({
            id: `saved-search-${saved.id}`,
            title: saved.name,
            description: saved.query.query,
            group: t("palette.group.savedSearches"),
            activate: () => {
              setBrowseAll(false);
              setQuery(saved.query.query);
            },
          })
        );
      }
      return rows;
    }

    // Local filtering (browse all keeps the complete catalogue reachable).
    return rows.filter((row) => {
      const haystack = `${row.title} ${row.description ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [
    browseAll,
    commands,
    contextualRows,
    controller,
    home.recent,
    home.resume,
    query,
    recentSearches,
    savedSearches,
    scope,
    commandRow,
    sectionRow,
    setBrowseAll,
    setQuery,
    t,
  ]);

  // Which rows does the input own right now?
  const showingSearchResults = Boolean(query.trim()) && !browseAll && !isURLMode && !noteComposing;
  const showingBrowseRows =
    !isURLMode &&
    !noteComposing &&
    (browseAll || (!query.trim() && scope !== "all"));

  const visibleResults = useMemo(
    () => (showingSearchResults ? filterResultsByScope(results, scope) : []),
    [results, scope, showingSearchResults]
  );

  const activeRows: PaletteBrowseRow[] = showingBrowseRows ? browseRows : [];

  /* ----------------------------------------------------------------------- */
  /* Home selection                                                           */
  /* ----------------------------------------------------------------------- */

  const quicklyAvailable = useMemo(() => {
    const resumeReady = home.resume.status === "ready" && Boolean(home.resume.item);
    const recentReady = home.recent.status === "ready" && Boolean(home.recent.item);
    const dueReady = home.due.status === "ready" && home.due.dueCount > 0;
    return [resumeReady, recentReady, dueReady, true, true, true];
  }, [home]);

  const homeItems = useMemo<HomeSelectionItem[]>(() => {
    const items: HomeSelectionItem[] = home.contextualActions.map((_, index) => ({
      kind: "contextual" as const,
      index,
    }));
    PALETTE_QUICK_ACTION_ORDER.forEach((_, index) => {
      items.push({ kind: "tile", index });
    });
    return items;
  }, [home.contextualActions]);

  // Initial highlight: first contextual action, else first *available* tile.
  useEffect(() => {
    if (home.contextualActions.length > 0) {
      setHomeSelection(0);
      return;
    }
    const firstAvailable = quicklyAvailable.findIndex(Boolean);
    setHomeSelection(home.contextualActions.length + Math.max(0, firstAvailable));
  }, [home.contextualActions.length, quicklyAvailable]);

  useEffect(() => {
    setHomeSelection((current) => Math.max(0, Math.min(current, homeItems.length - 1)));
  }, [homeItems.length]);

  const selectedHomeItem = homeItems[homeSelection] ?? null;
  const selectedTileIndex =
    selectedHomeItem?.kind === "tile" ? selectedHomeItem.index : -1;
  const selectedContextualIndex =
    selectedHomeItem?.kind === "contextual" ? selectedHomeItem.index : -1;

  const showingHome =
    !isURLMode && !noteComposing && !browseAll && !query.trim() && scope === "all";

  /* ----------------------------------------------------------------------- */
  /* Activation                                                               */
  /* ----------------------------------------------------------------------- */

  const dispatchPaletteAction = useCallback(
    (id: PaletteActionId, documentId?: string) => {
      switch (id) {
        case "palette.viewAll":
          openViewAll();
          return;
        case "palette.seeAllActions":
          setScope("actions");
          setBrowseAll(false);
          setSelectedIndex(0);
          return;
        case "palette.seeExamples": {
          setExamplesOpen((open) => {
            const next = !open;
            setTransient(next ? "examples" : null);
            return next;
          });
          return;
        }
        case "palette.filterAdvanced":
          setTransient(transient === "filters" ? null : "filters");
          return;
        case "palette.createNote":
          setNoteComposing(true);
          setNoteError(null);
          return;
        case "window.close":
          onClose();
          return;
        default:
          controller.dispatch({ id, documentId });
      }
    },
    [controller, onClose, openViewAll, setBrowseAll, setScope, setSelectedIndex, transient]
  );

  const activateSearchResult = useCallback(
    (result: SearchResult, hit?: SearchHit) => {
      if (hit) {
        onResultClick({
          ...result,
          metadata: { ...result.metadata, primaryHit: hit },
        });
        return;
      }
      onResultClick(result);
    },
    [onResultClick]
  );

  const activateActiveRow = useCallback(() => {
    const row = activeRows[selectedIndex];
    if (row) {
      void row.activate();
    }
  }, [activeRows, selectedIndex]);

  const activateCurrent = useCallback(() => {
    if (isURLMode) {
      if (!isImporting) void onImport(importOptions);
      return;
    }
    if (noteComposing) return;
    if (showingSearchResults) {
      const result = visibleResults[selectedIndex];
      if (result) activateSearchResult(result);
      return;
    }
    if (showingBrowseRows) {
      activateActiveRow();
      return;
    }
    if (showingHome && selectedHomeItem) {
      if (selectedHomeItem.kind === "contextual") {
        const action = home.contextualActions[selectedHomeItem.index];
        if (action) controller.onContextualAction(action.view, action.actionId);
        return;
      }
      const id = PALETTE_QUICK_ACTION_ORDER[selectedHomeItem.index];
      if (id) dispatchPaletteAction(id);
    }
  }, [
    activateActiveRow,
    activateSearchResult,
    controller,
    dispatchPaletteAction,
    home.contextualActions,
    importOptions,
    isImporting,
    isURLMode,
    noteComposing,
    onImport,
    selectedHomeItem,
    showingBrowseRows,
    showingHome,
    showingSearchResults,
    visibleResults,
    selectedIndex,
  ]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (showingSearchResults) {
        const max = visibleResults.length - 1;
        if (max >= 0) setSelectedIndex(Math.max(0, Math.min(selectedIndex + delta, max)));
        return;
      }
      if (showingBrowseRows) {
        const max = activeRows.length - 1;
        if (max >= 0) setSelectedIndex(Math.max(0, Math.min(selectedIndex + delta, max)));
        return;
      }
      if (showingHome) {
        setHomeSelection((current) =>
          Math.max(0, Math.min(current + delta, homeItems.length - 1))
        );
      }
    },
    [
      activeRows.length,
      homeItems.length,
      selectedIndex,
      setSelectedIndex,
      showingBrowseRows,
      showingHome,
      showingSearchResults,
      visibleResults.length,
    ]
  );

  const handlePanelKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (isCompositionEvent(event)) return;
      const target = event.target as HTMLElement;
      const isOurInput =
        target === inputRef.current || target.getAttribute("role") === "combobox";
      if (target.tagName === "TEXTAREA") {
        // Multiline editing owns Enter; context-menu keys pass through.
        return;
      }
      if (event.key === "Enter") {
        if (!isOurInput) return; // focused control owns Enter/Space
        event.preventDefault();
        activateCurrent();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!isOurInput) return;
        event.preventDefault();
        moveSelection(event.key === "ArrowDown" ? 1 : -1);
      }
      // ArrowLeft/ArrowRight stay native for input caret movement.
    },
    [activateCurrent, inputRef, moveSelection]
  );

  const handleSuggestion = useCallback(
    (suggestion: PaletteSuggestion) => {
      if (suggestion.role === "related") {
        setBrowseAll(false);
        setScope("documents");
        setQuery(suggestion.query ?? suggestion.label);
        return;
      }
      if (suggestion.role === "review") {
        controller.dispatch({ id: "palette.openReviewOverview" });
        return;
      }
      controller.dispatch({ id: "palette.askLibrary", suggestion });
    },
    [controller, setBrowseAll, setQuery, setScope]
  );

  const toggleExamples = useCallback(() => {
    setExamplesOpen((open) => {
      const next = !open;
      setTransient(next ? "examples" : null);
      return next;
    });
  }, []);

  /* ----------------------------------------------------------------------- */
  /* Selection bookkeeping                                                    */
  /* ----------------------------------------------------------------------- */

  // Reset the row selection whenever the visible list identity changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [scope, browseAll, query, setSelectedIndex]);

  useEffect(() => {
    if (!showingSearchResults && !showingBrowseRows) return;
    const element = document.getElementById(optionId(listboxId, selectedIndex));
    element?.scrollIntoView?.({ block: "nearest" });
  }, [listboxId, selectedIndex, showingBrowseRows, showingSearchResults]);

  // Settled-state announcements (count + active item), not every keystroke.
  useEffect(() => {
    if (noteComposing || isURLMode) {
      setAnnouncement("");
      return;
    }
    if (isSearching) {
      setAnnouncement(t("palette.searching"));
      return;
    }
    if (showingSearchResults) {
      const active = visibleResults[selectedIndex];
      setAnnouncement(
        `${t("palette.resultCount", { count: visibleResults.length })}${
          active ? ` ${t("palette.activeResult", { title: active.title })}` : ""
        }`
      );
      return;
    }
    if (showingBrowseRows) {
      const active = activeRows[selectedIndex];
      setAnnouncement(
        `${t("palette.resultCount", { count: activeRows.length })}${
          active ? ` ${t("palette.activeResult", { title: active.title })}` : ""
        }`
      );
      return;
    }
    setAnnouncement("");
  }, [
    activeRows,
    isSearching,
    isURLMode,
    noteComposing,
    selectedIndex,
    showingBrowseRows,
    showingSearchResults,
    t,
    visibleResults,
  ]);

  /* ----------------------------------------------------------------------- */
  /* Note saving                                                              */
  /* ----------------------------------------------------------------------- */

  const handleNoteSave = useCallback(async () => {
    if (noteSaving) return;
    setNoteSaving(true);
    setNoteError(null);
    const error = await controller.saveNote(draft);
    setNoteSaving(false);
    if (error) {
      setNoteError(error);
      return;
    }
    setNoteComposing(false);
  }, [controller, draft, noteSaving]);

  const canSaveSearch =
    Boolean(onSaveSearch) && Boolean(query.trim()) && !isURLMode && !noteComposing;
  const showAdvanced = browseAll || Boolean(query.trim());

  const activedescendant = showingSearchResults
    ? optionId(listboxId, selectedIndex)
    : showingBrowseRows
      ? optionId(listboxId, selectedIndex)
      : undefined;

  const body = (
    <div ref={bodyRef} className="ch-body" data-mode={
      noteComposing ? "note" : isURLMode ? "url" : browseAll ? "browse" : query.trim() ? "search" : "home"
    }>
      {noteComposing ? (
        <PaletteNoteComposer
          draft={draft}
          dirty={noteDirty}
          saving={noteSaving}
          error={noteError}
          onChange={setDraft}
          onSave={() => void handleNoteSave()}
          onCancel={() => setNoteComposing(false)}
        />
      ) : isURLMode ? (
        <section
          aria-label={t("palette.urlPreview")}
          aria-busy={isMetadataLoading}
          className="ch-url-section"
        >
          <ImportPreview
            urlType={urlType}
            url={url}
            data={urlMetadata as never}
            isLoading={isMetadataLoading}
            error={metadataError as never}
            onImport={onImport}
            isImporting={isImporting}
            onOptionsChange={setImportOptions}
            duplicateCheck={duplicateCheck as never}
            onOpenExisting={onNavigateToDocument}
          />
        </section>
      ) : showingSearchResults ? (
        searchError ? (
          <PaletteSearchError query={query} onRetry={onRetrySearch} />
        ) : visibleResults.length === 0 && !isSearching ? (
          <PaletteNoResults query={query} />
        ) : (
          <PaletteResults
            results={visibleResults}
            selectedIndex={selectedIndex}
            isSearching={isSearching}
            onSelect={setSelectedIndex}
            onActivate={activateSearchResult}
            listboxId={listboxId}
            emptyState={<PaletteNoResults query={query} />}
          />
        )
      ) : showingBrowseRows ? (
        <PaletteBrowseList
          rows={activeRows}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onActivate={(row) => void row.activate()}
          listboxId={listboxId}
          emptyState={
            scope === "documents" ? (
              <div className="ch-empty">
                <MagnifyingGlass className="ch-empty-glyph" aria-hidden="true" />
                <p className="ch-empty-title">{t("palette.emptyDocuments")}</p>
                <p className="ch-empty-hint">{t("palette.emptyDocumentsHint")}</p>
              </div>
            ) : scope === "cards" ? (
              <div className="ch-empty">
                <MagnifyingGlass className="ch-empty-glyph" aria-hidden="true" />
                <p className="ch-empty-title">{t("palette.emptyCards")}</p>
                <p className="ch-empty-hint">{t("palette.emptyCardsHint")}</p>
              </div>
            ) : (
              <PaletteNoResults query={query} />
            )
          }
        />
      ) : (
        <PaletteHome
          home={home}
          selectedContextualIndex={selectedContextualIndex}
          selectedTileIndex={selectedTileIndex}
          onSelectContextualIndex={(index) => setHomeSelection(index)}
          onSelectTileIndex={(index) =>
            setHomeSelection(home.contextualActions.length + index)
          }
          onAction={(id, documentId) => dispatchPaletteAction(id, documentId)}
          onContextualAction={(view, actionId) => controller.onContextualAction(view, actionId)}
          onSuggestion={handleSuggestion}
          onSeeAllActions={() => dispatchPaletteAction("palette.seeAllActions")}
          expandedExamples={expandedExamples}
          examplesOpen={examplesOpen}
          onToggleExamples={toggleExamples}
        />
      )}
    </div>
  );

  const hub = (
    <div className="command-hub-layer" data-command-hub>
      <button
        type="button"
        className="command-hub-backdrop"
        aria-label={t("palette.close")}
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.dialogLabel")}
        className="command-hub-panel"
        data-gesture-lock
        data-responsive-surface="command-hub"
        onKeyDown={handlePanelKeyDown}
        tabIndex={-1}
      >
        <header className="ch-field">
          <Sparkle className="ch-field-sparkle" weight="fill" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={showingSearchResults || showingBrowseRows}
            aria-controls={showingSearchResults || showingBrowseRows ? listboxId : undefined}
            aria-activedescendant={activedescendant}
            aria-autocomplete="list"
            aria-label={t("palette.inputLabel")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              isURLMode ? t("palette.urlPlaceholder") : t("palette.searchPlaceholder")
            }
            className="ch-field-input"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="ch-field-clear"
              aria-label={t("palette.clearInput")}
              onClick={() => setQuery("")}
            >
              <X className="ch-field-glyph" aria-hidden="true" />
            </button>
          )}
          <kbd className="ch-kbd ch-field-shortcut" aria-hidden="true">
            {paletteOpenShortcutLabel()}
          </kbd>
          <button
            type="button"
            className="ch-close"
            aria-label={t("palette.close")}
            onClick={onClose}
          >
            <X className="ch-field-glyph" aria-hidden="true" />
          </button>
        </header>

        <PaletteScopeBar
          scope={scope}
          onScopeChange={(next) => {
            setScope(next);
            setBrowseAll(false);
            setTransient(null);
            setExamplesOpen(false);
          }}
          onViewAll={openViewAll}
          viewAllActive={browseAll}
          showAdvanced={showAdvanced}
          filtersOpen={transient === "filters"}
          hasActiveFilters={hasActiveFilters}
          onToggleFilters={() => setTransient(transient === "filters" ? null : "filters")}
          canSaveSearch={canSaveSearch}
          onSaveSearch={
            onSaveSearch
              ? () => {
                  const trimmed = query.trim();
                  if (!trimmed) return;
                  onSaveSearch(trimmed, {
                    query: trimmed,
                    types: filters.types.length > 0 ? filters.types : undefined,
                  });
                }
              : undefined
          }
        />

        {transient === "filters" && !isURLMode && (
          <div className="ch-filters">
            <div className="ch-filters-head">
              <span className="ch-filters-title">{t("palette.filters")}</span>
              {hasActiveFilters && (
                <button type="button" className="ch-link" onClick={clearFilters}>
                  {t("palette.clearFilters")}
                </button>
              )}
            </div>
            <div className="ch-filters-chips">
              {Object.values(SearchResultType).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="ch-filter-chip"
                  data-selected={filters.types.includes(type) || undefined}
                  aria-pressed={filters.types.includes(type)}
                  onClick={() => toggleTypeFilter(type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}

        {body}

        <output aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </output>
      </div>
    </div>
  );

  return (
    <PaletteUiContext.Provider value={uiContextValue}>
      {typeof document !== "undefined" ? createPortal(hub, document.body) : hub}
    </PaletteUiContext.Provider>
  );
}

/**
 * Debounce utility
 */
function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}
