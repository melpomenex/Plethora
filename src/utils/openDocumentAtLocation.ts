/**
 * Shared "open a document tab at a location" helper.
 *
 * Both the command palette (`CommandCenter.openDocumentInTab`) and the
 * Document Q&A sources footer build the same `document-viewer` tab payload
 * (`documentId` / `highlightQuery` / `initialJump` / `jumpRequestId` /
 * `autoPlay`, plus a fileType-driven icon). Keeping that construction in one
 * place guarantees the two callers cannot drift apart.
 *
 * Behavior preserved from the original `CommandCenter` implementation:
 * - a fresh `jumpRequestId` per navigation, so activating a second source for
 *   the same document re-triggers the jump/highlight in `DocumentViewer`;
 * - `autoPlay` set for time-based (youtube/audio) jumps;
 * - when the document is not in the cache yet (e.g. just imported), reload the
 *   document list once and retry.
 */

import { createElement } from "react";
import { BookOpen, ImageSquare, TextT, YoutubeLogo } from "@phosphor-icons/react";
import { useDocumentStore } from "../stores/documentStore";
import type { TabsState } from "../stores/tabsStore";
import { DocumentViewer } from "../components/tabs/TabRegistry";
import type { Document } from "../types/document";
import type { ExactSearchHitLocation } from "../types/searchHit";

export interface OpenDocumentAtLocationOptions {
  highlightQuery?: string;
  initialJump?: ExactSearchHitLocation;
}

/** Fresh id per navigation — repeated jumps to the same document re-trigger. */
function makeJumpRequestId(hasJump: boolean): string | undefined {
  if (!hasJump) return undefined;
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** FileType-driven tab icon, matching the command palette's choices. */
function fileTypeIcon(fileType: Document["fileType"]) {
  switch (fileType) {
    case "pdf":
      return createElement(TextT, { className: "w-4 h-4 text-red-500" });
    case "epub":
      return createElement(BookOpen, { className: "w-4 h-4 text-blue-500" });
    case "youtube":
      return createElement(YoutubeLogo, { className: "w-4 h-4 text-red-600" });
    case "image":
      return createElement(ImageSquare, { className: "w-4 h-4 text-rose-500" });
    default:
      return createElement(TextT, { className: "w-4 h-4 text-muted-foreground" });
  }
}

function buildTabPayload(
  doc: Document,
  options: OpenDocumentAtLocationOptions,
  jumpRequestId: string | undefined
) {
  return {
    title: doc.title,
    icon: fileTypeIcon(doc.fileType),
    type: "document-viewer" as const,
    content: DocumentViewer,
    closable: true,
    data: {
      documentId: doc.id,
      highlightQuery: options.highlightQuery,
      initialJump: options.initialJump,
      jumpRequestId,
      autoPlay: options.initialJump?.kind === "youtube" || options.initialJump?.kind === "audio",
    },
  };
}

/**
 * Open (or reuse) a `document-viewer` tab for `documentId`, optionally jumping
 * to `options.initialJump` with `options.highlightQuery` applied.
 */
export function openDocumentAtLocation(
  documentId: string,
  options: OpenDocumentAtLocationOptions,
  addTab: TabsState["addTab"]
): void {
  const doc = useDocumentStore.getState().documents.find((d) => d.id === documentId);
  const jumpRequestId = makeJumpRequestId(Boolean(options.initialJump));

  if (doc) {
    addTab(buildTabPayload(doc, options, jumpRequestId));
    return;
  }

  // Document might not be in cache yet (just imported) — reload and retry.
  void useDocumentStore.getState().loadDocuments().then(() => {
    const freshDoc = useDocumentStore.getState().documents.find((d) => d.id === documentId);
    if (freshDoc) {
      addTab(buildTabPayload(freshDoc, options, jumpRequestId));
    }
  });
}
