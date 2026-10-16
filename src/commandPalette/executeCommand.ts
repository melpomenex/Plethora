import { useUIStore } from "../stores/uiStore";
import { ToastType, useToastStore } from "../components/common/Toast";
import { t } from "../lib/i18n";

const pending = new Set<string>();

/** Shared by search, browse and the legacy palette. Owns work after dismissal. */
export async function executeCommand(
  command: { id: string; label: string; action: () => unknown },
  close?: () => void,
): Promise<void> {
  if (pending.has(command.id)) return;
  pending.add(command.id);
  useUIStore.getState().setCommandPaletteOpen(false);
  close?.();
  try {
    await command.action();
  } catch (error) {
    if ((error as { name?: string } | null)?.name !== "AbortError") {
      useToastStore.getState().addToast({
        type: ToastType.Error,
        title: command.label,
        message: t("commandPalette.actionFailed", {
          reason: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  } finally {
    pending.delete(command.id);
  }
}
