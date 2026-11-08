import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdIntervalEditor } from "../AdIntervalEditor";
import * as podcastAdApi from "../../../api/podcastAd";
import type { PodcastAdInterval } from "../../../types/podcastAd";

vi.mock("../../../api/podcastAd", () => ({
  saveManualAdInterval: vi.fn(),
  deleteAdInterval: vi.fn(),
}));

describe("AdIntervalEditor", () => {
  const mockIntervals: PodcastAdInterval[] = [
    {
      id: "ad-1",
      episodeId: "ep-100",
      mediaRevision: "rev-1",
      startMs: 60000,
      endMs: 90000,
      category: "external_ad",
      confidence: 0.95,
      origin: "classifier_llm",
    },
    {
      id: "ad-2",
      episodeId: "ep-100",
      mediaRevision: "rev-1",
      startMs: 180000,
      endMs: 240000,
      category: "host_self_promo",
      confidence: 0.88,
      origin: "classifier_llm",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders existing intervals with formatted time ranges", () => {
    render(
      <AdIntervalEditor
        open={true}
        onClose={vi.fn()}
        episodeId="ep-100"
        durationSec={600}
        currentTimeSec={120}
        adIntervals={mockIntervals}
        onIntervalsChanged={vi.fn()}
      />
    );

    expect(screen.getByText("Advertisement Intervals")).toBeInTheDocument();
    expect(screen.getByText(/1:00 – 1:30/)).toBeInTheDocument();
    expect(screen.getByText(/3:00 – 4:00/)).toBeInTheDocument();
  });

  it("calls deleteAdInterval and onIntervalsChanged when delete button is clicked", async () => {
    vi.mocked(podcastAdApi.deleteAdInterval).mockResolvedValueOnce();
    const handleIntervalsChanged = vi.fn();

    render(
      <AdIntervalEditor
        open={true}
        onClose={vi.fn()}
        episodeId="ep-100"
        durationSec={600}
        currentTimeSec={120}
        adIntervals={mockIntervals}
        onIntervalsChanged={handleIntervalsChanged}
      />
    );

    const deleteBtn = screen.getByTestId("delete-ad-btn-ad-1");
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(podcastAdApi.deleteAdInterval).toHaveBeenCalledWith("ad-1");
      expect(handleIntervalsChanged).toHaveBeenCalledWith([mockIntervals[1]]);
    });
  });

  it("allows adding a manual interval and persists it via saveManualAdInterval", async () => {
    vi.mocked(podcastAdApi.saveManualAdInterval).mockResolvedValueOnce();
    const handleIntervalsChanged = vi.fn();

    render(
      <AdIntervalEditor
        open={true}
        onClose={vi.fn()}
        episodeId="ep-100"
        durationSec={600}
        currentTimeSec={60}
        adIntervals={mockIntervals}
        onIntervalsChanged={handleIntervalsChanged}
      />
    );

    const addTrigger = screen.getByTestId("add-manual-ad-trigger");
    fireEvent.click(addTrigger);

    const saveBtn = screen.getByTestId("save-manual-ad-btn");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(podcastAdApi.saveManualAdInterval).toHaveBeenCalledTimes(1);
      const [calledEpId, calledInterval] = vi.mocked(podcastAdApi.saveManualAdInterval).mock.calls[0];
      expect(calledEpId).toBe("ep-100");
      expect(calledInterval.startMs).toBe(60000);
      expect(calledInterval.endMs).toBe(90000);
      expect(calledInterval.origin).toBe("manual_user");
      expect(handleIntervalsChanged).toHaveBeenCalled();
    });
  });
});
