import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeferredStudyCapture } from "../deferredStudyCapture";
import {
  deferredCaptureAnchor,
  deferredCaptureTime,
  executeDeferredStudyCapture,
  isDeferredStudyAction,
} from "../deferredStudyCapture";

const listeningSessions = vi.hoisted(() => ({
  addListeningSessionItem: vi.fn(async (item: unknown) => item),
}));
vi.mock("../../../api/listeningSessions", () => listeningSessions);

const capture = (overrides: Partial<DeferredStudyCapture> = {}): DeferredStudyCapture => ({
  eventId: "capture-1",
  command: "Next",
  studyAction: "save_recent_extract",
  sourceKey: { profileKey: "test", kind: "audiobook", sourceId: "book-a" },
  sessionId: "session-a",
  generation: 2,
  section: { id: "part-2", index: 2, title: "Chapter three" },
  partIndex: 2,
  positionHintSec: 32.7,
  positionSec: 152.7,
  ...overrides,
});

beforeEach(() => listeningSessions.addListeningSessionItem.mockClear());

describe("task 8.2 — deferred native Study Mode captures", () => {
  it("keeps the original press-time source, part and coordinate without fabricating text", async () => {
    await executeDeferredStudyCapture(capture());

    expect(listeningSessions.addListeningSessionItem).toHaveBeenCalledTimes(1);
    expect(listeningSessions.addListeningSessionItem).toHaveBeenCalledWith({
      sessionId: "session-a",
      extractId: null,
      markerType: "bookmark",
      audioTimestamp: 32.7,
      sourceAnchor: "audio:audiobook:book-a#part-2@32.700",
      snippetText: "",
      note: "Extract mark from Chapter three at 0:32",
    });
  });

  it("maps marker intent to existing marker types and never writes transcript text", async () => {
    await executeDeferredStudyCapture(capture({ studyAction: "mark_interesting" }));
    await executeDeferredStudyCapture(capture({ eventId: "capture-2", studyAction: "mark_confusing" }));
    await executeDeferredStudyCapture(capture({ eventId: "capture-3", studyAction: "bookmark" }));

    const items = listeningSessions.addListeningSessionItem.mock.calls.map(([item]) => item as { markerType: string; snippetText: string });
    expect(items.map(item => item.markerType)).toEqual(["interesting", "confusing", "bookmark"]);
    expect(items.every(item => item.snippetText === "")).toBe(true);
  });

  it("fails while there is no durable listening session so the journal stays dirty", async () => {
    await expect(executeDeferredStudyCapture(capture({ sessionId: null }))).rejects.toThrow("no listening session");
    expect(listeningSessions.addListeningSessionItem).not.toHaveBeenCalled();
  });

  it("ignores navigation-only actions that native playback already applied", async () => {
    await executeDeferredStudyCapture(capture({ studyAction: "skip_forward" }));
    expect(listeningSessions.addListeningSessionItem).not.toHaveBeenCalled();
    expect(isDeferredStudyAction("skip_forward")).toBe(false);
    expect(isDeferredStudyAction("ask_plethora")).toBe(true);
    expect(deferredCaptureTime(capture({ positionHintSec: null, positionSec: 99 }))).toBe(99);
    expect(deferredCaptureAnchor(capture({ partIndex: null }))).toBe("audio:audiobook:book-a#part-0@32.700");
  });
});
