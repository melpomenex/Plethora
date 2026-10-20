/**
 * Per-run evidence map for source-grounded agent proposals (task 3.1).
 *
 * Proposal authority is application-assigned, never model-assigned:
 *
 *  - every read/retrieval tool registers the records it actually returned in
 *    this run's evidence map and gets back an opaque handle (`s1`, `s2`, …);
 *  - proposal tools accept an optional `sourceHandle` and can only resolve it
 *    through this map — a model string cannot manufacture a source;
 *  - the map stores the exact source text, durable record id and locator, so
 *    the handoff can validate grounding and build the existing
 *    `CardSourceReference`/AI provenance without inventing a new schema.
 *
 * Nothing here persists. Evidence dies with the run; the conversation
 * artifact keeps only source references and draft text.
 */

import type {
  AgentProposalSourceRef,
  AgentSourceRef,
} from "./tools/types";

export type AgentEvidenceKind =
  | "chunk"
  | "card"
  | "document"
  | "extract"
  | "selection"
  | "image";

export interface AgentEvidenceEntry {
  /** Application-assigned handle the model may cite (`s1`). */
  readonly handle: string;
  readonly kind: AgentEvidenceKind;
  /** Navigable source ref surfaced beside the answer and stored on drafts. */
  readonly sourceRef: AgentSourceRef;
  /** Exact source text returned by the tool (may be empty for document ids). */
  readonly text: string;
  readonly documentId?: string;
  /** Durable record id (chunk/card/extract/document/image). */
  readonly recordId: string;
  readonly locator?: string;
  readonly title?: string;
  /** Frozen source revision/version for staleness checks. */
  readonly sourceRevision?: string;
}

export interface RegisterEvidenceInput {
  kind: AgentEvidenceKind;
  recordId: string;
  text: string;
  documentId?: string;
  title?: string;
  locator?: string;
  sourceRevision?: string;
  /** Optional explicit handle (tests/fixtures); otherwise auto-assigned. */
  handle?: string;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export class AgentEvidenceMap {
  private readonly entries = new Map<string, AgentEvidenceEntry>();
  private nextHandle = 1;

  constructor(private readonly defaultRevision?: string) {}

  register(input: RegisterEvidenceInput): AgentEvidenceEntry {
    const handle =
      input.handle && !this.entries.has(input.handle)
        ? input.handle
        : `s${this.nextHandle++}`;
    if (input.handle && this.entries.has(input.handle)) {
      return this.entries.get(input.handle)!;
    }
    const sourceKind: AgentSourceRef["kind"] =
      input.kind === "chunk"
        ? "chunk"
        : input.kind === "card"
          ? "card"
          : input.kind === "extract"
            ? "extract"
            : "document";
    const entry: AgentEvidenceEntry = {
      handle,
      kind: input.kind,
      recordId: input.recordId,
      text: input.text,
      documentId: input.documentId,
      title: input.title,
      locator: input.locator,
      sourceRevision: input.sourceRevision ?? this.defaultRevision,
      sourceRef: {
        refId: input.recordId,
        kind: sourceKind,
        documentId: input.documentId,
        title: input.title,
        locator: input.locator,
      },
    };
    this.entries.set(handle, entry);
    return entry;
  }

  resolve(handle: string | undefined): AgentEvidenceEntry | undefined {
    if (!handle) return undefined;
    return this.entries.get(handle.trim());
  }

  /** All entries in registration order (prompt/catalog display). */
  list(): AgentEvidenceEntry[] {
    return [...this.entries.values()];
  }

  size(): number {
    return this.entries.size;
  }

  /**
   * Deterministic containment search: the proposal text must appear verbatim
   * (whitespace/case-normalized) inside a source the run actually resolved.
   */
  findContaining(text: string): AgentEvidenceEntry | undefined {
    const needle = normalizeText(text);
    if (!needle) return undefined;
    for (const entry of this.entries.values()) {
      if (!entry.text) continue;
      if (normalizeText(entry.text).includes(needle)) return entry;
    }
    return undefined;
  }

  /** Prefer a chunk/extract entry that contains the evidence quote. */
  findContainingQuote(quote: string | undefined): AgentEvidenceEntry | undefined {
    if (!quote || !quote.trim()) return undefined;
    return this.findContaining(quote);
  }

  toProposalSourceRef(entry: AgentEvidenceEntry): AgentProposalSourceRef {
    return {
      ...entry.sourceRef,
      handle: entry.handle,
      contentVersion: entry.sourceRevision,
      sourceRevision: entry.sourceRevision,
      text: entry.text,
    };
  }
}

/** True when the text appears verbatim in the entry (normalized whitespace). */
export function entryContainsText(
  entry: AgentEvidenceEntry,
  text: string
): boolean {
  const needle = normalizeText(text);
  return needle.length > 0 && normalizeText(entry.text).includes(needle);
}

/** Factory used by the loop; keeps construction injectable. */
export function createAgentEvidenceMap(
  sourceRevision?: string
): AgentEvidenceMap {
  return new AgentEvidenceMap(sourceRevision);
}
