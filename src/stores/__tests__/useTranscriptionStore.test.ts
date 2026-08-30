import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTranscriptionProfiles: vi.fn(),
  getTranscript: vi.fn(),
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

vi.mock("../../api/transcription", () => ({
  getTranscriptionProfiles: mocks.getTranscriptionProfiles,
  getTranscript: mocks.getTranscript,
}));

import { useTranscriptionStore } from "../useTranscriptionStore";
import { LOGICAL_STT_MODEL_KEYS } from "../../services/transcription/config";

function emit(event: string, payload: unknown) {
  const handler = mocks.listenHandlers.get(event);
  expect(handler, `listener for ${event} registered`).toBeDefined();
  handler!({ payload });
}

describe("useTranscriptionStore (download state hygiene)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTranscriptionProfiles.mockResolvedValue([]);
    mocks.getTranscript.mockResolvedValue(null);
    useTranscriptionStore.setState({
      profiles: [],
      downloadProgress: {},
      downloadBytes: {},
      currentStatus: "idle",
    });
  });

  it("install-progress maps nemotron ids to the logical key and tracks bytes", () => {
    emit("hf://install-progress", {
      id: "hf:nemotron-asr:handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf",
      file: "model.gguf",
      received: 250_000_000,
      total: 495_831_520,
      percent: 50.4,
    });

    const state = useTranscriptionStore.getState();
    expect(state.downloadProgress[LOGICAL_STT_MODEL_KEYS.NEMOTRON]).toBeCloseTo(50.4);
    expect(state.downloadBytes[LOGICAL_STT_MODEL_KEYS.NEMOTRON]).toEqual({
      received: 250_000_000,
      total: 495_831_520,
    });
    expect(state.currentStatus).toBe("downloading");
  });

  it("unknown-total progress records real bytes without NaN percentages", () => {
    emit("hf://install-progress", {
      id: LOGICAL_STT_MODEL_KEYS.NEMOTRON,
      file: "model.gguf",
      received: 12_000_000,
      total: 0,
      percent: 0,
    });

    const state = useTranscriptionStore.getState();
    expect(state.downloadProgress[LOGICAL_STT_MODEL_KEYS.NEMOTRON]).toBe(0);
    expect(Number.isFinite(state.downloadProgress[LOGICAL_STT_MODEL_KEYS.NEMOTRON])).toBe(true);
    expect(state.downloadBytes[LOGICAL_STT_MODEL_KEYS.NEMOTRON]).toEqual({
      received: 12_000_000,
      total: 0,
    });
  });

  it("ok:false finished event clears nemotron download state and steps down to idle", async () => {
    emit("hf://install-progress", {
      id: LOGICAL_STT_MODEL_KEYS.NEMOTRON,
      received: 100,
      total: 200,
      percent: 50,
    });
    expect(useTranscriptionStore.getState().currentStatus).toBe("downloading");

    emit("hf://install-finished", {
      id: "hf:nemotron-asr:handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf",
      ok: false,
      message: "Download failed: timed out waiting for data; retried 3 times without success",
    });

    await vi.waitFor(() => {
      expect(mocks.getTranscriptionProfiles).toHaveBeenCalled();
    });
    const state = useTranscriptionStore.getState();
    expect(state.downloadProgress[LOGICAL_STT_MODEL_KEYS.NEMOTRON]).toBe(0);
    expect(state.downloadBytes[LOGICAL_STT_MODEL_KEYS.NEMOTRON]).toEqual({
      received: 0,
      total: 0,
    });
    expect(state.currentStatus).toBe("idle");
  });

  it("finished event never clobbers an unrelated processing job", () => {
    useTranscriptionStore.setState({ currentStatus: "processing" });
    emit("hf://install-finished", {
      id: LOGICAL_STT_MODEL_KEYS.NEMOTRON,
      ok: true,
      message: "Installed",
    });
    expect(useTranscriptionStore.getState().currentStatus).toBe("processing");
  });
});
