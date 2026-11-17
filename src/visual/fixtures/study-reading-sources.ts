import JSZip from 'jszip';

export const first = 'A quorum can intersect across two majorities.';
export const last = 'The second passage closes with a verified boundary.';

function chapter(text: string) {
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Reading</title></head><body><p>${text}</p></body></html>`;
}

export async function makeBook(ambiguous = false) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('book.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">guided-reading-test-book</dc:identifier><dc:title>Reading fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
  zip.file('nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Contents</title></head><body><nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol></nav></body></html>');
  zip.file('one.xhtml', chapter('A <strong>quorum</strong> can intersect across two majorities.'));
  zip.file('two.xhtml', chapter(ambiguous ? first : last));
  return zip.generateAsync({ type: 'uint8array' });
}

export function makePdf(scanned = false, pageCount = 2) {
  const page = (content: number) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`;
  const text = (lines: string[]) => {
    const value = `BT /F1 16 Tf 55 700 Td ${lines.map((line) => `(${line}) Tj 0 -22 Td`).join(' ')} ET`;
    return `<< /Length ${value.length} >>\nstream\n${value}\nendstream`;
  };
  const pages = Array.from({ length: pageCount }, (_, index) => page(4 + pageCount + index));
  const contents = Array.from({ length: pageCount }, (_, index) => {
    if (index === 0) return text(scanned ? [] : ['A quorum can intersect', 'across two majorities.']);
    return text([index === pageCount - 1 ? last : `Filler page ${index + 1}`]);
  });
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${index + 4} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pages, ...contents,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) =>
    `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
