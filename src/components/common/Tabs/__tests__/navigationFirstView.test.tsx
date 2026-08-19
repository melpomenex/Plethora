/**
 * First-open navigation reliability (#11).
 *
 * Any lazy view must render correctly the FIRST time it is opened, on cold
 * startup and on warm repeat, WITHOUT the user navigating away and back.
 * These tests exercise `TabContent`'s per-tab Suspense boundary with a lazy
 * chunk that resolves late (cold first visit), an initially-active lazy view
 * (cold launch), and a re-activated already-loaded view (warm repeat).
 */
import { lazy, type ComponentType } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabContent } from "../TabContent";
import type { Tab } from "../../../../stores";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeTab(id: string, title: string, content: ComponentType): Tab {
  return {
    id,
    title,
    icon: null,
    type: "documents",
    content,
    closable: true,
  };
}

const Dashboard = () => <div>Dashboard content</div>;
const SettingsContent = () => <div>Settings content</div>;

describe("first-visit navigation", () => {
  it("renders a lazy view on its first visit once the chunk resolves, without navigating away", async () => {
    const chunk = deferred<{ default: ComponentType }>();
    const Settings = lazy(() => chunk.promise);
    const dashboardTab = makeTab("dashboard", "Dashboard", Dashboard);
    const settingsTab = makeTab("settings", "Settings", Settings);

    const { rerender } = render(
      <TabContent tabs={[dashboardTab, settingsTab]} activeTabId="dashboard" />
    );
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();

    // First visit to Settings: chunk not loaded yet, Suspense fallback shows.
    rerender(<TabContent tabs={[dashboardTab, settingsTab]} activeTabId="settings" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // The chunk arrives. Content must render on this SAME first visit — the
    // user never navigated away and back.
    await act(async () => {
      chunk.resolve({ default: SettingsContent });
    });

    expect(await screen.findByText("Settings content")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("renders a lazy view on a cold launch when it is the initially active tab", async () => {
    const chunk = deferred<{ default: ComponentType }>();
    const Queue = lazy(() => chunk.promise);
    const queueTab = makeTab("queue", "Queue", Queue);

    const { rerender } = render(<TabContent tabs={[queueTab]} activeTabId="queue" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await act(async () => {
      chunk.resolve({ default: () => <div>Queue content</div> });
    });

    expect(await screen.findByText("Queue content")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();

    // Tab stays usable for further navigation.
    rerender(<TabContent tabs={[queueTab]} activeTabId="queue" />);
    expect(screen.getByText("Queue content")).toBeInTheDocument();
  });

  it("renders instantly on a warm repeat visit without re-suspending", async () => {
    const chunk = deferred<{ default: ComponentType }>();
    const Settings = lazy(() => chunk.promise);
    const dashboardTab = makeTab("dashboard", "Dashboard", Dashboard);
    const settingsTab = makeTab("settings", "Settings", Settings);

    const { rerender } = render(
      <TabContent tabs={[dashboardTab, settingsTab]} activeTabId="settings" />
    );
    await act(async () => {
      chunk.resolve({ default: SettingsContent });
    });
    expect(await screen.findByText("Settings content")).toBeInTheDocument();

    // Warm repeat: away and back, content renders immediately (no fallback).
    rerender(<TabContent tabs={[dashboardTab, settingsTab]} activeTabId="dashboard" />);
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();

    rerender(<TabContent tabs={[dashboardTab, settingsTab]} activeTabId="settings" />);
    expect(screen.getByText("Settings content")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("keeps the fallback visible while the chunk stalls, then recovers in place", async () => {
    const chunk = deferred<{ default: ComponentType }>();
    const Extracts = lazy(() => chunk.promise);
    const extractsTab = makeTab("extracts", "Extracts", Extracts);

    const { rerender } = render(<TabContent tabs={[extractsTab]} activeTabId="extracts" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // A long stall does not unmount the view or clear the tab.
    rerender(<TabContent tabs={[extractsTab]} activeTabId="extracts" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await act(async () => {
      chunk.resolve({ default: () => <div>Extracts content</div> });
    });
    expect(await screen.findByText("Extracts content")).toBeInTheDocument();
  });
});
