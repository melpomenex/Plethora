/**
 * Undoable Commands
 * Pre-built commands for common operations that support undo/redo
 */

import { invokeCommand as invoke } from "../lib/tauri";
import { Document, Extract, LearningItem } from "../types/document";
import {
  createExtract,
  deleteExtract,
} from "../api/extracts";
import {
  OperationType,
  UndoableCommandBase,
} from "../stores/undoRedoStore";

/**
 * Delete document command
 */
export class DeleteDocumentCommand extends UndoableCommandBase {
  private deletedDocument: Document | null = null;

  constructor(
    private documentId: string,
    private onSuccess?: () => void
  ) {
    super(
      OperationType.DeleteDocument,
      `Delete document: ${documentId.slice(0, 8)}...`
    );
  }

  async execute(): Promise<void> {
    this.deletedDocument = await invoke<Document>("get_document", {
      id: this.documentId,
    });

    if (!this.deletedDocument) {
      throw new Error("Document not found");
    }

    await invoke("delete_document", { id: this.documentId });

    try {
      const { deleteDocumentSync } = await import("../lib/documentReplication");
      await deleteDocumentSync(this.documentId);
    } catch (e) {
      console.warn("Failed to publish document delete sync", e);
    }

    this.onSuccess?.();
  }

  async undo(): Promise<void> {
    if (!this.deletedDocument) {
      throw new Error("Cannot undo: document data not available");
    }

    await invoke("upsert_synced_document", {
      document: this.deletedDocument,
    });

    try {
      const { publishDocument } = await import("../lib/documentReplication");
      await publishDocument(this.deletedDocument);
    } catch (e) {
      console.warn("Failed to publish document restore sync", e);
    }
  }

  async redo(): Promise<void> {
    await this.execute();
  }
}

/**
 * Delete extract command
 */
export class DeleteExtractCommand extends UndoableCommandBase {
  private deletedExtract: Extract | null = null;

  constructor(
    private extractId: string,
    private onSuccess?: () => void
  ) {
    super(
      OperationType.DeleteExtract,
      `Delete extract: ${extractId.slice(0, 8)}...`
    );
  }

  async execute(): Promise<void> {
    this.deletedExtract = await invoke<Extract>("get_extract", {
      id: this.extractId,
    });

    if (!this.deletedExtract) {
      throw new Error("Extract not found");
    }

    // Route through the api/extracts wrapper so the delete publishes to the
    // sync room (a direct invoke("delete_extract") would leave other devices'
    // copies behind).
    await deleteExtract(this.extractId);
    this.onSuccess?.();
  }

  async undo(): Promise<void> {
    if (!this.deletedExtract) {
      throw new Error("Cannot undo: extract data not available");
    }

    await createExtract({
      document_id: this.deletedExtract.documentId,
      content: this.deletedExtract.content,
      note: this.deletedExtract.notes,
      tags: this.deletedExtract.tags,
      category: this.deletedExtract.category,
      color: this.deletedExtract.highlightColor,
      page_number: this.deletedExtract.pageNumber,
    });
  }

  async redo(): Promise<void> {
    await this.execute();
  }
}

/**
 * Bulk delete extracts command
 */
export class BulkDeleteExtractsCommand extends UndoableCommandBase {
  private deletedExtracts: Extract[] = [];

  constructor(
    private extractIds: string[],
    private onSuccess?: () => void
  ) {
    super(
      OperationType.BulkDeleteExtracts,
      `Delete ${extractIds.length} extract${extractIds.length > 1 ? "s" : ""}`
    );
  }

  async execute(): Promise<void> {
    for (const id of this.extractIds) {
      try {
        const extract = await invoke<Extract>("get_extract", { id });
        if (extract) {
          this.deletedExtracts.push(extract);
        }
      } catch (e) {
        console.error(`Failed to fetch extract ${id}:`, e);
      }
    }

    await invoke("bulk_delete_extracts", { extractIds: this.extractIds });
    this.onSuccess?.();
  }

  async undo(): Promise<void> {
    // Restore all extracts via the api wrapper (correct arg shape + publishes
    // each restore to the sync room).
    for (const extract of this.deletedExtracts) {
      await createExtract({
        document_id: extract.documentId,
        content: extract.content,
        note: extract.notes,
        tags: extract.tags,
        category: extract.category,
        color: extract.highlightColor,
        page_number: extract.pageNumber,
      });
    }
  }

  async redo(): Promise<void> {
    await this.execute();
  }
}

/**
 * Delete learning item command
 */
export class DeleteLearningItemCommand extends UndoableCommandBase {
  private deletedItem: LearningItem | null = null;

  constructor(
    private itemId: string,
    private onSuccess?: () => void
  ) {
    super(
      OperationType.DeleteLearningItem,
      `Delete card: ${itemId.slice(0, 8)}...`
    );
  }

  async execute(): Promise<void> {
    this.deletedItem = await invoke<LearningItem | null>("get_learning_item", {
      itemId: this.itemId,
    });

    if (!this.deletedItem) {
      throw new Error("Learning item not found");
    }

    await invoke("delete_learning_item", { itemId: this.itemId });
    void (async () => {
      try {
        const { publishCardDeleted } = await import("../lib/sync/entities/flashcards");
        await publishCardDeleted(this.itemId);
      } catch (err) {
        console.warn("[undoableCommands] DeleteLearningItemCommand sync delete failed", err);
      }
    })();
    this.onSuccess?.();
  }

  async undo(): Promise<void> {
    if (!this.deletedItem) {
      throw new Error("Cannot undo: learning item data not available");
    }

    await invoke("restore_learning_item", {
      item: this.deletedItem,
    });
    void (async () => {
      try {
        const { publishCard, toSyncedLearningItem } = await import("../lib/sync/entities/flashcards");
        const { nowHLC } = await import("../lib/sync/syncClock");
        const synced = toSyncedLearningItem(this.deletedItem as unknown as Record<string, unknown>);
        synced.updated_at = nowHLC();
        synced.updatedAt = synced.updated_at;
        await publishCard(synced);
      } catch (err) {
        console.warn("[undoableCommands] DeleteLearningItemCommand sync undo failed", err);
      }
    })();
  }

  async redo(): Promise<void> {
    await this.execute();
  }
}

/**
 * Bulk delete items command
 */
export class BulkDeleteItemsCommand extends UndoableCommandBase {
  private deletedItems: LearningItem[] = [];

  constructor(
    private itemIds: string[],
    private onSuccess?: () => void
  ) {
    super(
      OperationType.BulkDeleteItems,
      `Delete ${itemIds.length} card${itemIds.length > 1 ? "s" : ""}`
    );
  }

  async execute(): Promise<void> {
    const allItems = await invoke<LearningItem[]>("get_all_learning_items");
    this.deletedItems = allItems.filter((i) => this.itemIds.includes(i.id));

    await invoke("bulk_delete_items", { itemIds: this.itemIds });
    void (async () => {
      try {
        const { publishCardDeleted } = await import("../lib/sync/entities/flashcards");
        for (const id of this.itemIds) {
          await publishCardDeleted(id);
        }
      } catch (err) {
        console.warn("[undoableCommands] BulkDeleteItemsCommand sync delete failed", err);
      }
    })();
    this.onSuccess?.();
  }

  async undo(): Promise<void> {
    // Restore all items
    for (const item of this.deletedItems) {
      await invoke("create_learning_item", {
        item: item,
      });
    }
    void (async () => {
      try {
        const { publishCards } = await import("../lib/sync/entities/flashcards");
        await publishCards(this.deletedItems);
      } catch (err) {
        console.warn("[undoableCommands] BulkDeleteItemsCommand sync undo failed", err);
      }
    })();
  }

  async redo(): Promise<void> {
    await this.execute();
  }
}

/**
 * Archive document command
 */
export class ArchiveDocumentCommand extends UndoableCommandBase {
  private previousArchiveState: boolean | null = null;

  constructor(
    private documentId: string,
    private archive: boolean,
    private onSuccess?: () => void
  ) {
    super(
      OperationType.ArchiveDocument,
      `${archive ? "Archive" : "Unarchive"} document`
    );
  }

  async execute(): Promise<void> {
    const doc = await invoke<Document>("get_document", {
      id: this.documentId,
    });

    if (!doc) {
      throw new Error("Document not found");
    }

    this.previousArchiveState = doc.isArchived;

    await invoke("update_document", {
      id: this.documentId,
      updates: { ...doc, isArchived: this.archive },
    });
    this.onSuccess?.();
  }

  async undo(): Promise<void> {
    if (this.previousArchiveState === null) {
      throw new Error("Cannot undo: previous state not available");
    }

    await invoke("update_document", {
      id: this.documentId,
      updates: {
        ...(await invoke<Document>("get_document", { id: this.documentId })),
        isArchived: this.previousArchiveState,
      },
    });
  }

  async redo(): Promise<void> {
    await this.execute();
  }
}

/**
 * Create extract command (can undo by deleting)
 */
export class CreateExtractCommand extends UndoableCommandBase {
  private createdExtractId: string | null = null;

  constructor(
    private extract: Omit<Extract, "id">,
    private onSuccess?: () => void
  ) {
    super(
      OperationType.CreateExtract,
      `Create extract: ${(extract.pageTitle || extract.content).slice(0, 20)}...`
    );
  }

  async execute(): Promise<void> {
    // Route through the api/extracts wrapper: it uses the correct Tauri arg
    // shape AND publishes the new extract to the sync room. The old direct
    // invoke() used a non-existent `pageTitle` arg and never published.
    const created = await createExtract({
      document_id: this.extract.documentId,
      content: this.extract.content,
      note: this.extract.notes,
      tags: this.extract.tags,
      category: this.extract.category,
      color: this.extract.highlightColor,
      page_number: this.extract.pageNumber,
    });
    this.createdExtractId = created.id;
    this.onSuccess?.();
  }

  async undo(): Promise<void> {
    if (!this.createdExtractId) {
      throw new Error("Cannot undo: extract was not created");
    }

    await deleteExtract(this.createdExtractId);
  }

  async redo(): Promise<void> {
    await this.execute();
  }
}
