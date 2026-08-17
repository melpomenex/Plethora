#!/usr/bin/env node
/**
 * verify-release-updates — post-publication gate for the updater chain.
 *
 * Downloads the released `latest.json` (the exact bytes a client updater
 * fetches), requires every supported desktop platform entry, downloads each
 * referenced artifact, and verifies the manifest's `signature` field against
 * the downloaded bytes using the updater public key — plus the asset digest
 * against GitHub's API record when a token is available.
 *
 * Motivation: v2.6.1 shipped a Linux AppImage whose uploaded bytes did not
 * match its signature (v2.6.0 verified with identical pipeline code), so
 * every AppImage user's in-place update failed after download. Verifying
 * what is actually published — not what was built — catches signer flakes,
 * upload corruption, and manifest/asset mismatches before users do.
 *
 * Usage:
 *   GITHUB_TOKEN=… node scripts/verify-release-updates.mjs \
 *     --repo melpomenex/Plethora --tag v2.6.2 \
 *     [--pubkey-config src-tauri/tauri.conf.json]
 *
 * Exit codes: 0 all platforms verified; 1 any failure; 2 usage error.
 */

import { createWriteStream } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  VerificationError,
  checkArtifactDigest,
  loadUpdaterPubkeyFromConfig,
  verifyUpdateSignature,
} from "./verify-update-artifact.mjs";

// In-place updates are a stated product requirement on all three of these;
// a missing entry means a whole platform cannot self-update, so it fails.
const REQUIRED_PLATFORMS = [
  "darwin-aarch64",
  "linux-x86_64",
  "windows-x86_64",
];

async function fetchJson(url, token) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`GET ${url} → HTTP ${response.status}`);
  }
  return await response.json();
}

async function downloadToFile(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`download ${url} → HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function apiAssetDigests(repo, tag, token) {
  try {
    const release = await fetchJson(
      `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
      token,
    );
    return new Map(
      (release.assets ?? []).map((asset) => [asset.name, asset.digest]),
    );
  } catch (err) {
    console.warn(`warn: could not fetch GitHub asset digests: ${err.message}`);
    return new Map();
  }
}

function printUsageAndExit() {
  console.error(
    "usage: node scripts/verify-release-updates.mjs --repo <owner/name> --tag <vX.Y.Z> [--pubkey-config <tauri.conf.json>]",
  );
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const readArg = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const repo = readArg("--repo");
  const tag = readArg("--tag");
  const pubkeyConfigPath = readArg("--pubkey-config") ?? "src-tauri/tauri.conf.json";
  if (!repo || !tag || !/^[\w.-]+\/[\w.-]+$/.test(repo)) printUsageAndExit();

  const token = process.env.GITHUB_TOKEN;
  const pubkey = loadUpdaterPubkeyFromConfig(pubkeyConfigPath);

  const manifestUrl = `https://github.com/${repo}/releases/download/${tag}/latest.json`;
  console.log(`verify-release: ${manifestUrl}`);
  const manifest = await fetchJson(manifestUrl, token);
  const version = manifest.version ?? "<none>";
  console.log(`manifest version: ${version}`);

  const failures = [];
  const workDir = mkdtempSync(join(tmpdir(), "verify-release-updates-"));
  try {
    const digests = await apiAssetDigests(repo, tag, token);

    for (const platform of REQUIRED_PLATFORMS) {
      const entry = manifest.platforms?.[platform];
      if (!entry?.url || !entry?.signature) {
        failures.push(
          `${platform}: latest.json has no complete entry (url/signature missing) — this platform cannot self-update`,
        );
        continue;
      }
      const assetName = decodeURIComponent(basename(new URL(entry.url).pathname));
      const artifactPath = join(workDir, assetName);
      process.stdout.write(`${platform}: downloading ${assetName} …\n`);
      try {
        await downloadToFile(entry.url, artifactPath);
        await verifyUpdateSignature({
          artifactPath,
          signature: entry.signature,
          pubkey,
        });
        const expectedDigest = digests.get(assetName);
        if (expectedDigest) {
          await checkArtifactDigest(artifactPath, expectedDigest);
          console.log(`${platform}: signature valid, digest matches API record`);
        } else {
          console.log(`${platform}: signature valid (no API digest to compare)`);
        }
      } catch (err) {
        const detail =
          err instanceof VerificationError ? err.message : String(err);
        failures.push(`${platform}: ${detail}`);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error("\nverify-release FAILED — the published update chain is broken:");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      "\nUsers on the affected platform(s) cannot update in place. Re-dispatch the release workflow (optionally with build_ref) to rebuild the broken artifacts.",
    );
    process.exit(1);
  }
  console.log("\nverify-release OK — all platform update chains verified.");
}

await main();
