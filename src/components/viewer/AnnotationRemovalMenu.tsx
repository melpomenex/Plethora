import { useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { ContextMenu, ContextMenuItemType, type ContextMenuItem } from "../common/ContextMenu";
import { DeleteConfirmDialog } from "../extracts/DeleteConfirmDialog";
import { useI18n } from "../../lib/i18n";
import { uniqueAnnotationTargets, type ReaderContextMenuPayload, type SavedAnnotationTarget } from "./annotationContextMenu";

export function AnnotationRemovalMenu({ documentId, menu, onClose }: {
  documentId: string;
  menu: ReaderContextMenuPayload | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState<SavedAnnotationTarget | null>(null);
  const candidates = uniqueAnnotationTargets(menu?.annotations ?? []).filter((entry) => entry.documentId === documentId);
  const choose = (entry: SavedAnnotationTarget) => { setTarget({ ...entry }); onClose(); };
  const items: ContextMenuItem[] = candidates.length === 1 ? [{
    id: "remove-annotation", type: ContextMenuItemType.Danger,
    label: t("viewer.removeAnnotation"), icon: <Trash className="w-4 h-4" />,
    onClick: () => choose(candidates[0]),
  }] : [{
    id: "remove-annotation", type: ContextMenuItemType.Submenu,
    label: t("viewer.removeAnnotation"), icon: <Trash className="w-4 h-4" />,
    children: candidates.map((entry, index) => ({
      id: `remove-${entry.extractId}`, type: ContextMenuItemType.Danger,
      label: `${index + 1}. ${entry.text.replace(/\s+/g, " ").slice(0, 90)}`,
      title: entry.text,
      onClick: () => choose(entry),
    })),
  }];
  return <>
    {menu && candidates.length > 0 && <ContextMenu
      menuId="document-annotation-context-menu" visible position={{ x: menu.x, y: menu.y }}
      items={items} onClose={onClose}
    />}
    <DeleteConfirmDialog
      key={target?.extractId ?? "none"}
      extract={target && target.documentId === documentId ? { id: target.extractId, document_id: target.documentId, content: target.text } : null}
      isOpen={Boolean(target && target.documentId === documentId)} annotation
      onClose={() => setTarget(null)}
    />
  </>;
}
