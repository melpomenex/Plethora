/**
 * Pocket TTS runtime panel (pocket-tts-runtime-provisioner 6.3–6.5).
 *
 * The panel is driven entirely by the structured install state and by the
 * backend's install events: a progress event moves the bar, a terminal event
 * clears it, and no percentage is ever invented locally.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  checkPocketTTSAvailable: vi.fn(),
  installPocketTTS: vi.fn(),
  cancelPocketTTSInstall: vi.fn(),
  uninstallPocketTTS: vi.fn(),
  onPocketTTSInstallProgress: vi.fn(),
  onPocketTTSInstallFinished: vi.fn(),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    // Appends the interpolated values so a test can assert on what the panel
    // actually rendered, not just on which key it asked for.
    t: (key: string, vars?: Record<string, string | number>) => {
      const values = Object.values(vars ?? {});
      return values.length ? `${key} (${values.join(" / ")})` : key;
    },
    locale: "en",
  }),
}));

vi.mock("../../../api/pocketTts", async () => {
  const actual = await vi.importActual<typeof import("../../../api/pocketTts")>(
    "../../../api/pocketTts"
  );
  return {
    ...actual,
    checkPocketTTSAvailable: mocks.checkPocketTTSAvailable,
    installPocketTTS: mocks.installPocketTTS,
    cancelPocketTTSInstall: mocks.cancelPocketTTSInstall,
    uninstallPocketTTS: mocks.uninstallPocketTTS,
    onPocketTTSInstallProgress: mocks.onPocketTTSInstallProgress,
    onPocketTTSInstallFinished: mocks.onPocketTTSInstallFinished,
  };
});

import { PocketTtsStatusPanel } from "../PocketTtsStatusPanel";
import { PocketTTSInstallRefusedError, type PocketTTSStatus } from "../../../api/pocketTts";

/** Captures the handlers the panel registers so a test can emit events. */
function captureEvents() {
  const progress: Array<(p: unknown) => void> = [];
  const finished: Array<(f: unknown) => void> = [];
  mocks.onPocketTTSInstallProgress.mockImplementation(
    async (handler: (p: unknown) => void) => {
      progress.push(handler);
      return () => {};
    }
  );
  mocks.onPocketTTSInstallFinished.mockImplementation(
    async (handler: (f: unknown) => void) => {
      finished.push(handler);
      return () => {};
    }
  );
  return { progress, finished };
}

/**
 * Renders the panel with an initial status. Pass `then:` to script what the
 * status call returns *after* a terminal event (a finished install no longer
 * reports `installing`).
 */
async function renderPanel(status: PocketTTSStatus, then?: PocketTTSStatus) {
  if (then) {
    mocks.checkPocketTTSAvailable
      .mockResolvedValueOnce(status)
      .mockResolvedValue(then);
  } else {
    mocks.checkPocketTTSAvailable.mockResolvedValue(status);
  }
  const events = captureEvents();
  const view = render(<PocketTtsStatusPanel />);
  // Let the status promise and both listener registrations settle.
  await waitFor(() => expect(mocks.checkPocketTTSAvailable).toHaveBeenCalled());
  await waitFor(() => expect(events.progress).toHaveLength(1));
  return { ...view, ...events };
}

const installed: PocketTTSStatus = {
  state: "installed",
  source: "provisioned",
  executable: "/data/pocket-tts/x86_64-unknown-linux-gnu/.venv/bin/pocket-tts",
};

describe("PocketTtsStatusPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.installPocketTTS.mockResolvedValue("pocket-tts-1");
    mocks.cancelPocketTTSInstall.mockResolvedValue(undefined);
    mocks.uninstallPocketTTS.mockResolvedValue(undefined);
  });

  it("offers install when no runtime is present, and starts a real install", async () => {
    const user = userEvent.setup();
    await renderPanel({ state: "notInstalled" });

    const install = await screen.findByRole("button", { name: /settings\.ttsDownload/ });
    await user.click(install);

    await waitFor(() => expect(mocks.installPocketTTS).toHaveBeenCalledTimes(1));
    // A synthesis is never used to "force" an install.
    expect(mocks.cancelPocketTTSInstall).not.toHaveBeenCalled();
    expect(mocks.uninstallPocketTTS).not.toHaveBeenCalled();
  });

  it("moves the progress bar from a reported event, not from a local guess", async () => {
    const { progress } = await renderPanel({ state: "installing" });

    // Nothing is drawn until an event arrives: the bar is never invented.
    expect(screen.queryByTestId("pocket-tts-install-progress")).toBeNull();

    progress[0]({
      id: "pocket-tts-1",
      phase: "runtime-fetch",
      received: 50 * 1024 * 1024,
      total: 200 * 1024 * 1024,
      percent: 25,
    });

    await waitFor(() => {
      expect(screen.getByText(/settings\.ttsPocketPhase\.runtime-fetch/)).toBeTruthy();
    });
    // runtime-fetch spans 5%–90%, so 25% of the phase is 5 + 0.25*85 = 26.25%.
    const bar = document.querySelector<HTMLElement>(
      '[data-testid="pocket-tts-install-progress"] .bg-primary[style]'
    );
    expect(bar?.style.width).toBe("26.25%");
    // Bytes come from the event, formatted — the panel never reports a
    // percentage of its own invention.
    const progressText = screen.getByTestId("pocket-tts-install-progress").textContent ?? "";
    expect(progressText).toContain("settings.ttsPocketProgressBytes");
    expect(progressText).toContain("50 MB");
    expect(progressText).toContain("200 MB");
  });

  it("shows an indeterminate bar with the phase label when the total is unknown", async () => {
    const { progress } = await renderPanel({ state: "installing" });

    progress[0]({
      id: "pocket-tts-1",
      phase: "weight-preload",
      received: 4_096,
      total: 0,
      percent: 0,
    });

    await waitFor(() => {
      expect(screen.getByText("settings.ttsPocketPhase.weight-preload")).toBeTruthy();
    });
    // No determinate bar, and no invented percentage on screen.
    expect(
      document.querySelector('[data-testid="pocket-tts-install-progress"] .bg-primary[style]')
    ).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("clears the bar and shows the message when the install fails", async () => {
    const { finished } = await renderPanel(
      { state: "installing" },
      { state: "failed", error: "Pocket TTS could not be installed." }
    );

    finished[0]({
      id: "pocket-tts-1",
      ok: false,
      cancelled: false,
      message: "Could not install the Pocket TTS runtime: No matching distribution",
    });

    await waitFor(() => {
      expect(screen.getByTestId("pocket-tts-error")).toBeTruthy();
    });
    expect(
      screen.getByText(/No matching distribution/)
    ).toBeTruthy();
    expect(screen.getByText("settings.ttsPocketInstallFailed")).toBeTruthy();
    // Back to a state where the install control is usable again.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /settings\.ttsDownload/ })
      ).toBeTruthy();
    });
  });

  it("treats a cancellation as a clean stop, not a failure", async () => {
    const { finished } = await renderPanel(
      { state: "installing" },
      { state: "notInstalled" }
    );

    finished[0]({
      id: "pocket-tts-1",
      ok: false,
      cancelled: true,
      message: "Install cancelled.",
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /settings\.ttsDownload/ })
      ).toBeTruthy();
    });
    expect(screen.queryByTestId("pocket-tts-error")).toBeNull();
  });

  it("offers Cancel while installing and Remove once provisioned, dropping both otherwise", async () => {
    const user = userEvent.setup();

    const installing = await renderPanel({ state: "installing" });
    expect(screen.getByRole("button", { name: /ttsPocketCancelInstall/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ttsPocketRemove/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /ttsPocketCancelInstall/ }));
    await waitFor(() => expect(mocks.cancelPocketTTSInstall).toHaveBeenCalledTimes(1));
    installing.unmount();

    // Provisioned runtime: Remove is offered, Install is not.
    const provisioned = await renderPanel(installed);
    expect(screen.getByRole("button", { name: /ttsPocketRemove/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /settings\.ttsDownload/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /ttsPocketRemove/ }));
    await waitFor(() => expect(mocks.uninstallPocketTTS).toHaveBeenCalledTimes(1));
    provisioned.unmount();

    // A user-installed runtime on PATH is not ours to remove.
    const system = await renderPanel({
      state: "installed",
      source: "system",
      executable: "/usr/local/bin/pocket-tts",
    });
    expect(screen.queryByRole("button", { name: /ttsPocketRemove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ttsDownload/ })).toBeNull();
    system.unmount();

    // Nothing present: install only.
    const empty = await renderPanel({ state: "notInstalled" });
    expect(screen.queryByRole("button", { name: /ttsPocketCancelInstall/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ttsPocketRemove/ })).toBeNull();
    expect(screen.getByRole("button", { name: /settings\.ttsDownload/ })).toBeTruthy();
    empty.unmount();
  });

  it("offers reinstall (not a first-time install) for a broken runtime", async () => {
    await renderPanel({
      state: "broken",
      source: "provisioned",
      executable: "/data/pocket-tts/…/.venv/bin/pocket-tts",
      detail: "ModuleNotFoundError: No module named 'torch'",
      error: "The Pocket TTS runtime is present but does not load.",
    });

    expect(screen.getByText("settings.ttsPocketBroken")).toBeTruthy();
    // A broken runtime still offers Remove — the user may want to clear it.
    expect(screen.getByRole("button", { name: /ttsPocketReinstall/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /ttsPocketRemove/ })).toBeTruthy();
    // No substring test on the message: the repair affordance is keyed off
    // `state`, and the CLI's own stderr is shown as-is.
    expect(screen.getByText("ModuleNotFoundError: No module named 'torch'")).toBeTruthy();
  });

  it("localizes a preflight refusal by its reason code, keeping the backend detail", async () => {
    const user = userEvent.setup();
    mocks.installPocketTTS.mockRejectedValue(
      new PocketTTSInstallRefusedError({
        reason: "pythonMissing",
        message: "Python 3.10 or newer is required to install the Pocket TTS runtime.",
      })
    );
    await renderPanel({ state: "notInstalled" });

    await user.click(screen.getByRole("button", { name: /settings\.ttsDownload/ }));

    await waitFor(() => {
      expect(screen.getByText("settings.ttsPocketInstallRefused.pythonMissing")).toBeTruthy();
    });
    expect(
      screen.getByText(/Python 3\.10 or newer is required/)
    ).toBeTruthy();
  });

  it("names the resolved executable so the user can see which runtime is in use", async () => {
    await renderPanel(installed);
    expect(
      screen.getByText("/data/pocket-tts/x86_64-unknown-linux-gnu/.venv/bin/pocket-tts")
    ).toBeTruthy();
  });
});
