import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { milkyMatchaTheme } from "../../../themes/fallback";

const mocks = vi.hoisted(() => ({
  context: null as unknown,
  updateCustomTheme: vi.fn(),
  setTheme: vi.fn(),
  addCustomTheme: vi.fn(),
  exportTheme: vi.fn(() => "{}"),
  importTheme: vi.fn(),
  removeCustomTheme: vi.fn(),
  previewTheme: vi.fn(),
  commitPreview: vi.fn(),
}));

vi.mock("../../../contexts/ThemeContext", () => ({
  useTheme: () => mocks.context,
}));

import { ThemePicker } from "../ThemePicker";

describe("ThemePicker image animation preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const theme = {
      ...milkyMatchaTheme,
      id: "custom-animation-toggle",
      name: "Motion theme",
      effects: {
        backgroundImage: {
          imageId: "media:v1:anim-picker-toggle-00000000:poster",
          thumbnailDataUrl: "data:image/png;base64,AA==",
          protectedSurfaces: true,
        },
        imageAnimation: {
          version: 1 as const,
          mediaId: "anim-picker-toggle-00000000",
          sourceFormat: "gif" as const,
          enabled: true,
        },
      },
    };
    mocks.context = {
      theme,
      themes: [theme],
      setTheme: mocks.setTheme,
      addCustomTheme: mocks.addCustomTheme,
      exportTheme: mocks.exportTheme,
      importTheme: mocks.importTheme,
      removeCustomTheme: mocks.removeCustomTheme,
      previewTheme: mocks.previewTheme,
      previewThemeId: null,
      commitPreview: mocks.commitPreview,
      updateCustomTheme: mocks.updateCustomTheme,
    };
  });

  it("updates the saved theme preference through the active settings control", () => {
    render(<ThemePicker />);
    const control = screen.getByRole("checkbox", { name: "Play animation" });
    expect(control).toBeChecked();
    fireEvent.click(control);

    expect(mocks.updateCustomTheme).toHaveBeenCalledWith(expect.objectContaining({
      id: "custom-animation-toggle",
      effects: expect.objectContaining({
        imageAnimation: expect.objectContaining({ enabled: false }),
      }),
    }));
    expect(mocks.setTheme).not.toHaveBeenCalled();
  });
});
