import { describe, expect, it } from "vitest";
import {
  ALL_CONCEPT_RELATIONSHIP_TYPES,
  CONCEPT_RELATIONSHIP_METADATA,
  computeAdaptiveProgression,
  isLikelyFrontMatterHeading,
  validateCurriculumGraph,
  verifySourceGrounding,
  type AdaptiveCurriculumNode,
  type AvailableSourceRecord,
  type ConceptRelationshipEdge,
} from "../adaptiveCurriculum";
import { projectConceptProfile } from "../../learner-model/competencyEstimator";
import type {
  CompetencyDimension,
  CompetencyEvidenceRecord,
  ConceptCompetencyProfile,
} from "../../../types/learnerModel";

const NOW_ISO = "2026-11-28T12:00:00.000Z";

function makeEvidence(
  overrides: Partial<CompetencyEvidenceRecord> & {
    id: string;
    conceptId: string;
    dimension: CompetencyDimension;
  },
): CompetencyEvidenceRecord {
  return {
    sourceKind: "exam_grade",
    sourceEventId: `evt-${overrides.id}`,
    sourceRecordId: `rec-${overrides.id}`,
    evidenceGroupId: `grp-${overrides.id}`,
    cardFamilyId: null,
    sessionId: "sess-1",
    observedScore: 0.95,
    baseWeight: 1.2,
    elapsedDays: 5,
    hintLevel: 0,
    isVerified: true,
    isInvalidated: false,
    invalidatedByEventId: null,
    documentId: "doc-1",
    isLocalOnly: false,
    isAiExcluded: false,
    occurredAt: "2026-11-25T12:00:00.000Z",
    policyVersion: "competency-v1",
    createdAt: "2026-11-25T12:00:00.000Z",
    ...overrides,
  };
}

function makeDemonstratedProfile(conceptId: string): ConceptCompetencyProfile {
  // Two independent groups across two distinct days for both comprehension and retention
  const records: CompetencyEvidenceRecord[] = [
    makeEvidence({
      id: `${conceptId}-comp-1`,
      conceptId,
      dimension: "comprehension",
      evidenceGroupId: `${conceptId}-g1`,
      occurredAt: "2026-11-20T12:00:00.000Z",
      observedScore: 0.92,
      baseWeight: 1.5,
    }),
    makeEvidence({
      id: `${conceptId}-comp-2`,
      conceptId,
      dimension: "comprehension",
      evidenceGroupId: `${conceptId}-g2`,
      occurredAt: "2026-11-25T12:00:00.000Z",
      observedScore: 0.95,
      baseWeight: 1.5,
    }),
    makeEvidence({
      id: `${conceptId}-ret-1`,
      conceptId,
      dimension: "retention",
      sourceKind: "fsrs_review",
      evidenceGroupId: `${conceptId}-r1`,
      occurredAt: "2026-11-20T12:00:00.000Z",
      observedScore: 0.9,
      baseWeight: 1.5,
      elapsedDays: 4,
    }),
    makeEvidence({
      id: `${conceptId}-ret-2`,
      conceptId,
      dimension: "retention",
      sourceKind: "fsrs_review",
      evidenceGroupId: `${conceptId}-r2`,
      occurredAt: "2026-11-26T12:00:00.000Z",
      observedScore: 0.95,
      baseWeight: 1.5,
      elapsedDays: 6,
    }),
  ];
  return projectConceptProfile(conceptId, records, null, NOW_ISO);
}

function makeExposureOnlyProfile(conceptId: string): ConceptCompetencyProfile {
  const records: CompetencyEvidenceRecord[] = [
    makeEvidence({
      id: `${conceptId}-exp-1`,
      conceptId,
      dimension: "exposure",
      sourceKind: "reading_progress",
      evidenceGroupId: `${conceptId}-e1`,
      occurredAt: "2026-11-24T12:00:00.000Z",
      observedScore: 1.0,
      baseWeight: 1.5,
    }),
    makeEvidence({
      id: `${conceptId}-exp-2`,
      conceptId,
      dimension: "exposure",
      sourceKind: "extract_created",
      evidenceGroupId: `${conceptId}-e2`,
      occurredAt: "2026-11-26T12:00:00.000Z",
      observedScore: 1.0,
      baseWeight: 1.5,
    }),
  ];
  return projectConceptProfile(
    conceptId,
    records,
    {
      conceptId,
      declaredLevel: "confident",
      note: "I read the chapter once",
      updatedAt: NOW_ISO,
    },
    NOW_ISO,
  );
}

describe("adaptiveCurriculum — 7 relationship types & graph validation", () => {
  it("defines all 7 canonical conceptual relationship types with accurate DAG metadata", () => {
    expect(ALL_CONCEPT_RELATIONSHIP_TYPES).toEqual([
      "requires",
      "builds_upon",
      "related_to",
      "example_of",
      "contrasts_with",
      "applies",
      "alternative_explanation_of",
    ]);

    expect(CONCEPT_RELATIONSHIP_METADATA.requires.enforcesAcyclicity).toBe(true);
    expect(CONCEPT_RELATIONSHIP_METADATA.requires.affectsPrerequisiteGating).toBe(true);

    for (const rel of ALL_CONCEPT_RELATIONSHIP_TYPES) {
      if (rel === "requires") continue;
      expect(CONCEPT_RELATIONSHIP_METADATA[rel].enforcesAcyclicity).toBe(false);
      expect(CONCEPT_RELATIONSHIP_METADATA[rel].affectsPrerequisiteGating).toBe(false);
    }
  });

  it("detects cycles ONLY in the hard requires subgraph and reports CYCLE_DETECTED with exact path", () => {
    const nodes: AdaptiveCurriculumNode[] = [
      { id: "n1", title: "Trees", conceptIds: ["c1"], position: 0 },
      { id: "n2", title: "Binary Search Trees", conceptIds: ["c2"], position: 1 },
      { id: "n3", title: "AVL Balancing", conceptIds: ["c3"], position: 2 },
    ];
    const edges: ConceptRelationshipEdge[] = [
      {
        id: "e1",
        sourceNodeId: "n1",
        targetNodeId: "n2",
        relationshipType: "requires",
        provenance: "source_verified",
        confidence: 1.0,
        sourceRefIds: ["src-1"],
      },
      {
        id: "e2",
        sourceNodeId: "n2",
        targetNodeId: "n3",
        relationshipType: "requires",
        provenance: "source_verified",
        confidence: 1.0,
        sourceRefIds: ["src-1"],
      },
      {
        id: "e3",
        sourceNodeId: "n3",
        targetNodeId: "n1",
        relationshipType: "requires",
        provenance: "user_authored",
        confidence: 1.0,
        sourceRefIds: [],
      },
    ];

    const result = validateCurriculumGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.topologicalOrder).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("CYCLE_DETECTED");
    expect(result.errors[0].cyclePath).toEqual(["n1", "n2", "n3", "n1"]);
  });

  it("allows cycles in non-blocking associative edges (related_to, contrasts_with, alternative_explanation_of)", () => {
    const nodes: AdaptiveCurriculumNode[] = [
      { id: "n1", title: "DFS", conceptIds: ["c1"], position: 0 },
      { id: "n2", title: "BFS", conceptIds: ["c2"], position: 1 },
      { id: "n3", title: "Dijkstra", conceptIds: ["c3"], position: 2 },
    ];
    const edges: ConceptRelationshipEdge[] = [
      {
        id: "e-req",
        sourceNodeId: "n2",
        targetNodeId: "n3",
        relationshipType: "requires",
        provenance: "source_verified",
        confidence: 1.0,
        sourceRefIds: ["src-1"],
      },
      {
        id: "e-rel-1",
        sourceNodeId: "n1",
        targetNodeId: "n2",
        relationshipType: "related_to",
        provenance: "source_verified",
        confidence: 0.9,
        sourceRefIds: ["src-1"],
      },
      {
        id: "e-rel-2",
        sourceNodeId: "n2",
        targetNodeId: "n1",
        relationshipType: "related_to",
        provenance: "source_verified",
        confidence: 0.9,
        sourceRefIds: ["src-1"],
      },
      {
        id: "e-con-1",
        sourceNodeId: "n1",
        targetNodeId: "n2",
        relationshipType: "contrasts_with",
        provenance: "user_authored",
        confidence: 1.0,
        sourceRefIds: [],
      },
      {
        id: "e-con-2",
        sourceNodeId: "n2",
        targetNodeId: "n1",
        relationshipType: "contrasts_with",
        provenance: "user_authored",
        confidence: 1.0,
        sourceRefIds: [],
      },
      {
        id: "e-alt",
        sourceNodeId: "n3",
        targetNodeId: "n2",
        relationshipType: "alternative_explanation_of",
        provenance: "ai_inferred",
        confidence: 0.8,
        sourceRefIds: ["src-2"],
      },
    ];

    const result = validateCurriculumGraph(nodes, edges);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.cyclePaths).toHaveLength(0);
    expect(result.topologicalOrder).toEqual(["n1", "n2", "n3"]);
  });

  it("flags duplicate edges and front-matter/TOC pseudo-prerequisites without false-positiving real topics", () => {
    expect(isLikelyFrontMatterHeading("Table of Contents")).toBe(true);
    expect(isLikelyFrontMatterHeading("0.1 Preface")).toBe(true);
    expect(isLikelyFrontMatterHeading("iv. Acknowledgements")).toBe(true);
    expect(isLikelyFrontMatterHeading("Copyright Page")).toBe(true);
    expect(isLikelyFrontMatterHeading("B-Tree Index Structures")).toBe(false);
    expect(isLikelyFrontMatterHeading("Reference Counting")).toBe(false);
    expect(isLikelyFrontMatterHeading("Content-Addressable Storage")).toBe(false);

    const nodes: AdaptiveCurriculumNode[] = [
      { id: "toc", title: "Table of Contents", conceptIds: [], position: 0 },
      { id: "n1", title: "B-Tree Index Structures", conceptIds: ["c1"], position: 1 },
      { id: "n2", title: "Query Planning", conceptIds: ["c2"], position: 2 },
    ];
    const edges: ConceptRelationshipEdge[] = [
      {
        id: "e-fm",
        sourceNodeId: "toc",
        targetNodeId: "n1",
        relationshipType: "requires",
        provenance: "ai_inferred",
        confidence: 0.9,
        sourceRefIds: ["src-1"],
      },
      {
        id: "e-dup-1",
        sourceNodeId: "n1",
        targetNodeId: "n2",
        relationshipType: "requires",
        provenance: "source_verified",
        confidence: 1.0,
        sourceRefIds: ["src-1"],
      },
      {
        id: "e-dup-2",
        sourceNodeId: "n1",
        targetNodeId: "n2",
        relationshipType: "requires",
        provenance: "user_authored",
        confidence: 1.0,
        sourceRefIds: [],
      },
    ];

    const result = validateCurriculumGraph(nodes, edges);
    expect(result.valid).toBe(true);
    expect(result.duplicateEdgeIds).toEqual(["e-dup-2"]);
    expect(result.frontMatterNodeIds).toEqual(["toc"]);
    expect(result.warnings.some((w) => w.code === "DUPLICATE_EDGE")).toBe(true);
    expect(result.warnings.some((w) => w.code === "FRONT_MATTER_PREREQUISITE")).toBe(true);
  });
});

describe("adaptiveCurriculum — computeAdaptiveProgression", () => {
  it("marks nodes with verified demonstrated prior competency as demonstrated_prior non-destructively and unlocks downstream nodes", () => {
    const nodes: AdaptiveCurriculumNode[] = [
      { id: "n1", title: "Binary Trees", conceptIds: ["c-trees"], position: 0 },
      { id: "n2", title: "BST Operations", conceptIds: ["c-bst"], position: 1 },
      { id: "n3", title: "Red-Black Trees", conceptIds: ["c-rbt"], position: 2 },
    ];
    const edges: ConceptRelationshipEdge[] = [
      {
        id: "e1",
        sourceNodeId: "n1",
        targetNodeId: "n2",
        relationshipType: "requires",
        provenance: "source_verified",
        confidence: 1.0,
        sourceRefIds: ["src-1"],
      },
      {
        id: "e2",
        sourceNodeId: "n2",
        targetNodeId: "n3",
        relationshipType: "requires",
        provenance: "source_verified",
        confidence: 1.0,
        sourceRefIds: ["src-1"],
      },
    ];

    const profiles = new Map<string, ConceptCompetencyProfile>([
      ["c-trees", makeDemonstratedProfile("c-trees")],
    ]);

    const progression = computeAdaptiveProgression(nodes, edges, profiles);

    expect(progression.nodeStates.n1.status).toBe("demonstrated_prior");
    expect(progression.nodeStates.n1.skippable).toBe(true);
    expect(progression.nodeStates.n1.reviewable).toBe(true);
    expect(progression.skippedPriorNodeIds).toEqual(["n1"]);

    // Downstream n2 is unlocked because n1 is demonstrated_prior
    expect(progression.nodeStates.n2.status).toBe("ready");
    expect(progression.recommendedNextNodeIds).toEqual(["n2"]);

    // n3 is advisory_blocked on n2, but never permanently locked (canBypass: true)
    expect(progression.nodeStates.n3.status).toBe("advisory_blocked");
    expect(progression.nodeStates.n3.canBypass).toBe(true);
    expect(progression.nodeStates.n3.unmetPrerequisiteNodeIds).toEqual(["n2"]);
  });

  it("NEVER skips a node based on exposure alone, self-declaration, or unverified AI chat", () => {
    const nodes: AdaptiveCurriculumNode[] = [
      { id: "n-exp", title: "Pointers", conceptIds: ["c-ptr"], position: 0 },
      { id: "n-unverified", title: "Memory Safety", conceptIds: ["c-mem"], position: 1 },
    ];

    const unverifiedProfile = projectConceptProfile(
      "c-mem",
      [
        makeEvidence({
          id: "u1",
          conceptId: "c-mem",
          dimension: "comprehension",
          isVerified: false,
          observedScore: 1.0,
          baseWeight: 2.0,
          occurredAt: "2026-11-20T12:00:00.000Z",
        }),
        makeEvidence({
          id: "u2",
          conceptId: "c-mem",
          dimension: "retention",
          isVerified: false,
          observedScore: 1.0,
          baseWeight: 2.0,
          occurredAt: "2026-11-25T12:00:00.000Z",
        }),
      ],
      {
        conceptId: "c-mem",
        declaredLevel: "confident",
        note: "Chatted with AI",
        updatedAt: NOW_ISO,
      },
      NOW_ISO,
    );

    const profiles = new Map<string, ConceptCompetencyProfile>([
      ["c-ptr", makeExposureOnlyProfile("c-ptr")],
      ["c-mem", unverifiedProfile],
    ]);

    // Even if caller passes targetDimensions: ["exposure"], exposure alone MUST NOT skip
    const progression = computeAdaptiveProgression(nodes, [], profiles, undefined, {
      targetDimensions: ["exposure"],
    });

    expect(profiles.get("c-ptr")!.dimensions.exposure.status).toBe("demonstrated");
    expect(progression.nodeStates["n-exp"].status).toBe("ready");
    expect(progression.nodeStates["n-exp"].skippable).toBe(false);
    expect(progression.nodeStates["n-unverified"].status).toBe("ready");
    expect(progression.skippedPriorNodeIds).toEqual([]);
  });

  it("never blocks on low-confidence ai_inferred prerequisites (< 0.7) or user-bypassed edges and emits softWarnings", () => {
    const nodes: AdaptiveCurriculumNode[] = [
      { id: "n1", title: "Linear Algebra", conceptIds: ["c1"], position: 0 },
      { id: "n2", title: "Probability", conceptIds: ["c2"], position: 1 },
      { id: "n3", title: "Neural Networks", conceptIds: ["c3"], position: 2 },
      { id: "n4", title: "Visual Neural Nets Intuition", conceptIds: ["c3"], position: 3 },
    ];
    const edges: ConceptRelationshipEdge[] = [
      {
        id: "e-uncertain",
        sourceNodeId: "n1",
        targetNodeId: "n3",
        relationshipType: "requires",
        provenance: "ai_inferred",
        confidence: 0.58,
        uncertaintyNote: "Inferred from appendix mention",
        sourceRefIds: ["src-1"],
      },
      {
        id: "e-bypassed",
        sourceNodeId: "n2",
        targetNodeId: "n3",
        relationshipType: "requires",
        provenance: "source_verified",
        confidence: 0.98,
        bypassReason: "Already covered in grad stats",
        sourceRefIds: ["src-1"],
      },
      {
        id: "e-alt",
        sourceNodeId: "n4",
        targetNodeId: "n3",
        relationshipType: "alternative_explanation_of",
        provenance: "user_authored",
        confidence: 1.0,
        sourceRefIds: ["src-2"],
      },
    ];

    const progression = computeAdaptiveProgression(nodes, edges, {}, ["e-bypassed"]);

    expect(progression.nodeStates.n3.status).toBe("ready");
    expect(progression.nodeStates.n3.blockingEdgeIds).toEqual([]);
    expect(progression.nodeStates.n3.uncertainEdgeIds).toEqual(["e-uncertain"]);
    expect(progression.nodeStates.n3.bypassedEdgeIds).toEqual(["e-bypassed"]);
    expect(progression.nodeStates.n3.softWarnings).toHaveLength(2);
    expect(progression.nodeStates.n3.softWarnings[0]).toContain("Uncertain AI-inferred");
    expect(progression.nodeStates.n3.softWarnings[1]).toContain("bypassed");
    expect(
      progression.alternativePathways.some(
        (p) => p.kind === "alternative_explanation" && p.targetNodeId === "n4",
      ),
    ).toBe(true);
  });
});

describe("adaptiveCurriculum — verifySourceGrounding", () => {
  const localPrivateSource: AvailableSourceRecord = {
    id: "doc-private",
    title: "Internal Architecture Notes.pdf",
    exists: true,
    isIndexed: true,
    isLocalOnly: true,
    isAiExcluded: true,
    pageCount: 25,
    passages: [
      {
        id: "p1",
        text: "Binary search tree deletion handles three cases: leaf node, single child, and two children using inorder successor.",
        fingerprint: "fp-bst-del-1",
        pageNumber: 12,
      },
    ],
  };

  const videoSource: AvailableSourceRecord = {
    id: "vid-1",
    title: "Algorithms Lecture 4",
    exists: true,
    isIndexed: true,
    isLocalOnly: false,
    isAiExcluded: false,
    durationSeconds: 3600,
  };

  it("verifies valid page, timestamp, exact passage, and locally re-anchors slightly drifted passages", () => {
    const pageCheck = verifySourceGrounding(
      { sourceId: "doc-private", locatorType: "page", pageNumber: 12 },
      [localPrivateSource],
    );
    expect(pageCheck.status).toBe("verified");
    expect(pageCheck.isGrounded).toBe(true);
    expect(pageCheck.fabricated).toBe(false);
    expect(pageCheck.verificationMode).toBe("local_only");
    expect(pageCheck.cloudAiAllowed).toBe(false);

    const tsCheck = verifySourceGrounding(
      { sourceId: "vid-1", locatorType: "timestamp", timestampSeconds: 1845 },
      [videoSource],
    );
    expect(tsCheck.status).toBe("verified");
    expect(tsCheck.isGrounded).toBe(true);

    const reanchorCheck = verifySourceGrounding(
      {
        sourceId: "doc-private",
        locatorType: "passage",
        passageText:
          "Binary search tree deletion handles three cases: leaf node, single child, and two children with inorder successor",
      },
      [localPrivateSource],
      { fuzzyMatchThreshold: 0.75 },
    );
    expect(reanchorCheck.status).toBe("reanchored");
    expect(reanchorCheck.isGrounded).toBe(true);
    expect(reanchorCheck.matchedPassageId).toBe("p1");
    expect(reanchorCheck.cloudAiAllowed).toBe(false);
  });

  it("respects isLocalOnly/isAiExcluded privacy boundaries and returns structured recovery actions instead of fabricating", () => {
    // Drifted passage on privacy-restricted source when cloud fallback was requested
    const privacyDrift = verifySourceGrounding(
      {
        sourceId: "doc-private",
        locatorType: "passage",
        passageText: "Completely unrelated quantum mechanics derivation",
      },
      [localPrivateSource],
      { allowCloudFallback: true },
    );
    expect(privacyDrift.isGrounded).toBe(false);
    expect(privacyDrift.fabricated).toBe(false);
    expect(privacyDrift.cloudAiAllowed).toBe(false);
    expect(privacyDrift.verificationMode).toBe("local_only");
    expect(privacyDrift.recoveryActions).toContain("switch_to_local_only");
    expect(privacyDrift.recoveryActions).toContain("reindex_source");
    expect(privacyDrift.recoveryActions).toContain("select_alternative_passage");
    expect(privacyDrift.recoveryActions).toContain("mark_ungrounded_manual");

    // Missing source
    const missing = verifySourceGrounding(
      { sourceId: "doc-deleted", locatorType: "page", pageNumber: 3 },
      [localPrivateSource],
    );
    expect(missing.status).toBe("missing_source");
    expect(missing.isGrounded).toBe(false);
    expect(missing.fabricated).toBe(false);
    expect(missing.recoveryActions).toEqual([
      "select_alternative_passage",
      "mark_ungrounded_manual",
    ]);

    // Unindexed source
    const unindexed = verifySourceGrounding(
      { sourceId: "doc-unindexed", locatorType: "passage", passageText: "test" },
      [
        {
          id: "doc-unindexed",
          title: "Fresh Upload.pdf",
          exists: true,
          isIndexed: false,
          isLocalOnly: false,
          isAiExcluded: false,
        },
      ],
    );
    expect(unindexed.status).toBe("source_not_indexed");
    expect(unindexed.recoveryActions).toContain("reindex_source");
    expect(unindexed.recoveryActions).toContain("mark_ungrounded_manual");
  });
});
