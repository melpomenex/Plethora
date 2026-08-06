import { describe, it, expect } from "vitest";
import { shouldAutoExtract } from "../extractModeGate";

const base = {
  isExtractMode: true,
  viewMode: "document",
  selectedText: "a passage worth keeping",
  busy: false,
};

describe("Extract Mode gate (extract-mode-toggle)", () => {
  it("extracts a selection when the mode is on", () => {
    expect(shouldAutoExtract(base)).toBe(true);
  });

  it("does not extract when the mode is off", () => {
    // This is the bug the change fixes: isExtractMode used to be read only for
    // styling, so the toggle changed the cursor and nothing else.
    expect(shouldAutoExtract({ ...base, isExtractMode: false })).toBe(false);
  });

  it("ignores an empty or whitespace-only selection", () => {
    expect(shouldAutoExtract({ ...base, selectedText: "" })).toBe(false);
    expect(shouldAutoExtract({ ...base, selectedText: "   \n\t " })).toBe(false);
  });

  it("only applies in the document view mode", () => {
    expect(shouldAutoExtract({ ...base, viewMode: "extracts" })).toBe(false);
    expect(shouldAutoExtract({ ...base, viewMode: "cards" })).toBe(false);
  });

  it("does not re-enter while an extract is already in flight", () => {
    // Creating an extract highlights the text, which re-fires the viewer's
    // selection callbacks; without this guard the passage extracts twice.
    expect(shouldAutoExtract({ ...base, busy: true })).toBe(false);
  });
});
