/**
 * Unit tests for the AskSheet "ask about this page" visible-section helper
 * (OpenSpec `mobile-ask-sheet-library-qa`, task 4.2).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { getVisibleSectionText } from "../askSheetHelpers";

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 300,
    width: 300,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function buildContainer(): HTMLElement {
  const container = document.createElement("div");
  container.setAttribute("data-document-scroll-container", "");
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 500));

  const above = document.createElement("p");
  above.textContent = "Above the viewport.";
  vi.spyOn(above, "getBoundingClientRect").mockReturnValue(rect(-100, -50));

  const visible = document.createElement("p");
  visible.textContent = "Visible section text about memory.";
  vi.spyOn(visible, "getBoundingClientRect").mockReturnValue(rect(100, 150));

  const below = document.createElement("p");
  below.textContent = "Below the viewport.";
  vi.spyOn(below, "getBoundingClientRect").mockReturnValue(rect(600, 650));

  container.append(above, visible, below);
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("getVisibleSectionText", () => {
  it("returns only the text intersecting the viewport, in order", () => {
    const container = buildContainer();
    expect(getVisibleSectionText(container)).toBe("Visible section text about memory.");
  });

  it("returns empty string without a container", () => {
    document.body.innerHTML = "";
    expect(getVisibleSectionText(null)).toBe("");
  });

  it("caps the context length", () => {
    const container = buildContainer();
    const long = "word ".repeat(1000);
    (container.children[1] as HTMLElement).textContent = long;
    const text = getVisibleSectionText(container, 100);
    expect(text.length).toBeLessThanOrEqual(100);
    expect(text).toContain("word");
  });
});
