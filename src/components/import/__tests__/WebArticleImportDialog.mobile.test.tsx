import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebArticleImportDialog } from "../WebArticleImportDialog";

const mocks = vi.hoisted(() => ({
  importFromUrl: vi.fn(),
  importRawPageFromUrl: vi.fn(),
  loadDocuments: vi.fn(),
  updateDocument: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  useMobileShell: vi.fn(),
  fetchArticleContent: vi.fn(),
}));

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => mocks.useMobileShell(),
}));

vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: () => ({
    importFromUrl: mocks.importFromUrl,
    importRawPageFromUrl: mocks.importRawPageFromUrl,
    loadDocuments: mocks.loadDocuments,
  }),
}));

// Provide getState() on useDocumentStore as well
import { useDocumentStore } from "../../../stores/documentStore";
(useDocumentStore as any).getState = () => ({
  updateDocument: mocks.updateDocument,
});

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: () => ({
    settings: {
      documents: {
        webImportPreserveImages: true,
      },
    },
  }),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: mocks.showSuccess,
    error: mocks.showError,
  }),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
}));

describe("WebArticleImportDialog responsive and mobile layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useMobileShell.mockReturnValue(false);
    mocks.loadDocuments.mockResolvedValue(undefined);
    mocks.updateDocument.mockResolvedValue(undefined);
  });

  it("portals into document.body with opaque modal-content and bg-card classes on desktop", () => {
    mocks.useMobileShell.mockReturnValue(false);
    const onClose = vi.fn();

    render(<WebArticleImportDialog isOpen={true} onClose={onClose} />);

    // The dialog should be rendered directly in document.body via createPortal
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveClass("modal-content");
    expect(dialog).toHaveClass("bg-card");

    // Backdrop should exist
    const backdrop = dialog?.parentElement;
    expect(backdrop).toHaveClass("fixed");
    expect(backdrop).toHaveClass("inset-0");
    expect(backdrop).toHaveClass("backdrop-blur-sm");

    // Desktop layout has side-by-side w-96 options column
    const desktopSidebar = document.body.querySelector(".w-96");
    expect(desktopSidebar).not.toBeNull();
  });

  it("renders full-screen mobile layout with safe area padding and back button", () => {
    mocks.useMobileShell.mockReturnValue(true);
    const onClose = vi.fn();

    render(<WebArticleImportDialog isOpen={true} onClose={onClose} />);

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveClass("h-full");

    const backdrop = dialog?.parentElement;
    expect(backdrop).toHaveClass("pt-[env(safe-area-inset-top)]");
    expect(backdrop).toHaveClass("pb-[env(safe-area-inset-bottom)]");

    // In mobile mode, back button with aria-label 'Back' is present in header
    const backBtn = screen.getByLabelText("Back");
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("adapts layout on mobile when article is fetched, supporting segment switching and sticky import", async () => {
    mocks.useMobileShell.mockReturnValue(true);
    const onClose = vi.fn();

    // Mock fetch for article URL
    const fakeHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Article Title</title>
          <meta name="author" content="Test Author" />
          <meta name="description" content="A description of the article" />
        </head>
        <body>
          <p>Hello world paragraph with lots of words to make reading time meaningful.</p>
        </body>
      </html>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fakeHtml,
    }) as any;

    render(<WebArticleImportDialog isOpen={true} onClose={onClose} />);

    // Enter URL and fetch
    const urlInput = screen.getByPlaceholderText("https://example.com/article");
    fireEvent.change(urlInput, { target: { value: "https://example.com/article" } });

    const fetchBtn = screen.getByRole("button", { name: /fetch/i });
    fireEvent.click(fetchBtn);

    // After fetch completes, preview should be active and segment buttons appear
    await waitFor(() => {
      expect(screen.getByDisplayValue("Test Article Title")).toBeInTheDocument();
    });

    // Check segment toggle buttons
    const previewTabBtn = screen.getByRole("button", { name: /preview/i });
    const settingsTabBtn = screen.getByRole("button", { name: /settings/i });
    expect(previewTabBtn).toBeInTheDocument();
    expect(settingsTabBtn).toBeInTheDocument();

    // Switch to Settings
    fireEvent.click(settingsTabBtn);
    expect(screen.getByPlaceholderText("Add tag...")).toBeInTheDocument();

    // Switch back to Preview
    fireEvent.click(previewTabBtn);
    expect(screen.getByDisplayValue("Test Article Title")).toBeInTheDocument();

    // Sticky import button is visible
    const importBtn = screen.getByRole("button", { name: /import to library/i });
    expect(importBtn).toBeInTheDocument();

    mocks.importFromUrl.mockResolvedValue({
      id: "doc-web-123",
      title: "Test Article Title",
      content: fakeHtml,
    });

    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(mocks.importFromUrl).toHaveBeenCalledWith(
        "https://example.com/article",
        expect.any(Object)
      );
    });
  });

  it("handles PDF URL detection and switcher on mobile", () => {
    mocks.useMobileShell.mockReturnValue(true);
    render(<WebArticleImportDialog isOpen={true} onClose={vi.fn()} />);

    const urlInput = screen.getByPlaceholderText("https://example.com/article");
    fireEvent.change(urlInput, { target: { value: "https://arxiv.org/pdf/2301.00001.pdf" } });

    expect(screen.getByText("PDF Document Detected")).toBeInTheDocument();
  });
});
