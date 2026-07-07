import { afterEach, describe, expect, it, vi } from "vitest";
import { copySelectionTextToClipboard } from "../SelectionPopup";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "clipboard");
const originalExecCommand = document.execCommand;

afterEach(() => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(Navigator.prototype, "clipboard", originalClipboardDescriptor);
  } else {
    delete (Navigator.prototype as Navigator & { clipboard?: Clipboard }).clipboard;
  }
  document.execCommand = originalExecCommand;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("copySelectionTextToClipboard", () => {
  it("copies trimmed selection text with the Clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(Navigator.prototype, "clipboard", {
      configurable: true,
      get: () => ({ writeText }),
    });

    await expect(copySelectionTextToClipboard("  selected PDF text  ")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("selected PDF text");
  });

  it("falls back to execCommand while preserving the existing DOM selection", async () => {
    Object.defineProperty(Navigator.prototype, "clipboard", {
      configurable: true,
      get: () => undefined,
    });
    document.execCommand = vi.fn().mockReturnValue(true);
    document.body.innerHTML = `<p id="text">Keep this range selected</p>`;
    const textNode = document.getElementById("text")?.firstChild;
    expect(textNode).toBeTruthy();
    if (!textNode) return;

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    await expect(copySelectionTextToClipboard("fallback text")).resolves.toBe(true);

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(window.getSelection()?.toString()).toBe("Keep");
  });

  it("does not copy empty selections", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(Navigator.prototype, "clipboard", {
      configurable: true,
      get: () => ({ writeText }),
    });

    await expect(copySelectionTextToClipboard("   ")).resolves.toBe(false);

    expect(writeText).not.toHaveBeenCalled();
  });
});
