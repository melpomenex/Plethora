/**
 * Per-tab suspense and error boundaries.
 *
 * Before this change a single `<Suspense>` wrapped every tab in a pane and
 * there was no error boundary at all, so one tab that had not finished loading
 * hid the whole pane's content, and one tab that threw unmounted the pane. Both
 * boundaries now live inside the per-tab wrapper.
 */
import { useState, type ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TabContent } from "../TabContent";
import type { Tab } from "../../../../stores/tabsStore";

function makeTab(id: string, content: Tab["content"]): Tab {
  return { id, title: id, icon: null, type: "dashboard", content, closable: true };
}

describe("per-tab boundaries", () => {
  beforeEach(() => {
    // React logs the caught render error; the assertions below are about the
    // rendered output, not the noise.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the active tab visible while another mounted tab is still loading", () => {
    // A tab that suspends forever: the chunk never resolves for the duration
    // of this test, which is exactly the "slow tab" case.
    const pending = new Promise<void>(() => {});
    function NeverLoads(): ReactElement {
      throw pending;
    }

    const tabs = [
      makeTab("ready", () => <div data-testid="ready-content">ready</div>),
      makeTab("slow", NeverLoads),
    ];

    // Activate the slow tab first so it mounts and suspends, then switch away
    // before it resolves — the sequence a user produces by clicking through
    // tabs faster than they load.
    const view = render(<TabContent tabs={tabs} activeTabId="slow" />);
    view.rerender(<TabContent tabs={tabs} activeTabId="ready" />);

    expect(screen.getByTestId("ready-content")).toBeVisible();
  });

  it("shows an error inside the failing tab and leaves its siblings alone", () => {
    function Throws(): ReactElement {
      throw new Error("tab blew up");
    }

    const tabs = [
      makeTab("ok", () => <div data-testid="ok-content">ok</div>),
      makeTab("bad", Throws),
    ];

    const view = render(<TabContent tabs={tabs} activeTabId="ok" />);
    view.rerender(<TabContent tabs={tabs} activeTabId="bad" />);

    // The failing tab reports itself...
    expect(screen.getByText("tab blew up")).toBeInTheDocument();
    // ...and the pane survives: the sibling is still mounted, and switching
    // back to it works.
    view.rerender(<TabContent tabs={tabs} activeTabId="ok" />);
    expect(screen.getByTestId("ok-content")).toBeVisible();
  });

  it("remounts only the failed tab when its retry is used", async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    const okMounts = vi.fn();

    function Flaky(): ReactElement {
      if (shouldThrow) throw new Error("transient failure");
      return <div data-testid="recovered">recovered</div>;
    }

    function Ok(): ReactElement {
      // A state hook makes a remount observable: state resets if React
      // unmounted and remounted this component.
      const [mountId] = useState(() => {
        okMounts();
        return okMounts.mock.calls.length;
      });
      return <div data-testid="ok-mount-id">{mountId}</div>;
    }

    const tabs = [makeTab("ok", Ok), makeTab("flaky", Flaky)];

    const view = render(<TabContent tabs={tabs} activeTabId="ok" />);
    view.rerender(<TabContent tabs={tabs} activeTabId="flaky" />);
    expect(screen.getByText("transient failure")).toBeInTheDocument();
    expect(okMounts).toHaveBeenCalledTimes(1);

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByTestId("recovered")).toBeInTheDocument();
    // The healthy sibling was never remounted by the retry.
    expect(okMounts).toHaveBeenCalledTimes(1);
  });
});
