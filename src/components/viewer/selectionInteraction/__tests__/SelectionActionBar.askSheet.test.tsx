/**
 * Mobile single-Ask action bar (OpenSpec `mobile-ask-sheet-library-qa`,
 * task 4.1): on mobile viewports with the AskSheet flag on, selecting text
 * surfaces exactly one primary action (Ask) plus the overflow control —
 * no horizontal scrolling to reach Ask.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SelectionActionBar } from "../SelectionActionBar";

vi.mock("../../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const mobileState = vi.hoisted(() => ({ isMobile: true }));
vi.mock("../../../../hooks/useMobileShell", () => ({
  useMobileShell: () => mobileState.isMobile,
}));

const featureState = vi.hoisted(() => ({ askSheetMobile: true }));
vi.mock("../../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: { settings: { features: typeof featureState } }) => unknown) =>
    selector({ settings: { features: featureState } }),
}));

vi.mock("../../../../contexts/PresentationContext", () => ({
  usePresentation: () => ({ reducedMotion: true }),
}));

vi.mock("../../../../hooks/useOverlayDismissal", () => ({
  useOverlayDismissal: () => {},
}));

const PLACEMENT = { top: 100, left: 20, maxWidth: 280, placement: "above" } as const;

describe("SelectionActionBar mobile single-Ask (task 4.1)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    mobileState.isMobile = true;
    featureState.askSheetMobile = true;
  });

  it("shows only Ask + overflow on mobile when the flag is on", () => {
    const onAction = vi.fn();
    const onOverflow = vi.fn();
    render(
      <SelectionActionBar
        placement={{ ...PLACEMENT }}
        onAction={onAction}
        onOverflow={onOverflow}
        onDismiss={() => {}}
      />,
    );
    const bar = screen.getByRole("toolbar");
    const buttons = bar.querySelectorAll("button");
    // Exactly two chips: Ask (primary) and ⋯ (overflow).
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toContain("selectionBar.ask");
    expect(buttons[1].textContent).toContain("selectionBar.more");

    buttons[0].click();
    expect(onAction).toHaveBeenCalledWith("ask");
    buttons[1].click();
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });

  it("keeps the full chip row when the flag is off", () => {
    featureState.askSheetMobile = false;
    render(
      <SelectionActionBar
        placement={{ ...PLACEMENT }}
        onAction={() => {}}
        onOverflow={() => {}}
        onDismiss={() => {}}
      />,
    );
    const buttons = screen.getByRole("toolbar").querySelectorAll("button");
    // Full row: Summarize, Explain, Ask, Extract, Copy, ⋯ (more than 2).
    expect(buttons.length).toBeGreaterThan(2);
  });

  it("keeps the full chip row on desktop even when the flag is on", () => {
    mobileState.isMobile = false;
    render(
      <SelectionActionBar
        placement={{ ...PLACEMENT }}
        onAction={() => {}}
        onOverflow={() => {}}
        onDismiss={() => {}}
      />,
    );
    const buttons = screen.getByRole("toolbar").querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(2);
  });
});
