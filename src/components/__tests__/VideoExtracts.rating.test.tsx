import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DueVideoExtractsReview, VideoExtractsList } from "../video/VideoExtracts";
import { useSettingsStore } from "../../stores/settingsStore";
import type { VideoExtract, VideoExtractReviewResult } from "../../api/video-extracts";

const mocks = vi.hoisted(() => ({
  getVideoExtracts: vi.fn(),
  rateVideoExtract: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("../../api/video-extracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/video-extracts")>()),
  getVideoExtracts: mocks.getVideoExtracts,
  rateVideoExtract: mocks.rateVideoExtract,
}));

vi.mock("../common/Toast", () => {
  const toast = { error: mocks.error, success: mocks.success };
  return { useToast: () => toast };
});

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function extract(id: string): VideoExtract {
  return {
    id,
    document_id: "video-1",
    start_time: 0,
    end_time: 30,
    title: `Extract ${id}`,
    tags: [],
    next_review_date: "2020-01-01T00:00:00Z",
    review_count: 0,
    reps: 0,
    date_created: "2020-01-01T00:00:00Z",
    date_modified: "2020-01-01T00:00:00Z",
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
    mocks.getVideoExtracts.mockResolvedValue([extract("one"), extract("two")]);
  });

  it("submits one rating, blocks repeat activation while pending, and advances once", async () => {
    let resolveRating!: (value: VideoExtractReviewResult) => void;
    mocks.rateVideoExtract.mockReturnValue(new Promise<VideoExtractReviewResult>((resolve) => {
      resolveRating = resolve;
    }));
    const onComplete = vi.fn();
    render(<DueVideoExtractsReview documentId="video-1" onComplete={onComplete} />);

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
    render(<DueVideoExtractsReview documentId="video-1" onComplete={onComplete} />);

    await screen.findByText("Extract one");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Save failed"));
    expect(screen.getByText("Extract one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good" })).toBeEnabled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.rateVideoExtract).toHaveBeenCalledTimes(1);
  });

  it("retries a lost response with the same operation and completes the last item once", async () => {
    mocks.getVideoExtracts.mockResolvedValue([extract("retry-one")]);
    mocks.rateVideoExtract.mockRejectedValueOnce(new Error("Connection lost"));
    const onComplete = vi.fn();
    render(<DueVideoExtractsReview documentId="video-1" onComplete={onComplete} />);
    await screen.findByText("Extract retry-one");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Connection lost"));
    const firstOperation = mocks.rateVideoExtract.mock.calls[0][2];
    expect(screen.getByRole("button", { name: "Easy" })).toBeDisabled();
    mocks.rateVideoExtract.mockResolvedValue({ extract: extract("retry-one"), receipt: {} });
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(mocks.rateVideoExtract).toHaveBeenLastCalledWith("retry-one", 3, firstOperation);
    expect(screen.queryByText("Extract retry-one")).not.toBeInTheDocument();
  });

  it("does not advance a different document when a previous rating completes", async () => {
    let resolveRating!: (value: VideoExtractReviewResult) => void;
    mocks.rateVideoExtract.mockReturnValue(new Promise<VideoExtractReviewResult>((resolve) => {
      resolveRating = resolve;
    }));
    mocks.getVideoExtracts.mockImplementation(async (documentId: string) =>
      documentId === "video-1" ? [extract("one")] : [extract("other")],
    );
    const onComplete = vi.fn();
    const { rerender } = render(<DueVideoExtractsReview documentId="video-1" onComplete={onComplete} />);
    await screen.findByText("Extract one");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    rerender(<DueVideoExtractsReview documentId="video-2" onComplete={onComplete} />);
    await screen.findByText("Extract other");
    await act(async () => resolveRating(reviewed("one")));

    expect(screen.getByText("Extract other")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good" })).toBeEnabled();
    expect(onComplete).not.toHaveBeenCalled();
  });
  it("shows independent ordinary-list ratings and reconciles the committed extract", async () => {
    const fresh = { ...extract("ordinary"), next_review_date: undefined };
    mocks.getVideoExtracts.mockResolvedValue([fresh]);
    mocks.rateVideoExtract.mockResolvedValue({
      extract: { ...fresh, review_count: 1, reps: 1 }, receipt: { extract_id: fresh.id, document_id: fresh.document_id },
    });
    render(<VideoExtractsList documentId="video-1" />);
    await screen.findByText("Extract ordinary");
    expect(screen.getByText("videoExtract.statusNew · videoExtract.statusNotReviewed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await screen.findByText("videoExtract.statusReviewed");
    expect(mocks.rateVideoExtract).toHaveBeenCalledTimes(1);
  });

  it("shows Seen without a review, and retains Reviewed for older rows without seen data", async () => {
    mocks.getVideoExtracts.mockResolvedValue([
      { ...extract("seen"), first_seen_at: "2026-10-29T12:00:00Z" },
      { ...extract("legacy-reviewed"), review_count: 3 },
    ]);
    render(<VideoExtractsList documentId="video-1" />);
    await screen.findByText("Extract seen");
    expect(screen.getByText("videoExtract.statusSeen · videoExtract.statusNotReviewed")).toBeInTheDocument();
    expect(screen.getByText("videoExtract.statusReviewed")).toBeInTheDocument();
    expect(mocks.rateVideoExtract).not.toHaveBeenCalled();
  });

  it("does not overwrite a committed rating with a late list snapshot", async () => {
    let resolveList!: (value: VideoExtract[]) => void;
    mocks.getVideoExtracts.mockReturnValue(new Promise<VideoExtract[]>((resolve) => { resolveList = resolve; }));
    render(<VideoExtractsList documentId="video-1" />);
    act(() => { window.dispatchEvent(new CustomEvent('video-extract-reviewed', { detail: reviewed('late-list') })); });
    await act(async () => resolveList([extract('late-list')]));
    await screen.findByText('Extract late-list');
    expect(screen.getByText('videoExtract.statusReviewed')).toBeInTheDocument();
  });

  it("honors a zero new-item budget while retaining scheduled reviewed extracts", async () => {
    const original = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings: { ...original, learning: { ...original.learning, newCardsPerDay: 0 } } });
    try {
      mocks.getVideoExtracts.mockResolvedValue([
        extract('budget-new'), { ...extract('budget-reviewed'), review_count: 1 },
      ]);
      render(<DueVideoExtractsReview documentId="video-1" />);
      await screen.findByText('Extract budget-reviewed');
      expect(screen.queryByText('Extract budget-new')).not.toBeInTheDocument();
    } finally { useSettingsStore.setState({ settings: original }); }
  });

});
