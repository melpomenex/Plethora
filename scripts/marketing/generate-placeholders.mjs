import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE_SPECS, PLACEHOLDER_BUILD_ID, sourcePngName } from "./surfaces.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function svgPlaceholder(spec) {
  const { width: w, height: h, surface, viewport, theme, platform } = spec;
  const paper = theme === "eink" ? "#E8E4D9" : theme === "dark" ? "#1A1916" : "#F4F1EA";
  const ink = theme === "dark" ? "#F4F1EA" : "#1A1916";
  const muted = theme === "dark" ? "#A39E94" : "#5C5852";
  const accent = "#7C3AED";
  const titleSize = Math.max(18, Math.round(w / 22));
  const body = Math.max(12, Math.round(w / 36));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${paper}"/>
  <rect x="16" y="16" width="${w - 32}" height="${h - 32}" fill="none" stroke="${ink}" stroke-width="2"/>
  <rect x="16" y="16" width="8" height="${h - 32}" fill="${accent}"/>
  <text x="${w / 2}" y="${Math.round(h * 0.28)}" text-anchor="middle" font-family="Georgia, serif" font-size="${titleSize}" fill="${ink}">PLACEHOLDER</text>
  <text x="${w / 2}" y="${Math.round(h * 0.28) + titleSize + 8}" text-anchor="middle" font-family="Georgia, serif" font-size="${body}" fill="${muted}">Not a product screenshot</text>
  <text x="${w / 2}" y="${Math.round(h * 0.48)}" text-anchor="middle" font-family="Georgia, serif" font-size="${body + 4}" fill="${ink}">${escapeXml(surface)}</text>
  <text x="${w / 2}" y="${Math.round(h * 0.48) + body + 14}" text-anchor="middle" font-family="Georgia, serif" font-size="${body}" fill="${muted}">${escapeXml(platform)} · ${escapeXml(viewport)} · ${theme}</text>
  <text x="${w / 2}" y="${Math.round(h * 0.72)}" text-anchor="middle" font-family="Georgia, serif" font-size="${body}" fill="${muted}">Capture from RC build</text>
  <text x="${w / 2}" y="${Math.round(h * 0.72) + body + 12}" text-anchor="middle" font-family="Georgia, serif" font-size="${Math.max(11, body - 2)}" fill="${muted}">scripts/marketing/capture-screenshots.md</text>
  <text x="${w / 2}" y="${h - 36}" text-anchor="middle" font-family="Georgia, serif" font-size="${Math.max(10, body - 4)}" fill="${muted}">${PLACEHOLDER_BUILD_ID} · CC0-1.0 label art</text>
</svg>`;
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function writePlaceholderPngs() {
  const sharp = (await import("sharp")).default;
  const outDir = join(ROOT, "marketing/screenshots/source");
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const spec of CAPTURE_SPECS) {
    const dest = join(outDir, sourcePngName(spec, PLACEHOLDER_BUILD_ID));
    await sharp(Buffer.from(svgPlaceholder(spec))).png().toFile(dest);
    written.push(dest);
  }
  writeFileSync(
    join(outDir, "README.md"),
    `# Source captures

Files named \`*_placeholder-unreleased.png\` are **labeled placeholders**, not UI captures.

Replace them by following \`scripts/marketing/capture-screenshots.md\` from a seeded RC build, then run \`node scripts/marketing/encode-product-images.mjs\`.

Do not update \`src/visual/__snapshots__\` when regenerating marketing shots.
`,
  );
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const written = await writePlaceholderPngs();
  console.log(`Wrote ${written.length} placeholders`);
}
