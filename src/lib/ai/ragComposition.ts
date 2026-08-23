import type { AIProviderKind } from "./providers/types";
import {
  RAG_NAMESPACE_HELP,
  RAG_NAMESPACE_LIBRARY,
  type SemanticRetrieverId,
} from "./capabilities/search";

export type RagGeneratorKind = AIProviderKind | "none";

export interface RagComposition {
  retrieverId: SemanticRetrieverId;
  generatorKind: RagGeneratorKind;
  namespace: typeof RAG_NAMESPACE_LIBRARY | typeof RAG_NAMESPACE_HELP;
}

export const DEFAULT_LIBRARY_RAG: RagComposition = {
  retrieverId: "ai_learning",
  generatorKind: "ondevice",
  namespace: RAG_NAMESPACE_LIBRARY,
};

export const DEFAULT_HELP_RAG: RagComposition = {
  retrieverId: "document-only",
  generatorKind: "ondevice",
  namespace: RAG_NAMESPACE_HELP,
};

export function assertSeparateRagNamespaces(): void {
  const help: string = RAG_NAMESPACE_HELP;
  const library: string = RAG_NAMESPACE_LIBRARY;
  if (help === library) {
    throw new Error("Help and library RAG namespaces must stay distinct");
  }
}
