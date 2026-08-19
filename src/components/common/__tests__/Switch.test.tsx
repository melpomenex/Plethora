/**
 * Switch component tests (#15): the shared Plethora switch used for the
 * Hands-Free Study Mode toggle. Covers proportions, theme tokens, on/off
 * aria-checked state, keyboard operation, and the ≥44px touch target.
 */

import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen, userEvent } from "../../../test/utils";
import { Switch } from "../Switch";

function renderSwitch(checked = false, props: Partial<ComponentProps<typeof Switch>> = {}) {
  const onChange = vi.fn();
  render(
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      aria-label="Enable Hands-Free Study Mode"
      {...props}
    />
  );
  return { onChange };
}

describe("Switch (Hands-Free Study Mode toggle)", () => {
  it("exposes role=switch with aria-checked matching the checked state", () => {
    renderSwitch(false);
    let sw = screen.getByRole("switch", { name: "Enable Hands-Free Study Mode" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).not.toBeChecked();

    renderSwitch(true);
    sw = screen.getAllByRole("switch")[1];
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(sw).toBeChecked();
  });

  it("has standard switch proportions and theme tokens (44x24 pill, 20px knob)", () => {
    renderSwitch();
    const pill = document.querySelector("label > div") as HTMLElement;
    expect(pill).not.toBeNull();
    for (const cls of [
      "h-6", // 24px tall pill
      "w-11", // 44px wide pill
      "rounded-full",
      "bg-muted", // off track
      "peer-checked:bg-primary", // on track
      "after:h-5", // 20px knob
      "after:w-5",
      "after:bg-white", // opaque knob (theme-independent)
    ]) {
      expect(pill.className).toContain(cls);
    }
  });

  it("toggles via click and reports the new state", async () => {
    const { onChange } = renderSwitch(false);
    const sw = screen.getByRole("switch");
    await userEvent.click(sw, { pointerEventsCheck: 0 });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("toggles via keyboard (Space) when focused", () => {
    const { onChange } = renderSwitch(false);
    const sw = screen.getByRole("switch");
    sw.focus();
    fireEvent.keyDown(sw, { key: " " });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("keeps a >=44px touch target when touchTarget is set", () => {
    renderSwitch(false, { touchTarget: true });
    const label = screen.getByRole("switch").closest("label") as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.className).toContain("min-h-[44px]");
    expect(label.className).toContain("min-w-[44px]");
  });

  it("stays interactive and keyboard-operable without a touch target (desktop)", () => {
    const { onChange } = renderSwitch(false, { touchTarget: false });
    const sw = screen.getByRole("switch");
    sw.focus();
    fireEvent.keyDown(sw, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not fire when disabled", async () => {
    const { onChange } = renderSwitch(false, { disabled: true });
    const sw = screen.getByRole("switch");
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });
});
