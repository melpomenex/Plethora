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

import { ItemTagEditor } from "../ItemTagEditor";
import type { ItemTagTarget } from "../../../lib/tagEditing/types";

function target(overrides: Partial<ItemTagTarget> = {}): ItemTagTarget {
  return { type: "extract", id: "ex-1", tags: ["alpha", "beta"], ...overrides };
}

describe("ItemTagEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders each assigned tag with a labeled remove control", () => {
    render(<ItemTagEditor target={target()} />);
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getAllByLabelText("itemDetails.removeTag")).toHaveLength(2);
  });

  it("adds a new tag optimistically and clears the input", async () => {
    mocks.persistItemTags.mockResolvedValue(["alpha", "beta", "gamma"]);
    render(<ItemTagEditor target={target()} />);
    const input = screen.getByPlaceholderText("itemDetails.addTagPlaceholder");
    fireEvent.change(input, { target: { value: "  gamma  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("gamma")).toBeTruthy());
    expect(mocks.persistItemTags).toHaveBeenCalledWith(
      { type: "extract", id: "ex-1", tags: ["alpha", "beta"] },
      ["alpha", "beta", "gamma"]
    );
    expect(mocks.publishItemTagsUpdated).toHaveBeenCalledWith({
      itemType: "extract",
      id: "ex-1",
      tags: ["alpha", "beta", "gamma"],
    });
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("rejects empty and duplicate input without sending a mutation", () => {
    render(<ItemTagEditor target={target()} />);
    const input = screen.getByPlaceholderText("itemDetails.addTagPlaceholder");

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.persistItemTags).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "ALPHA" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.persistItemTags).not.toHaveBeenCalled();
  });

  it("removes a tag explicitly via its remove control", async () => {
    mocks.persistItemTags.mockResolvedValue(["beta"]);
    render(<ItemTagEditor target={target()} />);
    const removeButtons = screen.getAllByLabelText("itemDetails.removeTag");
    expect(removeButtons).toHaveLength(2);

    fireEvent.click(removeButtons[0]);
    await waitFor(() =>
      expect(mocks.persistItemTags).toHaveBeenCalledWith(
        { type: "extract", id: "ex-1", tags: ["alpha", "beta"] },
        ["beta"]
      )
    );
    await waitFor(() => expect(screen.queryByText("alpha")).toBeNull());
  });

  it("blocks overlapping submissions while a mutation is pending", async () => {
    let resolvePersist: (v: string[]) => void = () => {};
    mocks.persistItemTags.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolvePersist = resolve;
        })
    );
    render(<ItemTagEditor target={target()} />);
    const input = screen.getByPlaceholderText("itemDetails.addTagPlaceholder");

    fireEvent.change(input, { target: { value: "gamma" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "delta" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.persistItemTags).toHaveBeenCalledTimes(1);
    resolvePersist(["alpha", "beta", "gamma"]);
    await waitFor(() => expect(screen.getByText("gamma")).toBeTruthy());
  });

  it("rolls back to the previous tag list when persistence fails", async () => {
    mocks.persistItemTags.mockRejectedValue(new Error("boom"));
    render(<ItemTagEditor target={target()} />);
    const input = screen.getByPlaceholderText("itemDetails.addTagPlaceholder");

    fireEvent.change(input, { target: { value: "gamma" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.queryByText("gamma")).toBeNull());
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(mocks.publishItemTagsUpdated).not.toHaveBeenCalled();
  });

  it("renders read-only chips without any remove or add controls", () => {
    render(<ItemTagEditor target={target()} readOnly />);
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.queryByPlaceholderText("itemDetails.addTagPlaceholder")).toBeNull();
    expect(screen.queryByLabelText("itemDetails.removeTag")).toBeNull();
  });

  it("calls onTagClick when the chip body is activated (never removes)", () => {
    const onTagClick = vi.fn();
    render(<ItemTagEditor target={target()} onTagClick={onTagClick} />);
    fireEvent.click(screen.getByText("alpha"));
    expect(onTagClick).toHaveBeenCalledWith("alpha");
    expect(mocks.persistItemTags).not.toHaveBeenCalled();
  });

  it("handles many tags and long tag text without losing controls", () => {
    const longTag = "aVeryLongTagNameThatCouldOverflowANarrowChip".repeat(2);
    const manyTags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    mocks.persistItemTags.mockResolvedValue(manyTags);
    render(<ItemTagEditor target={target({ tags: [...manyTags, longTag] })} dense />);
    expect(screen.getAllByLabelText("itemDetails.removeTag")).toHaveLength(21);
    expect(screen.getByText(longTag)).toBeTruthy();
    // The add input stays reachable with many chips present.
    expect(screen.getByPlaceholderText("itemDetails.addTagPlaceholder")).toBeTruthy();
  });

  it("rapid repeated identical input only produces one persisted tag", async () => {
    mocks.persistItemTags.mockImplementation(async (_t: ItemTagTarget, next: string[]) => next);
    render(<ItemTagEditor target={target()} />);
    const input = screen.getByPlaceholderText("itemDetails.addTagPlaceholder");
    // Fire several Enter keystrokes before the first mutation resolves.
    for (let i = 0; i < 5; i++) {
      fireEvent.change(input, { target: { value: "gamma" } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    await waitFor(() => expect(screen.getByText("gamma")).toBeTruthy());
    // Serialization: no overlapping mutation is issued, and duplicates after
    // resolution are rejected — exactly one persisted add.
    expect(mocks.persistItemTags.mock.calls.length).toBe(1);
  });

  it("applies high-contrast theme classes to tag chips and input field", () => {
    render(<ItemTagEditor target={target()} />);
    const chip = screen.getByText("alpha").closest(".inline-flex");
    expect(chip?.className).toContain("bg-muted/80");
    expect(chip?.className).toContain("text-foreground");
    expect(chip?.className).toContain("border-border/70");

    const input = screen.getByPlaceholderText("itemDetails.addTagPlaceholder");
    expect(input.className).toContain("bg-background");
    expect(input.className).toContain("text-foreground");
    expect(input.className).toContain("border-border");
  });
});
