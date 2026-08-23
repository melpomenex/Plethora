import assert from "node:assert/strict";
import test from "node:test";
import { measureSceneHotspots, normalizeBoundingBox } from "../marketing/capture-hotspots.mjs";

test("normalizes a rendered control against its viewport", () => {
  assert.deepEqual(
    normalizeBoundingBox({ x: 144, y: 90, width: 288, height: 45 }, { width: 1440, height: 900 }),
    { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
  );
});

test("clips a partially visible rendered region", () => {
  assert.deepEqual(
    normalizeBoundingBox({ x: -10, y: 800, width: 110, height: 100 }, { width: 1000, height: 844 }),
    { x: 0, y: 0.947867, width: 0.1, height: 0.052133 },
  );
});

test("measures selectors and rejects duplicate visible controls", async () => {
  const visibleControl = {
    isVisible: async () => true,
    boundingBox: async () => ({ x: 20, y: 40, width: 100, height: 44 }),
  };
  const page = {
    locator: () => ({ count: async () => 1, nth: () => visibleControl }),
  };
  const scene = {
    actions: [{ id: "open", label: "Open", nextSceneId: "reader.open", selector: "[data-showcase-action=\"open\"]" }],
  };
  const measured = await measureSceneHotspots(page, scene, { width: 200, height: 400 });
  assert.deepEqual(measured[0].rect, { x: 0.1, y: 0.1, width: 0.5, height: 0.11 });

  const duplicatePage = {
    locator: () => ({ count: async () => 2, nth: () => visibleControl }),
  };
  await assert.rejects(() => measureSceneHotspots(duplicatePage, scene, { width: 200, height: 400 }), /2 visible controls/);
});
