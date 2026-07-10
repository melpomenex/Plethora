import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerContextualBackHandler,
  requestContextualBack,
  resetContextualBackHandlersForTests,
} from "../contextualBack";

describe("contextualBack", () => {
  beforeEach(() => resetContextualBackHandlersForTests());

  it("uses priority and stops after the first handler consumes back", () => {
    const lower = vi.fn(() => true);
    const higher = vi.fn(() => true);
    registerContextualBackHandler(lower, 1);
    registerContextualBackHandler(higher, 10);

    expect(requestContextualBack()).toBe(true);
    expect(higher).toHaveBeenCalledOnce();
    expect(lower).not.toHaveBeenCalled();
  });

  it("continues past handlers that decline and unregisters cleanly", () => {
    const consuming = vi.fn(() => true);
    registerContextualBackHandler(consuming, 1);
    const unregister = registerContextualBackHandler(() => false, 10);

    expect(requestContextualBack()).toBe(true);
    expect(consuming).toHaveBeenCalledOnce();
    unregister();
    consuming.mockClear();
    expect(requestContextualBack()).toBe(true);
    expect(consuming).toHaveBeenCalledOnce();
  });
});
