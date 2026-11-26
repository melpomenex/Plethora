import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContinueReadingTab } from "../ContinueReadingTab";
import { useStartupStore } from "../../../stores/startupStore";
import { useCollectionStore } from "../../../stores/collectionStore";
import { useDocumentStore } from "../../../stores/documentStore";

vi.mock("../../common/Tabs", () => ({
  useIsActiveTab: () => true,
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("ContinueReadingTab startup recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useCollectionStore.setState({ activeCollectionId: "col-1" });
    useDocumentStore.setState({ documents: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries in place when ensureStartup returns null (watchdog timeout) without navigating away", async () => {
    const ensureStartup = vi
      .fn()
      .mockImplementationOnce(async () => {
        useStartupStore.setState({ status: "idle", snapshot: null, error: null });
        return null;
      })
      .mockImplementationOnce(async () => {
        const snapshot = {
          activeCollectionId: "col-1",
          collections: [],
          dueCount: 0,
          documents: { items: [], total: 0 },
          queue: { items: [], total: 0 },
          continueReading: [
            {
              id: "doc-1",
              title: "Recovered Book",
              progress: 42,
              date_modified: 1000,
            },
          ],
        };
        useStartupStore.setState({
          status: "ready",
          snapshot: snapshot as any,
          collectionId: "col-1",
          error: null,
        });
        return snapshot as any;
      });

    useStartupStore.setState({
      status: "idle",
      snapshot: null,
      error: null,
      ensureStartup: ensureStartup as any,
    });

    render(<ContinueReadingTab />);
    expect(screen.getByText("continueReading.loading")).toBeInTheDocument();
    expect(ensureStartup).toHaveBeenCalledTimes(1);

    // Advance past the first 3s retry backoff without switching tabs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });

    expect(ensureStartup).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Recovered Book")).toBeInTheDocument();
    expect(screen.queryByText("continueReading.loading")).not.toBeInTheDocument();
  });
});
