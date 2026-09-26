import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const availability = vi.hoisted(() => ({ path: "cloud", available: true, loading: false }));
const passage = vi.hoisted(() => ({
  explainPassage: vi.fn(),
  summarizePassage: vi.fn(),
  simplifyPassage: vi.fn(),
  keyTermsPassage: vi.fn(),
  answerPassage: vi.fn(),
}));
const featureFlags = vi.hoisted(() => ({ aiLearnThis: false, aiLibraryRag: false }));

const warmUpOnDevicePrompt = vi.fn(async () => {});
const isOnDeviceAiSupportedPlatform = vi.fn(() => false);

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: { settings: { features: typeof featureFlags } }) => unknown) =>
    selector({ settings: { features: featureFlags } }),
}));
vi.mock("../../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: () => availability,
}));
vi.mock("../../../lib/ai/passageAI", () => passage);
vi.mock("../../../lib/ai/provider", async (importOriginal) => ({
  // Partial mock: only force provider presence; keep the real
  // `canOfferCloudRetryForSafety`/`requestCloudFallback` used by the failure path.
  ...(await importOriginal<object>()),
  hasCloudProvider: () => true,
}));
vi.mock("../../../lib/ai/onDeviceAI", async (importOriginal) => ({
  // Keep the real error taxonomy exports (`OnDeviceAiError`,
  // `ON_DEVICE_AI_ERROR_CODES`) — the real lib/ai/errors.ts branches on them
  // when mapping a failed action, and a bare mock makes that mapping throw.
  ...(await importOriginal<object>()),
  getOnDeviceRequirementStatus: vi.fn(async () => ({ status: "unavailable" })),
  isOnDeviceAiSupportedPlatform: () => isOnDeviceAiSupportedPlatform(),
  requestModelDownload: vi.fn(),
  toOnDeviceAiError: (e: unknown) => e as Error,
  warmUpOnDevicePrompt: () => warmUpOnDevicePrompt(),
}));
const askLibrary = vi.hoisted(() => ({
  ask: vi.fn(async () => {}),
  reset: vi.fn(),
  running: false,
  error: null as string | null,
  result: null as unknown,
}));
vi.mock("../../../lib/ai/useAskLibrary", () => ({
  useAskLibrary: () => askLibrary,
}));
vi.mock("../../../utils/openLibrarySource", () => ({
  openLibrarySource: vi.fn(async () => {}),
}));
vi.mock("../SelectionPopup", () => ({
  copySelectionTextToClipboard: vi.fn(async () => true),
}));
vi.mock("../../learn/LearnThisProposalSheet", () => ({
  LearnThisProposalSheet: (props: { passage: string; documentId?: string }) => (
    <div
      data-testid="learn-this-stub"
      data-passage={props.passage}
      data-document-id={props.documentId ?? ""}
    />
  ),
}));

import { SelectionActionsSheet, passageAroundSelection } from "../SelectionActionsSheet";

describe("passageAroundSelection", () => {
  function selectionIn(html: string, selector: string): Selection {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const target = host.querySelector(selector)!;
    return { anchorNode: target.firstChild } as unknown as Selection;
  }

  it("returns the surrounding text of a known content container for short selection", () => {
    const selection = selectionIn(
      `<div class="prose"><p>Before it. <em data-sel="a">the selection</em> After it.</p></div>`,
      "[data-sel='a']"
    );
    const passage = passageAroundSelection(selection, "the selection");
    expect(passage).toContain("Before it.");
    expect(passage).toContain("After it.");
  });

  it("returns self-contained text directly without surrounding context for long selections", () => {
    const longText = "This is a very long paragraph that contains more than one hundred and fifty characters to test that the adaptive context windowing does not prepend or append redundant surrounding characters when the user selects a full block.";
    expect(longText.length).toBeGreaterThanOrEqual(150);
    const selection = selectionIn(
      `<div class="prose"><p>Pre-header context. <em data-sel="long">${longText}</em> Post-footer context.</p></div>`,
      "[data-sel='long']"
    );
    const passage = passageAroundSelection(selection, longText);
    expect(passage).toBe(longText);
    expect(passage).not.toContain("Pre-header context.");
    expect(passage).not.toContain("Post-footer context.");
  });

  it("does not sweep in app chrome when the selection is outside any content container", () => {
    const selection = selectionIn(
      `<nav>Dashboard Queue Review</nav><span data-sel="b">the selection</span>`,
      "[data-sel='b']"
    );
    // No content container in the top-level document → selection only.
    expect(passageAroundSelection(selection, "the selection")).toBe("the selection");
  });
});

function renderSheet(props: Partial<Parameters<typeof SelectionActionsSheet>[0]> = {}) {
  return render(
    <SelectionActionsSheet
      open
      text="The heart pumps blood."
      onClose={vi.fn()}
      onCreateExtract={vi.fn()}
      {...props}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  availability.available = true;
  availability.path = "cloud";
  featureFlags.aiLearnThis = false;
  featureFlags.aiLibraryRag = false;
  askLibrary.result = null;
  askLibrary.error = null;
  askLibrary.running = false;
  passage.explainPassage.mockResolvedValue({ text: "An explanation.", truncated: false });
});

describe("SelectionActionsSheet", () => {
  it("shows the selection and its actions when open", () => {
    renderSheet();
    expect(screen.getByText("The heart pumps blood.")).toBeTruthy();
    expect(screen.getByText("selectionSheet.createExtract")).toBeTruthy();
    expect(screen.getByText("selectionSheet.explain")).toBeTruthy();
  });

  it("records a content-free usage signal when a row is invoked (D8)", async () => {
    const { useSelectionActionUsageStore } = await import(
      "../selectionInteraction/selectionActionUsage"
    );
    useSelectionActionUsageStore.getState().resetUsage();

    renderSheet();
    fireEvent.click(screen.getByText("selectionSheet.explain"));
    await waitFor(() => expect(screen.getByText("An explanation.")).toBeTruthy());
    expect(useSelectionActionUsageStore.getState().counts.explain).toBe(1);

    // The recorded state is action ids only — never the selected text.
    expect(JSON.stringify(useSelectionActionUsageStore.getState().counts)).not.toContain(
      "The heart pumps blood"
    );
    useSelectionActionUsageStore.getState().resetUsage();
  });

  it("hides the AI rows when no AI path is available", () => {
    availability.available = false;
    availability.path = "none";
    renderSheet();
    expect(screen.queryByText("selectionSheet.explain")).toBeNull();
    expect(screen.getByText("selectionSheet.createExtract")).toBeTruthy();
  });

  it("renders the result of an action", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("selectionSheet.explain"));
    await waitFor(() => expect(screen.getByText("An explanation.")).toBeTruthy());
    expect(passage.explainPassage).toHaveBeenCalledTimes(1);
  });

  it("re-runs the action on retry", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("selectionSheet.explain"));
    await waitFor(() => expect(screen.getByText("An explanation.")).toBeTruthy());

    passage.explainPassage.mockResolvedValue({ text: "A second explanation.", truncated: false });
    fireEvent.click(screen.getByText("selectionSheet.retry"));
    await waitFor(() => expect(screen.getByText("A second explanation.")).toBeTruthy());
    expect(passage.explainPassage).toHaveBeenCalledTimes(2);
  });

  it("renders markdown in the result", async () => {
    passage.explainPassage.mockResolvedValue({
      text: "**Bold term**: A clear structure is essential.",
      truncated: false,
    });
    renderSheet();
    fireEvent.click(screen.getByText("selectionSheet.explain"));
    await waitFor(() => expect(screen.getByText("Bold term")).toBeTruthy());
    expect(screen.getByText("Bold term").tagName).toBe("STRONG");
  });

  it("shows the failure with a retry action", async () => {
    passage.explainPassage.mockRejectedValue(new Error("boom"));
    renderSheet();
    fireEvent.click(screen.getByText("selectionSheet.explain"));
    await waitFor(() => expect(screen.getByText("selectionSheet.error")).toBeTruthy());
    expect(screen.getByText("selectionSheet.retry")).toBeTruthy();
  });

  it("runs initialAction immediately and skips the action list", async () => {
    renderSheet({ initialAction: "explain" });
    await waitFor(() => expect(screen.getByText("An explanation.")).toBeTruthy());
    expect(passage.explainPassage).toHaveBeenCalledTimes(1);
    // No menu to fall back to, so the list rows are never rendered.
    expect(screen.queryByText("selectionSheet.createExtract")).toBeNull();
  });

  it("closes instead of returning to the list when driven by initialAction", async () => {
    const onClose = vi.fn();
    renderSheet({ initialAction: "explain", onClose });
    await waitFor(() => expect(screen.getByText("An explanation.")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("selectionSheet.back"));
    expect(onClose).toHaveBeenCalled();
  });

  it("aborts the in-flight request when the sheet closes and drops its result", async () => {
    let signal: AbortSignal | undefined;
    let resolve: ((value: unknown) => void) | undefined;
    passage.explainPassage.mockImplementation((_text: string, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise((r) => {
        resolve = r;
      });
    });

    const { rerender } = renderSheet();
    fireEvent.click(screen.getByText("selectionSheet.explain"));
    await waitFor(() => expect(signal).toBeDefined());

    rerender(
      <SelectionActionsSheet
        open={false}
        text="The heart pumps blood."
        onClose={vi.fn()}
        onCreateExtract={vi.fn()}
      />
    );
    expect(signal?.aborted).toBe(true);

    // A late resolution after the abort must not resurrect the result view.
    resolve?.({ text: "Too late.", truncated: false });
    await waitFor(() => expect(screen.queryByText("Too late.")).toBeNull());
    // Only the on-device attempt ran; no second (cloud) call was made.
    expect(passage.explainPassage).toHaveBeenCalledTimes(1);
  });

  it("triggers speculative warmup when on-device AI is supported and available", () => {
    isOnDeviceAiSupportedPlatform.mockReturnValue(true);
    renderSheet();
    expect(warmUpOnDevicePrompt).toHaveBeenCalled();
  });

  it("hides 'Learn this' when the feature flag is off", () => {
    featureFlags.aiLearnThis = false;
  featureFlags.aiLibraryRag = false;
  askLibrary.result = null;
  askLibrary.error = null;
  askLibrary.running = false;
    renderSheet();
    expect(screen.queryByText("aiLearning.learnThis")).toBeNull();
  });

  it("hides 'Learn this' without the generative capability even when flagged on", () => {
    featureFlags.aiLearnThis = true;
    availability.available = false;
    availability.path = "none";
    renderSheet();
    expect(screen.queryByText("aiLearning.learnThis")).toBeNull();
  });

  it("opens the proposal sheet from the 'Learn this' row with document context", () => {
    featureFlags.aiLearnThis = true;
    renderSheet({
      passage: "The heart pumps blood through the body.",
      learnThis: { documentId: "doc-1", documentTitle: "Biology" },
    });
    fireEvent.click(screen.getByText("aiLearning.learnThis"));
    const stub = screen.getByTestId("learn-this-stub") as HTMLElement;
    expect(stub.dataset.passage).toBe("The heart pumps blood through the body.");
    expect(stub.dataset.documentId).toBe("doc-1");
  });

  it("hides 'Ask library' when the feature flag is off", () => {
    featureFlags.aiLibraryRag = false;
    renderSheet();
    expect(screen.queryByText("aiLibrary.askLibrary")).toBeNull();
  });

  it("hides 'Ask library' without the generative capability even when flagged on", () => {
    featureFlags.aiLibraryRag = true;
    availability.available = false;
    availability.path = "none";
    renderSheet();
    expect(screen.queryByText("aiLibrary.askLibrary")).toBeNull();
  });

  it("asks the library with the selection as untrusted context", async () => {
    featureFlags.aiLibraryRag = true;
    renderSheet({ passage: "The heart pumps blood through the body." });
    fireEvent.click(screen.getByText("aiLibrary.askLibrary"));
    fireEvent.change(screen.getByPlaceholderText("aiLibrary.selectionPlaceholder"), {
      target: { value: "Where else is the heart discussed?" },
    });
    fireEvent.click(screen.getByText("aiLibrary.ask"));
    await waitFor(() =>
      expect(askLibrary.ask).toHaveBeenCalledWith("Where else is the heart discussed?", {
        contextPassage: "The heart pumps blood through the body.",
      })
    );
  });

  it("renders the library answer with an evidence badge and source chips", async () => {
    featureFlags.aiLibraryRag = true;
    askLibrary.result = {
      answer: {
        answer: "In your biology notes [1].",
        sourceRefs: [{ refId: "c1", quote: "pumps blood" }],
        evidenceLevel: "supported",
      },
      sources: [
        {
          chunkId: "c1",
          documentId: "doc-1",
          documentTitle: "Biology",
          sourceType: "document",
          text: "The heart pumps blood.",
          headingPath: [],
          location: { sourceType: "text", documentId: "doc-1", ordinal: 0, startOffset: 0, endOffset: 20 },
          score: 0.9,
        },
      ],
      droppedChunks: 0,
      mode: "semantic",
      candidatesScanned: 5,
      run: {},
    };
    renderSheet();
    fireEvent.click(screen.getByText("aiLibrary.askLibrary"));
    expect(screen.getByText("aiLibrary.evidence_supported")).toBeTruthy();
    expect(screen.getByText("Biology")).toBeTruthy();
    expect(screen.getByText("aiLibrary.cloud")).toBeTruthy();
  });

  it("handles onCreateExtractFromResult with single-submit disabling and success settlement", async () => {
    let resolveExtract: ((value: unknown) => void) | undefined;
    const onCreateExtractFromResult = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveExtract = resolve;
        })
    );
    const onClose = vi.fn();
    const onSettled = vi.fn();

    renderSheet({
      initialAction: "explain",
      onCreateExtractFromResult: onCreateExtractFromResult as never,
      onClose,
      onSettled,
      operationId: "op-123",
    });

    await waitFor(() => expect(screen.getByText("An explanation.")).toBeTruthy());

    const extractBtn = screen.getByText("selectionSheet.createExtractFromResult");
    expect(extractBtn).toBeInTheDocument();
    expect(extractBtn).not.toBeDisabled();

    fireEvent.click(extractBtn);

    // Button transitions into saving state and is disabled to prevent duplicate submissions
    expect(onCreateExtractFromResult).toHaveBeenCalledWith("An explanation.");
    expect(extractBtn).toBeDisabled();

    // Resolving with a created extract settles the operation and closes the sheet
    resolveExtract?.({ id: "ext-1", content: "An explanation." });

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledWith("op-123", "success");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("handles onCreateExtractFromResult failure by keeping output and allowing retry", async () => {
    const onCreateExtractFromResult = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network failure"))
      .mockResolvedValueOnce({ id: "ext-2", content: "An explanation." });
    const onClose = vi.fn();
    const onSettled = vi.fn();

    renderSheet({
      initialAction: "explain",
      onCreateExtractFromResult: onCreateExtractFromResult as never,
      onClose,
      onSettled,
      operationId: "op-456",
    });

    await waitFor(() => expect(screen.getByText("An explanation.")).toBeTruthy());

    const extractBtn = screen.getByText("selectionSheet.createExtractFromResult");
    fireEvent.click(extractBtn);

    // Fails on first attempt: output is preserved and retry button is shown
    await waitFor(() => {
      expect(screen.getByText("selectionSheet.retryCreateExtract")).toBeInTheDocument();
    });
    expect(screen.getByText("An explanation.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Retry succeeds
    fireEvent.click(screen.getByText("selectionSheet.retryCreateExtract"));
    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledWith("op-456", "success");
      expect(onClose).toHaveBeenCalled();
    });
  });
});
