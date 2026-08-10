import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScheduleDataGrid } from "../ScheduleDataGrid";
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

describe("ScheduleDataGrid (7.2)", () => {
  it("renders sticky readable headers and aligned tabular values", () => {
    const items = [item({ id: "a", dueDate: localDateKey(0), stability: 12, difficulty: 4, retrievability: 0.8, reps: 3, interval: 5 })];
    render(<ScheduleDataGrid groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    // Sticky header labels (readable, not abbreviations only).
    expect(screen.getByText("Stability")).toBeInTheDocument();
    expect(screen.getByText("Difficulty")).toBeInTheDocument();
    expect(screen.getByText("Retrievability")).toBeInTheDocument();
    // Tabular values for the item.
    expect(screen.getByText("12.0")).toBeInTheDocument();
    expect(screen.getByText("4.0")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("uses quiet missing-value markers and semantic metric states", () => {
    const items = [item({ id: "a", dueDate: localDateKey(0), stability: undefined, difficulty: undefined, interval: undefined, retrievability: undefined, estimatedTime: 0 })];
    render(<ScheduleDataGrid groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    // "—" appears for missing optional metrics.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("expands a row to shared details and keeps date context visible", () => {
    const items = [item({ id: "a", dueDate: localDateKey(0), stability: 12 })];
    render(<ScheduleDataGrid groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    fireEvent.click(screen.getByLabelText("Show details"));
    // Detail metrics render alongside the sticky header (header also says
    // "Stability", so match multiple occurrences).
    expect(screen.getAllByText("Stability").length).toBeGreaterThanOrEqual(2);
    // Sticky header still shows the group date context (may appear twice:
    // once in the sticky summary, once in the group header row).
    expect(screen.getAllByText("Today").length).toBeGreaterThan(0);
  });

  it("invokes postpone from a row quick action", () => {
    const onPostpone = vi.fn();
    const items = [item({ id: "a", dueDate: localDateKey(0), itemType: "learning-item" })];
    render(
      <ScheduleDataGrid
        groups={groupsFor(items)}
        callbacks={{ ...noopCallbacks, onPostpone }}
        busyIds={new Set()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Postpone 3 days"));
    expect(onPostpone).toHaveBeenCalledWith("a", 3, "learning-item");
  });

  it("opens the shared context menu with item-type-specific commands", async () => {
    const onSuspend = vi.fn();
    const items = [item({ id: "a", dueDate: localDateKey(0), itemType: "learning-item" })];
    render(
      <ScheduleDataGrid
        groups={groupsFor(items)}
        callbacks={{ ...noopCallbacks, onSuspend }}
        busyIds={new Set()}
      />,
    );
    const row = screen.getByText("Doc").closest(".group") as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 50, clientY: 50 });
    // Learning items expose Suspend in the menu.
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Suspend"));
    expect(onSuspend).toHaveBeenCalledWith("a", "learning-item");
  });
});

describe("ScheduleDataGrid — 1,000-item rendering regression (7.4)", () => {
  it("mounts only visible/overscan rows for a large queue and preserves expansion", () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      item({
        id: `item-${i}`,
        dueDate: localDateKey(Math.floor(i / 50)),
        priority: i % 10,
        stability: i % 30,
      }),
    );
    const { container } = render(
      <ScheduleDataGrid groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />,
    );
    const mounted = container.querySelectorAll("[data-index]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(200);

    // Expanding the first mounted row reveals details; collapse is stable.
    const disclosure = screen.getAllByLabelText("Show details")[0];
    fireEvent.click(disclosure);
    expect(screen.getAllByText("Stability").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByLabelText("Hide details"));
    expect(screen.queryByText("Stability")).toBeInTheDocument(); // header remains
    expect(screen.getAllByText("Stability").length).toBe(1); // only the header
  });
});

describe("ScheduleDataGrid — title regression assertions (7.5)", () => {
  it("renders flashcard question/cloze titles and document titles", () => {
    const items = [
      item({ id: "a", dueDate: localDateKey(0), documentTitle: "", question: "What is entropy?" }),
      item({ id: "b", dueDate: localDateKey(1), documentTitle: "My Doc" }),
    ];
    render(<ScheduleDataGrid groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    expect(screen.getByText("Flashcard: What is entropy?")).toBeInTheDocument();
    expect(screen.getByText("My Doc")).toBeInTheDocument();
  });

  it("renders tags and long localized content without losing accessible context", () => {
    const longTitle = "B".repeat(200);
    const items = [
      item({ id: "a", dueDate: localDateKey(0), documentTitle: "Tagged Doc", tags: ["x", "y", "z"], category: "Physics" }),
      item({ id: "b", dueDate: localDateKey(1), documentTitle: longTitle }),
    ];
    render(<ScheduleDataGrid groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />);
    expect(screen.getByText("Tagged Doc")).toBeInTheDocument();
    expect(screen.getByText(longTitle)).toBeInTheDocument();
  });
});
