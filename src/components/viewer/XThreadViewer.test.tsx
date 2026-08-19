import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Document } from "../../types/document";
import { XThreadErrorState } from "./XThreadErrorState";
import { XThreadViewer } from "./XThreadViewer";

const openTwitterThreadMock = vi.fn();

vi.mock("../../stores", () => ({
  useDocumentStore: (selector: (s: { openTwitterThread: typeof openTwitterThreadMock }) => unknown) =>
    selector({ openTwitterThread: openTwitterThreadMock }),
}));
vi.mock("../../hooks/useMobileShell", () => ({ useMobileShell: () => false }));

const STATUS_URL = "https://x.com/janeresearch/status/1001";

function errorDoc(error: { type?: string; message?: string }): Document {
  return {
    id: "x-thread-1001",
    title: "X Thread",
    filePath: STATUS_URL,
    fileType: "html",
    content: "",
    tags: ["x", "twitter", "thread"],
    category: "X Threads",
    totalPages: 0,
    currentPage: 0,
    dateAdded: "2024-01-01T00:00:00.000Z",
    dateModified: "2024-01-01T00:00:00.000Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 6.0,
    isArchived: false,
    isFavorite: false,
    metadata: { source: STATUS_URL, siteName: "X", xThreadLoading: false, xThreadError: error },
  } as Document;
}

describe("XThreadErrorState — typed copy for backend snake_case errors", () => {
  it("maps thread_unavailable to the threadUnavailable copy with raw text as secondary detail", () => {
    render(
      <XThreadErrorState
        error={{ type: "thread_unavailable", message: "Tweet not found or restricted in GraphQL" }}
        statusUrl={STATUS_URL}
        onRetry={() => undefined}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Typed title + friendly detail, NOT the generic fallback.
    expect(screen.getByText("Unable to load this X thread")).toBeInTheDocument();
    expect(screen.getByText(/private, deleted, or otherwise unavailable/i)).toBeInTheDocument();
    // Raw backend message appears only as secondary detail.
    expect(screen.getByTestId("x-thread-error-detail").textContent).toContain(
      "Tweet not found or restricted in GraphQL"
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open on x/i })).toBeInTheDocument();
  });

  it("maps rate_limited to the rateLimited copy", () => {
    render(<XThreadErrorState error={{ type: "rate_limited", message: "HTTP 429" }} />);
    expect(screen.getByText("Rate limited")).toBeInTheDocument();
    expect(screen.getByText(/too many requests/i)).toBeInTheDocument();
    expect(screen.getByText("HTTP 429")).toBeInTheDocument();
  });

  it("maps thread_reader_unavailable to its copy", () => {
    render(
      <XThreadErrorState
        error={{ type: "thread_reader_unavailable", message: "TRA 500" }}
        statusUrl={STATUS_URL}
      />
    );
    expect(screen.getByText("Thread could not be retrieved")).toBeInTheDocument();
    expect(screen.getByText(/ThreadReaderApp could not unroll/i)).toBeInTheDocument();
  });

  it("maps network_error to its copy", () => {
    render(<XThreadErrorState error={{ type: "network_error", message: "timed out" }} />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByText(/could not reach the thread service/i)).toBeInTheDocument();
  });

  it("maps auth to the credentials copy", () => {
    render(
      <XThreadErrorState
        error={{ type: "auth", message: "Guest token request failed: HTTP 403" }}
        statusUrl={STATUS_URL}
      />
    );
    expect(screen.getByText("X API credentials unavailable")).toBeInTheDocument();
    expect(screen.getByText(/rejected anonymous access/i)).toBeInTheDocument();
  });

  it("maps invalid_url to its copy and hides Open-on-X (no usable status URL)", () => {
    render(
      <XThreadErrorState
        error={{ type: "invalid_url", message: "Could not find a tweet id in the URL" }}
        statusUrl="not-a-url"
      />
    );
    expect(screen.getByText("Invalid X link")).toBeInTheDocument();
    expect(screen.getByText(/doesn't look like a valid X status link/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open on x/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy status url/i })).not.toBeInTheDocument();
  });

  it("falls back to generic copy for unknown types (message as detail)", () => {
    render(<XThreadErrorState error={new Error("something exploded")} />);
    expect(screen.getByText("Unable to load this X thread")).toBeInTheDocument();
    expect(screen.getByText("something exploded")).toBeInTheDocument();
  });
});

describe("XThreadViewer — native error state wiring", () => {
  it("renders the typed error state when the thread fetch failed", () => {
    render(
      <XThreadViewer
        document={errorDoc({ type: "thread_unavailable", message: "Tweet not found or restricted in GraphQL" })}
      />
    );
    expect(screen.getByTestId("x-thread-error")).toBeInTheDocument();
    expect(screen.getByText("Unable to load this X thread")).toBeInTheDocument();
  });

  it("Retry re-invokes openTwitterThread with the original URL", async () => {
    const user = userEvent.setup();
    openTwitterThreadMock.mockReset();
    render(
      <XThreadViewer
        document={errorDoc({ type: "rate_limited", message: "HTTP 429" })}
      />
    );
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(openTwitterThreadMock).toHaveBeenCalledWith(STATUS_URL);
  });

  it("does not render the generic 'Thread could not be loaded' state when typed", () => {
    render(
      <XThreadViewer
        document={errorDoc({ type: "network_error", message: "connect timed out" })}
      />
    );
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });
});
