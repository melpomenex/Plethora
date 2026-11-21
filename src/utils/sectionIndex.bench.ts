import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import { buildDocumentSections, convertPdfOutlineToSectionNodes } from "./sectionIndex";

const random = seededRandom(0x5ec710);
const pageCount = 640;
const outline = Array.from({ length: 80 }, (_, index) => ({
  title: `Topic ${index + 1}`,
  pageNumber: index * 8 + 1,
}));
const content = Array.from({ length: pageCount }, (_, index) => {
  const heading = index % 8 === 0 ? `<p><strong>${outline[index / 8].title}</strong></p>` : "";
  const image = index % 8 === 0
    ? `<img src="data:image/jpeg;base64,${"A".repeat(28_000 + Math.floor(random() * 10_000))}" />`
    : "";
  const paragraph = `Page ${index + 1} explains a concept with examples and illustrations. `;
  return [
    `<div class="page-header">Page ${index + 1} of ${pageCount}</div>`,
    heading,
    image,
    `<p>${paragraph.repeat(28)}</p>`,
  ].join("\n");
}).join("\n");

let sink = 0;
bench("pdf-outline/index-640-pages", () => {
  const { flat } = buildDocumentSections(content, convertPdfOutlineToSectionNodes(outline));
  sink = flat.reduce((total, section) => total + section.content.length, 0);
  if (sink === 0) throw new Error("PDF outline benchmark did not recover any section text");
});
