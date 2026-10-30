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
import { resolveDisplaySlider, usePriorityPopup } from "../usePriorityPopup";
import { PriorityControl } from "../../viewer/PriorityControl";
import { getDocument } from "../../../api/documents";
import { ISSUE6_CLOCK, ISSUE6_IDS, ISSUE6_SECTIONED_CONTENT } from "../../../test/issue6/fixtures";
import type { Document } from "../../../types/document";

useShortcutStore.persist.setOptions({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  } as any,
});

const backendState = vi.hoisted(() => ({
  documents: new Map<string, Document>(),
  priorityWriteCalls: [] as Array<{ id: string; rating: number; slider: number }>,
  failNextWrite: null as Error | null,
}));

function seedFixtureDocument(): Document {
  return {
    id: ISSUE6_IDS.document,
    title: "Sectioned document",
    filePath: `fixture://${ISSUE6_IDS.document}`,
    fileType: "markdown",
    content: ISSUE6_SECTIONED_CONTENT,
    tags: [],
    dateAdded: ISSUE6_CLOCK,
    dateModified: ISSUE6_CLOCK,
    dateLastReviewed: "2026-10-21T12:00:00Z",
    nextReadingDate: "2026-10-22T12:00:00Z",
    extractCount: 1,
    learningItemCount: 4,
    priorityRating: 4,
    prioritySlider: 75,
    priorityScore: 75,
    priorityExplicitlySet: true,
    isArchived: false,
    isFavorite: false,
    isDismissed: false,
    stability: 8,
    difficulty: 4,
    reps: 2,
  };
}

vi.mock("../../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isTauri: () => true,
  isNativeMobile: () => false,
  listen: vi.fn(async () => () => undefined),
  openFilePicker: vi.fn(),
  openFolderPicker: vi.fn(),
  invokeCommand: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "get_document") {
      const found = backendState.documents.get(String(args.id));
      return found ? structuredClone(found) : null;
    }
    if (cmd === "update_document_priority") {
      const id = String(args.id);
      const rating = Number(args.rating ?? 0);
      const slider = Math.max(0, Math.min(100, Math.round(Number(args.slider ?? 0))));
      backendState.priorityWriteCalls.push({ id, rating, slider });
      if (backendState.failNextWrite) {
        const err = backendState.failNextWrite;
        backendState.failNextWrite = null;
        throw err;
      }
      const existing = backendState.documents.get(id);
      if (!existing) throw new Error(`Document ${id} not found`);
      // Mirrors src-tauri/src/commands/document.rs::update_document_priority.
      const derivedRating =
        slider > 0
          ? Math.min(5, Math.floor((slider - 1) / 20) + 1)
          : rating >= 1 && rating <= 5
            ? rating
            : 0;
      const updated: Document = {
        ...existing,
        priorityRating: derivedRating,
        prioritySlider: slider,
        priorityScore: slider,
        priorityExplicitlySet: true,
      };
      backendState.documents.set(id, structuredClone(updated));
      return structuredClone(updated);
    }
    if (cmd === "get_priority_standing") {
      return { position: 1, queueSize: 5 };
    }
    throw new Error(`Unexpected command in priority repro test: ${cmd}`);
  }),
}));

/**
 * Mirrors the exact shortcut + EPUB bridge wiring in DocumentsView.tsx:1260,
 * DocumentViewer.tsx:2400,4868, and EPUBViewer.tsx:2086,3495.
 */
function PriorityShortcutSurface({ onCommitError }: { onCommitError?: (err: unknown) => void }) {
  const [doc, setDoc] = useState<Document>(() => structuredClone(backendState.documents.get(ISSUE6_IDS.document)!));
  const docRef = useRef(doc);
  docRef.current = doc;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const popup = usePriorityPopup({
    updateDocument: (_id, updates) => {
      setDoc((prev) => ({ ...prev, ...updates }));
    },
  });

  useEffect(() => {
    const openForCurrent = () => {
      const current = docRef.current;
      void popup.open([current.id], [current]).catch((err) => onCommitError?.(err));
    };
    const onWindowKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const combo = getShortcutCombo("doc.priority");
      if (!combo || !eventMatchesCombo(e, combo)) return;
      e.preventDefault();
      openForCurrent();
    };
    window.addEventListener("keydown", onWindowKey);
    window.addEventListener("doc-priority-shortcut", openForCurrent);

    const frameWin = iframeRef.current?.contentWindow;
    const onFrameKey = (e: KeyboardEvent) => {
      const combo = getShortcutCombo("doc.priority");
      if (!combo || !eventMatchesCombo(e, combo)) return;
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("doc-priority-shortcut"));
    };
    frameWin?.addEventListener("keydown", onFrameKey, true);

    return () => {
      window.removeEventListener("keydown", onWindowKey);
      window.removeEventListener("doc-priority-shortcut", openForCurrent);
      frameWin?.removeEventListener("keydown", onFrameKey, true);
    };
  }, [popup, onCommitError]);

  return (
    <ModalProvider>
      <div data-testid="reader-priority-readout">{resolveDisplaySlider(doc)}</div>
      <iframe title="epub-frame" data-testid="epub-iframe" ref={iframeRef} />
    </ModalProvider>
  );
}

describe("issue #6 R08: keyboard priority persistence and control divergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backendState.documents.clear();
    backendState.documents.set(ISSUE6_IDS.document, seedFixtureDocument());
    backendState.priorityWriteCalls.length = 0;
    backendState.failNextWrite = null;
    useShortcutStore.setState({ shortcuts: DEFAULT_SHORTCUTS });
    useModalStore.getState().hideModal();
  });

  it("commits via default Alt+P (including macOS Option+P KeyP) + Enter and persists explicit 0 on independent read-back", async () => {
    render(<PriorityShortcutSurface />);

    // Open with macOS Option+P layout output (`event.key === "π"`, physical `KeyP`).
    fireEvent.keyDown(window, { key: "π", code: "KeyP", altKey: true });

    const numericInput = await screen.findByRole("textbox");
    expect(numericInput).toHaveValue("75");

    fireEvent.change(numericInput, { target: { value: "88" } });
    fireEvent.keyDown(numericInput, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(backendState.priorityWriteCalls).toHaveLength(1));
    expect(backendState.priorityWriteCalls[0]).toEqual({
      id: ISSUE6_IDS.document,
      rating: 0,
      slider: 88,
    });

    const after88 = await getDocument(ISSUE6_IDS.document);
    expect(after88).toMatchObject({
      prioritySlider: 88,
      priorityRating: 5,
      priorityExplicitlySet: true,
    });

    // Reopen via standard Alt+P and commit explicit 0 via Enter.
    fireEvent.keyDown(window, { key: "p", code: "KeyP", altKey: true });
    const zeroInput = await screen.findByRole("textbox");
    expect(zeroInput).toHaveValue("88");

    fireEvent.change(zeroInput, { target: { value: "0" } });
    fireEvent.keyDown(zeroInput, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(backendState.priorityWriteCalls).toHaveLength(2));
    const afterZero = await getDocument(ISSUE6_IDS.document);
    expect(afterZero).toMatchObject({
      prioritySlider: 0,
      priorityRating: 0,
      priorityExplicitlySet: true,
    });
    expect(resolveDisplaySlider(afterZero!)).toBe(0);
    expect(screen.getByTestId("reader-priority-readout")).toHaveTextContent("0");
  });

  it("honors a remapped doc.priority shortcut, commits via Apply button, and writes nothing on Escape", async () => {
    useShortcutStore.getState().updateShortcut("doc.priority", {
      key: "p",
      ctrl: true,
      shift: true,
    });
    render(<PriorityShortcutSurface />);

    // Default Alt+P must not open once remapped.
    fireEvent.keyDown(window, { key: "p", code: "KeyP", altKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();

    // Remapped Ctrl+Shift+P opens the popup; commit via Apply button.
    fireEvent.keyDown(window, { key: "p", code: "KeyP", ctrlKey: true, shiftKey: true });
    const rangeInput = await screen.findByRole("slider");
    fireEvent.change(rangeInput, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => expect(backendState.priorityWriteCalls).toHaveLength(1));
    const afterApply = await getDocument(ISSUE6_IDS.document);
    expect(afterApply).toMatchObject({
      prioritySlider: 30,
      priorityRating: 2,
      priorityExplicitlySet: true,
    });

    // Reopen, edit draft, cancel with Escape -> zero extra writes.
    fireEvent.keyDown(window, { key: "p", code: "KeyP", ctrlKey: true, shiftKey: true });
    const numericInput = await screen.findByRole("textbox");
    fireEvent.change(numericInput, { target: { value: "95" } });
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(backendState.priorityWriteCalls).toHaveLength(1);
    const afterCancel = await getDocument(ISSUE6_IDS.document);
    expect(afterCancel?.prioritySlider).toBe(30);
  });

  it("forwards doc.priority from inside an EPUB iframe window and persists via independent read-back", async () => {
    render(<PriorityShortcutSurface />);
    const iframe = screen.getByTestId("epub-iframe") as HTMLIFrameElement;
    const frameWin = iframe.contentWindow!;

    act(() => {
      frameWin.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          code: "KeyP",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const numericInput = await screen.findByRole("textbox");
    fireEvent.change(numericInput, { target: { value: "65" } });
    fireEvent.keyDown(numericInput, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(backendState.priorityWriteCalls).toHaveLength(1));
    const persisted = await getDocument(ISSUE6_IDS.document);
    expect(persisted).toMatchObject({
      prioritySlider: 65,
      priorityRating: 4,
      priorityExplicitlySet: true,
    });
  });

  it("verifies resolved unified priority behavior: gesture-based commit, zero-rating, error retention, and modal preservation", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const commitErrors: unknown[] = [];

    const { unmount } = render(
      <PriorityControl
        documentId={ISSUE6_IDS.document}
        prioritySlider={75}
        priorityRating={4}
        variant="full"
      />,
    );

    // 1. PriorityControl updates draft on change; commit happens on gesture completion (e.g. pointerUp or blur) and maps slider=0 -> rating=0.
    const inlineSlider = screen.getByRole("slider");
    fireEvent.change(inlineSlider, { target: { value: "0" } });
    expect(backendState.priorityWriteCalls).toHaveLength(0);

    fireEvent.pointerUp(inlineSlider);
    await waitFor(() => expect(backendState.priorityWriteCalls).toHaveLength(1));
    expect(backendState.priorityWriteCalls[0]).toEqual({
      id: ISSUE6_IDS.document,
      rating: 0,
      slider: 0,
    });

    // 2. On backend failure, PriorityControl retains draft for retry and shows error alert.
    backendState.failNextWrite = new Error("disk full");
    fireEvent.change(inlineSlider, { target: { value: "90" } });
    fireEvent.pointerUp(inlineSlider);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect((await getDocument(ISSUE6_IDS.document))?.prioritySlider).toBe(0);
    unmount();

    // 3. usePriorityPopup awaits commit in onConfirm; on error it retains draft, shows error alert, and keeps Modal OPEN for retry.
    render(<PriorityShortcutSurface onCommitError={(err) => commitErrors.push(err)} />);
    backendState.failNextWrite = new Error("sqlite busy");
    fireEvent.keyDown(window, { key: "p", code: "KeyP", altKey: true });
    const popupInput = await screen.findByRole("textbox");
    fireEvent.change(popupInput, { target: { value: "42" } });
    fireEvent.keyDown(popupInput, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(popupInput).toHaveValue("42");
    expect((await getDocument(ISSUE6_IDS.document))?.prioritySlider).toBe(0);

    // 4. With priorityExplicitlySet = true, slider=0 reads back as 0.
    expect(resolveDisplaySlider({ prioritySlider: 0, priorityRating: 0, priorityExplicitlySet: true })).toBe(0);

    consoleSpy.mockRestore();
  });
});
