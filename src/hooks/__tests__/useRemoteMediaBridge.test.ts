/**
 * Player media-command integration tests (task 11.3).
 *
 * Verifies the single authoritative command path end-to-end at the adapter
 * layer: the web adapter routes browser MediaSession actions into
 * `dispatchRemoteMediaCommand`, the legacy direct handlers in AudiobookViewer
 * are gone (structurally asserted), Normal vs Study routing flows through the
 * dispatcher, and the RemoteMediaContext exposes everything the dispatcher
 * needs (documentId/editionId/sessionId/audioElement/time/anchors).
 *
 * The full AudiobookViewer is too heavy to mount in jsdom (3.5k lines, native
 * bridges, audio graphs); the bridge hook + dispatcher cover the command path
 * the spec cares about, using the setup.ts mediaSession/MediaMetadata mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { normalizePendingMediaCommands, useRemoteMediaBridge } from "../useRemoteMediaBridge";
import {
  dispatchRemoteMediaCommand,
  resetDispatcherState,
  type RemoteMediaContext,
} from "../../utils/remoteMediaDispatcher";
import { useSettingsStore, DEFAULT_HANDS_FREE_STUDY_SETTINGS } from "../../stores/settingsStore";
import { executeStudyAction } from "../../utils/remoteMediaDispatcher";
import { addListeningSessionItem } from "../../api/listeningSessions";

vi.mock("../../api/listeningSessions", () => ({
  addListeningSessionItem: vi.fn(async (item: any) => ({ ...item, id: "item-bridge-1" })),
  createListeningSession: vi.fn(async (s: any) => ({ id: "sess-created-1", startedAt: Date.now(), endedAt: null, durationSeconds: 0, extractCount: 0, isReviewed: false, ...s, items: [] })),
  getActiveListeningSession: vi.fn(async () => null),
  endListeningSession: vi.fn(async () => undefined),
}));
vi.mock("../../api/extracts", () => ({
  createExtract: vi.fn(async (p: any) => ({ id: "ext-bridge-1", ...p })),
  updateExtract: vi.fn(async (p: any) => ({ ...p })),
}));
vi.mock("../../lib/tauri", () => ({
  isTauri: () => false,
  isNativeMobile: () => false,
  invokeCommand: vi.fn(async () => null),
  listen: vi.fn(async () => () => {}),
}));

function makeContext(): RemoteMediaContext {
  return {
    documentId: "doc-bridge",
    documentTitle: "Bridge Test",
    editionId: "ed-bridge",
    sessionId: "sess-bridge",
    audioElement: { volume: 1, paused: false } as unknown as HTMLAudioElement,
    currentTimestampSec: 12,
    anchors: [
      {
        id: "anc-b1",
        sectionId: "sec-b",
        audioStartSec: 0,
        audioEndSec: 30,
        sourceStartAnchor: "0",
        sourceEndAnchor: "99",
        textContent: "The passage currently being heard.",
      },
    ],
    captureConfidence: "high",
    onPlayPause: vi.fn(),
    onSeekRelative: vi.fn(),
  };
}

describe("useRemoteMediaBridge (web adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDispatcherState();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        handsFreeStudy: { ...DEFAULT_HANDS_FREE_STUDY_SETTINGS, enabled: false },
      },
    });
  });

  afterEach(() => {
    // Unmount everything so global navigator state stays clean between tests.
    document.body.innerHTML = "";
  });

  it("registers browser media-session handlers and routes actions through the dispatcher", () => {
    const ctx = makeContext();
    const { unmount } = renderHook(() =>
      useRemoteMediaBridge({
        getContext: () => ctx,
        title: "Bridge Title",
        isPlaying: true,
        duration: 100,
        currentTime: 12,
      })
    );

    const handlers = (navigator as any).mediaSession.__handlers as Map<string, (d?: unknown) => void>;
    expect(handlers.has("play")).toBe(true);
    expect(handlers.has("nexttrack")).toBe(true);
    expect(handlers.has("seekforward")).toBe(true);

    // A browser media action reaches the transport through the dispatcher
    // (Normal Mode: Next → next chapter/section).
    const onNextChapter = vi.fn();
    ctx.onNextChapter = onNextChapter;
    act(() => {
      handlers.get("nexttrack")!();
    });
    expect(onNextChapter).toHaveBeenCalledTimes(1);

    // Metadata was published to the browser media session.
    expect((navigator.mediaSession as any).metadata?.title).toBe("Bridge Title");
    expect(navigator.mediaSession.playbackState).toBe("playing");

    unmount();
  });

  it("cleans up handlers on unmount", () => {
    const ctx = makeContext();
    const { unmount } = renderHook(() =>
      useRemoteMediaBridge({ getContext: () => ctx, title: "T", isPlaying: false })
    );
    unmount();

    const handlers = (navigator as any).mediaSession.__handlers as Map<string, (d?: unknown) => void>;
    expect(handlers.has("play")).toBe(false);
    expect(handlers.has("nexttrack")).toBe(false);
  });

  it("normalizes both current and legacy native queue responses", () => {
    const command = { command: "Play", eventId: "queued-1", source: "android" as const };
    expect(normalizePendingMediaCommands({ commands: [command] })).toEqual([command]);
    expect(normalizePendingMediaCommands([command])).toEqual([command]);
    expect(normalizePendingMediaCommands(null)).toEqual([]);
    expect(normalizePendingMediaCommands({ commands: "invalid" })).toEqual([]);
  });

  it("Study Mode routes a Next press into Save Recent Extract with full context", async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        handsFreeStudy: {
          ...DEFAULT_HANDS_FREE_STUDY_SETTINGS,
          enabled: true,
          mappings: { ...DEFAULT_HANDS_FREE_STUDY_SETTINGS.mappings, next: "save_recent_extract" },
        },
      },
    });

    const ctx = makeContext();
    const { result } = renderHook(() =>
      useRemoteMediaBridge({ getContext: () => ctx, title: "T", isPlaying: true })
    );
    expect(result.current).toBeUndefined(); // hook is side-effect only

    const handlers = (navigator as any).mediaSession.__handlers as Map<string, (d?: unknown) => void>;
    act(() => {
      handlers.get("nexttrack")!();
    });

    const { createExtract } = await import("../../api/extracts");
    await vi.waitFor(() => expect(createExtract).toHaveBeenCalled());
    const payload = (createExtract as any).mock.calls[0][0];
    // Real source text with durable provenance — never placeholder content.
    expect(payload.content).toContain("passage currently being heard");
    expect(payload.selection_context).toMatchObject({
      kind: "audio_capture",
      documentId: "doc-bridge",
      editionId: "ed-bridge",
      sessionId: "sess-bridge",
      confidence: "high",
    });
    expect(addListeningSessionItem).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-bridge", markerType: "extract" })
    );
  });
});

describe("single authoritative path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDispatcherState();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        handsFreeStudy: { ...DEFAULT_HANDS_FREE_STUDY_SETTINGS, enabled: false },
      },
    });
  });

  it("AudiobookViewer contains no legacy direct navigator.mediaSession action handlers", async () => {
    // Structural regression guard (task 9.1): the viewer must route all
    // commands through the dispatcher. The legacy pattern registered direct
    // handlers via `setActionHandler("play", ...)` with inline audio element
    // calls; any re-introduction fails here.
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../components/viewer/AudiobookViewer.tsx"),
      "utf-8"
    );
    expect(source).not.toMatch(/navigator\.mediaSession\.setActionHandler/);
    // The bridge hook must be mounted instead.
    expect(source).toMatch(/useRemoteMediaBridge\(\{/);
  });

  it("dispatcher-level dedupe keeps one physical press to one action without suppressing rapid seeks", () => {
    const ctx = makeContext();
    const onNextChapter = vi.fn();
    ctx.onNextChapter = onNextChapter;

    // A replayed native queue entry with the SAME eventId fires once.
    const envelope = { command: "Next" as const, eventId: "press-1", source: "android" as const, occurredAt: Date.now() };
    dispatchRemoteMediaCommand(envelope, ctx);
    dispatchRemoteMediaCommand(envelope, ctx);
    expect(onNextChapter).toHaveBeenCalledTimes(1);

    // Two distinct physical presses remain distinct even within the old
    // source+command time window.
    dispatchRemoteMediaCommand(
      { command: "Next", eventId: "press-2", source: "android", occurredAt: Date.now() },
      ctx
    );
    expect(onNextChapter).toHaveBeenCalledTimes(2);
  });
});

describe("session lifecycle via listening session service", () => {
  it("captures append to the session created by the tracker service", async () => {
    const { ensureListeningSession, closeListeningSession } = await import(
      "../../utils/listeningSessionService"
    );
    const { createListeningSession, getActiveListeningSession } = await import(
      "../../api/listeningSessions"
    );

    const session = await ensureListeningSession("ed-lifecycle");
    expect(session).not.toBeNull();
    expect(createListeningSession).toHaveBeenCalledWith({ editionId: "ed-lifecycle" });

    // A capture lands on the ensured session.
    await executeStudyAction("bookmark", {
      ...makeContext(),
      editionId: "ed-lifecycle",
      sessionId: session!.id,
    });
    expect(addListeningSessionItem).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session!.id, markerType: "bookmark" })
    );

    await closeListeningSession("ed-lifecycle");
    expect((await import("../../api/listeningSessions")).endListeningSession).toHaveBeenCalled();
    expect(getActiveListeningSession).toHaveBeenCalled();
  });
});
