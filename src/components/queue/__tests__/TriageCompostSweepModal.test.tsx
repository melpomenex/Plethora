import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import {
  TriageCompostSweepModal,
  getStaleCompostCandidates,
  type CompostCandidate,
} from "../TriageCompostSweepModal";

const candidates: CompostCandidate[] = [
  {
    id: "ext-1",
    title: "Stale Extract 1",
    content: "First stale extract content.",
    prioritySlider: 50,
    postponeCount: 3,
    documentTitle: "Paper A",
  },
  {
    id: "ext-2",
    title: "Stale Extract 2",
    content: "Second stale extract content.",
    prioritySlider: 40,
    postponeCount: 4,
    documentTitle: "Paper B",
  },
  {
    id: "ext-3",
    title: "Stale Extract 3",
    content: "Third stale extract content.",
    prioritySlider: 60,
    postponeCount: 5,
    documentTitle: "Paper C",
  },
];

describe("UX03-T02 TriageCompostSweepModal", () => {
  it("filters stale items with postponeCount >= 3", () => {
    const filtered = getStaleCompostCandidates([
      { id: "a", postponeCount: 1 },
      { id: "b", postponeCount: 3 },
      { id: "c", postpone_count: 4 },
    ]);
    expect(filtered.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("processes J (boost -15), K (demote +90d), and Backspace (archive) sequentially and shows receipt", async () => {
    const onKeepAndBoost = vi.fn();
    const onDemoteToVault = vi.fn();
    const onSummarizeAndDrop = vi.fn();
    const onArchiveOrDelete = vi.fn();
    const onClose = vi.fn();

    render(
      <TriageCompostSweepModal
        isOpen={true}
        candidates={candidates}
        onKeepAndBoost={onKeepAndBoost}
        onDemoteToVault={onDemoteToVault}
        onSummarizeAndDrop={onSummarizeAndDrop}
        onArchiveOrDelete={onArchiveOrDelete}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => {
      expect(onKeepAndBoost).toHaveBeenCalledWith(candidates[0], 35);
    });
    await screen.findByText(/Item 2 of 3/);

    fireEvent.keyDown(window, { key: "k" });
    await waitFor(() => {
      expect(onDemoteToVault).toHaveBeenCalledWith(candidates[1]);
    });
    await screen.findByText(/Item 3 of 3/);

    fireEvent.keyDown(window, { key: "Backspace" });
    await waitFor(() => {
      expect(onArchiveOrDelete).toHaveBeenCalledWith(candidates[2]);
    });

    await screen.findByText(/Session Receipt \(3 items triaged\)/);
  });
});
