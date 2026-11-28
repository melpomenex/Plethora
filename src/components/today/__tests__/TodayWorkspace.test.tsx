import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../../test/utils";

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
  };
});

import { resetBrowserLearningGoalsState } from "../../../api/learning-goals";
import { buildScrollModeTabData } from "../../../lib/learning-runtime/scrollSessionLauncher";
import { useLearningGoalsStore } from "../../../stores/learningGoalsStore";
import { useLearningSessionStore } from "../../../stores/learningSessionStore";
import { useTabsStore } from "../../../stores/tabsStore";
import { StartLearningHero } from "../StartLearningHero";
import { UnifiedSessionRunnerBar } from "../UnifiedSessionRunnerBar";
import { LearningGoalWizardModal } from "../LearningGoalWizardModal";
import { LearningGoalsSection } from "../LearningGoalsSection";

describe("Today Learning Workspace UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetBrowserLearningGoalsState();
    useLearningGoalsStore.getState().reset();
    useLearningSessionStore.setState({
      activeSession: null,
      sessionHistory: [],
    });
  });

  it("renders a welcoming casual empty state with 0 goals, 0 due reviews, and 0 AI providers without forced onboarding", () => {
    render(<StartLearningHero dueCount={0} resumableDocs={[]} />);

    expect(screen.getByText(/ready for a calm, self-paced session/i)).toBeInTheDocument();
    expect(screen.getByText(/no goals, reviews, or ai setup required/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start learning/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue previous session/i })).not.toBeInTheDocument();
  });

  it("supports customizing focus profile & time budget, starting a session, viewing 'Why am I seeing this?', pausing/resuming, and completing an activity", () => {
    render(
      <div>
        <UnifiedSessionRunnerBar />
        <StartLearningHero
          dueCount={6}
          resumableDocs={[{ id: "doc-1", title: "Designing Data-Intensive Applications", progress: 40 }]}
        />
      </div>,
    );

    // Customize session profile & time budget
    fireEvent.click(screen.getByRole("button", { name: /customize session/i }));
    fireEvent.click(screen.getByRole("radio", { name: /memory retention/i }));
    fireEvent.click(screen.getByRole("radio", { name: "30m" }));

    // Launch personalized session
    fireEvent.click(screen.getByRole("button", { name: /start learning/i }));

    const session = useLearningSessionStore.getState().activeSession;
    expect(session).not.toBeNull();
    expect(session?.profileId).toBe("memory_retention");
    expect(session?.timeBudgetMinutes).toBe(30);
    expect(session?.activities.length).toBeGreaterThan(0);

    // Runner bar is visible with active session
    expect(screen.getByRole("region", { name: /active learning session/i })).toBeInTheDocument();
    expect(screen.getByText(/active session/i)).toBeInTheDocument();

    // Open deterministic "Why am I seeing this?" explanation popover
    fireEvent.click(screen.getByRole("button", { name: /why am i seeing this\?/i }));
    expect(screen.getByRole("region", { name: /recommendation explanation/i })).toBeInTheDocument();
    expect(screen.getByText(/deterministic local ranking/i)).toBeInTheDocument();

    // Pause session -> Continue previous session appears in hero
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(useLearningSessionStore.getState().activeSession?.status).toBe("paused");
    expect(screen.getByRole("button", { name: /continue previous session/i })).toBeInTheDocument();

    // Resume via hero "Continue previous session"
    fireEvent.click(screen.getByRole("button", { name: /continue previous session/i }));
    expect(useLearningSessionStore.getState().activeSession?.status).toBe("active");

    // Complete current activity
    const initialCompleted = useLearningSessionStore
      .getState()
      .activeSession!.activities.filter((a) => a.status === "completed").length;
    fireEvent.click(screen.getByRole("button", { name: /^complete$/i }));

    const afterSession = useLearningSessionStore.getState().activeSession;
    if (afterSession) {
      const nextCompleted = afterSession.activities.filter((a) => a.status === "completed").length;
      expect(nextCompleted).toBe(initialCompleted + 1);
    } else {
      // Single-activity session auto-completed and shows summary
      expect(screen.getByRole("region", { name: /session summary/i })).toBeInTheDocument();
      expect(screen.getByText(/session complete/i)).toBeInTheDocument();
    }
  });

  it("creates a casual exploration goal with only a title via LearningGoalWizardModal", async () => {
    const onClose = vi.fn();
    render(
      <div>
        <LearningGoalWizardModal isOpen onClose={onClose} />
        <LearningGoalsSection />
      </div>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    const titleInput = screen.getByLabelText(/topic or goal title/i);
    fireEvent.change(titleInput, { target: { value: "Quantum Computing Basics" } });

    fireEvent.click(screen.getByRole("button", { name: /save as casual goal/i }));

    await waitFor(() => {
      expect(useLearningGoalsStore.getState().goals).toHaveLength(1);
    });

    const created = useLearningGoalsStore.getState().goals[0];
    expect(created.title).toBe("Quantum Computing Basics");
    expect(created.kind).toBe("exploration");
    expect(created.targetDate).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);

    // Goal renders in LearningGoalsSection with kind badge & pause/evolve/delete controls
    expect(screen.getByText("Quantum Computing Basics")).toBeInTheDocument();
    expect(screen.getByText("Exploration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /evolve to structured/i })).toBeInTheDocument();

    // Deleting the goal removes it from the store and UI
    fireEvent.click(screen.getByRole("button", { name: /delete quantum computing basics/i }));
    await waitFor(() => {
      expect(useLearningGoalsStore.getState().goals).toHaveLength(0);
    });
  });

  it("creates a deadline goal with target date, daily minutes, and optional diagnostic via LearningGoalWizardModal", async () => {
    const onClose = vi.fn();
    render(<LearningGoalWizardModal isOpen onClose={onClose} />);

    // Step 1
    fireEvent.change(screen.getByLabelText(/topic or goal title/i), {
      target: { value: "Linear Algebra Midterm" },
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 2
    fireEvent.click(screen.getByRole("radio", { name: /prepare for a deadline/i }));
    fireEvent.click(screen.getByRole("button", { name: /schedule & options/i }));

    // Step 3
    fireEvent.change(screen.getByLabelText(/target date/i), {
      target: { value: "2027-03-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "45m" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /create goal/i }));

    await waitFor(() => {
      expect(useLearningGoalsStore.getState().goals).toHaveLength(1);
    });

    const created = useLearningGoalsStore.getState().goals[0];
    expect(created.title).toBe("Linear Algebra Midterm");
    expect(created.kind).toBe("deadline");
    expect(created.targetDate).toBe("2027-03-15");
    expect(created.dailyMinutesBudget).toBe(45);
    expect(created.policy.optionalDiagnostic).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides LearningGoalsSection cleanly when disabled", async () => {
    await useLearningGoalsStore.getState().createGoal({
      title: "Hidden Goal",
      kind: "exploration",
    });

    const { container } = render(<LearningGoalsSection hidden />);
    expect(container.firstChild).toBeNull();
  });

  it("provides a primary Start review button that launches the due-card review activity without completing it", () => {
    const onOpenActivity = vi.fn();
    render(
      <div>
        <UnifiedSessionRunnerBar onOpenActivity={onOpenActivity} />
        <StartLearningHero dueCount={67} resumableDocs={[]} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /start learning/i }));

    expect(screen.getByText(/review due cards \(67 due\)/i)).toBeInTheDocument();
    const startReviewBtn = screen.getByRole("button", { name: /start review/i });
    fireEvent.click(startReviewBtn);

    expect(onOpenActivity).toHaveBeenCalledTimes(1);
    expect(onOpenActivity.mock.calls[0][0].activityType).toBe("flashcard_review");
    const session = useLearningSessionStore.getState().activeSession;
    expect(session?.status).toBe("active");
    expect(session?.activities[0].status).toBe("in_progress");
  });

  it("propagates documentId for resumable reading activities and shows Open reading", () => {
    const onOpenActivity = vi.fn();
    render(
      <div>
        <UnifiedSessionRunnerBar onOpenActivity={onOpenActivity} />
        <StartLearningHero
          dueCount={0}
          resumableDocs={[{ id: "doc-42", title: "Structure and Interpretation", progress: 25 }]}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /start learning/i }));

    const openReadingBtn = screen.getByRole("button", { name: /open reading/i });
    fireEvent.click(openReadingBtn);

    expect(onOpenActivity).toHaveBeenCalledTimes(1);
    expect(onOpenActivity.mock.calls[0][0].sourceReferences[0]?.documentId).toBe("doc-42");
  });

  it("moves to another activity when finishing or postponing card review, then nudges to revisit postponed review", () => {
    render(
      <div>
        <UnifiedSessionRunnerBar />
        <StartLearningHero dueCount={67} resumableDocs={[]} />
      </div>,
    );

    // Choose Free Exploration with default 15m budget and start learning
    fireEvent.click(screen.getByRole("button", { name: /customize session/i }));
    fireEvent.click(screen.getByRole("radio", { name: /free exploration/i }));
    fireEvent.click(screen.getByRole("button", { name: /start learning/i }));

    const session = useLearningSessionStore.getState().activeSession;
    expect(session).not.toBeNull();
    expect(session!.activities.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/step 1 of 2/i)).toBeInTheDocument();

    // Step 1 in Free Exploration is exploring library; complete it to reach flashcard review
    fireEvent.click(screen.getByRole("button", { name: /^complete$/i }));
    expect(screen.getByText(/review due cards \(67 due\)/i)).toBeInTheDocument();

    // User tires of reviewing cards and postpones -> nudged to revisit since other activity is done
    fireEvent.click(screen.getByRole("button", { name: /^postpone$/i }));
    expect(screen.getByText(/ready to revisit your postponed review due cards \(67 due\)\?/i)).toBeInTheDocument();

    // Clicking Revisit brings the postponed review back as the active step
    fireEvent.click(screen.getByRole("button", { name: /revisit review due cards/i }));
    expect(screen.getByText(/review due cards \(67 due\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start review/i })).toBeInTheDocument();
  });

  it("moves directly from postponed card review into reading material in Balanced mode, then nudges later", () => {
    render(
      <div>
        <UnifiedSessionRunnerBar />
        <StartLearningHero dueCount={67} resumableDocs={[]} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /start learning/i }));
    expect(screen.getByText(/review due cards \(67 due\)/i)).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 2/i)).toBeInTheDocument();

    // Postpone card review -> moves directly to Step 2 (exploring library material)
    fireEvent.click(screen.getByRole("button", { name: /^postpone$/i }));
    expect(screen.getByText(/explore something from your library/i)).toBeInTheDocument();
    expect(screen.getByText(/step 2 of 2/i)).toBeInTheDocument();
    expect(screen.getByText(/1 postponed/i)).toBeInTheDocument();

    // Complete reading material -> nudged to revisit postponed card review
    fireEvent.click(screen.getByRole("button", { name: /^complete$/i }));
    expect(screen.getByText(/ready to revisit your postponed review due cards \(67 due\)\?/i)).toBeInTheDocument();

    // Or finish for now -> summary reminds about postponed items
    fireEvent.click(screen.getByRole("button", { name: /finish for now/i }));
    expect(screen.getByRole("region", { name: /session summary/i })).toBeInTheDocument();
    expect(screen.getByText(/you still have postponed review items waiting/i)).toBeInTheDocument();
  });

  it("launches Free Exploration into the user's priority queue in Scroll Mode", async () => {
    useTabsStore.setState({ tabs: [] });

    render(
      <div>
        <UnifiedSessionRunnerBar />
        <StartLearningHero dueCount={12} resumableDocs={[]} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /customize session/i }));
    fireEvent.click(screen.getByRole("radio", { name: /free exploration/i }));
    fireEvent.click(screen.getByRole("button", { name: /start learning/i }));

    await waitFor(() => {
      const scrollTab = useTabsStore.getState().tabs.find((t) => t.type === "queue-scroll");
      expect(scrollTab).toBeDefined();
      expect(scrollTab?.data?.queueScrollMode).toBe("queue-list");
    });
  });

  it("positions goal/interest-based Scroll Mode queue with matching items first", () => {
    const data = buildScrollModeTabData({
      profileId: "balanced",
      goals: [
        {
          id: "g-1",
          title: "Distributed Systems",
          description: "Consensus and replication",
          kind: "exploration",
          status: "active",
          targetDate: null,
          dailyMinutesBudget: 20,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          policy: { optionalDiagnostic: false },
          progress: 0,
        } as never,
      ],
      queueItems: [
        {
          id: "q-1",
          documentId: "d-1",
          documentTitle: "Intro to Cooking",
          itemType: "document",
          priority: 90,
          estimatedTime: 10,
          tags: [],
          progress: 0,
        },
        {
          id: "q-2",
          documentId: "d-2",
          documentTitle: "Distributed Consensus in Raft",
          itemType: "document",
          priority: 50,
          estimatedTime: 10,
          tags: ["distributed"],
          progress: 0,
        },
      ],
    });

    expect(data.queueScrollMode).toBe("queue-list");
    expect(data.customQueueItems?.map((i) => i.id)).toEqual(["q-2", "q-1"]);
  });
});
