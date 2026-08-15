/**
 * Evaluation fixtures for the OCR-backed occlusion task (design D29, task
 * 3.9).
 *
 * Cases: labeled diagram (happy path with grouping + rejection), dense
 * diagram (label cap before the model), non-educational image (verdict path
 * plus the adversarial "verdict mismatch" variant), and OCR/model failure.
 * Each fixture replays a deterministic canned output through the REAL
 * `runTask` + validation pipeline via `FakeAIProvider` — tests assert
 * structural semantics (label-id references, grouping, caps, verdicts),
 * never exact prose.
 */

import type { OcclusionLabelCandidate } from "../../../tasks/definitions/occlusionTask";

export interface OcclusionEvalCase {
  label: string;
  /** OCR labels the flow feeds the task (already filter-surviving sizes). */
  labels: OcclusionLabelCandidate[];
  /** Raw model output: strict-JSON text replayed by the fake provider. */
  responseText?: string;
  /** When set, the fake provider throws this instead of responding. */
  responseError?: Error;
  /** Structural expectations (never prose). */
  expect: {
    appropriate?: boolean;
    selectionCount?: number;
    /** label ids that must all be referenced by some selection (or [] for any). */
    referencedLabelIds?: string[];
    rejectedCount?: number;
    /** Expected failure category for adversarial/failure cases. */
    errorCategory?: string;
  };
}

export function evalLabel(id: string, text: string, x = 10, y = 10): OcclusionLabelCandidate {
  return { id, text, x, y, width: 8, height: 3 };
}

export const OCCLUSION_EVAL_CASES: OcclusionEvalCase[] = [
  {
    label: "labeled-diagram",
    labels: [
      evalLabel("ocr-0-a1", "Mitochondria", 5, 10),
      evalLabel("ocr-1-b2", "Ribosome", 40, 12),
      evalLabel("ocr-2-c3", "Golgi apparatus", 70, 15),
      evalLabel("ocr-3-d4", "Figure 3.1 — animal cell", 30, 90),
      evalLabel("ocr-4-e5", "12", 95, 95),
    ],
    responseText: JSON.stringify({
      appropriate: true,
      selections: [
        {
          labelIds: ["ocr-0-a1", "ocr-1-b2"],
          question: "Which organelle is shown?",
          answer: "Mitochondria and ribosome",
        },
        {
          labelIds: ["ocr-2-c3"],
          question: "What does the Golgi apparatus do?",
          answer: "Packages proteins for transport",
        },
      ],
      rejected: [
        { labelId: "ocr-3-d4", reason: "figure caption, not a testable label" },
        { labelId: "ocr-4-e5", reason: "page number" },
      ],
    }),
    expect: {
      appropriate: true,
      selectionCount: 2,
      referencedLabelIds: ["ocr-0-a1", "ocr-1-b2", "ocr-2-c3"],
      rejectedCount: 2,
    },
  },
  {
    label: "dense-diagram",
    labels: Array.from({ length: 30 }, (_, index) =>
      evalLabel(`ocr-${index}-${index.toString(16)}`, `Part ${index}`, (index % 6) * 15, (index % 5) * 18)
    ),
    responseText: JSON.stringify({
      appropriate: true,
      selections: Array.from({ length: 8 }, (_, index) => ({
        labelIds: [`ocr-${index}-${index.toString(16)}`],
        question: `Identify part ${index}`,
        answer: `Part ${index}`,
      })),
      rejected: [],
    }),
    expect: {
      appropriate: true,
      // MAX_OCCLUSION_SELECTIONS = 8 caps even a dense proposal.
      selectionCount: 8,
      rejectedCount: 0,
    },
  },
  {
    label: "non-educational-photo",
    labels: [
      evalLabel("ocr-0-a1", "IMG_2043.jpg"),
      evalLabel("ocr-1-b2", "Aug 2026"),
    ],
    responseText: JSON.stringify({
      appropriate: false,
      selections: [],
      rejected: [
        { labelId: "ocr-0-a1", reason: "filename watermark" },
        { labelId: "ocr-1-b2", reason: "timestamp, not study content" },
      ],
    }),
    expect: {
      appropriate: false,
      selectionCount: 0,
      rejectedCount: 2,
    },
  },
  {
    label: "adversarial-verdict-mismatch",
    labels: [evalLabel("ocr-0-a1", "Nucleus")],
    // inappropriate=true is impossible with selections present: the validator
    // must fail closed rather than emit a half-verdict.
    responseText: JSON.stringify({
      appropriate: false,
      selections: [{ labelIds: ["ocr-0-a1"], question: "q", answer: "a" }],
      rejected: [],
    }),
    expect: { errorCategory: "InvalidStructuredOutput" },
  },
  {
    label: "adversarial-hallucinated-ids",
    labels: [evalLabel("ocr-0-a1", "Nucleus")],
    responseText: JSON.stringify({
      appropriate: true,
      selections: [{ labelIds: ["ocr-99-zz"], question: "q", answer: "a" }],
      rejected: [],
    }),
    expect: { errorCategory: "InvalidStructuredOutput" },
  },
  {
    label: "model-failure-after-ocr",
    labels: [evalLabel("ocr-0-a1", "Nucleus")],
    responseError: new Error("on-device inference failed"),
    expect: { errorCategory: "GenerationFailed" },
  },
];
