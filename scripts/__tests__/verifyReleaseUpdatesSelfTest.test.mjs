/**
 * Self-test for the release-channel verification logic against
 * LOCALLY-FABRICATED Plethora artifacts (rebrand task 5.4). No network: the
 * manifest is a fixture, the `download` injection copies local files, and
 * the signing vectors reuse the throwaway test keypair from
 * verifyUpdateArtifact.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { verifyManifestPlatforms } from "../verify-release-updates.mjs";

// Throwaway keypair + signature over the deterministic 155,000-byte fixture
// artifact (same vectors as verifyUpdateArtifact.test.mjs).
const TEST_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEIwRjU0QjA0NkRBNTk2RTQKUldUa2xxVnRCRXYxc0hlaGRTRk5Ub0tHYjFXKy9WbzdVajVpV3Q3emRaSllaMyt0RzVpVS9Jek0K";
const TEST_SIG =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUa2xxVnRCRXYxc0QyWklNU2dQMGYzdHFIL2RUWGRMMjNWM1dNbjJVNXE0UDJ2WlRwWnowNzhQWVJPODIzcSswMXVGdDgrUGE4NDBGWFJpVld4RG9KdVNzR1ZhTUNmNlF3PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg2NzQyMjI4CWZpbGU6aGVsbG8udHh0Cm5ydjJ0VENtQjM0bnhEYkw2WkVFMDl6cHNNQjBjck56VlBrRW8xcW5iVVRNb2ZRVW1VdFBMT29CcXRWbjAxb1J6SHlEeGVIOUhPNzFYSEx2VVFBZUNRPT0K";

const REQUIRED_PLATFORMS = [
  "darwin-aarch64",
  "linux-x86_64",
  "windows-x86_64",
];

function fixtureArtifact(dir, name, { mutate = false } = {}) {
  const content = Buffer.from("hello incrementum updater test\n".repeat(5000), "utf8");
  if (mutate) content[content.length - 1] ^= 0x01;
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function fabricatedManifest(names) {
  return {
    version: "2.7.0",
    pub_date: "2026-08-17T00:00:00Z",
    platforms: Object.fromEntries(
      REQUIRED_PLATFORMS.map((platform, i) => [
        platform,
        {
          signature: TEST_SIG,
          url: `https://github.com/melpomenex/Plethora/releases/download/v2.7.0/${encodeURIComponent(names[i])}`,
        },
      ]),
    ),
  };
}

test("verifyManifestPlatforms goes green against fabricated Plethora artifacts (self-test)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-release-selftest-"));
  try {
    const names = [
      "Plethora.app.tar.gz",
      "Plethora_2.7.0_amd64.AppImage",
      "Plethora_2.7.0_x64-setup.exe",
    ];
    for (const name of names) fixtureArtifact(dir, name);
    const manifest = fabricatedManifest(names);
    const digests = new Map(
      names.map((name) => [
        name,
        `sha256:${createHash("sha256").update(readFileSync(join(dir, name))).digest("hex")}`,
      ]),
    );

    const failures = await verifyManifestPlatforms({
      manifest,
      platforms: REQUIRED_PLATFORMS,
      pubkey: TEST_PUBKEY,
      digests,
      download: async (url, destination) => {
        const name = decodeURIComponent(new URL(url).pathname.split("/").pop());
        copyFileSync(join(dir, name), destination);
      },
      workDir: dir,
    });
    assert.deepEqual(failures, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tampered artifact under a Plethora name fails the manifest verification", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-release-selftest-"));
  try {
    const names = [
      "Plethora.app.tar.gz",
      "Plethora_2.7.0_amd64.AppImage",
      "Plethora_2.7.0_x64-setup.exe",
    ];
    names.forEach((name, i) => fixtureArtifact(dir, name, { mutate: i === 1 }));
    const manifest = fabricatedManifest(names);
    const failures = await verifyManifestPlatforms({
      manifest,
      platforms: REQUIRED_PLATFORMS,
      pubkey: TEST_PUBKEY,
      digests: new Map(),
      download: async (url, destination) => {
        const name = decodeURIComponent(new URL(url).pathname.split("/").pop());
        copyFileSync(join(dir, name), destination);
      },
      workDir: dir,
    });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^linux-x86_64: /);
    assert.match(failures[0], /does not match artifact bytes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a platform missing its manifest entry is reported as a failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-release-selftest-"));
  try {
    const manifest = fabricatedManifest([
      "Plethora.app.tar.gz",
      "Plethora_2.7.0_amd64.AppImage",
      "Plethora_2.7.0_x64-setup.exe",
    ]);
    delete manifest.platforms["windows-x86_64"];
    const failures = await verifyManifestPlatforms({
      manifest,
      platforms: REQUIRED_PLATFORMS,
      pubkey: TEST_PUBKEY,
      digests: new Map(),
      download: async () => {},
      workDir: dir,
    });
    assert.ok(
      failures.some((f) =>
        f.startsWith("windows-x86_64: latest.json has no complete entry"),
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
