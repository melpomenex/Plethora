import type { SourceAnchor } from "../lib/languageProcessing/types";
import { useLayoutEffect, useRef } from "react";
import { create } from "zustand";
import { useTabsStore } from "../stores/tabsStore";
import { useUIStore } from "../stores/uiStore";
import { dispatchPaletteAction } from "./paletteActionEvents";
import { t } from "../lib/i18n";

export interface PaletteSelection {
  documentId: string;
  tabId?: string;
  paneId?: string;
  text: string;
  sourceAnchor?: SourceAnchor;
}

export const usePaletteSelectionStore = create<{ selection: PaletteSelection | null }>(() => ({ selection: null }));

export function getPaletteSelection(): PaletteSelection | null {
  const selection = usePaletteSelectionStore.getState().selection;
  if (!selection?.text.trim()) return null;
  if (!selection.tabId) return selection;
  const tabs = useTabsStore.getState();
  const pane = selection.paneId ? tabs.findPaneById(selection.paneId) : null;
  const navigationPane = tabs.navigationPaneId ?? tabs.getTabPaneIds()[0];
  const tab = tabs.tabs.find((entry) => entry.id === selection.tabId);
  return pane?.type === "tabs" && pane.activeTabId === selection.tabId &&
    navigationPane === selection.paneId && tab?.data?.documentId === selection.documentId
    ? selection : null;
}

/** Native, iframe and PDF selections already converge in the reader's state. */
export function usePaletteSelection(selection: PaletteSelection, active: boolean): void {
  const paletteOpen = useUIStore((state) => state.commandPaletteOpen);
  const owner = useRef<PaletteSelection | null>(null);
  useLayoutEffect(() => {
    if (!active || paletteOpen) return;
    const state = useTabsStore.getState();
    const navigationPane = state.navigationPaneId ?? state.getTabPaneIds()[0];
    if (selection.paneId && navigationPane !== selection.paneId) return;
    const next = selection.text.trim() ? selection : null;
    owner.current = next;
    usePaletteSelectionStore.setState({ selection: next });
  }, [selection.text, selection.documentId, selection.tabId, selection.paneId, active, paletteOpen, selection.sourceAnchor?.locator?.selection]);
  useLayoutEffect(() => () => {
    if (usePaletteSelectionStore.getState().selection === owner.current) {
      usePaletteSelectionStore.setState({ selection: null });
    }
  }, [selection.documentId]);
}

export function translatePaletteSelection(): void {
  if (!getPaletteSelection()) throw new Error(t("commandPalette.selectTextFirst"));
  dispatchPaletteAction("document-viewer", "doc.translateSelection");
}
