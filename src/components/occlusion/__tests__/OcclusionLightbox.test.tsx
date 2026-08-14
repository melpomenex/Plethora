import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import type { ImageAsset } from "../../../api/image-registry";
import { OcclusionLightbox } from "../OcclusionLightbox";
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

const regions: ImageOcclusionRegion[] = [
  { id: "r1", x: 10, y: 20, width: 30, height: 40 },
  { id: "r2", x: 50, y: 5, width: 20, height: 15, color: "#1d4ed8" },
];

describe("OcclusionLightbox", () => {
  it("renders masks fully opaque by default and honors authored colors", async () => {
    render(
      <OcclusionLightbox
        isOpen
        asset={asset}
        regions={regions}
        title="Occlusion preview"
        onClose={() => {}}
      />
    );

    const img = document.body.querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { configurable: true, value: 800 });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: 600 });
    Object.defineProperty(img, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(img, "clientHeight", { configurable: true, value: 300 });
    await act(async () => {
      img.dispatchEvent(new Event("load"));
    });

    const boxes = document.body.querySelectorAll(".absolute.rounded");
    expect(boxes.length).toBe(2);
    const [defaultMask, authoredMask] = Array.from(boxes) as HTMLElement[];
    expect(defaultMask.className).toContain("bg-slate-950");
    expect(defaultMask.className).not.toContain("bg-slate-950/");
    expect(["#0f172a", "rgb(15, 23, 42)"]).toContain(defaultMask.style.backgroundColor);
    expect(["#1d4ed8", "rgb(29, 78, 216)"]).toContain(authoredMask.style.backgroundColor);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <OcclusionLightbox
        isOpen
        asset={asset}
        regions={regions}
        title="Occlusion preview"
        onClose={onClose}
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
