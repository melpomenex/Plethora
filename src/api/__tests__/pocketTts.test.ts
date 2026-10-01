/**
 * Pocket TTS API surface (pocket-tts-runtime-provisioner 5.2–5.3).
 *
 * The install runs detached, so the event helpers are the contract the panel
 * depends on: they must hand back an unsubscribe function even when there is
 * no event channel to subscribe to, and the install wrappers must normalise a
 * structured refusal into a typed error.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
  isTauri: mocks.isTauri,
  listen: mocks.listen,
}));

import {
  POCKET_TTS_FINISHED_EVENT,
  POCKET_TTS_PROGRESS_EVENT,
  PocketTTSInstallRefusedError,
  cancelPocketTTSInstall,
  checkPocketTTSAvailable,
  installPocketTTS,
  onPocketTTSInstallFinished,
  onPocketTTSInstallProgress,
  uninstallPocketTTS,
  type PocketTTSInstallFinished,
  type PocketTTSInstallProgress,
} from "../pocketTts";

describe("pocketTts API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(true);
  });

  it("passes the unwrapped payload to the event handler", async () => {
    const handlers: Array<(event: { payload: unknown }) => void> = [];
    mocks.listen.mockImplementation(async (event: string, handler: (e: { payload: unknown }) => void) => {
      handlers.push(handler);
      return () => {};
    });

    const seen: PocketTTSInstallProgress[] = [];
    await onPocketTTSInstallProgress((progress) => seen.push(progress));
    handlers[0]({
      payload: {
        id: "pocket-tts-1",
        phase: "runtime-fetch",
        received: 1,
        total: 2,
        percent: 50,
      } satisfies PocketTTSInstallProgress,
    });

    expect(mocks.listen).toHaveBeenCalledWith(POCKET_TTS_PROGRESS_EVENT, expect.any(Function));
    expect(seen).toHaveLength(1);
    expect(seen[0].phase).toBe("runtime-fetch");
  });

  it("subscribes the finished event under its own name", async () => {
    mocks.listen.mockResolvedValue(() => {});
    const seen: PocketTTSInstallFinished[] = [];
    const unlisten = await onPocketTTSInstallFinished((finished) => seen.push(finished));
    expect(mocks.listen).toHaveBeenCalledWith(POCKET_TTS_FINISHED_EVENT, expect.any(Function));
    expect(typeof unlisten).toBe("function");
  });

  it("returns an unsubscribe function when the app is not running under Tauri", async () => {
    // `listen` itself degrades to a no-op outside Tauri; the helpers must not
    // add their own failure on top of that.
    mocks.isTauri.mockReturnValue(false);
    mocks.listen.mockResolvedValue(() => {});

    expect(typeof (await onPocketTTSInstallProgress(() => {}))).toBe("function");
    expect(typeof (await onPocketTTSInstallFinished(() => {}))).toBe("function");
  });

  it("normalises a structured refusal into a typed error carrying the reason code", async () => {
    mocks.invokeCommand.mockRejectedValue({
      reason: "diskSpace",
      message: "Not enough free disk space to install Pocket TTS: 3.2 GB is required…",
    });

    const error = await installPocketTTS().then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(PocketTTSInstallRefusedError);
    const refusal = error as PocketTTSInstallRefusedError;
    expect(refusal.reason).toBe("diskSpace");
    expect(refusal.message).toContain("free disk space");
  });

  it("rethrows an unstructured failure unchanged", async () => {
    mocks.invokeCommand.mockRejectedValue(new Error("boom"));
    await expect(installPocketTTS()).rejects.toThrow("boom");
  });

  it("returns the install id on success", async () => {
    mocks.invokeCommand.mockResolvedValue("pocket-tts-42");
    await expect(installPocketTTS()).resolves.toBe("pocket-tts-42");
    expect(mocks.invokeCommand).toHaveBeenCalledWith("pocket_tts_install");
  });

  it("invokes the cancel and uninstall commands under their own names", async () => {
    mocks.invokeCommand.mockResolvedValue(undefined);
    await cancelPocketTTSInstall();
    await uninstallPocketTTS();
    expect(mocks.invokeCommand).toHaveBeenCalledWith("pocket_tts_cancel_install");
    expect(mocks.invokeCommand).toHaveBeenCalledWith("pocket_tts_uninstall");
  });

  it("no-ops outside Tauri instead of throwing", async () => {
    mocks.isTauri.mockReturnValue(false);
    await cancelPocketTTSInstall();
    await uninstallPocketTTS();
    await expect(checkPocketTTSAvailable()).resolves.toMatchObject({ state: "notInstalled" });
    expect(mocks.invokeCommand).not.toHaveBeenCalled();
  });

  it("reports a status check failure as a state, not a rejection", async () => {
    mocks.invokeCommand.mockRejectedValue(new Error("ipc died"));
    const status = await checkPocketTTSAvailable();
    expect(status.state).toBe("notInstalled");
    expect(status.error).toContain("ipc died");
  });
});
