import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  CaretLeft,
  CaretRight,
  CircleNotch,
  Crosshair,
  MagnifyingGlass,
  Warning,
  X,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { useDocumentStore } from "../../stores/documentStore";
import { useTranscriptionStore } from "../../stores/useTranscriptionStore";
import { ResizableSplit } from "./ResizableSplit";
import { AudiobookViewer } from "./AudiobookViewer";
import { EPUBViewer } from "./EPUBViewer";
import * as documentsApi from "../../api/documents";
import { parseChapters, parseAudiobookMetadata } from "../../api/audiobooks";
import { getTranscript, type TranscriptSegment as TranscriptionSegment } from "../../api/transcription";
import type { SyncSegment } from "../../utils/epubSync";
import {
  fromSegments,
  loadAlignmentMap,
  saveAlignmentMap,
  isAlignmentStale,
  computePairId,
  normalizeAudioChapterBounds,
  type PlethoraAlignmentMap,
  type TranscriptionWord,
} from "../../lib/ebookAudiobookAlignment";
import { speechSectionsToChapters, simpleContentHash } from "../../lib/ebookAudiobookAlignment/epubChapterExtract";
import { useAlignmentPlayback, useSeekToAlignedWord } from "../../hooks/useAlignmentPlayback";

type SyncTranscriptSegment = {
  text: string;
  startTime: number;
  endTime: number;
  words?: TranscriptionWord[];
};

function normalizeStoredWordTimings(parsed: unknown): TranscriptionWord[] | undefined {
  if (!Array.isArray(parsed)) return undefined;
  try {
    const words = (parsed as Array<{
      word?: string;
      text?: string;
      start_ms?: number;
      end_ms?: number;
      startMs?: number;
      endMs?: number;
    }>)
      .map((word) => ({
        text: typeof word.word === "string" ? word.word : word.text ?? "",
        startMs: Number(word.start_ms ?? word.startMs),
        endMs: Number(word.end_ms ?? word.endMs),
      }))
      .filter((word) => word.text.trim().length > 0 && Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && word.endMs > word.startMs);
    return words.length > 0 ? words : undefined;
  } catch {
    return undefined;
  }
}

function parseStoredWordTimings(raw: string | null | undefined): TranscriptionWord[] | undefined {
  if (!raw) return undefined;
  try {
    return normalizeStoredWordTimings(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function loadImportedTranscript(documentId: string): SyncTranscriptSegment[] {
  try {
    const raw = localStorage.getItem(`audiobook-${documentId}`);
    const segments = JSON.parse(raw ?? "null")?.transcript?.segments;
    if (!Array.isArray(segments)) return [];
    return segments
      .map((segment) => ({
        text: typeof segment?.text === "string" ? segment.text : "",
        startTime: Number(segment?.startTime),
        endTime: Number(segment?.endTime),
        words: normalizeStoredWordTimings(segment?.wordTimings),
      }))
      .filter((segment) => segment.text.trim().length > 0 && Number.isFinite(segment.startTime) && Number.isFinite(segment.endTime) && segment.endTime > segment.startTime);
  } catch {
    return [];
  }
}

interface AudiobookEpubSyncViewProps {
  audioDocumentId: string;
  epubDocumentId: string;
  onClose?: () => void;
}

export function AudiobookEpubSyncView({
  audioDocumentId,
  epubDocumentId,
  onClose,
}: AudiobookEpubSyncViewProps) {
  const documents = useDocumentStore((s) => s.documents);
  const activeTranscriptSegments = useTranscriptionStore((s) => s.activeSegments);
  const activeTranscriptBookId = useTranscriptionStore((s) => s.activeTranscriptBookId);
  const audioDoc = documents.find((d) => d.id === audioDocumentId);
  const epubDoc = documents.find((d) => d.id === epubDocumentId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [epubKey, setEpubKey] = useState(0);

  const [epubFileData, setEpubFileData] = useState<Uint8Array | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [audioChapters, setAudioChapters] = useState<Array<{ title: string; startTime: number; endTime: number }>>([]);
  const [transcriptSegments, setTranscriptSegments] = useState<SyncTranscriptSegment[]>([]);
  const [audioDuration, setAudioDuration] = useState(0);
  const [epubToc, setEpubToc] = useState<Array<{ href: string; label: string }>>([]);
  const [speechSections, setSpeechSections] = useState<Array<{ spineIndex: number; href: string; text: string }>>([]);

  const [alignmentMap, setAlignmentMap] = useState<PlethoraAlignmentMap | null>(null);
  const [alignmentCacheChecked, setAlignmentCacheChecked] = useState(false);
  const [alignProgress, setAlignProgress] = useState<string | null>(null);
  const [aligning, setAligning] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioTimeRef = useRef(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const wasHidden = useRef(false);

  const ebookHash = simpleContentHash(epubDocumentId, epubDoc?.filePath);
  const audioHash = simpleContentHash(audioDocumentId, audioDoc?.filePath);
  const pairId = computePairId(epubDocumentId, audioDocumentId, ebookHash, audioHash);

  // The player publishes the transcript loaded after an in-viewer
  // transcription. Prefer it while it belongs to this audiobook so opening
  // the split view after transcription does not require a second reload.
  const effectiveTranscriptSegments = useMemo(() => {
    if (activeTranscriptBookId === audioDocumentId && activeTranscriptSegments.length > 0) {
      return activeTranscriptSegments.map((segment) => ({
        text: segment.text,
        startTime: segment.start_ms / 1000,
        endTime: segment.end_ms / 1000,
        words: parseStoredWordTimings(segment.words_json),
      }));
    }
    return transcriptSegments;
  }, [activeTranscriptBookId, activeTranscriptSegments, audioDocumentId, transcriptSegments]);

  const transcriptTimeline = useMemo(() => {
    if (effectiveTranscriptSegments.length === 0) return null;
    return fromSegments(
      effectiveTranscriptSegments.map((segment) => ({
        text: segment.text,
        startMs: Math.round(segment.startTime * 1000),
        endMs: Math.round(segment.endTime * 1000),
        words: segment.words,
      })),
      "plethora-audiobook",
    );
  }, [effectiveTranscriptSegments]);
  const transcriptFingerprint = transcriptTimeline?.fingerprint ?? null;

  const useWordSync =
    alignmentMap !== null && alignmentMap.overallConfidence >= 0.3;

  const getAudioTimeSec = useCallback(() => audioTimeRef.current, []);

  const playback = useAlignmentPlayback(alignmentMap, getAudioTimeSec, useWordSync);
  const seekToWord = useSeekToAlignedWord(audioRef, playback.lookup);

  const handleAudioTimeUpdate = useCallback(
    (t: number) => {
      audioTimeRef.current = t;
      if (!useWordSync) setAudioCurrentTime(t);
    },
    [useWordSync],
  );

  const handleAudioDurationChange = useCallback((duration: number) => {
    if (Number.isFinite(duration) && duration > 0) {
      setAudioDuration((previous) => Math.max(previous, duration));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!transcriptFingerprint) {
      setAlignmentMap(null);
      setAlignmentCacheChecked(false);
      return () => { cancelled = true; };
    }
    // Do not keep using a map while its transcript fingerprint is being
    // checked. Otherwise a newly completed transcription can leave the old
    // map active and suppress the automatic rebuild below.
    setAlignmentMap(null);
    setAlignmentCacheChecked(false);
    loadAlignmentMap(pairId)
      .then((map) => {
        if (!cancelled && map && !isAlignmentStale(map, ebookHash, audioHash, transcriptFingerprint)) {
          setAlignmentMap(map);
        }
      })
      .catch(() => {
        // A cache miss or an unavailable native cache should still allow a
        // fresh alignment to run.
      })
      .finally(() => {
        if (!cancelled) setAlignmentCacheChecked(true);
      });
    return () => { cancelled = true; };
  }, [pairId, ebookHash, audioHash, transcriptFingerprint]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) wasHidden.current = true;
      else if (wasHidden.current) {
        wasHidden.current = false;
        setEpubKey((k) => k + 1);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!audioDoc?.filePath || !epubDoc?.filePath) {
      setLoadError("Missing file paths for one or both documents.");
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        // AudiobookViewer owns the local media lifecycle. In particular, the
        // desktop M4B preparation + range-server path must not be bypassed by
        // handing it a second, pre-resolved source from the split view.
        const epubData = await documentsApi.readDocumentFile(epubDoc!.filePath);
        if (cancelled) return;
        setEpubFileData(epubData);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load documents");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [audioDoc?.filePath, epubDoc?.filePath]);

  useEffect(() => {
    if (!audioDoc?.filePath) return;
    let cancelled = false;
    setAudioChapters([]);
    setTranscriptSegments([]);
    setAudioDuration(0);
    async function loadMeta() {
      try {
        const [chapters, meta] = await Promise.all([
          parseChapters(audioDoc!.filePath),
          parseAudiobookMetadata(audioDoc!.filePath),
        ]);
        const duration = Number.isFinite(meta.duration) && meta.duration > 0 ? meta.duration : 0;
        if (!cancelled) {
          setAudioDuration(duration);
          const parsedChapters = chapters.length > 0 ? chapters : (meta.chapters ?? []);
          setAudioChapters(normalizeAudioChapterBounds(parsedChapters, duration));
        }

        if (!cancelled) {
          const rawSegments: TranscriptionSegment[] = [];
          const transcriptIds = new Set<string>([audioDoc!.id, "default"]);
          for (const ch of [...chapters, ...(meta.chapters ?? [])]) {
            if (Number.isFinite(ch.id)) transcriptIds.add(String(ch.id));
            if (Number.isFinite(ch.startTime)) transcriptIds.add(String(ch.startTime));
          }

          // Auto-transcription stores a whole-book row under document.id;
          // legacy chapter transcription used chapter IDs or start times.
          // Read all known keys and merge them so either history works.
          for (const transcriptId of transcriptIds) {
            try {
              const resp = await getTranscript(audioDoc!.id, transcriptId);
              if (resp?.segments) rawSegments.push(...resp.segments);
            } catch { /* partial */ }
          }
          if (!cancelled) {
            const uniqueSegments = new Map<string, TranscriptionSegment>();
            for (const segment of rawSegments) {
              const key = `${segment.start_ms}:${segment.end_ms}:${segment.text}`;
              uniqueSegments.set(key, segment);
            }
            if (uniqueSegments.size > 0) {
              setTranscriptSegments(
                [...uniqueSegments.values()]
                  .sort((a, b) => a.start_ms - b.start_ms)
                  .map((seg) => ({
                    text: seg.text,
                    startTime: seg.start_ms / 1000,
                    endTime: seg.end_ms / 1000,
                    words: parseStoredWordTimings(seg.words_json),
                  })),
              );
            } else {
              setTranscriptSegments(loadImportedTranscript(audioDoc!.id));
            }
          }
        }
      } catch { /* ignore */ }
    }
    loadMeta();
    return () => { cancelled = true; };
  }, [audioDoc?.filePath, audioDoc?.id]);

  const handleEpubLoad = useCallback((toc: Array<{ href?: string; label?: string }>) => {
    setEpubToc(toc.map((item) => ({ href: item.href || "", label: item.label?.trim() || "" })));
  }, []);

  const handleSpeechSections = useCallback(
    (sections: Array<{ spineIndex: number; href: string; text: string }>) => {
      setSpeechSections(sections);
    },
    [],
  );

  const runAlignment = useCallback(async () => {
    if (effectiveTranscriptSegments.length === 0 || !transcriptTimeline) {
      setAlignProgress("Transcribe the audiobook first.");
      return;
    }
    if (speechSections.length === 0) {
      setAlignProgress("Waiting for ebook text…");
      return;
    }

    setAligning(true);
    setAlignProgress("Preparing…");

    try {
      const timeline = fromSegments(
        effectiveTranscriptSegments.map((s) => ({
          text: s.text,
          startMs: Math.round(s.startTime * 1000),
          endMs: Math.round(s.endTime * 1000),
          words: s.words,
        })),
        "plethora-audiobook",
      );

      const ebookChapters = speechSectionsToChapters(speechSections, epubToc);
      const transcriptDuration = effectiveTranscriptSegments.reduce(
        (max, segment) => Math.max(max, segment.endTime),
        0,
      );
      const boundedAudioChapters = normalizeAudioChapterBounds(
        audioChapters.length > 0
          ? audioChapters
          : [{ title: "Audiobook", startTime: 0, endTime: transcriptDuration }],
        Math.max(audioDuration, transcriptDuration),
      );
      const audioChapterInputs = boundedAudioChapters.map((c, index) => ({
        index,
        title: c.title,
        startMs: Math.round(c.startTime * 1000),
        endMs: Math.round(c.endTime * 1000),
      }));

      const input = {
        ebookDocId: epubDocumentId,
        audioDocId: audioDocumentId,
        ebookContentHash: ebookHash,
        audioContentHash: audioHash,
        chapters: ebookChapters,
        audioChapters: audioChapterInputs,
        timeline,
      };

      const map = await new Promise<import("../../lib/ebookAudiobookAlignment/types").PlethoraAlignmentMap>((resolve, reject) => {
        const worker = new Worker(
          new URL("../../workers/ebookAudiobookAlignment.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (ev: MessageEvent) => {
          if (ev.data.type === "progress") {
            setAlignProgress(ev.data.progress.message);
          } else if (ev.data.type === "complete") {
            worker.terminate();
            resolve(ev.data.map);
          } else if (ev.data.type === "error") {
            worker.terminate();
            reject(new Error(ev.data.message));
          }
        };
        worker.onerror = (err) => {
          worker.terminate();
          reject(err);
        };
        worker.postMessage({ type: "align", input });
      });

      await saveAlignmentMap(map);
      setAlignmentMap(map);
      setAlignProgress(`Complete — ${Math.round(map.overallConfidence * 100)}% confidence`);
    } catch (err) {
      setAlignProgress(err instanceof Error ? err.message : "Alignment failed");
    } finally {
      setAligning(false);
    }
  }, [
    effectiveTranscriptSegments,
    transcriptTimeline,
    speechSections,
    epubToc,
    audioChapters,
    audioDuration,
    epubDocumentId,
    audioDocumentId,
    ebookHash,
    audioHash,
  ]);

  // Cached maps are intentionally preferred, but a newly transcribed pair
  // should become usable without making the user discover the refresh icon.
  // The attempt key prevents an error from spawning an alignment worker on
  // every render while still allowing a new transcript or EPUB load to retry.
  const alignmentAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      alignmentMap || aligning || !transcriptFingerprint ||
      !alignmentCacheChecked || speechSections.length === 0
    ) return;
    const attemptKey = `${pairId}:${transcriptFingerprint}:${speechSections.length}:${audioChapters.length}`;
    if (alignmentAttemptRef.current === attemptKey) return;
    alignmentAttemptRef.current = attemptKey;
    void runAlignment();
  }, [
    alignmentMap,
    alignmentCacheChecked,
    aligning,
    pairId,
    runAlignment,
    speechSections.length,
    transcriptFingerprint,
  ]);

  const syncSegments: SyncSegment[] = useMemo(
    () =>
      effectiveTranscriptSegments.map((seg, idx) => ({
        index: idx,
        text: seg.text,
        startTime: seg.startTime,
        endTime: seg.endTime,
      })),
    [effectiveTranscriptSegments],
  );

  const [syncState, setSyncState] = useState<{
    status: "idle" | "building" | "ready" | "error";
    mappedCount: number;
    totalSegments: number;
  }>({ status: "idle", mappedCount: 0, totalSegments: 0 });

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState<number | null>(null);
  const [searchTotal, setSearchTotal] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [syncJumpSignal, setSyncJumpSignal] = useState(0);

  const syncActiveWord = useMemo(() => {
    if (!useWordSync || !playback.activeWord) return null;
    const loc = playback.activeWord.locator;
    if (loc.kind !== "epub") return null;
    return {
      chapterHref: loc.chapterHref,
      charOffset: loc.charOffset,
      text: playback.activeWord.text,
      interpolated: playback.activeWord.interpolated,
    };
  }, [useWordSync, playback.activeWord]);

  const handleSyncWordClick = useCallback(
    (charOffset: number, chapterHref: string) => {
      const word = playback.lookup?.findWordByCharOffset(chapterHref, charOffset);
      if (word) seekToWord(word);
    },
    [playback.lookup, seekToWord],
  );

  if (!audioDoc || !epubDoc) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Documents not found.</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md px-4">
          <Warning className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <p className="text-muted-foreground">{loadError}</p>
        </div>
      </div>
    );
  }

  const audioPanel = (
    <div className="h-full flex flex-col relative">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Exit split view"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <CircleNotch className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <AudiobookViewer
          document={audioDoc}
          audioRef={audioRef}
          onTimeUpdate={handleAudioTimeUpdate}
          onDurationChange={handleAudioDurationChange}
          hideTitleHeader={true}
        />
      )}
    </div>
  );

  const epubPanel = (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-card flex-shrink-0">
        {showSearch ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search in book..."
              aria-label="Search in book"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchMatchIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const next = e.shiftKey ? (searchMatchIndex ?? 0) - 1 : (searchMatchIndex ?? 0) + 1;
                  setSearchMatchIndex(((next % searchTotal) + searchTotal) % searchTotal);
                } else if (e.key === "Escape") {
                  setShowSearch(false);
                  setSearchQuery("");
                  setSearchMatchIndex(null);
                }
              }}
              className="flex-1 min-w-0 px-2 py-1 bg-background border border-border rounded text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            {searchQuery.trim() && searchTotal > 0 && (
              <span className="text-xs text-muted-foreground whitespace-nowrap px-1">
                {(searchMatchIndex ?? 0) + 1}/{searchTotal}
              </span>
            )}
            {searchQuery.trim() && searchTotal > 0 && (
              <>
                <button onClick={() => setSearchMatchIndex(((searchMatchIndex! - 1) + searchTotal) % searchTotal)} className="p-1 hover:bg-muted rounded transition-colors" title="Previous match">
                  <CaretLeft className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <button onClick={() => setSearchMatchIndex((searchMatchIndex! + 1) % searchTotal)} className="p-1 hover:bg-muted rounded transition-colors" title="Next match">
                  <CaretRight className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </>
            )}
            <button onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchMatchIndex(null); }} className="p-1 hover:bg-muted rounded transition-colors">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <button onClick={() => { setShowSearch(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }} className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground" title="Search in book">
            <MagnifyingGlass className="w-4 h-4" />
          </button>
        )}

        <div className="flex-1" />

        {alignProgress && (
          <span className="text-xs text-muted-foreground max-w-[40%] truncate" title={alignProgress}>
            {aligning && <CircleNotch className="w-3 h-3 animate-spin inline mr-1" />}
            {alignProgress}
          </span>
        )}

        {useWordSync && (
          <span className="text-xs text-green-600 whitespace-nowrap">
            Word sync
          </span>
        )}

        {!useWordSync && syncState.status === "building" && (
          <span className="text-xs text-blue-600 flex items-center gap-1">
            <CircleNotch className="w-3 h-3 animate-spin" />
            Syncing…
          </span>
        )}

        <button
          onClick={runAlignment}
          disabled={aligning || effectiveTranscriptSegments.length === 0}
          className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground disabled:opacity-40"
          title="Sync text and audio (word-level alignment)"
        >
          <ArrowsClockwise className={`w-4 h-4 ${aligning ? "animate-spin" : ""}`} />
        </button>

        <button
          onClick={() => setSyncJumpSignal((s) => s + 1)}
          disabled={!useWordSync && syncState.status !== "ready"}
          className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          title="Jump to audio position"
        >
          <Crosshair className="w-4 h-4" />
        </button>
      </div>

      {isLoading || !epubFileData ? (
        <div className="flex items-center justify-center flex-1">
          <CircleNotch className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <EPUBViewer
            key={epubKey}
            fileData={epubFileData}
            fileName={epubDoc.title}
            documentId={epubDoc.id}
            onLoad={handleEpubLoad}
            onAllSpeechSectionsChange={handleSpeechSections}
            syncSegments={useWordSync ? undefined : syncSegments}
            syncCurrentTime={useWordSync ? undefined : audioCurrentTime}
            onSyncStateChange={setSyncState}
            syncJumpSignal={syncJumpSignal}
            syncActiveWord={syncActiveWord}
            onSyncWordClick={handleSyncWordClick}
            searchQuery={searchQuery || undefined}
            searchMatchIndex={searchMatchIndex}
            onSearchResultsChange={({ total, activeIndex }) => {
              setSearchTotal(total);
              setSearchMatchIndex(activeIndex);
            }}
          />
        </div>
      )}
    </div>
  );

  return (
    <div ref={containerRef} className="h-full w-full bg-background">
      <ResizableSplit left={audioPanel} right={epubPanel} defaultLeftWidth={40} />
    </div>
  );
}
