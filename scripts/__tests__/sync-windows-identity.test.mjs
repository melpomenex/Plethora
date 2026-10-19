/**
 * Unit tests for scripts/sync-windows-identity.mjs — run with `npm run test:scripts`.
 *
 * The rules under test are the ones that decide whether a Windows build can
 * start at all, so the negative cases matter more than the happy path: a
 * `<msix>` element in the package-manifest (child-element) form makes the
 * Side-by-Side activation context generator reject the whole manifest, and a
 * version that drifts from `tauri.conf.json` means the PE version resource and
 * the package identity disagree. Both shipped in 3.3.0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  IDENTITY_FILES,
  identityVersionFromAppVersion,
  findMsixElement,
  readIdentityPackageValues,
  renderMsixElement,
  repoRoot,
  syncWindowsIdentity,
  withAssemblyIdentityVersion,
  withPackageIdentityVersion,
} from "../sync-windows-identity.mjs";

/** The pre-3.3.1 defect verbatim: package-manifest form inside an app manifest. */
const BROKEN_APP_MANIFEST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="2.7.0.0" processorArchitecture="*" name="Plethora.Plethora" type="win32" />
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
  <msix xmlns="urn:schemas-microsoft-com:msix.v1">
    <publisherIdentity name="CN=Plethora Sparse Dev" publisher="CN=Plethora Sparse Dev" />
    <packageIdentity name="Plethora.Plethora" publisher="CN=Plethora Sparse Dev" version="2.7.0.0" processorArchitecture="neutral" />
  </msix>
</assembly>
`;

const FIXED_MSIX = `  <msix xmlns="urn:schemas-microsoft-com:msix.v1"
        packageName="Plethora.Plethora"
        publisher="CN=Plethora Sparse Dev"
        applicationId="Plethora" />
`;

const FIXED_APP_MANIFEST = BROKEN_APP_MANIFEST.replace(
  /<msix[\s\S]*?<\/msix>/,
  FIXED_MSIX.trim(),
).replace('version="2.7.0.0" processorArchitecture="*"', 'version="3.3.0.0" processorArchitecture="*"');

function sparseManifest({ version = "3.3.0.0", name = "Plethora.Plethora", publisher = "CN=Plethora Sparse Dev", id = "Plethora" } = {}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Identity Name="${name}" Publisher="${publisher}" Version="${version}" ProcessorArchitecture="neutral" />
  <Properties>
    <DisplayName>Plethora</DisplayName>
    <uap10:AllowExternalContent>true</uap10:AllowExternalContent>
  </Properties>
  <Applications>
    <Application Id="${id}" Executable="plethora-tauri.exe" uap10:TrustLevel="mediumIL" uap10:RuntimeBehavior="win32App">
      <uap:VisualElements AppListEntry="none" DisplayName="Plethora" />
    </Application>
  </Applications>
</Package>
`;
}

/** Build a repository-shaped fixture tree so the script can be exercised off-repo. */
function fixtureTree({ appManifest = FIXED_APP_MANIFEST, sparse = sparseManifest(), fullMsix = sparseManifest({ version: "3.3.0.0" }), appVersion = "3.3.0" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plethora-identity-"));
  const write = (rel, content) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write(IDENTITY_FILES.tauriConf, JSON.stringify({ version: appVersion }, null, 2));
  write(IDENTITY_FILES.appManifest, appManifest);
  write(IDENTITY_FILES.sparseManifest, sparse);
  write(IDENTITY_FILES.fullMsixManifest, fullMsix);
  return root;
}

test("identity version pads a three-part application version and keeps it monotonic", () => {
  assert.equal(identityVersionFromAppVersion("3.3.0"), "3.3.0.0");
  assert.equal(identityVersionFromAppVersion("3.3.11"), "3.3.11.0");
  assert.equal(identityVersionFromAppVersion("3.3.0.7"), "3.3.0.7");
  assert.throws(() => identityVersionFromAppVersion("3"), /2-4 part/);
  assert.throws(() => identityVersionFromAppVersion("3.x.0"), /non-numeric/);
});

test("package-manifest child-element form is reported as a loader-fatal structure error", () => {
  const root = fixtureTree({ appManifest: BROKEN_APP_MANIFEST, sparse: sparseManifest({ version: "2.7.0.0" }) });
  const { issues } = syncWindowsIdentity({ root });

  const structural = issues.find((issue) => issue.includes("has child elements"));
  assert.ok(structural, `expected a child-element issue, got: ${JSON.stringify(issues)}`);
  assert.match(structural, /application-manifest form/);
  assert.match(structural, /14001/);
});

test("version drift names the file, the declared value, and the expected value", () => {
  const root = fixtureTree({ appManifest: BROKEN_APP_MANIFEST, sparse: sparseManifest({ version: "2.7.0.0" }) });
  const { issues } = syncWindowsIdentity({ root });

  const drift = issues.find((issue) => issue.startsWith(IDENTITY_FILES.appManifest));
  assert.ok(drift, `expected an app manifest drift issue, got: ${JSON.stringify(issues)}`);
  assert.match(drift, /"2\.7\.0\.0"/);
  assert.match(drift, /"3\.3\.0\.0"/);
  assert.match(drift, /3\.3\.0/); // names the application version owner
  assert.ok(
    issues.some((issue) => issue.startsWith(IDENTITY_FILES.sparseManifest) && issue.includes('"2.7.0.0"')),
    "the identity package manifest version is checked too",
  );
});

test("identity value disagreement names the mismatching field", () => {
  const root = fixtureTree({
    appManifest: FIXED_APP_MANIFEST.replace('packageName="Plethora.Plethora"', 'packageName="Plethora.Wrong"'),
  });
  const { issues } = syncWindowsIdentity({ root });

  const mismatch = issues.find((issue) => issue.includes("packageName"));
  assert.ok(mismatch, `expected a packageName mismatch, got: ${JSON.stringify(issues)}`);
  assert.match(mismatch, /Plethora\.Wrong/);
  assert.match(mismatch, /Plethora\.Plethora/);
});

test("a missing required attribute and a wrong namespace are reported", () => {
  const missing = fixtureTree({
    appManifest: FIXED_APP_MANIFEST.replace('applicationId="Plethora" />', "/>"),
  });
  assert.ok(
    syncWindowsIdentity({ root: missing }).issues.some((issue) => issue.includes('"applicationId"')),
    "missing applicationId must be reported",
  );

  const namespace = fixtureTree({
    appManifest: FIXED_APP_MANIFEST.replace('xmlns="urn:schemas-microsoft-com:msix.v1"', 'xmlns="urn:schemas-microsoft-com:msix.v2"'),
  });
  assert.ok(
    syncWindowsIdentity({ root: namespace }).issues.some((issue) => issue.includes("namespace")),
    "the msix namespace must be checked",
  );
});

test("write mode regenerates the childless attribute form and syncs every version", () => {
  const root = fixtureTree({ appManifest: BROKEN_APP_MANIFEST, sparse: sparseManifest({ version: "2.7.0.0" }) });

  const result = syncWindowsIdentity({ root, write: true });
  assert.deepEqual(result.issues, []);

  const appManifest = fs.readFileSync(path.join(root, IDENTITY_FILES.appManifest), "utf8");
  const msix = findMsixElement(appManifest);
  assert.ok(msix?.selfClosing, "regenerated element is childless");
  assert.deepEqual(msix.attributes, {
    xmlns: "urn:schemas-microsoft-com:msix.v1",
    packageName: "Plethora.Plethora",
    publisher: "CN=Plethora Sparse Dev",
    applicationId: "Plethora",
  });
  assert.doesNotMatch(appManifest, /publisherIdentity|packageIdentity/);

  for (const key of ["appManifest", "sparseManifest", "fullMsixManifest"]) {
    const xml = fs.readFileSync(path.join(root, IDENTITY_FILES[key]), "utf8");
    assert.match(xml, /3\.3\.0\.0/, `${key} carries the application version`);
  }

  // Second run is a no-op: the regenerated tree is in sync.
  const second = syncWindowsIdentity({ root });
  assert.deepEqual(second.issues, []);
});

test("the version rewriter only touches the root assemblyIdentity, not the dependency", () => {
  const rewritten = withAssemblyIdentityVersion(BROKEN_APP_MANIFEST, "9.9.9.9");
  assert.match(rewritten, /<assemblyIdentity version="9\.9\.9\.9" processorArchitecture/);
  assert.match(rewritten, /name="Microsoft\.Windows\.Common-Controls" version="6\.0\.0\.0"/);
  assert.equal(
    withPackageIdentityVersion(sparseManifest(), "4.0.0.0").includes('Version="4.0.0.0"'),
    true,
  );
});

test("identity values are read from the identity package, never invented", () => {
  const values = readIdentityPackageValues(
    sparseManifest({ name: "Contoso.Store", publisher: "CN=Contoso", id: "ContosoApp" }),
  );
  assert.deepEqual(values, {
    packageName: "Contoso.Store",
    publisher: "CN=Contoso",
    applicationId: "ContosoApp",
  });
  assert.match(renderMsixElement(values), /packageName="Contoso\.Store"/);
});

test("the repository tree itself is in sync (this is the 3.3.0 defect as a regression test)", () => {
  const { issues, notices } = syncWindowsIdentity({ root: repoRoot() });
  assert.deepEqual(issues, []);
  for (const notice of notices) console.log(`notice: ${notice}`);
});
