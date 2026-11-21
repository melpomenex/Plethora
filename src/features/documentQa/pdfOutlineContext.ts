import { usablePdfPageText, type PdfPageSource } from "../../utils/pdfAssistantEvidence";
import { budgetScopedBodies } from "../../utils/scopedContextBudget";
import { estimateTokens, hashSectionContent, type FocusedSectionContextResult, type SectionNode } from "../../utils/sectionIndex";
import { countTokens } from "../../utils/tokenizer";

/** Use the captured reader to load only the physical pages of the selected outline entries. */
export async function resolvePdfOutlineSectionContext(
  sections: SectionNode[],
  available: SectionNode[],
  source: PdfPageSource,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<FocusedSectionContextResult | undefined> {
  if (!sections.length || !sections.every(section =>
    section.source === "pdf-outline" && (!section.documentId || section.documentId === source.documentId)
  )) return;
  const outline = available.filter(section => section.source === "pdf-outline");
  const current = () => !signal?.aborted && source.isCurrent();
  const pageCache = new Map<number, string>();
  const chapterPages: string[][] = [];
  const labels: string[] = [];

  for (const section of sections) {
    const index = outline.findIndex(node => node.id === section.id);
    if (index < 0 || !current()) return;
    const entry = outline[index];
    const start = entry.page;
    const next = outline.slice(index + 1).find(node => node.level <= entry.level);
    const end = next ? next.page : source.pageCount + 1;
    // Adjacent entries on the same page need a text range to disambiguate.
    if (start === undefined || end === undefined || !Number.isInteger(start) ||
        !Number.isInteger(end) || start < 1 || end > source.pageCount + 1 || start >= end) return;

    const pages: string[] = [];
    for (let page = start; page < end; page += 1) {
      if (!current()) return;
      let text = pageCache.get(page);
      if (text === undefined) {
        text = usablePdfPageText(await source.loadPageText(page).catch(() => ""));
        pageCache.set(page, text);
      }
      pages.push(text);
    }
    const title = entry.title.trim().replace(/\s+/g, " ");
    const titleOffset = pages[0].toLowerCase().indexOf(title.toLowerCase());
    if (title && titleOffset >= 0) pages[0] = pages[0].slice(titleOffset + title.length).trim();
    if (!pages.some(Boolean)) return;

    labels.push(`${[...entry.breadcrumb, entry.title].join(" > ")} (PDF pages ${start}–${end - 1})`);
    chapterPages.push(pages);
  }
  if (!current()) return;

  const bodySegments = chapterPages.map((pages, index) => ({
    label: labels[index],
    text: pages.filter(Boolean).join("\n\n"),
  }));
  const fit = (budget: number) => {
    const budgeted = budgetScopedBodies(bodySegments, budget, 0.8);
    if (!budgeted.truncated) return budgeted;
    const excerpts = budgeted.excerpts.map((excerpt, index) => {
      const text = bodySegments[index].text;
      const body = excerpt === text
        ? text
        : excerptAcrossPages(chapterPages[index].filter(Boolean), excerpt.length);
      return `Section: ${labels[index]}\n${body}`;
    });
    return {
      content: excerpts.join("\n\n---\n\n") + "\n\n[Excerpts from across the selected PDF pages. Some text was omitted to fit the context budget.]",
      truncated: true,
    };
  };
  let result = fit(maxTokens);
  const measured = await countTokens(result.content);
  if (measured > maxTokens) {
    result = fit(Math.floor(maxTokens * maxTokens / measured * 0.95));
    if (await countTokens(result.content) > maxTokens) {
      throw new Error("The selected PDF sections need more room in the model’s context window.");
    }
  }
  if (!current()) return;
  const truncated = result.truncated || [...pageCache.values()].some(text => !text);
  const content = result.content;
  const sectionIds = sections.map(section => section.id);
  const contentHash = hashSectionContent(bodySegments.map(body => body.text).join("\n\n"));
  return {
    ok: true, labels, sections, unresolved: [], content, truncated, bodySegments,
    estimatedTokens: estimateTokens(content),
    source: {
      documentId: source.documentId, sectionIds, labels, contentHash, ranges: [],
      contextKey: hashSectionContent(`${source.documentId}:${source.version}:${sectionIds.join(",")}:${contentHash}`),
    },
  };
}

function excerptAcrossPages(pages: string[], maxChars: number): string {
  const count = Math.min(pages.length, Math.max(1, Math.floor(maxChars / 160)));
  const perPage = Math.floor((maxChars - (count - 1) * 2) / count);
  return Array.from({ length: count }, (_, index) => {
    const page = count === 1 ? 0 : Math.round(index * (pages.length - 1) / (count - 1));
    return pages[page].slice(0, perPage).trimEnd();
  }).join("\n\n");
}
