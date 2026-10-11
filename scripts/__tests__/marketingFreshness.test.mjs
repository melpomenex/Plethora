import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { checkFreshness } from "../marketing/check-freshness.mjs";

import { existsSync } from "node:fs";

const ROOT = join(import.meta.dirname, "../..");
const hasAttribution = existsSync(join(ROOT, "marketing/licenses/ATTRIBUTION.md"));

test("freshness passes with default noindex while placeholders exist", { skip: !hasAttribution ? "marketing assets not present on disk" : false }, () => {
  const result = checkFreshness({ env: { PUBLIC_INDEXING: "noindex" } });
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("freshness fails when indexing is on and required stills are placeholders", { skip: !hasAttribution ? "marketing assets not present on disk" : false }, () => {
  const result = checkFreshness({ env: { PUBLIC_INDEXING: "index" } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("PUBLIC_INDEXING=index")));
});

test("seed refuses without MARKETING_SEED", () => {
  const proc = spawnSync(process.execPath, [join(ROOT, "scripts/marketing/seed-demo-library.mjs")], {
    env: { ...process.env, MARKETING_SEED: "" },
    encoding: "utf8",
  });
  assert.notEqual(proc.status, 0);
  assert.match(proc.stderr, /MARKETING_SEED=1/);
});
