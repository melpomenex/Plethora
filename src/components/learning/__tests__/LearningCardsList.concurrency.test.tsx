import { render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLearningItems: vi.fn(),
  getLearningItemPrerequisites: vi.fn(),
  warmAnkiLatexNormalization: vi.fn(),
}));

vi.mock("../../../api/learning-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/learning-items")>();
  return {
    ...actual,
    getLearningItems: mocks.getLearningItems,
    getLearningItemPrerequisites: mocks.getLearningItemPrerequisites,
    warmAnkiLatexNormalization: mocks.warmAnkiLatexNormalization,
  };
});
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import { LearningCardsList } from "../LearningCardsList";

describe("LearningCardsList concurrency (Tasks 5.4, 6.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLearningItemPrerequisites.mockResolvedValue([]);
  });

  it("discards superseded responses during rapid documentId switching", async () => {
    let resolveDocA: ((val: unknown) => void) | undefined;
    let resolveDocB: ((val: unknown) => void) | undefined;

    mocks.getLearningItems.mockImplementation((docId: string) => {
      if (docId === "doc-A") {
        return new Promise((resolve) => {
          resolveDocA = resolve;
        });
      }
      if (docId === "doc-B") {
        return new Promise((resolve) => {
          resolveDocB = resolve;
        });
      }
      return Promise.resolve([]);
    });

    const { rerender } = render(<LearningCardsList documentId="doc-A" />);

    // Quickly switch to document B before document A resolves
    rerender(<LearningCardsList documentId="doc-B" />);

    // Resolve doc B first
    await act(async () => {
      resolveDocB?.([
        {
          id: "card-b",
          document_id: "doc-B",
          question: "Question for Doc B",
          answer: "Answer for Doc B",
          item_type: "basic",
          tags: [],
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText("Question for Doc B")).toBeInTheDocument();
    });

    // Late resolution for superseded doc A
    await act(async () => {
      resolveDocA?.([
        {
          id: "card-a",
          document_id: "doc-A",
          question: "Stale Question for Doc A",
          answer: "Stale Answer for Doc A",
          item_type: "basic",
          tags: [],
        },
      ]);
    });

    // Verify stale doc A card is NOT rendered
    await waitFor(() => {
      expect(screen.queryByText("Stale Question for Doc A")).toBeNull();
      expect(screen.getByText("Question for Doc B")).toBeInTheDocument();
    });
  });
});
