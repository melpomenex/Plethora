/**
 * Import preview components for command palette URL import
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowsClockwise,
  ArrowSquareOut,
  Check,
  CircleNotch,
  DownloadSimple,
  Folder,
  Globe,
  ListChecks,
  MagnifyingGlass,
  Plus,
  Queue,
  Rss,
  Tag as TagIcon,
  Warning,
  WarningCircle,
  X,
  XLogo,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { isTauri } from "../../lib/tauri";
import { URLType } from "../../hooks/useURLDetector";
import {
  extractPlaylistID,
  extractYouTubeID,
  getYouTubeWatchURL,
  type YouTubePlaylist,
  type YouTubeVideo,
} from "../../api/youtube";
import {
  importYouTubeVideo,
  type TwitterVideoInfo,
  type TwitterThread,
} from "../../api/documents";
import { subscribeToPlaylist } from "../../api/youtubePlaylist";
import type { Feed } from "../../api/rss";
import {
  findImportedYouTubeDocument,
  isYouTubePlaylistData,
  type WebPageMetadata,
  type DuplicateCheckResult,
} from "../../hooks/useURLMetadata";
import { getCollections, createCollection } from "../../api/collections";
import type { Collection } from "../../types/collection";
import { useDocumentStore } from "../../stores/documentStore";

export interface ImportOptions {
  tags: string[];
  collectionId?: string;
  twitterMode?: "thread" | "video";
  youtubeMode?: "video" | "playlist";
  selectedVideoIds?: string[];
}

interface ImportPreviewProps {
  urlType: URLType;
  url: string;
  data: YouTubeVideo | YouTubePlaylist | Feed | WebPageMetadata | TwitterVideoInfo | TwitterThread | null;
  playlistData?: YouTubePlaylist | null;
  isLoading: boolean;
  error: string | null;
  onImport: (options: ImportOptions) => void;
  isImporting: boolean;
  onOptionsChange?: (options: ImportOptions) => void;
  duplicateCheck: DuplicateCheckResult;
  onOpenExisting?: (id: string) => void;
  onRetry?: () => void;
  onImportPlaylistVideo?: (video: YouTubeVideo, options: ImportOptions) => Promise<string | void> | void;
  onImportPlaylistVideos?: (videos: YouTubeVideo[], options: ImportOptions) => Promise<void> | void;
  onSubscribePlaylist?: (playlistUrl: string) => Promise<void> | void;
}

export function ImportPreview({
  urlType,
  url,
  data,
  playlistData,
  isLoading,
  error,
  onImport,
  isImporting,
  onOptionsChange,
  duplicateCheck,
  onOpenExisting,
  onRetry,
  onImportPlaylistVideo,
  onImportPlaylistVideos,
  onSubscribePlaylist,
}: ImportPreviewProps) {
  const [options, setOptions] = useState<ImportOptions>({ tags: [], collectionId: undefined });
  const [tagInput, setTagInput] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [showCollections, setShowCollections] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [isSubscribingPlaylist, setIsSubscribingPlaylist] = useState(false);

  const hasVideoId = urlType === URLType.YouTube && Boolean(extractYouTubeID(url));
  const hasPlaylistId = urlType === URLType.YouTube && Boolean(extractPlaylistID(url));
  const resolvedPlaylist = useMemo<YouTubePlaylist | null>(() => {
    if (isYouTubePlaylistData(data)) return data;
    if (playlistData && isYouTubePlaylistData(playlistData)) return playlistData;
    return null;
  }, [data, playlistData]);

  const [youtubeMode, setYoutubeMode] = useState<"video" | "playlist">(() =>
    isYouTubePlaylistData(data) || (!hasVideoId && hasPlaylistId) ? "playlist" : "video"
  );

  useEffect(() => {
    if (isYouTubePlaylistData(data) || (!hasVideoId && hasPlaylistId)) {
      setYoutubeMode("playlist");
    } else if (hasVideoId && !hasPlaylistId) {
      setYoutubeMode("video");
    }
  }, [url, data, hasVideoId, hasPlaylistId]);

  // Load collections on mount (Tauri only)
  useEffect(() => {
    if (isTauri()) {
      getCollections().then(setCollections).catch(console.error);
    }
  }, []);

  // Notify parent of options changes
  useEffect(() => {
    onOptionsChange?.(options);
  }, [options, onOptionsChange]);

  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (trimmed && !options.tags.includes(trimmed)) {
      setOptions(prev => ({ ...prev, tags: [...prev.tags, trimmed] }));
      setTagInput("");
    }
  }, [tagInput, options.tags]);

  const handleRemoveTag = useCallback((tagToRemove: string) => {
    setOptions(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tagToRemove)
    }));
  }, []);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  }, [handleAddTag]);

  const handleCollectionSelect = useCallback((collectionId: string | undefined) => {
    setOptions(prev => ({ ...prev, collectionId }));
    setShowCollections(false);
  }, []);

  const handleCreateCollection = useCallback(async () => {
    if (!newCollectionName.trim()) return;
    try {
      const newCollection = await createCollection(newCollectionName.trim());
      setCollections(prev => [...prev, newCollection]);
      setOptions(prev => ({ ...prev, collectionId: newCollection.id }));
      setNewCollectionName("");
      setShowNewCollection(false);
    } catch (err) {
      console.error("Failed to create collection:", err);
    }
  }, [newCollectionName]);

  const handleImportClick = useCallback(() => {
    onImport(options);
  }, [onImport, options]);

  const handleOpenExisting = useCallback(() => {
    if (duplicateCheck.existingItem && onOpenExisting) {
      onOpenExisting(duplicateCheck.existingItem.id);
    }
  }, [duplicateCheck.existingItem, onOpenExisting]);

  const handleSubscribePlaylistClick = useCallback(async () => {
    const playlistId = extractPlaylistID(url) || resolvedPlaylist?.id;
    const normalizedPlaylistUrl = playlistId
      ? `https://www.youtube.com/playlist?list=${playlistId}`
      : url;
    setIsSubscribingPlaylist(true);
    try {
      if (onSubscribePlaylist) {
        await onSubscribePlaylist(normalizedPlaylistUrl);
      } else {
        await subscribeToPlaylist(normalizedPlaylistUrl);
      }
    } catch (err) {
      console.error("Failed to subscribe to playlist:", err);
    } finally {
      setIsSubscribingPlaylist(false);
    }
  }, [url, resolvedPlaylist?.id, onSubscribePlaylist]);

  const selectedCollection = collections.find(c => c.id === options.collectionId);

  // Duplicate warning state
  const isDuplicate = duplicateCheck.isDuplicate && !isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 px-4 py-6">
        <CircleNotch className="w-5 h-5 text-muted-foreground animate-spin" />
        <div className="text-sm text-muted-foreground">
          Fetching preview...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-6">
        <div className="flex items-center gap-3">
          <WarningCircle className="w-5 h-5 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-foreground truncate">{url}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Preview unavailable: {error}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center gap-1.5 px-3 py-2 bg-muted text-foreground text-xs font-medium rounded hover:bg-muted/80"
              >
                <ArrowsClockwise className="w-3.5 h-3.5" />
                Retry
              </button>
            )}
            {hasPlaylistId && (
              <button
                type="button"
                onClick={() => void handleSubscribePlaylistClick()}
                disabled={isSubscribingPlaylist}
                className="flex items-center gap-1.5 px-3 py-2 bg-muted text-foreground text-xs font-medium rounded hover:bg-muted/80 disabled:opacity-50"
              >
                <Queue className="w-3.5 h-3.5" />
                {isSubscribingPlaylist ? "Subscribing..." : "Subscribe to Playlist"}
              </button>
            )}
            {(!hasPlaylistId || hasVideoId) && (
              <button
                type="button"
                onClick={() => onImport({ tags: [], collectionId: undefined })}
                disabled={isImporting}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isImporting ? (
                  <span className="flex items-center gap-2">
                    <CircleNotch className="w-4 h-4 animate-spin" />
                    Importing...
                  </span>
                ) : (
                  "Import"
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // No data yet - show import option anyway for URLs
  if (!data && !resolvedPlaylist) {
    return (
      <div className="px-4 py-6">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-sm text-foreground truncate">{url}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Preview unavailable, but you can still import
            </div>
          </div>
          <button
            onClick={() => onImport({ tags: [], collectionId: undefined })}
            disabled={isImporting}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? (
              <span className="flex items-center gap-2">
                <CircleNotch className="w-4 h-4 animate-spin" />
                Importing...
              </span>
            ) : (
              "Import"
            )}
          </button>
        </div>
      </div>
    );
  }

  switch (urlType) {
    case URLType.YouTube: {
      const hasBothVideoAndPlaylist =
        hasVideoId &&
        Boolean(resolvedPlaylist) &&
        !isYouTubePlaylistData(data);
      const showPlaylistView =
        Boolean(resolvedPlaylist) &&
        (isYouTubePlaylistData(data) || !hasVideoId || youtubeMode === "playlist");

      return (
        <div>
          {hasBothVideoAndPlaylist && resolvedPlaylist && (
            <div className="flex items-center justify-between px-4 pt-3 pb-1 border-b border-border/60">
              <span className="text-xs text-muted-foreground">
                Video is part of playlist <strong className="text-foreground">{resolvedPlaylist.title}</strong>
              </span>
              <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-xs" role="tablist" aria-label="YouTube import mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={youtubeMode === "video"}
                  onClick={() => setYoutubeMode("video")}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    youtubeMode === "video"
                      ? "bg-background text-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Single Video
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={youtubeMode === "playlist"}
                  onClick={() => setYoutubeMode("playlist")}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    youtubeMode === "playlist"
                      ? "bg-background text-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Playlist ({resolvedPlaylist.videos.length} videos)
                </button>
              </div>
            </div>
          )}

          {showPlaylistView && resolvedPlaylist ? (
            <YouTubePlaylistImportPreview
              playlist={resolvedPlaylist}
              options={options}
              tagInput={tagInput}
              setTagInput={setTagInput}
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
              onTagKeyDown={handleTagKeyDown}
              collections={collections}
              selectedCollection={selectedCollection}
              showCollections={showCollections}
              setShowCollections={setShowCollections}
              onCollectionSelect={handleCollectionSelect}
              showNewCollection={showNewCollection}
              setShowNewCollection={setShowNewCollection}
              newCollectionName={newCollectionName}
              setNewCollectionName={setNewCollectionName}
              onCreateCollection={handleCreateCollection}
              onImport={onImport}
              isImporting={isImporting}
              onOpenExisting={onOpenExisting}
              onImportPlaylistVideo={onImportPlaylistVideo}
              onImportPlaylistVideos={onImportPlaylistVideos}
              onSubscribePlaylist={handleSubscribePlaylistClick}
              isSubscribingPlaylist={isSubscribingPlaylist}
            />
          ) : (
            <YouTubeImportPreview
              data={data as YouTubeVideo}
              options={options}
              tagInput={tagInput}
              setTagInput={setTagInput}
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
              onTagKeyDown={handleTagKeyDown}
              collections={collections}
              selectedCollection={selectedCollection}
              showCollections={showCollections}
              setShowCollections={setShowCollections}
              onCollectionSelect={handleCollectionSelect}
              showNewCollection={showNewCollection}
              setShowNewCollection={setShowNewCollection}
              newCollectionName={newCollectionName}
              setNewCollectionName={setNewCollectionName}
              onCreateCollection={handleCreateCollection}
              onImport={handleImportClick}
              isImporting={isImporting}
              isDuplicate={isDuplicate}
              existingItem={duplicateCheck.existingItem}
              onOpenExisting={handleOpenExisting}
            />
          )}
        </div>
      );
    }
    case URLType.Twitter:
      return (
        <TwitterImportPreview
          data={data as TwitterVideoInfo | TwitterThread}
          options={options}
          tagInput={tagInput}
          setTagInput={setTagInput}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onTagKeyDown={handleTagKeyDown}
          collections={collections}
          selectedCollection={selectedCollection}
          showCollections={showCollections}
          setShowCollections={setShowCollections}
          onCollectionSelect={handleCollectionSelect}
          showNewCollection={showNewCollection}
          setShowNewCollection={setShowNewCollection}
          newCollectionName={newCollectionName}
          setNewCollectionName={setNewCollectionName}
          onCreateCollection={handleCreateCollection}
          onImport={(mode?: "thread" | "video") => onImport({ ...options, twitterMode: mode ?? "thread" })}
          isImporting={isImporting}
          isDuplicate={isDuplicate}
          existingItem={duplicateCheck.existingItem}
          onOpenExisting={handleOpenExisting}
        />
      );
    case URLType.RSSFeed:
      return (
        <RSSImportPreview
          data={data as Feed}
          options={options}
          tagInput={tagInput}
          setTagInput={setTagInput}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onTagKeyDown={handleTagKeyDown}
          collections={collections}
          selectedCollection={selectedCollection}
          showCollections={showCollections}
          setShowCollections={setShowCollections}
          onCollectionSelect={handleCollectionSelect}
          showNewCollection={showNewCollection}
          setShowNewCollection={setShowNewCollection}
          newCollectionName={newCollectionName}
          setNewCollectionName={setNewCollectionName}
          onCreateCollection={handleCreateCollection}
          onImport={handleImportClick}
          isImporting={isImporting}
          isDuplicate={isDuplicate}
          existingItem={duplicateCheck.existingItem}
          onOpenExisting={handleOpenExisting}
        />
      );
    case URLType.WebPage:
      return (
        <WebPageImportPreview
          data={data as WebPageMetadata}
          options={options}
          tagInput={tagInput}
          setTagInput={setTagInput}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onTagKeyDown={handleTagKeyDown}
          collections={collections}
          selectedCollection={selectedCollection}
          showCollections={showCollections}
          setShowCollections={setShowCollections}
          onCollectionSelect={handleCollectionSelect}
          showNewCollection={showNewCollection}
          setShowNewCollection={setShowNewCollection}
          newCollectionName={newCollectionName}
          setNewCollectionName={setNewCollectionName}
          onCreateCollection={handleCreateCollection}
          onImport={handleImportClick}
          isImporting={isImporting}
          isDuplicate={isDuplicate}
          existingItem={duplicateCheck.existingItem}
          onOpenExisting={handleOpenExisting}
        />
      );
    default:
      return null;
  }
}

// Shared import options UI component
interface ImportOptionsUIProps {
  options: ImportOptions;
  tagInput: string;
  setTagInput: (v: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onTagKeyDown: (e: React.KeyboardEvent) => void;
  collections: Collection[];
  selectedCollection?: Collection;
  showCollections: boolean;
  setShowCollections: (v: boolean) => void;
  onCollectionSelect: (id: string | undefined) => void;
  showNewCollection: boolean;
  setShowNewCollection: (v: boolean) => void;
  newCollectionName: string;
  setNewCollectionName: (v: string) => void;
  onCreateCollection: () => void;
}

function ImportOptionsUI({
  options,
  tagInput,
  setTagInput,
  onAddTag,
  onRemoveTag,
  onTagKeyDown,
  collections,
  selectedCollection,
  showCollections,
  setShowCollections,
  onCollectionSelect,
  showNewCollection,
  setShowNewCollection,
  newCollectionName,
  setNewCollectionName,
  onCreateCollection,
}: ImportOptionsUIProps) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3 mt-3">
      {/* Tags */}
      <div className="flex items-center gap-2">
        <TagIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <div className="flex flex-wrap items-center gap-1.5 flex-1">
          {options.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded text-xs"
            >
              #{tag}
              <button
                onClick={() => onRemoveTag(tag)}
                className="hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              onTagKeyDown(e);
            }}
            placeholder={options.tags.length === 0 ? "Add tags..." : ""}
            className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {tagInput && (
            <button
              onClick={onAddTag}
              className="px-2 py-0.5 text-xs bg-muted hover:bg-muted/80 rounded"
            >
              Add
            </button>
          )}
        </div>
      </div>

      {/* Collection */}
      <div className="flex items-center gap-2 relative">
        <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <button
          onClick={() => setShowCollections(!showCollections)}
          className="flex-1 flex items-center justify-between px-2 py-1 bg-muted/50 hover:bg-muted rounded text-xs text-left"
        >
          <span className={selectedCollection ? "text-foreground" : "text-muted-foreground"}>
            {selectedCollection ? selectedCollection.name : "Add to collection..."}
          </span>
          <span className="text-muted-foreground">▼</span>
        </button>

        {showCollections && (
          <>
            <div className="fixed inset-0 z-10" role="presentation" onClick={() => setShowCollections(false)} />
            <div className="absolute z-20 left-6 top-full mt-1 w-56 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-medium">Collections</span>
                {!showNewCollection && (
                  <button
                    onClick={() => setShowNewCollection(true)}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded hover:opacity-90"
                  >
                    <Plus className="w-3 h-3" />
                    New
                  </button>
                )}
              </div>

              {showNewCollection && (
                <div className="p-2 border-b border-border bg-muted/30">
                  <input
                    type="text"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") onCreateCollection();
                      else if (e.key === "Escape") {
                        setShowNewCollection(false);
                        setNewCollectionName("");
                      }
                    }}
                    placeholder="Name..."
                    className="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                </div>
              )}

              <div className="max-h-48 overflow-y-auto">
                <button
                  onClick={() => onCollectionSelect(undefined)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-left text-xs ${
                    !selectedCollection ? "bg-muted" : ""
                  }`}
                >
                  <div className="w-4 h-4 border rounded flex items-center justify-center">
                    {!selectedCollection && <Check className="w-3 h-3" />}
                  </div>
                  <span className="text-muted-foreground">None</span>
                </button>
                {collections.map((collection) => (
                  <button
                    key={collection.id}
                    onClick={() => onCollectionSelect(collection.id)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors text-left text-xs ${
                      selectedCollection?.id === collection.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="w-4 h-4 border rounded flex items-center justify-center">
                      {selectedCollection?.id === collection.id && (
                        <Check className="w-3 h-3" />
                      )}
                    </div>
                    {collection.icon && <span>{collection.icon}</span>}
                    <span className="truncate">{collection.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface YouTubeImportPreviewProps extends ImportOptionsUIProps {
  data: YouTubeVideo;
  onImport: () => void;
  isImporting: boolean;
  isDuplicate: boolean;
  existingItem?: { id: string; title: string; type: "document" | "feed" };
  onOpenExisting?: () => void;
}

function YouTubeImportPreview({
  data,
  onImport,
  isImporting,
  isDuplicate,
  existingItem,
  onOpenExisting,
  ...optionsProps
}: YouTubeImportPreviewProps) {
  // Handle partial metadata (fallback case)
  const hasPartialData = data.title === "YouTube Video" || data.channel === "Unknown Channel";
  
  return (
    <div className="px-4 py-3">
      {/* Duplicate warning */}
      {isDuplicate && existingItem && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <Warning className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300">
              Already imported
            </div>
            <div className="text-xs text-yellow-600 dark:text-yellow-400 truncate">
              {existingItem.title}
            </div>
          </div>
          {onOpenExisting && (
            <button
              onClick={onOpenExisting}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 rounded hover:bg-yellow-500/30"
            >
              <ArrowSquareOut className="w-3 h-3" />
              Open
            </button>
          )}
        </div>
      )}

      {/* Partial data warning */}
      {hasPartialData && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <WarningCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <div className="text-xs text-blue-700 dark:text-blue-300">
            Limited preview available. Full details will be fetched after import.
          </div>
        </div>
      )}

      <div className="flex gap-4">
        {/* Thumbnail */}
        <div className="flex-shrink-0 w-32 h-20 rounded overflow-hidden bg-muted">
          <img
            src={data.thumbnail}
            alt={data.title || "YouTube Video"}
            className="w-full h-full object-cover"
            onError={(e) => {
              // Fallback to default thumbnail on error
              (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${data.id}/hqdefault.jpg`;
            }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <YoutubeLogo className="w-4 h-4 text-red-500" />
            <span className="text-xs font-medium text-muted-foreground uppercase">
              YouTube Video
            </span>
          </div>

          <h3 className={`text-sm font-medium text-foreground line-clamp-2 ${!data.title || data.title === "YouTube Video" ? "italic text-muted-foreground" : ""}`}>
            {data.title || "YouTube Video"}
          </h3>

          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>{data.channel || "Unknown Channel"}</span>
            {data.duration > 0 && (
              <>
                <span>•</span>
                <span>{formatDuration(data.duration)}</span>
              </>
            )}
          </div>

          {data.description && data.description !== data.title && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-2">
              {data.description}
            </p>
          )}
        </div>

        {/* Import button */}
        <button
          onClick={onImport}
          disabled={isImporting}
          className="flex-shrink-0 self-start px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isImporting ? (
            <span className="flex items-center gap-2">
              <CircleNotch className="w-4 h-4 animate-spin" />
              Importing...
            </span>
          ) : isDuplicate ? (
            "Re-import"
          ) : (
            "Import Video"
          )}
        </button>
      </div>

      {/* Import Options */}
      <ImportOptionsUI {...optionsProps} />
    </div>
  );
}

export interface YouTubePlaylistImportPreviewProps extends ImportOptionsUIProps {
  playlist: YouTubePlaylist;
  onImport: (options: ImportOptions) => void;
  isImporting: boolean;
  onOpenExisting?: (id: string) => void;
  onImportPlaylistVideo?: (video: YouTubeVideo, options: ImportOptions) => Promise<string | void> | void;
  onImportPlaylistVideos?: (videos: YouTubeVideo[], options: ImportOptions) => Promise<void> | void;
  onSubscribePlaylist?: () => Promise<void> | void;
  isSubscribingPlaylist?: boolean;
}

export function YouTubePlaylistImportPreview({
  playlist,
  onImport,
  isImporting,
  onOpenExisting,
  onImportPlaylistVideo,
  onImportPlaylistVideos,
  onSubscribePlaylist,
  isSubscribingPlaylist = false,
  ...optionsProps
}: YouTubePlaylistImportPreviewProps) {
  const documents = useDocumentStore((s) => s.documents);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [filterQuery, setFilterQuery] = useState("");
  const [importingVideoId, setImportingVideoId] = useState<string | null>(null);
  const [locallyImportedMap, setLocallyImportedMap] = useState<Record<string, string>>({});
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const getImportedDocForVideo = useCallback(
    (videoId: string): { id: string; title: string } | undefined => {
      const existing = findImportedYouTubeDocument(videoId, documents);
      if (existing) return existing;
      if (videoId in locallyImportedMap) {
        return {
          id: locallyImportedMap[videoId],
          title: playlist.videos.find((v) => v.id === videoId)?.title || "Imported Video",
        };
      }
      return undefined;
    },
    [documents, locallyImportedMap, playlist.videos]
  );

  // Reset selections when playlist ID changes
  useEffect(() => {
    setSelectedIds(new Set());
    setFilterQuery("");
  }, [playlist.id]);

  const { options } = optionsProps;

  const filteredVideos = useMemo(() => {
    const trimmed = filterQuery.trim().toLowerCase();
    if (!trimmed) return playlist.videos;
    return playlist.videos.filter(
      (v) =>
        v.title.toLowerCase().includes(trimmed) ||
        (v.channel && v.channel.toLowerCase().includes(trimmed))
    );
  }, [playlist.videos, filterQuery]);

  const unimportedVisibleVideos = useMemo(
    () => filteredVideos.filter((v) => !getImportedDocForVideo(v.id)),
    [filteredVideos, getImportedDocForVideo]
  );

  const allVisibleUnimportedSelected =
    unimportedVisibleVideos.length > 0 &&
    unimportedVisibleVideos.every((v) => selectedIds.has(v.id));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleUnimportedSelected) {
        for (const v of filteredVideos) {
          next.delete(v.id);
        }
      } else {
        for (const v of unimportedVisibleVideos) {
          next.add(v.id);
        }
      }
      return next;
    });
  }, [allVisibleUnimportedSelected, filteredVideos, unimportedVisibleVideos]);

  const toggleVideoSelection = useCallback((videoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  }, []);

  const applyCustomTagsIfNeeded = useCallback(
    async (docId: string | undefined, existingTags: string[] = []) => {
      if (!docId || options.tags.length === 0) return;
      try {
        const mergedTags = Array.from(new Set([...existingTags, ...options.tags]));
        await useDocumentStore.getState().updateDocumentOptimistic(docId, {
          tags: mergedTags,
        });
      } catch (err) {
        console.warn("Failed to apply custom tags to imported playlist video:", err);
      }
    },
    [options.tags]
  );

  const handleSingleRowImport = useCallback(
    async (video: YouTubeVideo) => {
      if (importingVideoId || batchProgress) return;
      setImportingVideoId(video.id);
      try {
        let createdDocId = "";
        if (onImportPlaylistVideo) {
          const maybeId = await onImportPlaylistVideo(video, options);
          if (typeof maybeId === "string") {
            createdDocId = maybeId;
          }
        } else {
          const doc = await importYouTubeVideo(
            getYouTubeWatchURL(video.id),
            options.collectionId
          );
          createdDocId = (doc as any)?.id || (doc as any)?.document_id || "";
          await applyCustomTagsIfNeeded(createdDocId, (doc as any)?.tags);
          await useDocumentStore.getState().loadDocuments();
        }
        setLocallyImportedMap((prev) => ({
          ...prev,
          [video.id]: createdDocId || video.id,
        }));
        setSelectedIds((prev) => {
          if (!prev.has(video.id)) return prev;
          const next = new Set(prev);
          next.delete(video.id);
          return next;
        });
      } catch (err) {
        console.error("Failed to import playlist video:", err);
      } finally {
        setImportingVideoId(null);
      }
    },
    [importingVideoId, batchProgress, onImportPlaylistVideo, options, applyCustomTagsIfNeeded]
  );

  const handleBatchImport = useCallback(async () => {
    if (selectedIds.size === 0 || isImporting || batchProgress) return;
    const selectedVideos = playlist.videos.filter((v) => selectedIds.has(v.id));
    if (selectedVideos.length === 0) return;

    if (onImportPlaylistVideos) {
      setBatchProgress({ current: 1, total: selectedVideos.length });
      try {
        await onImportPlaylistVideos(selectedVideos, {
          ...options,
          youtubeMode: "playlist",
          selectedVideoIds: selectedVideos.map((v) => v.id),
        });
        const newlyImported: Record<string, string> = {};
        for (const v of selectedVideos) {
          newlyImported[v.id] = v.id;
        }
        setLocallyImportedMap((prev) => ({ ...prev, ...newlyImported }));
        setSelectedIds(new Set());
      } finally {
        setBatchProgress(null);
      }
      return;
    }

    setBatchProgress({ current: 0, total: selectedVideos.length });
    try {
      for (let i = 0; i < selectedVideos.length; i++) {
        const video = selectedVideos[i];
        setBatchProgress({ current: i + 1, total: selectedVideos.length });
        const doc = await importYouTubeVideo(
          getYouTubeWatchURL(video.id),
          options.collectionId
        );
        const createdDocId = (doc as any)?.id || (doc as any)?.document_id || video.id;
        await applyCustomTagsIfNeeded(createdDocId, (doc as any)?.tags);
        setLocallyImportedMap((prev) => ({ ...prev, [video.id]: createdDocId }));
      }
      await useDocumentStore.getState().loadDocuments();
      setSelectedIds(new Set());
      onImport({
        ...options,
        youtubeMode: "playlist",
        selectedVideoIds: selectedVideos.map((v) => v.id),
      });
    } catch (err) {
      console.error("Batch playlist import failed:", err);
    } finally {
      setBatchProgress(null);
    }
  }, [
    selectedIds,
    isImporting,
    batchProgress,
    playlist.videos,
    onImportPlaylistVideos,
    options,
    applyCustomTagsIfNeeded,
    onImport,
  ]);

  const importedCount = useMemo(
    () => playlist.videos.filter((v) => Boolean(getImportedDocForVideo(v.id))).length,
    [playlist.videos, getImportedDocForVideo]
  );

  const isBusy = isImporting || Boolean(batchProgress);

  return (
    <div className="px-4 py-3" data-testid="youtube-playlist-import-preview">
      {/* Playlist Header */}
      <div className="flex items-start gap-3">
        {playlist.thumbnail ? (
          <div className="flex-shrink-0 w-24 h-16 rounded overflow-hidden bg-muted relative">
            <img
              src={playlist.thumbnail}
              alt={playlist.title}
              className="w-full h-full object-cover"
            />
            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/75 text-white text-[10px] font-medium">
              {playlist.videos.length} videos
            </span>
          </div>
        ) : (
          <div className="flex-shrink-0 w-16 h-16 rounded bg-muted flex items-center justify-center">
            <Queue className="w-6 h-6 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <YoutubeLogo className="w-4 h-4 text-red-500" />
            <span className="text-xs font-medium text-muted-foreground uppercase">
              YouTube Playlist
            </span>
            {importedCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium">
                {importedCount}/{playlist.videos.length} in library
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-foreground truncate">
            {playlist.title}
          </h3>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            <span>{playlist.channel || "Unknown Channel"}</span>
            <span>•</span>
            <span>{playlist.videos.length} videos</span>
          </div>
        </div>

        {/* Top-level Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {onSubscribePlaylist && (
            <button
              type="button"
              onClick={() => void onSubscribePlaylist()}
              disabled={isSubscribingPlaylist || isBusy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-medium rounded transition-colors disabled:opacity-50"
              title="Subscribe to playlist for future updates"
            >
              <Queue className="w-3.5 h-3.5" />
              {isSubscribingPlaylist ? "Subscribing..." : "Subscribe"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleBatchImport()}
            disabled={selectedIds.size === 0 || isBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {batchProgress ? (
              <>
                <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                <span>
                  Importing {batchProgress.current}/{batchProgress.total}...
                </span>
              </>
            ) : (
              <>
                <DownloadSimple className="w-3.5 h-3.5" />
                <span>Import Selected ({selectedIds.size})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Filter & Batch Selection Toolbar */}
      <div className="flex items-center gap-2 mt-3 pb-2 border-b border-border">
        <div className="relative flex-1">
          <MagnifyingGlass className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Filter videos by title..."
            aria-label="Filter playlist videos"
            className="w-full pl-8 pr-7 py-1 text-xs bg-muted/50 border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery("")}
              aria-label="Clear playlist filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={toggleSelectAll}
          disabled={unimportedVisibleVideos.length === 0 || isBusy}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-muted/70 hover:bg-muted text-foreground rounded transition-colors disabled:opacity-50"
        >
          <ListChecks className="w-3.5 h-3.5" />
          {allVisibleUnimportedSelected ? "Deselect All" : "Select All"}
        </button>
      </div>

      {/* Scrollable Video Dropdown List */}
      <div
        className="max-h-72 overflow-y-auto divide-y divide-border/50 mt-1"
        role="list"
        aria-label="Playlist videos"
      >
        {filteredVideos.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No videos match "{filterQuery}"
          </div>
        ) : (
          filteredVideos.map((video) => {
            const originalIndex = playlist.videos.findIndex((v) => v.id === video.id);
            const importedDoc = getImportedDocForVideo(video.id);
            const isSelected = selectedIds.has(video.id);
            const isRowImporting = importingVideoId === video.id;

            return (
              <div
                key={video.id}
                role="listitem"
                data-testid={`playlist-video-row-${video.id}`}
                className={`flex items-center gap-2.5 py-2 px-1.5 rounded transition-colors ${
                  isSelected ? "bg-primary/5" : "hover:bg-muted/40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleVideoSelection(video.id)}
                  disabled={isBusy}
                  aria-label={`Select ${video.title}`}
                  className="rounded border-border text-primary focus:ring-primary cursor-pointer"
                />

                <span className="w-5 text-[11px] text-muted-foreground text-right tabular-nums flex-shrink-0">
                  {originalIndex + 1}
                </span>

                <div className="w-14 h-9 rounded overflow-hidden bg-muted flex-shrink-0">
                  <img
                    src={video.thumbnail || `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground truncate" title={video.title}>
                    {video.title}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {video.duration > 0 && <span>{formatDuration(video.duration)}</span>}
                    {video.channel && video.channel !== playlist.channel && (
                      <span className="truncate">{video.channel}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {importedDoc ? (
                    <>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <Check className="w-3 h-3" />
                        Imported
                      </span>
                      {onOpenExisting && importedDoc.id && (
                        <button
                          type="button"
                          onClick={() => onOpenExisting(importedDoc.id)}
                          aria-label={`Open ${video.title}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] bg-muted hover:bg-muted/80 text-foreground rounded"
                        >
                          <ArrowSquareOut className="w-3 h-3" />
                          Open
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSingleRowImport(video)}
                      disabled={isRowImporting || isBusy}
                      aria-label={`Import ${video.title}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-muted hover:bg-primary hover:text-primary-foreground text-foreground rounded transition-colors disabled:opacity-50"
                    >
                      {isRowImporting ? (
                        <>
                          <CircleNotch className="w-3 h-3 animate-spin" />
                          <span>Importing...</span>
                        </>
                      ) : (
                        <>
                          <DownloadSimple className="w-3 h-3" />
                          <span>Import</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Shared Tags & Collection Options */}
      <ImportOptionsUI {...optionsProps} />
    </div>
  );
}

interface TwitterImportPreviewProps extends ImportOptionsUIProps {
  data: TwitterVideoInfo | TwitterThread;
  onImport: (mode?: "thread" | "video") => void;
  isImporting: boolean;
  isDuplicate: boolean;
  existingItem?: { id: string; title: string; type: "document" | "feed" };
  onOpenExisting?: () => void;
}

function TwitterImportPreview({
  data,
  onImport,
  isImporting,
  isDuplicate,
  existingItem,
  onOpenExisting,
  ...optionsProps
}: TwitterImportPreviewProps) {
  const isThread = "posts" in data && Array.isArray(data.posts);
  const thread = isThread ? (data as TwitterThread) : null;
  const videoInfo = !isThread ? (data as TwitterVideoInfo) : null;

  const firstPost = thread?.posts[0];
  const allMedia = thread ? thread.posts.flatMap((p) => p.media) : [];
  const photos = allMedia.filter((m) => m.kind === "photo");
  const hasVideo = !isThread || allMedia.some((m) => m.kind === "video" || m.kind === "animated_gif");

  return (
    <div className="px-4 py-3">
      {/* Duplicate warning */}
      {isDuplicate && existingItem && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <Warning className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300">
              Already imported
            </div>
            <div className="text-xs text-yellow-600 dark:text-yellow-400 truncate">
              {existingItem.title}
            </div>
          </div>
          {onOpenExisting && (
            <button
              onClick={onOpenExisting}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 rounded hover:bg-yellow-500/30"
            >
              <ArrowSquareOut className="w-3 h-3" />
              Open
            </button>
          )}
        </div>
      )}

      {isThread && thread ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            {thread.author.avatarUrl ? (
              <img
                src={thread.author.avatarUrl}
                alt={thread.author.name}
                className="w-10 h-10 rounded-full object-cover flex-shrink-0 border border-border/50"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <XLogo className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold text-foreground truncate">{thread.author.name}</span>
                {thread.author.verified && (
                  <span className="text-sky-500 text-xs font-bold" title="Verified">✓</span>
                )}
                <span className="text-xs text-muted-foreground">@{thread.author.screenName}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium ml-auto">
                  {thread.totalPosts > 1 ? `${thread.totalPosts} posts` : "1 post"}
                </span>
              </div>
              <p className="text-xs text-foreground/90 mt-1.5 line-clamp-3 leading-relaxed">
                {firstPost ? firstPost.fullText || firstPost.text : thread.title}
              </p>
            </div>
          </div>

          {/* Photo thumbnails if any */}
          {photos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto py-1">
              {photos.slice(0, 4).map((photo, i) => (
                <div key={i} className="relative w-20 h-14 rounded-md overflow-hidden bg-muted flex-shrink-0 border border-border/40">
                  <img
                    src={photo.thumbnailUrl || photo.mediaUrl}
                    alt={photo.altText || "Attachment"}
                    className="w-full h-full object-cover"
                  />
                  {i === 3 && photos.length > 4 && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-xs font-medium">
                      +{photos.length - 4}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onImport("thread")}
              disabled={isImporting}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isImporting ? (
                <>
                  <CircleNotch className="w-4 h-4 animate-spin" />
                  <span>Opening Thread...</span>
                </>
              ) : isDuplicate ? (
                <span>Re-open Thread</span>
              ) : (
                <span>Open & Analyze Thread</span>
              )}
            </button>

            {hasVideo && (
              <button
                onClick={() => onImport("video")}
                disabled={isImporting}
                className="px-3 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                title="Download video file with transcription"
              >
                Download Video
              </button>
            )}
          </div>
        </div>
      ) : videoInfo ? (
        <div className="flex gap-4">
          <div className="flex-shrink-0 w-32 h-20 rounded overflow-hidden bg-muted">
            {videoInfo.thumbnailUrl ? (
              <img
                src={videoInfo.thumbnailUrl}
                alt={videoInfo.title}
                className="w-full h-full object-cover"
              />
            ) : null}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <XLogo className="w-4 h-4" />
              <span className="text-xs font-medium text-muted-foreground uppercase">
                X / Twitter Video
              </span>
            </div>

            <h3 className="text-sm font-medium text-foreground line-clamp-2">
              {videoInfo.title}
            </h3>

            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span>@{videoInfo.author}</span>
              {videoInfo.durationSecs ? (
                <>
                  <span>•</span>
                  <span>{formatDuration(videoInfo.durationSecs)}</span>
                </>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground line-clamp-2 mt-2">
              The video will be downloaded and transcribed automatically.
            </p>
          </div>

          <button
            onClick={() => onImport("video")}
            disabled={isImporting}
            className="flex-shrink-0 self-start px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? (
              <span className="flex items-center gap-2">
                <CircleNotch className="w-4 h-4 animate-spin" />
                Importing...
              </span>
            ) : isDuplicate ? (
              "Re-import"
            ) : (
              "Import Video"
            )}
          </button>
        </div>
      ) : null}

      {/* Import Options */}
      <ImportOptionsUI {...optionsProps} />
    </div>
  );
}

interface RSSImportPreviewProps extends ImportOptionsUIProps {
  data: Feed;
  onImport: () => void;
  isImporting: boolean;
  isDuplicate: boolean;
  existingItem?: { id: string; title: string; type: "document" | "feed" };
  onOpenExisting?: () => void;
}

function RSSImportPreview({
  data,
  onImport,
  isImporting,
  isDuplicate,
  existingItem,
  onOpenExisting,
  ...optionsProps
}: RSSImportPreviewProps) {
  return (
    <div className="px-4 py-3">
      {/* Duplicate warning */}
      {isDuplicate && existingItem && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <Warning className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300">
              Already subscribed
            </div>
            <div className="text-xs text-yellow-600 dark:text-yellow-400 truncate">
              {existingItem.title}
            </div>
          </div>
          {onOpenExisting && (
            <button
              onClick={onOpenExisting}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 rounded hover:bg-yellow-500/30"
            >
              <ArrowSquareOut className="w-3 h-3" />
              Open
            </button>
          )}
        </div>
      )}

      <div className="flex gap-4">
        {/* Icon */}
        <div className="flex-shrink-0 w-12 h-12 rounded bg-orange-500/10 flex items-center justify-center">
          <Rss className="w-6 h-6 text-orange-500" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Rss className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-medium text-muted-foreground uppercase">
              RSS Feed
            </span>
          </div>

          <h3 className="text-sm font-medium text-foreground">
            {data.title}
          </h3>

          {data.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
              {data.description}
            </p>
          )}

          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <span>{data.items.length} items</span>
            {data.category && (
              <>
                <span>•</span>
                <span className="px-1.5 py-0.5 bg-muted rounded">{data.category}</span>
              </>
            )}
          </div>
        </div>

        {/* Subscribe button */}
        <button
          onClick={onImport}
          disabled={isImporting}
          className="flex-shrink-0 self-start px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isImporting ? (
            <span className="flex items-center gap-2">
              <CircleNotch className="w-4 h-4 animate-spin" />
              Subscribing...
            </span>
          ) : isDuplicate ? (
            "Re-subscribe"
          ) : (
            "Subscribe"
          )}
        </button>
      </div>

      {/* Import Options */}
      <ImportOptionsUI {...optionsProps} />
    </div>
  );
}

interface WebPageImportPreviewProps extends ImportOptionsUIProps {
  data: WebPageMetadata;
  onImport: () => void;
  isImporting: boolean;
  isDuplicate: boolean;
  existingItem?: { id: string; title: string; type: "document" | "feed" };
  onOpenExisting?: () => void;
}

function WebPageImportPreview({
  data,
  onImport,
  isImporting,
  isDuplicate,
  existingItem,
  onOpenExisting,
  ...optionsProps
}: WebPageImportPreviewProps) {
  return (
    <div className="px-4 py-3">
      {/* Duplicate warning */}
      {isDuplicate && existingItem && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <Warning className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300">
              Already imported
            </div>
            <div className="text-xs text-yellow-600 dark:text-yellow-400 truncate">
              {existingItem.title}
            </div>
          </div>
          {onOpenExisting && (
            <button
              onClick={onOpenExisting}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 rounded hover:bg-yellow-500/30"
            >
              <ArrowSquareOut className="w-3 h-3" />
              Open
            </button>
          )}
        </div>
      )}

      <div className="flex gap-4">
        {/* Favicon */}
        <div className="flex-shrink-0 w-12 h-12 rounded bg-muted flex items-center justify-center overflow-hidden">
          {data.favicon ? (
            <img src={data.favicon} alt="" className="w-6 h-6" />
          ) : (
            <Globe className="w-6 h-6 text-muted-foreground" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-medium text-muted-foreground uppercase">
              Web Article
            </span>
          </div>

          <h3 className="text-sm font-medium text-foreground line-clamp-2">
            {data.title}
          </h3>

          {data.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
              {data.description}
            </p>
          )}

          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
            <span className="truncate max-w-xs">{data.url}</span>
          </div>
        </div>

        {/* Import button */}
        <button
          onClick={onImport}
          disabled={isImporting}
          className="flex-shrink-0 self-start px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isImporting ? (
            <span className="flex items-center gap-2">
              <CircleNotch className="w-4 h-4 animate-spin" />
              Importing...
            </span>
          ) : isDuplicate ? (
            "Re-import"
          ) : (
            "Import Article"
          )}
        </button>
      </div>

      {/* Import Options */}
      <ImportOptionsUI {...optionsProps} />
    </div>
  );
}

/**
 * Format duration in seconds to readable format
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
