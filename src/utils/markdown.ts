/**
 * Render Markdown text to HTML
 * Supports: headers, lists, tables, code blocks, blockquotes, links, bold, italic, etc.
 */

import { latexToHTML } from "./mathOcr";

export interface RenderMarkdownOptions {
  /** Document ID for resolving bundle images */
  docId?: string;
  /** Map of original image paths to stored filenames */
  imageManifest?: Record<string, string>;
}

/**
 * Resolve a relative image path to a bundle storage URL
 */
function resolveImagePath(
  path: string,
  docId?: string,
  imageManifest?: Record<string, string>
): string {
  // Skip if already absolute URL
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path;
  }

  // Skip if already a bundle URL or blob
  if (path.startsWith('/api/documents/') || path.startsWith('blob:')) {
    return path;
  }

  // If we have a docId, resolve to bundle URL
  if (docId) {
    let cleanPath = path;

    if (cleanPath.startsWith('./')) {
      cleanPath = cleanPath.slice(2);
    }

    // Remove leading ../ if present (use just the filename)
    if (cleanPath.startsWith('../')) {
      const parts = cleanPath.split('/');
      cleanPath = parts[parts.length - 1];
    }

    const storedName = imageManifest?.[path] || imageManifest?.[cleanPath];
    const pathToUse = storedName || cleanPath;

    // URL-encode the path for special characters
    const encodedPath = encodeURI(pathToUse);

    return `/api/documents/${docId}/images/${encodedPath}`;
  }

  return path;
}

const CODE_BLOCK_RE = /```([\w]*)\n?([\s\S]*?)```/g;
const DISPLAY_LATEX_BRACKET_RE = /\\\[([\s\S]*?)\\\]/g;
const DISPLAY_LATEX_DOLLAR_RE = /\$\$([\s\S]*?)\$\$/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const INLINE_LATEX_PAREN_RE = /\\\((.+?)\\\)/g;
const INLINE_LATEX_DOLLAR_RE = /(^|[^\\])\$([^$\n]+?)\$/g;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const BOLD_RE = /\*\*(.+?)\*\*/g;
const ITALIC_UNDERSCORE_RE = /\b_(.+?)_\b/g;
const ITALIC_ASTERISK_RE = /\*([^*]+)\*/g;
const LIKELY_MATH_RE = /\\[a-zA-Z]+|[=^_{}]|[+\-*/<>]|[α-ωΑ-Ω∫∑∏√∞±×÷≈≠≤≥]/;

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/;
const UNORDERED_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+\.\s+(.*)$/;
const HR_RE = /^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function hashString(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return h >>> 0;
}

const MAX_FULL_CACHE = 64;
const fullCache = new Map<string, string>();

const MAX_INLINE_CACHE = 1024;
const inlineCache = new Map<string, string>();

function getManifestKey(manifest?: Record<string, string>): string {
  if (!manifest) return "";
  const keys = Object.keys(manifest);
  if (keys.length === 0) return "";
  if (keys.length > 50) return String(keys.length) + ":" + hashString(JSON.stringify(manifest).slice(0, 2000));
  return JSON.stringify(manifest);
}

function getFullCacheKey(text: string, docId?: string, manifest?: Record<string, string>): string {
  return `${text.length}:${hashString(text.slice(0, 500) + text.slice(-500))}:${docId ?? ""}:${getManifestKey(manifest).length > 200 ? hashString(getManifestKey(manifest)) : getManifestKey(manifest)}`;
}

function escapeHtmlFast(value: string): string {
  if (!value) return "";
  let out = "";
  let last = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    let esc = "";
    if (c === "&") esc = "&amp;";
    else if (c === "<") esc = "&lt;";
    else if (c === ">") esc = "&gt;";
    else if (c === '"') esc = "&quot;";
    else if (c === "'") esc = "&#39;";
    else continue;
    out += value.slice(last, i) + esc;
    last = i + 1;
  }
  return last === 0 ? value : out + value.slice(last);
}

function formatInlineCore(
  value: string,
  docId: string | undefined,
  imageManifest: Record<string, string> | undefined
): string {
  const cacheKey = `${docId ?? ""}|${value.length > 200 ? hashString(value) + ":" + value.slice(0, 80) : value}`;
  if (!docId && !imageManifest) {
    const cached = inlineCache.get(cacheKey);
    if (cached !== undefined) return cached;
  }

  let formatted = value;
  const inlineCodeSegments: string[] = [];
  formatted = formatted.replace(INLINE_CODE_RE, (_match, code) => {
    const index = inlineCodeSegments.length;
    inlineCodeSegments.push(
      `<code class="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">${code}</code>`
    );
    return `@@INLINECODE_${index}@@`;
  });

  formatted = formatted.replace(
    IMAGE_RE,
    (_match, alt, path) => {
      const resolvedPath = resolveImagePath(path, docId, imageManifest);
      return `<img class="max-w-full h-auto my-2 rounded border border-border" src="${resolvedPath}" alt="${alt}" />`;
    }
  );

  formatted = formatted.replace(INLINE_LATEX_PAREN_RE, (_match, expression) => {
    return latexToHTML(expression.trim());
  });

  formatted = formatted.replace(INLINE_LATEX_DOLLAR_RE, (match, prefix, expression) => {
    const expr = expression.trim();
    if (!LIKELY_MATH_RE.test(expr)) return match;
    return `${prefix}${latexToHTML(expr)}`;
  });

  formatted = formatted.replace(LINK_RE, '<a class="text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid" href="$2" target="_blank" rel="noreferrer">$1</a>');
  formatted = formatted.replace(BOLD_RE, "<strong>$1</strong>");
  formatted = formatted.replace(ITALIC_UNDERSCORE_RE, "<em>$1</em>");
  formatted = formatted.replace(ITALIC_ASTERISK_RE, "<em>$1</em>");

  for (let i = 0; i < inlineCodeSegments.length; i++) {
    formatted = formatted.replace(`@@INLINECODE_${i}@@`, inlineCodeSegments[i]);
  }

  if (!docId && !imageManifest && inlineCache.size < MAX_INLINE_CACHE * 2) {
    if (inlineCache.size >= MAX_INLINE_CACHE) {
      const firstKey = inlineCache.keys().next().value;
      if (firstKey) inlineCache.delete(firstKey);
    }
    inlineCache.set(cacheKey, formatted);
  }

  return formatted;
}

export function renderMarkdown(text: string, options?: RenderMarkdownOptions): string {
  if (!text) return "";

  const cacheKey = getFullCacheKey(text, options?.docId, options?.imageManifest);
  const hit = fullCache.get(cacheKey);
  if (hit !== undefined) {
    fullCache.delete(cacheKey);
    fullCache.set(cacheKey, hit);
    return hit;
  }

  const codeBlocks: string[] = [];
  const escaped = escapeHtmlFast(text);
  const withPlaceholders = escaped.replace(CODE_BLOCK_RE, (_match, lang, code) => {
    const index = codeBlocks.length;
    const trimmed = code.trim();
    const langClass = lang ? ` data-language="${lang}"` : '';
    codeBlocks.push(
      `<pre class="mt-2 mb-2 overflow-x-auto rounded bg-muted p-3 text-sm"${langClass}><code>${trimmed}</code></pre>`
    );
    return `@@CODEBLOCK_${index}@@`;
  });

  const renderDisplayLatex = (value: string) =>
    value
      .replace(DISPLAY_LATEX_BRACKET_RE, (_match, expression) => {
        const rendered = latexToHTML(expression.trim(), { displayMode: true });
        return `<div class="math-expression-block">${rendered}</div>`;
      })
      .replace(DISPLAY_LATEX_DOLLAR_RE, (_match, expression) => {
        const rendered = latexToHTML(expression.trim(), { displayMode: true });
        return `<div class="math-expression-block">${rendered}</div>`;
      });

  const formatInline = (value: string) => formatInlineCore(value, options?.docId, options?.imageManifest);

  const withDisplayMath = renderDisplayLatex(withPlaceholders);
  const lines = withDisplayMath.split(/\r?\n/);
  let html = "";
  let listType: "ul" | "ol" | null = null;
  let blockquoteLines: string[] = [];

  const isTableSeparator = (line: string) => TABLE_SEPARATOR_RE.test(line);
  const hasTablePipe = (line: string) => line.includes("|");

  const flushList = () => {
    if (listType) {
      html += listType === "ul" ? "</ul>" : "</ol>";
      listType = null;
    }
  };

  const flushBlockquote = () => {
    if (blockquoteLines.length > 0) {
      const content = blockquoteLines.map(formatInline).join("<br>");
      html += `<blockquote class="border-l-4 border-primary/30 pl-4 my-2 italic text-muted-foreground">${content}</blockquote>`;
      blockquoteLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = HEADING_RE.exec(line);
    const blockquoteMatch = BLOCKQUOTE_RE.exec(line);
    const unorderedMatch = UNORDERED_RE.exec(line);
    const orderedMatch = ORDERED_RE.exec(line);
    const hrMatch = HR_RE.exec(line);

    if (headingMatch) {
      flushList();
      flushBlockquote();
      const level = headingMatch[1].length;
      const content = formatInline(headingMatch[2]);
      const sizeClass =
        level === 1 ? "text-xl font-bold" :
        level === 2 ? "text-lg font-semibold" :
        level === 3 ? "text-base font-semibold" :
        "text-sm font-semibold";
      html += `<h${level} class="${sizeClass} mt-4 mb-2">${content}</h${level}>`;
      continue;
    }

    if (hrMatch) {
      flushList();
      flushBlockquote();
      html += '<hr class="my-4 border-border" />';
      continue;
    }

    if (blockquoteMatch) {
      flushList();
      blockquoteLines.push(blockquoteMatch[1]);
      continue;
    }

    if (hasTablePipe(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      flushBlockquote();
      const headerLine = line;
      i += 2; // Skip separator line
      const rows: string[] = [];
      while (i < lines.length && hasTablePipe(lines[i]) && lines[i].trim() !== "") {
        rows.push(lines[i]);
        i += 1;
      }
      i -= 1;

      const parseRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => formatInline(cell.trim()));

      const headerCells = parseRow(headerLine);
      const bodyRows = rows.map(parseRow);

      html += '<div class="overflow-x-auto my-2"><table class="w-full border-collapse text-sm">';
      html += "<thead><tr>";
      headerCells.forEach((cell) => {
        html += `<th class="border border-border bg-muted/50 px-3 py-2 text-left font-semibold">${cell}</th>`;
      });
      html += "</tr></thead>";
      html += "<tbody>";
      bodyRows.forEach((cells) => {
        html += "<tr>";
        cells.forEach((cell) => {
          html += `<td class="border border-border px-3 py-2 align-top">${cell}</td>`;
        });
        html += "</tr>";
      });
      html += "</tbody></table></div>";
      continue;
    }

    if (unorderedMatch) {
      flushBlockquote();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        html += '<ul class="list-disc pl-6 my-2 space-y-1">';
      }
      html += `<li>${formatInline(unorderedMatch[1])}</li>`;
      continue;
    }

    if (orderedMatch) {
      flushBlockquote();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        html += '<ol class="list-decimal pl-6 my-2 space-y-1">';
      }
      html += `<li>${formatInline(orderedMatch[1])}</li>`;
      continue;
    }

    if (line.trim() === "") {
      flushList();
      flushBlockquote();
      continue;
    }

    flushList();
    flushBlockquote();
    html += `<p class="my-2">${formatInline(line)}</p>`;
  }

  flushList();
  flushBlockquote();

  codeBlocks.forEach((block, index) => {
    html = html.replace(`@@CODEBLOCK_${index}@@`, block);
  });

  if (fullCache.size >= MAX_FULL_CACHE) {
    const first = fullCache.keys().next().value;
    if (first) fullCache.delete(first);
  }
  fullCache.set(cacheKey, html);

  return html;
}

export function clearMarkdownCache(): void {
  fullCache.clear();
  inlineCache.clear();
}
