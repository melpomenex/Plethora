import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "../../../test/utils";
import { BrowserCaptureShelf, type BrowserCaptureShelfProps } from "../BrowserCaptureShelf";
import { CaptureActivityCard } from "../CaptureActivityCard";
import type { BrowserCaptureDocument } from "../../../api/capture-activity";

const document: BrowserCaptureDocument = { documentId: "saved", title: "A saved article", fileType: "html", sourceUrl: "https://www.example.org/article", dateAdded: "2025-01-01T10:00:00Z", coverImageUrl: "https://example.org/cover.jpg", coverImageSource: "web" };
const props = (overrides: Partial<BrowserCaptureShelfProps> = {}): BrowserCaptureShelfProps => ({ data: { items: [document], totalCount: 1, limit: 6, offset: 0 }, isLoading: false, error: null, onRetry: vi.fn(), onOpen: vi.fn(), onOpenOriginal: vi.fn(), onViewAll: vi.fn(), ...overrides });

describe("browser-save shelf", () => {
  it("keeps initial failures recoverable and bounds a ready shelf to six previews", () => {
    const callbacks = props({ data: null, error: "offline" });
    const { rerender, container } = render(<BrowserCaptureShelf {...callbacks} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
    rerender(<BrowserCaptureShelf {...props({ data: null, isLoading: true })} />);
    expect(container.querySelectorAll(".capture-shelf-skeleton")).toHaveLength(6);
    rerender(<BrowserCaptureShelf {...props({ data: { items: Array.from({ length: 7 }, (_, index) => ({ ...document, documentId: String(index) })), totalCount: 7, limit: 7, offset: 0 } })} />);
    expect(container.querySelectorAll(".capture-document-tile")).toHaveLength(6);
  });
  it("keeps primary and original navigation separate and renders a failed-image fallback", () => {
    const callbacks = props();
    const { container } = render(<BrowserCaptureShelf {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Open A saved article in Plethora" }));
    expect(callbacks.onOpen).toHaveBeenCalledWith(document);
    fireEvent.click(screen.getByRole("button", { name: "Open original page for A saved article" }));
    expect(callbacks.onOpenOriginal).toHaveBeenCalledWith(document);
    expect(callbacks.onOpen).toHaveBeenCalledTimes(1);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".capture-document-fallback")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open A saved article in Plethora" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View all browser saves" }));
    expect(callbacks.onViewAll).toHaveBeenCalledOnce();
  });

  it("retains the same focused preview during refresh and a refresh failure", () => {
    const callbacks = props();
    const { rerender } = render(<BrowserCaptureShelf {...callbacks} />);
    const button = screen.getByRole("button", { name: "Open A saved article in Plethora" });
    button.focus();
    rerender(<BrowserCaptureShelf {...callbacks} isLoading />);
    expect(globalThis.document.activeElement).toBe(button);
    rerender(<BrowserCaptureShelf {...callbacks} error="offline" />);
    expect(screen.getByRole("button", { name: "Open A saved article in Plethora" })).toBe(button);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
  });

  it("preserves older saves when capture analytics is empty or fails", () => {
    const emptyActivity = { windowDays: 30, perDay: [], bySource: [], needsAttention: 0 };
    const { rerender } = render(<CaptureActivityCard data={emptyActivity} isLoading={false} error={null} onRetry={vi.fn()} onOpenNeedsReview={vi.fn()} browserSaves={props()} />);
    expect(screen.getByText("A saved article")).toBeTruthy();
    rerender(<CaptureActivityCard data={null} isLoading={false} error="analytics failed" onRetry={vi.fn()} onOpenNeedsReview={vi.fn()} browserSaves={props()} />);
    expect(screen.getByText("A saved article")).toBeTruthy();
    expect(screen.getByText(/Couldn't load capture activity/)).toBeTruthy();
  });

  it("explains source-specific emptiness while other source counts remain visible", () => {
    render(<CaptureActivityCard data={{ windowDays: 30, perDay: [{ date: "2026-10-14", count: 5 }], bySource: [{ source: "share-target", count: 5 }], needsAttention: 0 }} isLoading={false} error={null} onRetry={vi.fn()} onOpenNeedsReview={vi.fn()} browserSaves={props({ data: { items: [], totalCount: 0, limit: 6, offset: 0 } })} />);
    expect(screen.getByText("Your browser saves will appear here")).toBeTruthy();
    expect(screen.getByText("Share Target")).toBeTruthy();
  });

  it("shows URL-less PDF, image, audio, and text captures without original-page actions", () => {
    const localCaptures = ["pdf", "image", "audio", "markdown"].map((fileType, index) => ({
      documentId: `local-${index}`, title: `${fileType} capture`, fileType, sourceUrl: null,
      dateAdded: "2026-10-14T10:00:00Z", coverImageUrl: null,
    }));
    const callbacks = props({ source: "share-target", data: { items: localCaptures as any, totalCount: 4, limit: 6, offset: 0 } });
    render(<BrowserCaptureShelf {...callbacks} />);
    for (const capture of localCaptures) {
      expect(screen.getByRole("button", { name: `Open ${capture.title} in Plethora` })).toBeTruthy();
      expect(screen.queryByRole("button", { name: `Open original page for ${capture.title}` })).toBeNull();
    }
    expect(screen.getByText("Recently shared to Plethora")).toBeTruthy();
  });

  it("uses share guidance for the empty activity summary on native surfaces", () => {
    const shareShelf = props({ source: "share-target", data: { items: [], totalCount: 0, limit: 6, offset: 0 } });
    render(<CaptureActivityCard data={{ windowDays: 30, perDay: [], bySource: [], needsAttention: 0 }} isLoading={false} error={null} onRetry={vi.fn()} onOpenNeedsReview={vi.fn()} captureShelf={shareShelf} />);
    expect(screen.getAllByText("Use Share in another app and choose Plethora to save a link, file, or text.")).toHaveLength(2);
    expect(screen.queryByText(/browser extension/i)).toBeNull();
  });
});
