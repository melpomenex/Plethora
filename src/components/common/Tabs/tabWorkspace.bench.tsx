// @vitest-environment jsdom
/**
 * Tab workspace render benchmarks — the jsdom lane of the tab performance gate.
 *
 * This file opts itself into jsdom (the docblock above); the rest of the
 * benchmark suite stays in plain Node. See `vitest.bench.config.ts` for why the
 * opt-in is per file, and `src/test/bench-dom-setup` for the shims.
 *
 * Two kinds of placeholder content, for two different questions. Neither is a
 * real tab: mounting the PDF viewer or a graph engine would measure those
 * instead, and swamp the signal.
 *
 * - **Switching and re-rendering** use a trivial four-node placeholder. What is
 *   being priced is the workspace container's own reconciliation, and cheap
 *   content keeps it in the foreground.
 * - **Mounting** uses content with a representative mount cost (a few hundred
 *   nodes plus work in a mount effect). This benchmark's subject is *how many*
 *   tabs get mounted, and with four-node placeholders it could not see that at
 *   all: its cost was dominated by root setup and the twelve wrapper divs,
 *   which no change here touches. Measured against HEAD, deferred mounting made
 *   this case 9x faster with representative content and 0.98x — nothing — with
 *   trivial content. A guard that cannot see the thing it guards is not one.
 *
 * Rendering goes through `createRoot` + `flushSync` rather than Testing
 * Library: the measurement needs a synchronous commit inside the timed region,
 * and TL's render adds container bookkeeping and cleanup registration that is
 * not part of the workspace's cost.
 */
import "../../../test/bench-dom-setup";
import { bench, describe } from "vitest";
import { useEffect, useState, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { TabContent } from "./TabContent";
import type { Tab } from "../../../stores/tabsStore";

// React logs an act(...) warning for updates outside a test-act scope. A
// benchmark is not a test and drives its own synchronous commits.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

const TAB_COUNT = 12;

/**
 * Trivial content: small but not empty, so reconciliation has real children to
 * walk without any single tab dominating the measurement.
 */
function makeLightContent(index: number): ComponentType {
  return function BenchTabContent() {
    return (
      <div className="bench-tab" data-tab-index={index}>
        <header>Tab {index}</header>
        <section>
          <p>row one</p>
          <p>row two</p>
        </section>
      </div>
    );
  };
}

/**
 * Content whose mount costs something, standing in for the subscriptions and
 * derivations a real tab performs when it first appears. Deterministic: fixed
 * sizes, no clock, no `Math.random()`.
 */
function makeRepresentativeContent(index: number): ComponentType {
  return function BenchHeavyTabContent() {
    const [rows] = useState(() => Array.from({ length: 60 }, (_u, i) => `row ${index}-${i}`));
    useEffect(() => {
      let acc = 0;
      for (let i = 0; i < 20000; i += 1) acc = (acc + i) % 97;
      return () => {
        void acc;
      };
    }, []);
    return (
      <div className="bench-tab" data-tab-index={index}>
        {rows.map((row) => (
          <div key={row}>
            <span>{row}</span>
            <span>x</span>
          </div>
        ))}
      </div>
    );
  };
}

function buildTabs(count: number, makeContent: (index: number) => ComponentType): Tab[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `bench-tab-${index}`,
    title: `Benchmark tab ${index}`,
    icon: null,
    type: "dashboard" as const,
    content: makeContent(index),
    closable: index > 0,
    data: { index },
  }));
}

const TABS = buildTabs(TAB_COUNT, makeLightContent);
const HEAVY_TABS = buildTabs(TAB_COUNT, makeRepresentativeContent);

function mountWorkspace(
  activeTabId: string,
  tabs: Tab[] = TABS,
): { root: Root; container: HTMLDivElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(<TabContent tabs={tabs} activeTabId={activeTabId} paneId="bench-pane" />);
  });
  return { root, container };
}

function unmountWorkspace({ root, container }: { root: Root; container: HTMLDivElement }): void {
  flushSync(() => root.unmount());
  container.remove();
}

describe("tab workspace rendering", () => {
  // Representative content on purpose — see the note at the top of the file.
  bench("tabs-dom/mount-12-tab-workspace", () => {
    const mounted = mountWorkspace(HEAVY_TABS[0].id, HEAVY_TABS);
    unmountWorkspace(mounted);
  });

  {
    // One long-lived root, re-rendered with a rotating active tab: this is the
    // interaction users feel, and it must not scale with the tab count.
    let mounted: { root: Root; container: HTMLDivElement } | null = null;
    let cursor = 0;

    bench(
      "tabs-dom/switch-active-tab-12-tabs",
      () => {
        cursor = (cursor + 1) % TABS.length;
        flushSync(() => {
          mounted!.root.render(
            <TabContent tabs={TABS} activeTabId={TABS[cursor].id} paneId="bench-pane" />,
          );
        });
      },
      {
        setup: () => {
          mounted = mountWorkspace(TABS[0].id);
        },
        teardown: () => {
          if (mounted) unmountWorkspace(mounted);
          mounted = null;
        },
      },
    );
  }

  {
    // A new `tabs` array identity with unchanged contents: what every tab-data
    // update in the store produces, and the case where an unmemoized workspace
    // reconciles every mounted tab instead of one.
    let mounted: { root: Root; container: HTMLDivElement } | null = null;

    bench(
      "tabs-dom/rerender-on-tab-collection-change",
      () => {
        flushSync(() => {
          mounted!.root.render(
            <TabContent tabs={[...TABS]} activeTabId={TABS[0].id} paneId="bench-pane" />,
          );
        });
      },
      {
        setup: () => {
          mounted = mountWorkspace(TABS[0].id);
        },
        teardown: () => {
          if (mounted) unmountWorkspace(mounted);
          mounted = null;
        },
      },
    );
  }
});
