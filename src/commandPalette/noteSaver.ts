/**
 * Note persistence for the palette composer (revamp-command-palette).
 *
 * Kept as a pure async function with injected effects so the durable-save
 * contract can be unit-tested without stores, React, or dialogs. The order is
 * deliberate: create the Markdown document, persist its content, and only then
 * report success. A failed content save compensates the partial record so a
 * retry cannot orphan or duplicate, and the draft survives every failure.
 */

import type { Document } from "../types/document";
import type { PaletteNoteDraft } from "./noteDraft";

export interface NoteSaveDeps {
  /** Creates the backing Markdown document (collection bound by the caller). */
  createDocument: (title: string, filePath: string, fileType: string) => Promise<Document>;
  updateDocumentContent: (id: string, content: string) => Promise<unknown>;
  deleteDocument: (id: string) => Promise<void>;
  addDocument: (document: Document) => void;
  updateDocument: (id: string, updates: Partial<Document>) => void;
  /** Refresh/invalidate the library so the note becomes searchable. */
  refreshLibrary: () => void;
  /** Open the saved document (canonical document opener). */
  openDocument: (documentId: string) => void;
  clearDraft: () => void;
  /** Injectable clock for the stable `note://` identity. */
  now?: () => number;
  fallbackTitle: string;
  onSaved?: (title: string) => void;
  onCleanupError?: (error: unknown) => void;
}

export interface NoteSaveResult {
  documentId?: string;
  /** Present when the save failed; the message is user-facing. */
  error?: string;
}

/** True when the draft has any user content worth saving. */
export function isNoteDraftSaveable(draft: PaletteNoteDraft): boolean {
  return draft.title.trim().length > 0 || draft.body.trim().length > 0;
}

/**
 * Persist the draft as a Markdown document in the active collection.
 * Resolves `{ documentId }` on durable success or `{ error }` on failure.
 */
export async function savePaletteNote(
  draft: PaletteNoteDraft,
  deps: NoteSaveDeps
): Promise<NoteSaveResult> {
  const title = draft.title.trim() || deps.fallbackTitle;
  const now = deps.now ?? Date.now;
  let createdId: string | null = null;

  try {
    const created = await deps.createDocument(title, `note://${now()}`, "markdown");
    createdId = created.id;
    await deps.updateDocumentContent(createdId, draft.body);

    deps.addDocument({ ...created, content: draft.body });
    deps.updateDocument(createdId, { content: draft.body });
    deps.clearDraft();
    deps.refreshLibrary();
    deps.openDocument(createdId);
    deps.onSaved?.(title);
    return { documentId: createdId };
  } catch (error) {
    if (createdId) {
      try {
        await deps.deleteDocument(createdId);
      } catch (cleanupError) {
        // Best-effort compensation; the error below still describes the save
        // failure the user must retry.
        deps.onCleanupError?.(cleanupError);
      }
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
