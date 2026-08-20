import { browserInvoke } from "../lib/browser-backend";
import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  KnownWordImportPreview,
  KnownWordImportRecord,
  LanguageKnowledgeEvidenceEvent,
  LanguageKnowledgeEvidenceInput,
  LanguageKnowledgeExport,
  LanguageKnowledgeHistoryPage,
  LanguageKnowledgeStateChange,
  LanguageKnowledgeStateSnapshot,
  LanguageMemorizationLink,
  LanguageMemorizationLinkInput,
  LanguageKnowledgeState,
} from "../types/languageKnowledge";

type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const call: Call = (command, args) => isTauri() ? invokeCommand(command, args) : browserInvoke(command, args);

export function getLanguageKnowledgeState(profileId: string, entryId: string) {
  return call<LanguageKnowledgeStateSnapshot>("get_language_knowledge_state", { profileId, entryId });
}

export function resolveLanguageKnowledgeState(profileId: string, surface: string) {
  return call<LanguageKnowledgeStateSnapshot | null>("resolve_language_knowledge_state", { profileId, surface });
}

export function setLanguageKnowledgeState(input: LanguageKnowledgeStateChange) {
  return call<LanguageKnowledgeStateSnapshot>("set_language_knowledge_state", { change: { source: "manual", ...input } });
}

export function setLanguageKnowledgeStatesBatch(changes: LanguageKnowledgeStateChange[]) {
  return call<LanguageKnowledgeStateSnapshot[]>("set_language_knowledge_states_batch", { changes: changes.map((change) => ({ source: "manual", ...change })) });
}

export function recordLanguageKnowledgeEvidence(input: LanguageKnowledgeEvidenceInput) {
  return call<LanguageKnowledgeEvidenceEvent>("record_language_knowledge_evidence", { input });
}

export function listLanguageKnowledgeHistory(profileId: string, options: { entryId?: string; offset?: number; limit?: number } = {}) {
  return call<LanguageKnowledgeHistoryPage>("list_language_knowledge_history", { profileId, ...options, offset: options.offset ?? 0, limit: options.limit ?? 50 });
}

export function undoLanguageKnowledgeChange(profileId: string, historyId: string) {
  return call<LanguageKnowledgeStateSnapshot>("undo_language_knowledge_change", { profileId, historyId });
}

export function createLanguageMemorizationLink(input: LanguageMemorizationLinkInput) {
  return call<LanguageMemorizationLink>("create_language_memorization_link", { input });
}

export function previewLanguageKnownWordImport(profileId: string, records: KnownWordImportRecord[]) {
  return call<KnownWordImportPreview>("preview_language_known_word_import", { profileId, records });
}

export function importLanguageKnownWords(profileId: string, records: KnownWordImportRecord[]) {
  return call<LanguageKnowledgeExport>("import_language_known_words", { profileId, records });
}

export function exportLanguageKnowledge(profileId: string) {
  return call<LanguageKnowledgeExport>("export_language_knowledge", { profileId });
}

export const LANGUAGE_KNOWLEDGE_STATES: LanguageKnowledgeState[] = ["new", "encountered", "learning", "familiar", "known", "ignored"];
