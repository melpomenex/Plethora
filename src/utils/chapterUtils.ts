/**
 * Chapter Extraction and Detection Utilities
 * 
 * Provides utilities for:
 * - Extracting chapters from document content
 * - Detecting chapter references in user queries
 * - Retrieving specific chapter content for Q&A
 */

export interface Chapter {
  number: number;
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

export interface ChapterReference {
  type: 'chapter' | 'section' | 'part' | 'appendix';
  number: number;
  title?: string;
  raw: string;
}

/**
 * Detect if a user query references a specific chapter
 */
export function detectChapterReference(query: string): ChapterReference | null {
  // Normalize the query
  const normalizedQuery = query.toLowerCase().trim();
  
  const chapterMatch = normalizedQuery.match(/(?:chapter|ch\.?|chap\.?)\s*(\d+|[\w-]+)/i);
  if (chapterMatch) {
    const number = parseChapterNumber(chapterMatch[1]);
    return {
      type: 'chapter',
      number,
      raw: chapterMatch[0],
    };
  }
  
  const sectionMatch = normalizedQuery.match(/(?:section|part)\s*(\d+|[\w-]+)/i);
  if (sectionMatch) {
    const number = parseChapterNumber(sectionMatch[1]);
    return {
      type: 'section',
      number,
      raw: sectionMatch[0],
    };
  }
  
  const appendixMatch = normalizedQuery.match(/appendix\s*([A-Z]|\d+)/i);
  if (appendixMatch) {
    return {
      type: 'appendix',
      number: appendixMatch[1].toUpperCase().charCodeAt(0) - 64, // A=1, B=2, etc.
      raw: appendixMatch[0],
    };
  }
  
  return null;
}

/**
 * Parse chapter number from string (handles digits and roman numerals)
 */
function parseChapterNumber(numStr: string): number {
  const romanMatch = numStr.match(/^[IVX]+$/i);
  if (romanMatch) {
    return romanToInt(numStr.toUpperCase());
  }
  
  const wordNumbers: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12,
  };
  
  const lowerNum = numStr.toLowerCase();
  if (wordNumbers[lowerNum]) {
    return wordNumbers[lowerNum];
  }
  
  // Default to parsing as integer
  const parsed = parseInt(numStr, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Convert roman numeral to integer
 */
function romanToInt(roman: string): number {
  const values: Record<string, number> = {
    'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000
  };
  
  let result = 0;
  for (let i = 0; i < roman.length; i++) {
    const current = values[roman[i]];
    const next = values[roman[i + 1]];
    
    if (next && current < next) {
      result -= current;
    } else {
      result += current;
    }
  }
  
  return result;
}

/**
 * Extract all chapters from document content.
 *
 * This is a pure function (no caching) so callers that want a fresh, mutable
 * copy are unaffected. The helper functions below (getChapterByNumber, etc.)
 * route through `getChaptersCached`, which keeps a single-entry cache keyed by
 * the content string so a repeated Q&A flow over the same document parses the
 * document only once instead of re-splitting + re-running the header regexes
 * on every call.
 */
export function extractChapters(content: string): Chapter[] {
  return parseChapters(content);
}

/**
 * Single-entry chapter cache. The same document is queried repeatedly during a
 * Q&A flow (getChapterByNumber, getChapterWithContext, getChapterTitles,
 * hasChapters, formatChapterList, buildChapterQAContext all call
 * extractChapters), so caching the most-recently-parsed document avoids
 * re-splitting it into lines and re-running parseChapterHeader over every line
 * on each call. A single entry is sufficient because chapter queries are
 * localized to one document at a time; switching documents simply evicts it.
 */
let cachedChaptersFor: { content: string; chapters: Chapter[] } | null = null;

/**
 * Returns the cached Chapter[] for `content`, parsing only on a cache miss.
 * The returned array is the cached reference (do not mutate); callers that
 * need to mutate should copy it first.
 */
function getChaptersCached(content: string): Chapter[] {
  if (cachedChaptersFor && cachedChaptersFor.content === content) {
    return cachedChaptersFor.chapters;
  }
  const chapters = parseChapters(content);
  cachedChaptersFor = { content, chapters };
  return chapters;
}

/**
 * Invalidate the chapter cache (e.g. when a document's content changes).
 */
export function invalidateChapterCache(): void {
  cachedChaptersFor = null;
}

/**
 * Core parser shared by the cached and pure entry points.
 */
function parseChapters(content: string): Chapter[] {
  const chapters: Chapter[] = [];
  const lines = content.split('\n');

  let currentChapter: Partial<Chapter> | null = null;
  let currentContent: string[] = [];
  let chapterStartIndex = 0;
  let lineIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const chapterInfo = parseChapterHeader(line);

    if (chapterInfo) {
      if (currentChapter && currentChapter.number !== undefined) {
        chapters.push({
          number: currentChapter.number,
          title: currentChapter.title || `Chapter ${currentChapter.number}`,
          content: currentContent.join('\n').trim(),
          startIndex: chapterStartIndex,
          endIndex: lineIndex,
        });
      }

      currentChapter = {
        number: chapterInfo.number,
        title: chapterInfo.title,
      };
      currentContent = [];
      chapterStartIndex = lineIndex;
    } else if (currentChapter) {
      currentContent.push(line);
    }

    lineIndex += line.length + 1; // +1 for newline
  }

  if (currentChapter && currentChapter.number !== undefined) {
    chapters.push({
      number: currentChapter.number,
      title: currentChapter.title || `Chapter ${currentChapter.number}`,
      content: currentContent.join('\n').trim(),
      startIndex: chapterStartIndex,
      endIndex: content.length,
    });
  }

  // If no chapters found, try alternative patterns
  if (chapters.length === 0) {
    return extractChaptersByPattern(content);
  }

  return chapters;
}

/**
 * Parse a line to see if it's a chapter header
 */
function parseChapterHeader(line: string): { number: number; title?: string } | null {
  const trimmed = line.trim();
  
  // Pattern: "Chapter 1: Title" or "Chapter 1 - Title"
  const match1 = trimmed.match(/^(?:chapter|ch\.?|chap\.?)\s*(\d+|[IVX]+)\s*[.:-]?\s*(.+)?$/i);
  if (match1) {
    return {
      number: parseChapterNumber(match1[1]),
      title: match1[2]?.trim() || undefined,
    };
  }
  
  // Pattern: "CHAPTER ONE" - word numbers
  const match2 = trimmed.match(/^(?:chapter|ch\.?|chap\.?)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s*[.:-]?\s*(.+)?$/i);
  if (match2) {
    return {
      number: parseChapterNumber(match2[1]),
      title: match2[2]?.trim() || undefined,
    };
  }
  
  // Pattern: Markdown header "# Chapter 1" or "## 1. Title"
  const match3 = trimmed.match(/^#{1,3}\s*(?:chapter\s*)?(\d+|[IVX]+)[.:-]?\s*(.+)?$/i);
  if (match3) {
    return {
      number: parseChapterNumber(match3[1]),
      title: match3[2]?.trim() || undefined,
    };
  }
  
  // Pattern: "1. Title" at start of line (only if it looks like a chapter)
  const match4 = trimmed.match(/^(\d+)[.:-]\s+(.+)$/);
  if (match4 && looksLikeChapterTitle(match4[2])) {
    return {
      number: parseInt(match4[1], 10),
      title: match4[2].trim(),
    };
  }
  
  return null;
}

/**
 * Precompiled regex for the chapter-title indicators. Collapses the previous
 * 18-element `.some(indicator => lower.includes(indicator))` scan into a single
 * regex test per line.
 */
const chapterIndicatorRegex = /\b(chapter|introduction|overview|summary|conclusion|background|method|results|discussion|analysis|the|of|and|in|for|with|on|to)\b/i;

/**
 * Check if a title looks like a chapter title (heuristic)
 */
function looksLikeChapterTitle(title: string): boolean {
  return chapterIndicatorRegex.test(title) ||
         // Or if it's relatively short (likely a heading)
         title.length < 100;
}

/**
 * Extract chapters using regex patterns as fallback
 */
function extractChaptersByPattern(content: string): Chapter[] {
  const chapters: Chapter[] = [];
  
  // Use the main chapter regex to find all chapter positions
  const chapterRegex = /^(?:chapter|ch\.?|chap\.?)\s*(\d+|[IVX]+)[.:-]?\s*(.+?)?$/gim;
  
  let match;
  let lastIndex = 0;
  let lastNumber = 0;
  let lastTitle = '';
  
  while ((match = chapterRegex.exec(content)) !== null) {
    if (lastIndex > 0) {
      const chapterContent = content.slice(lastIndex, match.index).trim();
      if (chapterContent.length > 100) { // Minimum content threshold
        chapters.push({
          number: lastNumber,
          title: lastTitle || `Chapter ${lastNumber}`,
          content: chapterContent,
          startIndex: lastIndex,
          endIndex: match.index,
        });
      }
    }
    
    lastNumber = parseChapterNumber(match[1]);
    lastTitle = match[2]?.trim() || '';
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex > 0 && lastNumber > 0) {
    const finalContent = content.slice(lastIndex).trim();
    if (finalContent.length > 100) {
      chapters.push({
        number: lastNumber,
        title: lastTitle || `Chapter ${lastNumber}`,
        content: finalContent,
        startIndex: lastIndex,
        endIndex: content.length,
      });
    }
  }
  
  return chapters;
}

/**
 * Get a specific chapter by number.
 *
 * Accepts an optional precomputed `chapters` array (e.g. from a prior
 * extractChapters/getChaptersCached call) so callers that use multiple helpers
 * on the same document can parse once and reuse the result. When omitted, the
 * cached parse for `content` is used (or a fresh parse on cache miss).
 */
export function getChapterByNumber(
  content: string,
  chapterNumber: number,
  chapters?: Chapter[]
): Chapter | null {
  const list = chapters ?? getChaptersCached(content);
  return list.find(ch => ch.number === chapterNumber) || null;
}

/**
 * Get chapter content with context (previous/next chapters summary)
 * Useful for providing context to LLM without feeding entire book
 */
export function getChapterWithContext(
  content: string,
  chapterNumber: number,
  includeAdjacentSummaries: boolean = true,
  chapters?: Chapter[]
): {
  targetChapter: Chapter;
  contextInfo: string;
  estimatedTokens: number;
} | null {
  const list = chapters ?? getChaptersCached(content);
  const targetIndex = list.findIndex(ch => ch.number === chapterNumber);
  
  if (targetIndex === -1) {
    return null;
  }
  
  const targetChapter = list[targetIndex];
  let contextInfo = '';

  if (includeAdjacentSummaries) {
    // Add previous chapter summary
    if (targetIndex > 0) {
      const prev = list[targetIndex - 1];
      contextInfo += `Previous Chapter (${prev.number}): ${prev.title}\n`;
      contextInfo += `Preview: ${getChapterPreview(prev.content, 200)}\n\n`;
    }

    // Add next chapter title
    if (targetIndex < list.length - 1) {
      const next = list[targetIndex + 1];
      contextInfo += `Next Chapter (${next.number}): ${next.title}\n\n`;
    }

    // Add book structure context
    contextInfo += `Book Structure: This is Chapter ${targetChapter.number} of ${list.length} chapters.\n`;
  }
  
  // Estimate tokens (rough approximation: 4 chars per token)
  const estimatedTokens = Math.ceil((targetChapter.content.length + contextInfo.length) / 4);
  
  return {
    targetChapter,
    contextInfo,
    estimatedTokens,
  };
}

/**
 * Get a preview of chapter content (first N characters)
 */
function getChapterPreview(content: string, maxLength: number): string {
  const trimmed = content.slice(0, maxLength).trim();
  return trimmed.length < content.length ? trimmed + '...' : trimmed;
}

/**
 * Build optimized context for chapter-specific Q&A
 * Returns content that fits within token limits
 */
export function buildChapterQAContext(
  documentTitle: string,
  content: string,
  chapterNumber: number,
  maxTokens: number = 4000
): string {
  const result = getChapterWithContext(content, chapterNumber, true);

  if (!result) {
    // Fallback: if chapter not found, return truncated full content
    const maxChars = maxTokens * 4;
    return content.slice(0, maxChars);
  }

  const { targetChapter, contextInfo, estimatedTokens } = result;

  // If chapter fits within token limit, return with context
  if (estimatedTokens <= maxTokens * 0.8) { // 80% buffer for response
    return `Document: ${documentTitle}\n\n${contextInfo}---\n\nChapter ${targetChapter.number}: ${targetChapter.title}\n\n${targetChapter.content}`;
  }

  // If chapter is too long, truncate intelligently
  const maxChars = Math.floor(maxTokens * 4 * 0.7); // Leave room for context
  const truncatedContent = targetChapter.content.slice(0, maxChars);

  return `Document: ${documentTitle}\n\n${contextInfo}---\n\nChapter ${targetChapter.number}: ${targetChapter.title}\n\n${truncatedContent}\n\n[Content truncated due to length...]`;
}

/**
 * Get all chapter titles for a document (for displaying in UI)
 */
export function getChapterTitles(content: string): Array<{ number: number; title: string }> {
  const chapters = getChaptersCached(content);
  return chapters.map(ch => ({ number: ch.number, title: ch.title }));
}

/**
 * Check if document has extractable chapters
 */
export function hasChapters(content: string): boolean {
  return getChaptersCached(content).length > 0;
}

/**
 * Format chapter list for display in prompts
 */
export function formatChapterList(content: string): string {
  const chapters = getChapterTitles(content);

  if (chapters.length === 0) {
    return 'No chapters detected in this document.';
  }

  return chapters
    .map(ch => `Chapter ${ch.number}: ${ch.title}`)
    .join('\n');
}

export interface DocumentSection {
  id: string;
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Extract all sections/headings from document content dynamically.
 * Fallbacks to markdown headers and outline numbers if no chapters are detected.
 */
export function extractSections(content: string): DocumentSection[] {
  if (!content) return [];

  const sections: DocumentSection[] = [];
  const lines = content.split('\n');
  
  interface HeadingInfo {
    title: string;
    lineIndex: number;
    charIndex: number;
  }
  
  const headings: HeadingInfo[] = [];
  let charIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    let isHeading = false;
    let title = "";
    
    // Pattern 1: Markdown Heading
    const markdownMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (markdownMatch) {
      isHeading = true;
      title = markdownMatch[2].trim();
    } 
    // Pattern 2: Chapter outline (e.g., Chapter 1: Introduction)
    else {
      const chapterMatch = trimmed.match(/^(?:chapter|ch\.?|chap\.?|section|part)\s+(\d+|[IVX]+)\s*[.:-]?\s*(.+)?$/i);
      if (chapterMatch) {
        isHeading = true;
        title = trimmed;
      }
      // Pattern 3: Numbered headings (e.g., 1. Introduction or 1.2.3 Setup)
      else {
        const numericMatch = trimmed.match(/^(\d+(?:\.\d+)*)\.?\s+([A-Z].+)$/);
        if (numericMatch && numericMatch[2].length < 100) {
          isHeading = true;
          title = trimmed;
        }
      }
    }
    
    if (isHeading && title) {
      headings.push({
        title,
        lineIndex: i,
        charIndex,
      });
    }
    
    charIndex += line.length + 1; // +1 for newline
  }
  
  if (headings.length === 0) {
    sections.push({
      id: "section-0",
      title: "Full Document",
      content: content.trim(),
      startIndex: 0,
      endIndex: content.length,
    });
    return sections;
  }
  
  // Handle preamble text before first heading
  const firstHeadingCharIndex = headings[0].charIndex;
  if (firstHeadingCharIndex > 100) {
    const preambleContent = content.slice(0, firstHeadingCharIndex).trim();
    if (preambleContent.length > 0) {
      sections.push({
        id: "section-0",
        title: "Preamble / Introduction",
        content: preambleContent,
        startIndex: 0,
        endIndex: firstHeadingCharIndex,
      });
    }
  }
  
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const next = headings[i + 1];
    const sectionStart = current.charIndex;
    const sectionEnd = next ? next.charIndex : content.length;
    
    const sectionContent = content.slice(sectionStart, sectionEnd).trim();
    
    sections.push({
      id: `section-${sections.length}`,
      title: current.title,
      content: sectionContent,
      startIndex: sectionStart,
      endIndex: sectionEnd,
    });
  }
  
  return sections;
}
