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
  /** Identifies where the section structure originated. */
  source?: "text" | "pdf-outline" | "epub-toc" | "full-document";
  /** True only when startChar/endChar point at body text in the current content snapshot. */
  hasAuthoritativeRange?: boolean;
  /** End of this heading's direct content, before its first child heading. */
  directEndChar?: number;
  /** Document identity used to prevent stale tokens crossing document boundaries. */
  documentId?: string;
}

export interface SectionContextDiagnostic {
  id: string;
  label: string;
  reason: string;
}

export interface FocusedSectionContextResult {
  ok: boolean;
  content: string;
  labels: string[];
  estimatedTokens: number;
  truncated: boolean;
  sections: SectionNode[];
  unresolved: SectionContextDiagnostic[];
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
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`>[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
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

  const decodeHtmlTitle = (value: string) => value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  const htmlHeadingPattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  for (const match of content.matchAll(htmlHeadingPattern)) {
    const title = decodeHtmlTitle(match[2]);
    if (!title) continue;
    headings.push({
      title,
      level: Number(match[1]),
      lineIndex: content.slice(0, match.index).split("\n").length - 1,
      charIndex: match.index,
      rawLine: match[0],
    });
  }

  headings.sort((a, b) => a.charIndex - b.charIndex);

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
        directEndChar: content.length,
        source: "full-document",
        hasAuthoritativeRange: true,
      },
    ];
  }

  const nodes: SectionNode[] = [];
  const stack: SectionNode[] = [];
  const allByIndex: SectionNode[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const start = h.charIndex;
    const directEnd = headings[i + 1]?.charIndex ?? content.length;
    let end = content.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        end = headings[j].charIndex;
        break;
      }
    }
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
      directEndChar: directEnd,
      source: "text",
      hasAuthoritativeRange: true,
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

  const mergedRoot = outlineNodes.map(cloneNodeDeep);
  const outlineFlat = flattenTree(mergedRoot);
  const heuristicFlat = flattenTree(heuristicNodes);
  const usedHeuristics = new Set<string>();
  const heuristicToMerged = new Map<string, SectionNode>();
  let lastMatchedStart = -1;

  const normalizeTitle = (value: string) => value
    .toLowerCase()
    .replace(/^[#\s]+/, "")
    .replace(/[\s:._-]+/g, " ")
    .trim();

  for (const outline of outlineFlat) {
    const title = normalizeTitle(outline.title);
    const candidates = heuristicFlat.filter((candidate) =>
      !usedHeuristics.has(candidate.id) && normalizeTitle(candidate.title) === title
    );
    if (candidates.length === 0) continue;

    const outlineAncestors = outline.breadcrumb.map(normalizeTitle);
    const scored = candidates.map((candidate) => {
      const candidateAncestors = candidate.breadcrumb.map(normalizeTitle);
      let score = candidate.level === outline.level ? 30 : 0;
      for (let i = 1; i <= Math.min(outlineAncestors.length, candidateAncestors.length); i++) {
        if (outlineAncestors.at(-i) === candidateAncestors.at(-i)) score += 60;
      }
      if ((candidate.startChar ?? -1) >= lastMatchedStart) score += 20;
      score -= Math.abs(candidate.level - outline.level) * 5;
      return { candidate, score };
    }).sort((a, b) => b.score - a.score || (a.candidate.startChar ?? 0) - (b.candidate.startChar ?? 0));

    const match = scored[0]?.candidate;
    if (!match) continue;
    usedHeuristics.add(match.id);
    heuristicToMerged.set(match.id, outline);
    lastMatchedStart = match.startChar ?? lastMatchedStart;
    outline.startChar = match.startChar;
    outline.endChar = match.endChar;
    outline.directEndChar = match.directEndChar;
    outline.preview = match.preview;
    outline.content = match.content;
    outline.hasAuthoritativeRange = true;
  }

  // Preserve extracted headings that were not represented by the outline.
  const unmatchedClones = new Map<string, SectionNode>();
  for (const heuristic of heuristicFlat) {
    if (usedHeuristics.has(heuristic.id)) continue;
    const clone: SectionNode = { ...heuristic, breadcrumb: [...heuristic.breadcrumb], children: [] };
    unmatchedClones.set(heuristic.id, clone);
    const matchedParent = heuristic.parentId ? heuristicToMerged.get(heuristic.parentId) : undefined;
    const unmatchedParent = heuristic.parentId ? unmatchedClones.get(heuristic.parentId) : undefined;
    const parent = matchedParent ?? unmatchedParent;
    if (parent) {
      clone.parentId = parent.id;
      clone.level = parent.level + 1;
      clone.breadcrumb = [...parent.breadcrumb, parent.title];
      parent.children.push(clone);
    } else {
      clone.parentId = null;
      clone.breadcrumb = [];
      mergedRoot.push(clone);
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

function sectionLabel(section: SectionNode): string {
  return section.breadcrumb.length > 0
    ? `${section.breadcrumb.join(" > ")} > ${section.title}`
    : section.title;
}

function rangeIsCurrent(section: SectionNode, fullContent: string): boolean {
  if (!section.hasAuthoritativeRange) return false;
  const { startChar, endChar } = section;
  if (startChar === undefined || endChar === undefined || startChar < 0 || endChar <= startChar || endChar > fullContent.length) {
    return false;
  }
  const current = fullContent.slice(startChar, endChar).trim();
  return current.length > 0 && current === section.content.trim();
}

function findStructuralMatch(section: SectionNode, available: SectionNode[]): SectionNode | undefined {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s:._-]+/g, " ").trim();
  const title = normalize(section.title);
  const breadcrumb = section.breadcrumb.map(normalize).join(" > ");
  const candidates = available.filter((candidate) =>
    candidate.hasAuthoritativeRange && normalize(candidate.title) === title
  );
  return candidates.find((candidate) => candidate.breadcrumb.map(normalize).join(" > ") === breadcrumb)
    ?? (candidates.length === 1 ? candidates[0] : undefined);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function recoverOutlineRangeFromText(
  section: SectionNode,
  available: SectionNode[],
  fullContent: string,
): SectionNode | undefined {
  if (section.source !== "pdf-outline" && section.source !== "epub-toc") return undefined;
  const titlePattern = new RegExp(`^\\s*(?:#{1,6}\\s*)?${escapeRegExp(section.title.trim())}\\s*$`, "gim");
  const occurrences = [...fullContent.matchAll(titlePattern)];
  if (occurrences.length === 0) return undefined;

  const sameTitleOutlineNodes = available.filter((candidate) =>
    candidate.source === section.source && candidate.title.trim().toLowerCase() === section.title.trim().toLowerCase()
  );
  const occurrenceIndex = Math.max(0, sameTitleOutlineNodes.findIndex((candidate) => candidate.id === section.id));
  const match = occurrences[Math.min(occurrenceIndex, occurrences.length - 1)];
  const start = match.index;

  let end = fullContent.length;
  for (const candidate of available) {
    if (candidate.id === section.id || candidate.level > section.level || !candidate.title.trim()) continue;
    const candidatePattern = new RegExp(`^\\s*(?:#{1,6}\\s*)?${escapeRegExp(candidate.title.trim())}\\s*$`, "gim");
    candidatePattern.lastIndex = start + match[0].length;
    const next = candidatePattern.exec(fullContent);
    if (next && next.index > start && next.index < end) end = next.index;
  }

  const content = fullContent.slice(start, end).trim();
  if (!content) return undefined;
  return {
    ...section,
    startChar: start,
    endChar: end,
    directEndChar: end,
    content,
    preview: cleanPreview(content.replace(match[0], "")),
    hasAuthoritativeRange: true,
  };
}

function truncateAtBoundary(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  const marker = "\n\n[Selected section truncated due to context limit...]";
  const target = Math.max(1, maxChars - marker.length);
  const candidate = value.slice(0, target);
  const paragraph = candidate.lastIndexOf("\n\n");
  const line = candidate.lastIndexOf("\n");
  const boundary = Math.max(paragraph, line);
  const text = candidate.slice(0, boundary > target * 0.6 ? boundary : target).trimEnd();
  return { text: text + marker, truncated: true };
}

/**
 * Resolve selected section tokens against the current document snapshot and
 * build the single canonical context string used at the LLM boundary.
 */
export function resolveSectionFocusedContext(
  selected: SectionNode[],
  available: SectionNode[],
  fullContent: string,
  options: {
    documentId?: string;
    maxTokens?: number;
    includeNeighbors?: boolean;
    radiusChars?: number;
  } = {}
): FocusedSectionContextResult {
  const { documentId, maxTokens = 4000, includeNeighbors = true, radiusChars = 300 } = options;
  const unresolved: SectionContextDiagnostic[] = [];
  const resolved: SectionNode[] = [];

  for (const requested of selected) {
    const label = sectionLabel(requested);
    if (documentId && requested.documentId && requested.documentId !== documentId) {
      unresolved.push({ id: requested.id, label, reason: "belongs to a different document" });
      continue;
    }
    const currentById = available.find((candidate) => candidate.id === requested.id);
    const candidate = currentById && rangeIsCurrent(currentById, fullContent)
      ? currentById
      : rangeIsCurrent(requested, fullContent)
        ? requested
        : findStructuralMatch(requested, available) ?? recoverOutlineRangeFromText(requested, available, fullContent);
    if (!candidate || !rangeIsCurrent(candidate, fullContent)) {
      unresolved.push({ id: requested.id, label, reason: "has no current document-text range" });
      continue;
    }
    resolved.push({ ...candidate, documentId: documentId ?? candidate.documentId });
  }

  if (unresolved.length > 0 || resolved.length !== selected.length) {
    return { ok: false, content: "", labels: resolved.map(sectionLabel), estimatedTokens: 0, truncated: false, sections: resolved, unresolved };
  }

  const unique = new Map<string, SectionNode>();
  for (const section of resolved) unique.set(section.id, section);
  const ordered = [...unique.values()].sort((a, b) => (a.startChar ?? 0) - (b.startChar ?? 0));
  const groups: Array<{ start: number; end: number; labels: string[]; sections: SectionNode[] }> = [];
  for (const section of ordered) {
    const start = section.startChar!;
    const end = section.endChar!;
    const previous = groups.at(-1);
    if (previous && start < previous.end) {
      previous.end = Math.max(previous.end, end);
      previous.labels.push(sectionLabel(section));
      previous.sections.push(section);
    } else {
      groups.push({ start, end, labels: [sectionLabel(section)], sections: [section] });
    }
  }

  const maxChars = Math.max(256, Math.floor(maxTokens * 4 * 0.7));
  const headerChars = groups.reduce((sum, group) => sum + group.labels.join(", ").length + 24, 0);
  const bodyBudget = Math.max(128, maxChars - headerChars);
  const perGroupBudget = Math.max(96, Math.floor(bodyBudget / Math.max(1, groups.length)));
  let truncated = false;
  const blocks = groups.map((group) => {
    const body = fullContent.slice(group.start, group.end).trim();
    const sliced = truncateAtBoundary(body, perGroupBudget);
    truncated ||= sliced.truncated;
    return `Section: ${group.labels.join("; ")}\n[Focused]\n${sliced.text}`;
  });

  let content = blocks.join("\n\n---\n\n");
  if (includeNeighbors && groups.length === 1 && content.length < maxChars) {
    const group = groups[0];
    const neighbor = sliceWithNeighbors(fullContent, group.start, group.end, radiusChars);
    const extras: string[] = [];
    if (neighbor.previous) extras.push(`[Previous context]\n${neighbor.previous}`);
    if (neighbor.next) extras.push(`[Next context]\n${neighbor.next}`);
    const extraText = extras.join("\n\n");
    if (extraText && content.length + extraText.length + 2 <= maxChars) content += `\n\n${extraText}`;
  }

  if (content.length > maxChars) {
    const finalSlice = truncateAtBoundary(content, maxChars);
    content = finalSlice.text;
    truncated ||= finalSlice.truncated;
  }

  return {
    ok: true,
    content,
    labels: resolved.map(sectionLabel),
    estimatedTokens: estimateTokens(content),
    truncated,
    sections: resolved,
    unresolved: [],
  };
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
  _fullContent?: string
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
        content: "",
        children: [],
        parentId: parent ? parent.id : null,
        source: "pdf-outline",
        hasAuthoritativeRange: false,
      };
      if (raw.items && raw.items.length > 0) {
        node.children = convert(raw.items as never, level + 1, node);
      }
      return node;
    });
  };

  const tree = convert(outline as never, 1, null);

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
      content: "",
      children: [],
      parentId: parent ? parent.id : null,
      source: "epub-toc",
      hasAuthoritativeRange: false,
    };
    if (raw.subitems && raw.subitems.length > 0) {
      node.children = convertEpubTocToSectionNodes(raw.subitems as never, level + 1, node);
    }
    return node;
  });
}
