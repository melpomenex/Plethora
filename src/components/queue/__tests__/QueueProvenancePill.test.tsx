import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import {
  QueueProvenancePill,
  resolveProvenanceSummary,
} from "../QueueProvenancePill";
import {
  getQueueOrderingMode,
  setQueueOrderingMode,
} from "../../../stores/queueOrderingSettings";

describe("UX01-T02 QueueProvenancePill", () => {
  beforeEach(() => {
    setQueueOrderingMode("adaptive");
  });

  it("displays algorithm label via schedulerCatalog, priority, and inherited parent lineage", () => {
    const summary = resolveProvenanceSummary({
      itemId: "ext-1",
      itemType: "extract",
      orderingMode: "adaptive",
      algorithmType: "fsrs",
      prioritySlider: 12,
      priorityExplicitlySet: false,
      parentDocumentTitle: "Distributed Systems",
    });

    expect(summary.scheduleReason).toBe("Due via FSRS-7");
    expect(summary.priorityLabel).toBe("Priority 12");
    expect(summary.lineageLabel).toBe("Inherited from Distributed Systems");
    expect(summary.fullText).toBe(
      "Due via FSRS-7 • Priority 12 • Inherited from Distributed Systems"
    );

    render(
      <QueueProvenancePill
        info={{
          itemId: "ext-1",
          itemType: "extract",
          orderingMode: "adaptive",
          algorithmType: "fsrs",
          prioritySlider: 12,
          priorityExplicitlySet: false,
          parentDocumentTitle: "Distributed Systems",
        }}
      />
    );

    expect(
      screen.getByText("Due via FSRS-7 • Priority 12 • Inherited from Distributed Systems")
    ).toBeInTheDocument();
  });

  it("resolves SM-20/precision, SM-18/adaptive, and Strict Manual provenance cleanly", () => {
    expect(
      resolveProvenanceSummary({
        itemId: "c-1",
        itemType: "flashcard",
        orderingMode: "adaptive",
        algorithmType: "precision",
        prioritySlider: 70,
        priorityExplicitlySet: true,
      }).fullText
    ).toBe("Due via SM-20 • Priority 70 • Explicit Priority");

    expect(
      resolveProvenanceSummary({
        itemId: "d-1",
        itemType: "document",
        orderingMode: "strict_manual",
        algorithmType: "fsrs",
        prioritySlider: 85,
        priorityExplicitlySet: true,
      }).fullText
    ).toBe("Pinned: Strict Manual • Priority 85 • Explicit Priority");
  });

  it("opens [data-provenance-popover] for 1-click Snooze, Reprioritize, and Ordering Mode switch", async () => {
    const onSnooze = vi.fn();
    const onPriorityChange = vi.fn();
    const onOrderingModeChange = vi.fn();

    const { container } = render(
      <QueueProvenancePill
        info={{
          itemId: "ext-2",
          itemType: "extract",
          orderingMode: "adaptive",
          algorithmType: "fsrs",
          prioritySlider: 50,
          priorityExplicitlySet: false,
          parentDocumentTitle: "Raft Paper",
        }}
        onSnooze={onSnooze}
        onPriorityChange={onPriorityChange}
        onOrderingModeChange={onOrderingModeChange}
      />
    );

    const pill = container.querySelector<HTMLButtonElement>("[data-queue-provenance-pill='true']");
    expect(pill).toBeInTheDocument();
    expect(container.querySelector("[data-provenance-popover='true']")).toBeNull();

    fireEvent.click(pill!);
    expect(container.querySelector("[data-provenance-popover='true']")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Increase priority by 5" }));
    await waitFor(() => expect(onPriorityChange).toHaveBeenCalledWith(55));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Snooze 3d" })).not.toBeDisabled()
    );

    fireEvent.change(screen.getByRole("slider", { name: "Item priority slider" }), {
      target: { value: "80" },
    });
    await waitFor(() => expect(onPriorityChange).toHaveBeenCalledWith(80));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Snooze 3d" })).not.toBeDisabled()
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to Strict Manual" }));
    expect(getQueueOrderingMode()).toBe("strict_manual");
    expect(onOrderingModeChange).toHaveBeenCalledWith("strict_manual");

    fireEvent.click(screen.getByRole("button", { name: "Snooze 3d" }));
    await waitFor(() => expect(onSnooze).toHaveBeenCalledWith(3));
  });
});
