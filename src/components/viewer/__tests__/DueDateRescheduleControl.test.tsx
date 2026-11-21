import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rescheduleDocument: vi.fn(),
  updateDocumentOptimistic: vi.fn(),
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock("../../../api/queue", () => ({
  rescheduleDocument: mocks.rescheduleDocument,
}));

vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: Object.assign(
    (selector: (s: any) => any) =>
      selector({ updateDocumentOptimistic: mocks.updateDocumentOptimistic }),
    {
      getState: () => ({
        documents: [{ id: "doc-1", nextReadingDate: "2026-11-22T09:00:00.000Z" }],
      }),
    },
  ),
}));

vi.mock("../../../stores/queueStore", () => ({
  useQueueStore: {
    getState: () => ({
      hasCompletedFirstLoad: false,
      reloadForCurrentMode: vi.fn(),
    }),
  },
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: mocks.successToast,
    error: mocks.errorToast,
  }),
}));

import {
  DueDateRescheduleControl,
  buildLocalPresetIso,
  localDateInputToIso,
  localDueDayDiff,
} from "../DueDateRescheduleControl";

describe("DueDateRescheduleControl (#12)", () => {
  beforeEach(() => {
    mocks.rescheduleDocument.mockReset();
    mocks.updateDocumentOptimistic.mockReset();
    mocks.successToast.mockReset();
    mocks.errorToast.mockReset();
  });

  it("computes local calendar day differences accurately", () => {
    const now = new Date(2026, 10, 21, 22, 30, 0); // Nov 21 22:30 local
    const fourDaysAgo = new Date(2026, 10, 17, 9, 0, 0).toISOString();
    expect(localDueDayDiff(fourDaysAgo, now)).toBe(-4);
    expect(buildLocalPresetIso(1, now)).toContain("2026-11-22");
    expect(localDateInputToIso("2026-11-28")).not.toBeNull();
  });

  it("opens reschedule modal in a portal on overdue badge click and commits Tomorrow preset with Undo", async () => {
    const past = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const tomorrowIso = "2026-11-22T09:00:00.000Z";
    mocks.rescheduleDocument.mockResolvedValue({
      documentId: "doc-1",
      previousDate: past,
      nextDate: tomorrowIso,
    });
    mocks.updateDocumentOptimistic.mockResolvedValue({ success: true });

    const { container } = render(<DueDateRescheduleControl documentId="doc-1" nextReadingDate={past} />);

    const trigger = screen.getByRole("button", { name: /Reschedule reading/i });
    expect(trigger).toHaveTextContent(/Overdue 4d/);

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Reschedule reading" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(container.contains(dialog)).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    });

    await waitFor(() => expect(mocks.rescheduleDocument).toHaveBeenCalledTimes(1));
    expect(mocks.updateDocumentOptimistic).toHaveBeenCalledWith("doc-1", {
      nextReadingDate: tomorrowIso,
    });
    expect(mocks.successToast).toHaveBeenCalledWith(
      expect.stringContaining("Reading rescheduled"),
      undefined,
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
  });

  it("dismisses modal on Escape", () => {
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    render(<DueDateRescheduleControl documentId="doc-1" nextReadingDate={past} />);

    fireEvent.click(screen.getByRole("button", { name: /Reschedule reading/i }));
    expect(screen.getByRole("dialog", { name: "Reschedule reading" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Reschedule reading" })).not.toBeInTheDocument();
  });
});
