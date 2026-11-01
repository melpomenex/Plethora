import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DueVideoExtractsReview, VideoExtractsList } from "../video/VideoExtracts";
import { useSettingsStore } from "../../stores/settingsStore";
import type { VideoExtract, VideoExtractReviewResult } from "../../api/video-extracts";
import { renderWithProviders } from "../../test/utils";

const mocks = vi.hoisted(() => ({
  getVideoExtracts: vi.fn(),
  getVideoExtractReviewCandidates: vi.fn(),
  rateVideoExtract: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("../../api/video-extracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/video-extracts")>()),
  getVideoExtracts: mocks.getVideoExtracts,
  getVideoExtractReviewCandidates: mocks.getVideoExtractReviewCandidates,
  rateVideoExtract: mocks.rateVideoExtract,
}));

vi.mock("../common/Toast", () => {
  const toast = { error: mocks.error, success: mocks.success, info: vi.fn() };
  return { useToast: () => toast };
});

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function extract(id: string, overrides: Partial<VideoExtract> = {}): VideoExtract {
  return {
    id,
    document_id: "video-1",
    collection_id: "00000000-0000-0000-0000-000000000001",
    queue_status: "queued",
    start_time: 0,
    end_time: 30,
    title: `Extract ${id}`,
    tags: [],
    next_review_date: "2020-01-01T00:00:00Z",
    review_count: 0,
    reps: 0,
    date_created: "2020-01-01T00:00:00Z",
    date_modified: "2020-01-01T00:00:00Z",
    ...overrides,
  };
}

function reviewed(id: string): VideoExtractReviewResult {
  const before = extract(id);
  const after = { ...before, review_count: 1, reps: 1 };
  return { extract: after, receipt: { operation_id: "test-operation", extract_id: id,
    document_id: before.document_id, rating: 3, reviewed_at: "2026-10-29T12:00:00Z", before, after } };
}

describe("DueVideoExtractsReview ratings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVideoExtractReviewCandidates.mockResolvedValue([]);
  });

  it("submits one rating, blocks repeat activation while pending, and advances once", async () => {
    let resolveRating!: (value: VideoExtractReviewResult) => void;
    mocks.rateVideoExtract.mockReturnValue(new Promise<VideoExtractReviewResult>((resolve) => {
      resolveRating = resolve;
    }));
    const onComplete = vi.fn();
    renderWithProviders(
      <DueVideoExtractsReview extracts={[extract("one"), extract("two")]} onComplete={onComplete} />,
    );

    await screen.findByText("Extract one");
    const good = screen.getByRole("button", { name: "Good" });
    fireEvent.click(good);
    fireEvent.click(good);
    expect(good).toBeDisabled();
    expect(mocks.rateVideoExtract).toHaveBeenCalledTimes(1);
    expect(mocks.rateVideoExtract).toHaveBeenCalledWith("one", 3, expect.any(String));

    await act(async () => resolveRating(reviewed("one")));
    await screen.findByText("Extract two");
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.rateVideoExtract).toHaveBeenCalledTimes(1);
  });

  it("keeps the current extract available when the rating fails", async () => {
    mocks.rateVideoExtract.mockRejectedValue(new Error("Save failed"));
    const onComplete = vi.fn();
    renderWithProviders(<DueVideoExtractsReview extracts={[extract("one")]} onComplete={onComplete} />);

    await screen.findByText("Extract one");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Save failed"));
    expect(screen.getByText("Extract one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good" })).toBeEnabled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.rateVideoExtract).toHaveBeenCalledTimes(1);
  });

  it("retries a lost response with the same operation and completes the last item once", async () => {
    mocks.rateVideoExtract.mockRejectedValueOnce(new Error("Connection lost"));
    const onComplete = vi.fn();
    renderWithProviders(<DueVideoExtractsReview extracts={[extract("retry-one")]} onComplete={onComplete} />);
    await screen.findByText("Extract retry-one");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Connection lost"));
    const firstOperation = mocks.rateVideoExtract.mock.calls[0][2];
    expect(screen.getByRole("button", { name: "Easy" })).toBeDisabled();
    mocks.rateVideoExtract.mockResolvedValue(reviewed("retry-one"));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(mocks.rateVideoExtract).toHaveBeenLastCalledWith("retry-one", 3, firstOperation);
    expect(screen.queryByText("Extract retry-one")).not.toBeInTheDocument();
  });

  it("renders only the candidate extracts supplied to the review session", async () => {
    mocks.getVideoExtracts.mockResolvedValue([
      extract("queued"),
      extract("saved-only", { queue_status: "not_queued", review_count: 0 }),
    ]);
    renderWithProviders(<DueVideoExtractsReview extracts={[extract("queued")]} />);
    await screen.findByText("Extract queued");
    expect(screen.queryByText("Extract saved-only")).not.toBeInTheDocument();
  });

  it("honors the new-item budget while retaining scheduled reviewed extracts", async () => {
    const original = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings: { ...original, learning: { ...original.learning, newCardsPerDay: 0 } } });
    try {
      mocks.getVideoExtractReviewCandidates.mockResolvedValue([
        extract("budget-reviewed", { review_count: 1 }),
      ]);
      mocks.getVideoExtracts.mockResolvedValue([
        extract("budget-reviewed", { review_count: 1 }),
      ]);
      renderWithProviders(<VideoExtractsList documentId="video-1" />);
      await screen.findAllByText("Extract budget-reviewed");
      expect(screen.getByText(/videoExtract.reviewReady/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "videoExtract.reviewNow" }));
      expect(screen.getAllByText("Extract budget-reviewed").length).toBeGreaterThan(0);
    } finally {
      useSettingsStore.setState({ settings: original });
    }
  });
});
