export interface SectionNode {
  id: string;
  title: string;
  level: number;
  breadcrumb: string[];
  page?: number;
  href?: string;
  startChar?: number;
  endChar?: number;
  preview: string;
  content: string;
  children: SectionNode[];
  parentId: string | null;
}

interface HeadingInfo {
  title: string;
  level: number;
  lineIndex: number;
  charIndex: number;
  rawLine: string;
}

interface LRUEntry {
  tree: SectionNode[];
  flat: SectionNode[];
  hash: string;
}

const MAX_CACHE = 20;
const documentSectionCache = new Map<string, LRUEntry>();

function hashString(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function cleanPreview(text: string): string {
  return text
    .replace(/[#*_`>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function extractChapterNumber(title: string): number | null {
  const m = title.match(/(?:chapter\s+)?(\d+)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return isNaN(n) ? null : n;
  }
  const numPrefix = title.match(/^(\d+)(?:\.\d+)*/);
  if (numPrefix) {
    const n = parseInt(numPrefix[1], 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

function getLeadingNumberParts(title: string): number[] {
  const m = title.match(/^(\d+(?:\.\d+)*)/);
  if (!m) return [];
  return m[1].split(".").map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
}

export function parseMarkdownHeadings(content: string): HeadingInfo[] {
  if (!content) return [];
  const lines = content.split("\n");
  const headings: HeadingInfo[] = [];
  let charIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    let isHeading = false;
    let title = "";
    let level = 1;

    const mdMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (mdMatch) {
      isHeading = true;
      level = mdMatch[1].length;
      title = mdMatch[2].trim();
    } else {
      const chapterMatch = trimmed.match(/^(?:chapter|ch\.?|chap\.?|section|part)\s+(\d+|[IVX]+)\s*[.:-]?\s*(.+)?$/i);
      if (chapterMatch) {
        isHeading = true;
        level = 1;
        title = trimmed;
      } else {
        const numericMatch = trimmed.match(/^(\d+(?:\.\d+)*)\.?\s+([A-Za-z].+)$/);
        if (numericMatch && numericMatch[2].length < 120) {
          isHeading = true;
          const parts = numericMatch[1].split(".");
          level = parts.length;
          title = trimmed;
        }
      }
    }

    if (isHeading && title) {
      headings.push({
        title,
        level,
        lineIndex: i,
        charIndex,
        rawLine: line,
      });
    }
    charIndex += line.length + 1;
  }

  return headings;
}

export function buildTreeFromHeadings(
  content: string,
  headings: HeadingInfo[]
): SectionNode[] {
  if (headings.length === 0) {
    if (!content.trim()) return [];
    const preview = cleanPreview(content.slice(0, 200));
    return [
      {
        id: `section-${hashString(content.slice(0, 100))}`,
        title: "Full Document",
        level: 1,
        breadcrumb: [],
        preview,
        content: content.trim(),
        children: [],
        parentId: null,
        startChar: 0,
        endChar: content.length,
      },
    ];
  }

  const nodes: SectionNode[] = [];
  const stack: SectionNode[] = [];
  const allByIndex: SectionNode[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const next = headings[i + 1];
    const start = h.charIndex;
    const end = next ? next.charIndex : content.length;
    const rawContent = content.slice(start, end).trim();
    const preview = cleanPreview(rawContent.replace(h.rawLine, "").trim() || rawContent);

    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const breadcrumb = parent ? [...parent.breadcrumb, parent.title] : [];
    const parentId = parent ? parent.id : null;
    const stable = `${h.title}-${start}-${h.level}`;
    const id = `section-${hashString(stable)}`;

    const node: SectionNode = {
      id,
      title: h.title,
      level: h.level,
      breadcrumb,
      preview,
      content: rawContent,
      children: [],
      parentId,
      startChar: start,
      endChar: end,
    };

    if (parent) {
      parent.children.push(node);
    } else {
      nodes.push(node);
    }

    stack.push(node);
    allByIndex.push(node);
  }

  return nodes;
}

export function flattenTree(tree: SectionNode[]): SectionNode[] {
  const flat: SectionNode[] = [];
  const stack = [...tree].reverse();

  while (stack.length > 0) {
    const node = stack.pop()!;
    flat.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i]);
    }
  }

  return flat;
}

export function buildIdMap(flat: SectionNode[]): Map<string, SectionNode> {
  const m = new Map<string, SectionNode>();
  for (const n of flat) m.set(n.id, n);
  return m;
}

export function mergeOutlineWithHeuristics(
  outlineNodes: SectionNode[],
  heuristicNodes: SectionNode[]
): SectionNode[] {
  if (!outlineNodes || outlineNodes.length === 0) return heuristicNodes;
  if (!heuristicNodes || heuristicNodes.length === 0) return outlineNodes;

  const outlineFlat = flattenTree(outlineNodes);
  const heuristicFlat = flattenTree(heuristicNodes);

  const titleExists = new Set(outlineFlat.map((n) => n.title.toLowerCase().trim()));
  const chapterMap = new Map<number, SectionNode>();
  for (const o of outlineFlat) {
    const num = extractChapterNumber(o.title);
    if (num !== null && o.level === 1) {
      chapterMap.set(num, o);
    }
  }

  const mergedRoot = outlineNodes.map(cloneNodeDeep);

  const findCloneByTitle = (title: string, nodes: SectionNode[]): SectionNode | null => {
    const lower = title.toLowerCase();
    for (const n of flattenTree(nodes)) {
      if (n.title.toLowerCase() === lower) return n;
    }
    return null;
  };

  const rebuiltFlatMap = new Map<string, SectionNode>();
  for (const n of flattenTree(mergedRoot)) {
    const num = extractChapterNumber(n.title);
    if (num !== null) rebuiltFlatMap.set(`num-${num}`, n);
    rebuiltFlatMap.set(`title-${n.title.toLowerCase()}`, n);
  }

  for (const h of heuristicFlat) {
    const lower = h.title.toLowerCase().trim();
    if (titleExists.has(lower)) continue;

    const parts = getLeadingNumberParts(h.title);
    if (parts.length > 0) {
      const chapterNum = parts[0];
      const parent = chapterMap.get(chapterNum);
      if (parent) {
        const cloneParent = findCloneByTitle(parent.title, mergedRoot);
        if (cloneParent) {
          const newNode: SectionNode = {
            ...h,
            id: h.id,
            parentId: cloneParent.id,
            breadcrumb: [...cloneParent.breadcrumb, cloneParent.title],
            level: cloneParent.level + parts.length,
            children: [],
          };
          cloneParent.children.push(newNode);
          continue;
        }
      }
    }

    let attached = false;
    for (const o of outlineFlat) {
      if (lower.includes(o.title.toLowerCase()) || o.title.toLowerCase().includes(lower.split(" ").slice(0, 3).join(" "))) {
        const cloneParent = findCloneByTitle(o.title, mergedRoot);
        if (cloneParent) {
          const newNode: SectionNode = {
            ...h,
            parentId: cloneParent.id,
            breadcrumb: [...cloneParent.breadcrumb, cloneParent.title],
            children: [],
          };
          cloneParent.children.push(newNode);
          attached = true;
          break;
        }
      }
    }

    if (!attached) {
      mergedRoot.push({
        ...h,
        parentId: null,
        breadcrumb: [],
        children: [],
      });
    }
  }

  return mergedRoot;
}

function cloneNodeDeep(node: SectionNode): SectionNode {
  return {
    ...node,
    breadcrumb: [...node.breadcrumb],
    children: node.children.map(cloneNodeDeep),
  };
}

export function sliceWithNeighbors(
  content: string,
  startChar: number,
  endChar: number,
  radiusChars = 300
): { previous: string; focused: string; next: string; formatted: string } {
  const focused = content.slice(startChar, endChar).trim();

  const before = content.slice(Math.max(0, startChar - radiusChars * 3), startChar);
  const after = content.slice(endChar, Math.min(content.length, endChar + radiusChars * 3));

  const beforeParas = before.split(/\n\s*\n/).filter((p) => p.trim().length > 20);
  const afterParas = after.split(/\n\s*\n/).filter((p) => p.trim().length > 20);

  const previous = beforeParas.length > 0 ? beforeParas[beforeParas.length - 1].trim().slice(-radiusChars) : "";
  const next = afterParas.length > 0 ? afterParas[0].trim().slice(0, radiusChars) : "";

  const parts: string[] = [];
  if (previous) {
    parts.push(`[Previous context]\n${previous}`);
  }
  parts.push(`[Focused]\n${focused}`);
  if (next) {
    parts.push(`[Next]\n${next}`);
  }

  return {
    previous,
    focused,
    next,
    formatted: parts.join("\n\n"),
  };
}

export function buildSectionFocusedContext(
  sections: SectionNode[],
  fullContent?: string,
  options: { includeNeighbors?: boolean; maxTokens?: number; radiusChars?: number } = {}
): string {
  const { includeNeighbors = true, maxTokens = 4000, radiusChars = 300 } = options;
  if (sections.length === 0) return "";

  const maxChars = Math.floor(maxTokens * 4 * 0.7);

  const blocks: string[] = [];
  let totalChars = 0;

  for (const sec of sections) {
    const breadcrumbStr = sec.breadcrumb.length > 0 ? `${sec.breadcrumb.join(" > ")} > ${sec.title}` : sec.title;
    let body: string;
    if (includeNeighbors && fullContent && sec.startChar !== undefined && sec.endChar !== undefined) {
      const sliced = sliceWithNeighbors(fullContent, sec.startChar, sec.endChar, radiusChars);
      body = `Section: ${breadcrumbStr}\n${sliced.formatted}`;
    } else {
      body = `Section: ${breadcrumbStr}\n\n${sec.content}`;
    }

    if (totalChars + body.length > maxChars && blocks.length > 0) {
      break;
    }

    blocks.push(body);
    totalChars += body.length;
  }

  let combined = blocks.join("\n\n---\n\n");
  if (combined.length > maxChars) {
    combined = combined.slice(0, maxChars) + "\n\n[Content truncated due to length...]";
  }

  return combined;
}

export function buildDocumentSections(
  content: string,
  outlineNodes?: SectionNode[],
  _contentHash?: string
): { tree: SectionNode[]; flat: SectionNode[] } {
  const headings = parseMarkdownHeadings(content);
  const heuristicTree = buildTreeFromHeadings(content, headings);

  let finalTree: SectionNode[];
  if (outlineNodes && outlineNodes.length > 0) {
    finalTree = mergeOutlineWithHeuristics(outlineNodes, heuristicTree);
  } else {
    finalTree = heuristicTree;
  }

  const flat = flattenTree(finalTree);
  return { tree: finalTree, flat };
}

export function getCache(key: string): LRUEntry | undefined {
  const entry = documentSectionCache.get(key);
  if (entry) {
    documentSectionCache.delete(key);
    documentSectionCache.set(key, entry);
  }
  return entry;
}

export function setCache(key: string, entry: LRUEntry): void {
  if (documentSectionCache.has(key)) {
    documentSectionCache.delete(key);
  } else if (documentSectionCache.size >= MAX_CACHE) {
    const first = documentSectionCache.keys().next().value;
    if (first) documentSectionCache.delete(first);
  }
  documentSectionCache.set(key, entry);
}

export function makeCacheKey(docId: string, contentHash: string, outlineHash: string): string {
  return `${docId}:${contentHash}:${outlineHash}`;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function convertPdfOutlineToSectionNodes(
  outline: Array<{ title: string; pageNumber?: number; items?: Array<{ title: string; pageNumber?: number; items?: unknown[] }> }>,
  fullContent?: string
): SectionNode[] {
  const convert = (items: Array<{ title: string; pageNumber?: number; items?: unknown[] }>, level: number, parent: SectionNode | null): SectionNode[] => {
    return items.map((item) => {
      const raw = item as { title: string; pageNumber?: number; items?: Array<{ title: string; pageNumber?: number; items?: unknown[] }> };
      const breadcrumb = parent ? [...parent.breadcrumb, parent.title] : [];
      const node: SectionNode = {
        id: `section-${hashString(`${raw.title}-${level}-${breadcrumb.join("_")}`)}`,
        title: raw.title || "Untitled",
        level,
        breadcrumb,
        page: raw.pageNumber,
        preview: cleanPreview(raw.title),
        content: raw.title,
        children: [],
        parentId: parent ? parent.id : null,
      };
      if (raw.items && raw.items.length > 0) {
        node.children = convert(raw.items as never, level + 1, node);
      }
      return node;
    });
  };

  const tree = convert(outline as never, 1, null);

  if (fullContent) {
    const flat = flattenTree(tree);
    for (const node of flat) {
      node.content = node.title;
    }
  }

  return tree;
}

export function convertEpubTocToSectionNodes(
  toc: Array<{ label?: string; title?: string; href?: string; subitems?: Array<{ label?: string; title?: string; href?: string; subitems?: unknown[] }> }>,
  level = 1,
  parent: SectionNode | null = null
): SectionNode[] {
  return toc.map((item) => {
    const raw = item as { label?: string; title?: string; href?: string; subitems?: Array<{ label?: string; title?: string; href?: string; subitems?: unknown[] }> };
    const title = (raw.label || raw.title || "Untitled").trim();
    const breadcrumb = parent ? [...parent.breadcrumb, parent.title] : [];
    const node: SectionNode = {
      id: `section-${hashString(`${title}-${level}-${raw.href || ""}-${breadcrumb.join("_")}`)}`,
      title,
      level,
      breadcrumb,
      href: raw.href,
      preview: cleanPreview(title),
      content: title,
      children: [],
      parentId: parent ? parent.id : null,
    };
    if (raw.subitems && raw.subitems.length > 0) {
      node.children = convertEpubTocToSectionNodes(raw.subitems as never, level + 1, node);
    }
    return node;
  });
}
