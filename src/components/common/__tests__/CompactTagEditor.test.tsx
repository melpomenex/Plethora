import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "../../../test/utils";

const mocks = vi.hoisted(() => ({
  persistItemTags: vi.fn(),
  publishItemTagsUpdated: vi.fn(),
}));

vi.mock("../../../lib/tagEditing/mutationAdapter", () => ({
  persistItemTags: mocks.persistItemTags,
}));
vi.mock("../../../lib/tagEditing/itemTagEvents", () => ({
  publishItemTagsUpdated: mocks.publishItemTagsUpdated,
  subscribeItemTagsUpdated: () => () => {},
}));
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (vars) {
        return key.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k]));
      }
      return key;
    },
    locale: "en",
  }),
}));
vi.mock("../Toast", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), promise: vi.fn() }),
}));

import { CompactTagEditor } from "../CompactTagEditor";
import type { ItemTagTarget } from "../../../lib/tagEditing/types";

function target(overrides: Partial<ItemTagTarget> = {}): ItemTagTarget {
  return { type: "learning-item", id: "li-1", tags: ["one", "two", "three", "four"], ...overrides };
}

describe("CompactTagEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previews chips and opens the shared editor in a popover", () => {
    render(<CompactTagEditor target={target()} />);
    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("tagEditor.editTags"));
    // Popover now contains the full editor with an add input.
    expect(screen.getByPlaceholderText("itemDetails.addTagPlaceholder")).toBeTruthy();
  });

  it("adds a tag from the popover and reconciles the persisted list", async () => {
    mocks.persistItemTags.mockResolvedValue(["one", "two", "three", "four", "five"]);
    render(<CompactTagEditor target={target()} onTagsPersisted={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("tagEditor.editTags"));

    const input = screen.getByPlaceholderText("itemDetails.addTagPlaceholder");
    fireEvent.change(input, { target: { value: "five" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.persistItemTags).toHaveBeenCalledWith(
        { type: "learning-item", id: "li-1", tags: ["one", "two", "three", "four"] },
        ["one", "two", "three", "four", "five"]
      )
    );
  });

  it("closes with Escape and returns focus to the trigger", () => {
    render(<CompactTagEditor target={target()} />);
    const trigger = screen.getByLabelText("tagEditor.editTags");
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByPlaceholderText("itemDetails.addTagPlaceholder")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText("itemDetails.addTagPlaceholder")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not remove a tag when the chip body or trigger is activated", () => {
    render(<CompactTagEditor target={target()} />);
    fireEvent.click(screen.getByLabelText("tagEditor.editTags"));
    // "one" appears in both the trigger preview and the popover editor; the
    // editor chips are non-removing on body activation.
    const chips = screen.getAllByText("one");
    expect(chips.length).toBeGreaterThan(1);
    fireEvent.click(chips[chips.length - 1]);
    expect(mocks.persistItemTags).not.toHaveBeenCalled();
  });

  it("renders popover container with opaque background, high shadow, and elevated z-index", () => {
    render(<CompactTagEditor target={target()} />);
    fireEvent.click(screen.getByLabelText("tagEditor.editTags"));

    const dialog = screen.getByRole("dialog", { name: "tagEditor.editTagsTitle" });
    expect(dialog.className).toContain("bg-popover");
    expect(dialog.className).toContain("border-border");
    expect(dialog.className).toContain("shadow-xl");
    expect(dialog.className).toContain("z-50");
  });
});
