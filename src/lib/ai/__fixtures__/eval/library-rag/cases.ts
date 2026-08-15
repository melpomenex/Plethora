/**
 * Evaluation fixtures for the "Ask library" RAG task (design D29, task 4.12).
 *
 * Labeled cases covering the ai-library-rag spec scenarios: relevant
 * retrieval, unanswerable queries (honest none), multi-document answers,
 * conflicting sources, and citation violations (fabricated refId / ungrounded
 * quote → dropped by the validator). Each fixture replays a deterministic
 * canned structured output through the REAL `askLibrary` pipeline
 * (retrieve-injection + `runTask` + validation) via `FakeAIProvider`; tests
 * assert structure (evidence level, ref survival, containment), never prose.
 */

import type { RetrievalResult } from "../../../../../api/ai-learning";

export interface LibraryRagEvalCase {
  label: string;
  /** The user's question. */
  query: string;
  /** Chunks the (fake) retrieval step returns, in rank order. */
  retrieved: RetrievalResult[];
  /** Raw model output as a strict-JSON text response. */
  responseText: string;
  /** Expected surviving evidenceLevel after validation. */
  expectedEvidenceLevel: "supported" | "weak" | "none" | "conflicting";
  /** Chunk ids whose refs must survive validation. */
  expectedCitedChunkIds: string[];
  /** Document ids the surviving refs must span (multi-doc assertion). */
  expectedCitedDocumentIds?: string[];
}

/** Deterministic chunk builder keeping fixtures terse. */
function chunk(
  chunkId: string,
  documentId: string,
  documentTitle: string,
  text: string,
  ordinal = 0,
  overrides: Partial<RetrievalResult> = {}
): RetrievalResult {
  return {
    chunkId,
    documentId,
    documentTitle,
    sourceType: "document",
    ordinal,
    text,
    headingPath: [],
    location: {
      sourceType: "text",
      documentId,
      ordinal,
      startOffset: 0,
      endOffset: text.length,
    },
    contentHash: `hash-${chunkId}`,
    tokenCount: Math.ceil(text.length / 4),
    score: 0.9,
    mode: "semantic",
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Library corpus
// ──────────────────────────────────────────────────────────────────────────

const PHOTOSYNTHESIS_TEXT =
  "Photosynthesis converts light energy into chemical energy: the light-dependent reactions in the thylakoid membranes split water and produce ATP and NADPH, releasing oxygen as a byproduct.";

const RESPIRATION_TEXT =
  "Cellular respiration breaks down glucose in the mitochondria to produce ATP, consuming oxygen and releasing carbon dioxide — effectively the reverse of photosynthesis.";

const KREBS_NOTE_TEXT =
  "The Krebs cycle (citric acid cycle) oxidizes acetyl-CoA in the mitochondrial matrix, generating NADH and FADH2 for the electron transport chain.";

const OSMOSIS_TEXT =
  "Osmosis is the diffusion of water across a semipermeable membrane from lower to higher solute concentration until equilibrium is reached.";

const BERLIN_HISTORY_TEXT =
  "The Berlin Wall fell on November 9, 1989, and German reunification followed on October 3, 1990.";

const WALL_CONFLICT_A =
  "The Berlin Wall was torn down by civilians on the night of November 9, 1989, after a mistaken press conference announcement.";

const WALL_CONFLICT_B =
  "Official demolition of the Berlin Wall by border troops did not begin until June 13, 1990; the November 1989 opening was only at a few checkpoints.";

const DOC_BIO = "doc-biology";
const DOC_NOTES = "doc-notes";
const DOC_HISTORY = "doc-history";

// ──────────────────────────────────────────────────────────────────────────
// Cases
// ──────────────────────────────────────────────────────────────────────────

/** Relevant retrieval: the answer cites the correct chunk with a verbatim quote. */
export const RELEVANT_CASE: LibraryRagEvalCase = {
  label: "relevant-retrieval",
  query: "How does photosynthesis produce oxygen?",
  retrieved: [
    chunk("chunk-photo-1", DOC_BIO, "Biology Textbook", PHOTOSYNTHESIS_TEXT),
    chunk("chunk-resp-1", DOC_BIO, "Biology Textbook", RESPIRATION_TEXT, 1),
  ],
  responseText: JSON.stringify({
    answer:
      "The light-dependent reactions split water molecules, releasing oxygen as a byproduct [1].",
    sourceRefs: [
      {
        refId: "chunk-photo-1",
        quote: "split water and produce ATP and NADPH, releasing oxygen as a byproduct",
      },
    ],
    evidenceLevel: "supported",
  }),
  expectedEvidenceLevel: "supported",
  expectedCitedChunkIds: ["chunk-photo-1"],
};

/** Unanswerable: nothing in the library matches — honest refusal, no refs. */
export const UNANSWERABLE_CASE: LibraryRagEvalCase = {
  label: "unanswerable-honest-none",
  query: "What is the airspeed velocity of an unladen swallow?",
  retrieved: [
    chunk("chunk-photo-1", DOC_BIO, "Biology Textbook", PHOTOSYNTHESIS_TEXT),
    chunk("chunk-osmo-1", DOC_BIO, "Biology Textbook", OSMOSIS_TEXT, 1),
  ],
  responseText: JSON.stringify({
    answer:
      "Your library does not appear to cover this question — the retrieved chunks discuss photosynthesis and osmosis, not bird flight.",
    sourceRefs: [],
    evidenceLevel: "none",
  }),
  expectedEvidenceLevel: "none",
  expectedCitedChunkIds: [],
};

/** Multi-document: refs from two different documents survive. */
export const MULTI_DOCUMENT_CASE: LibraryRagEvalCase = {
  label: "multi-document-refs",
  query: "Where does the energy in cells ultimately come from and go?",
  retrieved: [
    chunk("chunk-photo-1", DOC_BIO, "Biology Textbook", PHOTOSYNTHESIS_TEXT),
    chunk("chunk-krebs-1", DOC_NOTES, "Lecture Notes", KREBS_NOTE_TEXT),
  ],
  responseText: JSON.stringify({
    answer:
      "Light energy enters through photosynthesis [1] and is carried through the Krebs cycle's electron carriers [2].",
    sourceRefs: [
      {
        refId: "chunk-photo-1",
        quote: "Photosynthesis converts light energy into chemical energy",
      },
      { refId: "chunk-krebs-1", quote: "generating NADH and FADH2 for the electron transport chain" },
    ],
    evidenceLevel: "supported",
  }),
  expectedEvidenceLevel: "supported",
  expectedCitedChunkIds: ["chunk-photo-1", "chunk-krebs-1"],
  expectedCitedDocumentIds: [DOC_BIO, DOC_NOTES],
};

/** Conflicting sources: the answer reports the disagreement with both citations. */
export const CONFLICTING_CASE: LibraryRagEvalCase = {
  label: "conflicting-sources",
  query: "When was the Berlin Wall actually demolished?",
  retrieved: [
    chunk("chunk-wall-a", DOC_HISTORY, "Modern History", WALL_CONFLICT_A),
    chunk("chunk-wall-b", DOC_HISTORY, "Modern History", WALL_CONFLICT_B, 1),
    chunk("chunk-berlin-1", DOC_HISTORY, "Modern History", BERLIN_HISTORY_TEXT, 2),
  ],
  responseText: JSON.stringify({
    answer:
      "Your sources disagree: one says civilians tore it down the night of November 9, 1989 [1], the other says official demolition only began June 13, 1990 [2]. Both agree on the 1989 opening.",
    sourceRefs: [
      { refId: "chunk-wall-a", quote: "torn down by civilians on the night of November 9, 1989" },
      {
        refId: "chunk-wall-b",
        quote: "official demolition of the Berlin Wall by border troops did not begin until June 13, 1990",
      },
    ],
    evidenceLevel: "conflicting",
  }),
  expectedEvidenceLevel: "conflicting",
  expectedCitedChunkIds: ["chunk-wall-a", "chunk-wall-b"],
};

/**
 * Citation violations: the model invents a refId and misquotes a real chunk —
 * the validator must drop every fabricated ref, and "supported" with zero
 * surviving refs must normalize to an unbacked "none".
 */
export const CITATION_VIOLATION_CASE: LibraryRagEvalCase = {
  label: "citation-violations-dropped",
  query: "What is osmosis?",
  retrieved: [chunk("chunk-osmo-1", DOC_BIO, "Biology Textbook", OSMOSIS_TEXT)],
  responseText: JSON.stringify({
    answer:
      "Osmosis is water diffusion across a membrane [1] [2] [3], and also the fall of the Berlin Wall [4].",
    sourceRefs: [
      // Fabricated chunk id that was never retrieved.
      { refId: "chunk-invented-999", quote: "diffusion of water" },
      // Real chunk id, but the quote does not appear in it.
      {
        refId: "chunk-osmo-1",
        quote: "osmosis is the quantum tunneling of hydrogen bonds",
      },
      // Duplicate of a dropped ref shape.
      { refId: "chunk-invented-999", quote: "diffusion of water" },
    ],
    evidenceLevel: "supported",
  }),
  expectedEvidenceLevel: "none",
  expectedCitedChunkIds: [],
};

/** Weak evidence: only an indirect chunk matches — level stays weak with its ref. */
export const WEAK_EVIDENCE_CASE: LibraryRagEvalCase = {
  label: "weak-evidence",
  query: "Do plant cells perform respiration at night?",
  retrieved: [chunk("chunk-resp-1", DOC_BIO, "Biology Textbook", RESPIRATION_TEXT)],
  responseText: JSON.stringify({
    answer:
      "The library only states that respiration breaks down glucose to produce ATP [1]; it does not directly discuss night-time respiration in plants.",
    sourceRefs: [
      {
        refId: "chunk-resp-1",
        quote: "breaks down glucose in the mitochondria to produce ATP",
      },
    ],
    evidenceLevel: "weak",
  }),
  expectedEvidenceLevel: "weak",
  expectedCitedChunkIds: ["chunk-resp-1"],
};

/** Near-duplicate chunks: the diversity dedup keeps only the first copy. */
export const DUPLICATE_CHUNKS_CASE: LibraryRagEvalCase = {
  label: "near-duplicate-chunks-deduped",
  query: "What is osmosis?",
  retrieved: [
    chunk("chunk-osmo-1", DOC_BIO, "Biology Textbook", OSMOSIS_TEXT),
    // Same normalized text as chunk-osmo-1 (different whitespace/case).
    chunk(
      "chunk-osmo-dup",
      DOC_BIO,
      "Biology Textbook",
      `  osmosis is the diffusion of water across a semipermeable membrane from lower to higher solute concentration until equilibrium is reached.  `,
      2
    ),
  ],
  responseText: JSON.stringify({
    answer: "Osmosis is water diffusion across a semipermeable membrane [1].",
    sourceRefs: [
      {
        refId: "chunk-osmo-1",
        quote: "diffusion of water across a semipermeable membrane",
      },
    ],
    evidenceLevel: "supported",
  }),
  expectedEvidenceLevel: "supported",
  expectedCitedChunkIds: ["chunk-osmo-1"],
};

export const ALL_LIBRARY_RAG_EVAL_CASES: LibraryRagEvalCase[] = [
  RELEVANT_CASE,
  UNANSWERABLE_CASE,
  MULTI_DOCUMENT_CASE,
  CONFLICTING_CASE,
  CITATION_VIOLATION_CASE,
  WEAK_EVIDENCE_CASE,
  DUPLICATE_CHUNKS_CASE,
];
