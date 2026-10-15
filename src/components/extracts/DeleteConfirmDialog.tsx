import { useEffect, useRef, useState } from "react";
import { deleteExtract, type Extract } from "../../api/extracts";
import { useI18n } from "../../lib/i18n";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
import { Dialog } from "../md3/Dialog";
import { Button } from "../md3/Button";

type DeleteTarget = Pick<Extract, "id" | "document_id" | "content"> & Partial<Pick<Extract, "category" | "tags">>;

interface DeleteConfirmDialogProps {
  extract: DeleteTarget | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete?: (extractId: string) => void;
  annotation?: boolean;
}

function useExtractDeletion({ extract, isOpen, onClose, onDelete }: DeleteConfirmDialogProps) {
  const { t } = useI18n();
  const { delete: deleteHaptic } = useHapticFeedback();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const activeRef = useRef<string | null>(null);
  activeRef.current = isOpen ? extract?.id ?? null : null;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; activeRef.current = null; };
  }, []);
  useEffect(() => { setError(null); }, [extract?.id, isOpen]);

  const handleDelete = async () => {
    if (!extract || pendingRef.current) return;
    const target = extract;
    pendingRef.current = true;
    deleteHaptic();
    setIsDeleting(true);
    setError(null);
    try {
      await deleteExtract(target.id, target.document_id);
      if (activeRef.current === target.id) {
        onDelete?.(target.id);
        onClose();
      }
    } catch (err) {
      if (activeRef.current === target.id) setError(err instanceof Error ? err.message : t("extracts.failedToDelete"));
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setIsDeleting(false);
    }
  };

  const close = () => { if (!pendingRef.current) onClose(); };
  return { isDeleting, error, handleDelete, close };
}

export function DeleteConfirmDialog(props: DeleteConfirmDialogProps) {
  const { extract, isOpen, onClose, annotation } = props;
  const { t } = useI18n();
  const { isDeleting, error, handleDelete, close } = useExtractDeletion(props);
  const actionLabel = t(annotation ? "viewer.removeAnnotation" : "extracts.deleteTitle");
  const metadata = [extract?.category, ...(extract?.tags ?? [])].filter(Boolean).join(" · ");

  return (
    <Dialog
      open={isOpen && Boolean(extract)}
      onClose={close}
      title={actionLabel}
      description={t(annotation ? "viewer.removeAnnotationConfirm" : "extracts.deleteConfirm")}
      closeLabel={t("common.close")}
      alert
      hideCloseButton={isDeleting}
      footer={<>
        <Button variant="outlined" onClick={onClose} disabled={isDeleting}>{t("common.cancel")}</Button>
        <Button variant="destructive" onClick={() => void handleDelete()} disabled={isDeleting}>
          {isDeleting ? t("extracts.deleting") : actionLabel}
        </Button>
      </>}
    >
      {metadata && <p className="md-body-small text-on-surface-variant mb-2">{metadata}</p>}
      <p className="md-body-medium break-words line-clamp-3 mb-4">{extract?.content}</p>
      <p className="md-body-small text-on-surface-variant">{t("extracts.deleteWarning")}</p>
      {error && <p role="alert" className="md-body-small text-error mt-4">{t("extracts.failedToDelete")}: {error}</p>}
    </Dialog>
  );
}
