import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TodaysHorizonBanner } from "../TodaysHorizonBanner";

describe("TodaysHorizonBanner", () => {
  it("renders Top-Down Milestones and Bottom-Up Organic Discovery lanes with launch CTAs", () => {
    const onResumeMilestone = vi.fn();
    const onLaunchQueue = vi.fn();

    render(
      <TodaysHorizonBanner
        activePlansCount={1}
        upcomingNodesCount={3}
        nextMilestoneTitle="Distributed Consensus Week 2"
        pendingAssessmentsCount={1}
        dueReviewsCount={18}
        highPriorityExtractsCount={7}
        onResumeMilestone={onResumeMilestone}
        onLaunchQueue={onLaunchQueue}
      />
    );

    expect(screen.getByText("Distributed Consensus Week 2")).toBeInTheDocument();
    expect(screen.getByText("18 Due Reviews • 7 Priority Extracts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Resume Milestone/i }));
    expect(onResumeMilestone).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Launch Queue Session/i }));
    expect(onLaunchQueue).toHaveBeenCalledTimes(1);
  });

  it("renders actionable empty states when plans and queue are empty", () => {
    render(
      <TodaysHorizonBanner
        activePlansCount={0}
        pendingAssessmentsCount={0}
        dueReviewsCount={0}
        highPriorityExtractsCount={0}
        onResumeMilestone={vi.fn()}
        onLaunchQueue={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Create Study Plan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browse Queue/i })).toBeInTheDocument();
  });
});
