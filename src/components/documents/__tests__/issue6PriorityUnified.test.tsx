import { useEffect, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModalProvider, useModalStore } from "../../common/Modal";
import {
  DEFAULT_SHORTCUTS,
  eventMatchesCombo,
  getShortcutCombo,
  useShortcutStore,
} from "../../common/KeyboardShortcuts";
import {
  dispatchPriorityCommit,
  resolveDisplaySlider,
  resolveExtractDisplaySlider,
  resolveQueueItemDisplaySlider,
  resolveQueuePriorityTarget,
  sliderToRating,
  usePriorityCommitState,
} from "../../../services/priority/priorityCommit";
import { convertQueueItem } from "../../../api/queue";
import { usePriorityPopup } from "../usePriorityPopup";
import { PriorityControl } from "../../viewer/PriorityControl";
import { getDocument } from "../../../api/documents";
import { highestOverlayPriority, resetOverlayStackForTests } from "../../../lib/overlayStack";
import type { Document } from "../../../types/document";

useShortcutStore.persist.setOptions({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  } as any,
});

const testBackend = vi.hoisted(() => ({
  documents: new Map<string, Document>(),
  writes: [] as Array<{ id: string; rating: number; slider: number }>,
  failNextWrite: null as Error | null,
}));

function createFixtureDoc(id: string, initialSlider = 50, explicitlySet = false): Document {
  const rating = initialSlider > 0 ? sliderToRating(initialSlider) : 0;
  return {
    id,
    title: `Document ${id}`,
    filePath: `fixture://${id}`,
    fileType: "markdown",
    content: "# Content",
    tags: [],
    dateAdded: "2026-10-20T12:00:00Z",
    dateModified: "2026-10-20T12:00:00Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: rating,
    prioritySlider: initialSlider,
    priorityScore: initialSlider,
    priorityExplicitlySet: explicitlySet,
    isArchived: false,
    isFavorite: false,
    isDismissed: false,
  };
}

vi.mock("../../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isTauri: () => true,
  isNativeMobile: () => false,
  listen: vi.fn(async () => () => undefined),
  invokeCommand: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "get_document") {
      const found = testBackend.documents.get(String(args.id));
      return found ? structuredClone(found) : null;
    }
    if (cmd === "update_document_priority") {
      const id = String(args.id);
      const rating = Number(args.rating ?? 0);
      const slider = Math.max(0, Math.min(100, Math.round(Number(args.slider ?? 0))));
      testBackend.writes.push({ id, rating, slider });
      if (testBackend.failNextWrite) {
        const err = testBackend.failNextWrite;
        testBackend.failNextWrite = null;
        throw err;
      }
      const existing = testBackend.documents.get(id);
      if (!existing) throw new Error(`Document ${id} not found`);
      const derivedRating = slider > 0 ? sliderToRating(slider) : 0;
      const updated: Document = {
        ...existing,
        priorityRating: derivedRating,
        prioritySlider: slider,
        priorityScore: slider,
        priorityExplicitlySet: true,
      };
      testBackend.documents.set(id, structuredClone(updated));
      return structuredClone(updated);
    }
    if (cmd === "get_priority_standing") {
      return { position: 1, queueSize: 10 };
    }
    throw new Error(`Unexpected command: ${cmd}`);
  }),
}));

function PriorityTestHarness({
  docId,
  onNavigate,
}: {
  docId: string;
  onNavigate?: (nextId: string) => void;
}) {
  const [currentId, setCurrentId] = useState(docId);
  const doc = testBackend.documents.get(currentId) ?? createFixtureDoc(currentId);
  const [liveDoc, setLiveDoc] = useState(doc);
  const popup = usePriorityPopup({
    updateDocument: (_id, updates) => {
      setLiveDoc((prev) => ({ ...prev, ...updates }));
    },
  });

  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <ModalProvider>
      <div data-testid="active-doc-id">{currentId}</div>
      <div data-testid="live-slider-readout">{resolveDisplaySlider(liveDoc)}</div>
      <button
        ref={triggerRef}
        data-testid="open-popup-btn"
        onClick={() => void popup.open([currentId], [liveDoc])}
      >
        Open Priority
      </button>
      <PriorityControl
        documentId={currentId}
        prioritySlider={liveDoc.prioritySlider}
        priorityRating={liveDoc.priorityRating}
        variant="full"
        onPriorityChange={(slider, rating) => {
          setLiveDoc((prev) => ({
            ...prev,
            prioritySlider: slider,
            priorityRating: rating,
            priorityExplicitlySet: true,
          }));
        }}
      />
      <button
        data-testid="switch-doc-btn"
        onClick={() => {
          const next = currentId === "doc-1" ? "doc-2" : "doc-1";
          setCurrentId(next);
          setLiveDoc(testBackend.documents.get(next) ?? createFixtureDoc(next));
          onNavigate?.(next);
        }}
      >
        Switch Doc
      </button>
    </ModalProvider>
  );
}

describe("R08: Unified Priority Persistence and Multi-Input Parity", () => {
  it("resolves cards and extracts to their own typed IDs even when the parent shares an ID", () => {
    const base = { id: "shared", documentId: "shared", documentTitle: "Parent", priority: 5, estimatedTime: 2, tags: [], progress: 0 };
    expect(resolveQueuePriorityTarget({ ...base, itemType: "extract", extractId: "shared" })).toEqual({ kind: "extract", id: "shared" });
    expect(resolveQueuePriorityTarget({ ...base, itemType: "learning-item", learningItemId: "shared" })).toEqual({ kind: "learning-item", id: "shared" });
    expect(resolveQueuePriorityTarget({ ...base, id: "card-only", documentId: "", itemType: "learning-item" })).toEqual({ kind: "learning-item", id: "card-only" });
    expect(resolveQueuePriorityTarget({ ...base, itemType: "playlist-video", documentId: "doc-1" })).toEqual({ kind: "document", id: "doc-1" });
  });
  it("prefers the authoritative readback over the row's stored rank fields", () => {
    // The backend resolves extracts/facts into priority_display_slider; a rank
    // key or stale slider must never win over it.
    expect(resolveQueueItemDisplaySlider({
      itemType: "extract", priorityDisplaySlider: 73, prioritySlider: 0, priorityRating: 0,
    })).toBe(73);
    expect(resolveQueueItemDisplaySlider({ itemType: "document", prioritySlider: 0, priorityRating: 4, priorityExplicitlySet: false })).toBe(70);
    expect(resolveQueueItemDisplaySlider({ itemType: "document", prioritySlider: 0, priorityRating: 4, priorityExplicitlySet: true })).toBe(0);
    expect(resolveQueueItemDisplaySlider({ itemType: "learning-item", prioritySlider: 0, priorityExplicitlySet: true })).toBe(0);
    expect(resolveQueueItemDisplaySlider({ itemType: "extract", prioritySlider: 73 })).toBe(73);
    expect(resolveQueueItemDisplaySlider({ itemType: "extract" })).toBe(50);

    const converted = convertQueueItem({
      id: "e1", document_id: "d1", document_title: "Doc", item_type: "extract",
      priority_rating: 0, priority_slider: 73, priority_display_slider: 73,
      priority_explicitly_set: true, priority_score: 88.25, entity_id: "e1",
      priority: 0, estimated_time: 3, tags: [], progress: 0,
    });
    expect(converted).toMatchObject({
      prioritySlider: 73, priorityDisplaySlider: 73, priorityExplicitlySet: true,
      priorityScore: 88.25, entityId: "e1",
    });
  });
  it("reads extract sliders independently of rank keys and preserves inherited zero", () => {
    const parent = { priorityScore: 12.5, prioritySlider: 0, priorityExplicitlySet: true };
    expect(resolveExtractDisplaySlider({ priority_score: 82.7, priority_slider: 73 }, parent)).toBe(73);
    expect(resolveExtractDisplaySlider({ priority_score: 12.5, priority_slider: 0 }, parent)).toBe(0);
    expect(resolveExtractDisplaySlider({ priority_score: 12.5 }, parent)).toBe(0);
    expect(resolveExtractDisplaySlider({ priority_score: 44.2 }, parent)).toBe(50);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    testBackend.documents.clear();
    testBackend.documents.set("doc-1", createFixtureDoc("doc-1", 50, false));
    testBackend.documents.set("doc-2", createFixtureDoc("doc-2", 30, false));
    testBackend.writes.length = 0;
    testBackend.failNextWrite = null;
    resetOverlayStackForTests();
    useModalStore.getState().hideModal();
  });

  it("verifies equal values and ordering across 0, 25, 50, 75, 100 with explicit-zero persistence after store restart", async () => {
    const testCases = [
      { input: 0, expectedRating: 0 },
      { input: 25, expectedRating: 2 },
      { input: 50, expectedRating: 3 },
      { input: 75, expectedRating: 4 },
      { input: 100, expectedRating: 5 },
    ];

    for (const { input, expectedRating } of testCases) {
      const docId = `doc-val-${input}`;
      testBackend.documents.set(docId, createFixtureDoc(docId, 50, false));

      const result = await dispatchPriorityCommit({ kind: "document", id: docId }, input);
      expect(result.slider).toBe(input);
      expect(result.rating).toBe(expectedRating);

      // Verify independent backend read-back simulates restart/relaunch
      const persisted = await getDocument(docId);
      expect(persisted).not.toBeNull();
      expect(persisted?.prioritySlider).toBe(input);
      expect(persisted?.priorityRating).toBe(expectedRating);
      expect(persisted?.priorityExplicitlySet).toBe(true);
      expect(resolveDisplaySlider(persisted!)).toBe(input);
    }

    // Monotonic ordering verification: 0 < 25 < 50 < 75 < 100
    const keys = testCases.map((tc) => testBackend.documents.get(`doc-val-${tc.input}`)!.priorityScore);
    for (let i = 0; i < keys.length - 1; i++) {
      expect(keys[i]).toBeLessThan(keys[i + 1]);
    }
  });

  it("verifies pointer, keyboard, and touch completion parity in PriorityControl", async () => {
    const { unmount } = render(<PriorityTestHarness docId="doc-1" />);
    const slider = screen.getByRole("slider");

    // 1. Pointer interaction (pointerDown -> change draft -> pointerUp commits)
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "70" } });
    expect(testBackend.writes).toHaveLength(0); // Not committed during intermediate drag
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(testBackend.writes).toHaveLength(1));
    expect(testBackend.writes[0]).toEqual({ id: "doc-1", rating: 4, slider: 70 });
    await waitFor(() => expect(slider).not.toBeDisabled());

    // 2. Touch interaction (touchStart -> change draft -> touchEnd commits)
    fireEvent.touchStart(slider);
    fireEvent.change(slider, { target: { value: "90" } });
    expect(testBackend.writes).toHaveLength(1);
    fireEvent.touchEnd(slider);
    await waitFor(() => expect(testBackend.writes).toHaveLength(2));
    expect(testBackend.writes[1]).toEqual({ id: "doc-1", rating: 5, slider: 90 });
    await waitFor(() => expect(slider).not.toBeDisabled());

    // 3. Keyboard navigation keys (ArrowLeft commits on keyUp)
    fireEvent.change(slider, { target: { value: "85" } });
    fireEvent.keyUp(slider, { key: "ArrowLeft" });
    await waitFor(() => expect(testBackend.writes).toHaveLength(3));
    expect(testBackend.writes[2]).toEqual({ id: "doc-1", rating: 5, slider: 85 });
    await waitFor(() => expect(slider).not.toBeDisabled());

    // 4. Keyboard Enter commits
    fireEvent.change(slider, { target: { value: "10" } });
    fireEvent.keyDown(slider, { key: "Enter" });
    await waitFor(() => expect(testBackend.writes).toHaveLength(4));
    expect(testBackend.writes[3]).toEqual({ id: "doc-1", rating: 1, slider: 10 });
    await waitFor(() => expect(slider).not.toBeDisabled());

    unmount();
  });

  it("deduplicates repeated completions and writes zero changes on redundant commits or Escape", async () => {
    render(<PriorityTestHarness docId="doc-1" />);

    // Open popup
    fireEvent.click(screen.getByTestId("open-popup-btn"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    const numericInput = screen.getByRole("textbox");

    // Escape cancels and writes nothing
    fireEvent.change(numericInput, { target: { value: "65" } });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(testBackend.writes).toHaveLength(0);

    // Reopen popup and commit via Enter
    fireEvent.click(screen.getByTestId("open-popup-btn"));
    const reopenedInput = await screen.findByRole("textbox");
    fireEvent.change(reopenedInput, { target: { value: "75" } });

    // Rapid double Enter
    fireEvent.keyDown(reopenedInput, { key: "Enter" });
    fireEvent.keyDown(reopenedInput, { key: "Enter" });

    await waitFor(() => expect(testBackend.writes).toHaveLength(1));
    expect(testBackend.writes[0]).toEqual({ id: "doc-1", rating: 0, slider: 75 });
  });

  it("retains draft on injected failure, displays actionable error, and recovers on retry", async () => {
    render(<PriorityTestHarness docId="doc-1" />);

    // Injected failure
    testBackend.failNextWrite = new Error("database is locked");

    fireEvent.click(screen.getByTestId("open-popup-btn"));
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "95" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Dialog remains open, alert is rendered, draft is preserved
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(input).toHaveValue("95");
    expect(testBackend.writes).toHaveLength(1);

    // Retry committing the same retained draft
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(testBackend.writes).toHaveLength(2);
    expect(testBackend.writes[1]).toEqual({ id: "doc-1", rating: 0, slider: 95 });

    // Read back persisted value
    const doc = await getDocument("doc-1");
    expect(doc?.prioritySlider).toBe(95);
  });

  it("binds pending commits to captured identity so late completion cannot overwrite another item", async () => {
    let resolveDelayedWrite: (() => void) | null = null;
    const delayedPromise = new Promise<void>((resolve) => {
      resolveDelayedWrite = resolve;
    });

    const originalInvoke = (await import("../../../lib/tauri")).invokeCommand;
    vi.mocked(originalInvoke).mockImplementationOnce(async (cmd, args) => {
      if (cmd === "update_document_priority") {
        await delayedPromise;
      }
      return originalInvoke(cmd, args);
    });

    render(<PriorityTestHarness docId="doc-1" />);
    const slider = screen.getByRole("slider");

    // Initiate commit on doc-1
    fireEvent.change(slider, { target: { value: "80" } });
    fireEvent.pointerUp(slider);

    // Immediately switch to doc-2 before doc-1 write settles
    fireEvent.click(screen.getByTestId("switch-doc-btn"));
    expect(screen.getByTestId("active-doc-id")).toHaveTextContent("doc-2");

    // Release doc-1 write
    await act(async () => {
      resolveDelayedWrite?.();
    });

    // doc-2's live readout must NOT have been contaminated by doc-1's late result
    expect(screen.getByTestId("active-doc-id")).toHaveTextContent("doc-2");
    expect(screen.getByTestId("live-slider-readout")).toHaveTextContent("30");

    // Verify doc-1 was correctly persisted in backend
    const doc1 = await getDocument("doc-1");
    expect(doc1?.prioritySlider).toBe(80);
    const doc2 = await getDocument("doc-2");
    expect(doc2?.prioritySlider).toBe(30);
  });

  it("yields background operations and shortcuts while priority modal is open", async () => {
    render(<PriorityTestHarness docId="doc-1" />);

    expect(highestOverlayPriority()).toBe(0);

    fireEvent.click(screen.getByTestId("open-popup-btn"));
    await screen.findByRole("dialog");

    // While priority dialog is active, overlay priority is at least 100
    expect(highestOverlayPriority()).toBeGreaterThanOrEqual(100);

    // Close dialog with Escape
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Overlay priority drops back down
    expect(highestOverlayPriority()).toBe(0);
  });
});
