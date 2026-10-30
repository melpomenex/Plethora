import { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowsClockwise,
  ArrowSquareOut,
  CaretDown,
  CaretRight,
  Check,
  CircleNotch,
  Download,
  Gear,
  Play,
  Plus,
  Queue,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  PlaylistSubscription,
  PlaylistVideo,
  PlaylistSettings,
  getPlaylistSubscriptions,
  getPlaylistSubscription,
  subscribeToPlaylist,
  deletePlaylistSubscription,
  refreshPlaylist,
  updatePlaylistSubscription,
  getPlaylistSettings,
  updatePlaylistSettings,
  importPlaylistVideo,
  isPlaylistUrl,
  formatDuration,
} from "../../api/youtubePlaylist";
import { getYouTubeThumbnail } from "../../api/youtube";
import { isTauri } from "../../lib/tauri";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  isYouTubeApiEnabled,
  validateApiKey,
} from "../../lib/youtubeDataApi";
import { SettingsSearchTarget } from "../settings/search/SettingsSearchNavigation";

interface SubscriptionCardProps {
  sub: PlaylistSubscription;
  isExpanded: boolean;
  isRefreshing: boolean;
  videos: PlaylistVideo[] | undefined;
  importingId: string | null;
  onToggleExpand: () => void;
  onToggleActive: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onImportVideo: (videoId: string) => void;
  onOpenVideoDoc?: (docId: string) => void;
  onUpdateSub: (updated: PlaylistSubscription) => void;
}

function SubscriptionCard({
  sub,
  isExpanded,
  isRefreshing,
  videos,
  importingId,
  onToggleExpand,
  onToggleActive,
  onRefresh,
  onDelete,
  onImportVideo,
  onOpenVideoDoc,
  onUpdateSub,
}: SubscriptionCardProps) {
  const [intervalDraft, setIntervalDraft] = useState(
    sub.queue_intersperse_interval.toString()
  );
  const [priorityDraft, setPriorityDraft] = useState(
    sub.priority_rating.toString()
  );
  const [refreshHoursDraft, setRefreshHoursDraft] = useState(
    sub.refresh_interval_hours.toString()
  );
  const [autoImportDraft, setAutoImportDraft] = useState(sub.auto_import_new);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isDirty =
    intervalDraft !== sub.queue_intersperse_interval.toString() ||
    priorityDraft !== sub.priority_rating.toString() ||
    refreshHoursDraft !== sub.refresh_interval_hours.toString() ||
    autoImportDraft !== sub.auto_import_new;

  useEffect(() => {
    if (!isDirty) {
      setIntervalDraft(sub.queue_intersperse_interval.toString());
      setPriorityDraft(sub.priority_rating.toString());
      setRefreshHoursDraft(sub.refresh_interval_hours.toString());
      setAutoImportDraft(sub.auto_import_new);
    }
  }, [sub, isDirty]);

  const handleCancel = () => {
    setIntervalDraft(sub.queue_intersperse_interval.toString());
    setPriorityDraft(sub.priority_rating.toString());
    setRefreshHoursDraft(sub.refresh_interval_hours.toString());
    setAutoImportDraft(sub.auto_import_new);
    setError(null);
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSaving) return;

    const trimmedInterval = intervalDraft.trim();
    const parsedInterval = parseInt(trimmedInterval, 10);
    if (
      !/^\d+$/.test(trimmedInterval) ||
      isNaN(parsedInterval) ||
      parsedInterval < 1 ||
      parsedInterval > 50
    ) {
      setError("Queue interval must be an integer between 1 and 50.");
      return;
    }

    const trimmedPriority = priorityDraft.trim();
    const parsedPriority = parseInt(trimmedPriority, 10);
    if (
      !/^\d+$/.test(trimmedPriority) ||
      isNaN(parsedPriority) ||
      parsedPriority < 1 ||
      parsedPriority > 10
    ) {
      setError("Priority must be an integer between 1 and 10.");
      return;
    }

    const trimmedRefresh = refreshHoursDraft.trim();
    const parsedRefresh = parseInt(trimmedRefresh, 10);
    if (
      !/^\d+$/.test(trimmedRefresh) ||
      isNaN(parsedRefresh) ||
      parsedRefresh < 1 ||
      parsedRefresh > 168
    ) {
      setError("Refresh interval must be an integer between 1 and 168 hours.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const updated = await updatePlaylistSubscription(sub.id, {
        queue_intersperse_interval: parsedInterval,
        priority_rating: parsedPriority,
        refresh_interval_hours: parsedRefresh,
        auto_import_new: autoImportDraft,
      });
      onUpdateSub(updated);
      setIntervalDraft(updated.queue_intersperse_interval.toString());
      setPriorityDraft(updated.priority_rating.toString());
      setRefreshHoursDraft(updated.refresh_interval_hours.toString());
      setAutoImportDraft(updated.auto_import_new);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className={`border border-border rounded-lg overflow-hidden ${
        !sub.is_active ? "opacity-60" : ""
      }`}
    >
      {/* Subscription Header */}
      <div className="p-4 flex items-center gap-4">
        <button
          onClick={onToggleExpand}
          className="text-muted-foreground hover:text-foreground"
          aria-label={
            isExpanded ? "Collapse playlist details" : "Expand playlist details"
          }
        >
          {isExpanded ? (
            <CaretDown className="w-5 h-5" />
          ) : (
            <CaretRight className="w-5 h-5" />
          )}
        </button>

        {sub.thumbnail_url ? (
          <img
            src={sub.thumbnail_url}
            alt=""
            className="w-16 h-12 object-cover rounded"
          />
        ) : (
          <div className="w-16 h-12 bg-muted rounded flex items-center justify-center">
            <Queue className="w-6 h-6 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">
            {sub.title || "Untitled Playlist"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {sub.channel_name && <span>by {sub.channel_name} • </span>}
            <span>{sub.total_videos || 0} videos</span>
            {sub.last_refreshed_at && (
              <span>
                {" "}
                • Refreshed{" "}
                {new Date(sub.last_refreshed_at).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleActive}
            className={`p-2 rounded-lg transition-colors ${
              sub.is_active
                ? "text-green-500 hover:bg-green-500/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title={sub.is_active ? "Active" : "Paused"}
            aria-label={
              sub.is_active ? "Pause subscription" : "Resume subscription"
            }
          >
            {sub.is_active ? (
              <Check className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="Refresh playlist"
            aria-label="Refresh playlist"
          >
            <ArrowsClockwise
              className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </button>

          <a
            href={sub.playlist_url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="Open on YouTube"
            aria-label="Open on YouTube"
          >
            <ArrowSquareOut className="w-4 h-4" />
          </a>

          <button
            onClick={onDelete}
            className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
            title="Delete subscription"
            aria-label="Delete subscription"
          >
            <Trash className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Subscription Form & Videos */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-4">
          <form
            onSubmit={handleSave}
            aria-label={`Settings for ${sub.title || "playlist"}`}
            className="p-4 bg-muted/40 rounded-lg space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-foreground">
                This playlist settings
              </h4>
              {saved && (
                <span className="text-xs text-green-500 flex items-center gap-1 font-medium">
                  <Check className="w-3.5 h-3.5" /> Saved
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">
                  Queue Interval
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={intervalDraft}
                  onChange={(e) => {
                    setIntervalDraft(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-label="Queue interval"
                  data-testid={`sub-interval-input-${sub.id}`}
                  className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Insert one playlist video after every N non-playlist queue items (1–50)
                </p>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">
                  Priority
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={priorityDraft}
                  onChange={(e) => {
                    setPriorityDraft(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-label="Priority"
                  data-testid={`sub-priority-input-${sub.id}`}
                  className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Priority (1–10, higher numbers mean higher priority)
                </p>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1">
                  Refresh Interval (hours)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={refreshHoursDraft}
                  onChange={(e) => {
                    setRefreshHoursDraft(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-label="Refresh interval in hours"
                  data-testid={`sub-refresh-input-${sub.id}`}
                  className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  How often to check for new videos (1–168 hours)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoImportDraft}
                  onChange={(e) => {
                    setAutoImportDraft(e.target.checked);
                    if (error) setError(null);
                  }}
                  className="rounded"
                />
                <span className="text-sm">Auto-import new videos</span>
              </label>
            </div>

            {error && (
              <div
                role="alert"
                className="p-2.5 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs flex items-center gap-2"
              >
                <WarningCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={handleCancel}
                disabled={!isDirty || isSaving}
                data-testid={`cancel-sub-${sub.id}`}
                className="px-3 py-1 text-xs border border-border rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isDirty || isSaving}
                data-testid={`save-sub-${sub.id}`}
                className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
              >
                {isSaving && <CircleNotch className="w-3.5 h-3.5 animate-spin" />}
                Save
              </button>
            </div>
          </form>

          {/* Videos List */}
          <div className="border-t border-border pt-4">
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Queue className="w-4 h-4" />
              Videos ({videos?.length || 0})
            </h4>
            {videos === undefined ? (
              <div className="flex items-center justify-center py-8">
                <CircleNotch className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : videos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No videos found in this playlist.
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {videos.map((video) => (
                  <div
                    key={video.id}
                    className="flex items-center gap-3 p-2 bg-background rounded-lg border border-border"
                  >
                    <img
                      src={getYouTubeThumbnail(video.video_id)}
                      alt=""
                      className="w-20 h-14 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {video.video_title || "Untitled Video"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {video.video_duration
                          ? formatDuration(video.video_duration)
                          : "Unknown duration"}
                        {video.is_imported && (
                          <span className="ml-2 text-green-600 font-medium">
                            • Imported
                          </span>
                        )}
                      </p>
                    </div>
                    {!video.is_imported && (
                      <button
                        onClick={() => onImportVideo(video.id)}
                        disabled={importingId === video.id}
                        className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                      >
                        {importingId === video.id ? (
                          <CircleNotch className="w-3 h-3 animate-spin" />
                        ) : (
                          <Download className="w-3 h-3" />
                        )}
                        Import
                      </button>
                    )}
                    {video.is_imported && video.document_id && (
                      <button
                        onClick={() => onOpenVideoDoc?.(video.document_id!)}
                        className="px-3 py-1.5 text-sm bg-muted text-foreground rounded hover:bg-muted/80 flex items-center gap-1"
                      >
                        <ArrowSquareOut className="w-3 h-3" />
                        Open
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface YouTubePlaylistManagerProps {
  onImportVideo?: (documentId: string) => void;
}

export function YouTubePlaylistManager({
  onImportVideo,
}: YouTubePlaylistManagerProps) {
  const { t } = useI18n();
  const isDesktop = isTauri();
  const { settings: appSettings, updateSettingsCategory } = useSettingsStore();
  const [subscriptions, setSubscriptions] = useState<PlaylistSubscription[]>(
    []
  );
  const [settings, setSettings] = useState<PlaylistSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [videos, setVideos] = useState<Record<string, PlaylistVideo[]>>({});
  const [importingId, setImportingId] = useState<string | null>(null);

  // Global settings drafts
  const [defaultIntervalDraft, setDefaultIntervalDraft] = useState("");
  const [defaultPriorityDraft, setDefaultPriorityDraft] = useState("");
  const [maxConsecutiveDraft, setMaxConsecutiveDraft] = useState("");
  const [enabledDraft, setEnabledDraft] = useState(true);
  const [preferNewVideosDraft, setPreferNewVideosDraft] = useState(false);
  const [isGlobalSaving, setIsGlobalSaving] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalSaved, setGlobalSaved] = useState(false);

  const isGlobalInitializedRef = useRef(false);

  const isGlobalDirty =
    settings && isGlobalInitializedRef.current
      ? defaultIntervalDraft !==
          settings.default_intersperse_interval.toString() ||
        defaultPriorityDraft !== settings.default_priority.toString() ||
        maxConsecutiveDraft !==
          settings.max_consecutive_playlist_videos.toString() ||
        enabledDraft !== settings.enabled ||
        preferNewVideosDraft !== settings.prefer_new_videos
      : false;

  useEffect(() => {
    if (settings) {
      if (!isGlobalInitializedRef.current || !isGlobalDirty) {
        isGlobalInitializedRef.current = true;
        setDefaultIntervalDraft(settings.default_intersperse_interval.toString());
        setDefaultPriorityDraft(settings.default_priority.toString());
        setMaxConsecutiveDraft(
          settings.max_consecutive_playlist_videos.toString()
        );
        setEnabledDraft(settings.enabled);
        setPreferNewVideosDraft(settings.prefer_new_videos);
      }
    }
  }, [settings, isGlobalDirty]);

  // Browser mode: API key configuration
  const [apiKeyInput, setApiKeyInput] = useState(
    appSettings?.youtube?.apiKey || ""
  );
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [keyValidationResult, setKeyValidationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [subs, sett] = await Promise.all([
        getPlaylistSubscriptions(),
        getPlaylistSettings(),
      ]);
      setSubscriptions(subs);
      setSettings(sett);
      // Clear cached videos since we're reloading
      setVideos({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddSubscription = async () => {
    if (!newUrl.trim() || !isPlaylistUrl(newUrl)) {
      setError(
        "Please enter a valid YouTube playlist URL (e.g., https://www.youtube.com/playlist?list=...)"
      );
      return;
    }

    setIsAdding(true);
    setError(null);

    try {
      await subscribeToPlaylist(newUrl);
      setNewUrl("");
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("yt-dlp") || message.includes("playlist")) {
        setError(
          "Could not access playlist:\n\n" +
            message +
            "\n\nTips:\n" +
            "• Make sure the playlist URL is correct\n" +
            "• For unlisted playlists: open the playlist in your browser first\n" +
            "• For private playlists: they cannot be imported\n" +
            "• Try updating yt-dlp: yt-dlp -U\n" +
            "• Check the terminal/console for detailed error logs"
        );
      } else {
        setError(message);
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("delete.unsubscribeConfirm"))) return;

    try {
      await deletePlaylistSubscription(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    setError(null);

    try {
      const result = await refreshPlaylist(id, true);
      if (result.new_videos_found > 0) {
        await loadData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingId(null);
    }
  };

  const handleToggleActive = async (sub: PlaylistSubscription) => {
    try {
      const updated = await updatePlaylistSubscription(sub.id, {
        is_active: !sub.is_active,
      });
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleImportVideo = async (playlistVideoId: string) => {
    setImportingId(playlistVideoId);
    try {
      const doc = await importPlaylistVideo(playlistVideoId);
      onImportVideo?.(doc.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingId(null);
    }
  };

  const handleCancelGlobal = () => {
    if (settings) {
      setDefaultIntervalDraft(settings.default_intersperse_interval.toString());
      setDefaultPriorityDraft(settings.default_priority.toString());
      setMaxConsecutiveDraft(
        settings.max_consecutive_playlist_videos.toString()
      );
      setEnabledDraft(settings.enabled);
      setPreferNewVideosDraft(settings.prefer_new_videos);
      setGlobalError(null);
    }
  };

  const handleSaveGlobal = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!settings || isGlobalSaving) return;

    const trimmedInterval = defaultIntervalDraft.trim();
    const parsedInterval = parseInt(trimmedInterval, 10);
    if (
      !/^\d+$/.test(trimmedInterval) ||
      isNaN(parsedInterval) ||
      parsedInterval < 1 ||
      parsedInterval > 50
    ) {
      setGlobalError(
        "Default queue interval must be an integer between 1 and 50."
      );
      return;
    }

    const trimmedPriority = defaultPriorityDraft.trim();
    const parsedPriority = parseInt(trimmedPriority, 10);
    if (
      !/^\d+$/.test(trimmedPriority) ||
      isNaN(parsedPriority) ||
      parsedPriority < 1 ||
      parsedPriority > 10
    ) {
      setGlobalError("Default priority must be an integer between 1 and 10.");
      return;
    }

    const trimmedMax = maxConsecutiveDraft.trim();
    const parsedMax = parseInt(trimmedMax, 10);
    if (
      !/^\d+$/.test(trimmedMax) ||
      isNaN(parsedMax) ||
      parsedMax < 1 ||
      parsedMax > 5
    ) {
      setGlobalError(
        "Max consecutive playlist videos must be an integer between 1 and 5."
      );
      return;
    }

    setIsGlobalSaving(true);
    setGlobalError(null);
    try {
      const updated = await updatePlaylistSettings({
        enabled: enabledDraft,
        prefer_new_videos: preferNewVideosDraft,
        default_intersperse_interval: parsedInterval,
        default_priority: parsedPriority,
        max_consecutive_playlist_videos: parsedMax,
      });
      setSettings(updated);
      setDefaultIntervalDraft(updated.default_intersperse_interval.toString());
      setDefaultPriorityDraft(updated.default_priority.toString());
      setMaxConsecutiveDraft(
        updated.max_consecutive_playlist_videos.toString()
      );
      setEnabledDraft(updated.enabled);
      setPreferNewVideosDraft(updated.prefer_new_videos);
      setGlobalSaved(true);
      setTimeout(() => setGlobalSaved(false), 2500);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGlobalSaving(false);
    }
  };

  const handleUpdateSub = (updated: PlaylistSubscription) => {
    setSubscriptions((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s))
    );
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(id);

    if (!videos[id]) {
      try {
        const detail = await getPlaylistSubscription(id);
        setVideos((prev) => ({ ...prev, [id]: detail.videos }));
      } catch (err) {
        console.error("Failed to fetch playlist videos:", err);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <CircleNotch className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // Browser/PWA mode with YouTube Data API support
  if (!isDesktop) {
    const handleSaveApiKey = async () => {
      if (!apiKeyInput.trim()) {
        updateSettingsCategory("youtube", {
          apiKey: undefined,
          enabled: false,
        });
        setKeyValidationResult({ success: true, message: "API key cleared" });
        return;
      }

      setIsValidatingKey(true);
      setKeyValidationResult(null);

      const isValid = await validateApiKey(apiKeyInput.trim());

      if (isValid) {
        updateSettingsCategory("youtube", {
          apiKey: apiKeyInput.trim(),
          enabled: true,
        });
        setKeyValidationResult({
          success: true,
          message: "API key validated and saved!",
        });
      } else {
        setKeyValidationResult({
          success: false,
          message: "Invalid API key. Please check your key and try again.",
        });
      }

      setIsValidatingKey(false);
    };

    const hasApiKey = isYouTubeApiEnabled() || !!appSettings?.youtube?.apiKey;

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Queue className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">YouTube Playlist Import</h2>
        </div>

        {/* API Key Configuration */}
        <div className="p-4 bg-card border border-border rounded-lg space-y-4">
          <div className="flex items-center gap-2">
            <Gear className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-medium">YouTube Data API Configuration</h3>
            {hasApiKey && (
              <span className="ml-auto px-2 py-0.5 bg-green-500/20 text-green-500 text-xs rounded-full">
                Configured
              </span>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            To import YouTube playlists in the web app, you need a YouTube Data
            API key. Your API key is stored locally in your browser.
          </p>

          <div className="space-y-2">
            <label className="block text-sm font-medium">API Key</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Enter your YouTube Data API key..."
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={handleSaveApiKey}
                disabled={isValidatingKey}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              >
                {isValidatingKey ? (
                  <CircleNotch className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save
              </button>
            </div>

            {keyValidationResult && (
              <p
                className={`text-sm ${
                  keyValidationResult.success
                    ? "text-green-500"
                    : "text-destructive"
                }`}
              >
                {keyValidationResult.message}
              </p>
            )}
          </div>

          <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">
              How to get an API key:
            </p>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                Go to the{" "}
                <a
                  href="https://console.cloud.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Google Cloud Console
                </a>
              </li>
              <li>Create a new project or select an existing one</li>
              <li>
                Enable the <strong>YouTube Data API v3</strong>
              </li>
              <li>Create credentials (API Key)</li>
              <li>Copy and paste the key here</li>
            </ol>
          </div>
        </div>

        {/* Playlist Import Section */}
        {hasApiKey ? (
          <div className="p-4 bg-card border border-border rounded-lg space-y-4">
            <h3 className="font-medium">Import Playlist</h3>

            <div className="flex gap-2">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="Paste YouTube playlist URL..."
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                onKeyDown={(e) => e.key === "Enter" && handleAddSubscription()}
              />
              <button
                onClick={handleAddSubscription}
                disabled={isAdding || !newUrl.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              >
                {isAdding ? (
                  <CircleNotch className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Import
              </button>
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-destructive text-sm">
                <WarningCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="flex-1 whitespace-pre-line">{error}</div>
              </div>
            )}

            <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
              <p>
                <strong>Note:</strong> In the web app, playlist import is a
                one-time operation. Videos will be imported as individual
                documents. For auto-import and queue interspersion features, use
                the{" "}
                <a
                  href="https://github.com/melpomenex/incrementum-tauri/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  desktop app
                </a>
                .
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-3">
              <WarningCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-amber-900 dark:text-amber-100">
                  API Key Required
                </h4>
                <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                  Please configure your YouTube Data API key above to import
                  playlists.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <SettingsSearchTarget
      id="integrations.youtubePlaylist"
      label={t("integrations.youtubePlaylists", "YouTube Playlists")}
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Queue className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">
              YouTube Playlist Auto-Import
            </h2>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            aria-expanded={showSettings}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            <Gear className="w-4 h-4" />
            Settings
          </button>
        </div>

        {/* Global Settings */}
        {showSettings && settings && (
          <SettingsSearchTarget
            id="integrations.youtubePlaylist.defaults"
            label={t("youtubePlaylist.globalSettings", "Defaults for new playlists")}
          >
            <form
              onSubmit={handleSaveGlobal}
              aria-label="Defaults for new playlists"
              className="p-4 bg-muted/50 rounded-lg space-y-4 border border-border"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-foreground">
                    Defaults for new playlists
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Applied when creating new subscriptions. Existing playlists
                    retain their saved values.
                  </p>
                </div>
                {globalSaved && (
                  <span className="text-xs text-green-500 flex items-center gap-1 font-medium">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledDraft}
                    onChange={(e) => {
                      setEnabledDraft(e.target.checked);
                      if (globalError) setGlobalError(null);
                    }}
                    className="rounded"
                  />
                  <span className="text-sm">Enable playlist auto-import</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferNewVideosDraft}
                    onChange={(e) => {
                      setPreferNewVideosDraft(e.target.checked);
                      if (globalError) setGlobalError(null);
                    }}
                    className="rounded"
                  />
                  <span className="text-sm">Prefer newer videos in queue</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    Default Queue Interval
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={defaultIntervalDraft}
                    onChange={(e) => {
                      setDefaultIntervalDraft(e.target.value);
                      if (globalError) setGlobalError(null);
                    }}
                    aria-label="Default Queue Interval"
                    data-testid="global-default-interval-input"
                    className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Insert one playlist video after every N non-playlist queue
                    items (1–50)
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    Default Priority
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={defaultPriorityDraft}
                    onChange={(e) => {
                      setDefaultPriorityDraft(e.target.value);
                      if (globalError) setGlobalError(null);
                    }}
                    aria-label="Default Priority"
                    data-testid="global-default-priority-input"
                    className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Priority (1–10, higher numbers mean higher priority)
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-muted-foreground mb-1">
                    Max Consecutive
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={maxConsecutiveDraft}
                    onChange={(e) => {
                      setMaxConsecutiveDraft(e.target.value);
                      if (globalError) setGlobalError(null);
                    }}
                    aria-label="Max Consecutive"
                    data-testid="global-max-consecutive-input"
                    className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Max consecutive playlist videos per slot (1–5)
                  </p>
                </div>
              </div>

              {globalError && (
                <div
                  role="alert"
                  className="p-2.5 bg-destructive/10 border border-destructive/20 rounded text-destructive text-xs flex items-center gap-2"
                >
                  <WarningCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{globalError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={handleCancelGlobal}
                  disabled={!isGlobalDirty || isGlobalSaving}
                  data-testid="cancel-global-settings"
                  className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isGlobalDirty || isGlobalSaving}
                  data-testid="save-global-settings"
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5 font-medium"
                >
                  {isGlobalSaving && (
                    <CircleNotch className="w-4 h-4 animate-spin" />
                  )}
                  Save
                </button>
              </div>
            </form>
          </SettingsSearchTarget>
        )}

        {/* Add New */}
        <div className="flex gap-2">
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="Paste YouTube playlist URL..."
            className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            onKeyDown={(e) => e.key === "Enter" && handleAddSubscription()}
          />
          <button
            onClick={handleAddSubscription}
            disabled={isAdding || !newUrl.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {isAdding ? (
              <CircleNotch className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Add Playlist
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-destructive text-sm">
            <WarningCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1 whitespace-pre-line">{error}</div>
            <button
              onClick={() => setError(null)}
              className="ml-auto hover:underline flex-shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Subscriptions List */}
        {subscriptions.length === 0 ? (
          <div className="text-center py-12 bg-muted/30 rounded-lg">
            <Queue className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
            <h3 className="font-medium text-muted-foreground mb-1">
              No playlists subscribed
            </h3>
            <p className="text-sm text-muted-foreground/70">
              Add a YouTube playlist URL above to start auto-importing videos
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {subscriptions.map((sub) => (
              <SubscriptionCard
                key={sub.id}
                sub={sub}
                isExpanded={expandedId === sub.id}
                isRefreshing={refreshingId === sub.id}
                videos={videos[sub.id]}
                importingId={importingId}
                onToggleExpand={() => toggleExpand(sub.id)}
                onToggleActive={() => handleToggleActive(sub)}
                onRefresh={() => handleRefresh(sub.id)}
                onDelete={() => handleDelete(sub.id)}
                onImportVideo={handleImportVideo}
                onOpenVideoDoc={(docId) => onImportVideo?.(docId)}
                onUpdateSub={handleUpdateSub}
              />
            ))}
          </div>
        )}
      </div>
    </SettingsSearchTarget>
  );
}
