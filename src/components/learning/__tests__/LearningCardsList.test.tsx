import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningItem } from "../../../api/learning-items";
import { LearningCardsList } from "../LearningCardsList";

const { deleteLearningItemMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  deleteLearningItemMock: vi.fn(async (_id: string, onSuccess?: () => void) => {
    onSuccess?.();
  }),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

const card = {
  id: "card-40",
  item_type: "Flashcard",
  question: "Issue 40 card",
  answer: "Can be deleted",
  difficulty: 5,
  interval: 2,
  ease_factor: 2.5,
  due_date: "2026-07-25T00:00:00.000Z",
  date_created: "2026-07-24T00:00:00.000Z",
  date_modified: "2026-07-24T00:00:00.000Z",
  review_count: 1,
  lapses: 0,
  state: "Review",
  is_suspended: false,
  tags: [],
} as LearningItem;

vi.mock("../../../api/learning-items", () => ({
  getLearningItems: vi.fn(async () => [card]),
  getItemTypeName: vi.fn(() => "Flashcard"),
  getItemStateName: vi.fn(() => "Review"),
  getLearningItemVersions: vi.fn(async () => []),
  getLearningItemPrerequisites: vi.fn(async () => []),
  revertLearningItemVersion: vi.fn(),
  setLearningItemPrerequisites: vi.fn(),
  updateLearningItemContentWithVersion: vi.fn(),
}));

vi.mock("../../../api/undoable", () => ({
  useUndoableOperations: () => ({
    deleteLearningItem: deleteLearningItemMock,
  }),
}));

vi.mock("../../common/VirtualList", () => ({
  DynamicVirtualList: ({
    items,
    renderItem,
  }: {
    items: LearningItem[];
    renderItem: (item: LearningItem) => React.ReactNode;
  }) => <div>{items.map((item) => <div key={item.id}>{renderItem(item)}</div>)}</div>,
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: { count?: number }) =>
      key === "learningCards.cards" ? `Cards (${values?.count ?? 0})` : key,
  }),
}));

vi.mock("../../../utils/ankiLatex", () => ({
  renderAnkiHtmlWithLatex: (value: string) => value,
  warmAnkiLatexNormalization: vi.fn(),
}));

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn(),
}));

describe("LearningCardsList", () => {
  beforeEach(() => {
    deleteLearningItemMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
  });

  it("deletes through the undoable operation without adding a duplicate toast", async () => {
    render(<LearningCardsList documentId="document-40" />);

    expect(await screen.findByText("Issue 40 card")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("learningCards.deleteCard"));

    await waitFor(() => {
      expect(deleteLearningItemMock).toHaveBeenCalledWith("card-40", expect.any(Function));
      expect(screen.queryByText("Issue 40 card")).not.toBeInTheDocument();
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
