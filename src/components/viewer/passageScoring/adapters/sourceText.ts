/**
 * Best-effort source text for rendered-source anchors.
 *
 * Markdown/plain text use the source verbatim. HTML is reduced to readable
 * text (scripts/styles/controls removed) so an offset is derived from content,
 * not from a generated DOM child index. A missing/unusable source is `null`;
 * adapters then fall back to a quote digest anchor.
 */

export function buildRenderedSourceText(
  content: string | null | undefined,
  kind: "html" | "markdown" | "text"
): string | null {
  if (!content) return null;
  if (kind === "markdown" || kind === "text") return content;
  const withoutNonContent = content
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ");
  return withoutNonContent.trim() || null;
}
