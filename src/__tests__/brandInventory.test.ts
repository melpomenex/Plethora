/**
 * Brand inventory guardrail (OpenSpec change: rebrand-incrementum-to-plethora).
 *
 * Asserts that user-visible bundled surfaces present the product as Plethora,
 * and that the deliberately retained legacy identifiers (documented in
 * BRANDING.md at the repo root) are not accidentally renamed ahead of the
 * Phase B migration.
 *
 * Deliberate exemptions (see BRANDING.md "retained-legacy"):
 *   - historical CHANGELOG entries / git tags (not bundled surfaces; not scanned)
 *   - the AMO gecko id `incrementum-browser-sync@melpomenex.dev`
 *   - the `data-incrementum-app` attribute in index.html (Phase B protocol token)
 *   - service-worker cache/IDB namespace `incrementum-*` (Phase B storage migration)
 *   - `.incrementum` backup-import compatibility strings in src/utils (not scanned)
 *   - bundle identifier / updater endpoint in tauri.conf.json (Phase B)
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { de } from "../lib/i18n/locales/de";
import { en } from "../lib/i18n/locales/en";
import { es } from "../lib/i18n/locales/es";
import { fr } from "../lib/i18n/locales/fr";
import { ja } from "../lib/i18n/locales/ja";
import { zh } from "../lib/i18n/locales/zh";

const root = join(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

const OLD_BRAND = /incrementum/i;

describe("brand inventory: user-visible surfaces say Plethora", () => {
  describe("i18n locales", () => {
    const locales: Record<string, Record<string, string>> = { en, zh, es, de, fr, ja };

    // The one-time migration dialog intentionally names the legacy product
    // ("your Incrementum library") — users must recognize what is migrating.
    const MIGRATION_COPY_EXEMPT = /^(mainLayout\.legacyData|integrations\.migrateVaultIds)/;
    const valueOffenders = (dict: Record<string, string>) =>
      Object.entries(dict)
        .filter(([key, value]) => !MIGRATION_COPY_EXEMPT.test(key) && OLD_BRAND.test(value))
        .map(([key, value]) => `${key}: ${value}`);

    it.each(Object.keys(locales))("%s carries no user-visible Incrementum strings", (loc) => {
      const dict = locales[loc];
      const offenders = valueOffenders(dict);
      expect(offenders, `locale ${loc} still mentions the old brand:\n${offenders.join("\n")}`).toEqual([]);
    });

    it.each(Object.keys(locales))("%s carries the renamed Plethora keys", (loc) => {
      const dict = locales[loc];
      for (const key of [
        "settings.aboutPlethora",
        "notebooklm.syncToPlethora",
        "notebooklmStudio.syncToPlethora",
        "notebooklm.syncedToPlethora",
        "ocrSettings.managedByPlethora",
        "importExport.plethoraPackage",
        "integrations.syncFlashcardsFromPlethoraToAnki",
      ]) {
        expect(dict[key], `${loc} is missing renamed key ${key}`).toBeTruthy();
      }
    });

    it("no locale still defines the retired Incrementum key names", () => {
      for (const [loc, dict] of Object.entries(locales)) {
        for (const key of Object.keys(dict)) {
          expect(key, `${loc} still has an old-brand key: ${key}`).not.toMatch(/incrementum/i);
        }
      }
    });
  });

  describe("PWA manifest (public/manifest.json)", () => {
    const manifest = JSON.parse(read("public/manifest.json"));

    it("names the product Plethora", () => {
      expect(manifest.name).not.toMatch(OLD_BRAND);
      expect(manifest.short_name).not.toMatch(OLD_BRAND);
      expect(manifest.name).toMatch(/Plethora/);
      expect(manifest.short_name).toBe("Plethora");
    });

    it("has no old-brand strings anywhere in the manifest", () => {
      expect(JSON.stringify(manifest)).not.toMatch(OLD_BRAND);
    });
  });

  describe("index.html", () => {
    it("titles the app Plethora", () => {
      const html = read("index.html");
      expect(html).toContain("<title>Plethora</title>");
      expect(html).toContain('apple-mobile-web-app-title" content="Plethora"');
    });

    it("has no old-brand strings outside the retained protocol attribute", () => {
      // data-incrementum-app is a Phase B protocol token shared with the
      // browser extension (BRANDING.md: retained-legacy). Everything else
      // must be clean.
      const html = read("index.html").replace(/data-incrementum-(?:app|mounted)/g, "");
      expect(html).not.toMatch(OLD_BRAND);
    });
  });

  describe("desktop bundle metadata (src-tauri/tauri.conf.json)", () => {
    const conf = JSON.parse(read("src-tauri/tauri.conf.json"));

    it("presents Plethora in all display fields", () => {
      expect(conf.productName).toBe("Plethora");
      for (const window of conf.app?.windows ?? []) {
        expect(window.title).toBe("Plethora");
      }
      const fields = [
        conf.bundle?.publisher,
        conf.bundle?.copyright,
        conf.bundle?.shortDescription,
        conf.bundle?.longDescription,
      ];
      for (const field of fields) {
        expect(field).not.toMatch(OLD_BRAND);
      }
    });

    it("uses the Phase B bundle identifier and updater chain", () => {
      expect(conf.identifier).toBe("com.plethora.app");
      // The updater endpoint moves to the Plethora repo in task 3.8; until
      // then it must still reference the functional legacy repo.
      expect(
        conf.plugins?.updater?.endpoints?.[0],
        "updater endpoint must target exactly one of the known repos"
      ).toMatch(/melpomenex\/(incrementum-tauri|Plethora)\/releases/);
    });
  });

  describe("service worker (public/sw.js)", () => {
    it("uses Plethora in user-visible strings", () => {
      const sw = read("public/sw.js");
      expect(sw).toContain("Offline - Plethora");
      expect(sw).toContain("title: 'Plethora'");
      expect(sw).not.toContain("Offline - Incrementum");
      expect(sw).not.toContain("title: 'Incrementum'");
    });

    it("uses the Plethora cache namespace and purges legacy caches on activate", () => {
      const sw = read("public/sw.js");
      expect(sw).toMatch(/const VERSION = 'plethora-v\d+'/);
      // Legacy sweep must keep covering pre-rebrand caches and the legacy SW
      // preferences database (migrated then removed on activate).
      expect(sw).toContain("name.startsWith('incrementum-')");
      expect(sw).toContain("indexedDB.open(LEGACY_DB, 1)");
      expect(sw).toContain("indexedDB.open('plethora-sw', 1)");
    });
  });

  describe("Android launcher label", () => {
    it("app_name is Plethora", () => {
      const xml = read(
        "src-tauri/gen/android/app/src/main/res/values/strings.xml"
      );
      expect(xml).toContain('<string name="app_name">Plethora</string>');
      expect(xml).not.toMatch(OLD_BRAND);
    });
  });

  describe("browser extension manifest", () => {
    const manifest = JSON.parse(read("browser_extension/manifest.json"));

    it("displays as Plethora Capture", () => {
      expect(manifest.name).toBe("Plethora Capture");
      expect(manifest.action?.default_title).toBe("Plethora Capture");
      expect(manifest.description).not.toMatch(OLD_BRAND);
      for (const cmd of Object.values<{ description?: string }>(manifest.commands ?? {})) {
        expect(cmd.description ?? "").not.toMatch(OLD_BRAND);
      }
    });

    it("retains the AMO gecko id (renaming it would orphan the AMO listing)", () => {
      expect(manifest.browser_specific_settings?.gecko?.id).toBe(
        "incrementum-browser-sync@melpomenex.dev"
      );
    });
  });

  describe("in-app handbook (bundled via ?raw imports — user-visible)", () => {
    // Exemptions: the legacy `.incrementum` backup extension and the
    // `incrementum-backup-*` filename prefix the exporter still emits
    // (both renamed in Phase B task 3.5), and functional
    // github.com/melpomenex/incrementum-tauri links.
    const stripExemptions = (md: string): string =>
      md
        .replace(/\.incrementum/g, "")
        .replace(/incrementum-backup/g, "")
        .replace(/incrementum-tauri/g, "")
        .replace(/melpomenex\/Incrementum/g, "");

    it.each(["USER_HANDBOOK.md", "USER_HANDBOOK.zh.md", "USER_HANDBOOK.ja.md", "USER_HANDBOOK.es.md", "USER_HANDBOOK.de.md", "USER_HANDBOOK.fr.md"])(
      "%s carries no old-brand strings outside retained-legacy exemptions",
      (file) => {
        const md = read(join("docs", file));
        expect(stripExemptions(md)).not.toMatch(/incrementum|inkrementum|インクリメンタム/i);
        expect(md).toMatch(/Plethora/);
      }
    );
  });
});

describe("brand inventory: icon registry (source of truth in BRANDING.md)", () => {
  /** Minimal PNG header parse: [width, height] from bytes 16..24 (big-endian). */
  function pngSize(buf: Buffer): [number, number] {
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a".replace(/ /g, ""));
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  }

  const expectPng = (rel: string, size: number): void => {
    const abs = join(root, rel);
    expect(existsSync(abs), `${rel} is missing from the icon registry`).toBe(true);
    const [w, h] = pngSize(readFileSync(abs));
    expect([w, h], `${rel} must be ${size}x${size}`).toEqual([size, size]);
    expect(statSync(abs).size, `${rel} is suspiciously small`).toBeGreaterThan(200);
  };

  it("brand masters are tracked in assets/brand", () => {
    for (const f of [
      "plethora-icon-master.svg",
      "plethora-icon-foreground.svg",
      "plethora-icon-1024.png",
      "plethora-icon-512.png",
      "plethora-icon-6-reference.png",
      "plethora-icon-assets.zip",
    ]) {
      const abs = join(root, "assets", "brand", f);
      expect(existsSync(abs), `assets/brand/${f} is missing`).toBe(true);
    }
    const master = read("assets/brand/plethora-icon-master.svg");
    expect(master).toContain("#7C3AED"); // Plethora purple gradient mid-stop
    expect(read("assets/brand/plethora-icon-foreground.svg")).not.toContain(
      'width="1024" height="1024" viewBox="0 0 1024 1024"><rect'
    );
  });

  it("every icon referenced by tauri.conf.json exists", () => {
    const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
    for (const rel of conf.bundle?.icon ?? []) {
      const abs = join(root, "src-tauri", rel);
      expect(existsSync(abs), `tauri.conf.json references missing icon ${rel}`).toBe(true);
    }
    expect(existsSync(join(root, "src-tauri", "icons", "icon.icns"))).toBe(true);
    expect(existsSync(join(root, "src-tauri", "icons", "icon.ico"))).toBe(true);
  });

  it("every icon referenced by the PWA manifest exists at the declared size", () => {
    const manifest = JSON.parse(read("public/manifest.json"));
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const rel = join("public", icon.src).replace(/\\/g, "/");
      const size = parseInt(icon.sizes.split("x")[0], 10);
      expectPng(rel, size);
    }
    // favicon-class references from index.html / sw.js
    expectPng("public/icons/sprout-192x192.png", 192);
    expectPng("public/icons/badge-72x72.png", 72);
    expectPng("public/apple-touch-icon.png", 180);
    expectPng("public/icon.png", 512);
  });

  it("every icon referenced by the browser extension manifest exists", () => {
    const manifest = JSON.parse(read("browser_extension/manifest.json"));
    const entries: Record<string, unknown> = {
      ...(manifest.icons as Record<string, unknown>),
      ...((manifest.action?.default_icon as Record<string, unknown>) ?? {}),
    };
    for (const size of Object.keys(entries)) {
      expectPng(join("browser_extension", `icons/icon${size}.png`), parseInt(size, 10));
    }
  });

  it("Android mipmap sets exist at every density", () => {
    const densities: Record<string, number> = {
      mdpi: 48,
      hdpi: 72,
      xhdpi: 96,
      xxhdpi: 144,
      xxxhdpi: 192,
    };
    const foreground: Record<string, number> = {
      mdpi: 108,
      hdpi: 162,
      xhdpi: 216,
      xxhdpi: 324,
      xxxhdpi: 432,
    };
    const base =
      "src-tauri/gen/android/app/src/main/res";
    for (const [density, launcherSize] of Object.entries(densities)) {
      expectPng(`${base}/mipmap-${density}/ic_launcher.png`, launcherSize);
      expectPng(`${base}/mipmap-${density}/ic_launcher_round.png`, launcherSize);
      expectPng(`${base}/mipmap-${density}/ic_launcher_foreground.png`, foreground[density]);
    }
  });

  it("iOS AppIcon set exists", () => {
    const iosDir = join(root, "src-tauri", "icons", "ios");
    for (const f of [
      "AppIcon-20x20@1x.png",
      "AppIcon-29x29@1x.png",
      "AppIcon-40x40@1x.png",
      "AppIcon-60x60@2x.png",
      "AppIcon-512@2x.png",
      "AppIcon-83.5x83.5@2x.png",
    ]) {
      expect(existsSync(join(iosDir, f)), `iOS icon ${f} is missing`).toBe(true);
    }
  });

  it("vector icon sources carry the Plethora mark", () => {
    for (const rel of ["public/icons/icon.svg", "src-tauri/icons/sprout.svg"]) {
      const svg = read(rel);
      expect(svg, `${rel} should be the Plethora master`).toContain("#7C3AED");
      expect(svg).not.toMatch(OLD_BRAND);
    }
  });

  it("generated PWA icons visually derive from the master (not the design reference)", () => {
    // The generated 512 render must exist and the design-reference PNG must
    // not simply be copied into the pipeline outputs (it is documentation).
    const reference = readFileSync(join(root, "assets/brand/plethora-icon-6-reference.png"));
    const generated = readFileSync(join(root, "public/icons/sprout-512x512.png"));
    expect(generated.equals(reference)).toBe(false);
  });
});
