import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HapticsSettingsControl } from "../HapticsSettingsControl";
import { defaultSettings, useSettingsStore } from "../../../stores/settingsStore";

vi.mock("../../../lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../../lib/feedback/haptics/service", () => ({
  getHapticsSnapshot: () => ({
    capabilities: { hardware: "unknown", systemPreference: "unknown" },
    configured: false,
    enabled: true,
    intensity: "subtle",
    busy: false,
  }),
  subscribeHaptics: (listener: (value: unknown) => void) => {
    listener({
      capabilities: { hardware: "unknown", systemPreference: "unknown" },
      configured: false,
      enabled: true,
      intensity: "subtle",
      busy: false,
    });
    return () => undefined;
  },
}));

describe("HapticsSettingsControl", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: JSON.parse(JSON.stringify(defaultSettings)) });
  });

  it("keeps both settings surfaces synchronized and exposes accessible labels", () => {
    render(<><HapticsSettingsControl /><HapticsSettingsControl compact /></>);
    const toggles = screen.getAllByRole("checkbox", { name: "haptics.enabledLabel" });
    expect(toggles).toHaveLength(2);
    expect(toggles[0]).toBeChecked();
    expect(screen.getAllByLabelText("haptics.intensityLabel")).toHaveLength(2);
    expect(screen.getAllByText(/haptics\.statusUnknown/)).toHaveLength(2);

    fireEvent.click(toggles[0]!);
    expect(toggles[0]).not.toBeChecked();
    expect(toggles[1]).not.toBeChecked();
    expect(useSettingsStore.getState().settings.haptics.enabled).toBe(false);

    const intensity = screen.getAllByLabelText("haptics.intensityLabel")[1] as HTMLSelectElement;
    fireEvent.change(intensity, { target: { value: "strong" } });
    expect(useSettingsStore.getState().settings.haptics.intensity).toBe("strong");
    expect((screen.getAllByLabelText("haptics.intensityLabel")[0] as HTMLSelectElement).value).toBe("strong");
  });
});
