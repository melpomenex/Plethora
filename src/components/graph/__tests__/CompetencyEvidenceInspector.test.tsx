import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "../../../test/utils";
import {
  COMPETENCY_POLICY_VERSION,
  type ConceptCompetencyProfile,
  type DimensionProjection,
} from "../../../types/learnerModel";
import { CompetencyEvidenceInspector } from "../CompetencyEvidenceInspector";

function makeProjection(
  overrides: Partial<DimensionProjection> & Pick<DimensionProjection, "dimension">
): DimensionProjection {
  return {
    status: "unknown",
    estimate: null,
    confidence: 0,
    effectiveWeight: 0,
    rawEvidenceCount: 0,
    independentGroups: 0,
    distinctDays: 0,
    uncertaintyReasons: [],
    evidenceIds: [],
    lastEvidenceAt: null,
    policyVersion: COMPETENCY_POLICY_VERSION,
    ...overrides,
  };
}

function makeProfile(
  overrides: Partial<ConceptCompetencyProfile> = {}
): ConceptCompetencyProfile {
  return {
    conceptId: "concept-bayes",
    conceptName: "Bayes' Theorem",
    containsLocalOnlyEvidence: false,
    containsAiExcludedEvidence: false,
    selfDeclaration: {
      conceptId: "concept-bayes",
      declaredLevel: "confident",
      note: "Studied in undergrad probability",
      updatedAt: "2026-11-20T10:00:00Z",
    },
    dimensions: {
      exposure: makeProjection({
        dimension: "exposure",
        status: "demonstrated",
        estimate: 0.92,
        confidence: 0.88,
        effectiveWeight: 3.2,
        rawEvidenceCount: 5,
        independentGroups: 3,
        distinctDays: 3,
        lastEvidenceAt: "2026-11-26T12:00:00Z",
      }),
      comprehension: makeProjection({
        dimension: "comprehension",
        status: "developing",
        estimate: 0.68,
        confidence: 0.62,
        effectiveWeight: 1.8,
        rawEvidenceCount: 2,
        independentGroups: 2,
        distinctDays: 2,
        lastEvidenceAt: "2026-11-25T15:00:00Z",
      }),
      retention: makeProjection({
        dimension: "retention",
        status: "insufficient_evidence",
        estimate: 0.85, // Should NOT be displayed as an established percentage
        confidence: 0.25,
        effectiveWeight: 0.5,
        rawEvidenceCount: 1,
        independentGroups: 1,
        distinctDays: 1,
        uncertaintyReasons: [
          "Only 1 distinct day of spaced recall recorded",
          "Needs additional independent review sessions",
        ],
        lastEvidenceAt: "2026-11-24T09:00:00Z",
      }),
      application: makeProjection({
        dimension: "application",
        status: "needs_attention",
        estimate: 0.42,
        confidence: 0.7,
        effectiveWeight: 2.0,
        rawEvidenceCount: 3,
        independentGroups: 2,
        distinctDays: 2,
        lastEvidenceAt: "2026-11-23T18:30:00Z",
      }),
      transfer: makeProjection({
        dimension: "transfer",
        status: "unknown",
        estimate: null,
        confidence: 0,
        effectiveWeight: 0,
        rawEvidenceCount: 0,
        independentGroups: 0,
        distinctDays: 0,
        uncertaintyReasons: ["No verified transfer evidence collected yet"],
        lastEvidenceAt: null,
      }),
    },
    ...overrides,
  };
}

describe("CompetencyEvidenceInspector", () => {
  it("renders all 5 competency dimensions with statuses, provenance, and recency", () => {
    render(<CompetencyEvidenceInspector profile={makeProfile()} />);

    expect(screen.getByText("Bayes' Theorem")).toBeTruthy();

    for (const dim of [
      "exposure",
      "comprehension",
      "retention",
      "application",
      "transfer",
    ]) {
      expect(screen.getByTestId(`competency-dimension-${dim}`)).toBeTruthy();
    }

    expect(screen.getByTestId("competency-status-exposure").textContent).toBe(
      "Demonstrated"
    );
    expect(screen.getByTestId("competency-score-exposure").textContent).toBe("92%");
    expect(screen.getByTestId("competency-provenance-exposure").textContent).toContain(
      "5 evidence records"
    );
    expect(screen.getByTestId("competency-recency-exposure").textContent).toContain(
      "2026-11-26"
    );

    expect(screen.getByTestId("competency-status-comprehension").textContent).toBe(
      "Developing"
    );
    expect(screen.getByTestId("competency-score-comprehension").textContent).toBe("68%");

    expect(screen.getByTestId("competency-status-application").textContent).toBe(
      "Needs attention"
    );
    expect(screen.getByTestId("competency-score-application").textContent).toBe("42%");
  });

  it("honestly distinguishes unknown and insufficient_evidence from demonstrated competency and displays uncertaintyReasons", () => {
    render(<CompetencyEvidenceInspector profile={makeProfile()} />);

    // Retention is insufficient_evidence: even though estimate=0.85 exists, it must NOT show 85%
    expect(screen.getByTestId("competency-status-retention").textContent).toBe(
      "Insufficient evidence"
    );
    expect(screen.getByTestId("competency-score-retention").textContent).toBe(
      "Not established"
    );
    const retentionReasons = screen.getByTestId("competency-uncertainty-retention");
    expect(retentionReasons.textContent).toContain(
      "Only 1 distinct day of spaced recall recorded"
    );
    expect(retentionReasons.textContent).toContain(
      "Needs additional independent review sessions"
    );

    // Transfer is unknown
    expect(screen.getByTestId("competency-status-transfer").textContent).toBe("Unknown");
    expect(screen.getByTestId("competency-score-transfer").textContent).toBe(
      "Not established"
    );
    expect(screen.getByTestId("competency-recency-transfer").textContent).toContain(
      "No evidence recorded"
    );
    expect(screen.getByTestId("competency-uncertainty-transfer").textContent).toContain(
      "No verified transfer evidence collected yet"
    );
  });

  it("displays self-declared level separately from verified evidence", () => {
    render(<CompetencyEvidenceInspector profile={makeProfile()} />);

    const selfDecl = screen.getByTestId("competency-self-declaration");
    expect(selfDecl.textContent).toContain("Separate from verified evidence");
    expect(selfDecl.textContent).toContain("Confident");
    expect(selfDecl.textContent).toContain("Studied in undergrad probability");

    // Self-declared "Confident" must not inflate unknown transfer dimension
    expect(screen.getByTestId("competency-status-transfer").textContent).toBe("Unknown");
  });

  it("renders local-only and AI-excluded badges when present and omits them otherwise", () => {
    const { rerender } = render(<CompetencyEvidenceInspector profile={makeProfile()} />);
    expect(screen.queryByTestId("badge-local-only")).toBeNull();
    expect(screen.queryByTestId("badge-ai-excluded")).toBeNull();

    rerender(
      <CompetencyEvidenceInspector
        profile={makeProfile({
          containsLocalOnlyEvidence: true,
          containsAiExcludedEvidence: true,
          selfDeclaration: null,
        })}
      />
    );

    expect(screen.getByTestId("badge-local-only").textContent).toBe("Local-only");
    expect(screen.getByTestId("badge-ai-excluded").textContent).toBe("AI-excluded");
    expect(screen.getByTestId("competency-self-declaration").textContent).toContain(
      "No self-declaration recorded."
    );
  });

  it("invokes onRequestPractice for the selected dimension", () => {
    const onRequestPractice = vi.fn();
    render(
      <CompetencyEvidenceInspector
        profile={makeProfile()}
        onRequestPractice={onRequestPractice}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Gather transfer evidence/i }));
    expect(onRequestPractice).toHaveBeenCalledWith("concept-bayes", "transfer");
  });
});
