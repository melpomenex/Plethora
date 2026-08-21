#!/usr/bin/env node
/**
 * ios-release.mjs — Change A tasks 4.2/4.3: signed iOS archive, export,
 * App Store Connect validation, and TestFlight upload pipeline.
 *
 * Subcommands (npm scripts `tauri:ios:archive|export|validate|upload|preflight`):
 *
 *   archive     Build the Release device archive via the Tauri CLI
 *               (`tauri ios build --target aarch64-apple-ios`), which drives
 *               cargo + `xcodebuild archive`. Runs with
 *               PLETHORA_BUILD_PROFILE=store unless already set, so the
 *               store-profile guards apply to release archives.
 *   export      Export an .ipa from a produced .xcarchive via
 *               `xcodebuild -exportArchive` with an exportOptions plist
 *               (local: src-tauri/gen/apple/secrets/exportOptions.plist or
 *               $EXPORT_OPTIONS_PLIST).
 *   validate    Validate the exported .ipa against App Store Connect via
 *               `xcrun altool --validate-app` authenticated with an ASC API key.
 *   upload      Upload the validated .ipa to TestFlight via
 *               `xcrun altool --upload-app` (same ASC API-key auth).
 *   preflight   Print tool/secret availability without building anything.
 *
 * Upload CLI rationale: Apple deprecated `altool` for macOS notarization in
 * favor of `notarytool`; notarytool does NOT handle App Store/TestFlight
 * uploads. For .ipa submission the first-party CLI options are Xcode/
 * Transporter (GUI) and `xcrun altool --validate-app/--upload-app` with ASC
 * API-key auth (`--apiKey/--apiIssuer`). We use altool because it is the only
 * first-party CLI that performs standalone validation AND upload of an
 * exported .ipa, keeping the pipeline stages symmetric. If Apple removes
 * altool, swap only the validate/upload command builders below.
 *
 * Required secrets/env for validate+upload (never committed):
 *   ASC_KEY_ID        App Store Connect API key ID
 *   ASC_ISSUER_ID     App Store Connect API issuer ID
 *   ASC_KEY_PDF_BASE64  Base64 of the .p8 private key (name kept for contract
 *                     compatibility; the content is the p8, not a PDF)
 *
 * Failure behavior (design.md): missing prerequisites fail fast with an
 * actionable message listing exactly what is absent — no half-signed output.
 */

import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const APPLE_DIR = join(REPO_ROOT, "src-tauri", "gen", "apple");
const TARGET_DIR = join(REPO_ROOT, "src-tauri", "target", "xcodebuild");
const EXPORT_DIR = join(TARGET_DIR, "export");
const LOG_DIR = join(TARGET_DIR, "logs");
const DEFAULT_EXPORT_OPTIONS = join(APPLE_DIR, "secrets", "exportOptions.plist");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requireCmd(cmd, hint) {
  if (spawnSync(cmd, ["--version"], { encoding: "utf8" }).status !== 0) {
    fail(`${cmd} is not available. ${hint}`);
  }
}

/** Locate the newest produced .ipa across known output roots. */
export function findIpa(roots = [EXPORT_DIR, join(APPLE_DIR, "build"), join(REPO_ROOT, "src-tauri", "target")]) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ipa")) found.push(p);
    }
  };
  for (const root of roots) walk(root);
  if (found.length === 0) {
    fail(
      `No .ipa found under:\n  ${roots.join("\n  ")}\n` +
        `Run \`npm run tauri:ios:export\` first (or check the export step's log).`
    );
  }
  // Newest first.
  found.sort((a, b) => mtimeSec(b) - mtimeSec(a));
  return found[0];
}

/** Locate the newest produced .xcarchive across known output roots. */
export function findArchive(
  roots = [join(APPLE_DIR, "build"), TARGET_DIR]
) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.endsWith(".xcarchive")) found.push(p);
        else walk(p);
      }
    }
  };
  for (const root of roots) walk(root);
  if (found.length === 0) {
    fail(
      `No .xcarchive found under:\n  ${roots.join("\n  ")}\n` +
        `Run \`npm run tauri:ios:archive\` first.`
    );
  }
  found.sort((a, b) => mtimeSec(b) - mtimeSec(a));
  return found[0];
}

function mtimeSec(p) {
  const r = spawnSync("stat", ["-f", "%m", p], { encoding: "utf8" });
  return r.status === 0 ? Number(r.stdout.trim()) || 0 : 0;
}

/* ── ASC API key material ─────────────────────────────────────────────────── */

export function requiredAscEnv() {
  const missing = [];
  for (const name of ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PDF_BASE64"]) {
    if (!process.env[name] || process.env[name].trim() === "") missing.push(name);
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Materialize the ASC .p8 private key where xcrun tools look for it:
 * `<keyDir>/AuthKey_<KEY_ID>.p8`. Returns the directory that must be searched.
 */
export function materializeAscKey(keyDir = process.env.ASC_KEY_DIR || join(homedir(), ".appstoreconnect", "private_keys")) {
  const { ok, missing } = requiredAscEnv();
  if (!ok) {
    fail(
      `App Store Connect API credentials incomplete. Missing env: ${missing.join(", ")}.\n` +
        `Create an API key in App Store Connect (Users and Access → Integrations → App Store Connect API),\n` +
        `then export ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PDF_BASE64 (base64 of the .p8 file).`
    );
  }
  const keyId = process.env.ASC_KEY_ID.trim();
  const keyPath = join(keyDir, `AuthKey_${keyId}.p8`);
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(keyPath, Buffer.from(process.env.ASC_KEY_PDF_BASE64, "base64"));
  return { keyId, keyDir, keyPath };
}

/* ── Subcommands ──────────────────────────────────────────────────────────── */

function cmdPreflight() {
  const hasXcodebuild =
    spawnSync("xcodebuild", ["-version"], { encoding: "utf8" }).status === 0;
  const asc = requiredAscEnv();
  const exportOptions =
    process.env.EXPORT_OPTIONS_PLIST || (existsSync(DEFAULT_EXPORT_OPTIONS) ? DEFAULT_EXPORT_OPTIONS : null);
  const rows = [
    [`xcodebuild`, hasXcodebuild ? "available" : "MISSING — install full Xcode (not just CLT)"],
    [
      `exportOptions plist`,
      exportOptions ?? `absent — copy ${DEFAULT_EXPORT_OPTIONS}.example and fill it in`,
    ],
    [`ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PDF_BASE64`, asc.ok ? "present" : `missing: ${asc.missing.join(", ")}`],
  ];
  for (const [k, v] of rows) console.log(`  ${k.padEnd(46)} ${v}`);
  console.log(hasXcodebuild ? "\npreflight OK" : "\npreflight FAILED");
  if (!hasXcodebuild) process.exit(1);
}

function cmdArchive(argv) {
  requireCmd("xcodebuild", "Install full Xcode and run `xcode-select -s /Applications/Xcode.app`.");
  let exportMethod = "app-store-connect";
  const passThrough = [];
  const dd = argv.indexOf("--");
  if (dd !== -1) passThrough.push(...argv.slice(dd + 1));
  for (let i = 0; i < (dd === -1 ? argv.length : dd); i++) {
    if (argv[i] === "--export-method") exportMethod = argv[++i];
  }

  // Store-profile guard rails run on release archives by default (task 6.1).
  const env = {
    ...process.env,
    PLETHORA_BUILD_PROFILE: process.env.PLETHORA_BUILD_PROFILE || "store",
  };

  // Monotonic build number: explicit env wins, else the committed counter file.
  const counterFile = join(APPLE_DIR, "build-number.txt");
  if (!process.env.IOS_BUILD_NUMBER && existsSync(counterFile)) {
    env.IOS_BUILD_NUMBER = readTrimmed(counterFile);
  }

  const args = [
    "ios",
    "build",
    "--ci",
    "--target",
    "aarch64-apple-ios",
    "--features",
    "custom-protocol",
    "--export-method",
    exportMethod,
  ];
  if (env.IOS_BUILD_NUMBER) args.push("--build-number", String(env.IOS_BUILD_NUMBER));
  // Passthrough args (after `--`) go straight to the tauri command's runner
  // (`-- <args>` forwards them to xcodebuild) — used by CI to inject signing
  // settings (e.g. DEVELOPMENT_TEAM=…, -allowProvisioningUpdates).
  if (passThrough.length > 0) args.push("--", ...passThrough);

  mkdirSync(LOG_DIR, { recursive: true });
  console.log(`[ios-release] tauri ${args.join(" ")}`);
  execSync(`npx tauri ${args.map(shellQuote).join(" ")}`, {
    stdio: ["inherit", "inherit", "inherit"],
    cwd: REPO_ROOT,
    env,
  });
  const archive = findArchive();
  console.log(`[ios-release] archive ready: ${archive}`);
}

function cmdExport() {
  requireCmd("xcodebuild", "Install full Xcode.");
  const archive = findArchive();
  const optionsPlist = process.env.EXPORT_OPTIONS_PLIST || DEFAULT_EXPORT_OPTIONS;
  if (!existsSync(optionsPlist)) {
    fail(
      `Export options plist not found at ${optionsPlist}.\n` +
        `Copy secrets/exportOptions.plist.example to secrets/exportOptions.plist and fill in your team/profile data\n` +
        `(or point EXPORT_OPTIONS_PLIST at one). See docs/release/ios-signing.md.`
    );
  }
  rmSync(EXPORT_DIR, { recursive: true, force: true });
  mkdirSync(EXPORT_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const log = join(LOG_DIR, "xcodebuild-export.log");
  console.log(`[ios-release] xcodebuild -exportArchive (${optionsPlist})`);
  runLogged(
    [
      "xcodebuild -exportArchive",
      `-archivePath "${archive}"`,
      `-exportOptionsPlist "${optionsPlist}"`,
      `-exportPath "${EXPORT_DIR}"`,
    ].join(" "),
    log
  );
  const ipa = findIpa([EXPORT_DIR]);
  console.log(`[ios-release] export log: ${log}`);
  console.log(`[ios-release] ipa ready: ${ipa}`);
}

function altoolArgs(action, ipa) {
  const { keyId } = materializeAscKey();
  // altool searches ./private_keys, ~/private_keys,
  // ~/.appstoreconnect/private_keys and /usr/local/private_keys for
  // AuthKey_<id>.p8; we always control the location explicitly.
  return [
    "xcrun altool",
    action,
    "--type ios",
    `-f "${ipa}"`,
    `--apiKey ${keyId}`,
    `--apiIssuer ${process.env.ASC_ISSUER_ID}`,
  ];
}

function cmdValidate() {
  const ipa = findIpa();
  const argv = altoolArgs("--validate-app", ipa);
  mkdirSync(LOG_DIR, { recursive: true });
  const log = join(LOG_DIR, "altool-validate.log");
  console.log(`[ios-release] validating ${ipa} (log: ${log})`);
  runLogged(argv.join(" "), log);
  console.log("[ios-release] validation PASSED");
}

function cmdUpload() {
  const ipa = findIpa();
  const argv = altoolArgs("--upload-app", ipa);
  mkdirSync(LOG_DIR, { recursive: true });
  const log = join(LOG_DIR, "altool-upload.log");
  console.log(`[ios-release] uploading ${ipa} to TestFlight (log: ${log})`);
  runLogged(argv.join(" "), log);
  console.log("[ios-release] upload submitted — track processing in App Store Connect → TestFlight");
}

function readTrimmed(p) {
  return readFileSync(p, "utf8").trim();
}

function runLogged(cmd, logPath) {
  execSync(`set -o pipefail; ${cmd} 2>&1 | tee "${logPath}"`, {
    stdio: ["inherit", "inherit", "inherit"],
    cwd: REPO_ROOT,
    shell: "/bin/zsh",
  });
}

function shellQuote(s) {
  return /^[A-Za-z0-9_.,:@/=+-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
}

/* ── Entry ────────────────────────────────────────────────────────────────── */

const USAGE = `usage: node scripts/ios-release.mjs <archive|export|validate|upload|preflight> [--export-method <m>]`;

const sub = process.argv[2];
const rest = process.argv.slice(3);
switch (sub) {
  case "preflight":
    cmdPreflight();
    break;
  case "archive":
    cmdArchive(rest);
    break;
  case "export":
    cmdExport();
    break;
  case "validate":
    cmdValidate();
    break;
  case "upload":
    cmdUpload();
    break;
  default:
    console.error(USAGE);
    process.exit(sub ? 1 : 0);
}
