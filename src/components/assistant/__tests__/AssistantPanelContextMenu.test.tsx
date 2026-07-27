import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import * as extractsApi from "../../../api/extracts";
import * as integrationsApi from "../../../api/integrations";

vi.mock("../../../api/extracts", () => ({
  createExtract: vi.fn().mockResolvedValue({ id: "ext-1" }),
}));

vi.mock("../../../api/integrations", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  generateSingleMessageMarkdown: vi.fn().mockReturnValue("Formatted Markdown"),
}));

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    isNativeMobile: () => false,
    invokeCommand: vi.fn().mockResolvedValue([]),
  };
});

describe("AssistantPanel Context Menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollTo = vi.fn();
  });

  it("opens context menu on right click in Assistant panel", async () => {
    const { container } = render(<AssistantPanel />);
    const panel = container.firstChild as HTMLElement;
    expect(panel).toBeTruthy();

    fireEvent.contextMenu(panel, { clientX: 100, clientY: 200 });

    await waitFor(() => {
      expect(screen.getByText("Copy Entire Chat")).toBeTruthy();
      expect(screen.getByText("Clear Chat History")).toBeTruthy();
    });
  });

  it("handles selected text extraction via context menu", async () => {
    const { container } = render(<AssistantPanel />);
    const panel = container.firstChild as HTMLElement;

    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "Selected text from assistant response",
    } as Selection);

    fireEvent.contextMenu(panel, { clientX: 150, clientY: 250 });

    await waitFor(() => {
      expect(screen.getByText("Extract Selection")).toBeTruthy();
      expect(screen.getByText("Ask about Selection")).toBeTruthy();
    });

    const extractBtn = screen.getByText("Extract Selection");
    fireEvent.click(extractBtn);

    expect(extractsApi.createExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Selected text from assistant response",
        note: "Extracted from Assistant",
      })
    );
  });
});
