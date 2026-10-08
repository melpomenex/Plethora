/**
 * rssArticleDocument — backing library document for an RSS article.
 *
 * Extracts, highlights, flashcards, and Learn-this provenance all attach
 * to a library document, but RSS articles live outside the library. This
 * module implements the find-or-create pattern (first established in
 * RSSScrollMode's extract flow): the article's link is the stable identity
 * (`filePath`), so repeated selections reuse one document instead of
 * spawning duplicates.
 */

import { createDocument, updateDocumentContent } from "../../api/documents";
import type { Document } from "../../types/document";
import type { Feed, FeedItem } from "../../api/rss";

export interface RssArticleDocumentDeps {
  documents: Document[];
  addDocument: (doc: Document) => void;
  updateDocument: (id: string, updates: Partial<Document>) => void;
}

/**
 * Return the library document id backing an RSS article, creating the
 * document (and syncing its content) on first use. Throws on backend
 * failure so callers can toast.
 */
export async function ensureRssArticleDocument(
  feed: Feed | null | undefined,
  item: FeedItem,
  deps: RssArticleDocumentDeps,
): Promise<string> {
  const rssContent = item.fullContent || item.content || item.description || "";
  const rssLink = item.link || `rss:${item.id}`;
  const existing = deps.documents.find((doc) => doc.filePath === rssLink);
  let docId = existing?.id;

  if (!docId) {
    const created = await createDocument(
      item.title || feed?.title || "RSS Article",
      rssLink,
      "html",
    );
    deps.addDocument(created);
    docId = created.id;
  }

  if (rssContent && docId) {
    await updateDocumentContent(docId, rssContent);
    deps.updateDocument(docId, {
      content: rssContent,
      title: item.title || feed?.title,
      filePath: rssLink,
      fileType: "html",
    });
  }

  if (!docId) throw new Error("Could not resolve a backing document for the article");
  return docId;
}
