import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MouseEvent as ReactMouseEvent } from "react";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  platform: vi.fn(() => "linux"),
  startDragging: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
}));

vi.mock("../tauri", () => ({ isTauri: mocks.isTauri }));

vi.mock("@tauri-apps/plugin-os", () => ({ platform: mocks.platform }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: mocks.startDragging,
    toggleMaximize: mocks.toggleMaximize,
  }),
}));

import {
  handleWindowDragRequest,
  isCustomChromeDragActive,
} from "../windowDrag";

type DragEventOverrides = {
  button?: number;
  detail?: number;
  target?: EventTarget | null;
  currentTarget?: EventTarget | null;
};

function dragEvent({
  button = 0,
  detail = 1,
  target,
  currentTarget,
}: DragEventOverrides = {}): ReactMouseEvent<HTMLElement> {
  const resolvedTarget = target ?? currentTarget ?? document.createElement("div");
  const resolvedCurrentTarget = currentTarget ?? resolvedTarget;
  return {
    button,
    detail,
    target: resolvedTarget,
    currentTarget: resolvedCurrentTarget,
  } as unknown as ReactMouseEvent<HTMLElement>;
}

function activeChrome(): void {
  mocks.isTauri.mockReturnValue(true);
  mocks.platform.mockReturnValue("linux");
}

beforeEach(() => {
  vi.clearAllMocks();
  activeChrome();
});

describe("isCustomChromeDragActive", () => {
  it("is true only for Linux desktop Tauri", () => {
    expect(isCustomChromeDragActive()).toBe(true);
  });

  it("is false outside Tauri", () => {
    mocks.isTauri.mockReturnValue(false);
    expect(isCustomChromeDragActive()).toBe(false);
  });

  it("is false on non-Linux platforms", () => {
    mocks.platform.mockReturnValue("darwin");
    expect(isCustomChromeDragActive()).toBe(false);
  });

  it("is false when the OS plugin throws", () => {
    mocks.platform.mockImplementation(() => {
      throw new Error("plugin unavailable");
    });
    expect(isCustomChromeDragActive()).toBe(false);
  });
});

describe("handleWindowDragRequest", () => {
  it("starts a drag for a primary-button mousedown on the exact surface", () => {
    handleWindowDragRequest(dragEvent());

    expect(mocks.startDragging).toHaveBeenCalledTimes(1);
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();
  });

  it("ignores non-primary buttons", () => {
    handleWindowDragRequest(dragEvent({ button: 1 }));
    handleWindowDragRequest(dragEvent({ button: 2 }));

    expect(mocks.startDragging).not.toHaveBeenCalled();
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();
  });

  it("toggles maximize on double-click instead of dragging", () => {
    handleWindowDragRequest(dragEvent({ detail: 2 }));

    expect(mocks.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(mocks.startDragging).not.toHaveBeenCalled();
  });

  it("rejects events whose target is not the marked surface itself", () => {
    const surface = document.createElement("div");
    const child = document.createElement("span");
    surface.appendChild(child);

    handleWindowDragRequest(
      dragEvent({ target: child, currentTarget: surface }),
    );

    expect(mocks.startDragging).not.toHaveBeenCalled();
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();
  });

  it("rejects targets inside interactive elements (defense-in-depth)", () => {
    const button = document.createElement("button");

    handleWindowDragRequest(
      dragEvent({ target: button, currentTarget: button }),
    );

    expect(mocks.startDragging).not.toHaveBeenCalled();
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();
  });

  it("rejects targets inside contenteditable elements", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");

    handleWindowDragRequest(
      dragEvent({ target: editable, currentTarget: editable }),
    );

    expect(mocks.startDragging).not.toHaveBeenCalled();
  });

  it("no-ops when not running in Tauri", () => {
    mocks.isTauri.mockReturnValue(false);

    handleWindowDragRequest(dragEvent());

    expect(mocks.startDragging).not.toHaveBeenCalled();
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();
  });

  it("no-ops when not on Linux", () => {
    mocks.platform.mockReturnValue("windows");

    handleWindowDragRequest(dragEvent());

    expect(mocks.startDragging).not.toHaveBeenCalled();
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();
  });
});
