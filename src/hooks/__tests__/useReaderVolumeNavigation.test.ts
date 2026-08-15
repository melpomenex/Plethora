import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useReaderVolumeNavigation } from "../useReaderVolumeNavigation";
import { saveDisplayMode, saveEinkSettings } from "../../lib/displayMode";
import { useSettingsStore } from "../../stores/settingsStore";

describe("useReaderVolumeNavigation", () => {
  beforeEach(() => {
    localStorage.clear();
    saveDisplayMode("eink");
    saveEinkSettings({ volumeTurnPages: true, invertVolumeKeys: false });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        interface: {
          ...useSettingsStore.getState().settings.interface,
          volumeRockerScroll: "page",
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles VolumeDown as next page and VolumeUp as previous page by default", () => {
    const onNextPage = vi.fn();
    const onPrevPage = vi.fn();

    const { unmount } = renderHook(() =>
      useReaderVolumeNavigation({ onNextPage, onPrevPage })
    );

    const downEvent = new KeyboardEvent("keydown", {
      key: "VolumeDown",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(downEvent);

    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onPrevPage).not.toHaveBeenCalled();

    const upEvent = new KeyboardEvent("keydown", {
      key: "VolumeUp",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(upEvent);

    expect(onPrevPage).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("respects invertVolumeKeys setting", () => {
    saveEinkSettings({ volumeTurnPages: true, invertVolumeKeys: true });

    const onNextPage = vi.fn();
    const onPrevPage = vi.fn();

    const { unmount } = renderHook(() =>
      useReaderVolumeNavigation({ onNextPage, onPrevPage })
    );

    const upEvent = new KeyboardEvent("keydown", {
      key: "VolumeUp",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(upEvent);

    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onPrevPage).not.toHaveBeenCalled();

    unmount();
  });

  it("does not intercept keys when typing in an input element", () => {
    const onNextPage = vi.fn();
    const onPrevPage = vi.fn();

    const { unmount } = renderHook(() =>
      useReaderVolumeNavigation({ onNextPage, onPrevPage })
    );

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const downEvent = new KeyboardEvent("keydown", {
      key: "VolumeDown",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(downEvent, "target", { value: input, enumerable: true });

    window.dispatchEvent(downEvent);
    expect(onNextPage).not.toHaveBeenCalled();

    document.body.removeChild(input);
    unmount();
  });
});
