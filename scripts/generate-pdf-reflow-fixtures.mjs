/**
 * Synthetic PDF reflow fixture generator (task 10.1, change add-pdf-reflow).
 *
 * Produces deterministic, dependency-free synthetic PDFs covering the reflow
 * fixture categories that a text-only writer can express (columns, headers/
 * footers, hyphenation, footnotes, rotated pages, odd sizes, blank pages,
 * multi-page paragraphs, page numbers, lists, headings). Raster-dependent
 * categories (scans, mixed scan/native, math, complex tables) have
 * their exactness fixtures as synthetic (raster, text-item) inputs in
 * `src-tauri/src/pdf/analysis/tests.rs` — bitmaps and embedded images are
 * outside a hand-rolled ASCII writer and would add committed binaries the
 * corpus deliberately avoids (same policy as scripts/memory-bench).
 *
 * FIGURE CORPUS: `figures/` adds vector/raster figure fixtures (gauntlet
 * Piece D) drawn at KNOWN coordinates so end-to-end expectations can be
 * asserted a priori (`scripts/pdf-reflow-figure-expectations.json` +
 * `--fixtures` mode of scripts/diagnose-pdf-figures.mjs). Still dependency-
 * free: vector ops are plain content-stream operators and the embedded
 * raster is a zlib-deflated raw RGB XObject generated in-process.
 *
 * Output is byte-identical for identical parameters; run:
 *   node scripts/generate-pdf-reflow-fixtures.mjs [outDir]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

/** Escape a literal string for a PDF text-showing operator. */
function esc(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** One text line placement in PDF user space (origin bottom-left). */
function line(x, y, size, text, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${esc(text)}) Tj ET`;
}

/** Assemble pages into a minimal ASCII PDF (xref offsets via byte length). */
function buildPdf(pages, mediaBox = [0, 0, 612, 792], rotation = 0) {
  const count = pages.length;
  const pageRefs = [];
  const contentRefs = [];
  for (let i = 0; i < count; i++) {
    pageRefs.push(3 + 2 * i);
    contentRefs.push(4 + 2 * i);
  }
  const fontRef = 3 + 2 * count;

  const chunks = ["%PDF-1.4"];
  const offsets = [];
  let length = 0;
  const push = (body) => {
    offsets.push(length);
    chunks.push(body);
    length += body.length + 1;
  };

  push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`);
  const kids = pageRefs.map((p) => `${p} 0 R`).join(" ");
  push(`2 0 obj << /Type /Pages /Kids [${kids}] /Count ${count} >> endobj`);
  for (let i = 0; i < count; i++) {
    const stream = pages[i];
    const rotate = rotation ? ` /Rotate ${rotation}` : "";
    push(`${pageRefs[i]} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(" ")}]${rotate} /Contents ${contentRefs[i]} 0 R /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${fontRef + 1} 0 R >> >> >> endobj`);
    push(`${contentRefs[i]} 0 obj << /Length ${stream.length} >>\nstream\n${stream}\nendstream endobj`);
  }
  push(`${fontRef} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  push(`${fontRef + 1} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj`);

  const xrefOffset = length;
  const total = fontRef + 2;
  const xref = ["xref", `0 ${total}`, "0000000000 65535 f "];
  for (const offset of offsets) {
    xref.push(`${String(offset).padStart(10, "0")} 00000 n `);
  }
  xref.push(`trailer << /Size ${total} /Root 1 0 R >>`, "startxref", String(xrefOffset), "%%EOF");
  chunks.push(xref.join("\n"));
  return chunks.join("\n");
}

function bodyLine(y, text, x = 72, size = 10) {
  return line(x, y, size, text);
}

const FIXTURES = {
  "01-single-column": () => buildPdf([
    [line(72, 720, 20, "Chapter 3 — Results")].concat(
      Array.from({ length: 30 }, (_, i) => bodyLine(690 - i * 14, `Single column body text line ${i + 1} with ordinary prose.`)),
    ).join("\n"),
  ]),
  "02-two-column": () => buildPdf([
    [
      line(72, 720, 16, "Two-Column Layout"),
      ...Array.from({ length: 24 }, (_, i) =>
        i < 12
          ? bodyLine(690 - i * 14, `Left column sentence ${i + 1}.`, 72)
          : bodyLine(690 - (i - 12) * 14, `Right column sentence ${i - 11}.`, 316)),
    ].join("\n"),
  ]),
  "03-three-column": () => buildPdf([
    [
      line(72, 720, 16, "Three Columns"),
      ...Array.from({ length: 18 }, (_, i) => {
        const column = i % 3;
        const row = Math.floor(i / 3);
        return bodyLine(690 - row * 16, `Column ${column + 1} row ${row + 1}.`, 72 + column * 172);
      }),
    ].join("\n"),
  ]),
  "04-headers-footers": () => buildPdf(
    [1, 2].map((page) =>
      [
        line(72, 740, 9, "Running Header — Chapter 3"),
        ...Array.from({ length: 10 }, (_, i) => bodyLine(700 - i * 14, `Body line ${i + 1} of page ${page}.`)),
        line(72, 60, 9, "Running Footer — Journal of Fixtures"),
        line(296, 40, 10, String(page)),
      ].join("\n"),
    ),
  ),
  "05-hyphenated": () => buildPdf([
    [
      bodyLine(700, "The mitochondrion contains its own inter-"),
      bodyLine(686, "national machinery for the well-"),
      bodyLine(672, "known process of respiration."),
    ].join("\n"),
  ]),
  "06-footnotes": () => buildPdf([
    [
      ...Array.from({ length: 12 }, (_, i) => bodyLine(700 - i * 14, `Body sentence ${i + 1} of the footnote fixture.`)),
      line(72, 480, 8, "1. See the appendix for full derivation details."),
      line(72, 468, 8, "2. Second footnote with a citation reference."),
    ].join("\n"),
  ]),
  "07-code-heavy": () => buildPdf([
    Array.from({ length: 20 }, (_, i) => line(72, 720 - i * 14, 9, `fn main_${i}() { let x = ${i}; }`, "F2")).join("\n"),
  ]),
  "08-lists": () => buildPdf([
    [
      line(72, 720, 14, "Key findings"),
      ...["First finding", "Second finding", "Third finding"].map((item, i) => bodyLine(690 - i * 16, `\u2022 ${item}`)),
      ...Array.from({ length: 3 }, (_, i) => bodyLine(630 - i * 16, `${i + 1}. Numbered item ${i + 1}`)),
    ].join("\n"),
  ]),
  "09-multi-page-paragraph": () => buildPdf(
    [0, 1].map((page) =>
      Array.from({ length: 45 }, (_, i) => bodyLine(720 - (i % 45) * 14, `Continuous paragraph stream ${page * 45 + i + 1}.`)).join("\n"),
    ),
  ),
  "10-odd-size": () => buildPdf(
    [line(72, 500, 12, "A5 landscape page with unusual proportions.")].join("\n"),
    [0, 0, 595, 420],
  ),
  "11-large-margins": () => buildPdf([
    Array.from({ length: 12 }, (_, i) => bodyLine(600 - i * 14, `Narrow content line ${i + 1} in a sea of margin.`, 180)).join("\n"),
  ]),
  "12-rotated": () => buildPdf(
    [line(72, 700, 12, "This page carries a 90 degree viewer rotation.")].join("\n"),
    [0, 0, 612, 792],
    90,
  ),
  "13-blank": () => buildPdf([""]),
  "14-heading-sizes": () => buildPdf([
    [
      line(72, 720, 22, "Part I"),
      line(72, 690, 16, "Chapter title"),
      line(72, 664, 12, "Section heading"),
      ...Array.from({ length: 6 }, (_, i) => bodyLine(640 - i * 14, `Ordinary body size text ${i + 1}.`)),
    ].join("\n"),
  ]),
  "15-page-numbers-only": () => buildPdf(
    [1, 2, 3].map((page) => line(296, 40, 10, String(page)).concat("\n", bodyLine(700, `Minimal content page ${page}.`))),
  ),
};

export function generateAll(outDir) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [name, build] of Object.entries(FIXTURES)) {
    const path = join(outDir, `${name}.pdf`);
    writeFileSync(path, build());
    written.push(path);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Figure fixture corpus (gauntlet Piece D) — deterministic vector/raster
// figures drawn at KNOWN user-space coordinates (origin bottom-left, y up).
// The expectations file asserts against these coordinates a priori.
// ---------------------------------------------------------------------------

/** Vector content-stream helpers (all coordinates in PDF user space). */
const draw = {
  lw: (w) => `${w} w`,
  gray: (g) => `${g} G`,
  stroke: (x1, y1, x2, y2) => `${x1} ${y1} m ${x2} ${y2} l S`,
  seg: (...pts) =>
    pts.map(([x, y], i) => (i === 0 ? `${x} ${y} m` : `${x} ${y} l`)).join(" ") + " S",
  rect: (x, y, w, h) => `${x} ${y} ${w} ${h} re S`,
  fillRect: (x, y, w, h, g = 0.7) => `${g} g ${x} ${y} ${w} ${h} re f 0 g`,
};

/**
 * Assemble a multi-page PDF with per-page rotation and embedded image
 * XObjects. Each page spec: { content, rotation?, images?: [{name, width,
 * height, rgb: Uint8Array}] }. Deterministic (deflate level fixed).
 */
function buildFigurePdf(pageSpecs, mediaBox = [0, 0, 612, 792]) {
  const chunks = ["%PDF-1.4"];
  const offsets = [];
  let length = 0;
  const push = (body) => {
    offsets.push(length);
    chunks.push(body);
    length += (typeof body === "string" ? Buffer.byteLength(body, "latin1") : body.length) + 1;
  };

  // Object layout: 1 catalog, 2 pages, then per page [page, content, ...images],
  // then two font objects at the end.
  // Accept either a raw content string or a {content, rotation?, images?} spec.
  const specs = pageSpecs.map((spec) => (typeof spec === "string" ? { content: spec } : spec));
  const perPage = specs.map((spec) => 2 + (spec.images?.length ?? 0));
  const pageObj = (i) => 3 + perPage.slice(0, i).reduce((a, b) => a + b, 0);
  const contentObj = (i) => pageObj(i) + 1;
  const imageObj = (i, j) => pageObj(i) + 2 + j;
  const fontRef = 3 + perPage.reduce((a, b) => a + b, 0);

  push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`);
  const kids = pageSpecs.map((_, i) => `${pageObj(i)} 0 R`).join(" ");
  push(`2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pageSpecs.length} >> endobj`);

  specs.forEach((spec, i) => {
    const rotate = spec.rotation ? ` /Rotate ${spec.rotation}` : "";
    const xobjects = (spec.images ?? [])
      .map((img, j) => `/${img.name} ${imageObj(i, j)} 0 R`)
      .join(" ");
    const xo = xobjects ? ` /XObject << ${xobjects} >>` : "";
    push(
      `${pageObj(i)} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(" ")}]${rotate} /Contents ${contentObj(i)} 0 R /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${fontRef + 1} 0 R >>${xo} >> >> endobj`,
    );
    const stream = spec.content;
    push(`${contentObj(i)} 0 obj << /Length ${stream.length} >>\nstream\n${stream}\nendstream endobj`);
    (spec.images ?? []).forEach((img, j) => {
      const data = deflateSync(Buffer.from(img.rgb), { level: 6 });
      const head = `${imageObj(i, j)} 0 obj << /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`;
      push(Buffer.concat([
        Buffer.from(head, "latin1"),
        data,
        Buffer.from("\nendstream endobj", "latin1"),
      ]));
    });
  });
  push(`${fontRef} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  push(`${fontRef + 1} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj`);

  const xrefOffset = length;
  const total = fontRef + 2;
  const xref = ["xref", `0 ${total}`, "0000000000 65535 f "];
  for (const offset of offsets) {
    xref.push(`${String(offset).padStart(10, "0")} 00000 n `);
  }
  xref.push(`trailer << /Size ${total} /Root 1 0 R >>`, "startxref", String(xrefOffset), "%%EOF");
  chunks.push(xref.join("\n"));
  return chunks.map((chunk) => (typeof chunk === "string" ? chunk : chunk.toString("latin1"))).join("\n");
}

/** Deterministic small raster: high-contrast checkerboard, 80×60 RGB. */
function rasterPattern(seed = 7) {
  const width = 80;
  const height = 60;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const check = ((x >> 3) + (y >> 3) + seed) % 2;
      if (check) {
        rgb[i] = 20; rgb[i + 1] = 20; rgb[i + 2] = 20;
      } else {
        rgb[i] = 90 + ((x * 7 + y * 13 + seed) % 100); rgb[i + 1] = 30; rgb[i + 2] = 30;
      }
    }
  }
  return { width, height, rgb };
}

/** Standard body text above/below a figure so the page enters visual analysis. */
function bodyAround(yTopText, linesTop, yBottomText, linesBottom, x = 72) {
  const out = [];
  for (let i = 0; i < linesTop; i++) out.push(bodyLine(yTopText - i * 14, `Fixture body text line ${i + 1} above the figure region.`, x));
  for (let i = 0; i < linesBottom; i++) out.push(bodyLine(yBottomText - i * 14, `Fixture body text line ${i + 1} below the figure region.`, x));
  return out;
}

const FIGURE_FIXTURES = {
  // 1. Embedded raster image figure: 240×180 at (100,400)-(340,580).
  "fig01-raster": () => buildFigurePdf([
    {
      content: [
        ...bodyAround(740, 4, 360, 4),
        line(100, 372, 10, "Figure 1. Embedded raster image."),
        "q 240 0 0 180 100 400 cm /Im1 Do Q",
      ].join("\n"),
      images: [{ name: "Im1", ...rasterPattern() }],
    },
  ]),
  // 2. Vector diagram with internal text labels: nested boxes + arrows +
  //    label text INSIDE the diagram, drawn in (120,380)-(480,590).
  "fig02-vector-labels": () => buildFigurePdf([
    [
      ...bodyAround(740, 4, 340, 4),
      line(120, 312, 10, "Figure 2. Vector diagram with internal labels."),
      draw.lw(1.2), draw.gray(0),
      draw.rect(150, 520, 120, 55),
      draw.rect(340, 520, 120, 55),
      draw.rect(240, 410, 130, 55),
      draw.stroke(270, 547, 340, 547),
      draw.stroke(280, 520, 275, 465),
      draw.stroke(320, 465, 340, 520),
      line(165, 540, 9, "Input stage"),
      line(355, 540, 9, "Output stage"),
      line(258, 430, 9, "Processor"),
    ].join("\n"),
  ]),
  // 3. Flowchart: 4 boxes connected by lines with labels, (110,360)-(500,600).
  "fig03-flowchart": () => buildFigurePdf([
    [
      ...bodyAround(740, 3, 320, 3),
      line(110, 292, 10, "Figure 3. Flowchart of boxes connected by lines."),
      draw.lw(1.2), draw.gray(0),
      draw.rect(120, 560, 110, 36),
      draw.rect(370, 560, 110, 36),
      draw.rect(120, 430, 110, 36),
      draw.rect(370, 430, 110, 36),
      draw.stroke(230, 578, 370, 578),
      draw.stroke(175, 560, 175, 466),
      draw.stroke(230, 448, 370, 448),
      line(130, 570, 9, "Start"),
      line(380, 570, 9, "Decide"),
      line(130, 440, 9, "Act"),
      line(380, 440, 9, "End"),
    ].join("\n"),
  ]),
  // 4. Chart-like vector art with axis labels, axes at x=140..520, y=380..570.
  "fig04-chart-axes": () => buildFigurePdf([
    [
      ...bodyAround(740, 4, 340, 4),
      line(140, 312, 10, "Figure 4. Chart with labelled axes."),
      draw.lw(1.2), draw.gray(0),
      draw.stroke(140, 380, 140, 570), // y axis
      draw.stroke(140, 380, 520, 380), // x axis
      draw.seg([160, 420], [220, 500], [300, 460], [380, 540], [480, 430]),
      line(300, 358, 9, "Time (days)"),
      line(90, 460, 9, "Load"),
    ].join("\n"),
  ]),
  // 5. Sparse line art (low ink density): a triangle + one diagonal, region
  //    (150,420)-(460,590).
  "fig05-sparse-lineart": () => buildFigurePdf([
    [
      ...bodyAround(740, 4, 380, 4),
      line(150, 352, 10, "Figure 5. Sparse line art."),
      draw.lw(1), draw.gray(0),
      draw.seg([170, 440], [440, 440], [300, 580], [170, 440]),
      draw.stroke(180, 450, 430, 570),
    ].join("\n"),
  ]),
  // 6. Figure inside ONE column of a two-column page. Columns: left
  //    x∈[72,296], right x∈[316,540]; figure at (330,380)-(530,560).
  "fig06-two-column-figure": () => buildFigurePdf([
    [
      line(72, 740, 14, "Two-Column Page With Column Figure"),
      ...Array.from({ length: 8 }, (_, i) => bodyLine(710 - i * 14, `Left column text line ${i + 1}.`, 72)),
      ...Array.from({ length: 3 }, (_, i) => bodyLine(360 - i * 14, `Right column text above figure ${i + 1}.`, 316)),
      draw.lw(1.2), draw.gray(0),
      draw.rect(330, 380, 200, 180),
      draw.fillRect(340, 390, 180, 160, 0.55),
      draw.stroke(330, 470, 530, 470),
      line(316, 352, 10, "Figure 6. Column-width figure."),
      ...Array.from({ length: 4 }, (_, i) => bodyLine(310 - i * 14, `Left column lower text ${i + 1}.`, 72)),
    ].join("\n"),
  ]),
  // 7. Full-width figure spanning two columns: (72,380)-(540,570).
  "fig07-full-width": () => buildFigurePdf([
    [
      line(72, 740, 14, "Full-Width Spanning Figure"),
      ...Array.from({ length: 5 }, (_, i) => bodyLine(710 - i * 14, `Left column text ${i + 1}.`, 72)),
      ...Array.from({ length: 5 }, (_, i) => bodyLine(710 - i * 14, `Right column text ${i + 1}.`, 316)),
      draw.lw(1.4), draw.gray(0),
      draw.rect(72, 380, 468, 190),
      draw.fillRect(90, 400, 130, 150, 0.6),
      draw.fillRect(240, 400, 130, 150, 0.45),
      draw.fillRect(390, 400, 130, 150, 0.7),
      draw.stroke(72, 475, 540, 475),
      line(72, 352, 10, "Figure 7. Full-width figure spanning both columns."),
      ...Array.from({ length: 4 }, (_, i) => bodyLine(330 - i * 14, `Body text below the figure ${i + 1}.`, 72)),
    ].join("\n"),
  ]),
  // 8. Page with three distinct figures + captions, drawn at known spots.
  "fig08-multi-figures": () => buildFigurePdf([
    [
      ...bodyAround(740, 2, 60, 2),
      draw.lw(1.2), draw.gray(0),
      // Figure 1: (90,560)-(300,690)
      draw.rect(90, 560, 210, 130),
      draw.seg([100, 570], [280, 680]),
      draw.seg([280, 570], [100, 680]),
      line(90, 532, 10, "Figure 1. First figure."),
      // Figure 2: (330,560)-(540,690)
      draw.rect(330, 560, 210, 130),
      draw.stroke(330, 625, 540, 625),
      line(330, 532, 10, "Figure 2. Second figure."),
      // Figure 3: (180,330)-(430,470)
      draw.rect(180, 330, 250, 140),
      draw.fillRect(200, 350, 210, 110, 0.5),
      line(180, 302, 10, "Figure 3. Third figure."),
    ].join("\n"),
  ]),
  // 9. Rotated page (/Rotate 90) with a figure at (100,300)-(480,520).
  "fig09-rotated-figure": () => buildFigurePdf(
    [
      {
        content: [
          ...bodyAround(740, 3, 250, 3),
          line(100, 222, 10, "Figure 9. Figure on a rotated page."),
          draw.lw(1.4), draw.gray(0),
          draw.rect(100, 300, 380, 220),
          draw.stroke(100, 410, 480, 410),
          draw.seg([130, 330], [300, 490], [450, 350]),
        ].join("\n"),
        rotation: 90,
      },
    ],
  ),
  // 10. Very wide (>=8:1) and very tall figures in one document.
  "fig10-extreme-aspects": () => buildFigurePdf([
    [
      ...bodyAround(745, 3, 0, 0),
      draw.lw(2), draw.gray(0),
      // Wide banner: (72,640)-(540,664) → 468×24 = 19.5:1.
      draw.rect(72, 640, 468, 24),
      draw.stroke(72, 652, 540, 652),
      line(72, 612, 10, "Figure 10. Wide banner figure."),
      ...Array.from({ length: 6 }, (_, i) => bodyLine(560 - i * 14, `Body line between the two figures ${i + 1}.`, 72)),
      draw.lw(2),
      // Tall strip: (280,80)-(320,470) → 40×390 ≈ 1:9.75.
      draw.rect(280, 80, 40, 390),
      draw.stroke(300, 80, 300, 470),
      line(72, 52, 10, "Figure 11. Tall strip figure."),
    ].join("\n"),
  ]),
  // 11. Wide 8:1 banner whose crop aspect IS asserted. fig10's extreme
  //     shapes opt out of the aspect check (19.5:1 hypersensitivity / merged
  //     band); this one is sized so ±2pt of caption bleed cannot legitimately
  //     move the aspect — the deterministic wide-aspect crop gate.
  "fig11-wide-aspect-crop": () => buildFigurePdf([
    [
      ...bodyAround(745, 4, 0, 0),
      draw.lw(2), draw.gray(0),
      // Wide banner: (66,400)-(546,460) → 480×60 = 8:1, clear vertical
      // whitespace above (body ends ~735) and page-bottom below.
      draw.rect(66, 400, 480, 60),
      draw.stroke(66, 430, 546, 430),
      draw.fillRect(84, 404, 64, 52, 0.6),
      // Caption sits just under the banner edge: caption-top + 2pt >= the
      // banner's bottom, so the caption-attach bbox growth is a no-op.
      line(66, 388, 10, "Figure 12. Wide banner with asserted crop aspect."),
    ].join("\n"),
  ]),
};

export function generateFigureFixtures(outDir) {
  const figuresDir = join(outDir, "figures");
  mkdirSync(figuresDir, { recursive: true });
  const written = [];
  for (const [name, build] of Object.entries(FIGURE_FIXTURES)) {
    const path = join(figuresDir, `${name}.pdf`);
    writeFileSync(path, build(), "latin1");
    written.push(path);
  }
  return written;
}

// CLI entry
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = process.argv[2] ?? "src-tauri/tests/fixtures/pdf-reflow";
  const written = generateAll(outDir);
  const figures = generateFigureFixtures(outDir);
  console.error(`wrote ${written.length} fixtures + ${figures.length} figure fixtures to ${outDir}`);
  for (const path of written) console.error(`  ${path}`);
  for (const path of figures) console.error(`  ${path}`);
}
