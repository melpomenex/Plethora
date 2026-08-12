/**
 * Reader-tab mid-load close (task 5.7): closing a tab while its document load
 * is still in flight cancels the pending load (the pdf.js loading task is
 * destroyed), issues no further backend requests, and surfaces no user-visible
 * error.
 *
 * The reader below mirrors how `PDFViewer.loadPDF` wires the load:
 *   - the loading task is tracked in `createPdfDocumentHolder()` the moment it
 *     exists (before any await), so a mid-flight unmount can destroy it;
 *   - the unmount cleanup calls `holder.reset()` -> `loadingTask.destroy()`;
 *   - a `mounted` guard swallows the post-unmount rejection, so the pending
 *     load failing after close must not surface an error.
 *
 * A sibling tab is kept open: `tabsStore.closeTab` refuses to close the last
 * tab (it returns state unchanged), so the close path under test is the real
 * one — the closed reader is removed from the workspace and unmounted.
 */
import { useEffect, useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabContent } from "../TabContent";
import { useTabsStore } from "../../../../stores/tabsStore";
import { createPdfDocumentHolder } from "../../../../lib/pdf/pdfDocumentHolder";
import type * as pdfjsLib from "pdfjs-dist";

function resetStore() {
  useTabsStore.setState({
    tabs: [],
    rootPane: { id: "test-pane", type: "tabs", tabIds: [], activeTabId: null },
    closedTabs: [],
    activeTabHistory: [],
    forwardTabHistory: [],
    evictedTabIds: new Set<string>(),
  });
}

interface ControllableTask {
  promise: Promise<void>;
  destroy: ReturnType<typeof vi.fn>;
  /** Reject the load as pdf.js does on destroy (AbortException-ish). */
  fail: (err: Error) => void;
  /** Resolve the load normally. */
  succeed: () => void;
}

function createControllableLoadingTask(): ControllableTask {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const destroy = vi.fn(() => {
    reject(new Error("Load cancelled"));
    return Promise.resolve();
  });
  return { promise, destroy, fail: reject, succeed: resolve };
}

/** Reader that starts a controllable in-flight load on mount (like PDFViewer). */
function MidLoadReader({
  documentId,
  requestBackend,
}: {
  documentId: string;
  requestBackend: (documentId: string) => ControllableTask;
}) {
  const holderRef = useRef(createPdfDocumentHolder());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    // Same shape as PDFViewer.loadPDF: track the task immediately so an
    // in-flight load is destroyable, then await it.
    const task = requestBackend(documentId);
    holderRef.current.setLoadingTask(task as unknown as pdfjsLib.PDFDocumentLoadingTask);
    task.promise
      .then(() => {
        if (mounted) setError(null);
      })
      .catch((err: Error) => {
        // The mounted guard must swallow a post-unmount rejection: a
        // cancelled load is not a user-visible error.
        if (mounted) setError(err.message);
      });
    return () => {
      mounted = false;
      holderRef.current.reset();
    };
  }, [documentId, requestBackend]);

  if (error) return <div role="alert">{error}</div>;
  return <div>loading-{documentId}</div>;
}

/** Open a mid-load reader tab A plus a sibling B; return A's task and the tab ids. */
function openReaderPair(
  requestBackend: ReturnType<typeof vi.fn<(_id: string) => ControllableTask>>,
) {
  resetStore();
  const idA = useTabsStore.getState().addTab({
    title: "A",
    icon: null,
    type: "document-viewer",
    content: () => MidLoadReader({ documentId: "doc-a", requestBackend }),
    closable: true,
    data: { documentId: "doc-a" },
  });
  const idB = useTabsStore.getState().addTab({
    title: "B",
    icon: null,
    type: "document-viewer",
    content: () => <div>reader-b</div>,
    closable: true,
    data: { documentId: "doc-b" },
  });
  const { rerender } = render(
    <TabContent tabs={useTabsStore.getState().tabs} activeTabId={idA} />,
  );
  const task = requestBackend.mock.results[0].value as ControllableTask;
  return { idA, idB, task, rerender };
}

describe("reader tab mid-load close (task 5.7)", () => {
  it("closing a tab mid-load cancels the load, makes no further backend requests, and surfaces no error", () => {
    const requestBackend = vi.fn((_documentId: string) => createControllableLoadingTask());
    const { idA, task, rerender } = openReaderPair(requestBackend);

    // Load started: exactly one backend request, still in flight.
    expect(requestBackend).toHaveBeenCalledTimes(1);
    expect(task.destroy).not.toHaveBeenCalled();
    expect(screen.getByText("loading-doc-a")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    // Close the tab mid-load exactly as the UI does. The sibling keeps the
    // workspace non-empty, so closeTab really removes A and unmounts it.
    useTabsStore.getState().closeTab(idA);
    const state = useTabsStore.getState();
    expect(state.tabs.map((t) => t.id)).not.toContain(idA);
    const remainingId = state.tabs.find((t) => t.id !== idA)!.id;
    rerender(<TabContent tabs={state.tabs} activeTabId={remainingId} />);

    expect(task.destroy).toHaveBeenCalledTimes(1); // pending load cancelled
    expect(requestBackend).toHaveBeenCalledTimes(1); // no further backend requests
    expect(requestBackend.mock.calls[0][0]).toBe("doc-a");
    expect(screen.queryByRole("alert")).toBeNull(); // no user-visible error
    expect(screen.getByText("reader-b")).toBeTruthy(); // sibling stays
  });

  it("a load that fails after close surfaces no error even when the rejection lands late", () => {
    const requestBackend = vi.fn((_documentId: string) => createControllableLoadingTask());
    const { idA, task, rerender } = openReaderPair(requestBackend);

    useTabsStore.getState().closeTab(idA);
    const state = useTabsStore.getState();
    const remainingId = state.tabs.find((t) => t.id !== idA)!.id;
    rerender(<TabContent tabs={state.tabs} activeTabId={remainingId} />);
    expect(task.destroy).toHaveBeenCalledTimes(1);

    // The load's own failure (not the destroy) lands after unmount: still no
    // error surface and no further requests.
    task.fail(new Error("backend exploded"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(requestBackend).toHaveBeenCalledTimes(1);
  });
});
