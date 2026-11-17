import { describe, expect, it } from "vitest";
import {
  isDesktopSelectionInViewerContent,
  isMobileSelectionInViewerContent,
  shouldDismissViewerSelectionOnMouseDown,
} from "../documentSelectionBoundary";

function makeDomFixture() {
  const host = document.createElement("div");
  host.innerHTML = `
    <div id="viewer-root">
      <div data-document-content="true">
        <div class="prose"><p id="viewer-text">Document transcript text</p></div>
      </div>
    </div>
    <div data-assistant-panel="true">
      <div class="prose"><p id="assistant-text">Assistant response text</p></div>
    </div>
    <div data-extract-button="true"><button id="extract-btn">Create Extract</button></div>
    <div class="context-menu"><button id="ctx-item">Copy</button></div>
    <div role="dialog"><p id="dialog-text">Dialog</p></div>
  `;
  return {
    host,
    viewerRoot: host.querySelector("#viewer-root")!,
    viewerText: host.querySelector("#viewer-text")!.firstChild!,
    assistantText: host.querySelector("#assistant-text")!.firstChild!,
    extractBtn: host.querySelector("#extract-btn")!,
    ctxItem: host.querySelector("#ctx-item")!,
    dialogText: host.querySelector("#dialog-text")!,
  };
}

describe("documentSelectionBoundary", () => {
  it("ignores desktop selections anchored inside the Assistant panel", () => {
    const { viewerRoot, assistantText } = makeDomFixture();
    const selection = {
      rangeCount: 1,
      anchorNode: assistantText,
      focusNode: assistantText,
      toString: () => "Assistant response text",
    } as unknown as Selection;

    expect(isDesktopSelectionInViewerContent(selection, viewerRoot)).toBe(false);
  });

  it("accepts desktop selections anchored inside the DocumentViewer content root", () => {
    const { viewerRoot, viewerText } = makeDomFixture();
    const selection = {
      rangeCount: 1,
      anchorNode: viewerText,
      focusNode: viewerText,
      toString: () => "Document transcript text",
    } as unknown as Selection;

    expect(isDesktopSelectionInViewerContent(selection, viewerRoot)).toBe(true);
  });

  it("ignores mobile .prose selections inside the Assistant panel while accepting viewer .prose selections", () => {
    const { viewerRoot, viewerText, assistantText } = makeDomFixture();
    const assistantSelection = {
      rangeCount: 1,
      anchorNode: assistantText,
      focusNode: assistantText,
      toString: () => "Assistant response text",
    } as unknown as Selection;
    const viewerSelection = {
      rangeCount: 1,
      anchorNode: viewerText,
      focusNode: viewerText,
      toString: () => "Document transcript text",
    } as unknown as Selection;

    expect(isMobileSelectionInViewerContent(assistantSelection, viewerRoot)).toBe(false);
    expect(isMobileSelectionInViewerContent(viewerSelection, viewerRoot)).toBe(true);
  });

  it("does not dismiss viewer selection on mousedown inside the Assistant panel, extract button, dialog, or context menu", () => {
    const { viewerText, assistantText, extractBtn, ctxItem, dialogText } = makeDomFixture();

    expect(shouldDismissViewerSelectionOnMouseDown(assistantText.parentElement)).toBe(false);
    expect(shouldDismissViewerSelectionOnMouseDown(extractBtn)).toBe(false);
    expect(shouldDismissViewerSelectionOnMouseDown(ctxItem)).toBe(false);
    expect(shouldDismissViewerSelectionOnMouseDown(dialogText)).toBe(false);
    expect(shouldDismissViewerSelectionOnMouseDown(viewerText.parentElement)).toBe(true);
  });
});
