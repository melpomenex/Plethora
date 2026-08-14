import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ImageAsset } from "../../../api/image-registry";
import {
  OcclusionCardPreview,
  EMPTY_PREVIEW_ANSWERS,
} from "../OcclusionCardPreview";
import type { ImageOcclusionRegion } from "../../../types/learningItemInteractions";

const asset: ImageAsset = {
  id: "asset-1",
  mime_type: "image/png",
  file_name: "diagram.png",
  byte_size: 1234,
  sha256: "abc",
  created_at: new Date().toISOString(),
  data_url: "data:image/png;base64,AAAA",
};

function renderPreview(regions: ImageOcclusionRegion[]) {
  return render(
    <OcclusionCardPreview
      asset={asset}
      regions={regions}
      mode="per-region"
      answers={EMPTY_PREVIEW_ANSWERS}
      onAnswersChange={() => {}}
    />
  );
}

describe("OcclusionCardPreview", () => {
  it("renders masks fully opaque by default, matching the review card", () => {
    renderPreview([{ id: "r1", x: 10, y: 10, width: 30, height: 20 }]);

    const mask = screen.getByTestId("occlusion-preview-mask");
    expect(mask.className).toContain("bg-slate-950");
    expect(mask.className).not.toContain("bg-slate-950/");
    expect(["#0f172a", "rgb(15, 23, 42)"]).toContain(mask.style.backgroundColor);
  });

  it("applies an authored region color as authored", () => {
    renderPreview([
      { id: "r1", x: 10, y: 10, width: 30, height: 20, color: "#1d4ed8" },
    ]);

    const mask = screen.getByTestId("occlusion-preview-mask");
    expect(["#1d4ed8", "rgb(29, 78, 216)"]).toContain(mask.style.backgroundColor);
    expect(mask.className).toContain("bg-slate-950");
  });
});
