import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lfm3TtsSetup } from "../Lfm3TtsSetup";
import { getLfm3Status } from "../../../api/lfm3Tts";

let installed = false;
vi.mock("../../../api/lfm3Tts", () => ({ getLfm3Status: vi.fn() }));
vi.mock("../../../stores/useHfModelStore", () => ({ useHfModelStore: () => installed }));
afterEach(() => { cleanup(); installed = false; vi.resetAllMocks(); });
describe("LFM3 optional setup", () => {
  it("offers model installation after verifying the packaged runtime", async () => {
    vi.mocked(getLfm3Status).mockResolvedValue({ available: true, loaded: false, modelId: null, backend: null, error: null });
    render(<Lfm3TtsSetup />);
    expect(await screen.findByRole("button", { name: "Get model" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("about 1.4 GB");
  });
  it("reports an installed model without hardware-specific setup", async () => {
    installed = true;
    vi.mocked(getLfm3Status).mockResolvedValue({ available: true, loaded: false, modelId: null, backend: "CPU", error: null });
    render(<Lfm3TtsSetup />);
    expect(await screen.findByRole("button", { name: "Manage model" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ready for offline speech");
  });
  it("reports a missing runtime instead of promising offline readiness", async () => {
    vi.mocked(getLfm3Status).mockResolvedValue({ available: false, loaded: false, modelId: null, backend: null, error: "Unavailable on this platform" });
    render(<Lfm3TtsSetup />);
    expect(await screen.findByText("Unavailable on this platform")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
