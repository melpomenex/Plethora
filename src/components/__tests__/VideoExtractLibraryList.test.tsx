import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VideoExtractLibraryList } from "../video/VideoExtracts";
import type { VideoExtract } from "../../api/video-extracts";

const mocks = vi.hoisted(() => ({
  membership: vi.fn(async () => ({})),
  remove: vi.fn(async () => undefined),
  rate: vi.fn(async () => null),
  play: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../hooks/useVideoExtracts", () => ({
  useAllVideoExtracts: () => ({
    data: [
      {
        id: "e1", document_id: "v1", collection_id: "c", queue_status: "queued",
        start_time: 0, end_time: 30, title: "Segment one", tags: [],
        next_review_date: "2026-01-01T00:00:00Z", review_count: 0, reps: 0,
        date_created: "2026-01-01T00:00:00Z", date_modified: "2026-01-01T00:00:00Z",
      },
      {
        id: "e2", document_id: "v2", collection_id: "c", queue_status: "not_queued",
        start_time: 10, end_time: 40, title: "Segment two", tags: [],
        review_count: 1, reps: 1,
        date_created: "2026-01-01T00:00:00Z", date_modified: "2026-01-01T00:00:00Z",
      },
    ] as VideoExtract[],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDeleteVideoExtract: () => ({ mutateAsync: mocks.remove, isPending: false }),
  useSetVideoExtractQueueMembership: () => ({ mutateAsync: mocks.membership, isPending: false }),
}));

vi.mock("../../hooks/useVideoExtractReview", () => ({
  useVideoExtractReview: () => ({ rate: mocks.rate, isRating: () => false, retryRating: () => undefined }),
}));

vi.mock("../../stores/documentStore", () => ({
  useDocumentStore: (selector: (state: unknown) => unknown) => selector({
    documents: [
      { id: "v1", title: "Source video", isArchived: false, isDismissed: false },
      { id: "v2", title: "Archived video", isArchived: true, isDismissed: false },
    ],
  }),
}));

vi.mock("../common/Toast", () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error, info: vi.fn() }),
}));

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("VideoExtractLibraryList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("groups by source, labels archived sources, and keeps saved-only extracts visible", () => {
    render(<VideoExtractLibraryList onPlayExtract={mocks.play} />);
    expect(screen.getByText("Source video")).toBeInTheDocument();
    expect(screen.getByText("Archived video")).toBeInTheDocument();
    expect(screen.getByText("(videoExtract.archivedSource)")).toBeInTheDocument();
    expect(screen.getByText("Segment one")).toBeInTheDocument();
    expect(screen.getByText("Segment two")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Segment one"));
    expect(mocks.play).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
  });

  it("toggles queue membership for a live source", async () => {
    render(<VideoExtractLibraryList />);
    fireEvent.click(screen.getAllByRole("button", { name: "videoExtract.removeFromQueue" })[0]);
    expect(mocks.membership).toHaveBeenCalledWith({ extractId: "e1", queued: false });
  });
});
