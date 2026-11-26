import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { computeClampedPopoverLeft } from "../useViewportClampedPopover";
import { TimeboxSessionLauncher } from "../TimeboxSessionLauncher";
import { QueueProvenancePill } from "../QueueProvenancePill";

describe("computeClampedPopoverLeft", () => {
  it("returns null when popover or viewport width is unmeasured", () => {
    expect(computeClampedPopoverLeft(100, 0, 390)).toBeNull();
    expect(computeClampedPopoverLeft(100, 256, 0)).toBeNull();
  });

  it("keeps anchor-aligned left when popover fits within viewport margins", () => {
    // Anchor at x=60, popover 256px wide, 390px viewport -> [60, 316] fits within [16, 374]
    expect(computeClampedPopoverLeft(60, 256, 390)).toBe(0);
  });

  it("clamps left edge to viewport margin when anchor is too far left", () => {
    expect(computeClampedPopoverLeft(4, 256, 390)).toBe(12);
  });

  it("shifts popover left when anchor + popover width would overflow right edge on mobile", () => {
    // Anchor at x=155, popover 352px wide, 390px viewport -> maxLeft = 390 - 352 - 16 = 22
    // offset = 22 - 155 = -133
    expect(computeClampedPopoverLeft(155, 352, 390)).toBe(-133);
  });
});

describe("mobile popover clamping in TimeboxSessionLauncher and QueueProvenancePill", () => {
  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
    vi.restoreAllMocks();
  });

  it("keeps TimeboxSessionLauncher menu inside mobile viewport", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 390,
    });

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute("role") === "menu") {
        return { left: 60, right: 316, width: 256, top: 60, bottom: 260, height: 200, x: 60, y: 60, toJSON: () => ({}) };
      }
      return { left: 60, right: 98, width: 38, top: 16, bottom: 52, height: 36, x: 60, y: 16, toJSON: () => ({}) };
    });

    render(
      <TimeboxSessionLauncher
        activePreset={null}
        onSelectPreset={vi.fn()}
        onClearPreset={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Timebox playlist presets" }));
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("0px");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shifts QueueProvenancePill popover left so it does not overflow mobile right edge", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 390,
    });

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute("data-provenance-popover") === "true") {
        return { left: 155, right: 507, width: 352, top: 60, bottom: 320, height: 260, x: 155, y: 60, toJSON: () => ({}) };
      }
      return { left: 155, right: 374, width: 219, top: 16, bottom: 56, height: 40, x: 155, y: 16, toJSON: () => ({}) };
    });

    const { container } = render(
      <QueueProvenancePill
        isMobile
        info={{
          itemId: "ext-1",
          itemType: "extract",
          orderingMode: "adaptive",
          algorithmType: "fsrs",
          prioritySlider: 50,
          priorityExplicitlySet: true,
        }}
      />
    );

    const pill = container.querySelector<HTMLButtonElement>("[data-queue-provenance-pill='true']");
    fireEvent.click(pill!);

    const popover = container.querySelector<HTMLElement>("[data-provenance-popover='true']");
    expect(popover).toBeInTheDocument();
    expect(popover!.style.left).toBe("-133px");
  });
});
