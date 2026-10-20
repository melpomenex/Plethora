import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PassageScoreOverlay, type PassageScoreView } from "../PassageScoreOverlay";
import type { PassageClassification } from "../../../../lib/ai/schemas/passageClassification";
import type { PassageActionSnapshot } from "../../selectionInteraction/selectionActionRegistry";

vi.mock("../../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const snapshot: PassageActionSnapshot = {
  ownerToken: "owner",
  documentId: "doc-1",
  sourceRevision: "rev-1",
  passageId: "p1",
  contentHash: "a".repeat(64),
};

function view(
  overrides: Partial<PassageClassification> = {},
  snapshotValue: PassageActionSnapshot | null = snapshot
): PassageScoreView {
  return {
    passageId: "p1",
    reason: "Defines the central term.",
    classification: {
      type: "definition",
      extractWorthiness: 0.91,
      reason: "Defines the central term.",
      suggestedLearningAction: "extract",
      ...overrides,
    },
    snapshot: snapshotValue,
  };
}

const rects = [{ x: 300, y: 200, width: 220, height: 40 }];

function renderOverlay(overrides: Partial<React.ComponentProps<typeof PassageScoreOverlay>> = {}) {
  const props = {
    results: [view()],
    projectRects: () => rects,
    narrow: false,
    visible: true,
    openPassageId: null,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onAction: vi.fn(),
    onDismiss: vi.fn(),
    onShowSource: vi.fn(),
    statusReasonKey: null,
    ...overrides,
  };
  return { props, ...render(<PassageScoreOverlay {...props} />) };
}

function Harness(props: Partial<React.ComponentProps<typeof PassageScoreOverlay>>) {
  const [open, setOpen] = useState<string | null>(props.openPassageId ?? null);
  return (
    <PassageScoreOverlay
      results={[view()]}
      projectRects={() => rects}
      visible
      openPassageId={open}
      onOpen={setOpen}
      onClose={() => setOpen(null)}
      onAction={vi.fn()}
      onDismiss={vi.fn()}
      onShowSource={vi.fn()}
      {...props}
    />
  );
}

describe("PassageScoreOverlay", () => {
  it("renders a 44×44 focusable marker with a localized accessible label", () => {
    const { props } = renderOverlay();
    const marker = screen.getByRole("button", {
      name: /ai\.passageScoring\.indicatorLabel/,
    });
    expect(marker).toHaveStyle({ width: "44px", height: "44px" });
    expect(marker.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(marker);
    expect(props.onOpen).toHaveBeenCalledWith("p1");
    // The overlay itself is fixed chrome; it adds no in-flow document space.
    const root = marker.closest("[data-passage-scoring-ui]") as HTMLElement;
    expect(root.className).toContain("fixed");
  });

  it("keeps exactly 0.75, bibliography and no-action results quiet", () => {
    const { rerender } = render(
      <PassageScoreOverlay
        results={[view({ extractWorthiness: 0.75 })]}
        projectRects={() => rects}
        openPassageId={null}
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        onShowSource={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /indicatorLabel/ })).toBeNull();
    rerender(
      <PassageScoreOverlay
        results={[
          view({ type: "bibliography", extractWorthiness: 0.99 }),
          view({ suggestedLearningAction: "none", extractWorthiness: 0.99 }),
        ]}
        projectRects={() => rects}
        openPassageId={null}
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        onShowSource={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /indicatorLabel/ })).toBeNull();
  });

  it("opens the action sheet, renders plain reason text and closes with Escape", async () => {
    render(<Harness />);
    const marker = screen.getByRole("button", { name: /indicatorLabel/ });
    marker.focus();
    fireEvent.click(marker);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Defines the central term.");
    expect(screen.getByText("ai.passageScoring.createExtract")).toBeInTheDocument();
    expect(screen.getByText("ai.passageScoring.makeFlashcard")).toBeInTheDocument();
    expect(screen.getByText("ai.passageScoring.createCloze")).toBeInTheDocument();
    expect(screen.getByText("ai.passageScoring.learnThis")).toBeInTheDocument();
    expect(screen.getByText("ai.passageScoring.highlight")).toBeInTheDocument();
    expect(screen.getByText("ai.passageScoring.dismiss")).toBeInTheDocument();
    // Plain text: the reason is not parsed as markup.
    expect(dialog.querySelector("strong")).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Focus returns to the trigger.
    await waitFor(() => expect(document.activeElement).toBe(marker));
  });

  it("routes every action id to the host and dismisses explicitly", async () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Harness
        openPassageId="p1"
        onAction={onAction}
        onDismiss={onDismiss}
      />
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("ai.passageScoring.createExtract"));
    expect(onAction).toHaveBeenCalledWith("passageExtract", "p1");
    fireEvent.click(screen.getAllByText("ai.passageScoring.dismiss")[0]);
    expect(onDismiss).toHaveBeenCalledWith("p1");
    expect(dialog).toBeInTheDocument();
  });

  it("shows stale-source recovery and never offers object creation", async () => {
    const onAction = vi.fn();
    render(
      <PassageScoreOverlay
        results={[view({}, null)]}
        projectRects={() => rects}
        openPassageId="p1"
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onAction={onAction}
        onDismiss={vi.fn()}
        onShowSource={vi.fn()}
        importRequired
        onImportRequired={vi.fn()}
      />
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("ai.passageScoring.staleSource");
    expect(screen.queryByText("ai.passageScoring.createExtract")).toBeNull();
    expect(screen.getByText("ai.passageScoring.importArticle")).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("hides while detached and shows a status explanation without results", () => {
    const { rerender } = render(
      <PassageScoreOverlay
        results={[view()]}
        projectRects={() => rects}
        visible={false}
        openPassageId={null}
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        onShowSource={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /indicatorLabel/ })).toBeNull();
    rerender(
      <PassageScoreOverlay
        results={[]}
        projectRects={() => rects}
        visible
        openPassageId={null}
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        onShowSource={vi.fn()}
        statusReasonKey="ai.passageScoring.remoteAuthorizationRequired"
      />
    );
    expect(
      screen.getByText("ai.passageScoring.remoteAuthorizationRequired")
    ).toBeInTheDocument();
  });
});
