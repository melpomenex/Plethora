import { describe, expect, it } from "vitest";
import { canActivateDocumentVim } from "../focusEligibility";

describe("document Vim focus eligibility", () => {
  it("rejects editable fields and dialogs", () => {
    const input = document.createElement("input"); document.body.appendChild(input);
    input.focus();
    expect(canActivateDocumentVim(new KeyboardEvent("keydown"))).toBe(false);
    input.remove();
  });
  it("rejects modal state and composition", () => {
    expect(canActivateDocumentVim(new KeyboardEvent("keydown"), true)).toBe(false);
    expect(canActivateDocumentVim(new KeyboardEvent("keydown", { isComposing: true }))).toBe(false);
  });
});
