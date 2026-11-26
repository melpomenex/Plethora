import { describe, expect, it } from "vitest";
import {
  mergePedagogicalReports,
  verifyStudyModeArtifactDeterministic,
} from "../pedagogicalVerifier";

const SOURCE_TEXT =
  "Mitochondria generate most of the cell's supply of adenosine triphosphate (ATP), used as a source of chemical energy. Unlike prokaryotic cells, eukaryotic cells compartmentalize oxidative phosphorylation inside the inner mitochondrial membrane.";

describe("pedagogicalVerifier", () => {
  it("rejects fabricated citations in source-only mode", () => {
    const res = verifyStudyModeArtifactDeterministic({
      artifactType: "explanation",
      knowledgeAuthority: "source-only",
      authorizedSourceIds: ["doc-1"],
      expectedRevision: "rev-1",
      artifactRevision: "rev-1",
      sourceTexts: [SOURCE_TEXT],
      payload: {
        title: "ATP Production",
        citations: [
          {
            sourceId: "doc-1",
            quote: "Mitochondria are powered by nuclear fusion inside the nucleus.",
          },
        ],
      },
    });
    expect(res.valid).toBe(false);
    expect(res.issues).toContain("citation_quote_not_found_in_source");
    expect(res.report.hardGatePassed).toBe(false);
  });

  it("rejects unauthorized source IDs", () => {
    const res = verifyStudyModeArtifactDeterministic({
      artifactType: "explanation",
      knowledgeAuthority: "source-only",
      authorizedSourceIds: ["doc-1"],
      sourceTexts: [SOURCE_TEXT],
      payload: {
        citations: [
          {
            sourceId: "doc-999",
            quote: "Mitochondria generate most of the cell's supply of adenosine triphosphate",
          },
        ],
      },
    });
    expect(res.valid).toBe(false);
    expect(res.issues).toContain("unauthorized_source_id:doc-999");
  });

  it("rejects stale source revisions", () => {
    const res = verifyStudyModeArtifactDeterministic({
      artifactType: "summary",
      knowledgeAuthority: "source-only",
      authorizedSourceIds: ["doc-1"],
      expectedRevision: "rev-2",
      artifactRevision: "rev-1",
      sourceTexts: [SOURCE_TEXT],
      payload: {
        citations: [
          {
            sourceId: "doc-1",
            quote: "Mitochondria generate most of the cell's supply of adenosine triphosphate",
          },
        ],
      },
    });
    expect(res.valid).toBe(false);
    expect(res.issues).toContain("source_revision_mismatch");
  });

  it("rejects unsafe HTML/JS script payloads (prompt injection / XSS)", () => {
    const res = verifyStudyModeArtifactDeterministic({
      artifactType: "timeline",
      knowledgeAuthority: "source-only",
      authorizedSourceIds: ["doc-1"],
      sourceTexts: [SOURCE_TEXT],
      payload: {
        title: "Process",
        html: "<script>fetch('https://evil.example')</script>",
        citations: [
          {
            sourceId: "doc-1",
            quote: "Mitochondria generate most of the cell's supply of adenosine triphosphate",
          },
        ],
      },
    });
    expect(res.valid).toBe(false);
    expect(res.issues).toContain("unsafe_markup_detected");
  });

  it("rejects ambiguous or malformed multiple-choice questions", () => {
    const res = verifyStudyModeArtifactDeterministic({
      artifactType: "formative_question",
      knowledgeAuthority: "source-only",
      authorizedSourceIds: ["doc-1"],
      sourceTexts: [SOURCE_TEXT],
      payload: {
        questionKind: "multiple_choice",
        options: ["ATP", "ATP", "Glucose"],
        answerKey: { correctIndex: 0 },
      },
    });
    expect(res.valid).toBe(false);
    expect(res.issues).toContain("duplicate_or_empty_multiple_choice_options");
  });

  it("prevents high engagement scores from overriding deterministic hard-gate failures", () => {
    const det = verifyStudyModeArtifactDeterministic({
      artifactType: "explanation",
      knowledgeAuthority: "source-only",
      authorizedSourceIds: ["doc-1"],
      sourceTexts: [SOURCE_TEXT],
      payload: { title: "Missing citations" },
    });
    const merged = mergePedagogicalReports(det.report, [
      {
        criterion: "engagement",
        rating: "pass",
        rationale: "Very engaging analogy",
        evidence: [],
      },
      {
        criterion: "source_fidelity",
        rating: "pass",
        rationale: "AI evaluator thought it was fine",
        evidence: [],
      },
    ]);
    expect(merged.hardGatePassed).toBe(false);
    expect(merged.criteria.find((c) => c.criterion === "source_fidelity")?.rating).toBe("fail");
  });

  it("passes valid grounded artifacts", () => {
    const res = verifyStudyModeArtifactDeterministic({
      artifactType: "explanation",
      knowledgeAuthority: "source-only",
      authorizedSourceIds: ["doc-1"],
      expectedRevision: "rev-1",
      artifactRevision: "rev-1",
      sourceTexts: [SOURCE_TEXT],
      payload: {
        title: "Oxidative Phosphorylation",
        citations: [
          {
            sourceId: "doc-1",
            quote: "eukaryotic cells compartmentalize oxidative phosphorylation inside the inner mitochondrial membrane.",
          },
        ],
      },
    });
    expect(res.valid).toBe(true);
    expect(res.report.hardGatePassed).toBe(true);
  });

  it("extracts nested citations from mind_map nodes, timeline events, and slides", () => {
    const quote = "Mitochondria generate most of the cell's supply of adenosine triphosphate (ATP)";
    for (const [artifactType, payload] of [
      ["mind_map", { title: "Map", nodes: [{ id: "n1", label: "ATP", citations: [{ sourceId: "doc-1", quote }] }], edges: [] }],
      ["timeline", { title: "Seq", events: [{ id: "e1", order: 1, label: "ATP", citations: [{ sourceId: "doc-1", quote }] }] }],
      ["slides", { title: "Deck", slides: [{ title: "ATP", bullets: ["Energy"], citations: [{ sourceId: "doc-1", quote }] }] }],
    ] as const) {
      const res = verifyStudyModeArtifactDeterministic({
        artifactType,
        knowledgeAuthority: "source-only",
        authorizedSourceIds: ["doc-1"],
        sourceTexts: [SOURCE_TEXT],
        payload,
      });
      expect(res.valid).toBe(true);
    }
  });
});
