import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AlgorithmArenaDecision } from "../AlgorithmArenaDecision";
import { useReviewStore } from "../../../stores/reviewStore";
import { useSettingsStore } from "../../../stores/settingsStore";

vi.mock("../../../api/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/review")>()),
  getSm20ArenaStats: vi.fn(() => new Promise(() => {})),
}));

const originalConfirmArenaSelection = useReviewStore.getState().confirmArenaSelection;
const originalCancelArenaDecision = useReviewStore.getState().cancelArenaDecision;

const dueAt = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const arena = {
  schema_version: 1 as const,
  preview_id: "preview",
  item_revision: "item-revision",
  arena_revision: "arena-revision",
  generated_at: new Date().toISOString(),
  model_order: ["m1", "m2", "m3", "m4", "m5"] as const,
  grades: Array.from({ length: 6 }, (_, grade) => ({
    grade: grade as 0 | 1 | 2 | 3 | 4 | 5,
    recommendation: { interval_days: 18, due_at: dueAt(18) },
    candidates: [
      { model_id: "m1" as const, label: "Plethora Classic", interval_days: 6, weight_percent: 6 },
      { model_id: "m2" as const, label: "Classic 15", interval_days: 11, weight_percent: 14 },
      { model_id: "m3" as const, label: "Classic 19", interval_days: 17, weight_percent: 45 },
      { model_id: "m4" as const, label: "Plethora Precision", interval_days: 24, weight_percent: 25 },
      { model_id: "m5" as const, label: "FSRS", interval_days: 31, weight_percent: 10 },
    ].map((candidate) => ({
      ...candidate,
      due_at: dueAt(candidate.interval_days),
      personalized: false,
    })),
    range: { min_days: 6, max_days: 31 },
    custom_bounds: { min_days: 1 / 1_440, max_days: 44_530 },
  })),
};

describe("AlgorithmArenaDecision", () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        general: { ...state.settings.general, language: "en" },
        audioReviewMode: {
          ...state.settings.audioReviewMode,
          algorithmArenaCoachCompleted: true,
        },
      },
    }));
    useReviewStore.getState().resetSession();
    useReviewStore.setState({
      confirmArenaSelection: originalConfirmArenaSelection,
      cancelArenaDecision: originalCancelArenaDecision,
      reviewPhase: "arena-ready",
      previewIntervals: { again: 1, hard: 2, good: 3, easy: 4, arena: arena as any },
      pendingArenaReview: {
        itemId: "card-1",
        rating: 3,
        grade: 4,
        commitId: "commit",
        gradedAt: Date.now(),
        recallTimeTaken: 2,
        selection: { source: "arena" },
      },
    });
  });

  it("exposes Arena Pick and all five models as an operable single selection", () => {
    render(<AlgorithmArenaDecision />);

    expect(
      screen.getByRole("heading", { name: /when should this memory return/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/grade 4/i)).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByRole("radio", { name: /arena pick/i })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("radio", { name: /fsrs/i })).toHaveAccessibleName(
      /10\.0 percent arena weight/i
    );

    fireEvent.click(screen.getByRole("radio", { name: /fsrs/i }));
    expect(useReviewStore.getState().pendingArenaReview?.selection).toEqual({
      source: "model",
      modelId: "m5",
    });
    expect(screen.getByText(/fsrs selected/i)).toBeInTheDocument();
  });

  it("supports model, Arena, Custom, Escape, and confirmation keyboard paths", () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn();
    useReviewStore.setState({
      confirmArenaSelection: confirm,
      cancelArenaDecision: cancel,
    });
    render(<AlgorithmArenaDecision />);

    fireEvent.keyDown(window, { key: "5" });
    expect(useReviewStore.getState().pendingArenaReview?.selection).toMatchObject({
      source: "model",
      modelId: "m5",
    });
    fireEvent.keyDown(window, { key: "a" });
    expect(useReviewStore.getState().pendingArenaReview?.selection).toEqual({ source: "arena" });
    fireEvent.keyDown(window, { key: "m" });
    expect(useReviewStore.getState().pendingArenaReview?.selection.source).toBe("custom");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(confirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("persists the two-step coach in review settings without blocking choices", () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        audioReviewMode: {
          ...state.settings.audioReviewMode,
          algorithmArenaCoachCompleted: false,
        },
      },
    }));
    render(<AlgorithmArenaDecision />);

    expect(screen.getByText(/meet your arena pick/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /plethora precision/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /show me/i }));
    expect(screen.getByText(/every model stays within reach/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    expect(useSettingsStore.getState().settings.audioReviewMode.algorithmArenaCoachCompleted).toBe(
      true
    );
    expect(screen.queryByText(/every model stays within reach/i)).not.toBeInTheDocument();
  });

  it("keeps preview failures recoverable with retry, automatic, and back actions", () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const automatic = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn();
    useReviewStore.setState({
      previewIntervals: null,
      reviewPhase: "arena-error",
      arenaPreviewError: "Preview service is offline",
      retryArenaPreview: retry,
      scheduleArenaAutomatically: automatic,
      cancelArenaDecision: cancel,
    });
    const { container } = render(<AlgorithmArenaDecision />);

    expect(container.querySelector("section")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(/preview service is offline/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    fireEvent.click(screen.getByRole("button", { name: /schedule automatically/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to rating/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(automatic).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("retains the selected interval and exposes confirmation again after a commit error", () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    useReviewStore.setState({
      reviewPhase: "arena-error",
      error: "arena_preview_stale: refreshed safely",
      confirmArenaSelection: confirm,
    });
    render(<AlgorithmArenaDecision />);

    expect(screen.getByRole("alert")).toHaveTextContent(/scheduling did not complete/i);
    fireEvent.click(screen.getByRole("button", { name: /schedule for/i }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/arena pick selected/i)).toBeInTheDocument();
  });

  it("reports completion feedback only after the Arena commit clears pending state", async () => {
    const onCommitted = vi.fn();
    useReviewStore.setState({
      confirmArenaSelection: vi.fn(async () => {
        useReviewStore.setState({ pendingArenaReview: null, error: null, reviewPhase: "question" });
      }),
    });
    render(<AlgorithmArenaDecision onCommitted={onCommitted} />);

    expect(onCommitted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /schedule for/i }));
    await vi.waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
  });

  it("cycles colliding horizon markers without hiding any model choice", () => {
    const current = useReviewStore.getState().previewIntervals!;
    const currentArena = current.arena!;
    useReviewStore.setState({
      previewIntervals: {
        ...current,
        arena: {
          ...currentArena,
          grades: currentArena.grades.map((gradePreview) =>
            gradePreview.grade === 4
              ? {
                  ...gradePreview,
                  candidates: gradePreview.candidates.map((candidate) => ({
                    ...candidate,
                    interval_days: 18,
                    due_at: dueAt(18),
                  })),
                  range: { min_days: 18, max_days: 18 },
                }
              : gradePreview
          ),
        },
      },
    });
    render(<AlgorithmArenaDecision />);

    const cluster = screen.getByRole("button", { name: /5 models:/i });
    fireEvent.click(cluster);
    expect(useReviewStore.getState().pendingArenaReview?.selection).toEqual({
      source: "model",
      modelId: "m1",
    });
    fireEvent.click(cluster);
    expect(useReviewStore.getState().pendingArenaReview?.selection).toEqual({
      source: "model",
      modelId: "m2",
    });
  });

  it("keeps custom pointer movement out of React state until pointer-up settles the choice", () => {
    render(<AlgorithmArenaDecision />);
    fireEvent.click(screen.getByRole("radio", { name: /custom interval/i }));
    const slider = screen.getByRole("slider", { name: /custom interval logarithmic horizon/i });
    Object.defineProperty(slider, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        width: 100,
        top: 0,
        right: 100,
        bottom: 44,
        height: 44,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    Object.assign(slider, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    });
    const before = useReviewStore.getState().pendingArenaReview?.selection.intervalDays;

    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 20 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 80 });
    expect(useReviewStore.getState().pendingArenaReview?.selection.intervalDays).toBe(before);
    expect((slider as HTMLElement).style.getPropertyValue("--arena-custom-x")).toBe("80%");

    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 80 });
    expect(useReviewStore.getState().pendingArenaReview?.selection.intervalDays).toBeGreaterThan(
      before ?? 0
    );
  });

  it("restores focus to the rating controls when the user backs out", async () => {
    render(
      <>
        <AlgorithmArenaDecision />
        <button type="button" data-review-rating="4">
          Clear recall rating
        </button>
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: /back to rating/i }));
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /clear recall rating/i })).toHaveFocus()
    );
    expect(useReviewStore.getState().reviewPhase).toBe("answer");
  });

  it("keeps semantic controls available at enlarged text and includes reduced-motion rules", () => {
    document.documentElement.style.fontSize = "200%";
    const { container } = render(<AlgorithmArenaDecision />);

    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByRole("button", { name: /schedule for/i })).toBeEnabled();
    expect(container.querySelector("style")?.textContent).toContain(
      "prefers-reduced-motion: reduce"
    );
    document.documentElement.style.fontSize = "";
  });

  it.each([
    [320, 568, "phone portrait"],
    [375, 667, "large phone portrait"],
    [430, 932, "tall phone portrait"],
    [768, 1024, "tablet portrait"],
    [1024, 768, "compact desktop"],
    [1440, 900, "wide desktop"],
    [844, 390, "phone landscape"],
  ])("keeps every choice and the safe-area action operable at %s×%s (%s)", (width, height) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
    const { container } = render(<AlgorithmArenaDecision />);

    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(container.querySelector(".snap-x")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /schedule for/i }).className).toContain("min-h-12");
    const stage = container.querySelector(".arena-stage");
    const scrollRegion = screen.getByTestId("arena-scroll-region");
    const actionDock = screen.getByTestId("arena-action-dock");
    expect(stage).toHaveClass("flex", "min-h-0", "flex-col", "overflow-hidden");
    expect(scrollRegion).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    expect(actionDock).toHaveClass("shrink-0");
    expect(actionDock.className).not.toMatch(/\b(?:absolute|fixed|sticky)\b/);
    expect(scrollRegion.nextElementSibling).toBe(actionDock);
    expect(actionDock).toContainElement(screen.getByRole("button", { name: /schedule for/i }));
    expect(actionDock.className).toContain("safe-area-inset-bottom");
  });

  it("renders tight, moderate, and multi-year horizons in light and dark DOM themes", () => {
    const spreads = [
      [30, 30, 31, 32, 33],
      [6, 11, 17, 24, 31],
      [1, 30, 365, 1_825, 10_950],
    ];
    for (const theme of ["light", "dark"]) {
      document.documentElement.classList.toggle("dark", theme === "dark");
      for (const intervals of spreads) {
        const current = useReviewStore.getState().previewIntervals!;
        const currentArena = current.arena!;
        const grades = currentArena.grades.map((gradePreview) =>
          gradePreview.grade === 4
            ? {
                ...gradePreview,
                recommendation: { interval_days: intervals[2], due_at: dueAt(intervals[2]) },
                candidates: gradePreview.candidates.map((candidate, index) => ({
                  ...candidate,
                  interval_days: intervals[index],
                  due_at: dueAt(intervals[index]),
                })),
                range: { min_days: Math.min(...intervals), max_days: Math.max(...intervals) },
              }
            : gradePreview
        );
        useReviewStore.setState({
          previewIntervals: { ...current, arena: { ...currentArena, grades } },
        });
        const view = render(<AlgorithmArenaDecision />);
        expect(screen.getAllByRole("radio")).toHaveLength(7);
        expect(screen.getByText(/memory horizon/i)).toBeInTheDocument();
        view.unmount();
      }
    }
    document.documentElement.classList.remove("dark");
  });
});
