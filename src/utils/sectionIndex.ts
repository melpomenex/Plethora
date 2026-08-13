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
  source?: "text" | "pdf-outline" | "epub-toc" | "full-document" | "selection" | "media-transcript";
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
  code?: "wrong-document" | "ambiguous" | "unresolved";
  /** For ambiguous matches: how many current headings the title matched. */
  candidateCount?: number;
}

export interface SectionSourceReference {
  documentId?: string;
  sectionIds: string[];
  labels: string[];
  contentHash: string;
  contextKey: string;
  ranges: Array<{ start: number; end: number }>;
}

export interface FocusedSectionContextResult {
  ok: boolean;
  content: string;
  labels: string[];
  estimatedTokens: number;
  truncated: boolean;
  sections: SectionNode[];
  unresolved: SectionContextDiagnostic[];
  source: SectionSourceReference;
  failure?: "ambiguous" | "unresolved";
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

export function hashSectionContent(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

const hashString = hashSectionContent;

export interface TimedMediaChapter {
  id: string | number;
  title: string;
  startTime: number;
  endTime?: number;
}

export interface TimedTranscriptSegment {
  text: string;
  startTime?: number;
  endTime?: number;
  start?: number;
  end?: number;
  start_ms?: number;
  end_ms?: number;
}

function transcriptSegmentRange(segment: TimedTranscriptSegment): { start: number; end: number } {
  const start = segment.startTime ?? segment.start ?? ((segment.start_ms ?? 0) / 1000);
  const end = segment.endTime ?? segment.end ?? ((segment.end_ms ?? segment.start_ms ?? 0) / 1000);
  return { start, end: Math.max(start, end) };
}

/**
 * Build authoritative Assistant sections by intersecting chapter time ranges
 * with timestamped transcript segments. Empty/untranscribed chapters are
 * deliberately omitted so the # picker never promises unavailable context.
 */
export function buildMediaTranscriptSections(
  documentId: string,
  chapters: TimedMediaChapter[],
  segments: TimedTranscriptSegment[],
): SectionNode[] {
  if (!chapters.length || !segments.length) return [];

  return chapters.flatMap((chapter, index) => {
    const start = Math.max(0, chapter.startTime || 0);
    const end = chapter.endTime ?? chapters[index + 1]?.startTime ?? Number.POSITIVE_INFINITY;
    const overlapping = segments.filter((segment) => {
      const range = transcriptSegmentRange(segment);
      return range.end > start && range.start < end;
    });
    const content = overlapping
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(" ");
    if (!content) return [];

    return [{
      id: `media-section-${hashString(`${documentId}:${chapter.id}:${start}:${end}`)}`,
      title: chapter.title || `Chapter ${index + 1}`,
      level: 1,
      breadcrumb: ["Transcript"],
      preview: cleanPreview(content),
      content,
      children: [],
      parentId: null,
      source: "media-transcript" as const,
      hasAuthoritativeRange: false,
      documentId,
    }];
  });
}

export function normalizeContentValue(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(input.slice(0, 10000));
    } catch {
      return "";
    }
  }
  if (Array.isArray(input) && input.length > 0 && typeof input[0] === "number") {
    try {
      return String.fromCharCode(...(input as number[]).slice(0, 5000));
    } catch {
      return "";
    }
  }
  if (input && typeof (input as any).toString === "function") {
    const s = (input as any).toString();
    if (s !== "[object Object]" && typeof s === "string") return s;
  }
  return "";
}

/**
 * Hash of a document's canonical text, used as a section-tree cache key.
 * Samples across the whole string (not just a prefix) so any edit past the
 * first 2000 chars that leaves the length unchanged still invalidates the
 * cache. Striding keeps it O(2000) regardless of document size.
 */
export function hashContent(content: unknown): string {
  const str = normalizeContentValue(content);
  if (!str) return "empty";
  let h = 0;
  const samples = 2000;
  const stride = Math.max(1, Math.floor(str.length / samples));
  for (let i = 0; i < str.length; i += stride) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return `${str.length}-${h}`;
}

/** Hash of a PDF/EPUB outline, used as part of the section-tree cache key. */
export function hashOutline(outline: unknown): string {
  if (!outline) return "no-outline";
  try {
    const s = JSON.stringify(outline);
    let h = 0;
    for (let i = 0; i < Math.min(s.length, 2000); i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return `${s.length}-${h}`;
  } catch {
    return "outline";
  }
}

function cleanPreview(text: string): string {
  return stripMarkup(text).slice(0, 80);
}

function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[#*_`>[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      // Differentiate keyword headings by family so the heuristic tree carries
      // real depth (part < chapter < section). A flat tree can never reconcile
      // against a nested PDF/EPUB outline because the breadcrumb chain won't
      // match — see mergeOutlineWithHeuristics / findStructuralMatch.
      const keywordMatch = trimmed.match(/^(part|chapter|ch\.?|chap\.?|section)\s+(\d+|[IVX]+)\s*[.:-]?\s*(.+)?$/i);
      if (keywordMatch) {
        isHeading = true;
        const keyword = keywordMatch[1].toLowerCase();
        level = keyword === "part" ? 1 : keyword === "section" ? 3 : 2;
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

  // Normalize relative depth so keyword, Markdown, and HTML heading levels
  // share one scale: the shallowest heading present becomes level 1 and the
  // rest are remapped in order, preserving gaps. A doc whose headings come in
  // at levels {2,2,5} becomes {1,1,3}. This keeps tree-building logic simple
  // while honoring the relative hierarchy produced by every heading source.
  if (headings.length > 0) {
    const distinctLevels = [...new Set(headings.map((h) => h.level))].sort((a, b) => a - b);
    const remap = new Map<number, number>(distinctLevels.map((lvl, idx) => [lvl, idx + 1]));
    for (const h of headings) h.level = remap.get(h.level)!;
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
    }).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Same structural score (common when a title repeats in a table of
      // contents and again in the body): prefer the candidate whose range
      // carries the most body text. A TOC entry's "content" is just its title
      // plus the next few TOC lines, so it is far shorter than the real chapter.
      const aBody = stripMarkup((a.candidate.content ?? "").replace(a.candidate.title, "")).length;
      const bBody = stripMarkup((b.candidate.content ?? "").replace(b.candidate.title, "")).length;
      if (bBody !== aBody) return bBody - aBody;
      return (a.candidate.startChar ?? 0) - (b.candidate.startChar ?? 0);
    });

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
      body = `Section: ${breadcrumbStr}\n\n${stripMarkup(sec.content)}`;
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

/**
 * Human-readable reason for an unresolved section, used in the validation
 * message surfaced to the user when a `#` mention cannot be sent. Distinguishes
 * the three failure codes so the message is actionable instead of the generic
 * "stale or ambiguous" for every case.
 */
export function describeSectionDiagnostic(diagnostic: SectionContextDiagnostic): string {
  switch (diagnostic.code) {
    case "wrong-document":
      return `${diagnostic.label} belongs to a different document`;
    case "ambiguous":
      return diagnostic.candidateCount
        ? `${diagnostic.label} matched ${diagnostic.candidateCount} headings; narrow it down`
        : `${diagnostic.label} matched multiple headings; narrow it down`;
    default:
      return `${diagnostic.label} has no current document-text range`;
  }
}

function rangeIsCurrent(section: SectionNode, fullContent: string): boolean {
  if (!section.hasAuthoritativeRange) return false;
  const { startChar, endChar } = section;
  if (startChar === undefined || endChar === undefined || startChar < 0 || endChar <= startChar || endChar > fullContent.length) {
    return false;
  }
  const current = fullContent.slice(startChar, endChar).trim();
  if (current.length === 0) return false;
  if (current === section.content.trim()) return true;
  return stripMarkup(current) === stripMarkup(section.content);
}

function findStructuralMatch(
  section: SectionNode,
  available: SectionNode[]
): { match?: SectionNode; ambiguous: boolean; candidateCount: number } {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s:._-]+/g, " ").trim();
  const title = normalize(section.title);
  const breadcrumb = section.breadcrumb.map(normalize).join(" > ");
  const candidates = available.filter((candidate) =>
    candidate.hasAuthoritativeRange && normalize(candidate.title) === title
  );
  const breadcrumbMatches = candidates.filter(
    (candidate) => candidate.breadcrumb.map(normalize).join(" > ") === breadcrumb
  );
  if (breadcrumbMatches.length === 1) return { match: breadcrumbMatches[0], ambiguous: false, candidateCount: candidates.length };
  if (breadcrumbMatches.length > 1) return { ambiguous: true, candidateCount: candidates.length };
  return candidates.length === 1
    ? { match: candidates[0], ambiguous: false, candidateCount: candidates.length }
    : { ambiguous: candidates.length > 1, candidateCount: candidates.length };
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
  const cleanTitle = escapeRegExp(section.title.trim());
  const titlePattern = new RegExp(
    `(?:^\\s*(?:#{1,6}\\s*)?${cleanTitle}\\s*$|<h[1-6][^>]*>\\s*(?:<[^>]*>)*\\s*${cleanTitle}\\s*(?:<[^>]*>)*\\s*<\\/h[1-6]\\s*>)`,
    "gim"
  );
  const occurrences = [...fullContent.matchAll(titlePattern)];
  if (occurrences.length === 0) return undefined;

  const sameTitleOutlineNodes = available.filter((candidate) =>
    candidate.source === section.source && candidate.title.trim().toLowerCase() === section.title.trim().toLowerCase()
  );
  const occurrenceIndex = Math.max(0, sameTitleOutlineNodes.findIndex((candidate) => candidate.id === section.id));

  // Score every occurrence by the body text it would produce, then prefer the
  // occurrenceIndex slot only when that occurrence actually carries body text.
  // A title that also appears in a front-matter table of contents or on a title
  // page is matched first by position but yields no body, so it must lose to the
  // real chapter heading further down the document.
  const scored = occurrences.map((match) => {
    const range = computeOccurrenceRange(match, section, available, fullContent);
    const body = range.content.replace(match[0], "");
    const bodyLength = stripMarkup(body).length;
    return { match, ...range, bodyLength };
  });

  const primarySlot = Math.min(occurrenceIndex, occurrences.length - 1);
  const primary = scored[primarySlot];
  const titleLength = stripMarkup(section.title).length;
  const primaryHasBody = primary.bodyLength > Math.max(titleLength, 1);
  const chosen = primaryHasBody || scored.length === 1
    ? primary
    : scored.slice().sort((a, b) => b.bodyLength - a.bodyLength || a.start - b.start)[0];

  if (!chosen.content || stripMarkup(chosen.content.replace(chosen.match[0], "")).length === 0) return undefined;
  return {
    ...section,
    startChar: chosen.start,
    endChar: chosen.end,
    directEndChar: chosen.end,
    content: chosen.content,
    preview: cleanPreview(chosen.content.replace(chosen.match[0], "")),
    hasAuthoritativeRange: true,
  };
}

function computeOccurrenceRange(
  match: RegExpMatchArray,
  section: SectionNode,
  available: SectionNode[],
  fullContent: string,
): { start: number; end: number; content: string } {
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
  return { start, end, content };
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
  const contentHash = hashSectionContent(fullContent);
  const emptySource = (): SectionSourceReference => ({
    documentId,
    sectionIds: resolved.map((section) => section.id),
    labels: resolved.map(sectionLabel),
    contentHash,
    contextKey: hashSectionContent(`${documentId ?? "unknown"}:${contentHash}:${resolved.map((section) => section.id).join(",")}`),
    ranges: resolved.flatMap((section) =>
      section.startChar !== undefined && section.endChar !== undefined
        ? [{ start: section.startChar, end: section.endChar }]
        : []
    ),
  });

  for (const requested of selected) {
    const label = sectionLabel(requested);
    if (documentId && requested.documentId && requested.documentId !== documentId) {
      unresolved.push({ id: requested.id, label, reason: "belongs to a different document", code: "wrong-document" });
      continue;
    }
    const currentById = available.find((candidate) => candidate.id === requested.id);
    const structural = findStructuralMatch(requested, available);
    // Candidates in priority order: the current-tree node by id, the picked
    // node itself, the structural title+breadcrumb match, and finally the
    // outline-text recovery. Each is only kept if its range is current.
    const candidateChain: SectionNode[] = [];
    if (currentById && rangeIsCurrent(currentById, fullContent)) candidateChain.push(currentById);
    if (rangeIsCurrent(requested, fullContent) && (requested.id !== currentById?.id)) candidateChain.push(requested);
    if (structural.match && rangeIsCurrent(structural.match, fullContent)) candidateChain.push(structural.match);
    const recovered = recoverOutlineRangeFromText(requested, available, fullContent);
    if (recovered && rangeIsCurrent(recovered, fullContent)) candidateChain.push(recovered);

    // A range that resolves but yields no body (a table-of-contents line that
    // is immediately followed by the next table-of-contents line, or a
    // mis-resolved title-page hit) is not real context. Pick the first
    // candidate whose sliced body carries any prose beyond its own heading;
    // if every candidate is heading-only, the section is unresolved rather
    // than sent empty. Short sections (even a single sentence) still resolve.
    const candidate = candidateChain.find((node) => {
      if (node.startChar === undefined || node.endChar === undefined) return false;
      const body = stripMarkup(fullContent.slice(node.startChar, node.endChar).replace(requested.title, ""));
      return body.length > 0;
    });

    if (!candidate || !rangeIsCurrent(candidate, fullContent)) {
      unresolved.push({
        id: requested.id,
        label,
        reason: structural.ambiguous ? "matches multiple current document headings" : "has no current document-text range",
        code: structural.ambiguous ? "ambiguous" : "unresolved",
        candidateCount: structural.ambiguous ? structural.candidateCount : undefined,
      });
      continue;
    }
    resolved.push({ ...candidate, documentId: documentId ?? candidate.documentId });
  }

  if (unresolved.length > 0 || resolved.length !== selected.length) {
    return {
      ok: false,
      content: "",
      labels: resolved.map(sectionLabel),
      estimatedTokens: 0,
      truncated: false,
      sections: resolved,
      unresolved,
      source: emptySource(),
      failure: unresolved.some((item) => item.code === "ambiguous") ? "ambiguous" : "unresolved",
    };
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
    const raw = fullContent.slice(group.start, group.end).trim();
    const body = stripMarkup(raw);
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
    source: {
      documentId,
      sectionIds: resolved.map((section) => section.id),
      labels: resolved.map(sectionLabel),
      contentHash,
      contextKey: hashSectionContent(`${documentId ?? "unknown"}:${contentHash}:${resolved.map((section) => section.id).join(",")}`),
      ranges: groups.map((group) => ({ start: group.start, end: group.end })),
    },
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
    const flatOutline = flattenTree(finalTree);
    for (const node of flatOutline) {
      if ((node.source === "pdf-outline" || node.source === "epub-toc") && !node.content && content) {
        const recovered = recoverOutlineRangeFromText(node, flatOutline, content);
        if (recovered) {
          node.startChar = recovered.startChar;
          node.endChar = recovered.endChar;
          node.directEndChar = recovered.directEndChar;
          node.content = recovered.content;
          node.preview = recovered.preview;
          node.hasAuthoritativeRange = recovered.hasAuthoritativeRange;
        }
      }
    }
  } else {
    finalTree = heuristicTree;
  }

  const flat = flattenTree(finalTree);

  // Fallback for outline-less documents: a text-bearing document whose
  // heading/outline path yields fewer than two nodes (no headings, a bare
  // "Full Document" node, or a single-heading article) gets a paragraph-
  // boundary segmentation so `#` mentions are never empty for readable text.
  const hasText = content.trim().length > 0;
  if (hasText && flat.length < 2) {
    const segments = buildHeuristicParagraphSections(content);
    return { tree: segments, flat: segments };
  }

  return { tree: finalTree, flat };
}

export interface DocumentOutlineInput {
  pdfOutline?: Array<{ title: string; pageNumber?: number; items?: unknown[] }>;
  epubToc?: Array<{ label?: string; title?: string; href?: string; subitems?: unknown[] }>;
}

/**
 * Build the section tree for a document from a canonical text snapshot plus an
 * optional PDF/EPUB outline, sharing the exact cache used by the
 * `useDocumentSections` hook so both produce identical, id-stable trees.
 *
 * This exists for send-time retries: when a `#` mention is sent right after a
 * document opens, the hook's tree may still be built from partial/older text
 * while the freshly fetched canonical text has different offsets, so
 * resolution against the hook tree fails as "stale or ambiguous". Rebuilding
 * the tree from the same snapshot being resolved against makes the retry
 * succeed — the same outcome the user used to get by manually resending after
 * the hook caught up.
 */
export function buildSectionsSnapshot(
  documentId: string,
  content: string,
  outline?: DocumentOutlineInput,
): { tree: SectionNode[]; flat: SectionNode[] } {
  const docId = documentId || "unknown";
  const contentHash = hashContent(content);
  const outlineHash = `${hashOutline(outline?.pdfOutline)}:${hashOutline(outline?.epubToc)}`;
  const cacheKey = makeCacheKey(docId, contentHash, outlineHash);
  const cached = getCache(cacheKey);
  if (cached) return { tree: cached.tree, flat: cached.flat };

  let outlineNodes: SectionNode[] = [];
  if (outline?.pdfOutline && outline.pdfOutline.length > 0) {
    outlineNodes = convertPdfOutlineToSectionNodes(outline.pdfOutline as never, content);
  } else if (outline?.epubToc && outline.epubToc.length > 0) {
    outlineNodes = convertEpubTocToSectionNodes(outline.epubToc as never);
  }

  const { tree: builtTree, flat: builtFlat } = buildDocumentSections(
    content,
    outlineNodes.length > 0 ? outlineNodes : undefined,
  );
  const finalFlat = builtFlat.length > 0 ? builtFlat : flattenTree(builtTree);
  for (const node of finalFlat) node.documentId = documentId;
  setCache(cacheKey, { tree: builtTree, flat: finalFlat, hash: `${contentHash}:${outlineHash}` });
  return { tree: builtTree, flat: finalFlat };
}

/**
 * Opening words of a text block, used to label heuristic segments and the
 * live-selection mention entry.
 */
export function openingWords(text: string, maxWords = 6): string {
  const cleaned = stripMarkup(text).replace(/\s+/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
  const title = words.length > 0 ? words : "Untitled";
  return title.length > 60 ? `${title.slice(0, 57)}…` : title;
}

interface ParagraphRange {
  start: number;
  end: number;
  text: string;
}

function splitParagraphRanges(raw: string): ParagraphRange[] {
  const ranges: ParagraphRange[] = [];
  const blankLineSeparator = /\n\s*\n/g;
  // Use a fresh (non-global) regex for detection so the global regex used by
  // matchAll below starts from index 0 instead of the lastIndex left by test().
  const hasBlankLines = /\n\s*\n/.test(raw);

  if (hasBlankLines) {
    let cursor = 0;
    for (const match of raw.matchAll(blankLineSeparator)) {
      const text = raw.slice(cursor, match.index).trim();
      if (text) {
        const leading = raw.slice(cursor, match.index).length - raw.slice(cursor, match.index).trimStart().length;
        ranges.push({ start: cursor + leading, end: match.index, text });
      }
      cursor = match.index + match[0].length;
    }
    const tail = raw.slice(cursor).trim();
    if (tail) {
      const leading = raw.slice(cursor).length - raw.slice(cursor).trimStart().length;
      ranges.push({ start: cursor + leading, end: raw.length, text: tail });
    }
  } else {
    let cursor = 0;
    for (const match of raw.matchAll(/\n/g)) {
      const text = raw.slice(cursor, match.index).trim();
      if (text) {
        const leading = raw.slice(cursor, match.index).length - raw.slice(cursor, match.index).trimStart().length;
        ranges.push({ start: cursor + leading, end: match.index, text });
      }
      cursor = match.index + 1;
    }
    const tail = raw.slice(cursor).trim();
    if (tail) {
      const leading = raw.slice(cursor).length - raw.slice(cursor).trimStart().length;
      ranges.push({ start: cursor + leading, end: raw.length, text: tail });
    }
  }

  return ranges;
}

/**
 * Heuristic paragraph-boundary segmenter for documents without Markdown
 * headings or a PDF/EPUB outline. Groups consecutive paragraphs into segments
 * of roughly `targetChars`, labelling each segment by its opening words so the
 * mention popup can tell entries apart.
 */
export function buildHeuristicParagraphSections(
  content: string,
  options: { targetChars?: number; maxSegments?: number } = {}
): SectionNode[] {
  const { targetChars = 600, maxSegments = 200 } = options;
  if (!content || !content.trim()) return [];
  const ranges = splitParagraphRanges(content);
  if (ranges.length === 0) return [];

  const segments: SectionNode[] = [];
  let buffer: ParagraphRange[] = [];
  let bufferChars = 0;
  let index = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    if (segments.length >= maxSegments) {
      buffer = [];
      bufferChars = 0;
      return;
    }
    const first = buffer[0];
    const last = buffer[buffer.length - 1];
    const text = content.slice(first.start, last.end).trim();
    const title = openingWords(text, 6);
    const stable = `${title}-${first.start}-${index}`;
    segments.push({
      id: `section-${hashString(stable)}`,
      title,
      level: 1,
      breadcrumb: [],
      preview: cleanPreview(text),
      content: text,
      children: [],
      parentId: null,
      startChar: first.start,
      endChar: last.end,
      directEndChar: last.end,
      source: "text",
      hasAuthoritativeRange: true,
    });
    index += 1;
    buffer = [];
    bufferChars = 0;
  };

  for (const range of ranges) {
    if (buffer.length > 0 && bufferChars + range.text.length > targetChars) {
      flush();
    }
    buffer.push(range);
    bufferChars += range.text.length;
  }
  flush();

  return segments;
}

/**
 * A mention entry representing the user's live text selection. Carries exactly
 * the selected text as `content`; `source: "selection"` distinguishes it from
 * structural sections so the attach path can handle it specially.
 */
export function createSelectionSection(selection: string, documentId?: string): SectionNode {
  const content = selection.trim();
  return {
    id: `selection-${hashString(content.slice(0, 200))}`,
    title: openingWords(content, 8),
    level: 1,
    breadcrumb: [],
    preview: cleanPreview(content),
    content,
    children: [],
    parentId: null,
    startChar: 0,
    endChar: content.length,
    source: "selection",
    hasAuthoritativeRange: false,
    documentId,
  };
}

/**
 * Truncate text to a character budget at a paragraph/line boundary, appending
 * a truncation marker. Shared by the section-context and selection-context
 * paths so truncation is reported consistently.
 */
export function truncateTextToBudget(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  const marker = "\n\n[Selected text truncated due to context limit...]";
  const target = Math.max(1, maxChars - marker.length);
  const candidate = value.slice(0, target);
  const paragraph = candidate.lastIndexOf("\n\n");
  const line = candidate.lastIndexOf("\n");
  const boundary = Math.max(paragraph, line);
  const text = candidate.slice(0, boundary > target * 0.6 ? boundary : target).trimEnd();
  return { text: text + marker, truncated: true };
}

/**
 * Build the canonical context string for one or more selection mentions,
 * attaching exactly the selected text and truncating to the budget when
 * needed.
 */
export function buildSelectionFocusedContext(
  selections: SectionNode[],
  options: { maxTokens?: number } = {}
): { content: string; truncated: boolean; labels: string[] } {
  const { maxTokens = 4000 } = options;
  const maxChars = Math.max(256, Math.floor(maxTokens * 4 * 0.7));
  const blocks: string[] = [];
  const labels: string[] = [];
  let truncated = false;
  let used = 0;

  for (const node of selections) {
    labels.push(node.title);
    const remaining = maxChars - used - 64;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const { text, truncated: wasTruncated } = truncateTextToBudget(node.content, remaining);
    truncated ||= wasTruncated;
    const block = `Selected text: ${node.title}\n[Selection]\n${text}`;
    blocks.push(block);
    used += block.length;
    if (used >= maxChars) break;
  }

  return { content: blocks.join("\n\n---\n\n"), truncated, labels };
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
