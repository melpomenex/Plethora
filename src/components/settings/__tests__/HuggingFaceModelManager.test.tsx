import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstalledHfModels: vi.fn(),
  hfInspectModel: vi.fn(),
  hfInstallModel: vi.fn(),
  hfCancelInstall: vi.fn(),
  hfUninstallModel: vi.fn(),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../../../api/hfModels", () => ({
  getInstalledHfModels: mocks.getInstalledHfModels,
  hfInspectModel: mocks.hfInspectModel,
  hfInstallModel: mocks.hfInstallModel,
  hfCancelInstall: mocks.hfCancelInstall,
  hfUninstallModel: mocks.hfUninstallModel,
  formatBytes: (b: number) => `${Math.round(b / (1024 * 1024))} MB`,
  RUNTIME_LABELS: {
    "whisper-cpp": "whisper.cpp (ggml)",
    "sherpa-onnx-stt": "sherpa-onnx (ONNX STT)",
    "sherpa-onnx-tts": "sherpa-onnx (ONNX TTS)",
  },
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { HuggingFaceModelManager } from "../HuggingFaceModelManager";
import { useHfModelStore } from "../../../stores/useHfModelStore";

const installedWhisper = {
  id: "hf:whisper:someone/whisper-tiny",
  repo_id: "someone/whisper-tiny",
  revision: "main",
  runtime: "whisper-cpp",
  artifact_kind: "ggml-whisper",
  install_dir: "/tmp/whisper",
  artifact_files: [{ path: "ggml-tiny.bin", size: 100, sha256: null }],
  download_size_bytes: 100,
  license: "mit",
  run_contract: { type: "whisper", model_file: "ggml-tiny.bin" },
  installed_at: "2026-08-19T00:00:00Z",
  installed: true,
} as const;

const installedTts = {
  ...installedWhisper,
  id: "hf:sherpa-tts:someone/vits-ljs",
  repo_id: "someone/vits-ljs",
  runtime: "sherpa-onnx-tts",
  artifact_kind: "vits",
  run_contract: { type: "sherpa-tts", model_file: "model.onnx", tokens_file: "tokens.txt" },
} as const;

describe("HuggingFaceModelManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHfModelStore.setState({
      installedModels: [],
      progress: {},
      installing: {},
      inspection: null,
      installState: "idle",
      error: null,
      lastRepo: "",
    });
    mocks.getInstalledHfModels.mockResolvedValue([]);
  });

  it("lists installed STT models in stt mode and hides TTS models", async () => {
    mocks.getInstalledHfModels.mockResolvedValue([installedWhisper, installedTts]);
    render(<HuggingFaceModelManager mode="stt" />);
    await screen.findByText("someone/whisper-tiny");
    expect(screen.queryByText("someone/vits-ljs")).not.toBeInTheDocument();
  });

  it("lists installed TTS models in tts mode and hides STT models", async () => {
    mocks.getInstalledHfModels.mockResolvedValue([installedWhisper, installedTts]);
    render(<HuggingFaceModelManager mode="tts" />);
    await screen.findByText("someone/vits-ljs");
    expect(screen.queryByText("someone/whisper-tiny")).not.toBeInTheDocument();
  });

  it("blocks a repo with no supported artifact (unsupported runtime)", async () => {
    mocks.hfInspectModel.mockResolvedValue({
      repo_id: "openai/whisper-large-v3",
      revision: "main",
      name: "whisper-large-v3",
      author: "openai",
      task: "automatic-speech-recognition",
      architecture: ["whisper"],
      params_millions: 1540,
      precision: "unknown",
      download_size_bytes: 3_000_000_000,
      license: "apache-2.0",
      files: [{ path: "pytorch_model.bin", size: 3_000_000_000, sha256: null }],
      candidates: [],
      suitability: [],
      system_info: {
        os: "Linux", os_version: null, arch: "x86_64", cpu_brand: null,
        logical_cores: 8, physical_cores: 8,
        total_memory_bytes: 1 << 30, available_memory_bytes: 1 << 30,
        gpu: null, cuda_available: false, metal_available: false, is_apple_silicon: false,
        disk_free_bytes: 1 << 30, disk_total_bytes: 1 << 30, supported_accelerators: ["CPU"],
      },
      estimates_labeled: true,
    });

    render(<HuggingFaceModelManager mode="stt" />);
    const input = screen.getByPlaceholderText(/huggingface.co\/owner\/model/i);
    await userEvent.type(input, "openai/whisper-large-v3");
    await userEvent.click(screen.getByRole("button", { name: /inspect/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/no artifact in this repository is runnable/i),
      ).toBeInTheDocument();
    });
  });

  it("shows the license note with the do-not-grant-rights warning", async () => {
    mocks.hfInspectModel.mockResolvedValue({
      repo_id: "someone/whisper-tiny",
      revision: "main",
      name: "whisper-tiny",
      author: "someone",
      task: "automatic-speech-recognition",
      architecture: ["whisper"],
      params_millions: 39,
      precision: "int8",
      download_size_bytes: 100,
      license: "mit",
      files: [{ path: "ggml-tiny.bin", size: 100, sha256: null }],
      candidates: [
        {
          runtime: "whisper-cpp",
          kind: "ggml-whisper",
          label: "whisper.cpp ggml model",
          files: [{ path: "ggml-tiny.bin", size: 100, sha256: null }],
          download_size_bytes: 100,
          run_contract: { type: "whisper", model_file: "ggml-tiny.bin" },
          estimated_memory_bytes: 120,
          confidence: "exact",
        },
      ],
      suitability: [
        {
          artifact: {
            runtime: "whisper-cpp",
            kind: "ggml-whisper",
            label: "whisper.cpp ggml model",
            files: [{ path: "ggml-tiny.bin", size: 100, sha256: null }],
            download_size_bytes: 100,
            run_contract: { type: "whisper", model_file: "ggml-tiny.bin" },
            estimated_memory_bytes: 120,
            confidence: "exact",
          },
          suitability: {
            level: "recommended",
            explanation: "Fits comfortably.",
            requires: [],
            machine: {
              has_gpu: false, gpu_vram_bytes: null,
              total_memory_bytes: 1 << 30, available_memory_bytes: 1 << 30,
              is_apple_silicon: false, disk_free_bytes: 1 << 30,
            },
          },
        },
      ],
      system_info: {
        os: "Linux", os_version: null, arch: "x86_64", cpu_brand: null,
        logical_cores: 8, physical_cores: 8,
        total_memory_bytes: 1 << 30, available_memory_bytes: 1 << 30,
        gpu: null, cuda_available: false, metal_available: false, is_apple_silicon: false,
        disk_free_bytes: 1 << 30, disk_total_bytes: 1 << 30, supported_accelerators: ["CPU"],
      },
      estimates_labeled: true,
    });

    render(<HuggingFaceModelManager mode="stt" />);
    const input = screen.getByPlaceholderText(/huggingface.co\/owner\/model/i);
    await userEvent.type(input, "someone/whisper-tiny");
    await userEvent.click(screen.getByRole("button", { name: /inspect/i }));

    await waitFor(() => {
      expect(screen.getByText(/License: mit/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/does not grant you rights/i)).toBeInTheDocument();
    expect(screen.getByText(/Recommended/i)).toBeInTheDocument();
  });
});
