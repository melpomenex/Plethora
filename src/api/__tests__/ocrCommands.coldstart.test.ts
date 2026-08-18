import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cold-start OCR: the backend initializes its processor at app startup, so
 * OCR commands (the occlusion AI-assist and canonical PDF OCR paths both go
 * through ocrImageBytes) must invoke the command directly — no dependency on
 * a lazily-triggered init/update from the frontend. This is the regression
 * behind "AI assist failed: OCR processor not initialized" (issue #44 bug 04).
 */
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: mockInvoke,
}));

import { ocrImageBytes } from "../ocrCommands";

describe("cold-start OCR command sequence", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      text: "recognized",
      success: true,
      confidence: 80,
      line_count: 1,
      word_count: 1,
      processing_time_ms: 5,
      provider: "Tesseract",
      format: "text",
      error: null,
    });
  });

  it("calls ocr_image_bytes directly with no preceding init/config command", async () => {
    const response = await ocrImageBytes({ image_data: "eHg=", language: "deu" });

    expect(response.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [command, payload] = mockInvoke.mock.calls[0];
    expect(command).toBe("ocr_image_bytes");
    expect(payload.request).toMatchObject({ image_data: "eHg=", language: "deu" });
  });
});
