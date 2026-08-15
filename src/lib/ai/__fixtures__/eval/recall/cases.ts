/**
 * Evaluation fixtures for the recall-question task (task 5.1, design D19).
 *
 * Deterministic canned structured outputs replayed through the REAL
 * `runTask` + validation pipeline via `FakeAIProvider`. Assertions are
 * structural (chunk-ref grounding, validated envelope shape), never prose.
 *
 * The adversarial case hallucinates a chunk id that was not part of the
 * input — the validator must reject it and the strict-JSON repair path must
 * fail closed (`InvalidStructuredOutput`).
 */

export interface RecallEvalCase {
  label: string;
  chunks: { id: string; text: string }[];
  documentTitle?: string;
  /** Raw model output, as a strict-JSON text response. */
  responseText: string;
}

const CHUNK_A = {
  id: "chunk-0001",
  text: "Virtual memory lets a process address more memory than is physically installed by mapping virtual addresses onto a mix of RAM and disk-backed pages. The virtual address space is per-process; the page table maps virtual pages to physical frames, and the OS evicts cold pages to a paging file on disk when RAM is full.",
};

const CHUNK_B = {
  id: "chunk-0002",
  text: "A page fault occurs when a process touches a virtual page that is not currently mapped in physical RAM. The kernel handles the fault by loading the page from disk, updating the page table, and resuming the instruction. Major faults require disk I/O; minor faults only update mappings.",
};

export const RECALL_EVAL_CASES: RecallEvalCase[] = [
  {
    label: "single-chunk-definition",
    chunks: [CHUNK_A],
    documentTitle: "Operating Systems",
    responseText: JSON.stringify({
      question: "Why can a process address more memory than is physically installed?",
      expectedAnswer:
        "Virtual memory maps virtual addresses onto a mix of RAM and disk-backed pages, so the virtual address space is not limited by physical RAM.",
      conceptKeys: ["virtual memory", "paging"],
      chunkRefs: ["chunk-0001"],
    }),
  },
  {
    label: "two-chunk-cross-reference",
    chunks: [CHUNK_A, CHUNK_B],
    documentTitle: "Operating Systems",
    responseText: JSON.stringify({
      question: "What happens when a process touches a virtual page that is not in RAM?",
      expectedAnswer:
        "A page fault occurs; the kernel loads the page from disk, updates the page table, and resumes the instruction.",
      conceptKeys: ["page fault", "page table"],
      chunkRefs: ["chunk-0002"],
    }),
  },
];

export const RECALL_NEAR_DUPLICATE_CASES = [
  "Why can a process address more memory than is physically installed?",
  "Why can a process address more memory than the installed physical RAM?",
];

/** Adversarial: references a chunk id that was never provided. */
export const RECALL_ADVERSARIAL_HALLUCINATED_REF: RecallEvalCase = {
  label: "adversarial-hallucinated-chunk-ref",
  chunks: [CHUNK_A],
  documentTitle: "Operating Systems",
  responseText: JSON.stringify({
    question: "What does the page-fault handler do?",
    expectedAnswer: "Loads the page from disk and resumes the instruction.",
    conceptKeys: ["page fault"],
    chunkRefs: ["chunk-9999"],
  }),
};

/** Malformed envelope: missing expectedAnswer entirely. */
export const RECALL_MALFORMED_CASE: RecallEvalCase = {
  label: "malformed-missing-answer",
  chunks: [CHUNK_A],
  responseText: JSON.stringify({
    question: "Why can a process address more memory than is physically installed?",
    conceptKeys: ["virtual memory"],
    chunkRefs: ["chunk-0001"],
  }),
};

export const CHUNK_FIXTURES = { CHUNK_A, CHUNK_B };
