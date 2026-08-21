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

    const prevTags = doc.tags || [];
    const prevDetails = doc.metadata?.smartTagDetails ? [...doc.metadata.smartTagDetails] : [];
    const now = new Date().toISOString();

    // 1. Added tags marked as manual
    for (const tag of nextTags) {
      if (!prevTags.includes(tag)) {
        const existingIdx = prevDetails.findIndex((d) => d.tag.toLowerCase() === tag.toLowerCase());
        const detail = {
          tag,
          provenance: "manual" as const,
          confidence: 1.0,
          reason: "Manually added by user",
          assignedAt: now,
          dismissed: false,
        };
        if (existingIdx >= 0) {
          prevDetails[existingIdx] = detail;
        } else {
          prevDetails.push(detail);
        }
      }
    }

    // 2. Removed tags marked as dismissed
    for (const tag of prevTags) {
      if (!nextTags.includes(tag)) {
        const existingIdx = prevDetails.findIndex((d) => d.tag.toLowerCase() === tag.toLowerCase());
        if (existingIdx >= 0) {
          prevDetails[existingIdx] = {
            ...prevDetails[existingIdx],
            dismissed: true,
          };
        } else {
          prevDetails.push({
            tag,
            provenance: "manual" as const,
            confidence: 1.0,
            reason: "Dismissed by user",
            assignedAt: now,
            dismissed: true,
          });
        }
      }
    }

    const updatedMetadata = {
      ...(doc.metadata || {}),
      smartTagDetails: prevDetails,
    };

    await updateDocument(target.id, { ...doc, tags: nextTags, metadata: updatedMetadata });
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
