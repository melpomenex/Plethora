/**
 * Deterministic marketing corpus binaries: PDF, EPUBs, labeled WAV.
 * Run: node scripts/marketing/build-corpus.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const LIB = join(ROOT, "marketing/demo-library");
const GEN = join(LIB, "generated");

function esc(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function line(x, y, size, text, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${esc(text)}) Tj ET`;
}

function buildPdf(pages, mediaBox = [0, 0, 612, 792]) {
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
  push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  const kids = pageRefs.map((p) => `${p} 0 R`).join(" ");
  push(`2 0 obj << /Type /Pages /Kids [${kids}] /Count ${count} >> endobj`);
  for (let i = 0; i < count; i++) {
    const stream = pages[i];
    push(
      `${pageRefs[i]} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(" ")}] /Contents ${contentRefs[i]} 0 R /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${fontRef + 1} 0 R >> >> >> endobj`,
    );
    push(`${contentRefs[i]} 0 obj << /Length ${stream.length} >>\nstream\n${stream}\nendstream endobj`);
  }
  push(`${fontRef} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  push(`${fontRef + 1} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >> endobj`);
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

function methodsPdf() {
  const y0 = 720;
  const lines = [
    line(72, y0, 18, "Spaced retrieval: a one-page methods note", "F2"),
    line(72, y0 - 22, 10, "Original Plethora demo PDF. License: CC0-1.0. No third-party figures.", "F1"),
    line(72, y0 - 50, 12, "Aim", "F2"),
    line(72, y0 - 68, 11, "Measure whether a closed-book retrieval attempt, followed by restudy of misses,", "F1"),
    line(72, y0 - 84, 11, "beats an equal-time reread of the same passage after 24 hours including sleep.", "F1"),
    line(72, y0 - 112, 12, "Procedure", "F2"),
    line(72, y0 - 130, 11, "1. Study a 400-word passage once (no highlighting as the study method).", "F1"),
    line(72, y0 - 146, 11, "2. Immediate free recall (2 minutes). Score idea units, not wording.", "F1"),
    line(72, y0 - 162, 11, "3. Restudy only missed idea units for 3 minutes.", "F1"),
    line(72, y0 - 178, 11, "4. Sleep in a habitual window. No additional exposure.", "F1"),
    line(72, y0 - 194, 11, "5. Delayed free recall at +24 h. Primary outcome: idea-unit count.", "F1"),
    line(72, y0 - 222, 12, "Comparator", "F2"),
    line(72, y0 - 240, 11, "Equal total time spent rereading the passage. Same delay and scoring.", "F1"),
    line(72, y0 - 268, 12, "Notes", "F2"),
    line(72, y0 - 286, 11, "Failed recall is data: shorten the next gap. Fluency during reread is not scored.", "F1"),
    line(72, y0 - 302, 11, "This page is instructional fiction for screenshots, not a published experiment.", "F1"),
  ];
  return buildPdf([lines.join("\n")]);
}

function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function zipEntries(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const store = file.store === true;
    const compressed = store ? data : deflateRawSync(data);
    const method = store ? 0 : 8;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const localFull = Buffer.concat([local, name, compressed]);
    localParts.push(localFull);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, name]));
    offset += localFull.length;
  }
  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, end]);
}

function epubFromXhtml(title, xhtmlRelPath) {
  const xhtml = readFileSync(join(LIB, xhtmlRelPath), "utf8");
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:aaaaaaaa-epub-${title.length}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <dc:rights>CC0-1.0</dc:rights>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>
`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">${title}</a></li></ol></nav></body>
</html>
`;
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;
  return zipEntries([
    { name: "mimetype", data: "application/epub+zip", store: true },
    { name: "META-INF/container.xml", data: container },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    { name: "OEBPS/chapter.xhtml", data: xhtml },
  ]);
}

function demoWav({ durationSec = 4, sampleRate = 8000 } = {}) {
  const n = durationSec * sampleRate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = t < 0.02 || t > durationSec - 0.02 ? 0.2 : 1;
    const chapter = Math.floor(t) % 2 === 0 ? 220 : 330;
    const s = Math.sin(2 * Math.PI * chapter * t) * 0.2 * env;
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function buildCorpus() {
  mkdirSync(GEN, { recursive: true });
  writeFileSync(join(GEN, "spaced-retrieval-methods.pdf"), methodsPdf(), "utf8");
  writeFileSync(
    join(GEN, "encoding-versus-highlighting.epub"),
    epubFromXhtml("Why highlighting feels like learning", "sources/01-essay/encoding-versus-highlighting.html"),
  );
  writeFileSync(
    join(GEN, "william-james-habit-memory.epub"),
    epubFromXhtml("Habit and memory (James 1890 excerpt)", "sources/04-pd-excerpt/william-james-habit-memory.html"),
  );
  writeFileSync(join(GEN, "lecture-demo.wav"), demoWav());
  return [
    "marketing/demo-library/generated/spaced-retrieval-methods.pdf",
    "marketing/demo-library/generated/encoding-versus-highlighting.epub",
    "marketing/demo-library/generated/william-james-habit-memory.epub",
    "marketing/demo-library/generated/lecture-demo.wav",
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const written = buildCorpus();
  for (const path of written) console.log(path);
}
