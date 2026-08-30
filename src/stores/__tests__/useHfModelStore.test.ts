import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstalledHfModels: vi.fn(),
  hfInspectModel: vi.fn(),
  hfInstallModel: vi.fn(),
  hfCancelInstall: vi.fn(),
  hfUninstallModel: vi.fn(),
  listenHandlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listenHandlers.set(event, handler);
    return () => {
      mocks.listenHandlers.delete(event);
    };
  }),
}));

vi.mock("../../api/hfModels", () => ({
  getInstalledHfModels: mocks.getInstalledHfModels,
  hfInspectModel: mocks.hfInspectModel,
  hfInstallModel: mocks.hfInstallModel,
  hfCancelInstall: mocks.hfCancelInstall,
  hfUninstallModel: mocks.hfUninstallModel,
}));

import { useHfModelStore } from "../useHfModelStore";

const installedModel = {
  id: "hf:whisper-cpp:someone/whisper-tiny",
  repo_id: "someone/whisper-tiny",
  revision: "main",
  runtime: "whisper-cpp",
  artifact_kind: "ggml-whisper",
  install_dir: "/tmp/models/whisper/someone_whisper-tiny",
  artifact_files: [{ path: "ggml-tiny.bin", size: 100, sha256: null }],
  download_size_bytes: 100,
  license: "mit",
  run_contract: { type: "whisper", model_file: "ggml-tiny.bin" },
  installed_at: "2026-08-19T00:00:00Z",
  installed: true,
} as const;

describe("useHfModelStore", () => {
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
    mocks.getInstalledHfModels.mockResolvedValue([installedModel]);
  });

  it("fetches and stores installed models", async () => {
    await useHfModelStore.getState().fetchInstalled();
    expect(useHfModelStore.getState().installedModels).toEqual([installedModel]);
  });

  it("inspect stores the inspection and stays responsive (non-blocking)", async () => {
    const inspection = { repo_id: "someone/whisper-tiny", revision: "main" };
    mocks.hfInspectModel.mockResolvedValue(inspection);
    const result = await useHfModelStore.getState().inspect("someone/whisper-tiny");
    expect(result).toEqual(inspection);
    expect(useHfModelStore.getState().inspection).toEqual(inspection);
    expect(useHfModelStore.getState().installState).toBe("idle");
  });

  it("install failure surfaces an error and marks installState error (not installed)", async () => {
    mocks.hfInstallModel.mockRejectedValue(new Error("Integrity check failed"));
    await expect(
      useHfModelStore.getState().install("someone/whisper-tiny", "whisper-cpp", "ggml-whisper"),
    ).rejects.toThrow("Integrity");
    expect(useHfModelStore.getState().installState).toBe("error");
    expect(useHfModelStore.getState().error).toContain("Integrity");
  });

  it("successful install refreshes the installed list", async () => {
    mocks.hfInstallModel.mockResolvedValue(installedModel);
    await useHfModelStore.getState().install("someone/whisper-tiny", "whisper-cpp", "ggml-whisper");
    expect(mocks.getInstalledHfModels).toHaveBeenCalled();
    expect(useHfModelStore.getState().installState).toBe("idle");
  });

  it("cancelInstall clears progress and invokes backend cancel", async () => {
    mocks.hfCancelInstall.mockResolvedValue(undefined);
    useHfModelStore.getState().setProgress({
      id: "hf:whisper-cpp:someone/whisper-tiny",
      file: "ggml-tiny.bin",
      received: 10,
      total: 100,
      percent: 10,
    });
    expect(useHfModelStore.getState().progress).toHaveProperty("hf:whisper-cpp:someone/whisper-tiny");
    await useHfModelStore.getState().cancelInstall("hf:whisper-cpp:someone/whisper-tiny");
    expect(mocks.hfCancelInstall).toHaveBeenCalledWith("hf:whisper-cpp:someone/whisper-tiny");
    expect(useHfModelStore.getState().progress).toEqual({});
  });

  it("uninstall removes the model from the installed list", async () => {
    mocks.hfUninstallModel.mockResolvedValue(undefined);
    await useHfModelStore.getState().uninstall("hf:whisper-cpp:someone/whisper-tiny");
    expect(mocks.hfUninstallModel).toHaveBeenCalledWith("hf:whisper-cpp:someone/whisper-tiny");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Terminal failure events (fix-nemotron-model-download)
  // ─────────────────────────────────────────────────────────────────────────

  function emitInstallFinished(payload: { id: string; ok: boolean; message: string }) {
    const handler = mocks.listenHandlers.get("hf://install-finished");
    expect(handler, "install-finished listener registered").toBeDefined();
    handler!({ payload });
  }

  it("ok:false finished event clears stale progress/installing state and surfaces the error", async () => {
    useHfModelStore.getState().setProgress({
      id: "hf:whisper-cpp:someone/whisper-tiny",
      file: "ggml-tiny.bin",
      received: 10,
      total: 100,
      percent: 10,
    });
    useHfModelStore.setState({ installState: "installing", error: null });

    emitInstallFinished({
      id: "hf:whisper-cpp:someone/whisper-tiny",
      ok: false,
      message: "Download failed: connection lost while downloading; retried 3 times without success",
    });

    // fetchInstalled resolves async inside the handler.
    await vi.waitFor(() => {
      const state = useHfModelStore.getState();
      expect(state.progress).toEqual({});
      expect(state.installing).toEqual({});
    });
    expect(useHfModelStore.getState().installState).toBe("error");
    expect(useHfModelStore.getState().error).toContain("connection lost");
  });

  it("cancelled finished event clears state without flipping to error", async () => {
    useHfModelStore.getState().setProgress({
      id: "hf:whisper-cpp:someone/whisper-tiny",
      file: "ggml-tiny.bin",
      received: 5,
      total: 100,
      percent: 5,
    });
    useHfModelStore.setState({ installState: "installing", error: null });

    emitInstallFinished({
      id: "hf:whisper-cpp:someone/whisper-tiny",
      ok: false,
      message: "Download cancelled",
    });

    await vi.waitFor(() => {
      const state = useHfModelStore.getState();
      expect(state.progress).toEqual({});
      expect(state.installing).toEqual({});
    });
    expect(useHfModelStore.getState().installState).toBe("installing");
    expect(useHfModelStore.getState().error).toBeNull();
  });

  it("failure with no prior progress never synthesizes a progress[undefined] entry", async () => {
    emitInstallFinished({
      id: "some-unknown-id",
      ok: false,
      message: "Download failed: could not reach the server",
    });
    await vi.waitFor(() => {
      expect(useHfModelStore.getState().progress).toEqual({});
    });
    expect(useHfModelStore.getState().progress).not.toHaveProperty("undefined");
    expect(useHfModelStore.getState().installing).not.toHaveProperty("undefined");
  });
});
