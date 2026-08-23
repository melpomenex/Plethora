import { getCollection, type CollectionEntry } from 'astro:content';
import { DOC_CATEGORIES, type DocCategoryKey } from '../config/docs-taxonomy.ts';

export type DocEntry = CollectionEntry<'docs'>;

export interface TocHeading {
  depth: number;
  slug: string;
  text: string;
}

export interface SearchDocItem {
  id: string;
  title: string;
  description: string;
  category: string;
  categoryTitle: string;
  url: string;
  headings: string[];
  keywords: string[];
  aliases: string[];
}

export async function getPublishedDocs(): Promise<DocEntry[]> {
  const docs = await getCollection('docs', ({ data }) => data.published);
  return docs.sort((a, b) => {
    if (a.data.category !== b.data.category) {
      const catA = DOC_CATEGORIES.find((c) => c.id === a.data.category)?.order ?? 999;
      const catB = DOC_CATEGORIES.find((c) => c.id === b.data.category)?.order ?? 999;
      return catA - catB;
    }
    if (a.data.order !== b.data.order) {
      return a.data.order - b.data.order;
    }
    return a.data.title.localeCompare(b.data.title);
  });
}

export function groupDocsByCategory(docs: DocEntry[]): Map<DocCategoryKey, DocEntry[]> {
  const grouped = new Map<DocCategoryKey, DocEntry[]>();
  for (const cat of DOC_CATEGORIES) {
    grouped.set(cat.id, []);
  }
  for (const doc of docs) {
    const list = grouped.get(doc.data.category as DocCategoryKey);
    if (list) {
      list.push(doc);
    }
  }
  return grouped;
}

export function getDocUrl(doc: DocEntry): string {
  return `/docs/${doc.id}`;
}

export function getPrevNextDocs(
  current: DocEntry,
  allDocs: DocEntry[],
): { prev?: { title: string; url: string }; next?: { title: string; url: string } } {
  const sameCat = allDocs.filter((d) => d.data.category === current.data.category);
  const idx = sameCat.findIndex((d) => d.id === current.id);
  if (idx === -1) return {};

  return {
    prev: idx > 0 ? { title: sameCat[idx - 1].data.title, url: getDocUrl(sameCat[idx - 1]) } : undefined,
    next: idx < sameCat.length - 1 ? { title: sameCat[idx + 1].data.title, url: getDocUrl(sameCat[idx + 1]) } : undefined,
  };
}

export function buildSearchIndex(docs: DocEntry[]): SearchDocItem[] {
  return docs.map((doc) => {
    const categoryInfo = DOC_CATEGORIES.find((c) => c.id === doc.data.category);
    return {
      id: doc.id,
      title: doc.data.title,
      description: doc.data.description,
      category: doc.data.category,
      categoryTitle: categoryInfo?.title ?? doc.data.category,
      url: getDocUrl(doc),
      headings: [],
      keywords: doc.data.keywords || [],
      aliases: doc.data.aliases || [],
    };
  });
}
