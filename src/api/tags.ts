import { invokeCommand } from "../lib/tauri";

export type TaggedItemType = "document" | "extract" | "learning-item";

export interface TaggedItemSummary {
  id: string;
  itemType: TaggedItemType;
  title: string;
  category?: string | null;
  documentId?: string | null;
}

export async function getItemsByTag(tag: string): Promise<TaggedItemSummary[]> {
  return await invokeCommand<TaggedItemSummary[]>("get_items_by_tag", { tag });
}
