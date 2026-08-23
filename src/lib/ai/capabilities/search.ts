import type { RetrievalResult } from "../../../api/ai-learning";
import type { PlatformCapabilityDescriptor } from "./types";

export const RAG_NAMESPACE_LIBRARY = "library";
export const RAG_NAMESPACE_HELP = "help";

export type RagNamespace = typeof RAG_NAMESPACE_LIBRARY | typeof RAG_NAMESPACE_HELP;

export type SemanticRetrieverId = "ai_learning" | "appsearch-hybrid" | "document-only";

export interface SemanticRetrieveRequest {
  query: string;
  k?: number;
  documentId?: string;
  namespace: RagNamespace;
}

export interface SemanticRetriever {
  readonly id: SemanticRetrieverId;
  getCapability(): Promise<PlatformCapabilityDescriptor>;
  retrieve(req: SemanticRetrieveRequest): Promise<RetrievalResult[]>;
}
