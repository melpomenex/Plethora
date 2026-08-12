/**
 * Deterministic EPUB fixture generator for the memory benchmark corpus.
 *
 * Produces a small, valid EPUB (a stored-only ZIP container with the EPUB
 * spine) with no external dependencies — output is byte-identical for
 * identical parameters, so its content hash is stable and the corpus is
 * reproducible without committing binaries (design D12). epub.js/JSZip read
 * stored (uncompressed) ZIP entries without issue.
 *
 * Usage:
 *   node scripts/memory-bench/generate-fixture-epub.mjs <outPath> [chapters] [seed]
 */

/** CRC-32 (IEEE 802.3), table-based, byte-exact for ZIP. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a stored-only ZIP archive from { name -> Uint8Array } entries. */
export function buildStoredZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(content);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true); // local file header signature
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0, true); // flags
    header.setUint16(8, 0, true); // method: store
    header.setUint16(10, 0, true); // mod time
    header.setUint16(12, 0x21, true); // mod date (1980-01-01)
    header.setUint32(14, crc, true);
    header.setUint32(18, content.length, true);
    header.setUint32(22, content.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true); // extra length
    chunks.push(new Uint8Array(header.buffer), nameBytes, content);

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true); // central directory signature
    centralHeader.setUint16(4, 20, true); // version made by
    centralHeader.setUint16(6, 20, true); // version needed
    centralHeader.setUint16(8, 0, true); // flags
    centralHeader.setUint16(10, 0, true); // method
    centralHeader.setUint16(12, 0, true);
    centralHeader.setUint16(14, 0x21, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, content.length, true);
    centralHeader.setUint32(24, content.length, true);
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint32(42, offset, true); // local header offset
    central.push(new Uint8Array(centralHeader.buffer), nameBytes);

    offset += 30 + nameBytes.length + content.length;
  }

  const centralBytes = concat(central);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // EOCD signature
  eocd.setUint16(8, entries.length, true); // total entries (both fields)
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralBytes.length, true);
  eocd.setUint32(16, offset, true);

  const prefix = concat(chunks);
  const out = new Uint8Array(prefix.length + centralBytes.length + 22);
  out.set(prefix, 0);
  out.set(centralBytes, prefix.length);
  out.set(new Uint8Array(eocd.buffer), prefix.length + centralBytes.length);
  return out;
}

function concat(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const enc = new TextEncoder();

function xhtml(chapter, total) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Memory benchmark fixture — chapter ${chapter}</title></head>
<body><h1>Chapter ${chapter}</h1>
<p>Memory benchmark fixture chapter ${chapter} of ${total}. This is a deterministic EPUB generated for the Incrementum memory benchmark corpus.</p>
</body></html>`;
}

/**
 * Build a minimal valid EPUB as a Uint8Array.
 *
 * @param {object} [options]
 * @param {number} [options.chapters=3]
 * @param {string} [options.title="Memory Benchmark Fixture"]
 */
export function buildEpub({ chapters = 3, title = "Memory Benchmark Fixture" } = {}) {
  if (!Number.isInteger(chapters) || chapters < 1 || chapters > 64) {
    throw new Error(`chapters must be an integer in [1, 64], got ${chapters}`);
  }
  const id = "memory-benchmark-fixture";
  const spine = [];
  const manifest = [];
  for (let c = 1; c <= chapters; c++) {
    const file = `chapter-${c}.xhtml`;
    spine.push(`    <itemref idref="c${c}"/>`);
    manifest.push(
      `    <item id="c${c}" href="${file}" media-type="application/xhtml+xml"/>`,
    );
  }
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${id}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifest.join("\n")}
  </manifest>
  <spine toc="ncx">
${spine.join("\n")}
  </spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
${Array.from({ length: chapters }, (_, i) => `  <li><a href="chapter-${i + 1}.xhtml">Chapter ${i + 1}</a></li>`).join("\n")}
</ol></nav></body></html>`;
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:${id}"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${Array.from({ length: chapters }, (_, i) => `    <navPoint id="nav${i + 1}" playOrder="${i + 1}"><navLabel><text>Chapter ${i + 1}</text></navLabel><content src="chapter-${i + 1}.xhtml"/></navPoint>`).join("\n")}
  </navMap>
</ncx>`;

  const entries = [
    ["mimetype", enc.encode("application/epub+zip")],
    ["META-INF/container.xml", enc.encode(container)],
    ["OEBPS/content.opf", enc.encode(opf)],
    ["OEBPS/nav.xhtml", enc.encode(nav)],
    ["OEBPS/toc.ncx", enc.encode(ncx)],
  ];
  for (let c = 1; c <= chapters; c++) {
    entries.push([`OEBPS/chapter-${c}.xhtml`, enc.encode(xhtml(c, chapters))]);
  }
  return buildStoredZip(entries);
}

// CLI entry
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , outPath, chaptersArg] = process.argv;
  if (!outPath) {
    console.error("usage: node generate-fixture-epub.mjs <outPath> [chapters]");
    process.exit(2);
  }
  const chapters = chaptersArg ? Number(chaptersArg) : 3;
  writeFileSync(outPath, buildEpub({ chapters }));
  console.error(`wrote ${outPath} (${chapters} chapters)`);
}
