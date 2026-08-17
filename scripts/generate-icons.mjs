/**
 * Generate every branded icon target from the Plethora SVG masters.
 *
 * Masters (pipeline inputs — see BRANDING.md "Brand assets"):
 *   assets/brand/plethora-icon-master.svg      square master (white bg + mark)
 *   assets/brand/plethora-icon-foreground.svg  transparent adaptive foreground
 * The 1024/512 PNGs next to them are visual-fidelity REFERENCES only and are
 * never read by this script; plethora-icon-6-reference.png is design
 * documentation and must never become a pipeline input.
 *
 * Rasterization is delegated to the pinned @tauri-apps/cli (`tauri icon`),
 * which bundles its own SVG rasterizer — no external ImageMagick dependency:
 *   1. One manifest run (`default` + `android_fg` + white `android_bg`)
 *      produces the desktop set (icns/ico/png/StoreLogo/Square*), the iOS
 *      AppIcon set, and the Android mipmap set into a temp dir; we copy the
 *      files into their repo locations (keeping the repo's adaptive-icon
 *      XML wiring).
 *   2. `-p <sizes>` runs render the PWA sizes, the extension sizes, and an
 *      80%-padded maskable variant (derived nested-SVG) into temp dirs,
 *      which are renamed to the repo's established filenames.
 *
 * Filenames intentionally keep the historical `sprout-*` / `icon-*` /
 * `badge-*` / `apple-touch-icon` names: they are stable resource URLs
 * referenced by manifest.json / index.html / sw.js, not brand surfaces.
 */
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BRAND_DIR = join(ROOT, 'assets', 'brand');
const MASTER_SVG = join(BRAND_DIR, 'plethora-icon-master.svg');
const FOREGROUND_SVG = join(BRAND_DIR, 'plethora-icon-foreground.svg');

const publicIconsDir = join(ROOT, 'public', 'icons');
const extensionIconsDir = join(ROOT, 'browser_extension', 'icons');
const tauriIconsDir = join(ROOT, 'src-tauri', 'icons');
const androidResDir = join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res');

const pwaSizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const extensionSizes = [16, 32, 48, 128];
const maskableSizes = [192, 512];
const iconPrefix = 'sprout';
const WHITE = '#FFFFFF';

function runTauriIcon(args, label) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npx, ['tauri', 'icon', ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`tauri icon failed (${label}), exit ${result.status}`);
  }
}

/** Wrap the master's artwork in a centered 80% box on a full-bleed background
 *  (safe-zone padding for maskable icons). */
function maskableVariantSvg(masterSvg) {
  const inner = masterSvg.replace(/<\/?svg[^>]*>/g, '');
  const size = 1024;
  const innerSize = size * 0.8;
  const offset = (size - innerSize) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${WHITE}"/>` +
    `<svg x="${offset}" y="${offset}" width="${innerSize}" height="${innerSize}" viewBox="0 0 ${size} ${size}">${inner}</svg>` +
    `</svg>`
  );
}

/** Solid-color SVG used as the Android adaptive background layer. */
function solidSvg(color) {
  const size = 1024;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${color}"/></svg>`
  );
}

function copyIfPresent(from, to, label) {
  if (!existsSync(from)) throw new Error(`Expected generated file missing (${label}): ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`Created ${to} (${label})`);
}

function main() {
  for (const required of [MASTER_SVG, FOREGROUND_SVG]) {
    if (!existsSync(required)) throw new Error(`Missing brand master: ${required}`);
  }

  const work = mkdtempSync(join(tmpdir(), 'plethora-icons-'));
  try {
    // --- 1. Desktop + iOS + Android sets (single manifest run) ---
    const manifest = join(work, 'icon-manifest.json');
    const bgSvg = join(work, 'android-bg.svg');
    writeFileSync(bgSvg, solidSvg(WHITE));
    writeFileSync(
      manifest,
      JSON.stringify({
        default: MASTER_SVG,
        bg_color: WHITE,
        android_bg: bgSvg,
        android_fg: FOREGROUND_SVG,
      })
    );
    const platformOut = join(work, 'platform');
    runTauriIcon([manifest, '-o', platformOut], 'platform set');

    for (const name of [
      '32x32.png',
      '64x64.png',
      '128x128.png',
      '128x128@2x.png',
      'icon.icns',
      'icon.ico',
      'icon.png',
      'StoreLogo.png',
      ...['30', '44', '71', '89', '107', '142', '150', '284', '310'].map((s) => `Square${s}x${s}Logo.png`),
    ]) {
      copyIfPresent(join(platformOut, name), join(tauriIconsDir, name), 'desktop');
    }

    const iosOut = join(platformOut, 'ios');
    for (const entry of readdirSafe(iosOut)) {
      copyIfPresent(join(iosOut, entry), join(tauriIconsDir, 'ios', entry), 'ios');
    }

    const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
    for (const density of densities) {
      copyIfPresent(
        join(platformOut, 'android', `mipmap-${density}`, 'ic_launcher_foreground.png'),
        join(androidResDir, `mipmap-${density}`, 'ic_launcher_foreground.png'),
        `android ${density}`
      );
    }

    // Legacy (non-adaptive) launcher icons at the exact density-bucket sizes
    // (48/72/96/144/192). The pinned `tauri icon` release emits 49px for hdpi;
    // this repo historically shipped the exact bucket sizes, so render them
    // explicitly from the square master (white background baked in).
    const launcherSizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    const launcherOut = join(work, 'android-launcher');
    runTauriIcon(
      [MASTER_SVG, '-o', launcherOut, '-p', Object.values(launcherSizes).join(',')],
      'android launcher sizes'
    );
    for (const [density, size] of Object.entries(launcherSizes)) {
      const generated = join(launcherOut, `${size}x${size}.png`);
      copyIfPresent(generated, join(androidResDir, `mipmap-${density}`, 'ic_launcher.png'), `android ${density} launcher`);
      copyIfPresent(generated, join(androidResDir, `mipmap-${density}`, 'ic_launcher_round.png'), `android ${density} launcher round`);
    }

    // --- 2. PWA sizes (any purpose) ---
    const pwaOut = join(work, 'pwa');
    runTauriIcon([MASTER_SVG, '-o', pwaOut, '-p', pwaSizes.join(',')], 'pwa sizes');
    for (const size of pwaSizes) {
      const generated = join(pwaOut, `${size}x${size}.png`);
      copyIfPresent(generated, join(publicIconsDir, `${iconPrefix}-${size}x${size}.png`), 'pwa');
      copyIfPresent(generated, join(publicIconsDir, `icon-${size}x${size}.png`), 'pwa legacy');
    }

    // --- 3. Maskable variant (80% safe-zone padding) ---
    const maskableSvg = join(work, 'maskable.svg');
    writeFileSync(maskableSvg, maskableVariantSvg(readFileSync(MASTER_SVG, 'utf8')));
    const maskableOut = join(work, 'maskable');
    runTauriIcon([maskableSvg, '-o', maskableOut, '-p', maskableSizes.join(',')], 'maskable sizes');
    for (const size of maskableSizes) {
      copyIfPresent(
        join(maskableOut, `${size}x${size}.png`),
        join(publicIconsDir, `${iconPrefix}-maskable-${size}x${size}.png`),
        'maskable'
      );
    }

    // --- 4. Extension icons ---
    const extOut = join(work, 'extension');
    runTauriIcon([MASTER_SVG, '-o', extOut, '-p', extensionSizes.join(',')], 'extension sizes');
    for (const size of extensionSizes) {
      copyIfPresent(join(extOut, `${size}x${size}.png`), join(extensionIconsDir, `icon${size}.png`), 'extension');
    }

    // --- 5. Misc public assets (favicon-class references keep their URLs) ---
    const miscOut = join(work, 'misc');
    runTauriIcon([MASTER_SVG, '-o', miscOut, '-p', '72,180,512'], 'misc sizes');
    copyIfPresent(join(miscOut, '180x180.png'), join(ROOT, 'public', 'apple-touch-icon.png'), 'apple-touch');
    copyIfPresent(join(miscOut, '512x512.png'), join(ROOT, 'public', 'icon.png'), 'public icon');
    copyIfPresent(join(miscOut, '72x72.png'), join(publicIconsDir, 'badge-72x72.png'), 'badge');

    // --- 6. Vector copies (master mark under historical filenames) ---
    const masterContent = readFileSync(MASTER_SVG, 'utf8');
    writeFileSync(join(publicIconsDir, 'icon.svg'), masterContent);
    writeFileSync(join(tauriIconsDir, 'sprout.svg'), masterContent);
    console.log('Updated public/icons/icon.svg and src-tauri/icons/sprout.svg');

    console.log('Done!');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

main();
