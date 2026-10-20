/**
 * Tests for the review-card source strip (`CardSourceContext`):
 * hidden when no source resolves or source context is disabled, the title area
 * navigates to the originating passage, a separate disclosure reveals the full
 * title/excerpt/link without navigating, degraded outcomes are surfaced
 * inline/toast, and excerpts are always rendered as inert text (never trusted
 * HTML).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getCardSourceContextMock = vi.fn();
const getLearningItemMock = vi.fn();
const openCardSourceMock = vi.fn();
const toastMock = { info: vi.fn(), error: vi.fn(), success: vi.fn() };
const addTabMock = vi.fn(() => "tab-1");
let showSourceContext = true;

vi.mock("../../../api/review", () => ({
  getCardSourceContext: (...args: unknown[]) => getCardSourceContextMock(...args),
}));

vi.mock("../../../api/learning-items", () => ({
  getLearningItem: (...args: unknown[]) => getLearningItemMock(...args),
}));

// Only navigation is stubbed; `sourceOutcomeKey` stays real so this test
// exercises the actual outcome→message mapping rather than a second copy.
vi.mock("../../../utils/cardSourceNavigation", async () => {
  const actual =
    await vi.importActual<typeof import("../../../utils/cardSourceNavigation")>(
      "../../../utils/cardSourceNavigation"
    );
  return {
    ...actual,
    openCardSource: (...args: unknown[]) => openCardSourceMock(...args),
  };
});

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { learning: { showSourceContext } } }),
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

const noSnippetContext = {
  document_id: "doc-2",
  document_title:
    "This Is Your Brain on Music: Understanding a Human Obsession",
  extract_id: "ext-2",
  extract_snippet: undefined,
  page_number: undefined,
  source_url: null as string | null,
};

const linkedContext = {
  ...sourceContext,
  source_url: "https://example.com/memory-systems",
};

beforeEach(() => {
  vi.clearAllMocks();
  showSourceContext = true;
});

describe("CardSourceContext", () => {
  it("renders nothing when no source resolves", async () => {
    getCardSourceContextMock.mockResolvedValue(null);
    const { container } = render(<CardSourceContext itemId="item-1" />);
    await waitFor(() => expect(getCardSourceContextMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when source context is disabled", async () => {
    showSourceContext = false;
    const { container } = render(<CardSourceContext itemId="item-1" />);
    await waitFor(() => expect(getCardSourceContextMock).not.toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("exposes a title control named after the full document", async () => {
    getCardSourceContextMock.mockResolvedValue(sourceContext);
    render(<CardSourceContext itemId="item-1" />);
    const button = await screen.findByRole("button", {
      name: /viewSource: Memory Systems \(p\. 4\)/,
    });
    expect(button).toBeTruthy();
    expect(screen.getByTitle("Memory Systems (p. 4)")).toBe(button);
  });

  it("navigates through openCardSource with reviewReturn on title activation", async () => {
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

  it("uses an onActivate override instead of resolving navigation itself", async () => {
    getCardSourceContextMock.mockResolvedValue(sourceContext);
    const onActivate = vi.fn();

    render(<CardSourceContext itemId="item-1" onActivate={onActivate} />);
    fireEvent.click(await screen.findByRole("button", { name: /viewSource/ }));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith("item-1");
    expect(getLearningItemMock).not.toHaveBeenCalled();
    expect(openCardSourceMock).not.toHaveBeenCalled();
  });

  it("does not start a second default navigation while loading", async () => {
    getCardSourceContextMock.mockResolvedValue(sourceContext);
    let resolveItem: (value: unknown) => void = () => {};
    getLearningItemMock.mockReturnValue(
      new Promise((resolve) => {
        resolveItem = resolve;
      })
    );
    openCardSourceMock.mockResolvedValue({ status: "ready", confidence: "exact" });

    render(<CardSourceContext itemId="item-1" />);
    const button = await screen.findByRole("button", { name: /viewSource/ });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(getLearningItemMock).toHaveBeenCalledTimes(1);

    resolveItem({ id: "item-1", extract_id: "ext-1" });
    await waitFor(() => expect(openCardSourceMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("expands the full title without navigating when there is no excerpt", async () => {
    getCardSourceContextMock.mockResolvedValue(noSnippetContext);

    render(<CardSourceContext itemId="item-1" />);
    const toggle = await screen.findByRole("button", { name: "review.sourceDetails" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", panel!.id);
    expect(panel).not.toHaveAttribute("hidden");
    expect(panel!.textContent).toContain(noSnippetContext.document_title);
    // No snippet was stored, so the panel contains no excerpt placeholder text.
    expect(panel!.textContent).not.toContain("undefined");
    expect(getLearningItemMock).not.toHaveBeenCalled();
    expect(openCardSourceMock).not.toHaveBeenCalled();
  });

  it("reveals the excerpt and independent external link in the details panel", async () => {
    getCardSourceContextMock.mockResolvedValue(linkedContext);

    render(<CardSourceContext itemId="item-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "review.sourceDetails" }));

    const panel = document.getElementById(
      screen
        .getByRole("button", { name: "review.sourceDetailsHide" })
        .getAttribute("aria-controls")!
    );
    expect(panel!.textContent).toContain("stabilize");
    expect(panel!.textContent).toContain(linkedContext.document_title);
    expect(panel!.querySelector("em")).toBeNull();

    const link = screen.getByRole("link", { name: "review.sourceLink" });
    expect(link).toHaveAttribute("href", linkedContext.source_url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.closest("button")).toBeNull();

    fireEvent.click(link);
    expect(getLearningItemMock).not.toHaveBeenCalled();
    expect(openCardSourceMock).not.toHaveBeenCalled();
  });

  it("never nests one interactive control inside another", async () => {
    getCardSourceContextMock.mockResolvedValue(linkedContext);

    render(<CardSourceContext itemId="item-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "review.sourceDetails" }));

    for (const button of screen.getAllByRole("button")) {
      expect(button.querySelector("button, a, input, select, textarea")).toBeNull();
    }
    expect(screen.getByRole("link").closest("button")).toBeNull();
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

    // Unavailable feedback never suppresses the full-title disclosure.
    const toggle = screen.getByRole("button", { name: "review.sourceDetails" });
    fireEvent.click(toggle);
    const details = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(details).not.toHaveAttribute("hidden");
    expect(details!.textContent).toContain(sourceContext.document_title);
    expect(details!.textContent).toContain("stabilize");
  });

  it("renders the excerpt snippet as text, never as HTML", async () => {
    getCardSourceContextMock.mockResolvedValue(sourceContext);
    render(<CardSourceContext itemId="item-1" />);
    const toggle = await screen.findByRole("button", { name: "review.sourceDetails" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "review.sourceDetailsHide" })).toBeTruthy();
    expect(screenByText("<em>")).toBeTruthy();
    expect(document.querySelector("em")).toBeNull();
  });

  function screenByText(text: string): HTMLElement | null {
    return Array.from(document.querySelectorAll("div")).find((node) =>
      node.textContent?.includes(text)
    ) as HTMLElement | null;
  }
});
