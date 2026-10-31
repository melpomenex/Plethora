import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import React from "react";
import { requestOverlayBack } from "../../../lib/overlayStack";
import { ScrollOverlayControls } from "../ScrollOverlayControls";

const defaultProps = {
  showControls: true,
  currentIndex: 0,
  totalItems: 5,
  sessionOffset: 0,
  itemType: "document",
  itemTitle: "Test Document",
  itemDocumentId: "doc-123",
  isNewDocument: false,
  isRating: false,
  scrollViewMode: "document",
  helpText: "Test Help Text",
  isEpub: false,
  isMobile: false,
  ratingOrbsPosition: "right" as const,
  onUpdateRatingOrbsPosition: vi.fn(),
  onExit: vi.fn(),
  onShowSettings: vi.fn(),
  onShowRssSettings: vi.fn(),
  onSetScrollViewMode: vi.fn(),
  onOpenExtractDialog: vi.fn(),
  onRate: vi.fn(),
  onDismiss: vi.fn(),
  onGoToNext: vi.fn(),
  onGoToPrevious: vi.fn(),
};

describe("ScrollOverlayControls Rating Orbs Snap Positioning", () => {
  it("hides rating actions until their visibility gate is opened", () => {
    render(<ScrollOverlayControls {...defaultProps} showRatingControls={false} />);
    expect(screen.queryByTitle("Again")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Change panel edge")).not.toBeInTheDocument();
  });

  it("does not render embedded EPUB TOC and reading settings in the top bar", () => {
    const openToc = vi.fn();
    const openSettings = vi.fn();
    const previousPage = vi.fn();
    const nextPage = vi.fn();
    render(
      <ScrollOverlayControls
        {...defaultProps}
        isEpub
        onOpenEpubToc={openToc}
        onOpenEpubSettings={openSettings}
        onEpubPreviousPage={previousPage}
        onEpubNextPage={nextPage}
      />
    );

    expect(screen.queryByTitle("Table of contents")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Reading settings")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Previous EPUB page")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Next EPUB page")).not.toBeInTheDocument();
  });

  it("routes document, extracts, and learning-card view selections", () => {
    const onSetScrollViewMode = vi.fn();
    render(
      <ScrollOverlayControls
        {...defaultProps}
        showRatingControls={false}
        scrollViewMode="extracts"
        onSetScrollViewMode={onSetScrollViewMode}
      />
    );

    fireEvent.click(screen.getByTitle("View document"));
    fireEvent.click(screen.getByTitle("View extracts"));
    fireEvent.click(screen.getByTitle("View learning cards"));

    expect(onSetScrollViewMode).toHaveBeenNthCalledWith(1, "document");
    expect(onSetScrollViewMode).toHaveBeenNthCalledWith(2, "extracts");
    expect(onSetScrollViewMode).toHaveBeenNthCalledWith(3, "cards");
  });

  it("renders with right snapping layout by default", () => {
    const { container } = render(<ScrollOverlayControls {...defaultProps} />);
    const docControl = container.querySelector(".right-6");
    expect(docControl).toBeInTheDocument();
    expect(docControl?.className).toContain("flex-col");
  });

  it("renders with left snapping layout class", () => {
    const { container } = render(
      <ScrollOverlayControls {...defaultProps} ratingOrbsPosition="left" />
    );
    const docControl = container.querySelector(".left-6");
    expect(docControl).toBeInTheDocument();
    expect(docControl?.className).toContain("flex-col");
  });

  it("renders with top snapping layout class", () => {
    const { container } = render(
      <ScrollOverlayControls {...defaultProps} ratingOrbsPosition="top" />
    );
    const docControl = container.querySelector('[data-rating-dock][data-edge="top"]');
    expect(docControl).toBeInTheDocument();
    expect(docControl?.className).toContain("flex-row");
  });

  it("renders with bottom snapping layout class", () => {
    const { container } = render(
      <ScrollOverlayControls {...defaultProps} ratingOrbsPosition="bottom" />
    );
    const docControl = container.querySelector('[data-rating-dock][data-edge="bottom"]');
    expect(docControl).toBeInTheDocument();
    expect(docControl?.className).toContain("flex-row");
  });

  it("toggles the position snap configuration menu on click", () => {
    const onUpdate = vi.fn();
    render(
      <ScrollOverlayControls
        {...defaultProps}
        onUpdateRatingOrbsPosition={onUpdate}
      />
    );

    // Position menu config button title is "Change panel edge"
    const configBtn = screen.getByTitle("Change panel edge");
    expect(configBtn).toBeInTheDocument();

    // Initially the buttons like "Move Left" are not visible
    expect(screen.queryByTitle("Move Left")).not.toBeInTheDocument();

    // Click to open menu
    fireEvent.click(configBtn);

    // Menu buttons should show up
    expect(screen.getByTitle("Move Left")).toBeInTheDocument();
    expect(screen.getByTitle("Move Top")).toBeInTheDocument();
    expect(screen.getByTitle("Move Bottom")).toBeInTheDocument();
    expect(screen.getByTitle("Move Right")).toBeInTheDocument();

    // Click "Move Left" and assert callbacks
    fireEvent.click(screen.getByTitle("Move Left"));
    expect(onUpdate).toHaveBeenCalledWith("left");
  });

  it("retains grades, dismiss behavior and disabled state in the shared themed orbs", () => {
    const onRate = vi.fn();
    const onDismiss = vi.fn();
    const view = render(<ScrollOverlayControls {...defaultProps} onRate={onRate} onDismiss={onDismiss} />);
    for (const label of ["Again", "Hard", "Good", "Easy"]) fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onRate.mock.calls).toEqual([[1], [2], [3], [4]]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
    view.rerender(<ScrollOverlayControls {...defaultProps} isRating onRate={onRate} />);
    expect(screen.getByRole("button", { name: "Good" })).toBeDisabled();
  });

  it("snaps a dragged rail to bottom and does not persist again on automatic layout updates", async () => {
    const feedback = vi.spyOn(await import("../../../lib/feedback/orchestrator"), "emitInteractionFeedback");
    const onUpdate = vi.fn();
    const view = render(<ScrollOverlayControls {...defaultProps} onUpdateRatingOrbsPosition={onUpdate} />);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Drag to move panel" }), { clientX: 200, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 200, clientY: window.innerHeight - 1 });
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith("bottom");
    expect(feedback).toHaveBeenCalledWith("queue.orbs-docked", { position: "bottom" }, expect.any(Object));
    const calls = feedback.mock.calls.length;
    view.rerender(<ScrollOverlayControls {...defaultProps} ratingOrbsPosition="bottom" onUpdateRatingOrbsPosition={onUpdate} />);
    fireEvent.resize(window);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(feedback).toHaveBeenCalledTimes(calls);
    feedback.mockRestore();
  });
});

describe("ScrollOverlayControls neural review", () => {
  const neuralLabels = {
    goNeural: "Go neural",
    goNeuralTooltip: "Explore related",
    exitNeural: "Exit",
    reviewMode: "Neural review",
  };

  it("renders the Go neural button and fires onGoNeural on click", () => {
    const onGoNeural = vi.fn();
    render(
      <ScrollOverlayControls
        {...defaultProps}
        canGoNeural
        onGoNeural={onGoNeural}
        labels={neuralLabels}
      />
    );
    const btn = screen.getByTitle("Explore related");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onGoNeural).toHaveBeenCalledTimes(1);
  });

  it("disables the Go neural button when canGoNeural is false (RSS/podcast)", () => {
    const onGoNeural = vi.fn();
    render(
      <ScrollOverlayControls
        {...defaultProps}
        canGoNeural={false}
        onGoNeural={onGoNeural}
        labels={neuralLabels}
      />
    );
    const btn = screen.getByTitle("Explore related");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onGoNeural).not.toHaveBeenCalled();
  });

  it("shows the neural banner with remaining count and exit button in neural mode", () => {
    const onExitNeural = vi.fn();
    const { container } = render(
      <ScrollOverlayControls
        {...defaultProps}
        isNeuralMode
        neuralRemaining={12}
        onExitNeural={onExitNeural}
        labels={neuralLabels}
      />
    );
    // The neural banner renders the review-mode label and remaining count.
    expect(container.textContent).toContain("Neural review");
    expect(container.textContent).toContain("12");
    // The Go neural button is hidden in neural mode.
    expect(screen.queryByTitle("Explore related")).not.toBeInTheDocument();
    // Exit button restores the reading session.
    fireEvent.click(screen.getByTitle("Exit"));
    expect(onExitNeural).toHaveBeenCalledTimes(1);
  });

  it("emits queue.orb-pressed haptic feedback on pointer down of rating orbs", () => {
    render(<ScrollOverlayControls {...defaultProps} isNewDocument={false} />);
    const againBtn = screen.getByTitle("Again");
    fireEvent.pointerDown(againBtn);
    const goodBtn = screen.getByTitle("Good");
    fireEvent.pointerDown(goodBtn);
    const dismissBtn = screen.getByTitle("Dismiss");
    fireEvent.pointerDown(dismissBtn);
  });

  it("emits queue.closed tactile click feedback on pointer down and exit button click", async () => {
    const orchestrator = await import("../../../lib/feedback/orchestrator");
    const spy = vi.spyOn(orchestrator, "emitUserInteraction");
    const onExit = vi.fn();
    render(<ScrollOverlayControls {...defaultProps} onExit={onExit} />);
    const exitBtn = screen.getByTitle("Exit scroll mode");
    fireEvent.pointerDown(exitBtn);
    expect(spy).toHaveBeenCalledWith("queue.closed");
    fireEvent.click(exitBtn);
    expect(onExit).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});


describe("ScrollOverlayControls priority editing", () => {
  const priorityProps = { ...defaultProps, isMobile: true, itemId: "document:doc-123", prioritySlider: 50 };
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Reading Priority: Normal" }));

  it("shows a single titled mobile sheet and non-color selection", () => {
    render(<ScrollOverlayControls {...priorityProps} onPriorityChange={vi.fn()} />);
    open();
    const dialog = screen.getByRole("dialog", { name: "Reading Priority" });
    expect(dialog).toHaveClass("adaptive-dialog-sheet");
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider", { name: "Fine-tune" })).toHaveValue("50");
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    expect(dialog.id).toBe(screen.getByRole("button", { name: "Reading Priority: Normal" }).getAttribute("aria-controls"));
  });

  it("keeps desktop editing anchored with the same presets", () => {
    render(<ScrollOverlayControls {...priorityProps} isMobile={false} onPriorityChange={vi.fn()} />);
    open();
    expect(screen.getByRole("dialog")).toHaveClass("absolute", "right-0", "top-full");
    for (const name of ["Lowest", "Low", "Normal", "High", "Highest"]) expect(screen.getByRole("button", { name })).toBeVisible();
  });

  it("saves a preset once, announces pending and closes on success", async () => {
    let resolve: () => void;
    const onChange = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    render(<ScrollOverlayControls {...priorityProps} onPriorityChange={onChange} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    expect(screen.getByText("Saving...")).toHaveAttribute("role", "status");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Highest" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(70);
    await act(async () => resolve!());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reading Priority: High" })).toBeVisible();
  });

  it("retains the failed draft and announces a localized error before retry", async () => {
    const onChange = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    render(<ScrollOverlayControls {...priorityProps} labels={{ prioritySaveFailed: "Bitte erneut versuchen" }} onPriorityChange={onChange} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Bitte erneut versuchen"));
    expect(screen.getByRole("slider")).toHaveValue("70");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Reading Priority: Normal" })).toBeVisible();
    open();
    expect(screen.getByRole("slider")).toHaveValue("70");
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChange.mock.calls).toEqual([[70], [70]]);
  });

  it.each(["pointerUp", "touchEnd", "keyUp", "blur"] as const)("commits slider on %s and deduplicates blur", async method => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<ScrollOverlayControls {...priorityProps} onPriorityChange={onChange} />);
    open();
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "64" } });
    fireEvent[method](slider, { key: "ArrowRight" });
    fireEvent.blur(slider);
    await waitFor(() => expect(slider).toHaveAttribute("aria-disabled", "false"));
    fireEvent.blur(slider);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(64);
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("restores a slider preview cancelled by vertical touch scrolling", () => {
    const onChange = vi.fn();
    render(<ScrollOverlayControls {...priorityProps} onPriorityChange={onChange} />);
    open();
    const slider = screen.getByRole("slider");
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "25" } });
    fireEvent.pointerCancel(slider);
    fireEvent.touchEnd(slider);
    fireEvent.blur(slider);
    expect(slider).toHaveValue("50");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["extract:first", "extract:second"])("ignores deferred completion after switching to %s on the same parent", async itemId => {
    let resolve: () => void;
    const onChange = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const view = render(<ScrollOverlayControls {...priorityProps} onPriorityChange={onChange} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    view.rerender(<ScrollOverlayControls {...priorityProps} itemId={itemId} itemType="extract" prioritySlider={30} onPriorityChange={onChange} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reading Priority: Low" }));
    await act(async () => resolve!());
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("slider")).toHaveValue("30");
  });

  it("resets between extracts with the same parent", () => {
    const view = render(<ScrollOverlayControls {...priorityProps} itemType="extract" itemId="extract:1" onPriorityChange={vi.fn()} />);
    open();
    view.rerender(<ScrollOverlayControls {...priorityProps} itemType="extract" itemId="extract:2" onPriorityChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("contains dialog keys before window-level reader shortcuts", () => {
    const readerKey = vi.fn();
    window.addEventListener("keydown", readerKey);
    const view = render(<ScrollOverlayControls {...priorityProps} onPriorityChange={vi.fn()} />);
    open();
    fireEvent.keyDown(screen.getByRole("button", { name: "Normal" }), { key: "PageDown" });
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(readerKey).not.toHaveBeenCalled();
    view.unmount();
    fireEvent.keyDown(document, { key: "PageDown" });
    expect(readerKey).toHaveBeenCalledOnce();
    window.removeEventListener("keydown", readerKey);
  });

  it("closes when hidden, unavailable or unmounted", () => {
    const onChange = vi.fn();
    const view = render(<ScrollOverlayControls {...priorityProps} onPriorityChange={onChange} />);
    open();
    view.rerender(<ScrollOverlayControls {...priorityProps} showControls={false} onPriorityChange={onChange} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<ScrollOverlayControls {...priorityProps} onPriorityChange={onChange} />);
    open();
    view.rerender(<ScrollOverlayControls {...priorityProps} prioritySlider={undefined} onPriorityChange={onChange} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<ScrollOverlayControls {...priorityProps} onPriorityChange={onChange} />);
    open(); view.unmount();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["Escape", "Back", "close", "backdrop"])("dismisses only priority via %s", async method => {
    const onMode = vi.fn();
    render(<ScrollOverlayControls {...priorityProps} onPriorityChange={vi.fn()} onSetScrollViewMode={onMode} />);
    open();
    if (method === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else if (method === "Back") act(() => { expect(requestOverlayBack()).toBe(true); });
    else fireEvent.click(screen.getAllByRole("button", { name: "Close" })[method === "backdrop" ? 0 : 1]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onMode).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reading Priority: Normal" })).toHaveAttribute("aria-expanded", "false");
  });
});
