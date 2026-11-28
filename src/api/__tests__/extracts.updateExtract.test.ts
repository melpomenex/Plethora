import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateExtract } from "../extracts";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
}));

describe("updateExtract", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
  });

  it("forwards htmlContent to the update_extract command", async () => {
    const html = '<p>Hello</p><figure><img src="data:image/png;base64,AAA" alt="img" /></figure>';
    mocks.invokeCommand.mockResolvedValueOnce({
      id: "ext-1",
      document_id: "doc-1",
      content: "Hello",
      html_content: html,
      notes: "",
      progressive_disclosure_level: 0,
      max_disclosure_level: 0,
      date_created: "2026-01-01T00:00:00Z",
      date_modified: "2026-01-01T00:00:00Z",
      tags: [],
      review_count: 0,
      reps: 0,
    });

    const result = await updateExtract({
      id: "ext-1",
      content: "Hello",
      html_content: html,
      note: "",
    });

    expect(mocks.invokeCommand).toHaveBeenCalledWith(
      "update_extract",
      expect.objectContaining({
        id: "ext-1",
        content: "Hello",
        htmlContent: html,
        note: "",
      })
    );
    expect(result.html_content).toBe(html);
  });
});
