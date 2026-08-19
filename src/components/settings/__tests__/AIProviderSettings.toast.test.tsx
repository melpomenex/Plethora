/**
 * Provider-save toast tests (#4): a success toast fires only after the provider
 * persistence (store + native `set_api_key`/`set_ai_config` sync) completes,
 * and a native sync rejection surfaces an error toast instead of a false
 * success.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AISettings } from "../AIProviderSettings";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useToastStore, ToastType } from "../../common/Toast";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
  invokeCommand: mocks.invokeCommand,
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../../../api/ai", () => ({
  getAIConfig: vi.fn().mockResolvedValue(null),
  setApiKey: vi.fn().mockResolvedValue(undefined),
  isMaskedKey: vi.fn(() => false),
}));

vi.mock("../OnDeviceAiPanel", () => ({
  OnDeviceAiPanel: () => null,
}));

function toasts() {
  return useToastStore.getState().toasts;
}

async function addProviderViaForm() {
  render(<AISettings onChange={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: /Add Provider/ }));
  fireEvent.change(screen.getByPlaceholderText("Custom name for this provider"), {
    target: { value: "My OpenAI" },
  });
  fireEvent.change(screen.getByPlaceholderText("sk-..."), {
    target: { value: "sk-test-123" },
  });
  fireEvent.click(screen.getByTestId("provider-form-submit"));
}

describe("AI provider save toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useLLMProvidersStore.setState({ providers: [] });
    mocks.invokeCommand.mockReset();
    mocks.invokeCommand.mockResolvedValue(undefined);
  });

  it("shows a success toast only after native persistence completes", async () => {
    addProviderViaForm();

    await waitFor(() => {
      expect(toasts().some((t) => t.type === ToastType.Success && t.title === "Provider saved")).toBe(true);
    });
    // No error toast accompanies a successful save.
    expect(toasts().some((t) => t.type === ToastType.Error)).toBe(false);
    // The native sync commands were actually issued before the toast.
    expect(mocks.invokeCommand).toHaveBeenCalledWith("set_api_key", expect.anything());
    expect(mocks.invokeCommand).toHaveBeenCalledWith("set_ai_config", expect.anything());
  });

  it("shows an error toast (and no success toast) when the native sync rejects", async () => {
    mocks.invokeCommand.mockImplementation((command: string) => {
      if (command === "set_ai_config") return Promise.reject(new Error("keychain unavailable"));
      return Promise.resolve(undefined);
    });

    addProviderViaForm();

    await waitFor(() => {
      expect(toasts().some((t) => t.type === ToastType.Error && t.title === "Provider could not be saved")).toBe(true);
    });
    expect(toasts().some((t) => t.type === ToastType.Success)).toBe(false);
  });

  it("does not fire any toast when required validation blocks the save", () => {
    render(<AISettings onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Add Provider/ }));
    // Empty name/key leaves the submit disabled — no save, no toast.
    const submit = screen.getByTestId("provider-form-submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(toasts()).toHaveLength(0);
  });
});
