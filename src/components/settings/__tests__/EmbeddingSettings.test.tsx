import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { EmbeddingSettings } from "../EmbeddingSettings";
import { useSettingsStore } from "../../../stores/settingsStore";
import * as aiApi from "../../../api/ai";

vi.mock("../../../api/ai", () => ({
  listOllamaModels: vi.fn(),
}));

describe("EmbeddingSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        embedding: {
          ...state.settings.embedding,
          provider: "ollama",
          ollamaModel: "embeddinggemma-2",
          ollamaBaseUrl: "http://localhost:11434",
        },
      },
    }));
  });

  it("includes embeddinggemma-2 in the model options by default", async () => {
    vi.mocked(aiApi.listOllamaModels).mockResolvedValueOnce([]);

    await act(async () => {
      render(<EmbeddingSettings />);
    });

    const select = screen.getByRole("combobox");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);

    expect(options).toContain("embeddinggemma-2");
    expect(options).toContain("embeddinggemma-2:740m");
  });

  it("dynamically loads installed models from Ollama and includes them in the dropdown", async () => {
    vi.mocked(aiApi.listOllamaModels).mockResolvedValueOnce([
      "custom-gemma2-model:latest",
      "bge-m3:latest",
    ]);

    await act(async () => {
      render(<EmbeddingSettings />);
    });

    await waitFor(() => {
      expect(aiApi.listOllamaModels).toHaveBeenCalledWith("http://localhost:11434");
    });

    await waitFor(() => {
      const select = screen.getByRole("combobox");
      const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
      expect(options).toContain("custom-gemma2-model:latest");
      expect(options).toContain("bge-m3:latest");
      expect(options).toContain("embeddinggemma-2");
    });
  });

  it("refreshes installed models when the refresh button is clicked", async () => {
    vi.mocked(aiApi.listOllamaModels).mockResolvedValueOnce(["initial-model:latest"]);

    await act(async () => {
      render(<EmbeddingSettings />);
    });

    await waitFor(() => {
      expect(aiApi.listOllamaModels).toHaveBeenCalledTimes(1);
    });

    vi.mocked(aiApi.listOllamaModels).mockResolvedValueOnce([
      "initial-model:latest",
      "new-installed-model:latest",
    ]);

    const refreshBtn = screen.getByRole("button", { name: /Refresh installed models/i });
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    await waitFor(() => {
      expect(aiApi.listOllamaModels).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      const select = screen.getByRole("combobox");
      const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
      expect(options).toContain("new-installed-model:latest");
    });
  });
});
