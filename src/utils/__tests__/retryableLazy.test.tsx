import type { ComponentType } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabContent } from "../../components/common/Tabs/TabContent";
import type { Tab } from "../../stores";
import { createRetryableLazy } from "../retryableLazy";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeTab(id: string, title: string, content: Tab["content"]): Tab {
  return {
    id,
    title,
    icon: null,
    type: "learning-insights",
    content,
    closable: true,
  };
}

describe("createRetryableLazy + TabContent first-visit loading", () => {
  it("renders synchronously without showing Loading... when preload() already resolved", async () => {
    const loader = vi.fn(async () => ({
      default: () => <div>Learning Insights ready</div>,
    }));
    const LazyView = createRetryableLazy("LearningInsightsTab", loader);

    await LazyView.preload();
    expect(loader).toHaveBeenCalledTimes(1);

    const dashboard = makeTab("dash", "Dashboard", () => <div>Dashboard</div>);
    const insights = makeTab("insights", "Learning Insights", LazyView);

    const { rerender } = render(
      <TabContent tabs={[dashboard, insights]} activeTabId="dash" />
    );

    rerender(<TabContent tabs={[dashboard, insights]} activeTabId="insights" />);

    expect(screen.getByText("Learning Insights ready")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    // Preloaded cache was reused; no second import was issued.
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("shares an in-flight preload() promise with the first visit and resolves in place", async () => {
    const chunk = deferred<{ default: ComponentType }>();
    const loader = vi.fn(() => chunk.promise);
    const LazyView = createRetryableLazy("LearningInsightsTab", loader, {
      timeoutMs: 5_000,
      retries: 0,
    });

    const preloadPromise = LazyView.preload();
    expect(loader).toHaveBeenCalledTimes(1);

    const dashboard = makeTab("dash", "Dashboard", () => <div>Dashboard</div>);
    const insights = makeTab("insights", "Learning Insights", LazyView);

    const { rerender } = render(
      <TabContent tabs={[dashboard, insights]} activeTabId="dash" />
    );

    // User opens the tab before preload settles.
    rerender(<TabContent tabs={[dashboard, insights]} activeTabId="insights" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(1);

    await act(async () => {
      chunk.resolve({ default: () => <div>Insights loaded</div> });
      await preloadPromise;
    });

    expect(await screen.findByText("Insights loaded")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("recovers on first visit even if an earlier preload() failed", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldFail = true;
    const loader = vi.fn(async () => {
      if (shouldFail) throw new Error("cold preload failed");
      return { default: () => <div>Recovered view</div> };
    });
    const LazyView = createRetryableLazy("PodcastTab", loader, {
      timeoutMs: 500,
      retries: 0,
    });

    await LazyView.preload();
    expect(loader).toHaveBeenCalledTimes(1);

    shouldFail = false;
    const tab = makeTab("podcast", "Podcasts", LazyView);
    render(<TabContent tabs={[tab]} activeTabId="podcast" />);

    expect(await screen.findByText("Recovered view")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("renders cleanly if the user switches away while loading and switches back after resolve", async () => {
    const chunk = deferred<{ default: ComponentType }>();
    const LazyView = createRetryableLazy("ExtractsTab", () => chunk.promise, {
      timeoutMs: 5_000,
      retries: 0,
    });

    const dashboard = makeTab("dash", "Dashboard", () => <div>Dashboard</div>);
    const extracts = makeTab("extracts", "Extracts", LazyView);

    const { rerender } = render(
      <TabContent tabs={[dashboard, extracts]} activeTabId="extracts" />
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // User backs out to Dashboard before the chunk settles.
    rerender(<TabContent tabs={[dashboard, extracts]} activeTabId="dash" />);
    expect(screen.getByText("Dashboard")).toBeVisible();

    // Chunk settles while user is on another view.
    await act(async () => {
      chunk.resolve({ default: () => <div>Extracts loaded</div> });
    });

    // Returning to the tab shows it immediately without spinning.
    rerender(<TabContent tabs={[dashboard, extracts]} activeTabId="extracts" />);
    expect(screen.getByText("Extracts loaded")).toBeVisible();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("recovers in place when Retry is clicked after all importWithRetry attempts fail", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldFail = true;
    const loader = vi.fn(async () => {
      if (shouldFail) throw new Error("network stalled");
      return { default: () => <div>Loaded after retry</div> };
    });
    const LazyView = createRetryableLazy("AnalyticsTab", loader, {
      timeoutMs: 500,
      retries: 1,
    });

    const tab = makeTab("analytics", "Statistics", LazyView);
    render(<TabContent tabs={[tab]} activeTabId="analytics" />);

    expect(await screen.findByText(/network stalled/i)).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);

    shouldFail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(await screen.findByText("Loaded after retry")).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(3);
    consoleError.mockRestore();
  });
});
