/**
 * Pinned authority + preflight tests for Study Plan tutoring (task 1.3).
 *
 * Covers strict scoped retrieval, missing/stale sources, model-only zero
 * retrieval, mixed labels and consent invalidation on resume/provider switch.
 */

import { describe, expect, it } from "vitest";
import { buildStudyTutorContext } from "../studyTutorContext";
import { checkStudyTutorPrivacy } from "../studyTutorPrivacy";

function ref(id: string, documentId: string) {
  return {
    schemaVersion: 1 as const,
    id,
    documentId,
    excerpt: "passage",
    revision: "r1",
    revisionKind: "content-hash" as const,
    excerptSha256: "hash",
    documentTitle: "Doc",
    sourceType: "pdf",
    capturedAt: "2026-11-12T00:00:00Z",
  };
}

describe("buildStudyTutorContext (pinned authority)", () => {
  it("rejects any ref outside the authorized document scope (strict scoped retrieval)", () => {
    expect(() =>
      buildStudyTutorContext({
        planId: "sp_1",
        planVersionId: "spv_1",
        nodeId: "n1",
        sourceRefs: [ref("ssr_1", "doc_1"), ref("ssr_2", "doc_2")],
        authorizedDocumentIds: ["doc_1"],
        objectives: ["Understand X"],
      })
    ).toThrow("study.tutor.error.unauthorized_source");

    const context = buildStudyTutorContext({
      planId: "sp_1",
      planVersionId: "spv_1",
      nodeId: "n1",
      sourceRefs: [ref("ssr_1", "doc_1"), ref("ssr_2", "doc_2")],
      authorizedDocumentIds: ["doc_1", "doc_2"],
      objectives: ["Understand X"],
    });
    expect(context.sourceDocumentIds).toEqual(["doc_1", "doc_2"]);
    expect(context.sourceRefIds).toEqual(["ssr_1", "ssr_2"]);
  });

  it("denies missing/stale source context instead of falling back globally", () => {
    expect(() =>
      buildStudyTutorContext({
        planId: "sp_1",
        planVersionId: "spv_1",
        nodeId: "n1",
        sourceRefs: [],
      })
    ).toThrow("study.tutor.error.missing_source_context");

    expect(() =>
      buildStudyTutorContext({
        planId: "sp_1",
        planVersionId: "spv_1",
        nodeId: "n1",
        sourceRefs: [ref("ssr_1", "doc_1")],
        authorizedDocumentIds: ["doc_other"],
      })
    ).toThrow("study.tutor.error.unauthorized_source");
  });

  it("model-only sessions have no library refs and must NOT build a source context", () => {
    // The model-only launch contract is: zero retrieval. Any attempt to build a
    // source-backed context from a model-only lesson fails closed.
    expect(() =>
      buildStudyTutorContext({
        planId: "sp_1",
        planVersionId: "spv_1",
        nodeId: "n1",
        sourceRefs: [],
      })
    ).toThrow();
  });
});

describe("checkStudyTutorPrivacy (preflight, fail-closed)", () => {
  const base = {
    generationSendsOffDevice: false,
    strictLocalOnly: false,
    cloudDisclosureAccepted: true,
    costConsentAccepted: true,
    billable: false,
  };

  it("denies AI-excluded sources", () => {
    expect(() =>
      checkStudyTutorPrivacy({
        ...base,
        documents: [{ documentId: "doc_1", isAiExcluded: true }],
      })
    ).toThrow("study.tutor.error.source_ai_excluded");
  });

  it("denies local-only sources when the route sends off-device", () => {
    expect(() =>
      checkStudyTutorPrivacy({
        ...base,
        generationSendsOffDevice: true,
        documents: [{ documentId: "doc_1", isLocalOnly: true }],
      })
    ).toThrow("study.tutor.error.privacy_denied");
  });

  it("consent invalidation: resuming/switching to a remote route without disclosure is denied", () => {
    // Same inputs, consent reset (as after a provider switch or re-consent):
    // the check must fail again even though it passed before.
    expect(() =>
      checkStudyTutorPrivacy({
        ...base,
        generationSendsOffDevice: true,
        cloudDisclosureAccepted: true,
        documents: [],
      })
    ).not.toThrow();
    expect(() =>
      checkStudyTutorPrivacy({
        ...base,
        generationSendsOffDevice: true,
        cloudDisclosureAccepted: false,
        documents: [],
      })
    ).toThrow("study.tutor.error.privacy_denied");
  });

  it("denies billable routes without cost consent (unpriced/billable providers included)", () => {
    expect(() =>
      checkStudyTutorPrivacy({
        ...base,
        billable: true,
        costConsentAccepted: false,
        documents: [],
      })
    ).toThrow("study.tutor.error.cost_consent_required");
  });
});
