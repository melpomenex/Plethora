import React, { useEffect, useState, useCallback } from "react";
import {
  FileText,
  FilePdf,
  BookOpen,
  Plus,
  Trash,
  ArrowSquareOut,
  ShieldCheck,
  WarningCircle,
  X,
  FileCode,
} from "@phosphor-icons/react";
import type { RecordingSession, SessionRelatedDocument } from "../../types/recordingSession";
import {
  associateSessionDocument,
  disassociateSessionDocument,
  listSessionRelatedDocuments,
} from "../../api/recordingSessions";
import { useDocumentStore } from "../../stores/documentStore";
import { useTabsStore } from "../../stores/tabsStore";
import { openDocumentAtLocation } from "../../utils/openDocumentAtLocation";
import { cn } from "../../utils/cn";

export interface SessionRelatedMaterialsProps {
  session: RecordingSession;
  onOpenDocument?: (documentId: string) => void;
  className?: string;
}

function getFileIcon(fileType: string) {
  switch (fileType.toLowerCase()) {
    case "pdf":
      return <FilePdf className="w-4 h-4 text-rose-500 shrink-0" />;
    case "epub":
      return <BookOpen className="w-4 h-4 text-blue-500 shrink-0" />;
    case "markdown":
    case "html":
      return <FileCode className="w-4 h-4 text-emerald-500 shrink-0" />;
    default:
      return <FileText className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
}

export const SessionRelatedMaterials: React.FC<SessionRelatedMaterialsProps> = ({
  session,
  onOpenDocument,
  className,
}) => {
  const [relatedDocs, setRelatedDocs] = useState<SessionRelatedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);

  const libraryDocuments = useDocumentStore((state) => state.documents);
  const addTab = useTabsStore((state) => state.addTab);

  // Load related materials for this session
  const loadMaterials = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listSessionRelatedDocuments(session.id);
      setRelatedDocs(list);
    } catch (err) {
      console.warn("[SessionRelatedMaterials] Failed to list related materials:", err);
    } finally {
      setIsLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  // Candidates for attachment: exclude session's own document and already attached documents
  const attachableDocuments = libraryDocuments.filter(
    (doc) => doc.id !== session.documentId && !relatedDocs.some((r) => r.id === doc.id)
  );

  const handleAttach = async () => {
    if (!selectedDocId) return;
    setActionError(null);
    try {
      const updated = await associateSessionDocument(session.id, selectedDocId);
      setRelatedDocs(updated);
      setSelectedDocId("");
      setIsPickerOpen(false);
    } catch (err) {
      console.error("[SessionRelatedMaterials] Failed to attach document:", err);
      setActionError("Failed to attach document. Please verify the document exists locally.");
    }
  };

  const handleRemove = async (documentId: string) => {
    setActionError(null);
    try {
      const updated = await disassociateSessionDocument(session.id, documentId);
      setRelatedDocs(updated);
    } catch (err) {
      console.error("[SessionRelatedMaterials] Failed to remove document:", err);
      setActionError("Failed to remove document association.");
    }
  };

  const handleOpen = async (doc: SessionRelatedDocument) => {
    if (!doc.isAvailable) return;
    if (onOpenDocument) {
      onOpenDocument(doc.id);
      return;
    }
    // Navigate via openDocumentAtLocation
    await openDocumentAtLocation(doc.id, { ensureExists: true }, addTab);
  };

  return (
    <div
      data-testid="session-related-materials"
      className={cn(
        "p-5 bg-card border border-border rounded-xl shadow-sm space-y-4",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            Related Materials & Slides
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Associate slide decks, PDFs, or readings with this session. Separate source identities and privacy policies are preserved.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsPickerOpen(true);
            setActionError(null);
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
          aria-label="Attach related material"
        >
          <Plus className="w-3.5 h-3.5" />
          Attach Material
        </button>
      </div>

      {actionError && (
        <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center gap-2">
          <WarningCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Materials List */}
      {relatedDocs.length === 0 ? (
        <div className="p-4 rounded-lg bg-muted/20 border border-dashed border-border text-center">
          <p className="text-xs text-muted-foreground">
            No related slides or documents associated yet. Attach existing library PDFs or readings to study alongside this session.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="related-materials-list">
          {relatedDocs.map((doc) => (
            <li
              key={doc.id}
              data-testid={`related-material-${doc.id}`}
              className={cn(
                "flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors",
                doc.isAvailable
                  ? "bg-card border-border/70 hover:bg-muted/30"
                  : "bg-destructive/5 border-destructive/20"
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {getFileIcon(doc.fileType)}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        "text-xs font-medium truncate",
                        doc.isAvailable ? "text-foreground" : "text-muted-foreground line-through"
                      )}
                      title={doc.title}
                    >
                      {doc.title}
                    </span>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {doc.fileType}
                    </span>
                    {doc.isLocalOnly && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground"
                        title="Document is local-only"
                      >
                        <ShieldCheck className="w-3 h-3 text-emerald-500" />
                        Local-only
                      </span>
                    )}
                    {doc.isAiExcluded && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-amber-600 dark:text-amber-400"
                        title="Excluded from AI analysis"
                      >
                        AI excluded
                      </span>
                    )}
                    {!doc.isAvailable && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
                        Deleted from library
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {doc.isAvailable ? (
                  <button
                    type="button"
                    onClick={() => handleOpen(doc)}
                    aria-label={`Open ${doc.title}`}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-border hover:bg-muted text-foreground transition-colors cursor-pointer"
                  >
                    <ArrowSquareOut className="w-3.5 h-3.5 text-primary" />
                    <span className="hidden sm:inline">Open</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleRemove(doc.id)}
                  aria-label={`Remove ${doc.title}`}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                  title="Remove material link"
                >
                  <Trash className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Picker Dialog Modal */}
      {isPickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Attach Material from Library"
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">Attach Material from Library</h4>
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="p-1 rounded text-muted-foreground hover:text-foreground"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Select an existing library document (such as lecture slides, handouts, or syllabus readings) to associate with this session.
            </p>

            {attachableDocuments.length === 0 ? (
              <div className="p-4 rounded-lg bg-muted/30 text-center text-xs text-muted-foreground">
                No eligible library documents available to attach.
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="material-select" className="text-xs font-medium text-foreground">
                  Choose Document
                </label>
                <select
                  id="material-select"
                  aria-label="Choose Document"
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">-- Select a document --</option>
                  {attachableDocuments.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.title} ({doc.fileType.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedDocId}
                onClick={handleAttach}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Attach
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
