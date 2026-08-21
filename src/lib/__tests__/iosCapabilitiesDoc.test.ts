import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLATFORM_CAPABILITY_IDS,
  PLATFORM_CAPABILITY_REGISTRY,
  getPlatformCapability,
  isPlatformCapabilityUnavailable,
  type AppPlatform,
} from "../platformCapabilities";

/**
 * §6.1 — ios-capabilities.md is GENERATED from the platform capability
 * registry and kept consistent by this test.
 *
 * Run `UPDATE_IOS_CAPABILITIES_DOC=1 npx vitest run
 * src/lib/__tests__/iosCapabilitiesDoc.test.ts` to regenerate the doc after
 * changing the registry. Without the flag the test only verifies that the
 * committed doc matches the registry exactly.
 */

const DOC_PATH = join(
  process.cwd(),
  "docs/product/features/platform/ios-capabilities.md"
);

const BEGIN = "<!-- BEGIN GENERATED MATRIX -->";
const END = "<!-- END GENERATED MATRIX -->";

const LABELS: Record<AppPlatform, string> = {
  ios: "iOS",
  android: "Android",
  desktop: "Desktop",
  web: "Web/PWA",
};

const PLATFORMS: AppPlatform[] = ["ios", "android", "desktop", "web"];

function cell(id: (typeof PLATFORM_CAPABILITY_IDS)[number], platform: AppPlatform): string {
  const availability = getPlatformCapability(id, { platform });
  if (isPlatformCapabilityUnavailable(availability)) {
    return `\`❌ ${availability.reason}\``;
  }
  return "✅";
}

function generateMatrix(): string {
  const header = [
    "| Capability id | Kind | iOS | Android | Desktop | Web/PWA |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  const rows = PLATFORM_CAPABILITY_IDS.map((id) => {
    const def = PLATFORM_CAPABILITY_REGISTRY[id];
    const kind = def.protected ? "**protected**" : def.apkInstallClass ? "apk-install-class" : "";
    const cells = PLATFORMS.map((p) => cell(id, p)).join(" | ");
    return `| \`${id}\` | ${kind} | ${cells} |`;
  });
  return [BEGIN, ...header, ...rows, END].join("\n");
}

describe("§6.1 registry ↔ ios-capabilities.md consistency", () => {
  it("committed document matches the generated registry matrix", () => {
    const generated = generateMatrix();

    if (process.env.UPDATE_IOS_CAPABILITIES_DOC === "1") {
      let doc = readFileSync(DOC_PATH, "utf8");
      const start = doc.indexOf(BEGIN);
      const end = doc.indexOf(END);
      if (start === -1 || end === -1) {
        doc = `${doc.trimEnd()}\n\n${generated}\n`;
      } else {
        doc = doc.slice(0, start) + generated + doc.slice(end + END.length);
      }
      writeFileSync(DOC_PATH, doc);
      return;
    }

    const doc = readFileSync(DOC_PATH, "utf8");
    const start = doc.indexOf(BEGIN);
    const end = doc.indexOf(END);
    expect(start, "generated-matrix markers missing from doc").toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const committed = doc.slice(start, end + END.length);
    expect(committed).toBe(generated);
  });

  it("every registry id appears in the doc's capability list section", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    for (const id of PLATFORM_CAPABILITY_IDS) {
      expect(doc.includes(`\`${id}\``), `missing ${id}`).toBe(true);
    }
  });
});
