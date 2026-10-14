import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderHook } from "@testing-library/react";

vi.mock("../../lib/tauri", () => ({
  isTauri: () => false,
  listen: vi.fn(),
}));

import { useGlobalShortcuts } from "../useKeyboardShortcuts";

describe("global Dashboard shortcut", () => {
  afterEach(() => {
    cleanup();
  });

  it("routes the Dashboard shortcut through the shell navigation event", () => {
    const navigate = vi.fn();
    window.addEventListener("navigate", navigate);
    renderHook(() => useGlobalShortcuts());

    fireEvent.keyDown(window, { key: "d", ctrlKey: true });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toMatchObject({ type: "navigate", detail: "/dashboard" });
    window.removeEventListener("navigate", navigate);
  });
});
