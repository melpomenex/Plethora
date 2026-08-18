import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateOCRConfig: vi.fn(),
  listen: vi.fn().mockResolvedValue(vi.fn()),
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

vi.mock("../../../api/ocrCommands", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateOCRConfig: mocks.updateOCRConfig,
}));

import { OCRSettings } from "../OCRSettings";

const settings = {
  provider: "tesseract" as const,
  language: "deu",
  autoOCR: false,
  preferLocal: true,
  mathOcrEnabled: false,
  keyPhraseExtraction: false,
  autoExtractOnLoad: false,
};

describe("OCRSettings pushes configuration to the backend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.updateOCRConfig.mockResolvedValue(undefined);
  });

  it("invokes update_ocr_config with the mapped settings (provider + language)", async () => {
    render(<OCRSettings settings={settings} onUpdateSettings={() => {}} />);

    await waitFor(() => expect(mocks.updateOCRConfig).toHaveBeenCalled());
    const config = mocks.updateOCRConfig.mock.calls[0][0];
    expect(config.default_provider).toBe("tesseract");
    expect(config.language).toBe("deu");
  });
});
