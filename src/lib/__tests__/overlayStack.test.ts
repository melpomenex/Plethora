import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerOverlayDismissal,
  requestOverlayBack,
  resetOverlayStackForTests,
} from "../overlayStack";

describe("overlayStack", () => {
  beforeEach(resetOverlayStackForTests);

  it("dismisses the newest overlay first at equal priority", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerOverlayDismissal(first);
    registerOverlayDismissal(second);

    expect(requestOverlayBack()).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("dismisses higher-priority modal surfaces before lower layers", () => {
    const drawer = vi.fn();
    const modal = vi.fn();
    registerOverlayDismissal(drawer, 10);
    registerOverlayDismissal(modal, 100);

    requestOverlayBack();

    expect(modal).toHaveBeenCalledOnce();
    expect(drawer).not.toHaveBeenCalled();
  });

  it("returns false when no overlay owns the back action", () => {
    expect(requestOverlayBack()).toBe(false);
  });
});

