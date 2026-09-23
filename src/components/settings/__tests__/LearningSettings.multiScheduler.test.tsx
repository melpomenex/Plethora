import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "../../../test/utils";
import { useSettingsStore } from "../../../stores/settingsStore";
import { LearningSettings } from "../LearningSettings";

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

vi.mock("../../../api/algorithm", () => ({
  getArenaOptimizationStatus: vi.fn().mockResolvedValue({
    m2_optimizer_initialized: true,
    m3_matrix_cells_populated: 120,
    m3_matrix_total_cells: 9261,
  }),
  optimizeAlgorithmParams: vi.fn().mockResolvedValue({
    fsrs_weights: new Array(34).fill(1),
    history_count: 50,
    minimum_history_required: 10,
  }),
}));

vi.mock("../../../api/review", () => ({
  getArenaStats: vi.fn().mockResolvedValue({
    model_names: ["SM-2", "SM-15", "SM-19", "SM-20", "FSRS"],
    weights: [10, 15, 20, 30, 25],
    r_metric: 2.5,
    total_scored: 42,
    fsrs_optimized: false,
    m4_optimized: false,
  }),
  optimizeArenaFsrs: vi.fn().mockResolvedValue({ message: "FSRS optimized" }),
  optimizePrecisionKernel: vi.fn().mockResolvedValue({ message: "SM-20 optimized" }),
}));

describe("LearningSettings multi-scheduler selection and Arena", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  it("renders algorithm select dropdown with all four production schedulers", () => {
    render(<LearningSettings />);

    const select = screen.getByRole("combobox", { name: /spaced repetition algorithm/i });
    expect(select).toBeInTheDocument();

    const options = within(select).getAllByRole("option");
    const optionTexts = options.map((opt) => opt.textContent?.trim());

    expect(optionTexts).toEqual([
      "FSRS-7 (Recommended)",
      "SM-20",
      "SM-18",
      "SM-2",
    ]);
  });

  it("selecting SM-20 activates precision and renders Algorithm Arena panel", async () => {
    render(<LearningSettings />);

    const select = screen.getByRole("combobox", { name: /spaced repetition algorithm/i });

    await act(async () => {
      fireEvent.change(select, { target: { value: "precision" } });
    });

    expect(useSettingsStore.getState().settings.learning.algorithm).toBe("precision");
    expect(screen.getByText("Algorithm Arena")).toBeInTheDocument();
    expect(screen.getByText(/Pure SM-20 Mode \(M4 kernel only\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /optimize sm-20 parameters/i })).toBeInTheDocument();
  });

  it("selecting SM-18 activates adaptive scheduler and shows Forgetting Index", async () => {
    render(<LearningSettings />);

    const select = screen.getByRole("combobox", { name: /spaced repetition algorithm/i });

    await act(async () => {
      fireEvent.change(select, { target: { value: "adaptive" } });
    });

    expect(useSettingsStore.getState().settings.learning.algorithm).toBe("adaptive");
    expect(screen.getByText(/Forgetting Index:/i)).toBeInTheDocument();
    expect(screen.queryByText("Algorithm Arena")).not.toBeInTheDocument();
  });

  it("selecting SM-2 activates classic scheduler without FSRS/Arena panels", async () => {
    render(<LearningSettings />);

    const select = screen.getByRole("combobox", { name: /spaced repetition algorithm/i });

    await act(async () => {
      fireEvent.change(select, { target: { value: "classic" } });
    });

    expect(useSettingsStore.getState().settings.learning.algorithm).toBe("classic");
    expect(screen.queryByText("Algorithm Arena")).not.toBeInTheDocument();
    expect(screen.queryByText(/Desired Retention:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Forgetting Index:/i)).not.toBeInTheDocument();
  });
});
