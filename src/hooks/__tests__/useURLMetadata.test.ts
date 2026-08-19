import { describe, it, expect } from "vitest";
import { checkForDuplicate } from "../useURLMetadata";
import { URLType } from "../useURLDetector";

describe("useURLMetadata checkForDuplicate", () => {
  it("detects existing Twitter thread duplicates by status ID in filePath or metadata", () => {
    const mockDocuments = [
      {
        id: "doc-1",
        title: "Existing Thread",
        filePath: "https://x.com/karpathy/status/1880000000000000000",
        fileType: "html",
        metadata: {
          source: "https://x.com/karpathy/status/1880000000000000000",
        },
      },
    ];

    const result = checkForDuplicate(
      URLType.Twitter,
      "https://x.com/karpathy/status/1880000000000000000?s=20",
      mockDocuments
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.existingItem?.id).toBe("doc-1");
  });

  it("returns not duplicate for new Twitter status URL", () => {
    const mockDocuments = [
      {
        id: "doc-1",
        title: "Existing Thread",
        filePath: "https://x.com/karpathy/status/1880000000000000000",
        fileType: "html",
      },
    ];

    const result = checkForDuplicate(
      URLType.Twitter,
      "https://x.com/sama/status/9999999999999999999",
      mockDocuments
    );

    expect(result.isDuplicate).toBe(false);
  });
});
