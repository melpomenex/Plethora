/**
 * Memory-scenario step executor.
 *
 * Executes the driver's steps through the SAME store actions the UI uses
 * (design D2): documents are opened via `openDocumentAtLocation` (the shared
 * helper behind the command palette and Document Q&A), tabs are closed via
 * `tabsStore.closeTab` / `closeAllTabs`, and corpus files are registered via
 * `documentStore.importGenericFile` (an explicit-path import — no file
 * picker). Nothing here synthesizes input events, so runs are deterministic
 * regardless of window geometry, theme, or animation.
 */

import { useDocumentStore } from "../../stores/documentStore";
import { useTabsStore } from "../../stores/tabsStore";
import { openDocumentAtLocation } from "../../utils/openDocumentAtLocation";
import type { Document } from "../../types/document";
import type { MemoryScenarioManifest, MemoryScenarioStep } from "./types";

export interface ExecuteResult {
  ok: boolean;
  tabId?: string;
  documentId?: string;
  error?: string;
}

const documentIdByCorpusId = new Map<string, string>();

/** Result of opening/importing a corpus item. */
export async function resolveDocument(
  corpusId: string,
  manifest: MemoryScenarioManifest,
): Promise<Document> {
  const cached = documentIdByCorpusId.get(corpusId);
  if (cached) {
    const known = useDocumentStore.getState().documents.find((d) => d.id === cached);
    if (known) return known;
  }

  const fileName = manifest.items[corpusId];
  if (!fileName) {
    throw new Error(`corpus item "${corpusId}" is not in the manifest`);
  }
  const filePath = `${manifest.corpusDir}/${fileName}`;

  // Prefer an existing document row for this path so repeated harness runs do
  // not accumulate duplicate imports; import only when the path is unknown.
  let doc = useDocumentStore.getState().documents.find((d) => d.filePath === filePath);
  if (!doc) {
    await useDocumentStore.getState().loadDocuments();
    doc = useDocumentStore.getState().documents.find((d) => d.filePath === filePath);
  }
  if (!doc) {
    doc = await useDocumentStore.getState().importGenericFile(filePath);
  }

  documentIdByCorpusId.set(corpusId, doc.id);
  return doc;
}

/** Find the currently open tab holding a document (document-viewer dedupes on data). */
export function findTabForDocument(documentId: string): { tabId: string } | null {
  const state = useTabsStore.getState();
  const tab = state.tabs.find(
    (t) => t.type === "document-viewer" && t.data?.documentId === documentId,
  );
  return tab ? { tabId: tab.id } : null;
}

/**
 * Execute one step. Returns the report payload fields (tab id for `open`).
 */
export async function executeStep(
  step: MemoryScenarioStep,
  manifest: MemoryScenarioManifest,
): Promise<ExecuteResult> {
  try {
    switch (step.op) {
      case "open": {
        const doc = await resolveDocument(step.corpusId, manifest);
        openDocumentAtLocation(doc.id, {}, useTabsStore.getState().addTab);
        const opened = findTabForDocument(doc.id);
        return { ok: true, tabId: opened?.tabId, documentId: doc.id };
      }
      case "closeTab": {
        useTabsStore.getState().closeTab(step.tabId);
        return { ok: true };
      }
      case "closeAll": {
        useTabsStore.getState().closeAllTabs();
        return { ok: true };
      }
      case "settle":
        // Quiescence is awaited by the host before reporting; nothing to do.
        return { ok: true };
      case "quit":
        return { ok: true };
      default:
        return { ok: false, error: `unhandled op ${(step as { op: string }).op}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
