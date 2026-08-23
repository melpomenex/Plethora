import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableJson } from "./compile-fixture-v2.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_PATH = join(ROOT, "marketing/showcase-scenes-v2.source.json");
const FIXTURE_PATH = join(ROOT, "marketing/demo-library/generated/marketing-fixture-v2.json");
const POLICY_PATH = join(ROOT, "marketing/screenshots/capture-policy.json");
const OUTPUT_PATHS = [
  join(ROOT, "marketing/generated/showcase-scenes-v2.json"),
  join(ROOT, "src/lib/marketingCapture/generated/showcase-scenes-v2.json"),
  join(ROOT, "website/src/config/showcase-scenes-v2.json"),
];

function fail(message) {
  throw new Error(`showcase-scenes-v2: ${message}`);
}

export function validateSceneSource(source, fixture, policy) {
  if (source.catalogId !== "plethora-showcase-scenes-v2" || source.schemaVersion !== 1) fail("unsupported catalog");
  if (source.fixtureId !== fixture.metadata.fixtureId || source.fixtureVersion !== fixture.metadata.fixtureVersion) {
    fail("fixture metadata mismatch");
  }
  if (!Array.isArray(source.scenes) || source.scenes.length !== 9) fail("catalog must contain nine named scenes");
  const ids = new Set(source.scenes.map((scene) => scene.id));
  if (ids.size !== source.scenes.length) fail("scene IDs must be unique");
  for (const scene of source.scenes) {
    if (!scene.accessibleDescription || !Array.isArray(scene.sentinels) || scene.sentinels.length === 0) {
      fail(`scene ${scene.id} lacks accessibility text or sentinels`);
    }
    if (scene.predecessor && !ids.has(scene.predecessor)) fail(`scene ${scene.id} has an unknown predecessor`);
    if (!ids.has(scene.fallbackSceneId)) fail(`scene ${scene.id} has an unknown fallback`);
    for (const next of scene.successors) if (!ids.has(next)) fail(`scene ${scene.id} has an unknown successor`);
    for (const layout of scene.requiredLayouts) if (!(layout in source.layouts)) fail(`scene ${scene.id} has an unknown layout`);
    if (scene.required && (!scene.captureSupported || scene.requiredLayouts.length !== 2)) {
      fail(`required scene ${scene.id} must support both launch layouts`);
    }
    for (const action of scene.actions) {
      if (!scene.successors.includes(action.nextSceneId)) fail(`action ${action.id} leaves the declared graph`);
      if (!/^\[data-showcase-(?:action|region)=/.test(action.selector)) fail(`action ${action.id} lacks a stable selector`);
    }
  }
  if (stableJson(source.guidedPath) !== stableJson(policy.requiredGuidedPath)) fail("guided path differs from approved capture policy");
  const explanation = source.scenes.find((scene) => scene.id === "explain.grounded");
  if (!explanation || explanation.required || explanation.captureSupported || explanation.requiredLayouts.length !== 0) {
    fail("explain.grounded must remain catalogued and optional");
  }
  for (let index = 0; index < source.guidedPath.length - 1; index += 1) {
    const scene = source.scenes.find((entry) => entry.id === source.guidedPath[index]);
    if (!scene?.successors.includes(source.guidedPath[index + 1])) fail(`guided path breaks after ${scene?.id}`);
  }
}

export async function compileShowcaseScenes({ root = ROOT, write = true, source, fixture, policy } = {}) {
  const loadedSource = source ?? JSON.parse(await readFile(join(root, "marketing/showcase-scenes-v2.source.json"), "utf8"));
  const loadedFixture = fixture ?? JSON.parse(await readFile(join(root, "marketing/demo-library/generated/marketing-fixture-v2.json"), "utf8"));
  const loadedPolicy = policy ?? JSON.parse(await readFile(join(root, "marketing/screenshots/capture-policy.json"), "utf8"));
  validateSceneSource(loadedSource, loadedFixture, loadedPolicy);
  const catalog = {
    metadata: {
      schemaVersion: loadedSource.schemaVersion,
      catalogId: loadedSource.catalogId,
      fixtureId: loadedFixture.metadata.fixtureId,
      fixtureVersion: loadedFixture.metadata.fixtureVersion,
      fixtureHash: loadedFixture.metadata.fixtureHash,
      logicalTime: loadedFixture.metadata.logicalTime,
      theme: loadedPolicy.theme.id,
      locale: "en-US",
    },
    guidedPath: loadedSource.guidedPath,
    layouts: loadedSource.layouts,
    scenes: loadedSource.scenes.map((scene) => ({
      ...scene,
      layouts: Object.entries(loadedSource.layouts).map(([layout, viewport]) => ({
        layout,
        required: scene.requiredLayouts.includes(layout),
        viewport,
        captureRoute: `/#/?fixture=${loadedSource.fixtureId}&scene=${scene.id}&layout=${layout}`,
      })),
    })),
  };
  if (write) {
    for (const output of [
      join(root, "marketing/generated/showcase-scenes-v2.json"),
      join(root, "src/lib/marketingCapture/generated/showcase-scenes-v2.json"),
      join(root, "website/src/config/showcase-scenes-v2.json"),
    ]) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, stableJson(catalog), "utf8");
    }
  }
  return catalog;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const catalog = await compileShowcaseScenes();
  console.log(`Compiled ${catalog.scenes.length} scenes for ${catalog.metadata.fixtureHash.slice(0, 16)}`);
}
