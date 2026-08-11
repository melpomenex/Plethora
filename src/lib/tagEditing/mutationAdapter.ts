import type { ItemTagTarget } from "./types";

/**
 * One item-type mutation adapter for persisted tag arrays. Dispatches to the
 * existing document / extract / learning-item update APIs (no new backend
 * command) and always persists the COMPLETE next tag array, matching current
 * persistence semantics. Returns the persisted tag list for reconciliation.
 *
 * Web-mode caveat: the Tauri-only `update_learning_item_tags` command is a
 * silent no-op in the browser/PWA shell (no browser-backend handler), so in
 * web mode learning-item tag saves route through the generic
 * `update_learning_item` partial-update handler instead.
 *
 * All API/tauri modules are imported lazily (dynamic import) so surfaces that
 * merely embed the shared editor — especially virtualized Schedule rows — do
 * not pull the api/browser-backend chain into their module graph at load
 * time, and component tests keep their own mocks.
 */
export async function persistItemTags(target: ItemTagTarget, nextTags: string[]): Promise<string[]> {
  if (target.type === "document") {
    // The Rust Document struct has no #[serde(default)] on `tags`, so a
    // partial payload fails deserialization: always spread the full doc.
    const { getDocument, updateDocument } = await import("../../api/documents");
    const doc = await getDocument(target.id);
    if (!doc) throw new Error("Document not found");
    await updateDocument(target.id, { ...doc, tags: nextTags });
    return nextTags;
  }

  if (target.type === "extract") {
    const { updateExtract } = await import("../../api/extracts");
    await updateExtract({ id: target.id, tags: nextTags });
    return nextTags;
  }

  if (target.type === "learning-item") {
    const [{ updateLearningItemTags }, { invokeCommand, isTauri }] = await Promise.all([
      import("../../api/learning-items"),
      import("../../lib/tauri"),
    ]);
    if (isTauri()) {
      await updateLearningItemTags(target.id, nextTags);
    } else {
      await invokeCommand("update_learning_item", { id: target.id, tags: nextTags });
    }
    return nextTags;
  }

  throw new Error(`Unsupported tag target type: ${(target as { type: string }).type}`);
}
