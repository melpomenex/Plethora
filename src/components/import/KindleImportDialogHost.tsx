/**
 * Global Kindle Import Dialog host
 *
 * Renders the {@link KindleImportDialog} for whatever path the global store
 * (`useKindleImportDialogStore`) is currently holding. Mount this once near
 * the app root so any code path — drag & drop, file picker, folder import,
 * paste, or the Settings page — can open the dialog via
 * `openKindleImportDialog(path)` without mounting its own instance.
 *
 * This host owns the "Import as plain text" fallback: if validation fails
 * because the file isn't actually a Kindle clippings file, it offers to hand
 * the file back to the caller's `onFallbackToGenericImport` hook so the user
 * isn't stuck.
 */

import { useCallback } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useKindleImportDialogStore } from "../../stores/kindleImportDialogStore";
import { KindleImportDialog } from "./KindleImportDialog";

export function KindleImportDialogHost() {
  const { t } = useI18n();
  const filePath = useKindleImportDialogStore((s) => s.filePath);
  const onFallback = useKindleImportDialogStore((s) => s.onFallbackToGenericImport);
  const close = useKindleImportDialogStore((s) => s.close);

  const handleFallback = useCallback(() => {
    if (!filePath) return;
    const path = filePath;
    close();
    onFallback?.(path);
  }, [filePath, close, onFallback]);

  if (!filePath) return null;

  return (
    <KindleImportDialog
      filePath={filePath}
      onClose={close}
      onFallbackToGenericImport={onFallback ? handleFallback : undefined}
      // Surface the "not a Kindle file" copy + fallback button when validation
      // rejects the content sniff (see KindleImportDialog errorStateExtra).
      notKindleFileMessage={t("kindleImport.notKindleFile")}
      importAsPlainTextLabel={t("kindleImport.importAsPlainText")}
    />
  );
}

// Re-export so callers can render the icon without a second import if helpful.
export { DownloadSimple };
