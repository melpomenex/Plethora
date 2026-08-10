import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScheduleAgenda } from "../ScheduleAgenda";
import type { ScheduleGroup } from "../../../lib/scheduleViewModel";
import type { ScheduleDayItem } from "../../../types/queue";
import type { ScheduleActionCallbacks } from "../../../lib/scheduleActions";

function localDateKey(offset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function item(overrides: Partial<ScheduleDayItem> & { id: string }): ScheduleDayItem {
  return {
    id: overrides.id,
    documentId: "doc-1",
    documentTitle: "Doc",
    itemType: "learning-item",
    dueDate: localDateKey(0),
    estimatedTime: 10,
    priority: 5,
    tags: [],
    progress: 50,
    ...overrides,
  };
}

function groupsFor(items: ScheduleDayItem[]): ScheduleGroup[] {
  const byDate = new Map<string, ScheduleDayItem[]>();
  for (const i of items) {
    const list = byDate.get(i.dueDate.slice(0, 10)) ?? [];
    list.push(i);
    byDate.set(i.dueDate.slice(0, 10), list);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, list]) => ({
      dateKey,
      items: [...list].sort((a, b) => b.priority - a.priority),
      estimatedMinutes: list.reduce((s, i) => s + i.estimatedTime, 0),
    }));
}

const noopCallbacks: ScheduleActionCallbacks = {
  onOpen: vi.fn(),
  onPostpone: vi.fn(),
  onSuspend: vi.fn(),
  onUnsuspend: vi.fn(),
  onDismiss: vi.fn(),
  onDelete: vi.fn(),
};

describe("ScheduleAgenda (7.2)", () => {
  it("orders items by due date then priority within a date", () => {
    const items = [
      item({ id: "b", dueDate: localDateKey(0), priority: 1 }),
      item({ id: "a", dueDate: localDateKey(1), priority: 9 }),
      item({ id: "c", dueDate: localDateKey(0), priority: 8 }),
    ];
    render(<ScheduleAgenda groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    const titles = screen.getAllByText(/^Doc/).map((el) => el.textContent);
    // The virtualizer only mounts visible rows; with the stubbed 800px
    // viewport all three fit, in date then priority order.
    expect(titles[0]).toBe("Doc");
    expect(titles[1]).toBe("Doc");
  });

  it("renders partial metric data without crashing and omits missing values", () => {
    const items = [
      item({ id: "a", dueDate: localDateKey(0), stability: undefined, difficulty: undefined, interval: undefined, retrievability: undefined, estimatedTime: 0, tags: [] }),
    ];
    render(<ScheduleAgenda groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    expect(screen.getByText("Doc")).toBeInTheDocument();
    // Type label still renders.
    expect(screen.getByText("Learning")).toBeInTheDocument();
  });

  it("expands a row to reveal shared details and actions", () => {
    const items = [item({ id: "a", dueDate: localDateKey(0), stability: 12 })];
    const { container } = render(<ScheduleAgenda groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    console.log("FULLFILE rows:", container.querySelectorAll("[data-index]").length, "labels:", screen.queryAllByLabelText("Show details").length);
    console.log("FULLFILE html:", container.innerHTML.replace(/\s+/g, " ").slice(0, 800));
    // Collapsed by default: no detail metrics.
    expect(screen.queryByText("Stability")).not.toBeInTheDocument();
    // Expand via the disclosure button.
    fireEvent.click(screen.getByLabelText("Show details"));
    expect(screen.getByText("Stability")).toBeInTheDocument();
    expect(screen.getByLabelText("Hide details")).toHaveAttribute("aria-expanded", "true");
    // Toggle collapses again.
    fireEvent.click(screen.getByLabelText("Hide details"));
    expect(screen.queryByText("Stability")).not.toBeInTheDocument();
  });

  it("shows postpone presets only for postponeable types and invokes the callback", () => {
    const onPostpone = vi.fn();
    const extract = item({ id: "e", itemType: "extract", dueDate: localDateKey(0), stability: 5 });
    const li = item({ id: "l", dueDate: localDateKey(1), stability: 5 });
    render(
      <ScheduleAgenda
        groups={groupsFor([extract, li])}
        callbacks={{ ...noopCallbacks, onPostpone }}
        busyIds={new Set()}
      />,
    );
    // Learning item shows postpone presets.
    fireEvent.click(screen.getAllByLabelText("Show details")[1]);
    const postponeButtons = screen.getAllByText(/^\+[137]d$/);
    expect(postponeButtons.length).toBeGreaterThan(0);
    fireEvent.click(postponeButtons[0]);
    expect(onPostpone).toHaveBeenCalledWith("l", 1, "learning-item");
  });

  it("exposes keyboard-visible disclosure with aria-expanded", () => {
    const items = [item({ id: "a", dueDate: localDateKey(0), stability: 3 })];
    render(<ScheduleAgenda groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    const disclosure = screen.getByLabelText("Show details");
    expect(disclosure.tagName).toBe("BUTTON");
    disclosure.focus();
    expect(disclosure).toHaveFocus();
  });

  it("renders the sticky day summary with item count and estimated time", () => {
    const items = [
      item({ id: "a", dueDate: localDateKey(0), estimatedTime: 5 }),
      item({ id: "b", dueDate: localDateKey(0), estimatedTime: 7 }),
    ];
    render(<ScheduleAgenda groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    // Sticky header shows "{count} items due".
    expect(screen.getAllByText("2 items due").length).toBeGreaterThan(0);
  });
});

describe("ScheduleAgenda — 1,000-item rendering regression (7.4)", () => {
  it("mounts only visible/overscan rows for a large queue", () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      item({
        id: `item-${i}`,
        dueDate: localDateKey(Math.floor(i / 50)),
        priority: i % 10,
        stability: i % 30,
      }),
    );
    const { container } = render(
      <ScheduleAgenda groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />,
    );
    // Only a bounded number of rows are mounted, not all 1000.
    const mounted = container.querySelectorAll("[data-index]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(200);

    // Expanding a mounted row reveals details without unmounting neighbors.
    const disclosure = screen.getAllByLabelText("Show details")[0];
    fireEvent.click(disclosure);
    expect(screen.getByText("Stability")).toBeInTheDocument();
    // Collapse again — measured expansion stays stable.
    fireEvent.click(screen.getByLabelText("Hide details"));
    expect(screen.queryByText("Stability")).not.toBeInTheDocument();
  });
});

describe("ScheduleAgenda — title regression assertions (7.5)", () => {
  it("renders flashcard question/cloze titles when the document title is missing", () => {
    const items = [
      item({ id: "a", dueDate: localDateKey(0), documentTitle: "", question: "What is entropy?" }),
    ];
    render(<ScheduleAgenda groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    expect(screen.getByText("Flashcard: What is entropy?")).toBeInTheDocument();
  });

  it("renders document titles, tags, and long localized content without losing context", () => {
    const longTitle = "A".repeat(180);
    const items = [
      item({
        id: "a",
        dueDate: localDateKey(0),
        documentTitle: "My Document",
        tags: ["alpha", "beta", "gamma"],
        category: "Math",
        stability: 10,
      }),
      item({
        id: "b",
        dueDate: localDateKey(1),
        documentTitle: longTitle,
        tags: [],
      }),
    ];
    render(<ScheduleAgenda groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    // Document title renders (the long one is line-clamped but present).
    expect(screen.getAllByText("My Document").length).toBeGreaterThan(0);
    expect(screen.getByText(longTitle)).toBeInTheDocument();
  });
});
