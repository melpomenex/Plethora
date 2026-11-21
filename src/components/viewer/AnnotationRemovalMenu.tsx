import { useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { ContextMenu, ContextMenuItemType, type ContextMenuItem } from "../common/ContextMenu";
import { DeleteConfirmDialog } from "../extracts/DeleteConfirmDialog";
import { useI18n } from "../../lib/i18n";
import { uniqueAnnotationTargets, type ReaderContextMenuPayload, type SavedAnnotationTarget } from "./annotationContextMenu";

export function AnnotationRemovalMenu({ documentId, menu, onClose, onInspect }: {
  documentId: string;
  menu: ReaderContextMenuPayload | null;
  onClose: () => void;
  onInspect?: (target: SavedAnnotationTarget) => void;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState<SavedAnnotationTarget | null>(null);
  const candidates = uniqueAnnotationTargets(menu?.annotations ?? []).filter((entry) => entry.documentId === documentId);
  const choose = (entry: SavedAnnotationTarget) => {
    if (onInspect) onInspect(entry);
    else setTarget({ ...entry });
    onClose();
  };
  const label = onInspect ? t("viewer.pdfAnnotations") : t("viewer.removeAnnotation");
  const items: ContextMenuItem[] = candidates.length === 1 ? [{
    id: "remove-annotation", type: onInspect ? undefined : ContextMenuItemType.Danger,
    label, icon: onInspect ? undefined : <Trash className="w-4 h-4" />,
    onClick: () => choose(candidates[0]),
  }] : [{
    id: "remove-annotation", type: ContextMenuItemType.Submenu,
    label, icon: onInspect ? undefined : <Trash className="w-4 h-4" />,
    children: candidates.map((entry, index) => ({
      id: `remove-${entry.extractId}`, type: onInspect ? undefined : ContextMenuItemType.Danger,
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
