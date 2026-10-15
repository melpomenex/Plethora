import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { flushSync } from "react-dom";
import { MarkdownViewer } from "../MarkdownViewer";
import type { Document as ReaderDocument } from "../../../types";
import { AnnotationRemovalMenu } from "../AnnotationRemovalMenu";
import type { ReaderContextMenuPayload } from "../annotationContextMenu";
const mocks = vi.hoisted(() => ({ deleteExtract: vi.fn(), haptic: vi.fn() }));
vi.mock("../../../api/extracts", () => ({ deleteExtract: mocks.deleteExtract }));
vi.mock("../../../hooks/useHapticFeedback", () => ({ useHapticFeedback: () => ({ delete: mocks.haptic }) }));
vi.mock("../../../hooks/useMobileShell", () => ({ useMobileShell: () => false }));
const menu: ReaderContextMenuPayload = { x: 30, y: 40, selectedText: "", annotations: [{ extractId: "a", documentId: "doc", text: "The selected saved passage" }] };
function Host({ documentId = "doc", initial = menu }: { documentId?: string; initial?: ReaderContextMenuPayload }) {
  const [state, setState] = useState<ReaderContextMenuPayload | null>(initial);
  return <AnnotationRemovalMenu key={documentId} documentId={documentId} menu={state} onClose={() => setState(null)} />;
}
beforeEach(() => { vi.clearAllMocks(); mocks.deleteExtract.mockResolvedValue(undefined); });
afterEach(cleanup);
const openConfirmation = () => fireEvent.click(screen.getByRole("menuitem", { name: "Remove highlight/extract" }));
describe("annotation removal interaction", () => {
  it("keeps the menu open when it mounts before the opening contextmenu reaches document", () => {
    function Reader() {
      const [state, setState] = useState<ReaderContextMenuPayload | null>(null);
      return <>
        <MarkdownViewer document={{ id: "doc" } as ReaderDocument} content="saved passage"
          highlights={[{ id: "a", startOffset: 0, endOffset: 5, annotation: menu.annotations![0] }]}
          onContextMenu={(payload) => flushSync(() => setState(payload))} />
        <AnnotationRemovalMenu documentId="doc" menu={state} onClose={() => setState(null)} />
      </>;
    }
    const { container } = render(<Reader />);
    const mark = container.querySelector("mark")!;
    vi.spyOn(mark, "getClientRects").mockReturnValue([new DOMRect(10, 20, 100, 20)] as unknown as DOMRectList);
    fireEvent.contextMenu(mark, { clientX: 30, clientY: 25 });
    expect(screen.getByRole("menuitem", { name: "Remove highlight/extract" })).toBeVisible();
  });

  it("opens confirmation identifying the passage and cancel changes nothing", () => {
    render(<Host />); openConfirmation();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("The selected saved passage");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("delete its saved extract");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.deleteExtract).not.toHaveBeenCalled();
  });

  it("confirms with immutable record/document identity", async () => {
    render(<Host />); openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Remove highlight/extract" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.deleteExtract).toHaveBeenCalledExactlyOnceWith("a", "doc");
  });

  it("keeps a failed deletion visible with retry and guards repeated activation", async () => {
    let reject!: (error: Error) => void;
    mocks.deleteExtract.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    render(<Host />); openConfirmation();
    const confirm = screen.getByRole("button", { name: "Remove highlight/extract" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(mocks.deleteExtract).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("offline");
    fireEvent.click(screen.getByRole("button", { name: "Remove highlight/extract" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.deleteExtract).toHaveBeenCalledTimes(2);
  });

  it("dismisses a stale confirmation on document switch without deleting", () => {
    const { rerender } = render(<Host />); openConfirmation();
    rerender(<Host documentId="other" />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(mocks.deleteExtract).not.toHaveBeenCalled();
  });

  it("ignores late completion after a reader unmount", async () => {
    let resolve!: () => void;
    mocks.deleteExtract.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    const { unmount } = render(<Host />); openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Remove highlight/extract" }));
    unmount(); await act(async () => resolve());
    expect(mocks.deleteExtract).toHaveBeenCalledTimes(1);
  });

  it("offers an explicit choice when annotations overlap", () => {
    render(<Host initial={{ ...menu, annotations: [...menu.annotations!, { extractId: "b", documentId: "doc", text: "Another overlapping passage" }] }} />);
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /Remove highlight/ }));
    fireEvent.click(screen.getByText("2. Another overlapping passage"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Another overlapping passage");
    expect(mocks.deleteExtract).not.toHaveBeenCalled();
  });
});
