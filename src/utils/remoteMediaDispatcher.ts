/**
 * Remote Media Command Dispatcher & Multi-Press Gesture Controller
 * 
 * Intercepts headphone/remote media key commands (Bluetooth, OS MediaKeys, MediaSession),
 * resolves multi-press gestures with a debounce window, and captures extracts,
 * bookmarks, and confusion markers linked to the current document and listening session.
 */

import type { RemoteMediaCommand, AudioEditionAnchor } from "../types/audioEdition";
import { useSettingsStore } from "../stores/settingsStore";
import { playChime, duckAudio } from "./audioFeedback";
import { expandSmartExtractBoundaries, resolveAnchorAtTimestamp } from "./audioEditionAnchors";
import { addListeningSessionItem } from "../api/listeningSessions";
import { createExtract } from "../api/extracts";

export type StudyActionType = "smart_extract" | "bookmark" | "mark_confusing" | "ask_plethora";

export interface RemoteMediaContext {
  documentId: string;
  documentTitle: string;
  editionId?: string;
  sessionId?: string;
  audioElement: HTMLAudioElement | null;
  currentTimestampSec: number;
  anchors: AudioEditionAnchor[];
  onPlayPause?: () => void;
  onNextChapter?: () => void;
  onPrevChapter?: () => void;
  onSeekRelative?: (deltaSec: number) => void;
  onAskPlethora?: (passage: string) => void;
}

// Multi-press gesture tracking state
let pressCount = 0;
let pressTimer: ReturnType<typeof setTimeout> | null = null;
const GESTURE_DEBOUNCE_MS = 450;

/**
 * Executes a resolved hands-free study action
 */
export async function executeStudyAction(
  action: StudyActionType,
  ctx: RemoteMediaContext
): Promise<void> {
  const settings = useSettingsStore.getState().settings;
  const duckRatio = settings.handsFreeStudy?.duckingRatio ?? 0.25;
  const lookbackSec = settings.handsFreeStudy?.captureLookbackSec ?? 30;

  duckAudio(ctx.audioElement, duckRatio, 700);

  if (action === "smart_extract") {
    const extractInfo = expandSmartExtractBoundaries(
      ctx.anchors,
      ctx.currentTimestampSec,
      lookbackSec
    );

    const textToSave = extractInfo.text || `Audio extract at ${Math.round(ctx.currentTimestampSec)}s`;

    try {
      // 1. Create durable Plethora extract
      const extract = await createExtract({
        document_id: ctx.documentId,
        content: textToSave,
        tags: ["audio-extract", "hands-free"],
        note: `Captured via Hands-Free Study Mode (${Math.round(ctx.currentTimestampSec)}s)`,
      });

      // 2. Add to active listening session if present
      if (ctx.sessionId) {
        await addListeningSessionItem({
          id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}`,
          sessionId: ctx.sessionId,
          extractId: extract.id,
          audioTimestamp: ctx.currentTimestampSec,
          sourceAnchor: extractInfo.startAnchor,
          snippetText: textToSave,
          markerType: "extract",
          note: null,
          createdAt: Date.now(),
        });
      }

      playChime("extract_captured");
    } catch (err) {
      console.warn("Failed to save hands-free extract:", err);
    }
  } else if (action === "bookmark") {
    const currentAnchor = resolveAnchorAtTimestamp(ctx.anchors, ctx.currentTimestampSec);
    const snippetText = currentAnchor?.textContent || `Bookmark at ${Math.round(ctx.currentTimestampSec)}s`;

    if (ctx.sessionId) {
      try {
        await addListeningSessionItem({
          id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}`,
          sessionId: ctx.sessionId,
          extractId: null,
          audioTimestamp: ctx.currentTimestampSec,
          sourceAnchor: currentAnchor?.sourceStartAnchor || "0",
          snippetText,
          markerType: "bookmark",
          note: null,
          createdAt: Date.now(),
        });
      } catch (err) {
        console.warn("Failed to save bookmark:", err);
      }
    }

    playChime("bookmark_added");
  } else if (action === "mark_confusing") {
    const extractInfo = expandSmartExtractBoundaries(
      ctx.anchors,
      ctx.currentTimestampSec,
      Math.min(lookbackSec, 45)
    );
    const snippetText = extractInfo.text || `Confusing section at ${Math.round(ctx.currentTimestampSec)}s`;

    if (ctx.sessionId) {
      try {
        await addListeningSessionItem({
          id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}`,
          sessionId: ctx.sessionId,
          extractId: null,
          audioTimestamp: ctx.currentTimestampSec,
          sourceAnchor: extractInfo.startAnchor,
          snippetText,
          markerType: "confusing",
          note: "Marked as confusing / needs review",
          createdAt: Date.now(),
        });
      } catch (err) {
        console.warn("Failed to save confusing marker:", err);
      }
    }

    playChime("confusing_flagged");
  } else if (action === "ask_plethora") {
    const extractInfo = expandSmartExtractBoundaries(
      ctx.anchors,
      ctx.currentTimestampSec,
      lookbackSec
    );
    playChime("extract_captured");
    ctx.onAskPlethora?.(extractInfo.text);
  }
}

/**
 * Dispatch an incoming normalized remote media command
 */
export function dispatchRemoteMediaCommand(
  cmd: RemoteMediaCommand,
  ctx: RemoteMediaContext
): void {
  const settings = useSettingsStore.getState().settings;
  const isStudyMode = settings.handsFreeStudy?.enabled ?? false;

  if (!isStudyMode) {
    // Normal Mode command routing
    switch (cmd) {
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
        ctx.onSeekRelative?.(15);
        break;
      case "SeekBackward":
        ctx.onSeekRelative?.(-15);
        break;
    }
    return;
  }

  // Hands-Free Study Mode: intercept Next / Previous / Seek commands into multi-press triggers
  if (cmd === "TogglePlayPause" || cmd === "Play" || cmd === "Pause") {
    ctx.onPlayPause?.();
    return;
  }

  // Handle Multi-press triggers on Next / SeekForward
  if (cmd === "Next" || cmd === "SeekForward") {
    pressCount += 1;

    if (pressTimer) {
      clearTimeout(pressTimer);
    }

    pressTimer = setTimeout(() => {
      const currentPresses = pressCount;
      pressCount = 0;
      pressTimer = null;

      if (currentPresses === 1) {
        const action = settings.handsFreeStudy?.singlePressAction || "smart_extract";
        void executeStudyAction(action as StudyActionType, ctx);
      } else if (currentPresses === 2) {
        const action = settings.handsFreeStudy?.doublePressAction || "bookmark";
        void executeStudyAction(action as StudyActionType, ctx);
      } else {
        const action = settings.handsFreeStudy?.triplePressAction || "mark_confusing";
        void executeStudyAction(action as StudyActionType, ctx);
      }
    }, GESTURE_DEBOUNCE_MS);
    return;
  }

  if (cmd === "Previous" || cmd === "SeekBackward") {
    // Direct trigger for bookmark or rewind
    void executeStudyAction("bookmark", ctx);
  }
}
