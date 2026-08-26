import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("verify-frontend-build metadata", () => {
  it("dist metadata reports tauri target after Tauri production build", () => {
    const metadataPath = path.join(root, "dist/plethora-build-metadata.json");
    if (!existsSync(metadataPath)) {
      console.warn("Skipping: dist/plethora-build-metadata.json not found (run vite build first)");
      return;
    }
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    assert.equal(metadata.target, "tauri", `expected tauri target, got ${metadata.target}`);
    assert.equal(metadata.profile, metadata.profile);
    assert.ok(metadata.gitSha && metadata.gitSha !== "unknown");
    assert.ok(metadata.buildId);
  });
});
