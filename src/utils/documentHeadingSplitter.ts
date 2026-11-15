export interface DocumentHeadingChunk {
  index: number;
  heading: string;
  content: string;
  charLength: number;
}

function stripHtmlTags(raw: string): string {
  return raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Deterministically split Markdown or HTML document content along Chapter / H2
 * (or fallback H1) heading boundaries while preserving any non-empty preamble.
 */
export function splitDocumentByHeadings(
  rawContent: string,
  options?: { minChunkChars?: number }
): DocumentHeadingChunk[] {
  const minChunkChars = options?.minChunkChars ?? 0;
  const trimmed = rawContent.trim();
  if (!trimmed) {
    return [];
  }

  // Prefer Markdown H2 (`## `), then Markdown H1 (`# `)
  const mdH2Matches = Array.from(rawContent.matchAll(/^##\s+(.+)$/gm));
  const mdMatches =
    mdH2Matches.length > 0
      ? mdH2Matches
      : Array.from(rawContent.matchAll(/^#\s+(.+)$/gm));

  if (mdMatches.length > 0) {
    return buildChunksFromMatches(
      rawContent,
      mdMatches.map((m) => ({
        index: m.index ?? 0,
        heading: m[1].trim(),
      })),
      minChunkChars
    );
  }

  // Next, try HTML <h2>, then <h1>
  const htmlH2Matches = Array.from(
    rawContent.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)
  );
  const htmlMatches =
    htmlH2Matches.length > 0
      ? htmlH2Matches
      : Array.from(rawContent.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi));

  if (htmlMatches.length > 0) {
    return buildChunksFromMatches(
      rawContent,
      htmlMatches.map((m) => ({
        index: m.index ?? 0,
        heading: stripHtmlTags(m[1]) || "Section",
      })),
      minChunkChars
    );
  }

  return [
    {
      index: 0,
      heading: "Full Document",
      content: trimmed,
      charLength: trimmed.length,
    },
  ];
}

function buildChunksFromMatches(
  rawContent: string,
  matches: Array<{ index: number; heading: string }>,
  minChunkChars: number
): DocumentHeadingChunk[] {
  const rawSections: Array<{ heading: string; content: string }> = [];

  const preamble = rawContent.slice(0, matches[0].index).trim();
  if (preamble.length > 0) {
    rawSections.push({ heading: "Introduction", content: preamble });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : rawContent.length;
    const body = rawContent.slice(start, end).trim();
    if (body.length > 0) {
      rawSections.push({
        heading: matches[i].heading || `Section ${i + 1}`,
        content: body,
      });
    }
  }

  // Merge tiny trailing/adjacent chunks only if minChunkChars > 0
  const merged: Array<{ heading: string; content: string }> = [];
  for (const section of rawSections) {
    if (
      minChunkChars > 0 &&
      merged.length > 0 &&
      section.content.length < minChunkChars
    ) {
      const prev = merged[merged.length - 1];
      prev.content = `${prev.content}\n\n${section.content}`;
    } else {
      merged.push({ ...section });
    }
  }

  return merged.map((sec, idx) => ({
    index: idx,
    heading: sec.heading,
    content: sec.content,
    charLength: sec.content.length,
  }));
}
