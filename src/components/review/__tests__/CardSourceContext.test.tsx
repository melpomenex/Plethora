/**
 * Tests for the review-card source strip (`CardSourceContext`):
 * hidden when no source resolves, activatable with proper button semantics
 * when one does, degraded outcomes surfaced inline/toast, and source excerpts
 * always rendered as inert text (never trusted HTML).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getCardSourceContextMock = vi.fn();
const getLearningItemMock = vi.fn();
const openCardSourceMock = vi.fn();
const toastMock = { info: vi.fn(), error: vi.fn(), success: vi.fn() };
const addTabMock = vi.fn(() => "tab-1");

vi.mock("../../../api/review", () => ({
  getCardSourceContext: (...args: unknown[]) => getCardSourceContextMock(...args),
}));

vi.mock("../../../api/learning-items", () => ({
  getLearningItem: (...args: unknown[]) => getLearningItemMock(...args),
}));

vi.mock("../../../utils/cardSourceNavigation", () => ({
  openCardSource: (...args: unknown[]) => openCardSourceMock(...args),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { learning: { showSourceContext: true } } }),
}));

vi.mock("../../../stores/tabsStore", () => ({
  useTabsStore: { getState: () => ({ addTab: addTabMock }) },
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => toastMock,
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { CardSourceContext } from "../CardSourceContext";

const sourceContext = {
  document_id: "doc-1",
  document_title: "Memory Systems",
  extract_id: "ext-1",
  extract_snippet: "The hippocampus helps <em>stabilize</em> memories",
  page_number: 4,
  source_url: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CardSourceContext", () => {
  it("renders nothing when no source resolves", async () => {
    getCardSourceContextMock.mockResolvedValue(null);
    const { container } = render(<CardSourceContext itemId="item-1" />);
    await waitFor(() => expect(getCardSourceContextMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("exposes a view-source button named after the document", async () => {
    getCardSourceContextMock.mockResolvedValue(sourceContext);
    render(<CardSourceContext itemId="item-1" />);
    const button = await screen.findByRole("button", { name: /viewSource: Memory Systems/ });
    expect(button).toBeTruthy();
  });

  it("navigates through openCardSource with reviewReturn on activation", async () => {
    getCardSourceContextMock.mockResolvedValue(sourceContext);
    getLearningItemMock.mockResolvedValue({ id: "item-1", extract_id: "ext-1" });
    openCardSourceMock.mockResolvedValue({ status: "ready", confidence: "exact" });

    render(<CardSourceContext itemId="item-1" />);
    const button = await screen.findByRole("button", { name: /viewSource/ });
    fireEvent.click(button);

    await waitFor(() => expect(openCardSourceMock).toHaveBeenCalled());
    const [probe, , options] = openCardSourceMock.mock.calls[0];
    expect(probe).toMatchObject({ id: "item-1", extract_id: "ext-1" });
    expect(options).toMatchObject({ reviewReturn: true });
    expect(addTabMock).not.toHaveBeenCalled();
  });

  it("announces degraded outcomes via toast", async () => {
    getCardSourceContextMock.mockResolvedValue(sourceContext);
    getLearningItemMock.mockResolvedValue({ id: "item-1", extract_id: "ext-1" });
    openCardSourceMock.mockResolvedValue({ status: "coarse", reason: "stale" });

    render(<CardSourceContext itemId="item-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /viewSource/ }));

    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("review.source.notLocated"));
  });

  it("shows the unavailable panel with the excerpt when the source is gone", async () => {
    getCardSourceContextMock.mockResolvedValue(sourceContext);
    getLearningItemMock.mockResolvedValue({ id: "item-1", extract_id: "ext-1" });
    openCardSourceMock.mockResolvedValue({ status: "unavailable", reason: "document-missing" });

    render(<CardSourceContext itemId="item-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /viewSource/ }));

    const panel = await screen.findByRole("status");
    expect(panel.textContent).toContain("review.source.unavailable");
    // The stored excerpt remains visible inside the unavailable panel...
    expect(panel.textContent).toContain("stabilize");
    // ...as inert text: no <em> element is ever created from it.
    expect(panel.querySelector("em")).toBeNull();
  });

  it("renders the excerpt snippet as text, never as HTML", async () => {
    getCardSourceContextMock.mockResolvedValue(sourceContext);
    render(<CardSourceContext itemId="item-1" />);
    const toggle = await screen.findByRole("button", { expanded: false });
    fireEvent.click(toggle);
    const expanded = await screen.findByRole("button", { expanded: true });
    void expanded;
    expect(screenByText("<em>")).toBeTruthy();
    expect(document.querySelector("em")).toBeNull();
  });

  function screenByText(text: string): HTMLElement | null {
    return Array.from(document.querySelectorAll("div")).find((node) =>
      node.textContent?.includes(text)
    ) as HTMLElement | null;
  }
});
