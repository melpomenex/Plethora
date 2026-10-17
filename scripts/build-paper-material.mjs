/** Offline asset derivation; requires the checked-in, original-resolution CC0 source. */
import sharp from "sharp";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = `${root}assets/theme-materials/legal-pad/source-4096.png`;
const out = `${root}public/theme-materials/legal-pad/v1/`;
await mkdir(out, { recursive: true });
const sourceBytes = await readFile(source);
const meta = await sharp(sourceBytes).metadata();
if (meta.width < 4096 || meta.height < 4096)
  throw new Error("A genuine 4096px source is required; upscaled references are not accepted.");
const size = 2048;
const files = [];
// Match the opposing edges without mirroring identifiable motifs in the tile.
function periodic(data, n) {
  const original = new Uint8Array(data);
  const edge = 24;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const wx = Math.min(x, n - 1 - x) < edge ? (1 - Math.min(x, n - 1 - x) / edge) / 2 : 0;
      const wy = Math.min(y, n - 1 - y) < edge ? (1 - Math.min(y, n - 1 - y) / edge) / 2 : 0;
      const a = original[y * n + x] * (1 - wx) + original[y * n + (n - 1 - x)] * wx;
      const b =
        original[(n - 1 - y) * n + x] * (1 - wx) + original[(n - 1 - y) * n + (n - 1 - x)] * wx;
      data[y * n + x] = a * (1 - wy) + b * wy;
    }
  return data;
}
async function emit(name, rgba, width, format) {
  // Remove invisible RGB entropy after resampling and quantize signed opacity,
  // retaining the physical source detail rather than blurring to meet budgets.
  for (let i = 0; name.startsWith("grain") && i < rgba.length; i += 4) {
    const signed = ((rgba[i] / 255) * 2 - 1) * rgba[i + 3];
    const alpha = Math.min(
      8,
      Math.round(Math.abs(signed) / (width <= 512 ? 2 : width <= 1024 ? 4 : 8)) *
        (width <= 512 ? 2 : width <= 1024 ? 4 : 8)
    );
    const shade = alpha && signed > 0 ? 255 : 0;
    rgba[i] = shade;
    rgba[i + 1] = shade;
    rgba[i + 2] = shade;
    rgba[i + 3] = alpha;
  }
  const encoder = sharp(rgba, { raw: { width, height: width, channels: 4 } }).withIccProfile(
    "srgb"
  );
  const bytes =
    format === "png"
      ? await encoder.png({ palette: true, compressionLevel: 9 }).toBuffer()
      : await encoder.webp({ lossless: true, effort: 6 }).toBuffer();
  await writeFile(out + name, bytes);
  files.push({
    name,
    width,
    height: width,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    profile: "sRGB",
    format,
  });
}
for (const [family, widths, strength] of [
  ["subtle", [512, 1024], 0.55],
  ["authentic", [512, 1024, 1536], 1],
  ["maximum", [1024, 1536, 2048], 1.25],
]) {
  for (const width of widths) {
    const resized = await sharp(sourceBytes).resize(width, width).grayscale().raw().toBuffer();
    const low = await sharp(resized, { raw: { width, height: width, channels: 1 } })
      .blur(Math.max(2, width / 128))
      .raw()
      .toBuffer();
    const signal = periodic(
      Float32Array.from(resized, (v, i) => v - low[i]),
      width
    );
    const raw = Buffer.alloc(width * width * 4);
    for (let i = 0; i < signal.length; i++) {
      const v = signal[i];
      const shade = v >= 0 ? 255 : 0;
      raw[i * 4] = shade;
      raw[i * 4 + 1] = shade;
      raw[i * 4 + 2] = shade;
      raw[i * 4 + 3] = Math.min(8, Math.round(Math.abs(v) * strength));
    }
    await emit(`grain-${family}-${width}.webp`, raw, width, "webp");
    if (family === "subtle" && width === 512)
      await emit("grain-fallback-512.png", raw, width, "png");
  }
}
const macroGray = await sharp(sourceBytes).resize(512, 512).grayscale().blur(28).raw().toBuffer();
const avg = macroGray.reduce((a, b) => a + b, 0) / macroGray.length;
const macro = periodic(
  Float32Array.from(macroGray, (v) => v - avg),
  512
);
const rgba = Buffer.alloc(512 * 512 * 4);
for (let i = 0; i < macro.length; i++) {
  const shade = macro[i] >= 0 ? 255 : 0;
  rgba[i * 4] = shade;
  rgba[i * 4 + 1] = shade;
  rgba[i * 4 + 2] = shade;
  rgba[i * 4 + 3] = Math.min(3, Math.round(Math.abs(macro[i]) / 4));
}
await emit("variation-512.webp", rgba, 512, "webp");
await emit("variation-512.png", rgba, 512, "png");
await copyFile(`${root}assets/theme-materials/legal-pad/LICENSE.txt`, out + "LICENSE.txt");
const manifest = {
  version: 1,
  preset: "legal-pad-archival-v1",
  source: {
    url: "https://ambientcg.com/a/Paper006",
    license: "CC0-1.0",
    width: meta.width,
    height: meta.height,
    bitDepth: 8,
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  },
  processing: {
    engine: `sharp ${sharp.versions.sharp}`,
    workingSize: size,
    grainBlurSigma: "max(2,width/128)",
    alphaMax: 8,
    macroAlphaMax: 3,
    tileCssPx: 512,
    macroCssPx: 1536,
    upscaled: false,
  },
  files,
  totalBytes: files.reduce((a, b) => a + b.bytes, 0),
};
await writeFile(out + "manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    files: files.length,
    totalBytes: manifest.totalBytes,
    source: [meta.width, meta.height],
  })
);
