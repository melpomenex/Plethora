import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultCommands } from "../CommandPalette";
import { LectureCaptureHost } from "../LectureCaptureHost";
import { useUIStore } from "../../../stores/uiStore";
import * as runtime from "../../../lib/tauri";

describe("recording command availability and late host delivery", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("shows one recording action and retains it until the lazy capture host mounts", async () => {
    vi.spyOn(runtime, "isTauri").mockReturnValue(false);
    vi.spyOn(runtime, "isMac").mockReturnValue(false);
    vi.spyOn(runtime, "nativePlatform").mockReturnValue(null);
    vi.stubGlobal("MediaRecorder", class {});
    const commands = getDefaultCommands().filter((command) => command.id.startsWith("record-lecture"));
    expect(commands).toHaveLength(1);
    await commands[0].action();
    expect(useUIStore.getState().lectureCaptureRequested).toBe(true);
    render(<LectureCaptureHost />);
    expect(await screen.findByRole("heading", { name: /Record lecture/i })).toBeVisible();
    expect(useUIStore.getState().lectureCaptureRequested).toBe(false);
  });
  it("omits recording where neither a browser recorder nor an Apple runtime exists", () => {
    vi.spyOn(runtime, "isTauri").mockReturnValue(false);
    vi.spyOn(runtime, "isMac").mockReturnValue(false);
    vi.spyOn(runtime, "nativePlatform").mockReturnValue(null);
    vi.stubGlobal("MediaRecorder", undefined);
    expect(getDefaultCommands().filter((command) => command.id.startsWith("record-lecture"))).toHaveLength(0);
  });
});
