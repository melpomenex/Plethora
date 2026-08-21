import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateExtractDialog } from "../CreateExtractDialog";

const mocks = vi.hoisted(() => ({
  createExtract: vi.fn(),
  onClose: vi.fn(),
  documents: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../api/extracts", () => ({
  createExtract: mocks.createExtract,
}));
vi.mock("../../../api/learning-items", () => ({
  generateLearningItemsFromExtract: vi.fn(),
}));
vi.mock("../../../api/image-registry", () => ({
  ingestRemoteImage: vi.fn(),
  ingestImageFile: vi.fn(),
  getImageAssetById: vi.fn(),
}));
vi.mock("../../../utils/screenshotCapture", () => ({
  captureAppWindowRegion: vi.fn(),
  saveScreenshotToRegistry: vi.fn(),
}));
vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
}));
vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: () => ({ documents: mocks.documents }),
}));
// Real i18n labels would be nicer, but the component suite already
// standardizes on raw keys; keep queries key-based and unambiguous.
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("../ClozeCreatorPopup", () => ({ ClozeCreatorPopup: () => null }));
vi.mock("../QACreatorPopup", () => ({ QACreatorPopup: () => null }));
vi.mock("../../image-registry/ImageRegistryLibrary", () => ({
  ImageRegistryLibrary: () => null,
}));

function renderDialog(props: Partial<Parameters<typeof CreateExtractDialog>[0]> = {}) {
  return render(
    <CreateExtractDialog
      documentId="document-1"
      selectedText="Selected passage"
      isOpen
      onClose={props.onClose ?? mocks.onClose}
      {...props}
    />,
  );
}

const onClose = vi.fn();

describe("CreateExtractDialog mobile overlay contract", () => {
  beforeEach(() => {
    mocks.createExtract.mockReset();
    mocks.createExtract.mockResolvedValue({ id: "extract-1" });
    mocks.documents.length = 0;
    onClose.mockClear();
  });

  it("mounts through the shared overlay layer above application chrome", () => {
    const { container } = renderDialog();

    // Portaled to document.body — not nested in the local container.
    expect(container.querySelector(".adaptive-dialog-layer")).toBeNull();
    const layer = document.body.querySelector(":scope > .adaptive-dialog-layer");
    expect(layer).not.toBeNull();
    expect(layer!.parentElement).toBe(document.body);

    // Panel uses the centralized sheet token class, not an ad-hoc z-index.
    const panel = document.querySelector('[role="dialog"].adaptive-dialog-panel');
    expect(panel).not.toBeNull();
    expect(panel!.className).not.toMatch(/z-\[/);
  });

  it("keeps every action reachable in the responsive footer grid", () => {
    renderDialog();

    for (const label of [
      "common.cancel",
      "extracts.createExtract",
      "extracts.createAndGenerate",
      "extracts.createAndCloze",
      "extracts.createAndQA",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    // Single non-wrapping row replaced by a wrapping grid on phones.
    const footerGrid = screen.getByText("extracts.createExtract").closest("div");
    expect(footerGrid?.className).toContain("grid-cols-2");
  });

  it("sizes against dynamic viewport height instead of a vh max-height", () => {
    renderDialog();
    const panel = document.querySelector('[role="dialog"].adaptive-dialog-panel') as HTMLElement;
    // The dvh/app-viewport cap comes from .adaptive-dialog-panel CSS.
    expect(panel.className).not.toContain("max-h-[90vh]");
    expect(panel.style.maxHeight).toBe("");
  });

  it("pads the footer past the bottom safe-area inset", () => {
    renderDialog();
    const panel = document.querySelector('[role="dialog"].adaptive-dialog-panel')!;
    const footer = panel.lastElementChild as HTMLElement;
    expect(footer.className).toContain("env(safe-area-inset-bottom)");
  });

  it("keeps body content independently scrollable from header and footer", () => {
    renderDialog();
    const panel = document.querySelector('[role="dialog"].adaptive-dialog-panel')!;
    const scrollable = Array.from(panel.querySelectorAll("div")).find((el) =>
      el.className.includes("overflow-y-auto"),
    );
    expect(scrollable).toBeTruthy();
  });

  it("closes on Escape through the shared dismissal stack and restores focus", async () => {
    renderDialog({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("traps Tab focus inside the dialog while open", () => {
    renderDialog({ onClose });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    const FOCUSABLE =
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    // Wrap forward from the last focusable to the first...
    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
    // ...and backward from the first to the last.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });
});
