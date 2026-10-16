import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerDictationButton } from "../ComposerDictationControl";
import type { ComposerDictation } from "../../../hooks/useComposerDictation";

function makeDictation(overrides: Partial<ComposerDictation> = {}): ComposerDictation {
  return {
    phase: "idle",
    capability: null,
    error: null,
    needsConsent: false,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(),
    onEdit: vi.fn(),
    disabled: false,
    ...overrides,
  };
}

describe("ComposerDictationButton", () => {
  it("renders only the trigger in the bar and announces status through a live region", () => {
    const { container } = render(<ComposerDictationButton dictation={makeDictation({ phase: "listening" })} />);
    const status = screen.getByRole("status");
    expect(status).toHaveClass("sr-only");
    expect(status).toHaveTextContent("Listening. Stop to insert text.");
    // No visible status text outside the trigger or the hidden live region.
    const visibleText = Array.from(container.querySelectorAll<HTMLElement>(":scope > *:not(.sr-only), button"))
      .map((element) => element.textContent ?? "")
      .join(" ");
    expect(visibleText).not.toContain("Listening");
  });

  it("announces errors without a persistent status row", () => {
    const { container } = render(<ComposerDictationButton dictation={makeDictation({ error: "Microphone permission denied." })} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Microphone permission denied.");
    expect(container.querySelectorAll("p, span:not(.sr-only)")).toHaveLength(0);
  });

  it("keeps the stop affordance and consent dialog wiring", () => {
    const dictation = makeDictation({ phase: "starting", needsConsent: true });
    render(<ComposerDictationButton dictation={dictation} />);
    // A starting session cancels instead of stopping.
    screen.getByRole("button", { name: "Stop dictation" }).click();
    expect(dictation.cancel).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Speech processing");
  });
});
