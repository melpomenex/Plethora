#!/usr/bin/env node
/**
 * Verify the built frontend bundle metadata matches expectations.
 * Usage: node scripts/verify-frontend-build.mjs [--expect-target=tauri]
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metadataPath = path.join(root, "dist/plethora-build-metadata.json");

const expectArg = process.argv.find((a) => a.startsWith("--expect-target="));
const expectTarget = expectArg?.split("=")[1] ?? "tauri";

if (!existsSync(metadataPath)) {
  console.error(`Missing ${metadataPath}. Run a production frontend build first.`);
  process.exit(1);
}

const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));

if (metadata.target !== expectTarget) {
  console.error(`Expected runtime target "${expectTarget}", got "${metadata.target}"`);
  process.exit(1);
}

if (expectTarget === "tauri" && metadata.target === "pwa") {
  console.error("FATAL: Tauri build was classified as PWA.");
  process.exit(1);
}

console.log(JSON.stringify(metadata, null, 2));
console.log(`OK: frontend build target=${metadata.target} profile=${metadata.profile} sha=${metadata.gitSha}`);
