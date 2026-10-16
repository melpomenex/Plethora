import type { AssistantContext } from "../AssistantPanel";
import type { AssistantSourceProvenance } from "./contracts";
import { enforceAssistantPrivacyAndConsent, type PrivacySubjectDocument } from "../../../lib/ai/assistant/privacyGate";

export function assistantSourceProvenance(context?: AssistantContext): AssistantSourceProvenance | undefined {
  if (!context || context.type === "general") return undefined;
  const documentIds = context.privacyDocumentIds ?? (context.documentId ? [context.documentId] : []);
  return { documentIds: [...documentIds], sourceId: context.documentId ?? context.url, sourceTitle: context.metadata?.title };
}

/** Stored provenance is untrusted input: malformed or unresolved IDs fail closed. */
export async function authorizeAssistantHistory(options: {
  sources: readonly unknown[];
  providerId: string;
  strictLocalOnly?: boolean;
  getDocument: (id: string) => Promise<PrivacySubjectDocument | null | undefined>;
}): Promise<PrivacySubjectDocument[]> {
  const ids = new Set<string>();
  let localOnly = false;
  for (const source of options.sources) {
    if (source === undefined) continue;
    const candidate = source as Partial<AssistantSourceProvenance> | null;
    if (!candidate || !Array.isArray(candidate.documentIds) || candidate.documentIds.some(id => typeof id !== "string" || !id || id.startsWith("extract:"))) {
      throw new Error("Source privacy cannot be verified. Start a new conversation.");
    }
    for (const id of candidate.documentIds) ids.add(id);
    localOnly ||= candidate.localOnly === true;
  }
  const documents = await Promise.all([...ids].map(async id => {
    let doc: PrivacySubjectDocument | null | undefined;
    try { doc = await options.getDocument(id); } catch { doc = undefined; }
    if (!doc) throw new Error("A conversation source is unavailable. Start a new conversation before sending history.");
    return doc;
  }));
  const result = await enforceAssistantPrivacyAndConsent({
    providerId: options.providerId, documents, attachingSourceContent: documents.length > 0,
    strictLocalOnly: options.strictLocalOnly || localOnly,
  });
  if (!result.allowed) throw new Error(`${result.message ?? "Source privacy blocks this request."} Choose a permitted local provider or start a new conversation.`);
  return documents;
}

/** Derived replies retain historical privacy even after the original turn ages out. */
export function mergeAssistantProvenance(current: AssistantSourceProvenance | undefined, history: readonly (AssistantSourceProvenance | undefined)[]): AssistantSourceProvenance | undefined {
  const sources = [current, ...history].filter((s): s is AssistantSourceProvenance => s !== undefined);
  if (!sources.length) return undefined;
  const documentIds = sources.flatMap(source => Array.isArray(source?.documentIds) ? source.documentIds : [""]);
  return { ...current, documentIds: [...new Set(documentIds)], localOnly: sources.some(source => source?.localOnly) };
}
