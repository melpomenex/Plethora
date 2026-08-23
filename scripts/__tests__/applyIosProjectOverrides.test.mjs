/**
 * Unit tests for scripts/apply-ios-project-overrides.js
 * Run with `npm run test:scripts`
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  applyIosProjectOverrides,
  updateProjectYml,
  updateInfoPlist,
  updateEntitlements,
  syncIcons,
} from "../apply-ios-project-overrides.js";

const PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleShortVersionString</key>
	<string>2.7.0</string>
	<key>CFBundleVersion</key>
	<string>2.7.0</string>
	<key>LSRequiresIPhoneOS</key>
	<true/>
</dict>
</plist>
`;

const ENTITLEMENTS_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
`;

const PROJECT_YML = `name: plethora-tauri
options:
  bundleIdPrefix: com.plethora.app
targets:
  plethora-tauri_iOS:
    type: application
    platform: iOS
    info:
      path: plethora-tauri_iOS/Info.plist
      properties:
        LSRequiresIPhoneOS: true
        CFBundleShortVersionString: 2.7.0
        CFBundleVersion: "2.7.0"
    settings:
      base:
        ENABLE_BITCODE: false
        PRODUCT_BUNDLE_IDENTIFIER: com.plethora.app
`;

// Minimal 1x1 PNG so icon byte-compare works realistically.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let tmp;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ios-overrides-"));
});

function scaffoldFixture({ icons = 2 } = {}) {
  const appleDir = join(tmp, "apple");
  const overridesDir = join(tmp, "ios-overrides");
  const iconsDir = join(tmp, "icons-src");
  mkdirSync(join(appleDir, "plethora-tauri_iOS"), { recursive: true });
  mkdirSync(join(appleDir, "Assets.xcassets", "AppIcon.appiconset"), { recursive: true });
  mkdirSync(overridesDir, { recursive: true });
  mkdirSync(iconsDir, { recursive: true });
  writeFileSync(join(appleDir, "project.yml"), PROJECT_YML);
  writeFileSync(join(appleDir, "plethora-tauri_iOS", "Info.plist"), PLIST_TEMPLATE);
  writeFileSync(
    join(appleDir, "plethora-tauri_iOS", "plethora-tauri_iOS.entitlements"),
    ENTITLEMENTS_EMPTY
  );
  writeFileSync(join(appleDir, "Assets.xcassets", "AppIcon.appiconset", "Contents.json"), "{}");
  for (let i = 0; i < icons; i++) {
    writeFileSync(join(iconsDir, `AppIcon-${i}.png`), TINY_PNG);
  }
  return { appleDir, overridesDir, iconsDir };
}

/* ── updateProjectYml ─────────────────────────────────────────────────────── */

test("updateProjectYml adds device families, deployment target and display name", () => {
  const { out, applied } = updateProjectYml(PROJECT_YML, { version: "2.7.0", overrides: {} });
  assert.match(out, /TARGETED_DEVICE_FAMILY: "1,2"/);
  assert.match(out, /IPHONEOS_DEPLOYMENT_TARGET: 14\.0/);
  assert.match(out, /CFBundleDisplayName: Plethora/);
  assert.ok(applied.length >= 2);
});

test("updateProjectYml is idempotent", () => {
  const once = updateProjectYml(PROJECT_YML, { version: "2.7.0", overrides: {} });
  const twice = updateProjectYml(once.out, { version: "2.7.0", overrides: {} });
  assert.deepEqual(twice.applied, []);
  assert.equal(twice.out, once.out);
});

test("updateProjectYml rewrites marketing version", () => {
  const { out } = updateProjectYml(PROJECT_YML, { version: "2.8.0", overrides: {} });
  assert.match(out, /CFBundleShortVersionString: 2\.8\.0/);
  assert.match(out, /CFBundleVersion: "2\.8\.0"/);
});

test("updateProjectYml throws when bundle identifier drifts from contract", () => {
  assert.throws(
    () =>
      updateProjectYml(
        PROJECT_YML.replace("PRODUCT_BUNDLE_IDENTIFIER: com.plethora.app", "PRODUCT_BUNDLE_IDENTIFIER: com.example.other"),
        {
          version: "2.7.0",
          overrides: {},
        }
      ),
    /PRODUCT_BUNDLE_IDENTIFIER/
  );
});

/* ── updateInfoPlist ──────────────────────────────────────────────────────── */

test("updateInfoPlist adds display name and TODO-C/TODO-E placeholders", () => {
  const { out, applied } = updateInfoPlist(PLIST_TEMPLATE, { version: "2.7.0" });
  assert.match(out, /<key>CFBundleDisplayName<\/key>/);
  assert.match(out, /TODO-C\(privacy-manifest\)/);
  assert.match(out, /TODO-E\(share-extension\)/);
  assert.ok(applied.length >= 3);
});

test("updateInfoPlist is idempotent", () => {
  const once = updateInfoPlist(PLIST_TEMPLATE, { version: "2.7.0" });
  const twice = updateInfoPlist(once.out, { version: "2.7.0" });
  assert.deepEqual(twice.applied, []);
});

test("updateInfoPlist injects purpose strings from privacy data", () => {
  const once = updateInfoPlist(PLIST_TEMPLATE, { version: "2.7.0" });
  const { out } = updateInfoPlist(once.out, {
    version: "2.7.0",
    purposeStrings: { NSCameraUsageDescription: "Scan documents" },
  });
  assert.match(out, /<key>NSCameraUsageDescription<\/key>/);
  assert.match(out, /<string>Scan documents<\/string>/);
  assert.doesNotMatch(out, /TODO-C\(privacy-manifest\)/);
});

/* ── updateEntitlements ───────────────────────────────────────────────────── */

test("updateEntitlements keeps minimal empty dict with TODO-E placeholder", () => {
  const { out } = updateEntitlements(ENTITLEMENTS_EMPTY, { appGroup: null });
  assert.match(out, /<dict\/>/);
  assert.match(out, /TODO-E\(share-extension\)/);
});

test("updateEntitlements adds App Group when share-extension data provides one", () => {
  const seeded = updateEntitlements(ENTITLEMENTS_EMPTY, { appGroup: null }).out;
  const { out } = updateEntitlements(seeded, { appGroup: "group.com.plethora.app.shared" });
  assert.match(out, /com\.apple\.security\.application-groups/);
  assert.match(out, /group\.com\.plethora\.app\.shared/);
  // Idempotent
  const again = updateEntitlements(out, { appGroup: "group.com.plethora.app.shared" });
  assert.deepEqual(again.applied, []);
});

/* ── syncIcons ────────────────────────────────────────────────────────────── */

test("syncIcons copies AppIcon PNGs into the appiconset and is idempotent", () => {
  const { appleDir, iconsDir } = scaffoldFixture();
  const changes = [];
  assert.equal(syncIcons(appleDir, iconsDir, changes), 2);
  const dest = join(appleDir, "Assets.xcassets", "AppIcon.appiconset", "AppIcon-0.png");
  assert.ok(readFileSync(dest).equals(TINY_PNG));
  const changes2 = [];
  assert.equal(syncIcons(appleDir, iconsDir, changes2), 0);
  assert.deepEqual(changes2, []);
});

test("syncIcons throws when the appiconset is missing (init not run)", () => {
  const { appleDir, iconsDir } = scaffoldFixture();
  rmSync(join(appleDir, "Assets.xcassets"), { recursive: true, force: true });
  assert.throws(() => syncIcons(appleDir, iconsDir, []), /tauri:ios:init/);
});

/* ── end-to-end orchestration ─────────────────────────────────────────────── */

function runApply(fixture) {
  return applyIosProjectOverrides({
    appleDir: fixture.appleDir,
    overridesDir: fixture.overridesDir,
    iconsSourceDir: fixture.iconsDir,
    tauriConfPath: join(tmp, "tauri.conf.json"),
    repoRoot: tmp,
  });
}

test("applyIosProjectOverrides end-to-end applies placeholders then reaches fixpoint", () => {
  const fixture = scaffoldFixture();
  writeFileSync(join(tmp, "tauri.conf.json"), JSON.stringify({ version: "2.7.0" }));

  const first = runApply(fixture);
  assert.ok(first.changes.length > 0);

  const second = runApply(fixture);
  assert.deepEqual(second.changes, [], "second run must be a no-op");

  const yml = readFileSync(join(fixture.appleDir, "project.yml"), "utf8");
  assert.match(yml, /TARGETED_DEVICE_FAMILY: "1,2"/);
  assert.doesNotMatch(yml, /BEGIN ios-share-extension/, "no extension stanza without E's data file");
});

test("applyIosProjectOverrides consumes share-extension.target.json when present", () => {
  const fixture = scaffoldFixture();
  writeFileSync(join(tmp, "tauri.conf.json"), JSON.stringify({ version: "2.7.0" }));
  writeFileSync(
    join(fixture.overridesDir, "share-extension.target.json"),
    JSON.stringify({
      targetName: "plethora-share-extension",
      displayName: "Plethora",
      bundleIdSuffix: "share",
      appGroup: "group.com.plethora.app.shared",
      deploymentTarget: "14.0",
      infoPlist: {
        NSExtension: {
          NSExtensionPointIdentifier: "com.apple.share-services",
        },
      },
      entitlements: { "com.apple.security.application-groups": ["group.com.plethora.app.shared"] },
      sourceFiles: "plethora-share-extension/Sources",
    })
  );

  runApply(fixture);

  const yml = readFileSync(join(fixture.appleDir, "project.yml"), "utf8");
  assert.match(yml, /BEGIN ios-share-extension/);
  assert.match(yml, /plethora-share-extension/);
  assert.match(yml, /app-extension/);
  assert.equal((yml.match(/^targets:$/gm) ?? []).length, 1, "must retain one targets map");
  assert.match(yml, /- target: plethora-share-extension\n\s+embed: true/);
  assert.match(yml, /- sdk: MediaPlayer\.framework/);
  assert.match(yml, /CFBundleDisplayName: Plethora/);
  assert.match(yml, /PRODUCT_BUNDLE_IDENTIFIER: com\.plethora\.app\.share/);
  assert.match(yml, /CURRENT_PROJECT_VERSION: 2\.7\.0/);

  const ent = readFileSync(
    join(fixture.appleDir, "plethora-tauri_iOS", "plethora-tauri_iOS.entitlements"),
    "utf8"
  );
  assert.match(ent, /group\.com\.plethora\.app\.shared/);

  const extPlist = readFileSync(
    join(fixture.appleDir, "plethora-share-extension", "Info.plist"),
    "utf8"
  );
  assert.match(extPlist, /com\.apple\.share-services/);
  assert.match(extPlist, /PRODUCT_BUNDLE_IDENTIFIER/);
  assert.match(extPlist, /CFBundleName/);
  assert.doesNotThrow(() => execFileSync("plutil", ["-lint", join(fixture.appleDir, "plethora-share-extension", "Info.plist")]));

  // Idempotent with the data file present too.
  const second = runApply(fixture);
  assert.deepEqual(second.changes, []);
});

test("applyIosProjectOverrides consumes privacy-manifest.json when present", () => {
  const fixture = scaffoldFixture();
  writeFileSync(join(tmp, "tauri.conf.json"), JSON.stringify({ version: "2.7.0" }));
  const manifestPath = join(tmp, "PrivacyInfo.xcprivacy");
  writeFileSync(manifestPath, "<plist><dict/></plist>");
  writeFileSync(
    join(fixture.overridesDir, "privacy-manifest.json"),
    JSON.stringify({
      privacyManifestSourcePath: "PrivacyInfo.xcprivacy",
      purposeStrings: { NSPhotoLibraryUsageDescription: "Attach covers" },
    })
  );

  runApply(fixture);

  const copied = readFileSync(
    join(fixture.appleDir, "plethora-tauri_iOS", "PrivacyInfo.xcprivacy"),
    "utf8"
  );
  assert.equal(copied, "<plist><dict/></plist>");

  const plist = readFileSync(join(fixture.appleDir, "plethora-tauri_iOS", "Info.plist"), "utf8");
  assert.match(plist, /NSPhotoLibraryUsageDescription/);
  assert.doesNotMatch(plist, /TODO-C\(privacy-manifest\)/);
});

test("applyIosProjectOverrides throws a clear error before init has run", () => {
  const empty = mkdtempSync(join(tmpdir(), "ios-empty-"));
  assert.throws(
    () =>
      applyIosProjectOverrides({
        appleDir: empty,
        overridesDir: join(empty, "overrides"),
        iconsSourceDir: empty,
        tauriConfPath: join(tmp, "tauri.conf.json"),
      }),
    /tauri:ios:init/
  );
});
