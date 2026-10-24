import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioPlaybackSnapshot, AudioSourceKey, ResolvedAudioItem } from "../../../types/audioEdition";
import type { AudioPlaybackOwner } from "../../../services/audio/audioPlaybackOwner";
import { ExpandedAudioPlayer } from "../ExpandedAudioPlayer";
import { useAudioPlaybackStore } from "../../../stores/audioPlaybackStore";
import { useListeningQueueStore } from "../../../stores/listeningQueueStore";
import { resetAudioRuntimeForTests } from "../../../services/audio/audioRuntime";
import { withAudioBoundaries } from "../../../services/audio/audioCoordinates";
import { loadLocale } from "../../../lib/i18n";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { RecordingSession } from "../../../types/recordingSession";

const recordingApi = vi.hoisted(() => ({
  getRecordingSession: vi.fn(),
}));
vi.mock("../../../api/recordingSessions", () => recordingApi);
vi.mock("../../recording/SessionTranscript", () => ({
  SessionTranscript: ({ session, onSeek }: { session: { id: string }; onSeek?: (seconds: number) => void }) => (
    <div data-testid="stub-transcript">
      {session.id}
      <button type="button" onClick={() => onSeek?.(77)}>Seek transcript</button>
    </div>
  ),
}));
vi.mock("../../recording/SessionExtracts", () => ({
  SessionExtracts: ({ session }: { session: { id: string } }) => <div data-testid="stub-extracts">{session.id}</div>,
}));
vi.mock("../../recording/SessionFlashcards", () => ({
  SessionFlashcards: ({ session }: { session: { id: string } }) => <div data-testid="stub-flashcards">{session.id}</div>,
}));

async function setTestLocale(locale: "en" | "de") {
  await loadLocale(locale);
  useSettingsStore.getState().updateSettingsCategory("general", { language: locale });
}

const recordingSession: RecordingSession = {
  id: "rec-1",
  documentId: "rec-doc-1",
  origin: "recorded",
  contentType: "lecture",
  profileJson: "{}",
  captureState: "saved",
  ingestionState: "saved",
  transcriptId: 1,
  mediaAssetId: "asset-1",
  transcriptRevision: 1,
  overviewJson: null,
  overviewRevision: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
};

const recordingKey: AudioSourceKey = { profileKey: "local", kind: "recording", sourceId: "rec-1" };
const bookA: AudioSourceKey = { profileKey: "local", kind: "audiobook", sourceId: "book-a" };
const bookB: AudioSourceKey = { profileKey: "local", kind: "audiobook", sourceId: "book-b" };

function snapshot(overrides: Partial<AudioPlaybackSnapshot> = {}): AudioPlaybackSnapshot {
  return {
    schemaVersion: 1,
    sourceKey: recordingKey,
    generation: 1,
    revision: 1,
    metadata: { sourceId: "rec-1", sourceKind: "recording", sessionId: "session-1", title: "Lecture one" },
    section: { id: "sec-1", index: 0, title: "Introduction" },
    state: "paused",
    playIntent: false,
    pauseReason: "user",
    positionSec: 42,
    globalPositionSec: 42,
    sleepDeadlineMs: null,
    timeInPart: 42,
    partIndex: 0,
    durationSec: 300,
    playbackRate: 1,
    volume: 0.8,
    mediaRevision: "rev-1",
    checkpointSequence: 1,
    updatedAt: 1000,
    queue: [recordingKey, bookA, bookB],
    capabilities: {
      canPlay: true, canPause: true, canResume: true, canSeekRelative: true,
      canSeekAbsolute: true, precisePosition: true, canNext: true, canPrevious: false,
    },
    ...overrides,
  };
}

function resolved(): ResolvedAudioItem {
  return {
    sourceKey: recordingKey,
    title: "Lecture one",
    documentId: "rec-doc-1",
    mediaRevision: "rev-1",
    complete: true,
    parts: withAudioBoundaries([{ partId: "p1", sourceRevision: "rev-1", browserUrl: "/rec.wav", durationSec: 300 }]),
  };
}

function createFakeOwner(snap: AudioPlaybackSnapshot) {
  const owner: AudioPlaybackOwner = {
    initialize: vi.fn(),
    getSnapshot: () => snap,
    getIntentVersion: () => 1,
    getItem: () => resolved(),
    subscribe: () => () => undefined,
    load: vi.fn(async () => undefined),
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    pauseForFocus: vi.fn(async () => undefined),
    toggle: vi.fn(async () => undefined),
    seekTo: vi.fn(async () => undefined),
    seekRelative: vi.fn(async () => undefined),
    selectChapter: vi.fn(async () => undefined),
    queueNext: vi.fn(async () => undefined),
    queuePrevious: vi.fn(async () => undefined),
    setRate: vi.fn(async () => undefined),
    setVolume: vi.fn(async () => undefined),
    setSleepTimer: vi.fn(),
    updateQueue: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    stopAndClose: vi.fn(async () => undefined),
    command: vi.fn(async () => ({ disposition: "accepted" as const, snapshot: snap })),
    dispose: vi.fn(async () => undefined),
  };
  return owner;
}

beforeEach(async () => {
  localStorage.clear();
  recordingApi.getRecordingSession.mockResolvedValue(recordingSession);
  useListeningQueueStore.setState({
    items: [
      { id: JSON.stringify(["local", "recording", "rec-1"]), documentId: "rec-doc-1", title: "Lecture one", currentPositionSeconds: 0, durationSeconds: 300, status: "playing", enqueuedAt: "2026-01-01T00:00:00.000Z" },
      { id: JSON.stringify(["local", "audiobook", "book-a"]), documentId: "book-a", title: "Book A", currentPositionSeconds: 0, durationSeconds: 60, status: "queued", enqueuedAt: "2026-01-01T00:00:00.000Z" },
      { id: JSON.stringify(["local", "audiobook", "book-b"]), documentId: "book-b", title: "Book B", currentPositionSeconds: 0, durationSeconds: 60, status: "queued", enqueuedAt: "2026-01-01T00:00:00.000Z" },
    ],
    currentItemId: JSON.stringify(["local", "recording", "rec-1"]),
    playbackSpeed: 1,
  });
  await setTestLocale("en");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await setTestLocale("en");
  await resetAudioRuntimeForTests(null);
  useListeningQueueStore.setState({ items: [], currentItemId: null, playbackSpeed: 1 });
});

describe("task 8.4 — expanded player transcript, learning and queue editing", () => {
  it("loads recording transcript/extracts/flashcards lazily from the existing components", async () => {
    console.log("DIRECT_IMPORT_BEFORE");
    const mod = await import("../../../api/recordingSessions");
    console.log("DIRECT_IMPORT_AFTER", typeof mod.getRecordingSession);
    const owner = createFakeOwner(snapshot());
    await resetAudioRuntimeForTests(owner);
    act(() => useAudioPlaybackStore.setState({ expanded: true }));

    render(<ExpandedAudioPlayer />);

    expect(await screen.findByRole("tablist", { name: "Study" }, { timeout: 8000 })).toBeInTheDocument();
    expect(await screen.findByTestId("stub-transcript", {}, { timeout: 8000 })).toHaveTextContent("rec-1");
    expect(recordingApi.getRecordingSession).toHaveBeenCalledWith("rec-1");

    // Seeking from the existing transcript component stays on the one owner.
    fireEvent.click(screen.getByRole("button", { name: "Seek transcript" }));
    await waitFor(() => expect(owner.seekTo).toHaveBeenCalledWith(77));

    fireEvent.click(screen.getByRole("tab", { name: "Extracts" }));
    expect(await screen.findByTestId("stub-extracts", {}, { timeout: 8000 })).toHaveTextContent("rec-1");

    fireEvent.click(screen.getByRole("tab", { name: "Flashcards" }));
    expect(await screen.findByTestId("stub-flashcards", {}, { timeout: 8000 })).toHaveTextContent("rec-1");

    // Selecting a tab never replaces audio or mounts a second decoder.
    expect(owner.load).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Flashcards" })).toHaveAttribute("aria-selected", "true");
  });

  it("edits the controller queue in place without removing the active item", async () => {
    const owner = createFakeOwner(snapshot());
    await resetAudioRuntimeForTests(owner);
    act(() => useAudioPlaybackStore.setState({ expanded: true }));

    render(<ExpandedAudioPlayer />);
    fireEvent.click(screen.getByRole("button", { name: "Edit queue" }));

    expect(screen.getByText("Book A")).toBeInTheDocument();
    expect(screen.getByText("Book B")).toBeInTheDocument();
    expect(screen.getByText("Now playing")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove from queue" })[0]).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    await waitFor(() =>
      expect(owner.updateQueue).toHaveBeenLastCalledWith([bookA, recordingKey, bookB]),
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Remove from queue" })[2]);
    await waitFor(() =>
      expect(owner.updateQueue).toHaveBeenLastCalledWith([recordingKey, bookA]),
    );
  });

  it("keeps study affordances recording-only and leaves other sources with their existing transport", async () => {
    const owner = createFakeOwner(snapshot({
      sourceKey: bookA,
      metadata: { sourceId: "book-a", sourceKind: "audiobook", sessionId: "session-2", title: "Book A" },
      queue: [bookA, bookB],
    }));
    await resetAudioRuntimeForTests(owner);
    act(() => useAudioPlaybackStore.setState({ expanded: true }));

    render(<ExpandedAudioPlayer />);
    expect(screen.queryByRole("tablist", { name: "Study" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit queue" }));
    expect(screen.getAllByText("Book B").length).toBeGreaterThan(0);
  });
});
