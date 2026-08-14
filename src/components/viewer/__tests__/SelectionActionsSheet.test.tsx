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

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: () => availability,
}));
vi.mock("../../../lib/ai/passageAI", () => passage);
vi.mock("../../../lib/ai/provider", () => ({ hasCloudProvider: () => true }));
vi.mock("../../../lib/ai/onDeviceAI", () => ({
  getOnDeviceRequirementStatus: vi.fn(async () => ({ status: "unavailable" })),
  isOnDeviceAiSupportedPlatform: () => false,
  requestModelDownload: vi.fn(),
  toOnDeviceAiError: (e: unknown) => e as Error,
}));
vi.mock("../SelectionPopup", () => ({
  copySelectionTextToClipboard: vi.fn(async () => true),
}));

import { SelectionActionsSheet } from "../SelectionActionsSheet";

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
  passage.explainPassage.mockResolvedValue({ text: "An explanation.", truncated: false });
});

describe("SelectionActionsSheet", () => {
  it("shows the selection and its actions when open", () => {
    renderSheet();
    expect(screen.getByText("The heart pumps blood.")).toBeTruthy();
    expect(screen.getByText("selectionSheet.createExtract")).toBeTruthy();
    expect(screen.getByText("selectionSheet.explain")).toBeTruthy();
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
});
