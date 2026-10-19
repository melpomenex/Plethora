#!/usr/bin/env node
/**
 * Single source of truth for Windows package-identity metadata.
 *
 * The embedded application manifest (`src-tauri/windows/app.manifest`) declares
 * the sparse package identity that NSIS installs ship as
 * `PlethoraIdentity.msix`. Three files have to agree, and the version has to
 * track the application version declared in `src-tauri/tauri.conf.json` — that
 * version also drives the PE FILEVERSION/PRODUCTVERSION resource via
 * tauri-build, so a hard-coded identity version silently drifts (the 3.3.0
 * Windows build shipped profile version 3.3.0 next to identity metadata frozen
 * at 2.7.0.0).
 *
 *   node scripts/sync-windows-identity.mjs           # check (default)
 *   node scripts/sync-windows-identity.mjs --write   # regenerate + report
 *
 * Check mode exits non-zero and names the file, the declared value, and the
 * expected value for every drift; it also validates the *structure* of the
 * `<msix>` element, because a structural mistake there is not a version drift
 * but a launch failure: the Windows loader requires the application-manifest
 * form (a childless element with packageName / publisher / applicationId) and
 * rejects the whole manifest when it sees the package-manifest form used by
 * AppxManifest.xml (`<publisherIdentity>` / `<packageIdentity>` children).
 * Write mode regenerates the canonical attribute form, so the defect cannot
 * survive a sync run.
 *
 * Identity *values* are owned by the identity package manifest
 * (`src-tauri/windows/sparse/Package.appxmanifest`); the version is owned by
 * `tauri.conf.json`. This script propagates both and never invents a value.
 *
 * Wired into `npm run test:scripts` (scripts/__tests__/sync-windows-identity.test.mjs)
 * and asserted on the Windows leg of the release workflow before the identity
 * package is packed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MSIX_NAMESPACE = "urn:schemas-microsoft-com:msix.v1";

export const IDENTITY_FILES = {
  tauriConf: "src-tauri/tauri.conf.json",
  appManifest: "src-tauri/windows/app.manifest",
  sparseManifest: "src-tauri/windows/sparse/Package.appxmanifest",
  fullMsixManifest: "src-tauri/windows/msix/Package.appxmanifest",
};

const REQUIRED_MSIX_ATTRIBUTES = ["packageName", "publisher", "applicationId"];

/** Repository root, resolved from this script's location. */
export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * The identity package version is a four-part Windows version. A three-part
 * application version (`3.3.1`) is padded with a zero revision, which keeps the
 * value monotonic across patch releases instead of freezing at some old value.
 */
export function identityVersionFromAppVersion(version) {
  const parts = String(version ?? "").trim().split(".");
  if (parts.length < 2 || parts.length > 4) {
    throw new Error(`application version "${version}" is not a 2-4 part version`);
  }
  if (parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`application version "${version}" has a non-numeric part`);
  }
  while (parts.length < 4) parts.push("0");
  return parts.join(".");
}

/** Attribute name/value pairs of a start tag, as written in the file. */
export function parseTagAttributes(tagText) {
  const attributes = {};
  const body = tagText.replace(/^<[^\s/>]+/, "").replace(/\/?>$/, "");
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

/**
 * Locate the `<msix>` element without an XML parser dependency. Returns the
 * element text, whether it is self-closing (the required form), and its
 * attributes. Whitespace inside the complete element is preserved.
 */
export function findMsixElement(xml) {
  const open = xml.indexOf("<msix");
  if (open === -1) return null;

  // Walk to the end of the start tag, ignoring `>` inside attribute values.
  let i = open + 1;
  let quote = null;
  let tagEnd = -1;
  for (; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") {
      tagEnd = i;
      break;
    }
  }
  if (tagEnd === -1) return null;

  const startTag = xml.slice(open, tagEnd + 1);
  const selfClosing = startTag.endsWith("/>");
  const close = selfClosing ? tagEnd : xml.indexOf("</msix>", tagEnd);
  if (!selfClosing && close === -1) return null;
  const end = selfClosing ? tagEnd + 1 : close + "</msix>".length;

  return {
    start: open,
    end,
    text: xml.slice(open, end),
    selfClosing,
    attributes: parseTagAttributes(startTag),
  };
}

/** Identity values as declared by the identity package manifest. */
export function readIdentityPackageValues(sparseXml) {
  const identity = sparseXml.match(/<Identity\b[^>]*>/);
  if (!identity) throw new Error("identity package manifest has no <Identity> element");
  const apps = [...sparseXml.matchAll(/<Application\b[^>]*>/g)];
  if (apps.length === 0) {
    throw new Error("identity package manifest has no <Application> element");
  }
  const identityAttrs = parseTagAttributes(identity[0]);
  const appAttrs = parseTagAttributes(apps[0][0]);
  return {
    packageName: identityAttrs.Name,
    publisher: identityAttrs.Publisher,
    applicationId: appAttrs.Id,
  };
}

/** Version declared by the application manifest's root <assemblyIdentity>. */
export function readAssemblyIdentityVersion(appXml) {
  const assembly = appXml.match(/<assembly\b[^>]*>\s*<assemblyIdentity\b[^>]*>/);
  if (!assembly) {
    throw new Error("application manifest has no root <assemblyIdentity> element");
  }
  return parseTagAttributes(assembly[0].match(/<assemblyIdentity\b[^>]*>/)[0]).version;
}

/** Version declared by an AppxManifest's <Identity> element. */
export function readPackageIdentityVersion(packageXml) {
  const identity = packageXml.match(/<Identity\b[^>]*>/);
  if (!identity) throw new Error("package manifest has no <Identity> element");
  return parseTagAttributes(identity[0]).Version;
}

/** Canonical childless `<msix>` element for the given identity values. */
export function renderMsixElement(values) {
  return [
    `<msix xmlns="${MSIX_NAMESPACE}"`,
    `        packageName="${values.packageName}"`,
    `        publisher="${values.publisher}"`,
    `        applicationId="${values.applicationId}" />`,
  ].join("\n");
}

/**
 * Replace the root assemblyIdentity version in an application manifest.
 * Only the child of <assembly> is touched — the Common-Controls dependency
 * carries its own assemblyIdentity with a different version.
 */
export function withAssemblyIdentityVersion(appXml, version) {
  const assembly = appXml.match(/<assembly\b[^>]*>\s*(<assemblyIdentity\b[^>]*>)/);
  if (!assembly) throw new Error("application manifest has no root <assemblyIdentity> element");
  const start = assembly.index + assembly[0].length - assembly[1].length;
  const replacement = assembly[1].replace(/\bversion="[^"]*"/, `version="${version}"`);
  return appXml.slice(0, start) + replacement + appXml.slice(start + assembly[1].length);
}

/** Replace the <Identity> Version attribute of an AppxManifest. */
export function withPackageIdentityVersion(packageXml, version) {
  const identity = packageXml.match(/<Identity\b[^>]*>/);
  if (!identity) throw new Error("package manifest has no <Identity> element");
  const replacement = identity[0].replace(/\bVersion="[^"]*"/, `Version="${version}"`);
  return packageXml.slice(0, identity.index) + replacement + packageXml.slice(identity.index + identity[0].length);
}

/** Replace (or reject) the <msix> element of an application manifest. */
export function withMsixElement(appXml, values) {
  const msix = findMsixElement(appXml);
  if (!msix) throw new Error("application manifest has no <msix> element to regenerate");
  return appXml.slice(0, msix.start) + renderMsixElement(values) + appXml.slice(msix.end);
}

function readIfPresent(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Compare every identity-declaring field with its owner.
 *
 * @returns {{changed: Array<{file: string, detail: string}>, issues: string[], notices: string[]}}
 */
export function syncWindowsIdentity({ root, write = false } = {}) {
  const files = {
    tauriConf: path.join(root, IDENTITY_FILES.tauriConf),
    appManifest: path.join(root, IDENTITY_FILES.appManifest),
    sparseManifest: path.join(root, IDENTITY_FILES.sparseManifest),
    fullMsixManifest: path.join(root, IDENTITY_FILES.fullMsixManifest),
  };

  const changed = [];
  const issues = [];
  const notices = [];

  const tauriConf = readIfPresent(files.tauriConf);
  if (tauriConf === null) return { changed, issues: [`missing ${IDENTITY_FILES.tauriConf}`], notices };
  const appVersion = JSON.parse(tauriConf).version;
  if (!appVersion) return { changed, issues: [`${IDENTITY_FILES.tauriConf} has no version`], notices };
  const version = identityVersionFromAppVersion(appVersion);

  const sparseXml = readIfPresent(files.sparseManifest);
  if (sparseXml === null) {
    return { changed, issues: [`missing ${IDENTITY_FILES.sparseManifest}`], notices };
  }
  const values = readIdentityPackageValues(sparseXml);
  for (const attribute of REQUIRED_MSIX_ATTRIBUTES) {
    if (!values[attribute]) {
      issues.push(
        `${IDENTITY_FILES.sparseManifest}: identity package declares no ${attribute} ` +
          `(<Identity> Name/Publisher, <Application> Id)`,
      );
    }
  }

  // --- version propagation -------------------------------------------------
  for (const [key, readVersion, applyVersion] of [
    ["appManifest", readAssemblyIdentityVersion, withAssemblyIdentityVersion],
    ["sparseManifest", readPackageIdentityVersion, withPackageIdentityVersion],
    ["fullMsixManifest", readPackageIdentityVersion, withPackageIdentityVersion],
  ]) {
    const file = IDENTITY_FILES[key];
    let xml = readIfPresent(files[key]);
    if (xml === null) {
      issues.push(`missing ${file}`);
      continue;
    }
    let declared;
    try {
      declared = readVersion(xml);
    } catch (error) {
      issues.push(`${file}: ${error.message}`);
      continue;
    }
    if (declared !== version) {
      const detail = `${file}: identity version "${declared}" != application version "${version}" (from ${IDENTITY_FILES.tauriConf})`;
      if (write) {
        xml = applyVersion(xml, version);
        changed.push({ file, detail: `${detail} -> written "${version}"` });
      } else {
        issues.push(detail);
      }
    }
    if (key === "appManifest" && write) {
      const msix = findMsixElement(xml);
      const needsRegeneration =
        !msix ||
        !msix.selfClosing ||
        REQUIRED_MSIX_ATTRIBUTES.some((attribute) => msix.attributes[attribute] !== values[attribute]) ||
        msix.attributes.xmlns !== MSIX_NAMESPACE;
      if (needsRegeneration) {
        xml = withMsixElement(xml, values);
        changed.push({
          file,
          detail: "<msix> regenerated as the childless application-manifest form",
        });
      }
    }
    if (write && xml !== readIfPresent(files[key])) {
      fs.writeFileSync(files[key], xml);
    }
  }

  // --- structural + value check of the embedded manifest -------------------
  const appXml = readIfPresent(files.appManifest);
  if (appXml !== null) {
    const msix = findMsixElement(appXml);
    if (!msix) {
      issues.push(`${IDENTITY_FILES.appManifest}: no <msix> element`);
    } else {
      if (!msix.selfClosing) {
        issues.push(
          `${IDENTITY_FILES.appManifest}: <msix> has child elements but the Windows loader requires the ` +
            "childless application-manifest form (attributes packageName/publisher/applicationId) — " +
            "the package-manifest form (<publisherIdentity>/<packageIdentity>) fails Side-by-Side validation (14001)",
        );
      }
      for (const attribute of REQUIRED_MSIX_ATTRIBUTES) {
        const declared = msix.attributes[attribute];
        const expected = values[attribute];
        if (!declared) {
          issues.push(`${IDENTITY_FILES.appManifest}: <msix> is missing the required attribute "${attribute}"`);
        } else if (expected && declared !== expected) {
          issues.push(
            `${IDENTITY_FILES.appManifest}: <msix> ${attribute}="${declared}" != identity package ${attribute}="${expected}"`,
          );
        }
      }
      if (msix.attributes.xmlns !== MSIX_NAMESPACE) {
        issues.push(
          `${IDENTITY_FILES.appManifest}: <msix> is not in the "${MSIX_NAMESPACE}" namespace ` +
            `(declared "${msix.attributes.xmlns ?? "none"}")`,
        );
      }
    }
  }

  const fullXml = readIfPresent(files.fullMsixManifest);
  if (fullXml !== null) {
    try {
      const fullValues = readIdentityPackageValues(fullXml);
      if (fullValues.packageName !== values.packageName || fullValues.publisher !== values.publisher) {
        notices.push(
          `${IDENTITY_FILES.fullMsixManifest}: identity (${fullValues.packageName} / ${fullValues.publisher}) ` +
            `differs from the shipped sparse identity package (${values.packageName} / ${values.publisher}); ` +
            "the Store package has its own publisher",
        );
      }
    } catch (error) {
      issues.push(`${IDENTITY_FILES.fullMsixManifest}: ${error.message}`);
    }
  }

  return { changed, issues, notices, version, values };
}

function main(argv) {
  const write = argv.includes("--write");
  const root = repoRoot();
  const { changed, issues, notices, version } = syncWindowsIdentity({ root, write });

  for (const notice of notices) console.warn(`warning: ${notice}`);

  if (write) {
    if (changed.length === 0) {
      console.log(`Windows identity metadata already in sync (version ${version}).`);
    } else {
      for (const change of changed) console.log(`updated: ${change.detail}`);
    }
  } else if (issues.length === 0 && changed.length === 0) {
    console.log(`Windows identity metadata in sync (version ${version}).`);
  }

  if (issues.length > 0) {
    console.error("\nWindows identity metadata problems:");
    for (const issue of issues) console.error(`  - ${issue}`);
    console.error('\nRun `node scripts/sync-windows-identity.mjs --write` after fixing the owner of the value.');
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
