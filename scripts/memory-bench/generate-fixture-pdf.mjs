/**
 * Deterministic PDF fixture generator for the memory benchmark corpus.
 *
 * Produces a small, valid, text-bearing PDF with no external dependencies —
 * the output is byte-identical for identical parameters, so its content hash
 * is stable and the corpus is reproducible without committing binaries
 * (design D12). pdf.js renders it with extractable text.
 *
 * Usage:
 *   node scripts/memory-bench/generate-fixture-pdf.mjs <outPath> [pages] [seed]
 *
 * The page count and seed affect content (page labels), so the harness can
 * provision distinct corpus items (pdf-1, pdf-2) from one generator.
 */

/**
 * Build a minimal single-page PDF body as a byte string (ASCII only, so string
 * length === byte length, which keeps the xref offsets exact).
 */
function pageObject(pageIndex, pageCount, objectsRef, contentsRef, fontRef) {
  const label = `Memory benchmark fixture page ${pageIndex} of ${pageCount}`;
  const stream = `BT /F1 24 Tf 72 720 Td (${label}) Tj ET`;
  const page = `<< /Type /Page /Parent ${objectsRef} 0 R /MediaBox [0 0 612 792] /Contents ${contentsRef} 0 R /Resources << /Font << /F1 ${fontRef} 0 R >> >> >>`;
  const contents = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  return { page, contents };
}

/**
 * @param {object} [options]
 * @param {number} [options.pages=3] number of pages
 * @param {string} [options.label] page text prefix (default derived from pages)
 * @returns {string} the full PDF document as an ASCII string
 */
export function buildPdf({ pages = 3 } = {}) {
  if (!Number.isInteger(pages) || pages < 1 || pages > 64) {
    throw new Error(`pages must be an integer in [1, 64], got ${pages}`);
  }

  // Object layout:
  //   1 catalog, 2 pages, then per page: (3 + 2i) page, (4 + 2i) contents,
  //   last: font.
  const pageRefs = [];
  const contentRefs = [];
  for (let i = 0; i < pages; i++) {
    pageRefs.push(3 + 2 * i);
    contentRefs.push(4 + 2 * i);
  }
  const fontRef = 3 + 2 * pages;

  const chunks = ["%PDF-1.4"];
  const offsets = [];
  // Account for the header line + its join newline: every object offset
  // (and startxref) was 8 bytes short, which Rust pdf-extract rejects with
  // "Invalid file trailer" (pdf.js tolerated it — found via the macOS e2e).
  let length = "%PDF-1.4".length + 1;

  const push = (body) => {
    offsets.push(length);
    chunks.push(body);
    length += body.length + 1; // +1 for the trailing newline
  };

  push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`);
  const kids = pageRefs.map((p) => `${p} 0 R`).join(" ");
  push(`2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages} >> endobj`);
  for (let i = 0; i < pages; i++) {
    const { page, contents: contentsBody } = pageObject(
      i + 1,
      pages,
      2,
      contentRefs[i],
      fontRef,
    );
    push(`${pageRefs[i]} 0 obj ${page} endobj`);
    push(`${contentRefs[i]} 0 obj ${contentsBody} endobj`);
  }
  push(`${fontRef} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);

  const xrefOffset = length;
  const count = fontRef + 1;
  const xref = [`xref`, `0 ${count}`, `0000000000 65535 f `];
  for (const offset of offsets) {
    xref.push(`${String(offset).padStart(10, "0")} 00000 n `);
  }
  xref.push(`trailer << /Size ${count} /Root 1 0 R >>`);
  xref.push(`startxref`, String(xrefOffset), "%%EOF");
  chunks.push(xref.join("\n"));

  return chunks.join("\n");
}

// CLI entry
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , outPath, pagesArg, label] = process.argv;
  if (!outPath) {
    console.error("usage: node generate-fixture-pdf.mjs <outPath> [pages] [label]");
    process.exit(2);
  }
  const pages = pagesArg ? Number(pagesArg) : 3;
  writeFileSync(outPath, buildPdf({ pages, label }));
  console.error(`wrote ${outPath} (${pages} pages)`);
}
