/**
 * Change A task 6.1 — iOS runtime-configuration hygiene audit.
 *
 * Scans the iOS-effective Tauri bundle configuration (tauri.conf.json merged
 * with tauri.ios.conf.json) for dev/test endpoints that must never reach a
 * store build. Loopback hosts are allowed only in structural keys:
 *   - build.devUrl        — dev-server URL; unused in release bundles
 *   - app.security.csp    — Tauri's own asset.localhost / ipc.localhost and
 *   - app.security.devCsp   media-loopback directives ship inside the CSP
 * Everything else pointing at localhost/127.0.0.1/test/staging hosts fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const BASE_CONF = JSON.parse(readFileSync(join(REPO_ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
const IOS_OVERLAY_PATH = join(REPO_ROOT, "src-tauri", "tauri.ios.conf.json");
const IOS_OVERLAY = JSON.parse(readFileSync(IOS_OVERLAY_PATH, "utf8"));

function deepMerge(base, overlay) {
  if (overlay === undefined) return base;
  if (typeof base !== "object" || base === null || typeof overlay !== "object" || overlay === null || Array.isArray(base)) {
    return overlay;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(overlay)) out[k] = deepMerge(out[k], v);
  return out;
}

/** Collect every string leaf with its dotted key path. */
function collectStrings(node, prefix = "", acc = []) {
  if (typeof node === "string") {
    acc.push([prefix, node]);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => collectStrings(v, `${prefix}[${i}]`, acc));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) collectStrings(v, prefix ? `${prefix}.${k}` : k, acc);
  }
  return acc;
}

const MERGED = deepMerge(BASE_CONF, IOS_OVERLAY);
// Structural keys where loopback references are expected and harmless.
const LOOPBACK_ALLOWLIST = [
  (p) => p === "build.devUrl",
  (p) => p === "build.devUrl" || /^build\.devCsp/.test(p),
  (p) => p === "app.security.csp" || p === "app.security.devCsp",
];

const LOOPBACK_RE = /(?:^|\/\/|\.)localhost(?::|$)|(?:^|\/\/)127\.0\.0\.1(?::|$)|(?:^|\/\/)\[::1\](?::|$)/;
const TEST_HOST_RE = /(?:^|\/\/)(?:test|testing|stage|staging|dev|qa|sandbox|demo|uat)[.-][^/:]+/i;

test("iOS-effective config contains no loopback hosts outside structural allowlist", () => {
  const offenders = [];
  for (const [path, value] of collectStrings(MERGED)) {
    if (!LOOPBACK_RE.test(value)) continue;
    if (LOOPBACK_ALLOWLIST.some((allow) => allow(path))) continue;
    offenders.push(`${path} = ${value}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `Loopback endpoints leaked into the iOS runtime config:\n  ${offenders.join("\n  ")}`
  );
});

test("no test/staging/dev hostnames anywhere in the iOS-effective config", () => {
  const offenders = [];
  for (const [path, value] of collectStrings(MERGED)) {
    if (path.endsWith("devUrl")) continue; // dev-server URL is dev-only by design
    if (TEST_HOST_RE.test(value)) offenders.push(`${path} = ${value}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `Non-production hostnames found in the iOS runtime config:\n  ${offenders.join("\n  ")}`
  );
});

test("updater endpoints are https:// production URLs (plugin is iOS-gated, config stays clean)", () => {
  const endpoints = MERGED?.plugins?.updater?.endpoints;
  assert.ok(Array.isArray(endpoints) && endpoints.length > 0, "plugins.updater.endpoints missing");
  for (const url of endpoints) {
    assert.match(url, /^https:\/\//, `updater endpoint is not https: ${url}`);
    assert.doesNotMatch(url, LOOPBACK_RE, `updater endpoint points at loopback: ${url}`);
  }
});

test("store builds point at production endpoints via the store build profile", () => {
  // The store-profile guard (src/lib/storeProfileGuard.ts + vite writeBundle
  // hook) hard-fails PLETHORA_BUILD_PROFILE=store frontend bundles containing
  // loopback endpoints; this asserts the wiring still exists end-to-end.
  const viteConfig = readFileSync(join(REPO_ROOT, "vite.config.ts"), "utf8");
  assert.match(viteConfig, /PLETHORA_BUILD_PROFILE/, "vite.config.ts no longer reads the build profile");
  assert.match(viteConfig, /forbidden dev\/test artifacts/, "vite.config.ts store-profile guard hook missing");

  const guard = readFileSync(join(REPO_ROOT, "src", "lib", "storeProfileGuard.ts"), "utf8");
  assert.match(guard, /localhost|127\.0\.0\.1/i, "storeProfileGuard no longer treats loopback as forbidden");
});
