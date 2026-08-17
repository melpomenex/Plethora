/**
 * Unit tests for scripts/verify-update-artifact.mjs — run with
 * `npm run test:scripts` (`node --test`).
 *
 * Vectors:
 *  - A throwaway keypair + signature over a deterministic 155,000-byte
 *    artifact, generated with the repo's pinned Tauri CLI (2.10.0) — the
 *    byte-level valid/invalid cases.
 *  - The real v2.6.0 and v2.6.1 Linux AppImage release signatures and the
 *    production updater pubkey from tauri.conf.json. v2.6.0 verified against
 *    its uploaded artifact; v2.6.1's signature did NOT match its uploaded
 *    bytes (the release breakage this gate exists to catch — the 274 MB
 *    artifacts themselves are too large to embed, so these are
 *    box-parsing/key-id vectors plus wrong-data rejection).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  VerificationError,
  checkArtifactDigest,
  parseSignatureBox,
  parseUpdaterPubkey,
  verifyUpdateSignature,
} from "../verify-update-artifact.mjs";

// Throwaway keypair (test-only; generated with the repo's Tauri CLI).
const TEST_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEIwRjU0QjA0NkRBNTk2RTQKUldUa2xxVnRCRXYxc0hlaGRTRk5Ub0tHYjFXKy9WbzdVajVpV3Q3emRaSllaMyt0RzVpVS9Jek0K";
const TEST_SIG =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUa2xxVnRCRXYxc0QyWklNU2dQMGYzdHFIL2RUWGRMMjNWM1dNbjJVNXE0UDJ2WlRwWnowNzhQWVJPODIzcSswMXVGdDgrUGE4NDBGWFJpVld4RG9KdVNzR1ZhTUNmNlF3PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg2NzQyMjI4CWZpbGU6aGVsbG8udHh0Cm5ydjJ0VENtQjM0bnhEYkw2WkVFMDl6cHNNQjBjck56VlBrRW8xcW5iVVRNb2ZRVW1VdFBMT29CcXRWbjAxb1J6SHlEeGVIOUhPNzFYSEx2VVFBZUNRPT0K";
const TEST_SHA256 =
  "612760162932cbcb7fca652d1d809355cb50aec6248a3e778159bb66162c61b9";

// Production updater pubkey from src-tauri/tauri.conf.json (the NEW
// Plethora key — rebrand task 3.8 rotated it).
const PROD_PUBKEY = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
).plugins.updater.pubkey;

// The pre-rebrand Incrementum updater pubkey — the historical release
// signature vectors below are keyed to it.
const LEGACY_INCREMENTUM_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDZCM0Q0ODk0NDY4NjE0M0MKUldROEZJWkdsRWc5YTBDUU5VRlY2TEpWejR3cy9DZm9MVDh3eloxKy9XWmY5RUhlR0NoOFpINzEK";

// Real release signatures (base64-of-box, as uploaded to the release).
const V2_6_0_APPIMAGE_SIG =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVROEZJWkdsRWc5YXpSRkJuT3BydlhlZjE5NWxqaGxYSXdITWhFdDNPZTZVdFVuRDZKYkJETXRqY2p6VDZ5UEZGcElMbEtZU2RFM0VXK1c5UnBVL2twR1BOanU0N1pTVWdNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg2NzMxMTI4CWZpbGU6SW5jcmVtZW50dW1fMi42LjBfYW1kNjQuQXBwSW1hZ2UKVFpOeHh1L2cyWGJqZ01pa1gvWFpVbTltaW5OTGZFTHJyR2t0T1NZTjBKOXk2MnVzbHNMa3JHZklNelhZQW5VOWk5V2RuTTd3SFF3UnFIVXNqeUo1QWc9PQo=";
const V2_6_1_APPIMAGE_SIG =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVROEZJWkdsRWc5YTFQaWlibTlLamJkR1VTMlBEUzRQcTF6Vi8yeldrc2E5UWtHeEZQcWFlVjI1QTZzR2ZOemhqeW5FRW1uMS9HU2VQMnl0N2tTZG0vWWhOOTFnUDlGc1FZPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg2NzM5MzY3CWZpbGU6SW5jcmVtZW50dW1fMi42LjFfYW1kNjQuQXBwSW1hZ2UKaVFvZENxS3hxcjRXYSsrY1dJS0VFZWVvaGdQQUxoVDFIa3ZTSm44NUN3dlM0Rk0rZ0s5SU5hWnoxRkwzaEpXVEdLdTNaK2xleDJmdm1IU2RyUm1tQ2c9PQo=";

function writeFixtureArtifact(dir, { mutate = false } = {}) {
  const content = Buffer.from(
    "hello incrementum updater test\n".repeat(5000),
    "utf8",
  );
  if (mutate) {
    content[content.length - 1] ^= 0x01;
  }
  const path = join(dir, mutate ? "mutated.bin" : "artifact.bin");
  writeFileSync(path, content);
  return path;
}

test("parseUpdaterPubkey extracts the 42-byte Ed25519 key structure", () => {
  const parsed = parseUpdaterPubkey(PROD_PUBKEY);
  assert.equal(parsed.keyId.length, 8);
  assert.equal(parsed.ed25519Key.length, 32);
  // The Plethora updater key (rotated in rebrand task 3.8) — a DIFFERENT key
  // id from the legacy Incrementum release signatures below.
  assert.equal(parsed.keyId.toString("hex"), "c5e9c0e50b44f2f1");
  assert.notEqual(
    parsed.keyId.toString("hex"),
    parseUpdaterPubkey(LEGACY_INCREMENTUM_PUBKEY).keyId.toString("hex"),
  );
});

test("parseSignatureBox accepts base64-of-box and raw box text", () => {
  const fromB64 = parseSignatureBox(V2_6_0_APPIMAGE_SIG);
  const rawBox = Buffer.from(V2_6_0_APPIMAGE_SIG, "base64").toString("utf8");
  const fromRaw = parseSignatureBox(rawBox);
  assert.deepEqual(fromB64, fromRaw);
  assert.equal(fromB64.sigAlg.toString("latin1"), "ED");
  assert.equal(fromB64.keyId.toString("hex"), "3c14864694483d6b");
  assert.ok(fromB64.trustedComment.includes("Incrementum_2.6.0_amd64.AppImage"));
  assert.equal(fromB64.signature.length, 64);
  assert.equal(fromB64.globalSignature.length, 64);
});

test("v2.6.1 release signature parses and carries the production key id", () => {
  const box = parseSignatureBox(V2_6_1_APPIMAGE_SIG);
  assert.equal(box.sigAlg.toString("latin1"), "ED");
  assert.equal(box.keyId.toString("hex"), "3c14864694483d6b");
  assert.ok(box.trustedComment.includes("Incrementum_2.6.1_amd64.AppImage"));
});

test("valid signature over a deterministic artifact verifies end-to-end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-update-artifact-"));
  try {
    const artifact = writeFixtureArtifact(dir);
    await assert.doesNotReject(
      verifyUpdateSignature({
        artifactPath: artifact,
        signature: TEST_SIG,
        pubkey: TEST_PUBKEY,
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a single flipped artifact byte fails signature verification", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-update-artifact-"));
  try {
    const mutated = writeFixtureArtifact(dir, { mutate: true });
    await assert.rejects(
      verifyUpdateSignature({
        artifactPath: mutated,
        signature: TEST_SIG,
        pubkey: TEST_PUBKEY,
      }),
      /does not match artifact bytes/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("signature signed by a different key is rejected by key id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-update-artifact-"));
  try {
    const artifact = writeFixtureArtifact(dir);
    await assert.rejects(
      verifyUpdateSignature({
        artifactPath: artifact,
        signature: TEST_SIG,
        pubkey: PROD_PUBKEY,
      }),
      /does not match updater public key/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered signature line (still decodable) fails verification", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-update-artifact-"));
  try {
    const artifact = writeFixtureArtifact(dir);
    const rawBox = Buffer.from(TEST_SIG, "base64").toString("utf8");
    const lines = rawBox.split("\n");
    // Swap two characters in the middle of the signature line — still
    // base64-decodes to 74 bytes, but to different signature/key bytes.
    const sigLine = lines[1];
    lines[1] =
      sigLine.slice(0, 20) +
      sigLine.slice(21, 22) +
      sigLine.slice(20, 21) +
      sigLine.slice(22);
    await assert.rejects(
      verifyUpdateSignature({
        artifactPath: artifact,
        signature: lines.join("\n"),
        pubkey: TEST_PUBKEY,
      }),
      (err) => {
        assert.ok(err instanceof VerificationError);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real release signatures reject wrong artifact data without parse errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-update-artifact-"));
  try {
    const artifact = writeFixtureArtifact(dir);
    // Both real signatures are structurally sound and carry the production
    // key id, but they cover 274 MB artifacts we cannot embed — against any
    // other bytes they must fail as signature mismatches (not key/parse
    // errors), which is what the verify-release CI gate relies on.
    for (const [label, signature] of [
      ["v2.6.0", V2_6_0_APPIMAGE_SIG],
      ["v2.6.1", V2_6_1_APPIMAGE_SIG],
    ]) {
      await assert.rejects(
        verifyUpdateSignature({
          artifactPath: artifact,
          signature,
          pubkey: LEGACY_INCREMENTUM_PUBKEY,
        }),
        (err) => {
          assert.ok(err instanceof VerificationError, `${label}: unexpected error type`);
          assert.match(err.message, /does not match artifact bytes/);
          return true;
        },
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseSignatureBox rejects malformed boxes", () => {
  assert.throws(() => parseSignatureBox("not-a-signature"), VerificationError);
  const twoLineBox =
    "untrusted comment: x\nRUBQ8FIZGdLEg9a8hj6Sy0yLm1rC43e9QyOFWdy4KjnG7UjA9SFsuqp//ByiJ4hayRi7r3qc6zFyFHWZ4kFWY1LDJ8fUv1dcZzmDgk=";
  assert.throws(() => parseSignatureBox(twoLineBox), /4 lines/);
});

test("checkArtifactDigest accepts the recorded digest and rejects others", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-update-artifact-"));
  try {
    const artifact = writeFixtureArtifact(dir);
    await assert.doesNotReject(
      checkArtifactDigest(artifact, `sha256:${TEST_SHA256}`),
    );
    await assert.rejects(
      checkArtifactDigest(
        artifact,
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      ),
      /does not match expected/,
    );
    await assert.rejects(
      checkArtifactDigest(artifact, "md5:deadbeef"),
      /must look like/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
