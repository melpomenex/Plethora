import { StrictMode } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GlobalAudioHost, isPrimaryAudioWindow } from "../GlobalAudioHost";

const mocks = vi.hoisted(() => {
  let initialized = false;
  const createEngine = vi.fn();
  return {
    native: false,
    label: "main",
    createEngine,
    controller: { initialize: vi.fn(() => { if (!initialized) { initialized = true; createEngine(); } }), dispose: vi.fn() },
  };
});
vi.mock("../../../lib/tauri", () => ({ isTauri: () => mocks.native }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: mocks.label }) }));
vi.mock("../../../services/audio/audioPlaybackRollout", () => ({ GLOBAL_AUDIO_PLAYBACK_ENABLED: true }));
vi.mock("../../../services/audio/audioRuntime", () => ({ getGlobalAudioController: () => mocks.controller, initializeAudioApplication: vi.fn() }));
vi.mock("../GlobalAudioDesktopBridge", () => ({ GlobalAudioDesktopBridge: () => null }));
afterEach(() => { cleanup(); window.location.hash = ""; mocks.native = false; mocks.label = "main"; });

it("keeps the owner through StrictMode and presentation remounts without disposing it", async () => {
  const first = render(<StrictMode><GlobalAudioHost /></StrictMode>);
  await waitFor(() => expect(mocks.createEngine).toHaveBeenCalledTimes(1));
  first.unmount();
  const second = render(<GlobalAudioHost />);
  await waitFor(() => expect(mocks.controller.initialize).toHaveBeenCalledTimes(2));
  second.unmount();
  expect(mocks.createEngine).toHaveBeenCalledTimes(1);
  expect(mocks.controller.dispose).not.toHaveBeenCalled();
});

it("rejects utility/auth routes and native windows without consulting viewport width", async () => {
  window.location.hash = "#/screenshot-overlay";
  expect(await isPrimaryAudioWindow()).toBe(false);
  window.location.hash = "#/auth/callback";
  expect(await isPrimaryAudioWindow()).toBe(false);
  window.location.hash = "";
  mocks.native = true;
  mocks.label = "capture";
  expect(await isPrimaryAudioWindow()).toBe(false);
  mocks.label = "main";
  expect(await isPrimaryAudioWindow()).toBe(true);
});

it("does not initialize in utility/auth windows and initializes once after OAuth hash returns to main shell", async () => {
  mocks.controller.initialize.mockClear();
  mocks.native = true;
  mocks.label = "capture";
  const secondary = render(<GlobalAudioHost />);
  await new Promise(resolve => setTimeout(resolve, 15));
  expect(mocks.controller.initialize).not.toHaveBeenCalled();
  secondary.unmount();

  mocks.label = "main";
  window.location.hash = "#/auth/callback";
  const mainView = render(<GlobalAudioHost />);
  await new Promise(resolve => setTimeout(resolve, 15));
  expect(mocks.controller.initialize).not.toHaveBeenCalled();

  window.location.hash = "#/";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await waitFor(() => expect(mocks.controller.initialize).toHaveBeenCalledTimes(1));
  mainView.unmount();
  expect(mocks.controller.dispose).not.toHaveBeenCalled();
});
