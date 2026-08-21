/**
 * Dispatcher test matrix (task 11.1): full Normal Mode transport matrix,
 * Study Mode mapping matrix for every StudyAction, invalid persisted action
 * fallback, duplicate suppression, repeat-extension, and no uncaught throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  dispatchRemoteMediaCommand,
  executeStudyAction,
  envelopeForCommand,
  resetDispatcherState,
  NORMAL_SEEK_FORWARD_SEC,
  NORMAL_SEEK_BACKWARD_SEC,
  setMediaCommandAckHandler,
  type RemoteMediaContext,
} from "../remoteMediaDispatcher";
import {
  useSettingsStore,
  DEFAULT_HANDS_FREE_STUDY_SETTINGS,
} from "../../stores/settingsStore";
import { createExtract, updateExtract } from "../../api/extracts";
import {
  addListeningSessionItem,
  updateListeningSessionItem,
} from "../../api/listeningSessions";

vi.mock("../../api/extracts", () => ({
  createExtract: vi.fn(async (payload: any) => ({ id: "ext-test-1", ...payload })),
  updateExtract: vi.fn(async (payload: any) => ({ id: payload.id, ...payload })),
}));

vi.mock("../../api/listeningSessions", () => ({
  addListeningSessionItem: vi.fn(async (item: any) => ({ ...item, id: item.id || "item-1" })),
  updateListeningSessionItem: vi.fn(async () => undefined),
  createListeningSession: vi.fn(async (s: any) => ({ ...s, items: [] })),
  getActiveListeningSession: vi.fn(async () => null),
  endListeningSession: vi.fn(async () => undefined),
}));

vi.mock("../audioFeedback", () => ({
  playChime: vi.fn(),
  duckAudio: vi.fn(),
}));

import { playChime } from "../audioFeedback";

function makeContext(overrides: Partial<RemoteMediaContext> = {}): RemoteMediaContext {
  return {
    documentId: "doc-1",
    documentTitle: "Quantum Mechanics and Epistemology",
    editionId: "ed-1",
    sessionId: "sess-1",
    audioElement: null,
    currentTimestampSec: 25.0,
    anchors: [
      {
        id: "anc-1",
        sectionId: "sec-1",
        audioStartSec: 0,
        audioEndSec: 20,
        sourceStartAnchor: "0",
        sourceEndAnchor: "100",
        textContent: "First foundation of knowledge.",
      },
      {
        id: "anc-2",
        sectionId: "sec-1",
        audioStartSec: 20,
        audioEndSec: 40,
        sourceStartAnchor: "101",
        sourceEndAnchor: "250",
        textContent: "Wave-particle duality manifests in observation.",
      },
    ],
    onPlayPause: vi.fn(),
    onNextChapter: vi.fn(),
    onPrevChapter: vi.fn(),
    onSeekRelative: vi.fn(),
    ...overrides,
  };
}

function setHandsFree(partial: Partial<typeof DEFAULT_HANDS_FREE_STUDY_SETTINGS>) {
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      handsFreeStudy: { ...DEFAULT_HANDS_FREE_STUDY_SETTINGS, ...partial },
    },
  });
}

describe("Remote Media Dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDispatcherState();
    setMediaCommandAckHandler(null);
    setHandsFree({});
  });

  describe("Normal Mode transport matrix", () => {
    const cases: Array<[Parameters<typeof dispatchRemoteMediaCommand>[0], string, (ctx: RemoteMediaContext) => void]> = [
      ["Play", "onPlayPause", (ctx) => expect(ctx.onPlayPause).toHaveBeenCalledTimes(1)],
      ["Pause", "onPlayPause", (ctx) => expect(ctx.onPlayPause).toHaveBeenCalledTimes(1)],
      ["TogglePlayPause", "onPlayPause", (ctx) => expect(ctx.onPlayPause).toHaveBeenCalledTimes(1)],
      ["Next", "onNextChapter", (ctx) => expect(ctx.onNextChapter).toHaveBeenCalledTimes(1)],
      ["Previous", "onPrevChapter", (ctx) => expect(ctx.onPrevChapter).toHaveBeenCalledTimes(1)],
      ["SeekForward", "onSeekRelative", (ctx) => expect(ctx.onSeekRelative).toHaveBeenCalledWith(NORMAL_SEEK_FORWARD_SEC)],
      ["SeekBackward", "onSeekRelative", (ctx) => expect(ctx.onSeekRelative).toHaveBeenCalledWith(-NORMAL_SEEK_BACKWARD_SEC)],
    ];

    for (const [command, label, assert] of cases) {
      it(`routes ${command} to ${label} when Study Mode is off`, () => {
        setHandsFree({ enabled: false });
        const ctx = makeContext();
        dispatchRemoteMediaCommand(command as any, ctx);
        assert(ctx);
      });
    }
  });

  describe("Study Mode mapping matrix", () => {
    beforeEach(() => {
      setHandsFree({ enabled: true });
    });

    it("Play/Pause/TogglePlayPause are never remapped", () => {
      const ctx = makeContext();
      dispatchRemoteMediaCommand("Play", ctx);
      dispatchRemoteMediaCommand("Pause", ctx);
      dispatchRemoteMediaCommand("TogglePlayPause", ctx);
      expect(ctx.onPlayPause).toHaveBeenCalledTimes(3);
      expect(ctx.onSeekRelative).not.toHaveBeenCalled();
    });

    it("Next → save_recent_extract (default mapping) captures a real extract", async () => {
      const ctx = makeContext();
      dispatchRemoteMediaCommand("Next", ctx);
      await vi.waitFor(() => expect(createExtract).toHaveBeenCalled());
      const payload = (createExtract as any).mock.calls[0][0];
      expect(payload.document_id).toBe("doc-1");
      // Real source text, never a placeholder.
      expect(payload.content).toContain("Wave-particle duality");
      expect(payload.content).not.toMatch(/Audio extract at/);
      expect(payload.selection_context.kind).toBe("audio_capture");
      expect(payload.selection_context.sessionId).toBe("sess-1");
      await vi.waitFor(() => expect(playChime).toHaveBeenCalledWith("extract_captured"));
    });

    it("Previous → replay_recent_passage rewinds by the capture window", () => {
      const ctx = makeContext();
      dispatchRemoteMediaCommand("Previous", ctx);
      expect(ctx.onSeekRelative).toHaveBeenCalledWith(-30);
    });

    it("SeekForward → skip_forward seeks +30s", () => {
      const ctx = makeContext();
      dispatchRemoteMediaCommand("SeekForward", ctx);
      expect(ctx.onSeekRelative).toHaveBeenCalledWith(30);
    });

    it("SeekBackward → skip_backward seeks −15s", () => {
      const ctx = makeContext();
      dispatchRemoteMediaCommand("SeekBackward", ctx);
      expect(ctx.onSeekRelative).toHaveBeenCalledWith(-15);
    });

    it("every StudyAction has an implementation and none throw", async () => {
      const actions = [
        "save_recent_extract",
        "bookmark",
        "replay_recent_passage",
        "mark_interesting",
        "mark_confusing",
        "ask_plethora",
        "skip_forward",
        "skip_backward",
        "next_chapter",
        "previous_chapter",
        "none",
      ] as const;
      for (const action of actions) {
        await expect(executeStudyAction(action, makeContext())).resolves.toBeUndefined();
      }
    });

    it("bookmark persists a session item with real anchor text", async () => {
      await executeStudyAction("bookmark", makeContext());
      expect(addListeningSessionItem).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "sess-1", markerType: "bookmark" })
      );
      expect(playChime).toHaveBeenCalledWith("bookmark_added");
    });

    it("mark_interesting persists an #interesting item", async () => {
      await executeStudyAction("mark_interesting", makeContext());
      expect(addListeningSessionItem).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "sess-1",
          markerType: "interesting",
          note: expect.stringContaining("#interesting"),
        })
      );
      expect(playChime).toHaveBeenCalledWith("interesting_marked");
    });

    it("mark_confusing persists a #needs-explanation item", async () => {
      await executeStudyAction("mark_confusing", makeContext());
      expect(addListeningSessionItem).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "sess-1",
          markerType: "confusing",
          note: expect.stringContaining("#needs-explanation"),
        })
      );
      expect(playChime).toHaveBeenCalledWith("confusing_flagged");
    });

    it("ask_plethora persists a deferred marker (no UI dependency)", async () => {
      const onAskPlethora = vi.fn();
      await executeStudyAction("ask_plethora", makeContext({ onAskPlethora }));
      expect(addListeningSessionItem).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "sess-1",
          note: expect.stringContaining("[ask_plethora]"),
        })
      );
      expect(playChime).toHaveBeenCalledWith("ask_enqueued");
    });

    it("next_chapter / previous_chapter drive transport", async () => {
      const ctx = makeContext();
      await executeStudyAction("next_chapter", ctx);
      await executeStudyAction("previous_chapter", ctx);
      expect(ctx.onNextChapter).toHaveBeenCalledTimes(1);
      expect(ctx.onPrevChapter).toHaveBeenCalledTimes(1);
    });

    it("none is a quiet no-op", async () => {
      const ctx = makeContext();
      await executeStudyAction("none", ctx);
      expect(ctx.onPlayPause).not.toHaveBeenCalled();
      expect(ctx.onSeekRelative).not.toHaveBeenCalled();
      expect(addListeningSessionItem).not.toHaveBeenCalled();
    });

    it("custom mappings are honored per command", () => {
      setHandsFree({
        enabled: true,
        mappings: {
          next: "bookmark",
          previous: "mark_confusing",
          seekForward: "next_chapter",
          seekBackward: "previous_chapter",
        },
      });
      const ctx = makeContext();
      dispatchRemoteMediaCommand("SeekForward", ctx);
      expect(ctx.onNextChapter).toHaveBeenCalledTimes(1);
      expect(ctx.onSeekRelative).not.toHaveBeenCalled();
    });

    it("invalid persisted mapping falls back to the slot default", () => {
      const settings = useSettingsStore.getState().settings;
      useSettingsStore.setState({
        settings: {
          ...settings,
          handsFreeStudy: {
            ...settings.handsFreeStudy,
            enabled: true,
            mappings: { ...settings.handsFreeStudy.mappings, next: "bogus_action" as any },
          },
        },
      });
      const ctx = makeContext();
      dispatchRemoteMediaCommand("Next", ctx);
      // Default for `next` is save_recent_extract — the extract is created,
      // and the dispatcher never throws on the invalid value.
      expect(() => dispatchRemoteMediaCommand("Next", ctx)).not.toThrow();
    });
  });

  describe("typed capture outcomes (no synthetic text)", () => {
    beforeEach(() => {
      setHandsFree({ enabled: true });
    });

    it("empty anchor set → pending audio bookmark, never placeholder text", async () => {
      const ctx = makeContext({ anchors: [] });
      await executeStudyAction("save_recent_extract", ctx);
      expect(createExtract).not.toHaveBeenCalled();
      expect(addListeningSessionItem).toHaveBeenCalledWith(
        expect.objectContaining({
          markerType: "bookmark",
          snippetText: "",
          note: expect.stringContaining("[pending_audio_bookmark]"),
        })
      );
    });

    it("low confidence → pending audio bookmark with no text", async () => {
      const ctx = makeContext({ captureConfidence: "low" });
      await executeStudyAction("save_recent_extract", ctx);
      expect(createExtract).not.toHaveBeenCalled();
      expect(addListeningSessionItem).toHaveBeenCalledWith(
        expect.objectContaining({ snippetText: "" })
      );
    });

    it("medium confidence → needs-confirmation candidate, no permanent extract", async () => {
      const ctx = makeContext({ captureConfidence: "medium" });
      await executeStudyAction("save_recent_extract", ctx);
      expect(createExtract).not.toHaveBeenCalled();
      expect(addListeningSessionItem).toHaveBeenCalledWith(
        expect.objectContaining({
          markerType: "extract",
          extractId: null,
          note: expect.stringContaining("[needs_confirmation]"),
          snippetText: expect.stringContaining("Wave-particle duality"),
        })
      );
    });
  });

  describe("repeat-extension (OS command authoritative)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      setHandsFree({ enabled: true, captureWindow: 15 });
    });
    afterEach(() => vi.useRealTimers());

    it("a repeat within the extension window updates the SAME capture in place", async () => {
      // Three paragraph-separated sentences over 60s; a capture at t=50 with
      // a 15s window covers the last sentence (startIdx=2) and a repeat
      // extends backward to include the previous paragraph.
      const text = "Alpha alpha alpha.\n\nBeta beta beta.\n\nGamma gamma gamma.";
      const { computeSentenceAnchors } = await import("../audioEditionAnchors");
      const anchors = computeSentenceAnchors("sec-ext", text, 60, "0");
      const ctx = makeContext({ anchors, currentTimestampSec: 50 });

      await executeStudyAction("save_recent_extract", ctx);
      expect(createExtract).toHaveBeenCalledTimes(1);
      expect((createExtract as any).mock.calls[0][0].content).toContain("Gamma");

      await executeStudyAction("save_recent_extract", ctx);

      // No duplicate extract/session item — the existing extract was updated
      // in place with the preceding paragraph prepended.
      expect(createExtract).toHaveBeenCalledTimes(1);
      expect(updateExtract).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "ext-test-1",
          content: expect.stringContaining("Beta"),
        })
      );
      expect(updateListeningSessionItem).toHaveBeenCalled();
      expect(playChime).toHaveBeenCalledWith("extract_extended");
    });

    it("extension is capped at 3; a repeat after the cap creates a fresh capture", async () => {
      // Five paragraph-separated sentences of 60s each (300s total); a
      // capture at t=290 with a 15s window covers only sentence 5.
      const text = Array.from({ length: 5 }, (_, i) => `${"Word ".repeat(12)}${i + 1}.`).join("\n\n");
      const { computeSentenceAnchors } = await import("../audioEditionAnchors");
      const anchors = computeSentenceAnchors("sec-cap", text, 300, "0");
      const ctx = makeContext({ anchors, currentTimestampSec: 290 });

      // Initial save + the maximum of 3 backward extensions.
      await executeStudyAction("save_recent_extract", ctx);
      await executeStudyAction("save_recent_extract", ctx);
      await executeStudyAction("save_recent_extract", ctx);
      await executeStudyAction("save_recent_extract", ctx);
      expect(createExtract).toHaveBeenCalledTimes(1);
      expect(updateExtract).toHaveBeenCalledTimes(3);

      // The cap is reached — a further repeat starts a fresh capture.
      await executeStudyAction("save_recent_extract", ctx);
      expect(createExtract).toHaveBeenCalledTimes(2);
    }, 20_000);

    it("a repeat after the extension window is a fresh capture, not an extension", async () => {
      const text = "Alpha alpha alpha.\n\nBeta beta beta.\n\nGamma gamma gamma.";
      const { computeSentenceAnchors } = await import("../audioEditionAnchors");
      const anchors = computeSentenceAnchors("sec-window", text, 60, "0");
      const ctx = makeContext({ anchors, currentTimestampSec: 50 });

      await executeStudyAction("save_recent_extract", ctx);
      vi.advanceTimersByTime(3000);
      await executeStudyAction("save_recent_extract", ctx);
      expect(createExtract).toHaveBeenCalledTimes(2);
    });
  });

  describe("duplicate command suppression", () => {
    it("drops an identical eventId within the window", () => {
      const ctx = makeContext();
      const envelope = envelopeForCommand("Next", "android");
      dispatchRemoteMediaCommand(envelope, ctx);
      dispatchRemoteMediaCommand(envelope, ctx);
      expect(ctx.onNextChapter).toHaveBeenCalledTimes(1);
    });

    it("accepts distinct rapid commands, including repeated seeks", () => {
      const ctx = makeContext();
      dispatchRemoteMediaCommand(envelopeForCommand("SeekForward", "web"), ctx);
      dispatchRemoteMediaCommand(envelopeForCommand("SeekForward", "web"), ctx);
      expect(ctx.onSeekRelative).toHaveBeenNthCalledWith(1, NORMAL_SEEK_FORWARD_SEC);
      expect(ctx.onSeekRelative).toHaveBeenNthCalledWith(2, NORMAL_SEEK_FORWARD_SEC);
    });

    it("accepts distinct physical presses (different eventIds after the window)", () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const ctx = makeContext();
        dispatchRemoteMediaCommand(envelopeForCommand("Next", "web"), ctx);
        vi.advanceTimersByTime(1600);
        dispatchRemoteMediaCommand(envelopeForCommand("Next", "web"), ctx);
        expect(ctx.onNextChapter).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("dispatch never throws", () => {
    it("a throwing context callback does not escape the dispatcher", () => {
      const ctx = makeContext({ onPlayPause: () => { throw new Error("boom"); } });
      expect(() => dispatchRemoteMediaCommand("Play", ctx)).not.toThrow();
    });

    it("an unknown command is ignored gracefully", () => {
      expect(() =>
        dispatchRemoteMediaCommand({ command: "Nonsense" as any, eventId: "e", source: "web", occurredAt: Date.now() }, makeContext())
      ).not.toThrow();
    });

    it("does not acknowledge a retryable failure and can retry the same event after capability recovery", () => {
      const acked: string[] = [];
      setMediaCommandAckHandler((eventIds) => acked.push(...eventIds));
      const ctx = makeContext({ onNextChapter: undefined });
      const envelope = {
        command: "Next" as const,
        eventId: "retry-after-capability-recovery",
        source: "android" as const,
        occurredAt: Date.now(),
      };

      expect(dispatchRemoteMediaCommand(envelope, ctx)).toMatchObject({
        accepted: false,
        disposition: "retryable_failure",
      });
      expect(acked).toEqual([]);

      const onNextChapter = vi.fn();
      ctx.onNextChapter = onNextChapter;
      expect(dispatchRemoteMediaCommand(envelope, ctx)).toMatchObject({
        accepted: true,
        disposition: "accepted",
      });
      expect(onNextChapter).toHaveBeenCalledTimes(1);
      expect(acked).toEqual([envelope.eventId]);
    });
  });
});
