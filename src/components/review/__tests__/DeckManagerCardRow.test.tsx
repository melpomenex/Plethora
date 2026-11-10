import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeckManagerCardRow } from "../DeckManagerCardRow";
import type { LearningItem } from "../../../api/learning-items";

const mocks = vi.hoisted(() => ({
  persistItemTags: vi.fn(),
}));

vi.mock("../../../lib/tagEditing/mutationAdapter", () => ({
  persistItemTags: mocks.persistItemTags,
}));

vi.mock("../../../lib/tagEditing/itemTagEvents", () => ({
  publishItemTagsUpdated: vi.fn(),
  subscribeItemTagsUpdated: () => () => {},
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (key === "tagEditor.editTags") return `Edit tags (${vars?.count ?? 0})`;
      return key;
    },
    locale: "en",
  }),
}));

function makeCard(overrides: Partial<LearningItem> = {}): LearningItem {
  return {
    id: "card-123",
    item_type: "Basic",
    question: "Test question",
    answer: "Test answer",
    state: "Review",
    due_date: new Date().toISOString(),
    difficulty: 3,
    interval: 5,
    ease_factor: 2.5,
    date_created: new Date().toISOString(),
    date_modified: new Date().toISOString(),
    review_count: 3,
    lapses: 0,
    is_suspended: false,
    tags: [],
    ...overrides,
  };
}

describe("DeckManagerCardRow tag editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders '+ Tag' control when card has zero tags", () => {
    const card = makeCard({ tags: [] });
    render(
      <DeckManagerCardRow
        card={card}
        isSelected={false}
        isExpanded={false}
        onToggleSelect={vi.fn()}
        onExpand={vi.fn()}
        onSuspend={vi.fn()}
        onUnsuspend={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    );

    expect(screen.getByText("+ Tag")).toBeInTheDocument();
  });

  it("persists tag changes properly and calls onTagsPersisted callback", async () => {
    const card = makeCard({ tags: [] });
    const onTagsPersisted = vi.fn();
    mocks.persistItemTags.mockResolvedValue(["biology"]);

    render(
      <DeckManagerCardRow
        card={card}
        isSelected={false}
        isExpanded={false}
        onToggleSelect={vi.fn()}
        onExpand={vi.fn()}
        onSuspend={vi.fn()}
        onUnsuspend={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onTagsPersisted={onTagsPersisted}
      />
    );

    // Click the "+ Tag" affordance to open CompactTagEditor popover
    fireEvent.click(screen.getByText("+ Tag"));

    const input = screen.getByPlaceholderText("itemDetails.addTagPlaceholder");
    fireEvent.change(input, { target: { value: "biology" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mocks.persistItemTags).toHaveBeenCalledWith(
        { type: "learning-item", id: "card-123", tags: [] },
        ["biology"]
      );
      expect(onTagsPersisted).toHaveBeenCalledWith(["biology"]);
    });

    // The tag is added and shown
    expect(screen.getAllByText("biology").length).toBeGreaterThanOrEqual(1);
  });
});
