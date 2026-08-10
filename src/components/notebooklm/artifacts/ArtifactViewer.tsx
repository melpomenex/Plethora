import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import {
  Check,
  CircleNotch,
  FilePdf,
  Headphones,
  ImageSquare,
  MapTrifold,
  Plus,
  Table,
  TextT,
  Video,
} from "@phosphor-icons/react";
import { MindMapViewer, parseMindMapData, type MindMapNode } from "./MindMapViewer";
import { createLearningItem } from "../../../api/learning-items";
import { readDocumentFile } from "../../../api/documents";
import {
  notebooklmGetJob,
  notebooklmSetArtifactPosition,
  type NotebookLMJob,
} from "../../../api/integrations";
import { convertFileSrc, isTauri } from "../../../lib/tauri";
import { resolveLocalMediaSource } from "../../viewer/localMediaSource";

export type ArtifactType =
  | "audio"
  | "video"
  | "report"
  | "study-guide"
  | "data-table"
  | "mind-map"
  | "mind_map"
  | "mindmap"
  | "slide-deck"
  | "infographic";

interface ArtifactViewerProps {
  type: ArtifactType;
  content: string;
  title?: string;
  notebookId?: string;
  artifactId?: string;
  onAddToQueue?: () => void;
}

interface DataTableRow {
  [key: string]: string | number;
}

interface ParsedMediaContent {
  url: string | null;
  description: string;
}

async function resolvePlayableMediaUrl(rawUrl: string): Promise<string> {
  const url = rawUrl.trim();
  const isAlreadyWebUrl = /^(https?:|blob:|data:|asset:)/i.test(url);
  if (isAlreadyWebUrl) return url;
  if (isTauri()) return await convertFileSrc(url);
  return url;
}

function parseAudioContent(content: string): ParsedMediaContent {
  try {
    let value: unknown = JSON.parse(content);
    if (typeof value === "object" && value !== null && "jsonContent" in value) {
      value = (value as { jsonContent?: unknown }).jsonContent;
    }
    if (typeof value === "object" && value !== null && "mediaUrl" in value) {
      const v = value as { mediaUrl?: string; rawText?: string };
      return { url: v.mediaUrl ?? null, description: v.rawText || content };
    }
    if (typeof value === "object" && value !== null) {
      const v = value as { audioUrl?: string; url?: string; description?: string; summary?: string };
      return {
        url: v.audioUrl || v.url || null,
        description: v.description || v.summary || content,
      };
    }
  } catch {
    // fallthrough to default
  }
  return { url: null, description: content };
}

function parseVideoContent(content: string): ParsedMediaContent {
  try {
    let value: unknown = JSON.parse(content);
    if (typeof value === "object" && value !== null && "jsonContent" in value) {
      value = (value as { jsonContent?: unknown }).jsonContent;
    }
    if (typeof value === "object" && value !== null && "mediaUrl" in value) {
      const v = value as { mediaUrl?: string; rawText?: string };
      return { url: v.mediaUrl ?? null, description: v.rawText || content };
    }
    if (typeof value === "object" && value !== null) {
      const v = value as { videoUrl?: string; url?: string; description?: string; summary?: string };
      return {
        url: v.videoUrl || v.url || null,
        description: v.description || v.summary || content,
      };
    }
  } catch {
    // fallthrough to default
  }
  return { url: null, description: content };
}

/**
 * Shared resolution for media artifacts (infographic, slide-deck): parses the
 * content envelope, resolves the file to a displayable URL, and — when the job
 * is still queued/running — polls the job until its mediaUrl appears.
 *
 * Resolution mirrors the app's `resolveLocalMediaSource` strategy: the Tauri
 * asset URL (convertFileSrc) is tried first; if it fails to load (CSP block,
 * asset scope denial, or missing file), the file is read through the backend
 * `read_document_file` IPC and served as a blob URL, which `img-src`/`frame-src`
 * already permit. Blob URLs are revoked when the component unmounts.
 */
function useMediaArtifactResolution(
  content: string,
  artifactId?: string,
  mimeType?: string
) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const parsed = useMemo(() => parseVideoContent(content), [content]);
  const blobUrlRef = useRef<string | null>(null);
  // The last raw file path (from the content envelope or job polling) that a
  // blob fallback should read through the backend.
  const rawPathRef = useRef<string | null>(parsed.url ?? null);

  const revokeBlobUrl = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  };

  // Resolve the already-present URL in the content envelope.
  useEffect(() => {
    let active = true;
    rawPathRef.current = parsed.url ?? null;
    const resolveMediaUrl = async () => {
      if (!parsed.url) {
        setMediaUrl(null);
        return;
      }
      setIsResolving(true);
      try {
        const resolved = await resolvePlayableMediaUrl(parsed.url);
        if (active) {
          // Clear any generating state set by a concurrent poll so the
          // spinner never masks an already-resolved media URL.
          setIsGenerating(false);
          setMediaUrl(resolved);
        }
      } catch {
        if (active) {
          setIsGenerating(false);
          setMediaUrl(parsed.url);
        }
      } finally {
        if (active) setIsResolving(false);
      }
    };
    void resolveMediaUrl();
    return () => {
      active = false;
      revokeBlobUrl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.url]);

  /**
   * Fall back to a blob URL read through the backend when the resolved URL
   * cannot be loaded (CSP block, asset-scope denial, or missing file). Called
   * from `<img onError>` / iframe failure so a blocked asset URL still shows
   * the artifact. Reads the last known raw file path — from the content
   * envelope or from job polling — so the fallback also works for a media URL
   * that only became known via `notebooklmGetJob`.
   */
  const retryAsBlobUrl = useCallback(async () => {
    const filePath = rawPathRef.current;
    if (!filePath || mediaUrl?.startsWith("blob:")) return;
    try {
      const bytes = await readDocumentFile(filePath);
      if (!bytes || bytes.byteLength === 0) {
        throw new Error("File not found or empty.");
      }
      const lower = filePath.toLowerCase();
      const mime =
        lower.endsWith(".pdf")
          ? "application/pdf"
          : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
            ? "image/jpeg"
            : lower.endsWith(".webp")
              ? "image/webp"
              : lower.endsWith(".gif")
                ? "image/gif"
                : mimeType || "image/png";
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      revokeBlobUrl();
      blobUrlRef.current = blobUrl;
      setMediaUrl(blobUrl);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [mediaUrl, mimeType]);

  // Poll the job while it is still generating so an in-flight infographic or
  // slide deck resolves once its media file lands (mirrors AudioViewer).
  useEffect(() => {
    if (!artifactId || mediaUrl) return;
    let active = true;
    let timer: number | null = null;

    const pollJob = async () => {
      try {
        const job = await notebooklmGetJob(artifactId);
        if (!active || !job) return;

        const rawUrl = job.payload?.mediaUrl?.trim();
        if (rawUrl) {
          rawPathRef.current = rawUrl;
          const resolved = await resolvePlayableMediaUrl(rawUrl);
          if (active) {
            // Clear the generating state before revealing the media,
            // otherwise the spinner branch wins over the media branch.
            setIsGenerating(false);
            setMediaUrl(resolved);
            return;
          }
        }

        if (job.status === "queued" || job.status === "running") {
          setIsGenerating(true);
          timer = window.setTimeout(pollJob, 2500);
        } else {
          setIsGenerating(false);
        }
      } catch (error) {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "Failed to check generation status");
        }
      }
    };

    void pollJob();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [artifactId, mediaUrl]);

  return {
    mediaUrl,
    isResolving,
    isGenerating,
    loadError,
    setMediaLoadError: setLoadError,
    retryAsBlobUrl,
    parsed,
  };
}

export function ArtifactViewer({
  type,
  content,
  title,
  notebookId: _notebookId,
  artifactId,
  onAddToQueue,
}: ArtifactViewerProps) {
  const [isAddingToQueue, setIsAddingToQueue] = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);

  const handleAddDataTableToQueue = async (data: DataTableRow[]) => {
    setIsAddingToQueue(true);
    try {
      for (const row of data.slice(0, 10)) {
        const keys = Object.keys(row);
        if (keys.length >= 2) {
          const question = `${keys[0]}: ${row[keys[0]]}?`;
          const answer = keys.slice(1).map((k) => `${k}: ${row[k]}`).join("\n");
          await createLearningItem({
            item_type: "Flashcard",
            question,
            answer,
          });
        }
      }
      setAddSuccess(true);
      setTimeout(() => setAddSuccess(false), 2000);
      onAddToQueue?.();
    } finally {
      setIsAddingToQueue(false);
    }
  };

  const handleAddMindMapNodesToQueue = async (nodes: MindMapNode[]) => {
    setIsAddingToQueue(true);
    try {
      for (const node of nodes.slice(0, 20)) {
        await createLearningItem({
          item_type: "Flashcard",
          question: `What is "${node.text}"?`,
          answer: `Key concept from mind map: ${node.text}`,
        });
      }
      setAddSuccess(true);
      setTimeout(() => setAddSuccess(false), 2000);
      onAddToQueue?.();
    } finally {
      setIsAddingToQueue(false);
    }
  };

  const renderContent = () => {
    switch (type) {
      case "audio":
        return <AudioViewer content={content} title={title} artifactId={artifactId} />;
      case "video":
        return <VideoViewer content={content} title={title} artifactId={artifactId} />;
      case "infographic":
        return <InfographicViewer content={content} title={title} artifactId={artifactId} />;
      case "slide-deck":
        return <SlideDeckViewer content={content} title={title} artifactId={artifactId} />;
      case "report":
      case "study-guide":
        return <ReportViewer content={content} title={title} />;
      case "data-table":
        return (
          <DataTableViewer
            content={content}
            title={title}
            onAddToQueue={handleAddDataTableToQueue}
            isAdding={isAddingToQueue}
            addSuccess={addSuccess}
          />
        );
      case "mind-map":
      case "mind_map":
      case "mindmap": {
        // Try to parse the content as mindmap data
        let parsedContent: unknown;
        try {
          parsedContent = JSON.parse(content);
        } catch {
          parsedContent = content;
        }
        
        if (typeof parsedContent === 'object' && parsedContent !== null && 'error' in parsedContent) {
          const errorData = parsedContent as any;
          return (
            <div className="flex flex-col h-full items-center justify-center p-8 text-center">
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-950 rounded-full flex items-center justify-center mb-4">
                <MapTrifold className="w-8 h-8 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Legacy Job Format
              </h3>
              <p className="text-muted-foreground max-w-md mb-6">
                {errorData.message || "This mind map was created with an older version and cannot be displayed."}
              </p>
              {errorData.debug && (
                <div className="p-4 bg-muted rounded-lg text-xs text-muted-foreground mb-4 text-left overflow-auto max-w-md">
                  <p className="font-semibold mb-1">Debug info:</p>
                  <pre>{JSON.stringify(errorData.debug, null, 2)}</pre>
                </div>
              )}
              <div className="p-4 bg-muted rounded-lg text-sm text-muted-foreground">
                <p>Tip: Generate a new Mind MapTrifold to see the interactive visualization.</p>
              </div>
            </div>
          );
        }
        
        if (typeof parsedContent === 'object' && parsedContent !== null && 'jsonContent' in parsedContent) {
          parsedContent = (parsedContent as any).jsonContent;
        }
        
        const mindMapData = parseMindMapData(parsedContent);
        if (mindMapData) {
          return (
            <MindMapViewer
              data={mindMapData}
              title={title}
              onAddToQueue={handleAddMindMapNodesToQueue}
            />
          );
        }
        return (
          <RawContentViewer
            content={content}
            title={title}
            icon={<MapTrifold className="w-6 h-6" />}
          />
        );
      }
      default:
        return (
          <RawContentViewer
            content={content}
            title={title}
            icon={<TextT className="w-6 h-6" />}
          />
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {renderContent()}
    </div>
  );
}

function AudioViewer({ content, title, artifactId }: { content: string; title?: string; artifactId?: string }) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [jobStatus, setJobStatus] = useState<NotebookLMJob["status"] | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  // Holds the resolved source so a blob URL (backend-blob strategy) can be
  // revoked on unmount — mirrors DocumentViewer's mediaSource handling.
  const mediaSourceRef = useRef<{ src: string; revokeSrcOnDispose: boolean } | null>(null);
  // Playback position memory: restore where the user left off and save on
  // pause/timeupdate/unmount so closing and reopening the artifact resumes.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const restoredFromRef = useRef(false);
  const lastSavedPositionRef = useRef(0);
  const savedPositionRef = useRef(0);

  const parsed = useMemo(() => parseAudioContent(content), [content]);

  const savePosition = useCallback((seconds: number) => {
    if (!artifactId || !Number.isFinite(seconds) || seconds < 0) return;
    // Throttle: only write when the position moved by at least a second.
    if (Math.abs(seconds - lastSavedPositionRef.current) < 1) return;
    lastSavedPositionRef.current = seconds;
    savedPositionRef.current = seconds;
    void notebooklmSetArtifactPosition(artifactId, seconds).catch(() => {
      // Best-effort: a failed position write must not break playback.
    });
  }, [artifactId]);

  // Seek to the saved position once the media metadata is ready (or directly
  // if the element already loaded while the position was still being fetched).
  const seekToSavedPosition = useCallback(() => {
    const el = audioRef.current;
    if (!el || restoredFromRef.current) return;
    // Nothing to restore yet (position still being fetched), or no valid
    // duration — don't burn the restored flag on a no-op.
    if (savedPositionRef.current <= 0 || !Number.isFinite(el.duration)) return;
    if (savedPositionRef.current >= el.duration) {
      restoredFromRef.current = true; // at the end already
      return;
    }
    restoredFromRef.current = true;
    el.currentTime = savedPositionRef.current;
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    seekToSavedPosition();
  }, [seekToSavedPosition]);

  const applyResolvedSource = (src: string, revokeOnDispose: boolean) => {
    if (mediaSourceRef.current?.revokeSrcOnDispose) {
      URL.revokeObjectURL(mediaSourceRef.current.src);
    }
    mediaSourceRef.current = { src, revokeSrcOnDispose: revokeOnDispose };
    restoredFromRef.current = false;
    setMediaUrl(src);
  };

  useEffect(() => {
    let active = true;
    const resolveMediaUrl = async () => {
      if (!parsed.url) {
        setMediaUrl(null);
        return;
      }
      // Capture any persisted playback position in parallel with media
      // resolution so loadedmetadata (which may fire as soon as the file
      // loads) finds it already populated.
      if (artifactId) {
        notebooklmGetJob(artifactId)
          .then((job) => {
            if (!active || !job) return;
            if (typeof job.payload?.playbackPosition === "number" && job.payload.playbackPosition > 0) {
              savedPositionRef.current = job.payload.playbackPosition;
              // If the media already loaded while the position was being
              // fetched, seek immediately; otherwise loadedmetadata will.
              seekToSavedPosition();
            }
          })
          .catch(() => {
            // Best-effort.
          });
      }
      setIsResolving(true);
      try {
        // Resolve through the app's media-source strategy (asset URL first,
        // backend-blob fallback) so a blocked or unavailable asset protocol
        // still yields a playable source — mirrors library audio playback.
        const resolved = await resolveLocalMediaSource(parsed.url, "audio");
        if (active) {
          applyResolvedSource(resolved.src, resolved.revokeSrcOnDispose);
        } else if (resolved.revokeSrcOnDispose) {
          // Unmounted mid-resolve: release the blob this call created.
          URL.revokeObjectURL(resolved.src);
        }
      } catch {
        // Last resort: raw URL (works for http(s) remote sources).
        if (active) applyResolvedSource(parsed.url, false);
      } finally {
        if (active) setIsResolving(false);
      }
    };
    void resolveMediaUrl();
    return () => {
      active = false;
      if (mediaSourceRef.current?.revokeSrcOnDispose) {
        URL.revokeObjectURL(mediaSourceRef.current.src);
      }
      mediaSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.url]);

  useEffect(() => {
    if (!artifactId || mediaUrl) return;
    let active = true;
    let timer: number | null = null;

    const pollJob = async () => {
      try {
        const job = await notebooklmGetJob(artifactId);
        if (!active || !job) return;
        setJobStatus(job.status);
        setJobError(job.error || null);

        // Capture any persisted playback position so we can resume where the
        // user left off once the media is ready.
        if (typeof job.payload?.playbackPosition === "number" && job.payload.playbackPosition > 0) {
          savedPositionRef.current = job.payload.playbackPosition;
        }

        const rawUrl = job.payload?.mediaUrl?.trim();
        if (rawUrl) {
          const resolved = await resolveLocalMediaSource(rawUrl, "audio");
          if (active) {
            applyResolvedSource(resolved.src, resolved.revokeSrcOnDispose);
          } else if (resolved.revokeSrcOnDispose) {
            URL.revokeObjectURL(resolved.src);
          }
          return;
        }

        if (job.status === "queued" || job.status === "running") {
          timer = window.setTimeout(pollJob, 2500);
        }
      } catch (error) {
        if (active) {
          setJobError(error instanceof Error ? error.message : "Failed to check generation status");
        }
      }
    };

    void pollJob();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [artifactId, mediaUrl]);

  // Save the final playback position when the artifact viewer closes, so the
  // next open resumes where the user left off.
  useEffect(() => {
    return () => {
      if (savedPositionRef.current > 0) {
        void notebooklmSetArtifactPosition(artifactId ?? "", savedPositionRef.current).catch(() => {
          // Best-effort.
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId]);

  const isGenerating = (jobStatus === "queued" || jobStatus === "running");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
        <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-950 rounded-lg flex items-center justify-center">
          <Headphones className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-foreground">{title || "Audio Overview"}</h3>
          <p className="text-xs text-muted-foreground">Generated by NotebookLM</p>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        {mediaUrl ? (
          <div className="mb-6">
            <audio
              ref={audioRef}
              controls
              className="w-full"
              src={mediaUrl}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={(e) => savePosition(e.currentTarget.currentTime)}
              onPause={(e) => savePosition(e.currentTarget.currentTime)}
            >
              Your browser does not support the audio element.
            </audio>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {(isResolving || isGenerating) ? "NotebookLM is creating your audio overview..." : "Audio file not available yet."}
            </p>
            {(isResolving || isGenerating) && (
              <div className="mt-3 inline-flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                Waiting for NotebookLM media output
              </div>
            )}
            {jobError && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{jobError}</p>
            )}
          </div>
        )}

        <div className="prose prose-sm dark:prose-invert max-w-none">
          <h4>Summary</h4>
          <div className="whitespace-pre-wrap">{parsed.description}</div>
        </div>
      </div>
    </div>
  );
}

function VideoViewer({ content, title, artifactId }: { content: string; title?: string; artifactId?: string }) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [jobStatus, setJobStatus] = useState<NotebookLMJob["status"] | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  // Holds the resolved source so a blob URL (backend-blob strategy) can be
  // revoked on unmount — mirrors DocumentViewer's mediaSource handling.
  const mediaSourceRef = useRef<{ src: string; revokeSrcOnDispose: boolean } | null>(null);
  // Playback position memory: restore where the user left off and save on
  // pause/timeupdate/unmount so closing and reopening the artifact resumes.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const restoredFromRef = useRef(false);
  const lastSavedPositionRef = useRef(0);
  const savedPositionRef = useRef(0);

  const parsed = useMemo(() => parseVideoContent(content), [content]);

  const savePosition = useCallback((seconds: number) => {
    if (!artifactId || !Number.isFinite(seconds) || seconds < 0) return;
    // Throttle: only write when the position moved by at least a second.
    if (Math.abs(seconds - lastSavedPositionRef.current) < 1) return;
    lastSavedPositionRef.current = seconds;
    savedPositionRef.current = seconds;
    void notebooklmSetArtifactPosition(artifactId, seconds).catch(() => {
      // Best-effort: a failed position write must not break playback.
    });
  }, [artifactId]);

  // Seek to the saved position once the video metadata is ready (or directly
  // if the element already loaded while the position was still being fetched).
  const seekToSavedPosition = useCallback(() => {
    const el = videoRef.current;
    if (!el || restoredFromRef.current) return;
    // Nothing to restore yet (position still being fetched), or no valid
    // duration — don't burn the restored flag on a no-op.
    if (savedPositionRef.current <= 0 || !Number.isFinite(el.duration)) return;
    if (savedPositionRef.current >= el.duration) {
      restoredFromRef.current = true; // at the end already
      return;
    }
    restoredFromRef.current = true;
    el.currentTime = savedPositionRef.current;
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    seekToSavedPosition();
  }, [seekToSavedPosition]);

  const applyResolvedSource = (src: string, revokeOnDispose: boolean) => {
    if (mediaSourceRef.current?.revokeSrcOnDispose) {
      URL.revokeObjectURL(mediaSourceRef.current.src);
    }
    mediaSourceRef.current = { src, revokeSrcOnDispose: revokeOnDispose };
    restoredFromRef.current = false;
    setMediaUrl(src);
  };

  useEffect(() => {
    let active = true;
    const resolveMediaUrl = async () => {
      if (!parsed.url) {
        setMediaUrl(null);
        return;
      }
      // Capture any persisted playback position in parallel with media
      // resolution so loadedmetadata (which may fire as soon as the file
      // loads) finds it already populated.
      if (artifactId) {
        notebooklmGetJob(artifactId)
          .then((job) => {
            if (!active || !job) return;
            if (typeof job.payload?.playbackPosition === "number" && job.payload.playbackPosition > 0) {
              savedPositionRef.current = job.payload.playbackPosition;
              // If the media already loaded while the position was being
              // fetched, seek immediately; otherwise loadedmetadata will.
              seekToSavedPosition();
            }
          })
          .catch(() => {
            // Best-effort.
          });
      }
      setIsResolving(true);
      try {
        // Resolve through the app's media-source strategy (asset URL first,
        // backend-blob fallback) so a blocked or unavailable asset protocol
        // still yields a playable source — mirrors library video playback.
        const resolved = await resolveLocalMediaSource(parsed.url, "video");
        if (active) {
          applyResolvedSource(resolved.src, resolved.revokeSrcOnDispose);
        } else if (resolved.revokeSrcOnDispose) {
          // Unmounted mid-resolve: release the blob this call created.
          URL.revokeObjectURL(resolved.src);
        }
      } catch {
        // Last resort: raw URL (works for http(s) remote sources).
        if (active) applyResolvedSource(parsed.url, false);
      } finally {
        if (active) setIsResolving(false);
      }
    };
    void resolveMediaUrl();
    return () => {
      active = false;
      if (mediaSourceRef.current?.revokeSrcOnDispose) {
        URL.revokeObjectURL(mediaSourceRef.current.src);
      }
      mediaSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.url]);

  useEffect(() => {
    if (!artifactId || mediaUrl) return;
    let active = true;
    let timer: number | null = null;

    const pollJob = async () => {
      try {
        const job = await notebooklmGetJob(artifactId);
        if (!active || !job) return;
        setJobStatus(job.status);
        setJobError(job.error || null);

        // Capture any persisted playback position so we can resume where the
        // user left off once the media is ready.
        if (typeof job.payload?.playbackPosition === "number" && job.payload.playbackPosition > 0) {
          savedPositionRef.current = job.payload.playbackPosition;
        }

        const rawUrl = job.payload?.mediaUrl?.trim();
        if (rawUrl) {
          const resolved = await resolveLocalMediaSource(rawUrl, "video");
          if (active) {
            applyResolvedSource(resolved.src, resolved.revokeSrcOnDispose);
          } else if (resolved.revokeSrcOnDispose) {
            URL.revokeObjectURL(resolved.src);
          }
          return;
        }

        if (job.status === "queued" || job.status === "running") {
          timer = window.setTimeout(pollJob, 2500);
        }
      } catch (error) {
        if (active) {
          setJobError(error instanceof Error ? error.message : "Failed to check generation status");
        }
      }
    };

    void pollJob();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [artifactId, mediaUrl]);

  // Save the final playback position when the artifact viewer closes, so the
  // next open resumes where the user left off.
  useEffect(() => {
    return () => {
      if (savedPositionRef.current > 0) {
        void notebooklmSetArtifactPosition(artifactId ?? "", savedPositionRef.current).catch(() => {
          // Best-effort.
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId]);

  const isGenerating = (jobStatus === "queued" || jobStatus === "running");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
        <div className="w-10 h-10 bg-pink-100 dark:bg-pink-950 rounded-lg flex items-center justify-center">
          <Video className="w-5 h-5 text-pink-600 dark:text-pink-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-foreground">{title || "Video Overview"}</h3>
          <p className="text-xs text-muted-foreground">Generated by NotebookLM</p>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        {mediaUrl ? (
          <div className="mb-6">
            <video
              ref={videoRef}
              controls
              className="w-full rounded-lg"
              src={mediaUrl}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={(e) => savePosition(e.currentTarget.currentTime)}
              onPause={(e) => savePosition(e.currentTarget.currentTime)}
            >
              Your browser does not support the video element.
            </video>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {(isResolving || isGenerating) ? "NotebookLM is creating your video overview..." : "Video file not available yet."}
            </p>
            {(isResolving || isGenerating) && (
              <div className="mt-3 inline-flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                Waiting for NotebookLM media output
              </div>
            )}
            {jobError && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{jobError}</p>
            )}
          </div>
        )}

        <div className="prose prose-sm dark:prose-invert max-w-none">
          <h4>Summary</h4>
          <div className="whitespace-pre-wrap">{parsed.description}</div>
        </div>
      </div>
    </div>
  );
}

function InfographicViewer({ content, title, artifactId }: { content: string; title?: string; artifactId?: string }) {
  const { mediaUrl, isResolving, isGenerating, loadError, setMediaLoadError, retryAsBlobUrl, parsed } = useMediaArtifactResolution(content, artifactId, "image/png");

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-3 p-4 border-b border-border bg-card flex-shrink-0">
        <div className="w-10 h-10 bg-rose-100 dark:bg-rose-950 rounded-lg flex items-center justify-center">
          <ImageSquare className="w-5 h-5 text-rose-600 dark:text-rose-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-foreground">{title || "Infographic"}</h3>
          <p className="text-xs text-muted-foreground">Generated by NotebookLM</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isResolving || isGenerating ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <CircleNotch className="w-6 h-6 animate-spin text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {isGenerating ? "NotebookLM is creating your infographic..." : "Loading infographic..."}
              </p>
            </div>
          </div>
        ) : mediaUrl ? (
          <div className="flex items-start justify-center min-h-full">
            <img
              src={mediaUrl}
              alt={title || "Infographic"}
              onError={() => {
                // The asset URL may be blocked (CSP img-src) or out of the
                // asset scope; fall back to a blob URL read through the
                // backend before giving up. If already on a blob URL, the
                // image itself is undecodable — surface that.
                if (mediaUrl.startsWith("blob:")) {
                  setMediaLoadError("The infographic image could not be displayed.");
                  return;
                }
                void retryAsBlobUrl();
              }}
              className="max-w-full h-auto rounded-lg border border-border"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <ImageSquare className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-2">Infographic image not available yet.</p>
            {parsed.description && (
              <pre className="whitespace-pre-wrap text-xs text-muted-foreground bg-muted p-3 rounded-lg max-w-lg">
                {parsed.description}
              </pre>
            )}
          </div>
        )}
        {loadError && (
          <p className="mt-3 text-sm text-red-600" role="alert">{loadError}</p>
        )}
      </div>
    </div>
  );
}

function SlideDeckViewer({ content, title, artifactId }: { content: string; title?: string; artifactId?: string }) {
  const { mediaUrl, isResolving, isGenerating, loadError, retryAsBlobUrl, parsed } = useMediaArtifactResolution(content, artifactId, "application/pdf");

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-3 p-4 border-b border-border bg-card flex-shrink-0">
        <div className="w-10 h-10 bg-teal-100 dark:bg-teal-950 rounded-lg flex items-center justify-center">
          <FilePdf className="w-5 h-5 text-teal-600 dark:text-teal-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-foreground">{title || "Slide Deck"}</h3>
          <p className="text-xs text-muted-foreground">Generated by NotebookLM</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isResolving || isGenerating ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <CircleNotch className="w-6 h-6 animate-spin text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {isGenerating ? "NotebookLM is creating your slide deck..." : "Loading slide deck..."}
              </p>
            </div>
          </div>
        ) : mediaUrl ? (
          <div className="flex flex-col h-full">
            <iframe
              src={mediaUrl}
              title={title || "Slide Deck"}
              className="w-full flex-1 min-h-[480px] rounded-lg border border-border"
            />
            {/* iframes do not reliably report failed loads, so offer an
                explicit fallback that serves the PDF as a blob URL if the
                asset URL is blocked by CSP or asset scope. */}
            {!mediaUrl.startsWith("blob:") && (
              <button
                onClick={() => void retryAsBlobUrl()}
                className="mt-2 self-center text-xs text-muted-foreground hover:text-foreground underline"
              >
                Slide deck not loading? Open with alternate viewer
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <FilePdf className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-2">Slide deck not available yet.</p>
            {parsed.description && (
              <pre className="whitespace-pre-wrap text-xs text-muted-foreground bg-muted p-3 rounded-lg max-w-lg">
                {parsed.description}
              </pre>
            )}
          </div>
        )}
        {loadError && (
          <p className="mt-3 text-sm text-red-600" role="alert">{loadError}</p>
        )}
      </div>
    </div>
  );
}

function ReportViewer({ content, title }: { content: string; title?: string }) {
  // Try to parse as markdown or render as text
  // Simple markdown to HTML conversion (basic)
  const htmlContent = content
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^- (.*$)/gim, "<li>$1</li>")
    .replace(/\*\*(.*)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*)\*/gim, "<em>$1</em>")
    .replace(/\n/gim, "<br />");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
        <div className="w-10 h-10 bg-amber-100 dark:bg-amber-950 rounded-lg flex items-center justify-center">
          <TextT className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-foreground">{title || "Study Guide"}</h3>
          <p className="text-xs text-muted-foreground">Generated by NotebookLM</p>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlContent) }}
        />
      </div>
    </div>
  );
}

interface DataTableViewerProps {
  content: string;
  title?: string;
  onAddToQueue?: (data: DataTableRow[]) => void;
  isAdding?: boolean;
  addSuccess?: boolean;
}

function DataTableViewer({
  content,
  title,
  onAddToQueue,
  isAdding,
  addSuccess,
}: DataTableViewerProps) {
  let data: DataTableRow[] = [];
  let columns: string[] = [];
  let isLegacyError = false;
  let legacyMessage = "";

  try {
    let parsed = JSON.parse(content);
    
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      isLegacyError = true;
      legacyMessage = parsed.message || "This data table was created with an older version.";
    }
    
    if (typeof parsed === 'object' && parsed !== null && 'jsonContent' in parsed) {
      parsed = parsed.jsonContent;
    }
    
    if (Array.isArray(parsed)) {
      data = parsed;
      columns = parsed.length > 0 ? Object.keys(parsed[0]) : [];
    } else if (parsed.data && Array.isArray(parsed.data)) {
      data = parsed.data;
      columns = parsed.columns || (data.length > 0 ? Object.keys(data[0]) : []);
    } else if (parsed.rows && Array.isArray(parsed.rows)) {
      data = parsed.rows;
      columns = parsed.headers || (data.length > 0 ? Object.keys(data[0]) : []);
    }
  } catch {
    // Try CSV parsing
    const lines = content.trim().split("\n");
    if (lines.length > 0) {
      columns = lines[0].split(",").map((c) => c.trim());
      data = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim());
        const row: DataTableRow = {};
        columns.forEach((col, i) => {
          row[col] = values[i] || "";
        });
        return row;
      });
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-950 rounded-lg flex items-center justify-center">
            <Table className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="font-medium text-foreground">{title || "Data Table"}</h3>
            <p className="text-xs text-muted-foreground">
              {data.length} rows • {columns.length} columns
            </p>
          </div>
        </div>
        {onAddToQueue && data.length > 0 && (
          <button
            onClick={() => onAddToQueue(data)}
            disabled={isAdding}
            className="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
          >
            {isAdding ? (
              <CircleNotch className="w-4 h-4 animate-spin" />
            ) : addSuccess ? (
              <Check className="w-4 h-4" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {isAdding ? "Adding..." : addSuccess ? "Added!" : "Add to Queue"}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLegacyError ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-950 rounded-full flex items-center justify-center mb-4">
              <Table className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Legacy Job Format
            </h3>
            <p className="text-muted-foreground max-w-md mb-6">
              {legacyMessage}
            </p>
            <div className="p-4 bg-muted rounded-lg text-sm text-muted-foreground">
              <p>Tip: Generate a new Data Table to see the interactive visualization.</p>
            </div>
          </div>
        ) : data.length > 0 ? (
          <table className="w-full border-collapse">
            <thead className="bg-muted sticky top-0">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="px-4 py-2 text-left text-sm font-medium text-foreground border-b border-border"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="hover:bg-muted/50">
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="px-4 py-2 text-sm text-foreground border-b border-border"
                    >
                      {row[col]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4 text-center text-muted-foreground">
            No data available or unable to parse content.
          </div>
        )}
      </div>
    </div>
  );
}

function RawContentViewer({
  content,
  title,
  icon,
}: {
  content: string;
  title?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
        <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-600 dark:text-gray-400">
          {icon}
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-foreground">{title || "Artifact"}</h3>
          <p className="text-xs text-muted-foreground">Generated by NotebookLM</p>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <pre className="whitespace-pre-wrap text-sm text-foreground bg-muted p-4 rounded-lg">
          {content}
        </pre>
      </div>
    </div>
  );
}
