#!/usr/bin/env node
/**
 * Repository terminology gate — fails when legacy third-party scheduler branding
 * appears outside documented compatibility boundaries.
 *
 * Usage: node scripts/check-scheduler-terminology.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

const SCAN_ROOTS = [
  "src",
  join("src-tauri", "src"),
  "docs",
  "website",
  "openspec",
  "scripts",
  "tests",
];

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  ".git",
  "generated",
  ".vercel",
]);

/** Paths that may contain literal legacy persisted identifiers. */
const EXEMPT_PATH_SUFFIXES = [
  "src/lib/schedulerIdentity.ts",
  "src-tauri/src/scheduler_identity.rs",
  "src-tauri/src/ipc_compat.rs",
  "src-tauri/src/database/migrations.rs",
  "src-tauri/migrations/",
  "whisper.cpp/",
];

const FORBIDDEN = [
  /\bsuper[\s_-]?memo\b/i,
  /\bsm[-_ ]?2\b/i,
  /\bsm[-_ ]?5\b/i,
  /\bsm[-_ ]?8\b/i,
  /\bsm[-_ ]?15\b/i,
  /\bsm[-_ ]?18\b/i,
  /\bsm[-_ ]?19\b/i,
  /\bsm[-_ ]?20\b/i,
  /\bsm2\b/i,
  /\bsm5\b/i,
  /\bsm8\b/i,
  /\bsm15\b/i,
  /\bsm18\b/i,
  /\bsm19\b/i,
  /\bsm20\b/i,
  /legacy[\s_-]?stability[\s_-]?increase/i,
  /super-memory\.com/i,
  new RegExp(["super", "memo"].join("") + "\\.guru", "i"),
];

function isExempt(relPath) {
  const norm = relPath.replace(/\\/g, "/");
  return EXEMPT_PATH_SUFFIXES.some((suffix) => norm.includes(suffix));
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(ROOT, abs);
    if (SKIP_DIR_NAMES.has(name)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, files);
    } else if (st.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

function isTextCandidate(relPath) {
  if (isExempt(relPath)) return false;
  if (/\.(png|jpg|jpeg|gif|webp|avif|ico|icns|woff2?|ttf|eot|zip|dat|bin|wasm|mp3|mp4|pdf)$/i.test(relPath)) {
    return false;
  }
  if (relPath.includes("package-lock.json") || relPath.endsWith(".lock")) return false;
  return true;
}

const offenders = [];

for (const root of SCAN_ROOTS) {
  const absRoot = join(ROOT, root);
  let files;
  try {
    files = walk(absRoot);
  } catch {
    continue;
  }
  for (const rel of files) {
    if (!isTextCandidate(rel)) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    for (const pattern of FORBIDDEN) {
      const match = text.match(pattern);
      if (match) {
        const idx = text.search(pattern);
        const line = text.slice(0, idx).split("\n").length;
        offenders.push(`${rel}:${line}: ${match[0]}`);
        break;
      }
    }
  }
}

if (offenders.length > 0) {
  console.error("Forbidden scheduler terminology found:\n");
  for (const o of offenders.slice(0, 100)) {
    console.error(`  ${o}`);
  }
  if (offenders.length > 100) {
    console.error(`  ... and ${offenders.length - 100} more`);
  }
  console.error(`\nTotal forbidden active-source hits: ${offenders.length}`);
  process.exit(1);
}

console.log("Total forbidden active-source hits: 0");
process.exit(0);
