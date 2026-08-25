import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AlgorithmArenaModeControl } from "../AlgorithmArenaModeControl";
import { useSettingsStore } from "../../../stores/settingsStore";

describe("AlgorithmArenaModeControl", () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        general: { ...state.settings.general, language: "en" },
        learning: {
          ...state.settings.learning,
          algorithm: "precision",
          precisionPureKernel: false,
          arenaReviewMode: "automatic",
        },
      },
    }));
  });

  it("presents Automatic as the recommended default and persists Show the Arena", () => {
    render(<AlgorithmArenaModeControl />);

    const choices = screen.getAllByRole("radio");
    expect(choices).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /keep the flow/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Recommended")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /show the arena/i }));

    expect(useSettingsStore.getState().settings.learning.arenaReviewMode).toBe("choose");
    expect(screen.getByRole("radio", { name: /show the arena/i })).toHaveAttribute("aria-checked", "true");
  });

  it("offers the same semantic choice in the compact review control", () => {
    render(<AlgorithmArenaModeControl compact />);

    expect(screen.getByRole("radiogroup", { name: /algorithm arena review mode/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Automatic" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "Show Arena" }));

    expect(useSettingsStore.getState().settings.learning.arenaReviewMode).toBe("choose");
  });
});
