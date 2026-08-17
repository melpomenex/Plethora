#!/usr/bin/env node
/**
 * verify-update-artifact — cryptographically verify a Tauri updater
 * artifact's minisign signature the same way the running app's updater
 * (tauri-plugin-updater → minisign-verify) does.
 *
 * Motivation: the v2.6.1 release shipped an AppImage whose .sig did not
 * match the uploaded bytes (v2.6.0 verified with identical pipeline code —
 * a release flake nothing detected), so every Linux AppImage user's in-place
 * update failed signature verification. This script closes that gap as a CI
 * gate: run it after signing (before upload) and against the published
 * manifest after release.
 *
 * Verification semantics (mirrors minisign-verify `PublicKey::verify` with
 * allow_legacy=true, as invoked by tauri-plugin-updater):
 *   - pubkey from tauri.conf.json `plugins.updater.pubkey`: base64 of
 *     "untrusted comment…" + base64 key line; key line decodes to
 *     alg("Ed") + key_id(8) + ed25519_key(32).
 *   - signature: either the raw minisign box text, or base64 of that box
 *     (the format the Tauri CLI writes into .sig files and the update
 *     manifest's `signature` field carries). Box lines: untrusted comment /
 *     base64(alg(2)+key_id(8)+sig(64)) / "trusted comment: …" /
 *     base64(global_sig(64)).
 *   - alg "ED" (prehashed): main signature is over blake2b512(artifact);
 *     alg "Ed" (legacy): over the raw artifact bytes.
 *   - key_id must match the pubkey's, and the global signature must verify
 *     over sig(64) + utf8(trusted comment).
 *
 * Exit codes: 0 = valid; 1 = verification failed; 2 = usage/parse error.
 *
 * Usage:
 *   node scripts/verify-update-artifact.mjs \
 *     --pubkey-config src-tauri/tauri.conf.json \
 *     --artifact src-tauri/target/release/bundle/appimage/Plethora_2.6.2_amd64.AppImage \
 *     --sig      src-tauri/target/release/bundle/appimage/Plethora_2.6.2_amd64.AppImage.sig \
 *     [--check-digest sha256:<hex>]
 *
 * `--signature <string>` may replace `--sig` to verify a manifest signature
 * field directly (base64-of-box or raw box text). `--pubkey <base64>` may
 * replace `--pubkey-config` for tests.
 */

import {
  createHash,
  createPublicKey,
  verify as ed25519Verify,
} from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SIG_ALG_PREHASHED = 0x45_44; // "ED"
const SIG_ALG_LEGACY = 0x45_64; // "Ed"
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export class VerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationError";
  }
}

function b64decode(input, label) {
  let buffer;
  try {
    buffer = Buffer.from(String(input).trim(), "base64");
  } catch (err) {
    throw new VerificationError(`${label} is not valid base64: ${err.message}`);
  }
  // Buffer.from silently ignores invalid chars; re-encode round-trip to
  // detect tampering that changes length semantics.
  if (buffer.length === 0 || buffer.toString("base64").replace(/=+$/, "") !==
      String(input).trim().replace(/[\r\n]/g, "").replace(/=+$/, "")) {
    throw new VerificationError(`${label} is not valid base64`);
  }
  return buffer;
}

/**
 * Parse a minisign signature box. Accepts raw box text (starts with
 * "untrusted comment:") or base64-of-box (what the Tauri CLI writes to .sig
 * files and what latest.json's `signature` field carries).
 */
export function parseSignatureBox(input) {
  let text = String(input).trim();
  if (!text.startsWith("untrusted comment:")) {
    const decoded = b64decode(text, "signature");
    text = decoded.toString("utf8");
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 4) {
    throw new VerificationError(
      `signature box must have 4 lines (untrusted/sig/trusted/global), got ${lines.length}`,
    );
  }
  const trustedPrefix = "trusted comment: ";
  if (!lines[2].startsWith(trustedPrefix)) {
    throw new VerificationError(
      `signature box line 3 must start with "${trustedPrefix}"`,
    );
  }
  const sigRaw = b64decode(lines[1], "signature line");
  if (sigRaw.length !== 74) {
    throw new VerificationError(
      `signature line must decode to 74 bytes (alg 2 + key id 8 + sig 64), got ${sigRaw.length}`,
    );
  }
  const globalRaw = b64decode(lines[3], "global signature line");
  if (globalRaw.length !== 64) {
    throw new VerificationError(
      `global signature line must decode to 64 bytes, got ${globalRaw.length}`,
    );
  }
  return {
    untrustedComment: lines[0],
    sigAlg: sigRaw.subarray(0, 2),
    keyId: sigRaw.subarray(2, 10),
    signature: sigRaw.subarray(10, 74),
    trustedComment: lines[2].slice(trustedPrefix.length),
    globalSignature: globalRaw,
  };
}

/**
 * Parse the updater pubkey from tauri.conf.json's `plugins.updater.pubkey`
 * value (base64 of "untrusted comment…" + key line).
 */
export function parseUpdaterPubkey(pubkeyConfigB64) {
  const text = b64decode(pubkeyConfigB64, "updater pubkey config").toString("utf8");
  const keyLine = text
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0 && !line.startsWith("untrusted comment:"));
  if (!keyLine) {
    throw new VerificationError("updater pubkey config has no key line");
  }
  const raw = b64decode(keyLine.trim(), "updater key line");
  if (raw.length !== 42 || raw[0] !== 0x45 || raw[1] !== 0x64) {
    throw new VerificationError(
      "updater key line must decode to 42 bytes starting with 'Ed'",
    );
  }
  return { keyId: raw.subarray(2, 10), ed25519Key: raw.subarray(10, 42) };
}

function ed25519PublicKey(rawKeyBytes) {
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, rawKeyBytes]),
    format: "der",
    type: "spki",
  });
}

async function sha256File(filePath) {
  return (await digestFile(filePath, "sha256")).toString("hex");
}

async function digestFile(filePath, algorithm) {
  const hash = createHash(algorithm);
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest(); // raw digest bytes
}

/**
 * Verify an updater artifact's signature. Mirrors the checks the app's
 * updater performs at install time; throws VerificationError on any failure.
 *
 * @param {{artifactPath: string, signature: string, pubkey: string}} params
 *   artifactPath — path to the artifact bytes to verify.
 *   signature    — minisign box text or base64-of-box (manifest field / .sig
 *                  file contents).
 *   pubkey       — the tauri.conf.json pubkey value (base64-of-text).
 */
export async function verifyUpdateSignature({ artifactPath, signature, pubkey }) {
  try {
    createHash("blake2b512");
  } catch {
    throw new VerificationError(
      "this Node build lacks blake2b512 in node:crypto (OpenSSL 3 required)",
    );
  }
  const parsedKey = parseUpdaterPubkey(pubkey);
  const box = parseSignatureBox(signature);

  const alg = (box.sigAlg[0] << 8) | box.sigAlg[1];
  let message;
  if (alg === SIG_ALG_PREHASHED) {
    message = await digestFile(artifactPath, "blake2b512");
  } else if (alg === SIG_ALG_LEGACY) {
    // Legacy signatures cover the artifact bytes directly. Tauri never
    // emits these; accepted only for minisign compatibility.
    message = readFileSync(artifactPath);
  } else {
    throw new VerificationError(
      `unsupported signature algorithm ${JSON.stringify(box.sigAlg.toString("latin1"))} (expected ED or Ed)`,
    );
  }

  if (!box.keyId.equals(parsedKey.keyId)) {
    throw new VerificationError(
      `signature key id ${box.keyId.toString("hex")} does not match updater public key ${parsedKey.keyId.toString("hex")}`,
    );
  }

  const publicKey = ed25519PublicKey(parsedKey.ed25519Key);
  if (!ed25519Verify(null, message, publicKey, box.signature)) {
    throw new VerificationError(
      `signature does not match artifact bytes (${artifactPath})`,
    );
  }
  const globalMessage = Buffer.concat([
    box.signature,
    Buffer.from(box.trustedComment, "utf8"),
  ]);
  if (!ed25519Verify(null, globalMessage, publicKey, box.globalSignature)) {
    throw new VerificationError("trusted-comment signature is invalid");
  }
  return true;
}

export async function checkArtifactDigest(artifactPath, expectedDigest) {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(String(expectedDigest).trim());
  if (!match) {
    throw new VerificationError(`digest must look like sha256:<64 hex>, got ${expectedDigest}`);
  }
  const actual = await sha256File(artifactPath);
  if (actual !== match[1].toLowerCase()) {
    throw new VerificationError(
      `artifact sha256 ${actual} does not match expected ${match[1].toLowerCase()}`,
    );
  }
  return actual;
}

export function loadUpdaterPubkeyFromConfig(configPath) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const pubkey = config?.plugins?.updater?.pubkey;
  if (typeof pubkey !== "string" || pubkey.length === 0) {
    throw new VerificationError(`${configPath} has no plugins.updater.pubkey`);
  }
  return pubkey;
}

function printUsageAndExit() {
  console.error(`usage: node scripts/verify-update-artifact.mjs \\
  (--pubkey-config <tauri.conf.json> | --pubkey <base64>) \\
  --artifact <file> (--sig <file> | --signature <string>) \\
  [--check-digest sha256:<hex>]`);
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const readArg = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const artifactPath = readArg("--artifact");
  const sigPath = readArg("--sig");
  const signatureString = readArg("--signature");
  const pubkeyArg = readArg("--pubkey");
  const pubkeyConfigPath = readArg("--pubkey-config");
  const expectedDigest = readArg("--check-digest");

  if (!artifactPath || (!sigPath && !signatureString) || (!pubkeyArg && !pubkeyConfigPath)) {
    printUsageAndExit();
  }

  const pubkey = pubkeyArg ?? loadUpdaterPubkeyFromConfig(pubkeyConfigPath);
  const signature = signatureString ?? readFileSync(sigPath, "utf8");

  try {
    await verifyUpdateSignature({ artifactPath, signature, pubkey });
    if (expectedDigest) {
      await checkArtifactDigest(artifactPath, expectedDigest);
    }
    console.log(`VALID: ${artifactPath} signature verifies against the updater public key`);
  } catch (err) {
    if (err instanceof VerificationError) {
      console.error(`INVALID: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
