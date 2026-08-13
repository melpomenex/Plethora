/**
 * Anki Package Import Utility
 *
 * Handles importing .apkg files (Anki export packages)
 * and converting them to Incrementum format
 */

import { invokeCommand, openFilePicker, isNativeMobile } from "../lib/tauri";
import { getBrowserFile } from "../lib/browser-file-store";

export interface AnkiField {
  name: string;
  value: string;
}

export interface AnkiNote {
  id: number;
  guid: string;
  mid: number;
  modelName: string;
  tags: string[];
  fields: AnkiField[];
  timestamp: number;
}

export interface AnkiCard {
  id: number;
  noteId: number;
  ord: number;
  interval: number;
  ease: number;
  due: number;
}

export interface AnkiDeck {
  id: number;
  name: string;
  notes: AnkiNote[];
  cards: AnkiCard[];
}

/**
 * Recover Anki deck names from imported learning-item tags.
 *
 * Both native and browser importers append `anki-import`, the note model, and
 * finally the source deck name. Prefer an explicit `deck:` tag when present so
 * future/imported variants remain unambiguous; otherwise use that established
 * final-tag contract for legacy imports.
 */
export function inferAnkiDeckNames(imported: unknown[]): string[] {
  const names = new Map<string, string>();
  for (const item of imported) {
    if (!item || typeof item !== "object") continue;
    const tagsRaw = (item as { tags?: unknown }).tags;
    if (!Array.isArray(tagsRaw)) continue;
    const tags = tagsRaw
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const markerIndex = tags.findIndex((tag) => tag.toLowerCase() === "anki-import");
    if (markerIndex < 0) continue;

    const explicitDeckTags = tags.filter((tag) => tag.toLowerCase().startsWith("deck:"));
    const candidates = explicitDeckTags.length > 0
      ? explicitDeckTags.map((tag) => tag.slice(5).trim())
      : [tags[tags.length - 1]];
    for (const candidate of candidates) {
      if (!candidate || candidate.toLowerCase() === "anki-import") continue;
      const key = candidate.toLowerCase();
      if (!names.has(key)) names.set(key, candidate);
    }
  }
  return Array.from(names.values());
}

/**
 * Validate an Anki package file
 */
export async function validateAnkiPackage(filePath: string): Promise<boolean> {
  try {
    const isValid = await invokeCommand<boolean>("validate_anki_package", { path: filePath });
    return isValid;
  } catch (error) {
    console.error("Failed to validate Anki package:", error);
    throw error;
  }
}

/**
 * Import an Anki package file
 */
export async function importAnkiPackage(filePath: string): Promise<AnkiDeck[]> {
  try {
    const result = await invokeCommand<string>("import_anki_package", { apkgPath: filePath });
    const decks = JSON.parse(result) as AnkiDeck[];
    return decks;
  } catch (error) {
    console.error("Failed to import Anki package:", error);
    throw error;
  }
}

/**
 * Open file picker to select .apkg file
 */
export async function selectAnkiPackage(): Promise<string | null> {
  try {
    const selected = await openFilePicker({
      multiple: false,
      filters: [{
        name: "Anki Package",
        extensions: ["apkg"]
      }]
    });

    if (!selected || selected.length === 0) return null;
    return selected[0]; // Return the first selected file path
  } catch (error) {
    console.error("Failed to open file picker:", error);
    return null;
  }
}

/**
 * Convert Anki deck to Incrementum documents
 */
export async function convertAnkiDeckToDocuments(
  deck: AnkiDeck
): Promise<Array<{
  title: string;
  content: string;
  fileType: string;
  category: string;
  tags: string[];
  metadata: Record<string, any>;
}>> {
  const documents: Array<{
    title: string;
    content: string;
    fileType: string;
    category: string;
    tags: string[];
    metadata: Record<string, any>;
  }> = [];

  // Create a document for each note
  for (const note of deck.notes) {
    // Combine all fields into content
    const content = note.fields
      .map(field => `${field.name}:\n${field.value}`)
      .join("\n\n");

    // Get the primary field (usually first or named "Front", "Question", etc.)
    const primaryField = note.fields.find(f =>
      f.name.toLowerCase().includes("front") ||
      f.name.toLowerCase().includes("question") ||
      f.name.toLowerCase().includes("text")
    ) || note.fields[0];

    const title = primaryField?.value.slice(0, 100) || note.modelName;

    documents.push({
      title: title.length > 0 ? title : `${deck.name} - Note ${note.id}`,
      content,
      fileType: "anki",
      category: deck.name,
      tags: [...note.tags, "anki-import", note.modelName],
      metadata: {
        ankiNoteId: note.id,
        ankiGuid: note.guid,
        ankiModel: note.modelName,
        ankiTimestamp: note.timestamp,
        sourceDeck: deck.name,
        sourceDeckId: deck.id,
      },
    });
  }

  return documents;
}

/**
 * Convert Anki cards to Incrementum learning items
 */
export async function convertAnkiCardsToLearningItems(
  deck: AnkiDeck,
  documentId: string
): Promise<Array<{
  documentId: string;
  itemType: string;
  question: string;
  answer: string;
  tags: string[];
  metadata: Record<string, any>;
}>> {
  const items: Array<{
    documentId: string;
    itemType: string;
    question: string;
    answer: string;
    tags: string[];
    metadata: Record<string, any>;
  }> = [];

  // Index notes by id once (O(n)) so each card lookup is O(1) instead of a
  // linear scan of all notes inside the card loop (which would be O(n²)).
  // First-wins (`has` guard) preserves the exact semantics of
  // `deck.notes.find(n => n.id === card.noteId)`, which returns the first match.
  const noteById = new Map<number, AnkiNote>();
  for (const n of deck.notes) {
    if (!noteById.has(n.id)) noteById.set(n.id, n);
  }

  for (const card of deck.cards) {
    // Find the note for this card
    const note = noteById.get(card.noteId);
    if (!note) continue;

    const questionField = note.fields.find(f =>
      f.name.toLowerCase().includes("front") ||
      f.name.toLowerCase().includes("question")
    );

    const answerField = note.fields.find(f =>
      f.name.toLowerCase().includes("back") ||
      f.name.toLowerCase().includes("answer")
    );

    if (!questionField || !answerField) continue;

    items.push({
      documentId,
      itemType: "flashcard",
      question: questionField.value,
      answer: answerField.value,
      tags: [...note.tags, "anki-import", note.modelName],
      metadata: {
        ankiCardId: card.id,
        ankiNoteId: note.id,
        ankiGuid: note.guid,
        ankiModel: note.modelName,
        interval: card.interval,
        ease: card.ease,
        due: card.due,
        sourceDeck: deck.name,
        sourceDeckId: deck.id,
      },
    });
  }

  return items;
}

/**
 * Import an Anki `.apkg` package selected via {@link openFilePicker}.
 *
 * On desktop, `openFilePicker` returns a real filesystem path that the Rust
 * command `import_anki_package_to_learning_items` can open directly.
 *
 * On native mobile (Android/iOS), `openFilePicker` returns a `browser-file://`
 * virtual handle (the WebView's SAF picker yields a File object, not a readable
 * filesystem path). The Rust `apkgPath` command can't open it, so we read the
 * bytes in JS and send them to `import_anki_package_bytes_to_learning_items`,
 * which mirrors the mobile document-import pattern (importDocumentFromBytes).
 *
 * @returns The created learning items (same shape as the desktop command).
 */
export async function importAnkiPackageFromPicker(
  filePath: string
): Promise<unknown[]> {
  let imported: unknown[];
  if (isNativeMobile()) {
    const file = getBrowserFile(filePath);
    if (!file) {
      throw new Error("Anki file not found. Please select the file again.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Tauri IPC deserializes Vec<u8> from a JSON array of numbers, so pass a
    // plain array (not a Uint8Array/Buffer) to round-trip cleanly.
    imported = await invokeCommand<unknown[]>(
      "import_anki_package_bytes_to_learning_items",
      { apkgBytes: Array.from(bytes) }
    );
  } else {
    imported = await invokeCommand<unknown[]>(
      "import_anki_package_to_learning_items",
      { apkgPath: filePath }
    );
  }

  if (Array.isArray(imported) && imported.length > 0) {
    void (async () => {
      try {
        const { publishCards } = await import("../lib/sync/entities/flashcards");
        await publishCards(imported);
      } catch (err) {
        console.warn("[ankiImport] sync publish failed (non-fatal)", err);
      }
    })();
  }

  return imported;
}

/**
 * Get statistics about an Anki package
 */
export function getAnkiDeckStats(deck: AnkiDeck): {
  deckName: string;
  noteCount: number;
  cardCount: number;
  models: string[];
  tags: string[];
} {
  const models = new Set<string>();
  const tags = new Set<string>();

  for (const note of deck.notes) {
    models.add(note.modelName);
    note.tags.forEach(tag => tags.add(tag));
  }

  return {
    deckName: deck.name,
    noteCount: deck.notes.length,
    cardCount: deck.cards.length,
    models: Array.from(models),
    tags: Array.from(tags),
  };
}
