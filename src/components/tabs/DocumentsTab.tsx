import { DocumentsView } from "../documents/DocumentsView";
import { useTabsStore } from "../../stores";
import { DocumentExtractsTab, DocumentViewer } from "./TabRegistry";
import type { Document } from "../../types/document";
import { BookOpen, ImageSquare, TextT, YoutubeLogo } from "@phosphor-icons/react";
import { AudiobookEpubSyncView } from "../viewer/AudiobookEpubSyncView";

export function DocumentsTab() {
  const { addTab } = useTabsStore();

  const handleOpenDocument = (doc: Document) => {
    addTab({
      title: doc.title,
      icon: doc.fileType === "pdf" ? <TextT className="w-4 h-4 text-red-500" />
        : doc.fileType === "epub" ? <BookOpen className="w-4 h-4 text-blue-500" />
        : doc.fileType === "youtube" ? <YoutubeLogo className="w-4 h-4 text-red-600" />
        : doc.fileType === "image" ? <ImageSquare className="w-4 h-4 text-rose-500" />
        : <TextT className="w-4 h-4 text-muted-foreground" />,
      type: "document-viewer",
      content: DocumentViewer,
      closable: true,
      data: { documentId: doc.id, openedFrom: "documents" },
    });
  };

  const handleViewExtracts = (doc: Document) => {
    addTab({
      title: doc.title,
      icon: <BookOpen className="w-4 h-4 text-muted-foreground" />,
      type: "document-extracts",
      content: DocumentExtractsTab,
      closable: true,
      data: { documentId: doc.id, documentTitle: doc.title },
    });
  };

  const handleReadAlong = (audioDoc: Document, epubDoc: Document) => {
    addTab({
      title: `${audioDoc.title} — Read Along`,
      icon: "🎧",
      type: "audiobook-epub-sync",
      content: AudiobookEpubSyncView,
      closable: true,
      data: { audioDocumentId: audioDoc.id, epubDocumentId: epubDoc.id },
    });
  };

  return (
    <DocumentsView
      onOpenDocument={handleOpenDocument}
      onViewExtracts={handleViewExtracts}
      onReadAlong={handleReadAlong}
      enableYouTubeImport
    />
  );
}
