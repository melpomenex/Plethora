import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getNougatRuntimeStatus: vi.fn(),
  installManagedNougat: vi.fn(),
  listen: vi.fn().mockResolvedValue(vi.fn()),
  onUpdateSettings: vi.fn(),
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  listen: mocks.listen,
  openExternal: vi.fn().mockResolvedValue(undefined),
  openFilePicker: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../api/ocrCommands", () => ({
  downloadOllamaInstaller: vi.fn(),
  getGLMRuntimeStatus: vi.fn(),
  getNougatRuntimeStatus: mocks.getNougatRuntimeStatus,
  installManagedNougat: mocks.installManagedNougat,
  openInstaller: vi.fn(),
  pullOllamaModel: vi.fn(),
  startOllamaRuntime: vi.fn(),
  stopOllamaRuntime: vi.fn(),
}));

import { OCRSettings } from "../OCRSettings";

const settings = {
  provider: "nougat" as const,
  language: "eng",
  autoOCR: false,
  preferLocal: true,
  mathOcrEnabled: true,
  mathOcrCommand: "nougat",
  keyPhraseExtraction: false,
  autoExtractOnLoad: false,
};

describe("OCRSettings managed Nougat setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.getNougatRuntimeStatus.mockResolvedValue({
      supported: true,
      installed: false,
      managed: false,
      repair_required: false,
      executable_path: null,
      install_root: "/app-data/ocr/nougat-runtime",
      package: "nougat-ocr==0.1.17",
      detail: null,
    });
  });

  it("installs Nougat and saves the managed executable path", async () => {
    const user = userEvent.setup();
    const managedExecutable = "/app-data/ocr/nougat-runtime/venv/bin/nougat";
    mocks.installManagedNougat.mockResolvedValue({
      supported: true,
      installed: true,
      managed: true,
      repair_required: false,
      executable_path: managedExecutable,
      install_root: "/app-data/ocr/nougat-runtime",
      package: "nougat-ocr==0.1.17",
      detail: "The model checkpoint downloads on first use.",
    });

    render(<OCRSettings settings={settings} onUpdateSettings={mocks.onUpdateSettings} />);

    expect(await screen.findByText("ocrSettings.nougatRequired")).toBeInTheDocument();
    expect(screen.getByText("ocrSettings.nougatInstallDisclosure")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ocrSettings.installNougat" }));

    await waitFor(() => {
      expect(mocks.installManagedNougat).toHaveBeenCalledTimes(1);
      expect(mocks.onUpdateSettings).toHaveBeenCalledWith({
        nougat_path: managedExecutable,
      });
    });
    expect(screen.getByText(managedExecutable)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ocrSettings.repairNougat" })).toBeInTheDocument();
  });

  it("offers repair when the managed PDF renderer is incompatible", async () => {
    mocks.getNougatRuntimeStatus.mockResolvedValue({
      supported: true,
      installed: false,
      managed: false,
      repair_required: true,
      executable_path: null,
      install_root: "/app-data/ocr/nougat-runtime",
      package: "nougat-ocr==0.1.17",
      detail: "The managed Nougat runtime needs repair.",
    });

    render(<OCRSettings settings={settings} onUpdateSettings={mocks.onUpdateSettings} />);

    expect(await screen.findByText("ocrSettings.nougatRepairRequired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ocrSettings.repairNougat" })).toBeInTheDocument();
  });
});
