/**
 * Browser/PWA parity for the bounded agent reads and retry-safe acceptance
 * keys added for the Learning Agent.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../database", () => ({
  getAllLearningItems: vi.fn(),
  getDueLearningItems: vi.fn(),
  getAllExtracts: vi.fn(),
  createLearningItem: vi.fn(),
  createLearningItemRaw: vi.fn(),
  bulkPutLearningItems: vi.fn(),
  getDocument: vi.fn(async () => null),
  updateDocument: vi.fn(),
}));

import { browserInvoke } from "../browser-backend";
import * as db from "../database";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "card-1",
    document_id: "doc-a",
    item_type: "flashcard",
    question: "What is entropy?",
    answer: "A measure of disorder.",
    cloze_text: null,
    date_modified: "2026-01-01T00:00:00Z",
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("browser agent bounded reads", () => {
  it("filters search by query, document scope and limit", async () => {
    vi.mocked(db.getAllLearningItems).mockResolvedValue([
      item({ id: "a", document_id: "doc-a", question: "Entropy?" }),
      item({ id: "b", document_id: "doc-b", question: "Entropy in physics?" }),
      item({ id: "c", document_id: "doc-a", question: "Unrelated" }),
    ]);
    const rows = await browserInvoke<Array<{ id: string }>>("search_learning_items_bounded", {
      query: "entropy",
      documentIds: ["doc-a"],
      limit: 5,
    });
    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("bounds due items", async () => {
    vi.mocked(db.getDueLearningItems).mockResolvedValue([
      item({ id: "a" }),
      item({ id: "b" }),
      item({ id: "c" }),
    ]);
    const rows = await browserInvoke<Array<{ id: string }>>("get_due_learning_items_bounded", {
      limit: 2,
    });
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("sorts and scopes recent extracts", async () => {
    vi.mocked(db.getAllExtracts).mockResolvedValue([
      item({ id: "old", document_id: "doc-a", date_modified: "2026-01-01" }),
      item({ id: "new", document_id: "doc-a", date_modified: "2026-02-01" }),
      item({ id: "other", document_id: "doc-b", date_modified: "2026-03-01" }),
    ] as never);
    const rows = await browserInvoke<Array<{ id: string }>>("get_recent_extracts_bounded", {
      documentIds: ["doc-a"],
      limit: 5,
    });
    expect(rows.map((row) => row.id)).toEqual(["new", "old"]);
  });

  it("finds committed rows by acceptance key", async () => {
    vi.mocked(db.getAllLearningItems).mockResolvedValue([
      item({ id: "a", acceptance_id: "run-1", proposal_id: "p1" }),
      item({ id: "b", acceptance_id: "run-1", proposal_id: "p2" }),
    ]);
    const rows = await browserInvoke<Array<{ id: string }>>(
      "get_learning_items_by_acceptance_key",
      { acceptanceId: "run-1" }
    );
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("browser retry-safe acceptance", () => {
  it("returns the committed row for a repeated single acceptance pair", async () => {
    vi.mocked(db.getAllLearningItems).mockResolvedValue([
      item({ id: "existing", acceptance_id: "run-1", proposal_id: "p1" }),
    ]);
    const row = await browserInvoke<{ id: string }>("create_learning_item", {
      itemType: "flashcard",
      question: "What is entropy?",
      answer: "Disorder.",
      acceptanceId: "run-1",
      proposalId: "p1",
    });
    expect(row.id).toBe("existing");
    expect(db.createLearningItem).not.toHaveBeenCalled();
  });

  it("reuses committed rows and writes only new rows in a batch", async () => {
    vi.mocked(db.getAllLearningItems).mockResolvedValue([
      item({ id: "existing", acceptance_id: "run-1", proposal_id: "p1" }),
    ]);
    vi.mocked(db.createLearningItemRaw).mockImplementation(((input: Record<string, unknown>) =>
      item({
        id: "new",
        acceptance_id: input.acceptance_id,
        proposal_id: input.proposal_id,
      })) as never);
    const rows = await browserInvoke<Array<{ id: string }>>("create_learning_items_batch", {
      items: [
        {
          itemType: "flashcard",
          question: "What is entropy?",
          answer: "Disorder.",
          acceptanceId: "run-1",
          proposalId: "p1",
        },
        {
          itemType: "flashcard",
          question: "What is enthalpy?",
          answer: "Heat content.",
          acceptanceId: "run-1",
          proposalId: "p2",
        },
      ],
    });
    expect(rows.map((row) => row.id)).toEqual(["existing", "new"]);
    expect(db.bulkPutLearningItems).toHaveBeenCalledOnce();
    const written = vi.mocked(db.bulkPutLearningItems).mock.calls[0][0] as Array<{
      id: string;
    }>;
    expect(written.map((row) => row.id)).toEqual(["new"]);
  });
});
