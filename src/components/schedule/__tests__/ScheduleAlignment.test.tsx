import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScheduleDataGrid } from "../ScheduleDataGrid";
import { ScheduleItemDetails } from "../ScheduleItemDetails";
import { GRID_COLUMNS } from "../scheduleGridColumns";
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

describe("Schedule data-grid column alignment (5.5)", () => {
  it("header, row, and grid-mode detail share ONE column track definition", () => {
    const items = [item({ id: "a", dueDate: localDateKey(0), stability: 12, difficulty: 4, retrievability: 0.8, interval: 5, reps: 3, lapses: 1, priority: 6.5 })];
    const { container } = render(
      <ScheduleDataGrid groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />,
    );

    // The sticky header grid and each row grid must use the exact same tracks.
    const scroll = container.querySelector('[data-testid="schedule-grid-scroll"]') as HTMLElement;
    expect(scroll).toBeTruthy();
    const gridHeaders = scroll.querySelectorAll('[role="row"]');
    const headerGrid = Array.from(gridHeaders).find(
      (el) => (el as HTMLElement).style.gridTemplateColumns === GRID_COLUMNS,
    );
    expect(headerGrid).toBeTruthy();

    const rowGrid = Array.from(scroll.querySelectorAll('[role="row"]')).find(
      (el) => (el as HTMLElement).style.gridTemplateColumns === GRID_COLUMNS && el !== headerGrid,
    );
    expect(rowGrid).toBeTruthy();
  });

  it("puts the sticky header inside the same scroll viewport as the rows", () => {
    const items = [item({ id: "a", dueDate: localDateKey(0) })];
    const { container } = render(
      <ScheduleDataGrid groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />,
    );
    const scroll = container.querySelector('[data-testid="schedule-grid-scroll"]') as HTMLElement;
    // The scroll container is the overflow element AND contains the header,
    // so header and rows compute column positions from the same inline width
    // (including any vertical scrollbar gutter) and scroll horizontally
    // together. `position: sticky` on the header keeps it readable.
    expect(scroll.classList.contains("overflow-auto")).toBe(true);
    const header = Array.from(scroll.querySelectorAll('[role="row"]')).find(
      (el) => (el as HTMLElement).style.gridTemplateColumns === GRID_COLUMNS,
    );
    expect(header).toBeTruthy();
    expect(scroll.contains(header)).toBe(true);
    expect(header!.classList.contains("sticky")).toBe(true);
  });

  it("expands a row and aligns grid-mode detail metrics on the shared tracks", () => {
    const items = [item({ id: "a", dueDate: localDateKey(0), stability: 12, difficulty: 4, retrievability: 0.8, interval: 5, reps: 3, lapses: 1, priority: 6.5, estimatedTime: 20 })];
    const { container } = render(
      <ScheduleDataGrid groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />,
    );
    fireEvent.click(screen.getByLabelText("Show details"));

    // The grid-mode detail is an additional grid using the shared tracks; its
    // metric cells must land on the same columns as the row/header.
    const scroll = container.querySelector('[data-testid="schedule-grid-scroll"]') as HTMLElement;
    const detailGrids = Array.from(scroll.querySelectorAll('[role="row"]')).filter(
      (el) => (el as HTMLElement).style.gridTemplateColumns === GRID_COLUMNS,
    );
    expect(detailGrids.length).toBeGreaterThanOrEqual(3); // header + row + detail

    // Sticky header date context remains visible after expansion.
    expect(screen.getAllByText("Today").length).toBeGreaterThan(0);
  });

  it("collapsing an expanded row restores the single header + row alignment", () => {
    const items = [item({ id: "a", dueDate: localDateKey(0), stability: 12 })];
    const { container } = render(
      <ScheduleDataGrid groups={groupsFor(items)} callbacks={noopCallbacks} busyIds={new Set()} />,
    );
    fireEvent.click(screen.getByLabelText("Show details"));
    expect(screen.getAllByText("Stability").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByLabelText("Hide details"));
    const scroll = container.querySelector('[data-testid="schedule-grid-scroll"]') as HTMLElement;
    const gridRows = Array.from(scroll.querySelectorAll('[role="row"]')).filter(
      (el) => (el as HTMLElement).style.gridTemplateColumns === GRID_COLUMNS,
    );
    expect(gridRows.length).toBe(2); // header + collapsed row only
  });
});

describe("ScheduleItemDetails — agenda vs grid layout modes (5.3)", () => {
  it("agenda mode keeps the responsive labeled metric grid (no shared tracks)", () => {
    const { container } = render(
      <ScheduleItemDetails
        item={item({ id: "a", dueDate: localDateKey(0), stability: 12 })}
        callbacks={noopCallbacks}
        mode="agenda"
      />,
    );
    const grid = container.querySelector(".grid");
    expect(grid).toBeTruthy();
    expect((grid as HTMLElement).className).toContain("grid-cols-2");
    expect((grid as HTMLElement).style.gridTemplateColumns).not.toBe(GRID_COLUMNS);
  });

  it("grid mode renders metric cells on the shared column tracks", () => {
    const { container } = render(
      <ScheduleItemDetails
        item={item({ id: "a", dueDate: localDateKey(0), stability: 12, difficulty: 4, priority: 6.5 })}
        callbacks={noopCallbacks}
        mode="grid"
      />,
    );
    const detailGrid = container.querySelector('[role="row"]') as HTMLElement;
    expect(detailGrid).toBeTruthy();
    expect(detailGrid.style.gridTemplateColumns).toBe(GRID_COLUMNS);
    // Metrics are duplicated on their semantic columns (stability value visible).
    expect(screen.getByText("12.00")).toBeInTheDocument();
  });
});
