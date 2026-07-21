/**
 * Global Kindle Import Dialog store
 *
 * Lets any code path (drag & drop, file picker, folder import, paste, the
 * Settings page) open the {@link KindleImportDialog} for a given file path
 * without each caller having to mount its own dialog instance and track its
 * own open/close state. A single `<KindleImportDialogHost />` rendered near
 * the app root subscribes to this store.
 *
 * Why a store (not a React context): the entry points include non-component
 * code (the Zustand `documentStore` actions), which cannot use a context.
 * A small external store is the lightest pattern that works from both
 * components and plain TS modules.
 */

import { create } from "zustand";

interface KindleImportDialogState {
  /** Path of the file to import, or `null` when the dialog is closed. */
  filePath: string | null;
  /**
   * Optional fallback path. When the dialog rejects the file (content sniff
   * says "not Kindle"), the host uses this callback to hand control back to
   * the caller so it can fall through to the generic plain-text import.
   */
  onFallbackToGenericImport?: ((filePath: string) => void) | null;
  /** Open the dialog for `filePath`. Idempotent if already open for it. */
  open: (
    filePath: string,
    options?: { onFallbackToGenericImport?: (filePath: string) => void },
  ) => void;
  /** Close the dialog. */
  close: () => void;
}

export const useKindleImportDialogStore = create<KindleImportDialogState>(
  (set, get) => ({
    filePath: null,
    onFallbackToGenericImport: null,
    open: (filePath, options) => {
      if (get().filePath === filePath) return;
      set({
        filePath,
        onFallbackToGenericImport: options?.onFallbackToGenericImport ?? null,
      });
    },
    close: () =>
      set({ filePath: null, onFallbackToGenericImport: null }),
  }),
);

/**
 * imperative helper for non-component callers (e.g. documentStore actions).
 * @param filePath Absolute path to a `My Clippings.txt` file.
 * @param options See {@link KindleImportDialogState.open}.
 */
export function openKindleImportDialog(
  filePath: string,
  options?: { onFallbackToGenericImport?: (filePath: string) => void },
): void {
  useKindleImportDialogStore.getState().open(filePath, options);
}

/** imperative helper to close the dialog (rarely needed from outside). */
export function closeKindleImportDialog(): void {
  useKindleImportDialogStore.getState().close();
}
