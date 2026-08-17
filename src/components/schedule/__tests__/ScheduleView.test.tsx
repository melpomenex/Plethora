import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ScheduleView } from "../ScheduleView";
import type { RustQueueItem } from "../../../api/queue";

const tauri = vi.hoisted(() => {
  const invoke = vi.fn();
  return { invoke };
});

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  invokeCommand: (cmd: string, args?: Record<string, unknown>) => tauri.invoke(cmd, args),
}));

// Local calendar date helpers so tests are deterministic in any timezone.
function localDateKey(offset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeRustItem(overrides: Partial<RustQueueItem> & { id: string }): RustQueueItem {
  return {
    id: overrides.id,
    document_id: "doc-1",
    document_title: "Doc",
    item_type: "learning-item",
    priority: 5,
    due_date: localDateKey(0),
    estimated_time: 10,
    tags: [],
    progress: 50,
    ...overrides,
  };
}

function forecastPoint(offset: number, dueTotal = 2) {
  return { date: localDateKey(offset), due_learning_items: 1, due_documents: 1, due_total: dueTotal };
}

function mockScheduleData(items: RustQueueItem[], horizonDays = 14) {
  const points = Array.from({ length: horizonDays }, (_, i) => forecastPoint(i));
  tauri.invoke.mockImplementation((cmd: string) => {
    if (cmd === "wait_for_backend_ready") return Promise.resolve(null);
    if (cmd === "get_due_workload_forecast") {
      return Promise.resolve({ points, summaries: [{ horizon_days: 90, due_total: 1 }] });
    }
    if (cmd === "get_queue") return Promise.resolve(items);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  tauri.invoke.mockReset();
  localStorage.clear();
});

describe("ScheduleView — workspace hierarchy and preferences (7.1)", () => {
  it("renders the header, workload band, and item content in order", async () => {
    mockScheduleData([makeRustItem({ id: "a", due_date: localDateKey(0) })]);
    render(<ScheduleView />);
    // Header title + workload insight
    expect(await screen.findByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Due today")).toBeInTheDocument();
    // Item content shows the item title
    expect(await screen.findByText("Doc")).toBeInTheDocument();
  });

  it("restores a valid persisted view-mode and overview-collapse preference", async () => {
    localStorage.setItem("plethora_schedule_view_mode", "cards");
    localStorage.setItem("plethora_schedule_dashboard_collapsed", "true");
    mockScheduleData([makeRustItem({ id: "a", due_date: localDateKey(0) })]);
    render(<ScheduleView />);
    // Collapsed overview shows the compact due-now/overdue summary.
    expect(await screen.findByText("due now")).toBeInTheDocument();
    expect(screen.queryByText("All Upcoming")).not.toBeInTheDocument();
    // Agenda (cards) mode is active on desktop.
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(await screen.findByText("Doc")).toBeInTheDocument();
  });

  it("falls back safely on invalid persisted values", async () => {
    localStorage.setItem("plethora_schedule_view_mode", "bogus");
    localStorage.setItem("plethora_schedule_dashboard_collapsed", "maybe");
    mockScheduleData([makeRustItem({ id: "a", due_date: localDateKey(0) })]);
    render(<ScheduleView />);
    // Invalid view mode falls back to the grid (desktop default); invalid
    // collapsed value falls back to expanded overview.
    expect(await screen.findByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("All Upcoming")).toBeInTheDocument();
    expect(await screen.findByText("Doc")).toBeInTheDocument();
  });
});

describe("ScheduleView — date selection (7.1)", () => {
  it("selects a day from the forecast rail and clears it via All upcoming", async () => {
    mockScheduleData([
      makeRustItem({ id: "a", due_date: localDateKey(0) }),
      makeRustItem({ id: "b", due_date: localDateKey(1) }),
    ]);
    render(<ScheduleView />);
    const tomorrowKey = localDateKey(1);
    const tomorrow = await screen.findByLabelText(
      new RegExp(`^${"Tomorrow".replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    expect(tomorrow).toBeInTheDocument();
    // Click tomorrow → items filtered to that date (only item b shows).
    fireEvent.click(tomorrow);
    // The header exposes the active date chip with a clear action.
    const clearBtn = await screen.findByLabelText("Clear selected date");
    expect(clearBtn).toBeInTheDocument();
    // Click All upcoming to clear the filter.
    fireEvent.click(screen.getByText("All Upcoming"));
    expect(screen.queryByLabelText("Clear selected date")).not.toBeInTheDocument();
    expect(tomorrowKey).toBeTruthy();
  });
});

describe("ScheduleView — loading / empty / filtered-empty / error / retry (7.3)", () => {
  it("shows skeletons while loading", async () => {
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "wait_for_backend_ready") return Promise.resolve(null);
      return new Promise(() => {});
    });
    render(<ScheduleView />);
    expect(document.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows the empty-schedule state when there are no items", async () => {
    mockScheduleData([]);
    render(<ScheduleView />);
    expect(await screen.findByText("No items scheduled")).toBeInTheDocument();
    expect(screen.getByText("Import documents and create flashcards to see your schedule")).toBeInTheDocument();
  });

  it("shows a filtered-empty state with a route back when the selected date has no items", async () => {
    mockScheduleData([makeRustItem({ id: "a", due_date: localDateKey(1) })]);
    render(<ScheduleView />);
    // Select "today" (no items due today) via the forecast rail.
    const todayBtn = await screen.findByLabelText(/^Today,/);
    fireEvent.click(todayBtn);
    expect(await screen.findByText("Show all upcoming")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Show all upcoming"));
    expect(await screen.findByText("Doc")).toBeInTheDocument();
  });

  it("shows an inline error with Retry when loading fails, and recovers", async () => {
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "wait_for_backend_ready") return Promise.resolve(null);
      return Promise.reject(new Error("backend offline"));
    });
    render(<ScheduleView />);
    expect(await screen.findByText("Couldn't load your schedule")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();

    // Retry succeeds now.
    mockScheduleData([makeRustItem({ id: "a", due_date: localDateKey(0) })]);
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText("Doc")).toBeInTheDocument();
  });

  it("disables Spread when there is no valid source workload", async () => {
    mockScheduleData([]);
    render(<ScheduleView />);
    const spread = await screen.findByText("Spread overloaded days");
    expect(spread.closest("button")).toBeDisabled();
  });

  it("enables Spread when a peak day has eligible learning items", async () => {
    mockScheduleData([makeRustItem({ id: "a", due_date: localDateKey(0), item_type: "learning-item" })]);
    render(<ScheduleView />);
    const spread = await screen.findByText("Spread overloaded days");
    expect(spread.closest("button")).not.toBeDisabled();
  });
});

describe("ScheduleView — mutation reconciliation (7.3)", () => {
  it("reconciles the visible workload after a postpone without a page reload", async () => {
    mockScheduleData([makeRustItem({ id: "a", due_date: localDateKey(0) })]);
    render(<ScheduleView />);
    await screen.findByText("Doc");

    // Postpone: mutation returns, then a bounded forecast+queue refresh.
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "postpone_item") return Promise.resolve("ok");
      if (cmd === "wait_for_backend_ready") return Promise.resolve(null);
      if (cmd === "get_queue") return Promise.resolve([]);
      if (cmd === "get_due_workload_forecast") {
        return Promise.resolve({ points: [], summaries: [] });
      }
      return Promise.resolve(null);
    });

    const row = (await screen.findByText("Doc")).closest(".group") as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    // Context menu offers Postpone presets — click the +1d preset.
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Postpone")).toBeInTheDocument();
    fireEvent.click(within(menu).getByText("+1day"));

    // After reconcile the empty state appears (item moved out of scope).
    expect(await screen.findByText("No items scheduled")).toBeInTheDocument();
  });
});
