import type { FeedItem } from "../../api/rss";
import { stripHtmlTags } from "../../utils/sectionIndex";
import type { AssistantContext } from "../assistant/AssistantPanel";

/**
 * The mobile assistant answers from what the reader actually shows: the full
 * article when it has been fetched, otherwise the feed content or description.
 * RSS payloads are HTML; the assistant receives plain text.
 */
export function buildRssAssistantContext(item: FeedItem | null | undefined): AssistantContext | undefined {
  if (!item) return undefined;
  const raw = item.fullContent || item.content || item.description || "";
  return {
    type: "web",
    url: item.link || `rss:${item.id}`,
    content: stripHtmlTags(raw).trim(),
    privacyDocumentIds: [],
    metadata: { title: item.title },
    status: "ready",
  };
}
