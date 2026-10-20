import { beforeEach, describe, expect, it, vi } from "vitest";

const searchLearningItemsBounded = vi.hoisted(() => vi.fn());
const getDueLearningItemsBounded = vi.hoisted(() => vi.fn());
const getAllLearningItems = vi.hoisted(() => vi.fn());

vi.mock("../../../../api/learning-items", () => ({
  searchLearningItemsBounded,
  getDueLearningItemsBounded,
  getAllLearningItems,
  getDueItems: vi.fn(),
}));
vi.mock("../../../../api/extracts", () => ({ getExtracts: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../../api/algorithm", () => ({
  getReviewStatistics: vi.fn().mockResolvedValue({
    total_items: 0,
    total_reviews: 0,
    total_lapses: 0,
    avg_interval: 0,
    retention_estimate: 0,
    due_today: 0,
    due_week: 0,
    due_month: 0,
  }),
}));
vi.mock("../../../../api/ai-learning", () => ({ retrieveFromLibrary: vi.fn() }));
vi.mock("../../../../api/image-registry", () => ({ getImageAssetById: vi.fn() }));

import { createDefaultAgentEnvironment } from "../sessionContext";

beforeEach(() => {
  vi.clearAllMocks();
  searchLearningItemsBounded.mockResolvedValue([]);
  getDueLearningItemsBounded.mockResolvedValue([]);
});

describe("production default agent environment is bounded", () => {
  it("never calls getAllLearningItems for card reads", async () => {
    const env = createDefaultAgentEnvironment();
    await env.getCards({ text: "entropy", documentIds: ["paper-a"], limit: 10 });
    expect(getAllLearningItems).not.toHaveBeenCalled();
    expect(searchLearningItemsBounded).toHaveBeenCalledWith({
      query: "entropy",
      documentIds: ["paper-a"],
      limit: 10,
    });
  });

  it("clamps a caller-supplied limit and bounds due reads", async () => {
    const env = createDefaultAgentEnvironment();
    await env.getCards({ limit: 1_000 });
    expect(searchLearningItemsBounded).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 })
    );
    await env.getDueCards(1_000);
    expect(getDueLearningItemsBounded).toHaveBeenCalledWith(50);
  });
});
