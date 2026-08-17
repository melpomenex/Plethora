import { RagCitation } from './rag';
import { ConnectionRelation } from './connections';

export type ConceptNodeType = 'concept' | 'person' | 'work' | 'claim' | 'definition';

export interface ConceptNode {
  id: string;
  name: string;
  type: ConceptNodeType;
  definition?: string;
  aliases: string[];
  provenance: RagCitation[];
  createdAt: string;
}

export interface ConceptEdge {
  id: string;
  fromId: string;
  toId: string;
  relation: ConnectionRelation;
  confidence: number;
  evidence: RagCitation[];
  createdBy: 'ai' | 'user';
  createdAt: string;
}

export interface KnowledgeGraphData {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
}
