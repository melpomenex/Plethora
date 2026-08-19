/**
 * Remote Media Command Dispatcher — the SINGLE authoritative media-command
 * path (design Decisions 6, 7, 9, 11, 12).
 *
 * Every adapter (Android Media3 bridge, desktop Rust bridge, web
 * MediaSession) normalizes into a `RemoteMediaCommandEnvelope` and routes
 * here. Normal Mode keeps ordinary transport behavior; Study Mode maps each
 * remappable OS command (`Next`/`Previous`/`SeekForward`/`SeekBackward`) to a
 * configurable `StudyAction`. Play/Pause are never remapped. Duplicate
 * delivery is suppressed within a short window. Dispatch never throws.
 */

import type {
  AudioEditionAnchor,
  AudioCaptureProvenance,
  CaptureConfidence,
  CaptureWindow,
  RemoteMediaCommand,
  RemoteMediaCommandEnvelope,
  StudyAction,
} from "../types/audioEdition";
import { useSettingsStore, coerceStudyAction } from "../stores/settingsStore";
import { playChime, duckAudio } from "./audioFeedback";
import {
  resolveRecentPassage,
  findAnchorIndexAtTimestamp,
  extendStartBySemanticUnit,
  MAX_CAPTURE_EXTENSIONS,
  type CaptureResolution,
} from "./audioEditionAnchors";
import { addListeningSessionItem, updateListeningSessionItem } from "../api/listeningSessions";
import { createExtract, updateExtract } from "../api/extracts";
import { ensureListeningSession } from "./listeningSessionService";

/** Note prefixes that give untyped session items a triage status ( Inbox parses these). */
export const SESSION_ITEM_NOTE_PREFIXES = {
  needsConfirmation: "[needs_confirmation]",
  pendingAudioBookmark: "[pending_audio_bookmark]",
  askPlethora: "[ask_plethora]",
  persistenceError: "[persistence_error]",
} as const;

export interface RemoteMediaContext {
  documentId: string;
  documentTitle: string;
  editionId?: string;
  sessionId?: string;
  audioElement: HTMLAudioElement | null;
  currentTimestampSec: number;
  /** Section-local anchors for the currently playing section (Decision 13). */
  anchors: AudioEditionAnchor[];
  sectionId?: string;
  /**
   * Alignment confidence for captures: "high" for generated editions,
   * "medium"/"low" for paired external audiobooks and transcript-anchored
   * audio (drives the typed capture outcome tiers).
   */
  captureConfidence?: CaptureConfidence;
  provider?: string;
  onPlayPause?: () => void;
  onNextChapter?: () => void;
  onPrevChapter?: () => void;
  onSeekRelative?: (deltaSec: number) => void;
  /** Optional immediate Q&A hand-off; the durable inbox marker is always persisted too. */
  onAskPlethora?: (passage: string) => void;
}

/** Normal Mode seek amounts (platform convention: +30 s / −15 s). */
export const NORMAL_SEEK_FORWARD_SEC = 30;
export const NORMAL_SEEK_BACKWARD_SEC = 15;

/** Duplicate suppression window (design Decision 12). */
export const DEDUPE_WINDOW_MS = 1500;

// ---------------------------------------------------------------------------
// Envelope construction & dedupe
// ---------------------------------------------------------------------------

function newEventId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeCommand(value: unknown): RemoteMediaCommand | null {
  const canonical: Record<string, RemoteMediaCommand> = {
    play: "Play",
    pause: "Pause",
    toggleplaypause: "TogglePlayPause",
    toggle: "TogglePlayPause",
    next: "Next",
    nexttrack: "Next",
    previous: "Previous",
    previoustrack: "Previous",
    seekforward: "SeekForward",
    seekbackward: "SeekBackward",
  };
  if (typeof value !== "string") return null;
  const direct = value as RemoteMediaCommand;
  if (["Play", "Pause", "TogglePlayPause", "Next", "Previous", "SeekForward", "SeekBackward"].includes(value)) {
    return direct;
  }
  return canonical[value.toLowerCase()] ?? null;
}

/** Wrap a bare command into a fresh web-sourced envelope (adapter convenience). */
export function envelopeForCommand(
  command: RemoteMediaCommand,
  source: RemoteMediaCommandEnvelope["source"] = "web",
  positionHintSec?: number
): RemoteMediaCommandEnvelope {
  return {
    command,
    eventId: newEventId(),
    source,
    occurredAt: Date.now(),
    positionHintSec,
  };
}

const seenEventIds = new Map<string, number>();
const seenCommandPairs = new Map<string, number>();

/** True when this envelope was already accepted within the dedupe window. */
function isDuplicateEnvelope(envelope: RemoteMediaCommandEnvelope): boolean {
  const now = Date.now();

  for (const map of [seenEventIds, seenCommandPairs]) {
    for (const [key, ts] of map) {
      if (now - ts > DEDUPE_WINDOW_MS) map.delete(key);
    }
  }

  const pairKey = `${envelope.source}:${envelope.command}`;
  if (
    seenEventIds.has(envelope.eventId) ||
    (seenCommandPairs.get(pairKey) ?? 0) > now - DEDUPE_WINDOW_MS
  ) {
    return true;
  }

  seenEventIds.set(envelope.eventId, now);
  seenCommandPairs.set(pairKey, now);
  return false;
}

/** Test seam: clear dedupe state. */
export function resetDispatcherState(): void {
  seenEventIds.clear();
  seenCommandPairs.clear();
  lastCaptureBySession.clear();
}

// ---------------------------------------------------------------------------
// Android durable-queue acknowledgement hook (design Decision 8)
// ---------------------------------------------------------------------------

let mediaCommandAckHandler: ((eventIds: string[]) => void) | null = null;

/**
 * Register the native-bridge ack callback. The Android adapter sets this so
 * accepted envelopes are acknowledged to the plugin's durable pending-command
 * queue; other platforms pass null.
 */
export function setMediaCommandAckHandler(
  handler: ((eventIds: string[]) => void) | null
): void {
  mediaCommandAckHandler = handler;
}

// ---------------------------------------------------------------------------
// Repeat-extension state (design Decision 7: OS command is authoritative)
// ---------------------------------------------------------------------------

interface LastCapture {
  sessionId: string;
  extractId: string;
  itemId: string;
  anchors: AudioEditionAnchor[];
  startIdx: number;
  endIdx: number;
  extensionCount: number;
  savedAt: number;
}

const lastCaptureBySession = new Map<string, LastCapture>();

// ---------------------------------------------------------------------------
// Capture persistence
// ---------------------------------------------------------------------------

function provenanceFor(
  ctx: RemoteMediaContext,
  resolution: CaptureResolution,
  sessionId: string | undefined,
  window: CaptureWindow
): AudioCaptureProvenance {
  return {
    kind: "audio_capture",
    documentId: ctx.documentId,
    editionId: ctx.editionId,
    sectionId: ctx.sectionId,
    sourceStartAnchor: resolution.startAnchor,
    sourceEndAnchor: resolution.endAnchor,
    audioTimestampSec: ctx.currentTimestampSec,
    captureWindowSec: window,
    sessionId,
    confidence: resolution.confidence,
    provider: ctx.provider,
  };
}

async function withRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (firstErr) {
    try {
      return await op();
    } catch {
      throw firstErr;
    }
  }
}

/** Ensure a listening session exists for the context's edition (Decision 10). */
async function ensureSession(ctx: RemoteMediaContext): Promise<string | null> {
  if (ctx.sessionId) return ctx.sessionId;
  if (!ctx.editionId) return null;
  const session = await ensureListeningSession(ctx.editionId);
  return session?.id ?? null;
}

/**
 * Persist a resolved capture: permanent extract (with durable provenance on
 * `selection_context`) plus a linked session item.
 */
async function persistResolvedCapture(
  ctx: RemoteMediaContext,
  resolution: CaptureResolution,
  window: CaptureWindow,
  sessionId: string
): Promise<{ extractId: string; itemId: string; startIdx: number; endIdx: number } | null> {
  const provenance = provenanceFor(ctx, resolution, sessionId, window);

  const extract = await withRetry(() =>
    createExtract({
      document_id: ctx.documentId,
      content: resolution.text,
      tags: ["audio-extract", "hands-free"],
      note: `Captured via Hands-Free Study Mode at ${Math.round(ctx.currentTimestampSec)}s`,
      selection_context: provenance as unknown as Record<string, unknown>,
    })
  );

  const item = await withRetry(() =>
    addListeningSessionItem({
      sessionId,
      extractId: extract.id,
      audioTimestamp: ctx.currentTimestampSec,
      sourceAnchor: resolution.startAnchor,
      snippetText: resolution.text,
      markerType: "extract",
      note: null,
    })
  );

  const startIdx = ctx.anchors.findIndex((a) => a.sourceStartAnchor === resolution.startAnchor);
  const endIdx = startIdx >= 0
    ? ctx.anchors.findIndex((a) => a.sourceEndAnchor === resolution.endAnchor)
    : -1;

  return { extractId: extract.id, itemId: item.id, startIdx, endIdx };
}

/**
 * Persist a non-resolved capture (needs_confirmation / pending_audio_bookmark)
 * as a session item only — never a permanent extract, never placeholder text.
 */
async function persistUnresolvedCapture(
  ctx: RemoteMediaContext,
  resolution: CaptureResolution,
  sessionId: string,
  notePrefix: string
): Promise<void> {
  await withRetry(() =>
    addListeningSessionItem({
      sessionId,
      extractId: null,
      audioTimestamp: ctx.currentTimestampSec,
      sourceAnchor: resolution.startAnchor,
      // Pending audio bookmarks carry NO text; the Inbox renders the state.
      snippetText: resolution.kind === "needs_confirmation" ? resolution.text : "",
      markerType: resolution.kind === "needs_confirmation" ? "extract" : "bookmark",
      note: `${notePrefix} ${
        resolution.kind === "needs_confirmation"
          ? "Candidate text from medium-confidence alignment — confirm before keeping."
          : "Position bookmarked; source text could not be recovered automatically."
      }`,
    })
  );
}

/**
 * Save Recent Extract with typed outcomes and repeat-extension.
 */
async function saveRecentExtract(ctx: RemoteMediaContext): Promise<void> {
  const settings = useSettingsStore.getState().settings.handsFreeStudy;
  const window: CaptureWindow = settings?.captureWindow ?? 30;
  const confidence: CaptureConfidence = ctx.captureConfidence ?? "high";

  const resolution = resolveRecentPassage(
    ctx.anchors,
    ctx.currentTimestampSec,
    window,
    confidence
  );

  const sessionId = await ensureSession(ctx);

  if (resolution.kind === "resolved") {
    if (!sessionId) {
      playChime("action_failed");
      return;
    }

    // Repeat-extension: a repeat within extensionWindowMs extends the SAME
    // capture backward by one semantic unit (update-in-place, ≤ 3 extensions).
    const last = sessionId ? lastCaptureBySession.get(sessionId) : undefined;
    const extensionWindowMs = settings?.extensionWindowMs ?? 2500;
    if (
      last &&
      last.anchors === ctx.anchors &&
      Date.now() - last.savedAt <= extensionWindowMs &&
      last.endIdx >= 0
    ) {
      if (last.extensionCount < MAX_CAPTURE_EXTENSIONS) {
        const newStartIdx = extendStartBySemanticUnit(ctx.anchors, last.startIdx);
        if (newStartIdx < last.startIdx) {
          const matched = ctx.anchors.slice(newStartIdx, last.endIdx + 1);
          const extendedText = matched.map((a) => a.textContent).join(" ");
          try {
            await withRetry(() => updateExtract({ id: last.extractId, content: extendedText }));
            await withRetry(() =>
              updateListeningSessionItem(last.itemId, {
                snippetText: extendedText,
                sourceAnchor: ctx.anchors[newStartIdx].sourceStartAnchor,
              })
            );
            lastCaptureBySession.set(sessionId, {
              ...last,
              startIdx: newStartIdx,
              extensionCount: last.extensionCount + 1,
              savedAt: Date.now(),
            });
            playChime("extract_extended");
            return;
          } catch {
            playChime("action_failed");
            return;
          }
        }
      }
      // Cap reached or nothing left to extend: fall through to a fresh capture.
    }

    try {
      const saved = await persistResolvedCapture(ctx, resolution, window, sessionId);
      if (saved && saved.startIdx >= 0 && saved.endIdx >= saved.startIdx) {
        lastCaptureBySession.set(sessionId, {
          sessionId,
          extractId: saved.extractId,
          itemId: saved.itemId,
          anchors: ctx.anchors,
          startIdx: saved.startIdx,
          endIdx: saved.endIdx,
          extensionCount: 0,
          savedAt: Date.now(),
        });
      }
      playChime("extract_captured");
    } catch {
      await recordPersistenceError(ctx, sessionId, resolution);
    }
    return;
  }

  if (resolution.kind === "needs_confirmation") {
    if (!sessionId) {
      playChime("action_failed");
      return;
    }
    try {
      await persistUnresolvedCapture(
        ctx,
        resolution,
        sessionId,
        SESSION_ITEM_NOTE_PREFIXES.needsConfirmation
      );
      // Confirmation variant: distinct soft double-tone.
      playChime("bookmark_added");
    } catch {
      await recordPersistenceError(ctx, sessionId, resolution);
    }
    return;
  }

  // pending_audio_bookmark — never fabricate text.
  if (!sessionId) {
    playChime("action_failed");
    return;
  }
  try {
    await persistUnresolvedCapture(
      ctx,
      resolution,
      sessionId,
      SESSION_ITEM_NOTE_PREFIXES.pendingAudioBookmark
    );
    playChime("confusing_flagged");
  } catch {
    await recordPersistenceError(ctx, sessionId, resolution);
  }
}

/** DB write failed twice: best-effort session item marked for later retry. */
async function recordPersistenceError(
  ctx: RemoteMediaContext,
  sessionId: string | null,
  resolution: CaptureResolution
): Promise<void> {
  playChime("action_failed");
  if (!sessionId) return;
  try {
    await addListeningSessionItem({
      sessionId,
      extractId: null,
      audioTimestamp: ctx.currentTimestampSec,
      sourceAnchor: resolution.startAnchor || "0",
      snippetText: resolution.text || "",
      markerType: "bookmark",
      note: `${SESSION_ITEM_NOTE_PREFIXES.persistenceError} Capture could not be saved; retry from the Inbox.`,
    });
  } catch {
    // Fully offline failure — the failure earcon already played.
  }
}

/** Persist a simple marker session item (bookmark / interesting / confusing / ask). */
async function persistMarkerItem(
  ctx: RemoteMediaContext,
  markerType: "bookmark" | "interesting" | "confusing",
  note: string | null,
  snippetSource: "anchor" | "window"
): Promise<void> {
  const sessionId = await ensureSession(ctx);
  if (!sessionId) {
    playChime("action_failed");
    return;
  }

  let snippetText = "";
  if (snippetSource === "anchor") {
    const idx = findAnchorIndexAtTimestamp(ctx.anchors, ctx.currentTimestampSec);
    snippetText = idx >= 0 ? ctx.anchors[idx].textContent : "";
  } else {
    snippetText = resolveRecentPassage(ctx.anchors, ctx.currentTimestampSec, 30, ctx.captureConfidence ?? "high").text;
  }

  try {
    await withRetry(() =>
      addListeningSessionItem({
        sessionId,
        extractId: null,
        audioTimestamp: ctx.currentTimestampSec,
        sourceAnchor:
          snippetSource === "anchor"
            ? ctx.anchors[findAnchorIndexAtTimestamp(ctx.anchors, ctx.currentTimestampSec)]
                ?.sourceStartAnchor ?? "0"
            : "0",
        snippetText,
        markerType,
        note,
      })
    );
  } catch {
    playChime("action_failed");
    return;
  }
}

// ---------------------------------------------------------------------------
// Study action execution (every StudyAction value has an implementation)
// ---------------------------------------------------------------------------

/**
 * Execute a resolved hands-free study action. Never throws.
 */
export async function executeStudyAction(
  action: StudyAction,
  ctx: RemoteMediaContext
): Promise<void> {
  try {
    const settings = useSettingsStore.getState().settings.handsFreeStudy;
    const duckRatio = settings?.duckingRatio ?? 0.25;

    // Capture-type actions duck narration while their earcon plays; pure
    // navigation actions (skip/chapter/replay) must not interrupt playback.
    const isCapture =
      action === "save_recent_extract" ||
      action === "bookmark" ||
      action === "mark_interesting" ||
      action === "mark_confusing" ||
      action === "ask_plethora";
    if (isCapture) {
      duckAudio(ctx.audioElement, duckRatio, 700);
    }

    switch (action) {
      case "save_recent_extract":
        await saveRecentExtract(ctx);
        return;

      case "bookmark":
        await persistMarkerItem(ctx, "bookmark", null, "anchor");
        playChime("bookmark_added");
        return;

      case "replay_recent_passage": {
        const window = settings?.captureWindow ?? 30;
        const rewindSec = window === "smart" ? 30 : window;
        ctx.onSeekRelative?.(-rewindSec);
        return;
      }

      case "mark_interesting":
        await persistMarkerItem(
          ctx,
          "interesting",
          "#interesting — flagged for prioritized spaced review",
          "window"
        );
        playChime("interesting_marked");
        return;

      case "mark_confusing":
        await persistMarkerItem(
          ctx,
          "confusing",
          "#needs-explanation — flagged for review",
          "window"
        );
        playChime("confusing_flagged");
        return;

      case "ask_plethora": {
        // Deferred Ask Plethora (design Decision 9): persist a scoped marker
        // that later opens Document Q&A on the passage. No UI required at
        // capture time; an optional callback gets first crack when present.
        const passage = resolveRecentPassage(
          ctx.anchors,
          ctx.currentTimestampSec,
          settings?.captureWindow ?? 30,
          ctx.captureConfidence ?? "high"
        ).text;
        const sessionId = await ensureSession(ctx);
        if (sessionId) {
          await persistMarkerItem(
            ctx,
            "bookmark",
            `${SESSION_ITEM_NOTE_PREFIXES.askPlethora} Ask Plethora about this passage`,
            "window"
          );
        } else {
          playChime("action_failed");
          return;
        }
        playChime("ask_enqueued");
        ctx.onAskPlethora?.(passage);
        return;
      }

      case "skip_forward":
        ctx.onSeekRelative?.(NORMAL_SEEK_FORWARD_SEC);
        return;

      case "skip_backward":
        ctx.onSeekRelative?.(-NORMAL_SEEK_BACKWARD_SEC);
        return;

      case "next_chapter":
        ctx.onNextChapter?.();
        return;

      case "previous_chapter":
        ctx.onPrevChapter?.();
        return;

      case "none":
      default:
        return;
    }
  } catch {
    playChime("action_failed");
  }
}

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

function studyActionForCommand(
  command: RemoteMediaCommand,
  mappings: { next: StudyAction; previous: StudyAction; seekForward: StudyAction; seekBackward: StudyAction }
): StudyAction | null {
  switch (command) {
    case "Next":
      return coerceStudyAction(mappings?.next, "save_recent_extract");
    case "Previous":
      return coerceStudyAction(mappings?.previous, "replay_recent_passage");
    case "SeekForward":
      return coerceStudyAction(mappings?.seekForward, "skip_forward");
    case "SeekBackward":
      return coerceStudyAction(mappings?.seekBackward, "skip_backward");
    default:
      return null;
  }
}

function runTransport(command: RemoteMediaCommand, ctx: RemoteMediaContext): void {
  switch (command) {
    case "Play":
    case "Pause":
    case "TogglePlayPause":
      ctx.onPlayPause?.();
      break;
    case "Next":
      ctx.onNextChapter?.();
      break;
    case "Previous":
      ctx.onPrevChapter?.();
      break;
    case "SeekForward":
      ctx.onSeekRelative?.(NORMAL_SEEK_FORWARD_SEC);
      break;
    case "SeekBackward":
      ctx.onSeekRelative?.(-NORMAL_SEEK_BACKWARD_SEC);
      break;
  }
}

/**
 * Dispatch an incoming normalized remote media command. Accepts either a
 * canonical command (wrapped into a fresh web envelope) or a full envelope
 * from a native/desktop adapter. Duplicate envelopes within
 * `DEDUPE_WINDOW_MS` are dropped. Never throws.
 */
export function dispatchRemoteMediaCommand(
  commandOrEnvelope: RemoteMediaCommand | RemoteMediaCommandEnvelope,
  ctx: RemoteMediaContext
): void {
  try {
    const envelope: RemoteMediaCommandEnvelope =
      typeof commandOrEnvelope === "string"
        ? envelopeForCommand(commandOrEnvelope)
        : commandOrEnvelope;

    const command = normalizeCommand(envelope.command);
    if (!command) return; // unknown command — ignore gracefully

    if (isDuplicateEnvelope(envelope)) {
      return; // one physical press, one action
    }

    // Acknowledge native durable-queue entries once accepted.
    if (envelope.source !== "web" && mediaCommandAckHandler) {
      try {
        mediaCommandAckHandler([envelope.eventId]);
      } catch {
        // ack is best-effort; reconcile will re-drain
      }
    }

    const settings = useSettingsStore.getState().settings;
    const handsFree = settings.handsFreeStudy;
    const isStudyMode = handsFree?.enabled === true;

    // A replayed envelope carries the position at press time.
    const dispatchCtx: RemoteMediaContext =
      typeof envelope.positionHintSec === "number" &&
      Number.isFinite(envelope.positionHintSec)
        ? { ...ctx, currentTimestampSec: envelope.positionHintSec }
        : ctx;

    if (!isStudyMode) {
      runTransport(command, dispatchCtx);
      return;
    }

    // Play/Pause are never remapped, in either mode.
    if (command === "Play" || command === "Pause" || command === "TogglePlayPause") {
      dispatchCtx.onPlayPause?.();
      return;
    }

    const action = studyActionForCommand(command, handsFree?.mappings);
    if (!action) {
      runTransport(command, dispatchCtx);
      return;
    }
    void executeStudyAction(action, dispatchCtx);
  } catch {
    playChime("action_failed");
  }
}
